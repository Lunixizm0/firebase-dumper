import { logServiceError, markOk } from "../core/results.ts";
import type { ServiceContext } from "../types.ts";

export async function dumpProjectConfig(ctx: ServiceContext): Promise<void> {
  const { config, logger, results } = ctx;
  if (!config.enabledServices.has("projectConfig")) return;

  logger.section("Project Config");
  logger.log("Starting dump...");

  try {
    results.projectConfig = await ctx.clients.auth.projectConfigManager().getProjectConfig();
    logger.log("  Project config read");
    markOk(ctx, "projectConfig");
  } catch (e) {
    logServiceError(ctx, "projectConfig", e);
  }
}
