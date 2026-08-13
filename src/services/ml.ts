import { isApiDisabledError } from "../core/errors.ts";
import { logServiceError, markOk, skipService } from "../core/results.ts";
import type { MlModelInfo, ServiceContext } from "../types.ts";

export async function dumpML(ctx: ServiceContext): Promise<void> {
  const { config, logger, results } = ctx;
  if (!config.enabledServices.has("ml")) return;

  logger.section("ML");
  logger.log("Starting dump...");

  try {
    const { getMachineLearning } = await import("firebase-admin/machine-learning");
    const ml = getMachineLearning(ctx.clients.app);
    const { models } = await ml.listModels();
    results.ml = models.map((m): MlModelInfo => ({
      displayName: m.displayName,
      modelId: m.modelId,
      createTime: m.createTime,
      updateTime: m.updateTime,
      validationError: m.validationError,
      published: m.published,
      etag: m.etag,
      modelHash: m.modelHash,
      tags: m.tags
    }));
    logger.log(`  ${models.length} ML models found`);
    markOk(ctx, "ml");
  } catch (e) {
    if (isApiDisabledError(e)) {
      skipService(ctx, "ml", "Firebase ML API is not enabled for this project.");
    } else {
      logServiceError(ctx, "ml", e);
    }
  }
}
