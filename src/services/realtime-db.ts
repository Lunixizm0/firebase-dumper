import { isNotFoundError } from "../core/errors.ts";
import { logServiceError, markOk, skipService } from "../core/results.ts";
import type { Database } from "firebase-admin/database";
import type { ServiceContext } from "../types.ts";

const RTDB_TIMEOUT_MS = 30_000;

async function readRootWithTimeout(rtdb: Database, timeoutMs: number): Promise<unknown> {
  const readPromise = rtdb.ref("/").once("value").then((snap) => snap.val());
  let timer: NodeJS.Timeout | undefined;
  try {
    const value = await Promise.race([
      readPromise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(
              `Realtime Database did not respond within ${timeoutMs / 1000}s (check --db-url)`
            )
          );
        }, timeoutMs);
      })
    ]);
    return value;
  } finally {
    clearTimeout(timer);
    readPromise.catch(() => {});
    rtdb.goOffline();
  }
}

export async function dumpRealtimeDB(ctx: ServiceContext): Promise<void> {
  const { config, logger, results } = ctx;
  if (!config.enabledServices.has("realtimeDB")) return;

  logger.section("Realtime DB");
  logger.log("Starting dump...");

  if (!config.dbUrl) {
    skipService(ctx, "rtdb", "No --db-url provided, RTDB dump skipped.");
    return;
  }

  try {
    const { getDatabaseWithUrl } = await import("firebase-admin/database");
    const rtdb = getDatabaseWithUrl(config.dbUrl, ctx.clients.app);
    const value = await readRootWithTimeout(rtdb, RTDB_TIMEOUT_MS);
    results.realtimeDatabase = value;
    const size = JSON.stringify(results.realtimeDatabase || {}).length;
    logger.ok(`RTDB root dumped (~${size} bytes)`);
    markOk(ctx, "rtdb");
  } catch (e) {
    if (isNotFoundError(e)) {
      skipService(ctx, "rtdb", "No Realtime Database provisioned for this project.");
    } else {
      logServiceError(ctx, "rtdb", e);
    }
  }
}
