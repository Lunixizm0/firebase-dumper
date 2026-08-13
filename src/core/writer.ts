import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { toErrorMessage } from "./errors.ts";
import type { Logger } from "../types.ts";

export const MAX_DUMP_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_DUMP_DEPTH = 64;
export const MAX_NETWORK_RESPONSE_BYTES = 10 * 1024 * 1024;

export async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxBytes) {
    throw new Error(`Response too large (${contentLength} bytes)`);
  }
  if (!response.body) return response.text();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        throw new Error(`Response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf8");
}

function sanitizeObject(value: object, depth: number, seen: WeakSet<object>): unknown {
  const obj = value as Record<string, unknown>;

  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new Error("Dump data contains a circular reference");
    }
    seen.add(value);
    try {
      return value.map((item) => sanitizeForWrite(item, depth + 1, seen));
    } finally {
      seen.delete(value);
    }
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof obj.toMillis === "function" && typeof obj.toDate === "function") {
    const timestamp = obj as { toDate: () => Date };
    const d = timestamp.toDate();
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  }

  if (typeof obj._latitude === "number" && typeof obj._longitude === "number") {
    return {
      latitude: obj._latitude as number,
      longitude: obj._longitude as number
    };
  }

  if (typeof obj.path === "string" && typeof obj.firestore !== "undefined") {
    return { path: obj.path as string };
  }

  if (typeof obj.toJSON === "function") {
    return sanitizeForWrite(obj.toJSON(), depth + 1, seen);
  }

  if (seen.has(value)) {
    throw new Error("Dump data contains a circular reference");
  }
  seen.add(value);
  try {
    const entries = Object.entries(value).map(([key, val]) => [
      key,
      sanitizeForWrite(val, depth + 1, seen)
    ]);
    return Object.fromEntries(entries);
  } finally {
    seen.delete(value);
  }
}

export function sanitizeForWrite(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > MAX_DUMP_DEPTH) {
    throw new Error(`Dump data exceeds maximum nesting depth (${MAX_DUMP_DEPTH})`);
  }
  if (value === null || value === undefined) return null;

  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      return Number.isFinite(value) ? value : null;
    case "bigint":
      throw new Error("Dump data contains a BigInt value");
    case "function":
    case "symbol":
      throw new Error(`Dump data contains an unsupported ${typeof value} value`);
    case "object":
      return sanitizeObject(value, depth, seen);
    default:
      throw new Error(`Dump data contains an unsupported value type: ${typeof value}`);
  }
}

export type SaveFailureHandler = (errorMessage: string) => void;

export function createJsonWriter(
  outputDir: string,
  logger: Logger,
  recordError: SaveFailureHandler
): (name: string, data: unknown) => void {
  return function save(name: string, data: unknown): void {
    const filePath = path.join(outputDir, `${name}.json`);
    const tmpPath = path.join(
      outputDir,
      `.${name}-${process.pid}-${randomBytes(4).toString("hex")}.json.tmp`
    );

    try {
      const serialized = JSON.stringify(sanitizeForWrite(data), null, 2);
      if (Buffer.byteLength(serialized, "utf8") > MAX_DUMP_FILE_BYTES) {
        throw new Error(
          `serialized output exceeds ${MAX_DUMP_FILE_BYTES} byte limit, refusing to write`
        );
      }
      fs.writeFileSync(tmpPath, serialized, { mode: 0o600, flag: "wx" });
      fs.renameSync(tmpPath, filePath);
      logger.log(`Saved: ${filePath}`);
    } catch (e) {
      try {
        if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
      } catch {
        // best effort cleanup of the temp file, nothing else we can do
      }
      const msg = toErrorMessage(e);
      logger.error(`Failed to write ${filePath}: ${msg}`);
      recordError(msg);
    }
  };
}
