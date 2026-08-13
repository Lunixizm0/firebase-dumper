import { describe, expect, it, vi } from "vitest";
import { isRetryableError, withRetry } from "../src/core/retry.ts";

describe("isRetryableError", () => {
  it("matches transient gRPC/HTTP codes and network errors", () => {
    expect(isRetryableError(new Error("RESOURCE_EXHAUSTED"))).toBe(true);
    expect(isRetryableError(new Error("UNAVAILABLE"))).toBe(true);
    expect(isRetryableError(new Error("DEADLINE_EXCEEDED"))).toBe(true);
    expect(isRetryableError(new Error("INTERNAL"))).toBe(true);
    expect(isRetryableError(new Error("ABORTED"))).toBe(true);
    expect(isRetryableError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRetryableError(new Error("HTTP 500 Internal Server Error"))).toBe(true);
    expect(isRetryableError(new Error("ETIMEDOUT"))).toBe(true);
    expect(isRetryableError(new Error("ECONNRESET"))).toBe(true);
    expect(isRetryableError(new Error("fetch failed"))).toBe(true);
  });

  it("rejects non-transient errors", () => {
    expect(isRetryableError(new Error("PERMISSION_DENIED"))).toBe(false);
    expect(isRetryableError(new Error("NOT_FOUND"))).toBe(false);
    expect(isRetryableError(new Error("Invalid argument"))).toBe(false);
    expect(isRetryableError("plain string")).toBe(false);
  });
});

describe("withRetry", () => {
  it("returns the result without retrying on success", async () => {
    const fn = vi.fn(async () => 42);
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).resolves.toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures until success", async () => {
    let calls = 0;
    const fn = vi.fn(async () => {
      calls++;
      if (calls < 3) throw new Error("UNAVAILABLE");
      return "ok";
    });
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).resolves.toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after exhausting the retry budget", async () => {
    const fn = vi.fn(async () => {
      throw new Error("UNAVAILABLE");
    });
    await expect(withRetry(fn, { retries: 2, baseDelayMs: 1 })).rejects.toThrow("UNAVAILABLE");
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("does not retry non-retryable errors", async () => {
    const fn = vi.fn(async () => {
      throw new Error("PERMISSION_DENIED");
    });
    await expect(withRetry(fn, { retries: 3, baseDelayMs: 1 })).rejects.toThrow("PERMISSION_DENIED");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("does not retry when retries is 0", async () => {
    const fn = vi.fn(async () => {
      throw new Error("UNAVAILABLE");
    });
    await expect(withRetry(fn, { retries: 0, baseDelayMs: 1 })).rejects.toThrow("UNAVAILABLE");
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
