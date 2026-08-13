import { paint } from "./logger.ts";
import type { DumpResult, Logger, ServiceStatus } from "../types.ts";

export interface SummaryOptions {
  logger: Logger;
  results: DumpResult;
  statuses: Map<string, ServiceStatus>;
  durationMs: number;
  outputDir: string;
}

export function printSummary(opts: SummaryOptions): void {
  const { logger, results, statuses, durationMs, outputDir } = opts;
  const duration = (durationMs / 1000).toFixed(2);

  const okCount = [...statuses.values()].filter((s) => s.status === "ok").length;
  const skipCount = results.skipped.length;
  const errCount = results.errors.length;

  logger.raw(`\n${paint("1", "Summary")}`);
  const rows = [...statuses.entries()].sort(([a], [b]) => a.localeCompare(b));
  const nameWidth = Math.max(...rows.map(([name]) => name.length), 8);

  for (const [name, info] of rows) {
    const label = name.padEnd(nameWidth);
    const timing =
      info.elapsedMs !== undefined
        ? `  ${paint("2", "(" + (info.elapsedMs / 1000).toFixed(1) + "s)")}`
        : "";
    if (info.status === "ok") {
      logger.raw(`  ${paint("32", "+")} ${label}  ${paint("2", "ok")}${timing}`);
    } else if (info.status === "skipped") {
      logger.raw(`  ${paint("33", "*")} ${label}  ${paint("2", info.detail ?? "skipped")}${timing}`);
    } else {
      logger.raw(`  ${paint("31", "-")} ${label}  ${paint("31", info.detail ?? "error")}${timing}`);
    }
  }

  logger.raw("");
  logger.raw(`Duration : ${duration}s`);
  logger.raw(`Output   : ${outputDir}`);
  logger.raw(`${paint("32", "OK")}: ${okCount}   ${paint("33", "Skipped")}: ${skipCount}   ${paint("31", "Errors")}: ${errCount}`);
}
