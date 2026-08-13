import { describe, expect, it, vi } from "vitest";
import { createLogger, paint } from "../src/core/logger.ts";

describe("createLogger", () => {
  it("prints nothing when quiet", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger(true);
    logger.section("S");
    logger.log("line");
    logger.ok("fine");
    logger.warn("careful");
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("prints normal output when not quiet", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const logger = createLogger(false);
    logger.section("S");
    logger.ok("fine");
    logger.warn("careful");
    expect(logSpy).toHaveBeenCalledTimes(3);
    logSpy.mockRestore();
  });

  it("always prints errors even in quiet mode", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger(true);
    logger.error("boom");
    expect(errSpy).toHaveBeenCalled();
    errSpy.mockRestore();
  });
});

describe("paint", () => {
  it("adds ANSI codes when color is enabled", () => {
    const before = process.env.NO_COLOR;
    delete process.env.NO_COLOR;
    try {
      expect(paint("32", "ok")).toBe("\x1b[32mok\x1b[0m");
    } finally {
      if (before !== undefined) process.env.NO_COLOR = before;
      else delete process.env.NO_COLOR;
    }
  });

  it("returns plain text when NO_COLOR is set", () => {
    const before = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    try {
      expect(paint("32", "ok")).toBe("ok");
    } finally {
      if (before !== undefined) process.env.NO_COLOR = before;
      else delete process.env.NO_COLOR;
    }
  });
});
