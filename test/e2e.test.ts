import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VERSION } from "../src/version.ts";

const binPath = fileURLToPath(new URL("../src/bin/firebase-dump.ts", import.meta.url));

function runCli(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(process.execPath, [binPath, ...args], { encoding: "utf8", timeout: 30000 });
  return { status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

describe("firebase-dump CLI (e2e)", () => {
  let tmpDir: string;
  let keyFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fd-e2e-"));
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

  it("--version prints the version", () => {
    const res = runCli("--version");
    expect(res.status).toBe(0);
    expect(res.stdout.trim()).toBe(VERSION);
  });

  it("--help prints usage including new options", () => {
    const res = runCli("--help");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Usage:");
    expect(res.stdout).toContain("--dry-run");
    expect(res.stdout).toContain("--archive");
    expect(res.stdout).toContain("--storage-download");
  });

  it("rejects unknown services", () => {
    const res = runCli("-k", keyFile, "-s", "bogus");
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("Unknown service");
  });

  it("fails when the key file is missing", () => {
    const res = runCli("-k", path.join(tmpDir, "missing.json"));
    expect(res.status).toBe(1);
    expect(res.stderr).toContain("ERROR");
  });

  it("rejects unsafe output directories", () => {
    const res = runCli("-k", keyFile, "-o", "/tmp/e2e-unsafe", "-s", "serviceAccount");
    expect(res.status).toBe(1);
    expect(res.stderr.toLowerCase()).toContain("unsafe");
  });

  it("dry-run exits 0 without contacting Firebase", () => {
    const res = runCli("-k", keyFile, "-s", "all", "-n");
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Dry run");
    expect(res.stdout).toContain("Retries:");
  });
});
