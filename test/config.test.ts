import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../src/config/config.ts";
import { FatalError } from "../src/core/errors.ts";
import type { CliOptions } from "../src/types.ts";

const FIXTURE_KEY = {
  type: "service_account",
  project_id: "test-project",
  private_key_id: "pkid123",
  client_email: "test@test-project.iam.gserviceaccount.com",
  client_id: "12345",
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token",
  auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
  client_x509_cert_url: "https://www.googleapis.com/robot/v1/metadata/x509/test%40test-project.iam.gserviceaccount.com",
  universe_domain: "googleapis.com",
  private_key: "-----BEGIN PRIVATE KEY-----\nMOCK\n-----END PRIVATE KEY-----\n"
};

describe("resolveConfig", () => {
  let tmpDir: string;
  let keyPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(process.cwd(), ".test-tmp-"));
    keyPath = path.join(tmpDir, "serviceAccountKey.json");
    fs.writeFileSync(keyPath, JSON.stringify(FIXTURE_KEY), { mode: 0o600 });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function baseOptions(): CliOptions {
    return {
      key: keyPath,
      out: path.join(tmpDir, "out"),
      services: "all",
      quiet: false
    };
  }

  it("resolves a valid configuration", () => {
    const config = resolveConfig(baseOptions());
    expect(config.projectId).toBe("test-project");
    expect(config.clientEmail).toBe("test@test-project.iam.gserviceaccount.com");
    expect(config.outputDir).toBe(path.resolve(path.join(tmpDir, "out")));
    expect(config.enabledServices.has("firestore")).toBe(true);
    expect(config.dbUrl).toBeNull();
    expect(config.bucketOverride).toBeNull();
    expect(fs.existsSync(config.outputDir)).toBe(true);
  });

  it("throws when the key file is missing", () => {
    expect(() => resolveConfig({ ...baseOptions(), key: path.join(tmpDir, "nope.json") })).toThrow(FatalError);
  });

  it("throws when the key is missing required fields", () => {
    const badKey = path.join(tmpDir, "bad.json");
    fs.writeFileSync(badKey, JSON.stringify({ project_id: "x" }));
    expect(() => resolveConfig({ ...baseOptions(), key: badKey })).toThrow(/missing required field/);
  });

  it("throws on an unsafe output directory", () => {
    expect(() => resolveConfig({ ...baseOptions(), out: "/etc" })).toThrow(FatalError);
    expect(() => resolveConfig({ ...baseOptions(), out: "/root/x" })).toThrow(FatalError);
    expect(() => resolveConfig({ ...baseOptions(), out: "/" })).toThrow(FatalError);
  });

  it("rejects an invalid RTDB URL", () => {
    expect(() => resolveConfig({ ...baseOptions(), dbUrl: "not-a-url" })).toThrow(FatalError);
    expect(() => resolveConfig({ ...baseOptions(), dbUrl: "https://example.com" })).toThrow(/must be a Firebase RTDB URL/);
  });

  it("accepts a valid RTDB URL", () => {
    const config = resolveConfig({ ...baseOptions(), dbUrl: "https://test-project-default-rtdb.firebaseio.com" });
    expect(config.dbUrl).toBe("https://test-project-default-rtdb.firebaseio.com");
  });

  it("rejects an unsafe bucket value", () => {
    expect(() => resolveConfig({ ...baseOptions(), bucket: "../../evil" })).toThrow(FatalError);
  });

  it("accepts a public bucket URL without path checks", () => {
    const config = resolveConfig({ ...baseOptions(), bucket: "https://witeapp.s3.amazonaws.com/" });
    expect(config.bucketOverride).toBe("https://witeapp.s3.amazonaws.com/");
  });

  it("parses the services list", () => {
    const config = resolveConfig({ ...baseOptions(), services: "firestore,rtdb" });
    expect([...config.enabledServices]).toEqual(["firestore", "realtimeDB"]);
  });

  it("throws on unknown services", () => {
    expect(() => resolveConfig({ ...baseOptions(), services: "nope" })).toThrow(/Unknown service/);
  });
});
