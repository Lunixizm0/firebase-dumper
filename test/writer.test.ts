import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createJsonWriter, MAX_DUMP_DEPTH, readTextLimited, sanitizeForWrite } from "../src/core/writer.ts";
import { createLogger } from "../src/core/logger.ts";

describe("sanitizeForWrite", () => {
  it("normalizes null and undefined to null", () => {
    expect(sanitizeForWrite(null)).toBeNull();
    expect(sanitizeForWrite(undefined)).toBeNull();
  });

  it("passes through primitives", () => {
    expect(sanitizeForWrite("text")).toBe("text");
    expect(sanitizeForWrite(true)).toBe(true);
    expect(sanitizeForWrite(42)).toBe(42);
  });

  it("normalizes non-finite numbers to null", () => {
    expect(sanitizeForWrite(NaN)).toBeNull();
    expect(sanitizeForWrite(Infinity)).toBeNull();
    expect(sanitizeForWrite(-Infinity)).toBeNull();
  });

  it("serializes Date objects to ISO strings", () => {
    expect(sanitizeForWrite(new Date("2024-01-01T00:00:00.000Z"))).toBe("2024-01-01T00:00:00.000Z");
  });

  it("serializes Firestore Timestamp-like values to ISO strings", () => {
    const ts = { toMillis: () => 0, toDate: () => new Date("2024-01-01T00:00:00.000Z") };
    expect(sanitizeForWrite(ts)).toBe("2024-01-01T00:00:00.000Z");
  });

  it("serializes Firestore GeoPoint-like values", () => {
    const geo = { _latitude: 41.0082, _longitude: 28.9784 };
    expect(sanitizeForWrite(geo)).toEqual({ latitude: 41.0082, longitude: 28.9784 });
  });

  it("serializes Firestore DocumentReference-like values to their path", () => {
    const ref = { path: "users/abc", firestore: {} };
    expect(sanitizeForWrite(ref)).toEqual({ path: "users/abc" });
  });

  it("throws on circular references", () => {
    const input: Record<string, unknown> = { name: "x" };
    input.self = input;
    expect(() => sanitizeForWrite(input)).toThrow(/circular/);
  });

  it("throws on BigInt, functions and symbols", () => {
    expect(() => sanitizeForWrite(10n)).toThrow(/BigInt/);
    expect(() => sanitizeForWrite(() => 1)).toThrow(/unsupported/);
    expect(() => sanitizeForWrite(Symbol("x"))).toThrow(/unsupported/);
  });

  it("recursively sanitizes arrays and objects", () => {
    const input = { a: [1, "two", true, null], b: { c: 3 } };
    expect(sanitizeForWrite(input)).toEqual(input);
  });

  it("respects toJSON", () => {
    const input = { when: { toJSON: () => "2024-01-01" } };
    expect(sanitizeForWrite(input)).toEqual({ when: "2024-01-01" });
  });

  it("blocks prototype pollution via __proto__ keys", () => {
    const result = sanitizeForWrite({ __proto__: { polluted: true } }) as object;
    expect((result as { polluted?: unknown }).polluted).toBeUndefined();
  });

  it("throws when nesting depth is exceeded", () => {
    let deep: unknown = {};
    for (let i = 0; i <= MAX_DUMP_DEPTH + 1; i++) {
      deep = { next: deep };
    }
    expect(() => sanitizeForWrite(deep)).toThrow(/nesting depth/);
  });
});

describe("createJsonWriter", () => {
  let tmpDir: string;
  const logger = createLogger(true);
  const errors: string[] = [];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "firebase-dump-test-"));
    errors.length = 0;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a JSON file with restrictive permissions", () => {
    const save = createJsonWriter(tmpDir, logger, (msg) => errors.push(msg));
    save("sample", { hello: "world" });

    const filePath = path.join(tmpDir, "sample.json");
    expect(fs.existsSync(filePath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual({ hello: "world" });
    if (process.platform !== "win32") {
      const mode = fs.statSync(filePath).mode & 0o777;
      expect(mode).toBe(0o600);
    }
    expect(errors).toHaveLength(0);
  });

  it("does not leave temp files behind", () => {
    const save = createJsonWriter(tmpDir, logger, (msg) => errors.push(msg));
    save("sample", { a: 1 });
    const leftovers = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".tmp"));
    expect(leftovers).toHaveLength(0);
  });

  it("records an error and writes nothing when serialization fails", () => {
    const save = createJsonWriter(tmpDir, logger, (msg) => errors.push(msg));
    const circular: Record<string, unknown> = { n: 1 };
    circular.self = circular;
    save("bad", circular);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/circular/);
    expect(fs.existsSync(path.join(tmpDir, "bad.json"))).toBe(false);
  });
});

describe("readTextLimited", () => {
  it("returns the body text", async () => {
    const resp = new Response("hello world");
    expect(await readTextLimited(resp, 100)).toBe("hello world");
  });

  it("throws when content-length exceeds the limit", async () => {
    const resp = new Response("x".repeat(20), { headers: { "content-length": "20" } });
    await expect(readTextLimited(resp, 10)).rejects.toThrow(/too large/);
  });

  it("throws while streaming when the byte limit is exceeded", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("a".repeat(11)));
        controller.close();
      }
    });
    const resp = new Response(stream);
    await expect(readTextLimited(resp, 10)).rejects.toThrow(/exceeds 10 byte limit/);
  });
});
