import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BLOCKED_ROOTS, ensureOutputDir, isSafePath, validateKeyFile } from "../src/core/path-safety.ts";
import { FatalError } from "../src/core/errors.ts";

function workdir(): string {
  return fs.mkdtempSync(path.join(process.cwd(), ".test-tmp-"));
}

describe("isSafePath", () => {
  it("accepts normal relative and absolute paths", () => {
    expect(isSafePath("./firebase_dump")).toBe(true);
    expect(isSafePath("dumps/2024")).toBe(true);
    expect(isSafePath(path.join(process.cwd(), "dumps"))).toBe(true);
  });

  it("rejects path traversal sequences", () => {
    expect(isSafePath("../etc")).toBe(false);
    expect(isSafePath("foo/../../etc")).toBe(false);
    expect(isSafePath("..")).toBe(false);
    expect(isSafePath("../../..")).toBe(false);
  });

  it("rejects control characters and shell metacharacters", () => {
    expect(isSafePath("dump\x00name")).toBe(false);
    expect(isSafePath("dump|ls")).toBe(false);
    expect(isSafePath("dump;rm -rf")).toBe(false);
    expect(isSafePath("dump&x")).toBe(false);
    expect(isSafePath("dump$(x)")).toBe(false);
    expect(isSafePath("dump`x`")).toBe(false);
  });

  it("rejects the filesystem root", () => {
    expect(isSafePath("/")).toBe(false);
  });

  it("rejects blocked sensitive roots", () => {
    for (const root of BLOCKED_ROOTS) {
      expect(isSafePath(root)).toBe(false);
      expect(isSafePath(path.join(root, "anything"))).toBe(false);
    }
  });

  it("rejects the world-writable /tmp root", () => {
    expect(isSafePath("/tmp")).toBe(false);
  });
});

describe("validateKeyFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = workdir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when the key file does not exist", () => {
    expect(() => validateKeyFile(path.join(tmpDir, "missing.json"))).toThrow(FatalError);
  });

  it("throws when the path is not a file", () => {
    expect(() => validateKeyFile(tmpDir)).toThrow(FatalError);
  });

  it("accepts a valid key file", () => {
    const keyPath = path.join(tmpDir, "key.json");
    fs.writeFileSync(keyPath, "{}", { mode: 0o600 });
    expect(() => validateKeyFile(keyPath)).not.toThrow();
  });

  it("prints a permission warning when world readable", () => {
    const keyPath = path.join(tmpDir, "key.json");
    fs.writeFileSync(keyPath, "{}", { mode: 0o644 });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    validateKeyFile(keyPath);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe("ensureOutputDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = workdir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates the directory recursively", () => {
    const target = path.join(tmpDir, "a", "b", "c");
    ensureOutputDir(target);
    expect(fs.existsSync(target)).toBe(true);
    expect(fs.statSync(target).isDirectory()).toBe(true);
  });

  it("succeeds when the directory already exists", () => {
    ensureOutputDir(tmpDir);
    expect(fs.existsSync(tmpDir)).toBe(true);
  });

  it("throws when the path exists but is not a directory", () => {
    const filePath = path.join(tmpDir, "file.txt");
    fs.writeFileSync(filePath, "x");
    expect(() => ensureOutputDir(filePath)).toThrow(FatalError);
  });
});
