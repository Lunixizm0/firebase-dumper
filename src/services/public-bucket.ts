import { isIP } from "node:net";
import { MAX_NETWORK_RESPONSE_BYTES, readTextLimited } from "../core/writer.ts";
import { markOk, skipService } from "../core/results.ts";
import { withRetry } from "../core/retry.ts";
import type { PublicBucketObject, ServiceContext } from "../types.ts";

const METADATA_HOSTS: ReadonlySet<string> = new Set([
  "metadata.google.internal",
  "metadata",
  "instance-data",
  "metadata.aws.internal"
]);

function ipv4ToInt(a: number, b: number, c: number, d: number): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function inRange(ip: number, start: number, end: number): boolean {
  return ip >= start && ip <= end;
}

function isBlockedIPv4(host: string): boolean {
  const parts = host.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const ip = ipv4ToInt(parts[0]!, parts[1]!, parts[2]!, parts[3]!);
  return (
    inRange(ip, ipv4ToInt(0, 0, 0, 0), ipv4ToInt(0, 255, 255, 255)) ||
    inRange(ip, ipv4ToInt(10, 0, 0, 0), ipv4ToInt(10, 255, 255, 255)) ||
    inRange(ip, ipv4ToInt(100, 64, 0, 0), ipv4ToInt(100, 127, 255, 255)) ||
    inRange(ip, ipv4ToInt(127, 0, 0, 0), ipv4ToInt(127, 255, 255, 255)) ||
    inRange(ip, ipv4ToInt(169, 254, 0, 0), ipv4ToInt(169, 254, 255, 255)) ||
    inRange(ip, ipv4ToInt(172, 16, 0, 0), ipv4ToInt(172, 31, 255, 255)) ||
    inRange(ip, ipv4ToInt(192, 0, 0, 0), ipv4ToInt(192, 0, 0, 255)) ||
    inRange(ip, ipv4ToInt(192, 0, 2, 0), ipv4ToInt(192, 0, 2, 255)) ||
    inRange(ip, ipv4ToInt(192, 168, 0, 0), ipv4ToInt(192, 168, 255, 255)) ||
    inRange(ip, ipv4ToInt(198, 18, 0, 0), ipv4ToInt(198, 19, 255, 255)) ||
    inRange(ip, ipv4ToInt(198, 51, 100, 0), ipv4ToInt(198, 51, 100, 255)) ||
    inRange(ip, ipv4ToInt(203, 0, 113, 0), ipv4ToInt(203, 0, 113, 255)) ||
    inRange(ip, ipv4ToInt(224, 0, 0, 0), ipv4ToInt(239, 255, 255, 255)) ||
    inRange(ip, ipv4ToInt(240, 0, 0, 0), ipv4ToInt(255, 255, 255, 255))
  );
}

function ipv4MappedToIp(raw: string): string {
  const mapped = raw.slice("::ffff:".length);
  const [hi, lo] = mapped.split(":");
  if (
    hi &&
    lo &&
    /^[0-9a-f]{1,4}$/i.test(hi) &&
    /^[0-9a-f]{1,4}$/i.test(lo)
  ) {
    const hiNum = parseInt(hi, 16);
    const loNum = parseInt(lo, 16);
    return `${hiNum >> 8}.${hiNum & 0xff}.${loNum >> 8}.${loNum & 0xff}`;
  }
  return mapped;
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (METADATA_HOSTS.has(host)) return true;

  const raw = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const family = isIP(raw);
  if (family === 6) {
    if (raw === "::" || raw === "::1") return true;
    if (raw.startsWith("::ffff:")) return isBlockedIPv4(ipv4MappedToIp(raw));
    return /^fc|^fd/.test(raw) || /^fe[89ab]/.test(raw) || raw.startsWith("2001:db8");
  }
  if (family === 4) return isBlockedIPv4(raw);
  return false;
}

export function assertExternalFetchable(bucketUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(bucketUrl);
  } catch {
    throw new Error(`Invalid bucket URL: ${bucketUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Bucket URL scheme must be http or https: ${parsed.protocol}`);
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new Error(`Bucket URL host is not allowed for external fetch: ${parsed.hostname}`);
  }
}

function buildListQuery(continuationToken: string | null): string {
  const params = new URLSearchParams({ "list-type": "2" });
  if (continuationToken) params.set("continuation-token", continuationToken);
  return params.toString();
}

function parseContents(text: string): PublicBucketObject[] {
  const blocks = text.match(/<Contents>[\s\S]*?<\/Contents>/g) || [];
  return blocks.map((block) => ({
    key: (block.match(/<Key>([^<]*)<\/Key>/) || [])[1] ?? null,
    size: Number((block.match(/<Size>([^<]*)<\/Size>/) || [])[1]) || null,
    lastModified: (block.match(/<LastModified>([^<]*)<\/LastModified>/) || [])[1] ?? null,
    etag: ((block.match(/<ETag>([^<]*)<\/ETag>/) || [])[1] ?? "").replace(/"/g, "") || null,
    storageClass: (block.match(/<StorageClass>([^<]*)<\/StorageClass>/) || [])[1] ?? null
  }));
}

function nextContinuationToken(text: string): string | null {
  const isTruncated = /<IsTruncated>true<\/IsTruncated>/i.test(text);
  return isTruncated
    ? (text.match(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/) || [])[1] ?? null
    : null;
}

export async function dumpPublicBucket(ctx: ServiceContext, bucketUrl: string): Promise<void> {
  const { config, logger, results } = ctx;
  assertExternalFetchable(bucketUrl);
  const base = bucketUrl.endsWith("/") ? bucketUrl : `${bucketUrl}/`;
  let continuationToken: string | null = null;
  const objects: PublicBucketObject[] = [];
  let bucketName: string | null = null;
  let page = 0;

  do {
    const url = `${base}?${buildListQuery(continuationToken)}`;
    const resp = await withRetry(
      () =>
        fetch(url, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(15000)
        }),
      { retries: config.retries }
    );
    const text = await readTextLimited(resp, MAX_NETWORK_RESPONSE_BYTES);

    if (!resp.ok) {
      if (resp.status === 403 || /AccessDenied/i.test(text)) {
        skipService(ctx, "storage", "Bucket exists but its listing isnt public (HTTP 403).");
        return;
      }
      if (resp.status === 404 || /NoSuchBucket/i.test(text)) {
        skipService(ctx, "storage", "Bucket not found at this URL (HTTP 404).");
        return;
      }
      throw new Error(`HTTP ${resp.status} while listing bucket`);
    }

    bucketName = bucketName ?? ((text.match(/<Name>([^<]*)<\/Name>/) || [])[1] || bucketUrl);
    const blocks = parseContents(text);
    objects.push(...blocks);

    page++;
    logger.log(`  Page ${page}: ${blocks.length} objects`);

    continuationToken = nextContinuationToken(text);
    if (continuationToken && page >= config.maxPages) {
      logger.warn(`Reached ${config.maxPages}-page cap, stopping pagination early.`);
      break;
    }
  } while (continuationToken);

  const resolvedName = bucketName ?? bucketUrl;
  results.storage.buckets.push({ name: resolvedName, source: "public-anonymous-listing", url: bucketUrl });
  results.storage.files[resolvedName] = objects;
  logger.ok(`[${resolvedName}] => ${objects.length} objects listed (metadata only, no content downloaded)`);
  markOk(ctx, "storage");
}
