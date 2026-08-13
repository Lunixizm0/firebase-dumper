import fs from "node:fs";
import type { Command } from "commander";
import { FatalError } from "../core/errors.ts";
import type { CliOptions } from "../types.ts";

type OptionSource = "cli" | "default" | "env" | "config" | "option";

const KEY_TO_OPTION: Readonly<Record<string, string>> = {
  key: "key",
  out: "out",
  outputDir: "out",
  dbUrl: "dbUrl",
  db_url: "dbUrl",
  bucket: "bucket",
  services: "services",
  quiet: "quiet",
  dryRun: "dryRun",
  archive: "archive",
  storageDownload: "storageDownload",
  maxPages: "maxPages",
  firestorePageSize: "firestorePageSize",
  maxDocsPerCollection: "maxDocsPerCollection",
  storageMaxFiles: "storageMaxFiles",
  retries: "retries",
  storageDownloadMaxMb: "storageDownloadMaxMb"
};

const BOOLEAN_OPTIONS: ReadonlySet<string> = new Set([
  "quiet",
  "dryRun",
  "archive",
  "storageDownload"
]);

const NUMERIC_OPTIONS: ReadonlySet<string> = new Set([
  "maxPages",
  "firestorePageSize",
  "maxDocsPerCollection",
  "storageMaxFiles",
  "retries",
  "storageDownloadMaxMb"
]);

function validateConfigValue(key: string, option: string, value: unknown): void {
  if (BOOLEAN_OPTIONS.has(option)) {
    if (typeof value !== "boolean") {
      throw new FatalError(`ERR: Config key "${key}" must be a boolean`);
    }
    return;
  }
  if (NUMERIC_OPTIONS.has(option)) {
    if (typeof value !== "number" || !Number.isInteger(value)) {
      throw new FatalError(`ERR: Config key "${key}" must be an integer`);
    }
    return;
  }
  if (typeof value !== "string") {
    throw new FatalError(`ERR: Config key "${key}" must be a string`);
  }
}

export function applyConfigFile(opts: CliOptions, program: Command): CliOptions {
  if (!opts.config) return opts;

  let raw: Record<string, unknown>;
  try {
    const content = fs.readFileSync(opts.config, "utf8");
    raw = JSON.parse(content) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new FatalError(`ERR: Failed to read config file ${opts.config}: ${msg}`);
  }

  const merged = { ...opts };
  for (const [key, value] of Object.entries(raw)) {
    const option = KEY_TO_OPTION[key];
    if (!option) {
      throw new FatalError(`ERR: Unknown config key: ${key}`);
    }
    const source = program.getOptionValueSource(option) as OptionSource | undefined;
    if (source === "cli") continue;
    validateConfigValue(key, option, value);
    (merged as unknown as Record<string, unknown>)[option] = value;
  }

  return merged;
}
