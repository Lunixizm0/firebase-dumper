import type { Storage } from "firebase-admin/storage";
import { logServiceError, markOk, skipService } from "../core/results.ts";
import { toErrorMessage } from "../core/errors.ts";
import { withRetry } from "../core/retry.ts";
import { dumpPublicBucket } from "./public-bucket.ts";
import { downloadStorageFiles } from "./storage-download.ts";
import type { ServiceContext, StorageBucketInfo, StorageFileInfo } from "../types.ts";

type BucketLike = ReturnType<Storage["bucket"]>;
type FileLike = ReturnType<BucketLike["file"]>;

function toFileInfo(f: FileLike): StorageFileInfo {
  const m = f.metadata;
  return {
    name: f.name,
    size: m?.size ?? undefined,
    contentType: m?.contentType ?? undefined,
    contentEncoding: m?.contentEncoding ?? undefined,
    updated: m?.updated ?? undefined,
    created: m?.timeCreated ?? undefined,
    md5Hash: m?.md5Hash ?? undefined,
    crc32c: m?.crc32c ?? undefined,
    generation: m?.generation ?? undefined,
    metageneration: m?.metageneration ?? undefined,
    storageClass: m?.storageClass ?? undefined,
    mediaLink: m?.mediaLink ?? undefined,
    selfLink: m?.selfLink ?? undefined,
    public: m?.acl?.some((a) => a.entity === "allUsers") || false,
    owner: m?.owner,
    metadata: m?.metadata,
    cacheControl: m?.cacheControl ?? undefined
  };
}

async function findBucket(
  storage: Storage,
  candidateNames: string[],
  retries: number
): Promise<BucketLike> {
  let lastErr: unknown = null;
  for (const name of candidateNames) {
    try {
      const candidate = storage.bucket(name) as BucketLike;
      await withRetry(() => candidate.getMetadata(), { retries });
      return candidate;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(
    `No accessible bucket found (tried: ${candidateNames.join(", ")}). ` +
    `Pass --bucket <name> explicitly. Last error: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`
  );
}

function handleStorageError(ctx: ServiceContext, e: unknown): void {
  if (/does not exist/i.test(toErrorMessage(e))) {
    skipService(ctx, "storage", "No Storage bucket is provisioned for this project.");
  } else {
    logServiceError(ctx, "storage", e);
  }
}

export async function dumpStorage(ctx: ServiceContext): Promise<void> {
  const { config, logger, results, serviceAccount } = ctx;
  if (!config.enabledServices.has("storage")) return;

  logger.section("Storage");
  logger.log("Starting dump...");

  if (config.bucketOverride && /^https?:\/\//i.test(config.bucketOverride)) {
    try {
      await dumpPublicBucket(ctx, config.bucketOverride);
    } catch (e) {
      logServiceError(ctx, "storage", e);
    }
    return;
  }

  try {
    const storage = ctx.clients.storage;
    const projectId = serviceAccount.project_id;
    const candidateNames = config.bucketOverride
      ? [config.bucketOverride]
      : [`${projectId}.firebasestorage.app`, `${projectId}.appspot.com`];

    const bucket = await findBucket(storage, candidateNames, config.retries);

    const [metadata] = await bucket.getMetadata();
    const bucketInfo: StorageBucketInfo = {
      name: bucket.name,
      id: metadata.id,
      location: metadata.location,
      storageClass: metadata.storageClass,
      created: metadata.timeCreated,
      updated: metadata.updated,
      iamConfiguration: metadata.iamConfiguration,
      versioning: metadata.versioning,
      labels: metadata.labels,
      cors: metadata.cors,
      lifecycle: metadata.lifecycle
    };
    results.storage.buckets.push(bucketInfo);

    logger.log(`  Using bucket: ${bucket.name}`);

    const files: StorageFileInfo[] = [];
    const rawFiles: FileLike[] = [];
    let pageToken: string | undefined;
    do {
      const [page, nextQuery] = await withRetry(
        () => bucket.getFiles({ autoPaginate: false, maxResults: 1000, pageToken }),
        { retries: config.retries }
      );

      for (const f of page) {
        rawFiles.push(f);
        files.push(toFileInfo(f));
      }

      if (config.storageMaxFiles > 0 && files.length >= config.storageMaxFiles) break;
      pageToken = nextQuery?.pageToken;
    } while (pageToken);

    results.storage.files[bucket.name] = files;

    logger.log(`  [${bucket.name}] => ${files.length} files`);

    if (config.storageDownload) {
      await downloadStorageFiles(ctx, bucket.name, rawFiles);
    }

    markOk(ctx, "storage");
  } catch (e) {
    handleStorageError(ctx, e);
  }
}
