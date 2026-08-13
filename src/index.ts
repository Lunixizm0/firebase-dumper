import { performance } from "node:perf_hooks";
import { parseArgs } from "./cli/args.ts";
import { resolveConfig } from "./config/config.ts";
import { FatalError, toErrorMessage } from "./core/errors.ts";
import { initFirebase } from "./core/firebase.ts";
import { createLogger } from "./core/logger.ts";
import { createResults } from "./core/results.ts";
import { printSummary } from "./core/summary.ts";
import { createJsonWriter } from "./core/writer.ts";
import { createArchive } from "./core/archive.ts";
import { SERVICES } from "./services/index.ts";
import type { ResolvedConfig, ServiceContext, ServiceDefinition, ServiceStatus } from "./types.ts";

export interface RunOptions {
  services?: readonly ServiceDefinition[];
}

function printDryRunPlan(config: ResolvedConfig, logger: ReturnType<typeof createLogger>): void {
  const storageTarget = config.bucketOverride
    ? config.bucketOverride
    : `${config.projectId}.firebasestorage.app / ${config.projectId}.appspot.com (candidates)`;
  logger.section("Dry run");
  logger.log("  No requests will be sent to Firebase.");
  logger.log(`  Services enabled: ${[...config.enabledServices].join(", ")}`);
  logger.log(`  Realtime DB: ${config.dbUrl ? "will dump " + config.dbUrl : "skipped (no --db-url)"}`);
  logger.log(`  Storage bucket: ${storageTarget}`);
  logger.log(`  Output dir: ${config.outputDir}`);
  logger.log(`  Archive: ${config.archive ? "yes" : "no"}`);
  logger.log(`  Storage download: ${config.storageDownload ? "yes" : "no"}`);
  logger.log(`  Retries: ${config.retries}`);
}

export async function run(argv: string[] = process.argv, opts: RunOptions = {}): Promise<void> {
  const start = Date.now();
  const services = opts.services ?? SERVICES;
  const cliOpts = parseArgs(argv);
  const config = resolveConfig(cliOpts);
  const logger = createLogger(config.quiet);

  logger.log(`Project ID: ${config.projectId}`);
  logger.log(`Client Email: ${config.clientEmail}`);
  logger.log(`Output Dir: ${config.outputDir}`);
  logger.log(`Services: ${[...config.enabledServices].join(", ")}`);

  const results = createResults(config.projectId, config.clientEmail);
  const statuses: Map<string, ServiceStatus> = new Map();

  if (config.dryRun) {
    printDryRunPlan(config, logger);
    return;
  }

  let clients: Awaited<ReturnType<typeof initFirebase>>;
  try {
    clients = await initFirebase(config.serviceAccount, config.dbUrl);
    logger.log("Firebase app initialized");
  } catch (e) {
    throw new FatalError(`Firebase app initialization failed: ${toErrorMessage(e)}`);
  }

  const ctx: ServiceContext = {
    config,
    results,
    statuses,
    logger,
    clients,
    serviceAccount: config.serviceAccount
  };

  for (const def of services) {
    const t0 = performance.now();
    await def.dumper(ctx);
    const elapsedMs = performance.now() - t0;
    const status = statuses.get(def.name);
    if (status) status.elapsedMs = elapsedMs;
  }

  const save = createJsonWriter(config.outputDir, logger, (msg) => {
    results.errors.push({ service: "filesystem", error: msg });
  });

  save("firebase_full_dump", results);
  save("firestore_dump", results.firestore);
  save("auth_users_dump", results.auth);
  save("storage_dump", results.storage);
  save("rtdb_dump", results.realtimeDatabase || {});
  save("custom_claims_dump", results.customClaims);
  save("project_config_dump", results.projectConfig || {});
  save("security_rules_dump", results.securityRules);
  save("remote_config_dump", results.remoteConfig || {});
  save("ml_models_dump", results.ml);
  save("service_account_info", results._serviceAccountInfo);

  if (config.archive) {
    try {
      await createArchive(config.outputDir, config.projectId, logger);
    } catch (e) {
      logger.error(`Failed to create archive: ${toErrorMessage(e)}`);
      results.errors.push({ service: "archive", error: toErrorMessage(e) });
    }
  }

  printSummary({
    logger,
    results,
    statuses,
    durationMs: Date.now() - start,
    outputDir: config.outputDir
  });
}
