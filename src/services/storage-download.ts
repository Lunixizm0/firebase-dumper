import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { isSafePath } from "../core/path-safety.ts";
import { toErrorMessage } from "../core/errors.ts";
import { logErrorWithMessage } from "../core/results.ts";
import type { ServiceContext } from "../types.ts";

interface DownloadFileLike {
  name: string;
  metadata?: { size?: string | number };
  createReadStream(): NodeJS.ReadableStream;
}

function safeRelativePath(objectName: string): string {
  const segments = objectName.split("/").filter((s) => s !== "" && s !== ".");
  for (const segment of segments) {
    if (/[\\:]/.test(segment)) {
      throw new Error(`Unsafe storage object name segment: "${segment}"`);
    }
    if (!isSafePath(segment)) {
      throw new Error(`Unsafe storage object name segment: "${segment}"`);
    }
  }
  return segments.join(path.sep);
}

async function ensureContained(destination: string, realBase: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(destination), { recursive: true });
  const realDir = await fs.promises.realpath(path.dirname(destination));
  if (realDir !== realBase && !realDir.startsWith(realBase + path.sep)) {
    throw new Error("Refusing to write outside the storage_files directory (symlink detected)");
  }
}

async function downloadOne(
  file: DownloadFileLike,
  destination: string,
  realBase: string,
  maxBytes: number
): Promise<number> {
  await ensureContained(destination, realBase);

  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc: string, callback: (err: Error | null, data?: Buffer) => void) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        callback(new Error(`File exceeds the ${maxBytes} byte download cap`));
        return;
      }
      callback(null, chunk);
    }
  });

  await pipeline(
    file.createReadStream(),
    counter,
    fs.createWriteStream(destination, { flags: "wx", mode: 0o600 })
  );
  return bytes;
}

export async function downloadStorageFiles(
  ctx: ServiceContext,
  bucketName: string,
  files: DownloadFileLike[]
): Promise<void> {
  const { config, logger } = ctx;
  if (!config.storageDownload) return;

  if (!isSafePath(bucketName)) {
    logErrorWithMessage(ctx, "storage.download", `Unsafe storage bucket name: "${bucketName}"`);
    return;
  }

  const baseDir = path.join(config.outputDir, "storage_files", bucketName);
  await fs.promises.mkdir(baseDir, { recursive: true });
  const realBase = await fs.promises.realpath(baseDir);
  let downloaded = 0;
  let skipped = 0;

  for (const file of files) {
    const size = Number(file.metadata?.size ?? 0);
    const isFolder = file.name.endsWith("/");
    if (isFolder || (size > 0 && size > config.storageDownloadMaxBytes)) {
      skipped++;
      continue;
    }

    let relative: string;
    try {
      relative = safeRelativePath(file.name);
    } catch (e) {
      logErrorWithMessage(ctx, `storage.download(${file.name})`, toErrorMessage(e));
      continue;
    }

    const destination = path.join(baseDir, relative);
    try {
      await downloadOne(file, destination, realBase, config.storageDownloadMaxBytes);
      downloaded++;
    } catch (e) {
      try {
        await fs.promises.unlink(destination);
      } catch {
        // best effort cleanup of the partial file
      }
      logErrorWithMessage(ctx, `storage.download(${file.name})`, toErrorMessage(e));
    }
  }

  logger.log(
    `  Storage download: ${downloaded} file(s) saved under ${baseDir}, ${skipped} skipped`
  );
}
