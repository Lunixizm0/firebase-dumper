import { describe, expect, it, vi } from "vitest";
import { dumpAuth } from "../src/services/auth.ts";
import { makeCtx, onlyServices } from "./helpers.ts";

function makeUser(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    uid,
    email: `${uid}@example.com`,
    emailVerified: true,
    displayName: uid.toUpperCase(),
    phoneNumber: null,
    photoURL: null,
    disabled: false,
    metadata: {
      creationTime: "2024-01-01T00:00:00Z",
      lastSignInTime: "2024-01-01T00:00:00Z",
      lastRefreshTime: "2024-01-01T00:00:00Z"
    },
    providerData: [],
    customClaims: undefined,
    tokensValidAfterTime: null,
    tenantId: null,
    multiFactor: { enrolledFactors: [] },
    ...overrides
  };
}

describe("dumpAuth", () => {
  it("dumps users across pages with stats and custom claims", async () => {
    const listUsers = vi.fn(async (_limit: number, token: string | undefined) => {
      if (!token) {
        return {
          users: [
            makeUser("u1", { customClaims: { admin: true } }),
            makeUser("u2", { phoneNumber: "+10000000000", emailVerified: false })
          ],
          pageToken: "page2"
        };
      }
      return { users: [makeUser("u3")], pageToken: undefined };
    });
    const ctx = makeCtx({ auth: { listUsers } }, { enabledServices: onlyServices("auth") });

    await dumpAuth(ctx);

    expect(listUsers).toHaveBeenCalledTimes(2);
    expect(ctx.results.auth.users).toHaveLength(3);
    expect(ctx.results.auth.users[0]?.uid).toBe("u1");
    expect(ctx.results.auth.stats.totalUsers).toBe(3);
    expect(ctx.results.auth.stats.verifiedEmails).toBe(2);
    expect(ctx.results.auth.stats.disabledUsers).toBe(0);
    expect(ctx.results.auth.stats.withPhone).toBe(1);
    expect(ctx.results.auth.stats.withCustomClaims).toBe(1);
    expect(ctx.results.customClaims).toEqual({ u1: { admin: true } });
    expect(ctx.statuses.get("auth")?.status).toBe("ok");
  });

  it("records an error when listing fails", async () => {
    const listUsers = vi.fn(async () => {
      throw new Error("UNAVAILABLE");
    });
    const ctx = makeCtx(
      { auth: { listUsers } },
      { enabledServices: onlyServices("auth"), retries: 0 }
    );

    await dumpAuth(ctx);

    expect(ctx.statuses.get("auth")?.status).toBe("error");
    expect(ctx.results.errors[0]?.error).toBe("UNAVAILABLE");
  });
});
