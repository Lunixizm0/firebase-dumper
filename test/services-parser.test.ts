import { describe, expect, it } from "vitest";
import { parseServices } from "../src/cli/parse.ts";
import { FatalError } from "../src/core/errors.ts";

describe("parseServices", () => {
  it("returns all services for 'all'", () => {
    const set = parseServices("all");
    expect(set.has("firestore")).toBe(true);
    expect(set.has("auth")).toBe(true);
    expect(set.has("ml")).toBe(true);
    expect(set.size).toBe(11);
  });

  it("parses a comma separated list", () => {
    const set = parseServices("firestore,auth,storage");
    expect([...set]).toEqual(["firestore", "auth", "storage"]);
  });

  it("trims whitespace and lowercases input", () => {
    const set = parseServices(" Firestore ,  Auth ");
    expect([...set]).toEqual(["firestore", "auth"]);
  });

  it("resolves aliases (deduplicated in a set)", () => {
    const set = parseServices("rtdb,realtime,db,rules,cloudstorage");
    expect([...set]).toEqual(["realtimeDB", "securityRules", "storage"]);
  });

  it("matches camelCase service names case-insensitively", () => {
    const set = parseServices("serviceaccount,appcheck,remoteconfig,REALTIMEDB");
    expect([...set]).toEqual(["serviceAccount", "appCheck", "remoteConfig", "realtimeDB"]);
  });

  it("throws on unknown service", () => {
    expect(() => parseServices("firestore,bogus")).toThrow(FatalError);
    expect(() => parseServices("firestore,bogus")).toThrow(/Unknown service: bogus/);
  });

  it("throws on entirely unknown input", () => {
    expect(() => parseServices("bogus")).toThrow(FatalError);
  });
});
