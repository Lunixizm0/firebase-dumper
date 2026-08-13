import { afterEach, describe, expect, it, vi } from "vitest";
import { dumpRealtimeDB } from "../src/services/realtime-db.ts";
import { dumpSecurityRules } from "../src/services/security-rules.ts";
import { dumpFCM } from "../src/services/fcm.ts";
import { dumpAppCheck } from "../src/services/app-check.ts";
import { dumpRemoteConfig } from "../src/services/remote-config.ts";
import { dumpML } from "../src/services/ml.ts";
import { dumpProjectConfig } from "../src/services/project-config.ts";
import { dumpPublicBucket } from "../src/services/public-bucket.ts";
import { makeCtx, onlyServices } from "./helpers.ts";

const rtdbMocks = vi.hoisted(() => ({ once: vi.fn(), goOffline: vi.fn() }));

vi.mock("firebase-admin/database", () => ({
  getDatabaseWithUrl: () => ({ ref: () => ({ once: rtdbMocks.once }), goOffline: rtdbMocks.goOffline })
}));

const srMocks = vi.hoisted(() => ({
  listRulesetMetadata: vi.fn(),
  getRuleset: vi.fn(),
  getFirestoreRuleset: vi.fn(),
  getStorageRuleset: vi.fn()
}));

vi.mock("firebase-admin/security-rules", () => ({
  getSecurityRules: () => ({
    listRulesetMetadata: srMocks.listRulesetMetadata,
    getRuleset: srMocks.getRuleset,
    getFirestoreRuleset: srMocks.getFirestoreRuleset,
    getStorageRuleset: srMocks.getStorageRuleset
  })
}));

const fcmMocks = vi.hoisted(() => ({ send: vi.fn() }));

vi.mock("firebase-admin/messaging", () => ({
  getMessaging: () => ({ send: fcmMocks.send })
}));

vi.mock("firebase-admin/remote-config", () => ({
  getRemoteConfig: () => ({
    getTemplate: async () => ({
      parameters: { banner_enabled: { defaultValue: { value: "true" } } },
      parameterGroups: { g: { parameters: {} } },
      conditions: [],
      version: { versionNumber: "1" },
      etag: "etag1"
    })
  })
}));

vi.mock("firebase-admin/machine-learning", () => ({
  getMachineLearning: () => ({
    listModels: async () => ({
      models: [{ displayName: "model1", modelId: "m1", createTime: "2024-01-01T00:00:00Z" }]
    })
  })
}));

describe("dumpRealtimeDB", () => {
  afterEach(() => {
    rtdbMocks.once.mockReset();
    rtdbMocks.goOffline.mockReset();
  });

  it("skips when no --db-url is provided", async () => {
    const ctx = makeCtx({}, { enabledServices: onlyServices("realtimeDB") });

    await dumpRealtimeDB(ctx);

    expect(ctx.results.realtimeDatabase).toBeNull();
    expect(ctx.statuses.get("rtdb")?.status).toBe("skipped");
    expect(ctx.statuses.get("rtdb")?.detail).toMatch(/--db-url/);
  });

  it("dumps the root node when a db URL is provided", async () => {
    rtdbMocks.once.mockResolvedValue({ val: () => ({ hello: "world" }) });
    const ctx = makeCtx({}, { enabledServices: onlyServices("realtimeDB"), dbUrl: "https://x.firebaseio.com" });

    await dumpRealtimeDB(ctx);

    expect(ctx.results.realtimeDatabase).toEqual({ hello: "world" });
    expect(ctx.statuses.get("rtdb")?.status).toBe("ok");
  });

  it("skips when the database is not provisioned", async () => {
    rtdbMocks.once.mockRejectedValue(new Error("The specified database does not exist. 404 NOT_FOUND"));
    const ctx = makeCtx({}, { enabledServices: onlyServices("realtimeDB"), dbUrl: "https://x.firebaseio.com" });

    await dumpRealtimeDB(ctx);

    expect(ctx.statuses.get("rtdb")?.status).toBe("skipped");
    expect(ctx.results.skipped[0]?.reason).toMatch(/No Realtime Database/);
  });

  it("errors after a timeout instead of hanging when the database does not respond", async () => {
    rtdbMocks.once.mockReturnValue(new Promise(() => {}));
    const ctx = makeCtx({}, { enabledServices: onlyServices("realtimeDB"), dbUrl: "https://x.firebaseio.com" });

    vi.useFakeTimers();
    try {
      const promise = dumpRealtimeDB(ctx);
      await vi.advanceTimersByTimeAsync(31_000);
      await promise;
    } finally {
      vi.useRealTimers();
    }

    expect(ctx.statuses.get("rtdb")?.status).toBe("error");
    expect(ctx.results.errors[0]?.error).toMatch(/did not respond/);
    expect(rtdbMocks.goOffline).toHaveBeenCalled();
  });
});

describe("dumpSecurityRules", () => {
  afterEach(() => {
    for (const mock of [srMocks.listRulesetMetadata, srMocks.getRuleset, srMocks.getFirestoreRuleset, srMocks.getStorageRuleset]) {
      mock.mockReset();
    }
  });

  it("dumps rulesets and active releases", async () => {
    srMocks.listRulesetMetadata.mockResolvedValue({
      rulesets: [{ name: "projects/p/rulesets/1", createTime: "2024-01-01T00:00:00Z" }],
      nextPageToken: undefined
    });
    srMocks.getRuleset.mockResolvedValue({
      name: "projects/p/rulesets/1",
      source: [{ name: "firestore.rules", content: "rules_version = '2';" }],
      createTime: "2024-01-01T00:00:00Z"
    });
    srMocks.getFirestoreRuleset.mockResolvedValue({ name: "projects/p/rulesets/1", createTime: "2024-01-01T00:00:00Z" });
    srMocks.getStorageRuleset.mockRejectedValue(new Error("No Storage ruleset is currently deployed. 404 NOT_FOUND"));

    const ctx = makeCtx({}, { enabledServices: onlyServices("securityRules") });
    await dumpSecurityRules(ctx);

    expect(ctx.results.securityRules.rulesets).toHaveLength(1);
    expect(ctx.results.securityRules.rulesetMetadata).toHaveLength(1);
    expect(ctx.results.securityRules.releases.map((r) => r.service)).toEqual(["cloud.firestore"]);
    expect(ctx.statuses.get("securityRules")?.status).toBe("skipped");
    expect(ctx.statuses.get("securityRules")?.detail).toMatch(/No Storage ruleset/);
  });

  it("skips when no rulesets exist", async () => {
    srMocks.listRulesetMetadata.mockRejectedValue(new Error("Invalid ListRulesets response: no rulesets"));
    srMocks.getFirestoreRuleset.mockRejectedValue(new Error("NOT_FOUND"));
    srMocks.getStorageRuleset.mockRejectedValue(new Error("NOT_FOUND"));

    const ctx = makeCtx({}, { enabledServices: onlyServices("securityRules") });
    await dumpSecurityRules(ctx);

    expect(ctx.results.securityRules.rulesetMetadata).toEqual([]);
    expect(ctx.results.securityRules.rulesets).toEqual([]);
    expect(ctx.results.skipped.some((s) => /No rulesets exist/i.test(s.reason))).toBe(true);
  });

  it("skips the storage ruleset when no default bucket is configured", async () => {
    srMocks.listRulesetMetadata.mockResolvedValue({ rulesets: [], nextPageToken: undefined });
    srMocks.getFirestoreRuleset.mockRejectedValue(new Error("NOT_FOUND"));
    srMocks.getStorageRuleset.mockRejectedValue(
      new Error("Bucket name not specified or invalid. Specify a default bucket name via the storageBucket option.")
    );

    const ctx = makeCtx({}, { enabledServices: onlyServices("securityRules") });
    await dumpSecurityRules(ctx);

    expect(ctx.results.errors).toHaveLength(0);
    expect(ctx.statuses.get("securityRules")?.status).toBe("skipped");
    expect(ctx.statuses.get("securityRules")?.detail).toMatch(/No Storage ruleset/);
  });
});

describe("dumpFCM", () => {
  afterEach(() => fcmMocks.send.mockReset());

  it("marks the API reachable when the probe is rejected with a token error", async () => {
    fcmMocks.send.mockRejectedValue(new Error("messaging/registration-token-not-registered"));
    const ctx = makeCtx({}, { enabledServices: onlyServices("fcm") });

    await dumpFCM(ctx);

    expect(ctx.results.fcm.accessible).toBe(true);
    expect(ctx.results.fcm.note).toBe("API reachable credentials valid");
    expect(ctx.statuses.get("fcm")?.status).toBe("ok");
  });

  it("treats an invalid-argument probe rejection as a reachability proof", async () => {
    const err = new Error("The registration token is not a valid FCM registration token");
    (err as { code?: string }).code = "messaging/invalid-argument";
    fcmMocks.send.mockRejectedValue(err);
    const ctx = makeCtx({}, { enabledServices: onlyServices("fcm") });

    await dumpFCM(ctx);

    expect(ctx.results.fcm.accessible).toBe(true);
    expect(ctx.results.fcm.note).toBe("API reachable credentials valid");
    expect(ctx.statuses.get("fcm")?.status).toBe("ok");
  });

  it("skips when the API is disabled", async () => {
    fcmMocks.send.mockRejectedValue(
      new Error("Firebase Cloud Messaging API has not been used in project test-project before or it is disabled")
    );
    const ctx = makeCtx({}, { enabledServices: onlyServices("fcm") });

    await dumpFCM(ctx);

    expect(ctx.statuses.get("fcm")?.status).toBe("skipped");
    expect(ctx.results.skipped[0]?.reason).toMatch(/not enabled/i);
  });

  it("records an error for other probe failures", async () => {
    fcmMocks.send.mockRejectedValue(new Error("boom"));
    const ctx = makeCtx({}, { enabledServices: onlyServices("fcm") });

    await dumpFCM(ctx);

    expect(ctx.statuses.get("fcm")?.status).toBe("error");
    expect(ctx.results.errors[0]?.error).toBe("boom");
  });
});

describe("dumpAppCheck", () => {
  const credential = {
    getAccessToken: async () => ({ access_token: "tok", expires_in: 3600 })
  };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function appCheckCtx() {
    return makeCtx(
      { app: { options: { credential } } },
      { enabledServices: onlyServices("appCheck") }
    );
  }

  it("lists App Check apps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            apps: [
              { name: "projects/p/apps/1:abc", appId: "1:abc:web:x", displayName: "web", appCheckTokenTtl: "3600s" }
            ]
          }),
          { status: 200 }
        )
      )
    );
    const ctx = appCheckCtx();

    await dumpAppCheck(ctx);

    expect(ctx.results.appCheck?.available).toBe(true);
    expect(ctx.results.appCheck?.appCount).toBe(1);
    expect(ctx.results.appCheck?.apps?.[0]?.appId).toBe("1:abc:web:x");
    expect(ctx.statuses.get("appCheck")?.status).toBe("ok");
  });

  it("skips on permission denied", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Forbidden", { status: 403 })));
    const ctx = appCheckCtx();

    await dumpAppCheck(ctx);

    expect(ctx.statuses.get("appCheck")?.status).toBe("skipped");
    expect(ctx.results.skipped[0]?.reason).toMatch(/Permission denied/);
  });

  it("skips when no apps are configured", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Project not found", { status: 404 })));
    const ctx = appCheckCtx();

    await dumpAppCheck(ctx);

    expect(ctx.statuses.get("appCheck")?.status).toBe("skipped");
    expect(ctx.results.skipped[0]?.reason).toMatch(/No App Check apps/);
  });
});

describe("dumpRemoteConfig", () => {
  it("dumps the remote config template", async () => {
    const ctx = makeCtx({}, { enabledServices: onlyServices("remoteConfig") });

    await dumpRemoteConfig(ctx);

    const rc = ctx.results.remoteConfig as { parameters: Record<string, unknown>; etag: string };
    expect(rc.parameters.banner_enabled).toBeDefined();
    expect(rc.etag).toBe("etag1");
    expect(ctx.statuses.get("remoteConfig")?.status).toBe("ok");
  });
});

describe("dumpML", () => {
  it("dumps ML models", async () => {
    const ctx = makeCtx({}, { enabledServices: onlyServices("ml") });

    await dumpML(ctx);

    expect(ctx.results.ml).toHaveLength(1);
    expect(ctx.results.ml[0]?.modelId).toBe("m1");
    expect(ctx.statuses.get("ml")?.status).toBe("ok");
  });
});

describe("dumpProjectConfig", () => {
  it("dumps the project config", async () => {
    const auth = {
      projectConfigManager: () => ({
        getProjectConfig: async () => ({ id: "test-project", locationId: "us-central1", projectNumber: "123456" })
      })
    };
    const ctx = makeCtx({ auth }, { enabledServices: onlyServices("projectConfig") });

    await dumpProjectConfig(ctx);

    const cfg = ctx.results.projectConfig as { id: string };
    expect(cfg.id).toBe("test-project");
    expect(ctx.statuses.get("projectConfig")?.status).toBe("ok");
  });
});

describe("dumpPublicBucket", () => {
  const page1Xml =
    "<ListBucketResult>" +
    "<Name>proj.appspot.com</Name>" +
    "<IsTruncated>true</IsTruncated>" +
    "<NextContinuationToken>tok2</NextContinuationToken>" +
    "<Contents><Key>a.txt</Key><Size>10</Size><LastModified>2024-01-01</LastModified><ETag>\"abc\"</ETag></Contents>" +
    "</ListBucketResult>";
  const page2Xml =
    "<ListBucketResult>" +
    "<Name>proj.appspot.com</Name>" +
    "<IsTruncated>false</IsTruncated>" +
    "<Contents><Key>b.txt</Key><Size>20</Size><LastModified>2024-01-02</LastModified><ETag>\"def\"</ETag></Contents>" +
    "</ListBucketResult>";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function bucketCtx(overrides: Record<string, unknown> = {}) {
    return makeCtx({}, { enabledServices: onlyServices("storage"), retries: 0, ...overrides });
  }

  it("lists objects across pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        new Response(String(url).includes("continuation-token=tok2") ? page2Xml : page1Xml, { status: 200 })
      )
    );
    const ctx = bucketCtx();

    await dumpPublicBucket(ctx, "https://firebasestorage.googleapis.com/v0/b/proj.appspot.com/o");

    expect(ctx.results.storage.buckets[0]?.name).toBe("proj.appspot.com");
    const files = ctx.results.storage.files["proj.appspot.com"] as Array<{ key: string }>;
    expect(files.map((f) => f.key)).toEqual(["a.txt", "b.txt"]);
    expect(ctx.statuses.get("storage")?.status).toBe("ok");
  });

  it("stops paginating at the maxPages cap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(page1Xml, { status: 200 })));
    const ctx = bucketCtx({ maxPages: 1 });

    await dumpPublicBucket(ctx, "https://firebasestorage.googleapis.com/v0/b/proj.appspot.com/o");

    const files = ctx.results.storage.files["proj.appspot.com"] as unknown[];
    expect(files).toHaveLength(1);
    expect(ctx.statuses.get("storage")?.status).toBe("ok");
  });

  it("skips when the listing is not public", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<Error><Code>AccessDenied</Code></Error>", { status: 403 })));
    const ctx = bucketCtx();

    await dumpPublicBucket(ctx, "https://firebasestorage.googleapis.com/v0/b/proj.appspot.com/o");

    expect(ctx.statuses.get("storage")?.status).toBe("skipped");
    expect(ctx.results.skipped[0]?.reason).toMatch(/isnt public/i);
  });
});
