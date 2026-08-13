import { describe, expect, it, vi } from "vitest";
import {
  createResults,
  logServiceError,
  markOk,
  setServiceStatus,
  skipService
} from "../src/core/results.ts";
import { printSummary } from "../src/core/summary.ts";
import { makeCtx } from "./helpers.ts";

describe("results helpers", () => {
  it("createResults returns an empty skeleton", () => {
    const r = createResults("proj", "e@example.com");
    expect(r._metadata.projectId).toBe("proj");
    expect(r._metadata.clientEmail).toBe("e@example.com");
    expect(r.firestore.stats).toEqual({
      totalRootCollections: 0,
      totalDocuments: 0,
      totalSubcollections: 0
    });
    expect(r.auth.users).toEqual([]);
    expect(r.auth.stats.totalUsers).toBe(0);
    expect(r.storage.buckets).toEqual([]);
    expect(r.securityRules.releases).toEqual([]);
    expect(r.fcm.accessible).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.skipped).toEqual([]);
  });

  it("markOk / skipService / logServiceError record statuses and collections", () => {
    const ctx = makeCtx({});

    markOk(ctx, "auth");
    skipService(ctx, "rtdb", "no --db-url");
    logServiceError(ctx, "ml", new Error("boom"));

    expect(ctx.statuses.get("auth")).toEqual({ status: "ok" });
    expect(ctx.statuses.get("rtdb")).toEqual({ status: "skipped", detail: "no --db-url" });
    expect(ctx.results.skipped).toEqual([{ service: "rtdb", reason: "no --db-url" }]);
    expect(ctx.results.errors).toEqual([{ service: "ml", error: "boom" }]);
    expect(ctx.statuses.get("ml")?.status).toBe("error");
    expect(ctx.statuses.get("ml")?.detail).toBe("boom");
  });

  it("setServiceStatus stores an elapsed time when provided", () => {
    const ctx = makeCtx({});
    setServiceStatus(ctx, "auth", "ok");
    ctx.statuses.get("auth")!.elapsedMs = 1234;
    expect(ctx.statuses.get("auth")?.elapsedMs).toBe(1234);
  });
});

describe("printSummary", () => {
  it("renders statuses with timings and counts", () => {
    const ctx = makeCtx({});
    markOk(ctx, "auth");
    skipService(ctx, "rtdb", "no --db-url");
    logServiceError(ctx, "ml", new Error("boom"));
    ctx.statuses.get("auth")!.elapsedMs = 1500;

    printSummary({
      logger: ctx.logger,
      results: ctx.results,
      statuses: ctx.statuses,
      durationMs: 1200,
      outputDir: "/out"
    });

    const lines = (ctx.logger.raw as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
    const stripAnsi = (s: string): string => s.replace(/\u001b\[[0-9;]*m/g, "");
    const output = lines.map(stripAnsi).join("\n");
    expect(output).toContain("Summary");
    expect(output).toContain("OK: 1");
    expect(output).toContain("Skipped: 1");
    expect(output).toContain("Errors: 1");
    expect(output).toContain("Duration : 1.20s");
    expect(output).toContain("Output   : /out");
    expect(output).toContain("(1.5s)");
    expect(output).toContain("no --db-url");
  });
});
