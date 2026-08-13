import type { Credential } from "firebase-admin/app";
import { isApiDisabledError, isNotFoundError, toErrorMessage } from "../core/errors.ts";
import { logServiceError, markOk, skipService } from "../core/results.ts";
import { MAX_NETWORK_RESPONSE_BYTES, readTextLimited } from "../core/writer.ts";
import type { AppCheckResult, ServiceContext } from "../types.ts";

interface AppCheckApiResponse {
  apps?: Array<{
    name: string;
    appId: string;
    displayName: string;
    appCheckTokenTtl: string;
  }>;
}

export async function dumpAppCheck(ctx: ServiceContext): Promise<void> {
  const { config, logger, results } = ctx;
  if (!config.enabledServices.has("appCheck")) return;

  logger.section("App Check");

  try {
    const credential = ctx.clients.app.options.credential;
    if (!credential || typeof (credential as Credential).getAccessToken !== "function") {
      throw new Error("App Check probing requires a service-account credential");
    }

    const tokenResult = await (credential as Credential).getAccessToken();
    const accessToken = tokenResult.access_token;

    const url = `https://firebaseappcheck.googleapis.com/v1/projects/${config.projectId}/apps`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(15000)
    });
    const body = await readTextLimited(resp, MAX_NETWORK_RESPONSE_BYTES);

    if (resp.status === 401 || resp.status === 403) {
      skipService(
        ctx,
        "appCheck",
        "Permission denied — credential needs roles/firebase.sdkAdminServiceAgent or " +
          "firebaseappcheck.apps.list IAM permission"
      );
      return;
    }

    if (resp.status === 404 || isNotFoundError({ message: body })) {
      skipService(ctx, "appCheck", "No App Check apps configured for this project");
      return;
    }

    if (isApiDisabledError({ message: body })) {
      skipService(ctx, "appCheck", "Firebase App Check API is not enabled for this project");
      return;
    }

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
    }

    const data = JSON.parse(body) as AppCheckApiResponse;
    const apps = data.apps || [];
    const result: AppCheckResult = {
      available: true,
      appCount: apps.length,
      apps: apps.map((a) => ({
        name: a.name,
        appId: a.appId,
        displayName: a.displayName,
        tokenTtl: a.appCheckTokenTtl
      }))
    };
    results.appCheck = result;

    logger.ok(`App Check: ${apps.length} app(s) listed`);
    markOk(ctx, "appCheck");
  } catch (e) {
    results.appCheck = { available: false, error: toErrorMessage(e) };
    logServiceError(ctx, "appCheck", e);
  }
}
