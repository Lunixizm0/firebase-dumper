import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { list as listTar } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createArchive } from "../src/core/archive.ts";
import { makeLogger } from "./helpers.ts";

describe("createArchive", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "fd-archive-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a gzipped tar containing the dump files", async () => {
    const outputDir = path.join(tmpDir, "dump");
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, "firebase_full_dump.json"), "{}");
    fs.writeFileSync(path.join(outputDir, "auth_users_dump.json"), "[]");

    const archivePath = await createArchive(outputDir, "test-project", makeLogger());

    expect(fs.existsSync(archivePath)).toBe(true);
    const bytes = fs.readFileSync(archivePath);
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);

    const entries: string[] = [];
    await listTar({ file: archivePath, onReadEntry: (entry) => entries.push(entry.path) });
    expect(entries).toContain("./firebase_full_dump.json");
    expect(entries).toContain("./auth_users_dump.json");
  });
});
