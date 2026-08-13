import { isApiDisabledError, toErrorMessage } from "../core/errors.ts";
import { logServiceError, markOk, skipService } from "../core/results.ts";
import type { ServiceContext } from "../types.ts";

export async function dumpFCM(ctx: ServiceContext): Promise<void> {
  const { config, logger, results } = ctx;
  if (!config.enabledServices.has("fcm")) return;

  logger.section("FCM");

  try {
    const { getMessaging } = await import("firebase-admin/messaging");
    const messaging = getMessaging(ctx.clients.app);

    let note: string;
    try {
      await messaging.send({ token: "firebase-dump-probe" }, true);
      note = "dry-run send succeeded";
    } catch (probeErr) {
      const err = probeErr as { code?: string };
      const code = err?.code ?? "";
      const msg = toErrorMessage(probeErr);
      if (
        /messaging\/invalid-argument/.test(code) ||
        /not a valid FCM registration token/i.test(msg) ||
        /INVALID_ARGUMENT|invalid-registration-token|registration-token-not-registered/i.test(msg)
      ) {
        note = "API reachable credentials valid";
      } else if (isApiDisabledError(probeErr)) {
        skipService(ctx, "fcm", "Firebase Cloud Messaging API is not enabled for this project");
        return;
      } else {
        throw probeErr;
      }
    }

    results.fcm = { accessible: true, note };
    logger.ok(`FCM: ${note}`);
    markOk(ctx, "fcm");
  } catch (e) {
    logServiceError(ctx, "fcm", e);
  }
}
