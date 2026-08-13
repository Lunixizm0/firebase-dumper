import { isNotFoundError, toErrorMessage } from "../core/errors.ts";
import { logErrorWithMessage, logServiceError, markOk, skipService } from "../core/results.ts";
import type { SecurityRules } from "firebase-admin/security-rules";
import type { ServiceContext } from "../types.ts";

interface RulesetMeta {
  name: string;
  createTime: string;
}

async function listRulesetMetadata(
  ctx: ServiceContext,
  securityRules: SecurityRules
): Promise<RulesetMeta[]> {
  const metadata: RulesetMeta[] = [];
  let pageToken: string | undefined;
  try {
    do {
      const page = await securityRules.listRulesetMetadata(100, pageToken);
      metadata.push(...(page.rulesets || []));
      pageToken = page.nextPageToken;
    } while (pageToken);
  } catch (e) {
    if (/Invalid ListRulesets response/i.test(toErrorMessage(e))) {
      skipService(ctx, "securityRules", "No rulesets exist in this project yet");
      return [];
    }
    throw e;
  }
  return metadata;
}

async function fetchRulesets(ctx: ServiceContext, securityRules: SecurityRules, metadata: RulesetMeta[]): Promise<void> {
  for (const meta of metadata) {
    try {
      const ruleset = await securityRules.getRuleset(meta.name);
      ctx.results.securityRules.rulesets.push({
        name: ruleset.name,
        source: ruleset.source?.map((f) => ({ name: f.name, content: f.content })),
        createTime: ruleset.createTime
      });
    } catch (inner) {
      logErrorWithMessage(ctx, `securityRules.ruleset(${meta.name})`, toErrorMessage(inner));
    }
  }
}

async function fetchActiveRuleset(
  ctx: ServiceContext,
  securityRules: SecurityRules,
  service: string,
  getter: () => Promise<{ name: string; createTime: string }>,
  noRulesetReason: string
): Promise<void> {
  try {
    const ruleset = await getter();
    ctx.results.securityRules.releases.push({
      service,
      rulesetName: ruleset.name,
      createTime: ruleset.createTime
    });
  } catch (inner) {
    if (isNotFoundError(inner) || /bucket name not specified or invalid/i.test(toErrorMessage(inner))) {
      skipService(ctx, "securityRules", noRulesetReason);
    } else {
      logErrorWithMessage(ctx, `securityRules.get${service === "cloud.firestore" ? "Firestore" : "Storage"}Ruleset`, toErrorMessage(inner));
    }
  }
}

export async function dumpSecurityRules(ctx: ServiceContext): Promise<void> {
  const { config, logger, results, statuses } = ctx;
  if (!config.enabledServices.has("securityRules")) return;

  logger.section("Security Rules");
  logger.log("Starting dump...");

  try {
    const { getSecurityRules } = await import("firebase-admin/security-rules");
    const securityRules = getSecurityRules(ctx.clients.app);

    const allMetadata = await listRulesetMetadata(ctx, securityRules);
    results.securityRules.rulesetMetadata = allMetadata.map((m) => ({
      name: m.name,
      createTime: m.createTime
    }));

    await fetchRulesets(ctx, securityRules, allMetadata);

    await fetchActiveRuleset(
      ctx,
      securityRules,
      "cloud.firestore",
      () => securityRules.getFirestoreRuleset(),
      "No Firestore ruleset is currently deployed"
    );
    await fetchActiveRuleset(
      ctx,
      securityRules,
      "firebase.storage",
      () => securityRules.getStorageRuleset(),
      "No Storage ruleset is currently deployed"
    );

    logger.log(
      `  ${allMetadata.length} rulesets, ${results.securityRules.releases.length} active releases`
    );
    if (!statuses.has("securityRules")) {
      markOk(ctx, "securityRules");
    }
  } catch (e) {
    logServiceError(ctx, "securityRules", e);
  }
}
