import fs from "node:fs";
import path from "node:path";
import { FatalError } from "../core/errors.ts";
import { ensureOutputDir, isSafePath, validateKeyFile } from "../core/path-safety.ts";
import { parseServices } from "../cli/parse.ts";
import type { CliOptions, ResolvedConfig, ServiceAccount } from "../types.ts";

const REQUIRED_KEY_FIELDS: readonly string[] = ["project_id", "client_email", "private_key"];

function resolveServiceAccount(keyPath: string): ServiceAccount {
  let raw: string;
  try {
    raw = fs.readFileSync(keyPath, "utf8");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new FatalError(`ERR: Failed to read service account key: ${msg}`);
  }

  let parsed: ServiceAccount;
  try {
    parsed = JSON.parse(raw) as ServiceAccount;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new FatalError(`ERR: Failed to parse service account key: ${msg}`);
  }

  for (const field of REQUIRED_KEY_FIELDS) {
    if (!parsed[field]) {
      throw new FatalError(`ERR: Service account key missing required field: ${field}`);
    }
  }

  return parsed;
}

function validateDbUrl(dbUrl: string): void {
  try {
    new URL(dbUrl);
  } catch {
    throw new FatalError("Err: --db-url is not a valid URL.");
  }
  if (!/^https:\/\/[\w-]+\.firebaseio\.com\/?$/.test(dbUrl)) {
    throw new FatalError("Err: --db-url must be a Firebase RTDB URL (https://<project>.firebaseio.com)");
  }
}

function positiveInteger(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 0) {
    throw new FatalError(`Err: --${name} must be a non-negative integer`);
  }
  return value;
}

function positivePageSize(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new FatalError(`Err: --${name} must be a positive integer`);
  }
  return value;
}

function positiveMb(name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) {
    throw new FatalError(`Err: --${name} must be a positive integer (MB)`);
  }
  return value;
}

export function resolveConfig(opts: CliOptions): ResolvedConfig {
  const keyPath = path.resolve(opts.key);
  const outputDir = path.resolve(opts.out);
  const dbUrl = opts.dbUrl ?? null;
  const bucketOverride = opts.bucket ?? null;

  validateKeyFile(keyPath);

  if (!isSafePath(outputDir)) {
    throw new FatalError("Err: Output directory path is unsafe");
  }

  if (bucketOverride && !/^https?:\/\//i.test(bucketOverride) && !isSafePath(bucketOverride)) {
    throw new FatalError("Err: --bucket value contains illegal characters");
  }

  if (dbUrl) {
    validateDbUrl(dbUrl);
  }

  if (!opts.dryRun) {
    ensureOutputDir(outputDir);
  }

  const serviceAccount = resolveServiceAccount(keyPath);
  const enabledServices = parseServices(opts.services);
  const retries = positiveInteger("retries", opts.retries, 3);
  const storageDownloadMaxBytes = positiveMb("storage-download-max", opts.storageDownloadMaxMb, 50) * 1024 * 1024;

  return {
    keyPath,
    outputDir,
    dbUrl,
    bucketOverride,
    quiet: opts.quiet,
    enabledServices,
    projectId: serviceAccount.project_id,
    clientEmail: serviceAccount.client_email,
    serviceAccount,
    dryRun: opts.dryRun ?? false,
    archive: opts.archive ?? false,
    storageDownload: opts.storageDownload ?? false,
    maxPages: positiveInteger("max-pages", opts.maxPages, 50),
    firestorePageSize: positivePageSize("firestore-page-size", opts.firestorePageSize, 300),
    maxDocsPerCollection: positiveInteger("max-docs-per-collection", opts.maxDocsPerCollection, 0),
    storageMaxFiles: positiveInteger("storage-max-files", opts.storageMaxFiles, 0),
    retries,
    storageDownloadMaxBytes
  };
}
