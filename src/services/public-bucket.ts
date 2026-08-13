import { MAX_NETWORK_RESPONSE_BYTES, readTextLimited } from "../core/writer.ts";
import { markOk, skipService } from "../core/results.ts";
import { withRetry } from "../core/retry.ts";
import type { PublicBucketObject, ServiceContext } from "../types.ts";

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
