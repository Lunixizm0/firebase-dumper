import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../src/index.ts";
import { markOk } from "../src/core/results.ts";
import type { ServiceDefinition } from "../src/types.ts";

vi.mock("../src/core/firebase.ts", () => ({
  initFirebase: vi.fn(async () => ({ app: {}, db: {}, auth: {}, storage: {} }))
}));

describe("run orchestrator", () => {
  let tmpDir: string;
  let keyFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-tmp-"));
    keyFile = path.join(tmpDir, "key.json");
    fs.writeFileSync(
      keyFile,
      JSON.stringify({
        type: "service_account",
        project_id: "test-project",
        client_email: "test@test-project.iam.gserviceaccount.com",
        private_key: "-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----\n"
      })
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("runs injected services and writes dump files", async () => {
    const stub: ServiceDefinition = {
      name: "firestore",
      dumper: async (ctx) => {
        ctx.results.firestore.stats.totalDocuments = 7;
        markOk(ctx, "firestore");
      }
    };
    const outDir = path.join(tmpDir, "out");
    fs.mkdirSync(outDir, { recursive: true });

    await run(
      [process.execPath, "test", "-k", keyFile, "-o", outDir, "-s", "firestore"],
      { services: [stub] }
    );

    expect(fs.existsSync(path.join(outDir, "firebase_full_dump.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "firestore_dump.json"))).toBe(true);
    expect(fs.existsSync(path.join(outDir, "service_account_info.json"))).toBe(true);

    const full = JSON.parse(fs.readFileSync(path.join(outDir, "firebase_full_dump.json"), "utf8"));
    expect(full.firestore.stats.totalDocuments).toBe(7);
    expect(full._metadata.projectId).toBe("test-project");
  });

  it("dry-run prints a plan and creates no output directory", async () => {
    const outDir = path.join(tmpDir, "dry-out");

    await run([process.execPath, "test", "-k", keyFile, "-o", outDir, "-s", "firestore", "-n"]);

    expect(fs.existsSync(outDir)).toBe(false);
  });

  it("throws a FatalError when initialization fails", async () => {
    const { initFirebase } = await import("../src/core/firebase.ts");
    (initFirebase as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Failed to parse private key"));

    await expect(
      run([process.execPath, "test", "-k", keyFile, "-o", path.join(tmpDir, "o2")], { services: [] })
    ).rejects.toThrow(/Firebase app initialization failed/);
  });
});
