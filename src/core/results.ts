import { toErrorMessage } from "./errors.ts";
import type { DumpResult, ServiceContext, ServiceStatus, ServiceStatusState } from "../types.ts";

export function createResults(projectId: string, clientEmail: string): DumpResult {
  return {
    _metadata: {
      projectId,
      clientEmail,
      dumpedAt: new Date().toISOString(),
      note: "dump"
    },
    firestore: {
      collections: {},
      subcollections_recursive: {},
      stats: {
        totalRootCollections: 0,
        totalDocuments: 0,
        totalSubcollections: 0
      }
    },
    realtimeDatabase: null,
    auth: {
      users: [],
      stats: {
        totalUsers: 0,
        verifiedEmails: 0,
        disabledUsers: 0,
        withPhone: 0,
        withPhoto: 0,
        withCustomClaims: 0,
        withMFA: 0
      }
    },
    storage: {
      buckets: [],
      files: {}
    },
    projectConfig: null,
    securityRules: {
      releases: [],
      rulesetMetadata: [],
      rulesets: []
    },
    appCheck: null,
    fcm: { accessible: false },
    remoteConfig: null,
    ml: [],
    customClaims: {},
    errors: [],
    skipped: []
  };
}

export function setServiceStatus(ctx: ServiceContext, service: string, status: ServiceStatusState, detail?: string): void {
  const entry: ServiceStatus = { status };
  if (detail !== undefined) entry.detail = detail;
  ctx.statuses.set(service, entry);
}

export function markOk(ctx: ServiceContext, service: string): void {
  setServiceStatus(ctx, service, "ok");
}

export function skipService(ctx: ServiceContext, service: string, reason: string): void {
  ctx.results.skipped.push({ service, reason });
  setServiceStatus(ctx, service, "skipped", reason);
  ctx.logger.warn(`${service}: ${reason}`);
}

export function logServiceError(ctx: ServiceContext, service: string, err: unknown): void {
  const msg = toErrorMessage(err);
  ctx.results.errors.push({ service, error: msg });
  setServiceStatus(ctx, service, "error", msg);
  ctx.logger.error(`[${service}] Error: ${msg}`);
}

export function logErrorWithMessage(ctx: ServiceContext, service: string, msg: string): void {
  ctx.results.errors.push({ service, error: msg });
  setServiceStatus(ctx, service, "error", msg);
  ctx.logger.error(`[${service}] Error: ${msg}`);
}
