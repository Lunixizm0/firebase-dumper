import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Command } from "commander";
import { applyConfigFile } from "../src/cli/load-config.ts";
import { parseArgs } from "../src/cli/args.ts";
import { FatalError } from "../src/core/errors.ts";
import type { CliOptions } from "../src/types.ts";

function fakeProgram(source: "cli" | "default"): Command {
  return { getOptionValueSource: () => source } as unknown as Command;
}

function baseOptions(configPath: string): CliOptions {
  return {
    key: "./serviceAccountKey.json",
    out: "./firebase_dump",
    services: "all",
    quiet: false,
    config: configPath
  };
}

describe("applyConfigFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fd-config-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeConfig(data: unknown): string {
    const p = path.join(tmpDir, "dump.json");
    fs.writeFileSync(p, JSON.stringify(data));
    return p;
  }

  it("returns opts unchanged when no config is given", () => {
    const opts = { ...baseOptions(""), config: undefined };
    expect(applyConfigFile(opts, fakeProgram("default"))).toBe(opts);
  });

  it("applies config defaults for options not set on the CLI", () => {
    const configPath = writeConfig({ retries: 5, firestorePageSize: 500, dryRun: true });
    const merged = applyConfigFile(baseOptions(configPath), fakeProgram("default"));

    expect(merged.retries).toBe(5);
    expect(merged.firestorePageSize).toBe(500);
    expect(merged.dryRun).toBe(true);
  });

  it("maps snake_case and outputDir aliases", () => {
    const configPath = writeConfig({ outputDir: "./out2", db_url: "https://x.firebaseio.com" });
    const merged = applyConfigFile(baseOptions(configPath), fakeProgram("default"));

    expect(merged.out).toBe("./out2");
    expect(merged.dbUrl).toBe("https://x.firebaseio.com");
  });

  it("lets CLI flags win over config values", () => {
    const configPath = writeConfig({ retries: 5 });
    const opts = { ...baseOptions(configPath), retries: 9 };
    const merged = applyConfigFile(opts, fakeProgram("cli"));

    expect(merged.retries).toBe(9);
  });

  it("throws on unknown config keys", () => {
    const configPath = writeConfig({ bogus: 1 });
    expect(() => applyConfigFile(baseOptions(configPath), fakeProgram("default"))).toThrow(
      /Unknown config key: bogus/
    );
  });

  it("validates boolean, numeric and string values", () => {
    expect(() => applyConfigFile(baseOptions(writeConfig({ dryRun: "yes" })), fakeProgram("default"))).toThrow(
      FatalError
    );
    expect(() => applyConfigFile(baseOptions(writeConfig({ retries: "three" })), fakeProgram("default"))).toThrow(
      /must be an integer/
    );
    expect(() => applyConfigFile(baseOptions(writeConfig({ services: 5 })), fakeProgram("default"))).toThrow(
      /must be a string/
    );
  });

  it("throws when the config file cannot be read or parsed", () => {
    expect(() => applyConfigFile(baseOptions(path.join(tmpDir, "missing.json")), fakeProgram("default"))).toThrow(
      /Failed to read config file/
    );
    fs.writeFileSync(path.join(tmpDir, "bad.json"), "{ not json");
    expect(() => applyConfigFile(baseOptions(path.join(tmpDir, "bad.json")), fakeProgram("default"))).toThrow(
      /Failed to read config file/
    );
  });
});

describe("parseArgs", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fd-args-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function run(...flags: string[]): CliOptions {
    return parseArgs([process.execPath, "test", ...flags]);
  }

  it("parses the new flags", () => {
    const opts = run(
      "-n",
      "-a",
      "--storage-download",
      "--retries",
      "5",
      "--max-pages",
      "10",
      "--firestore-page-size",
      "100",
      "--max-docs-per-collection",
      "200",
      "--storage-max-files",
      "300",
      "--storage-download-max",
      "20"
    );

    expect(opts.dryRun).toBe(true);
    expect(opts.archive).toBe(true);
    expect(opts.storageDownload).toBe(true);
    expect(opts.retries).toBe(5);
    expect(opts.maxPages).toBe(10);
    expect(opts.firestorePageSize).toBe(100);
    expect(opts.maxDocsPerCollection).toBe(200);
    expect(opts.storageMaxFiles).toBe(300);
    expect(opts.storageDownloadMaxMb).toBe(20);
  });

  it("returns NaN for non-numeric flag values", () => {
    expect(run("--retries", "abc").retries).toBeNaN();
  });

  it("defaults services to all", () => {
    expect(run("-k", "./key.json").services).toBe("all");
  });

  it("applies a config file when provided", () => {
    const configPath = path.join(tmpDir, "dump.json");
    fs.writeFileSync(configPath, JSON.stringify({ retries: 7 }));
    const opts = run("-c", configPath, "-k", "./key.json");
    expect(opts.retries).toBe(7);
  });
});
