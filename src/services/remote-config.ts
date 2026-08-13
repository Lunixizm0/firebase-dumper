import { logServiceError, markOk } from "../core/results.ts";
import type { ServiceContext } from "../types.ts";

export async function dumpRemoteConfig(ctx: ServiceContext): Promise<void> {
  const { config, logger, results } = ctx;
  if (!config.enabledServices.has("remoteConfig")) return;

  logger.section("Remote Config");
  logger.log("Starting dump...");

  try {
    const { getRemoteConfig } = await import("firebase-admin/remote-config");
    const rc = getRemoteConfig(ctx.clients.app);
    const template = await rc.getTemplate();
    results.remoteConfig = {
      parameters: template.parameters,
      parameterGroups: template.parameterGroups,
      conditions: template.conditions,
      version: template.version,
      etag: template.etag
    };

    logger.log("  Remote Config template fetched");
    markOk(ctx, "remoteConfig");
  } catch (e) {
    logServiceError(ctx, "remoteConfig", e);
  }
}
