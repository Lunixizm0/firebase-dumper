import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dumpStorage } from "../src/services/storage.ts";
import { makeCtx, onlyServices } from "./helpers.ts";

function makeFile(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    metadata: { size: 5, contentType: "text/plain" },
    ...overrides
  };
}

function makeBucket(name: string, pages: Array<[unknown[], unknown]>, overrides: Record<string, unknown> = {}) {
  let pageIndex = 0;
  return {
    name,
    async getMetadata() {
      return [{ id: `${name}-id`, timeCreated: "2024-01-01T00:00:00Z", location: "US" }];
    },
    async getFiles(_opts: unknown) {
      if (pageIndex >= pages.length) return [[], null];
      const [files, token] = pages[pageIndex] as [unknown[], unknown];
      pageIndex++;
      return [files, token ? { pageToken: token } : null];
    },
    ...overrides
  };
}

describe("dumpStorage", () => {
  let tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
    tmpDirs = [];
  });

  function makeTmpDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fd-storage-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("tries candidate buckets and uses the first accessible one", async () => {
    const good = makeBucket("test-project.appspot.com", [[[makeFile("a.txt")], undefined]]);
    const storage = {
      bucket: vi.fn((name: string) => {
        if (name === "test-project.firebasestorage.app") throw new Error("403 Forbidden");
        return good;
      })
    };
    const ctx = makeCtx({ storage }, { enabledServices: onlyServices("storage") });

    await dumpStorage(ctx);

    expect(storage.bucket).toHaveBeenCalledWith("test-project.firebasestorage.app");
    expect(storage.bucket).toHaveBeenCalledWith("test-project.appspot.com");
    expect(ctx.results.storage.buckets[0]?.name).toBe("test-project.appspot.com");
    expect(ctx.statuses.get("storage")?.status).toBe("ok");
  });

  it("records an error when no bucket is accessible", async () => {
    const storage = {
      bucket: vi.fn(() => {
        throw new Error("403 Forbidden");
      })
    };
    const ctx = makeCtx({ storage }, { enabledServices: onlyServices("storage") });

    await dumpStorage(ctx);

    expect(ctx.statuses.get("storage")?.status).toBe("error");
    expect(ctx.results.errors[0]?.error).toMatch(/No accessible bucket found/);
  });

  it("skips when no storage bucket is provisioned", async () => {
    const storage = {
      bucket: vi.fn(() => ({
        name: "missing-bucket",
        async getMetadata() {
          throw new Error("The specified bucket does not exist.");
        }
      }))
    };
    const ctx = makeCtx({ storage }, { enabledServices: onlyServices("storage") });

    await dumpStorage(ctx);

    expect(ctx.statuses.get("storage")?.status).toBe("skipped");
    expect(ctx.results.skipped[0]?.reason).toMatch(/No Storage bucket is provisioned/);
  });

  it("lists files with pagination", async () => {
    const bucket = makeBucket("test-project.firebasestorage.app", [
      [[makeFile("f1.txt"), makeFile("f2.txt")], "tok2"],
      [[makeFile("f3.txt")], undefined]
    ]);
    const ctx = makeCtx(
      { storage: { bucket: vi.fn(() => bucket) } },
      { enabledServices: onlyServices("storage") }
    );

    await dumpStorage(ctx);

    const files = ctx.results.storage.files["test-project.firebasestorage.app"] as Array<{ name: string }>;
    expect(files.map((f) => f.name)).toEqual(["f1.txt", "f2.txt", "f3.txt"]);
    expect(ctx.results.storage.buckets[0]?.id).toBe("test-project.firebasestorage.app-id");
  });

  it("stops paginating when the storageMaxFiles cap is reached", async () => {
    const bucket = makeBucket("test-project.firebasestorage.app", [
      [[makeFile("f1.txt")], "tok2"],
      [[makeFile("f2.txt")], "tok3"],
      [[makeFile("f3.txt")], undefined]
    ]);
    const getFiles = vi.spyOn(bucket, "getFiles");
    const ctx = makeCtx(
      { storage: { bucket: vi.fn(() => bucket) } },
      { enabledServices: onlyServices("storage"), storageMaxFiles: 2 }
    );

    await dumpStorage(ctx);

    expect(getFiles).toHaveBeenCalledTimes(2);
    const files = ctx.results.storage.files["test-project.firebasestorage.app"] as Array<{ name: string }>;
    expect(files.map((f) => f.name)).toEqual(["f1.txt", "f2.txt"]);
  });

  it("downloads storage files into <out>/storage_files/<bucket>", async () => {
    const outDir = makeTmpDir();
    const file = makeFile("sub/file.txt", {
      metadata: { size: 5, contentType: "text/plain" },
      createReadStream: () => Readable.from(["hello"])
    });
    const bucket = makeBucket("test-project.firebasestorage.app", [[[file], undefined]]);
    const ctx = makeCtx(
      { storage: { bucket: vi.fn(() => bucket) } },
      { enabledServices: onlyServices("storage"), storageDownload: true, outputDir: outDir }
    );

    await dumpStorage(ctx);

    const dest = path.join(outDir, "storage_files", "test-project.firebasestorage.app", "sub", "file.txt");
    expect(fs.readFileSync(dest, "utf8")).toBe("hello");
    expect(ctx.statuses.get("storage")?.status).toBe("ok");
  });

  it("skips folder markers and oversized files during download", async () => {
    const outDir = makeTmpDir();
    const files = [
      makeFile("dir/", { metadata: { size: 0 } }),
      makeFile("big.bin", { metadata: { size: 60 * 1024 * 1024 } }),
      makeFile("ok.txt", { metadata: { size: 3 }, createReadStream: () => Readable.from(["abc"]) })
    ];
    const bucket = makeBucket("test-project.firebasestorage.app", [[files, undefined]]);
    const ctx = makeCtx(
      { storage: { bucket: vi.fn(() => bucket) } },
      {
        enabledServices: onlyServices("storage"),
        storageDownload: true,
        storageDownloadMaxBytes: 50 * 1024 * 1024,
        outputDir: outDir
      }
    );

    await dumpStorage(ctx);

    const base = path.join(outDir, "storage_files", "test-project.firebasestorage.app");
    expect(fs.readFileSync(path.join(base, "ok.txt"), "utf8")).toBe("abc");
    expect(fs.existsSync(path.join(base, "dir"))).toBe(false);
    expect(fs.existsSync(path.join(base, "big.bin"))).toBe(false);
  });
});
