import { Command } from "commander";
import { VERSION } from "../version.ts";
import { applyConfigFile } from "./load-config.ts";
import type { CliOptions } from "../types.ts";

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

export function parseArgs(argv: string[]): CliOptions {
  const program = new Command();

  program
    .name("firebase-dump")
    .description("Dump Firebase project data via Admin SDK")
    .version(VERSION)
    .option("-k, --key <path>", "Path to service account JSON key", "./serviceAccountKey.json")
    .option("-o, --out <dir>", "Output directory for dumped files", "./firebase_dump")
    .option("-u, --db-url <url>", "Realtime Database URL (optional)")
    .option("-b, --bucket <name>", "Storage bucket name, or a public bucket URL")
    .option("-s, --services <list>", "Comma separated services to dump (default: all)", "all")
    .option("-q, --quiet", "Suppress non error output", false)
    .option("-c, --config <path>", "JSON config file providing defaults (CLI flags win)")
    .option("-n, --dry-run", "Validate configuration and show the plan without contacting Firebase", false)
    .option("-a, --archive", "Also write a gzipped tar archive next to the output directory", false)
    .option("--storage-download", "Download storage file contents into <out>/storage_files", false)
    .option("--max-pages <n>", "Maximum pagination pages for public bucket listing (default: 50)", numeric)
    .option("--firestore-page-size <n>", "Documents per Firestore page (default: 300)", numeric)
    .option("--max-docs-per-collection <n>", "Cap documents per Firestore collection, 0 = unlimited (default: 0)", numeric)
    .option("--storage-max-files <n>", "Cap storage files listed, 0 = unlimited (default: 0)", numeric)
    .option("--retries <n>", "Retry count for transient failures, 0 = disabled (default: 3)", numeric)
    .option("--storage-download-max <mb>", "Max megabytes per downloaded storage file (default: 50)", numeric)
    .parse(argv);

  const raw = program.opts();
  const opts = raw as CliOptions;
  if (raw.storageDownloadMax !== undefined) {
    (raw as Record<string, unknown>).storageDownloadMaxMb = raw.storageDownloadMax;
  }
  return applyConfigFile(opts, program);
}
