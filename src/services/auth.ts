import { logServiceError, markOk } from "../core/results.ts";
import { withRetry } from "../core/retry.ts";
import type { DumpUser, MfaFactorInfo, ServiceContext } from "../types.ts";

export async function dumpAuth(ctx: ServiceContext): Promise<void> {
  const { config, logger, results } = ctx;
  if (!config.enabledServices.has("auth")) return;

  logger.section("Auth");
  logger.log("Starting dump...");

  try {
    const auth = ctx.clients.auth;
    const users = [];
    let nextPageToken: string | undefined;
    let page = 0;

    do {
      page++;
      const list = await withRetry(() => auth.listUsers(1000, nextPageToken), {
        retries: config.retries
      });
      users.push(...list.users);
      nextPageToken = list.pageToken || undefined;
      logger.log(`  Page ${page}: ${list.users.length} users`);
    } while (nextPageToken);

    results.auth.users = users.map((u): DumpUser => ({
      uid: u.uid,
      email: u.email ?? undefined,
      emailVerified: u.emailVerified,
      displayName: u.displayName ?? undefined,
      phoneNumber: u.phoneNumber ?? undefined,
      photoURL: u.photoURL ?? undefined,
      disabled: u.disabled,
      metadata: {
        creationTime: u.metadata?.creationTime ?? undefined,
        lastSignInTime: u.metadata?.lastSignInTime ?? undefined,
        lastRefreshTime: u.metadata?.lastRefreshTime ?? undefined
      },
      providerData: u.providerData,
      customClaims: u.customClaims as Record<string, unknown> | undefined,
      tokensValidAfterTime: u.tokensValidAfterTime ?? undefined,
      tenantId: u.tenantId ?? undefined,
      multiFactor: u.multiFactor?.enrolledFactors?.map((f): MfaFactorInfo => ({
        uid: f.uid,
        displayName: f.displayName ?? "",
        enrollmentTime: f.enrollmentTime ?? "",
        factorId: f.factorId,
        phoneNumber: (f as { phoneNumber?: string }).phoneNumber ?? ""
      }))
    }));

    results.auth.stats = {
      totalUsers: users.length,
      verifiedEmails: users.filter((u) => u.emailVerified).length,
      disabledUsers: users.filter((u) => u.disabled).length,
      withPhone: users.filter((u) => u.phoneNumber).length,
      withPhoto: users.filter((u) => u.photoURL).length,
      withCustomClaims: users.filter((u) => u.customClaims).length,
      withMFA: users.filter((u) => u.multiFactor?.enrolledFactors && u.multiFactor.enrolledFactors.length > 0).length
    };

    for (const u of users) {
      if (u.customClaims) {
        results.customClaims[u.uid] = u.customClaims as Record<string, unknown>;
      }
    }

    logger.log(` Total users: ${users.length}`);
    markOk(ctx, "auth");
  } catch (e) {
    logServiceError(ctx, "auth", e);
  }
}
