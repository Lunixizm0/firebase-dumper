import { describe, expect, it } from "vitest";
import { dumpFirestore } from "../src/services/firestore.ts";
import { makeCtx, onlyServices } from "./helpers.ts";

interface FakeSnapshot {
  docs: FakeDoc[];
  empty: boolean;
}

interface FakeQuery {
  orderBy(): FakeQuery;
  limit(): FakeQuery;
  startAfter(): FakeQuery;
  get(): Promise<FakeSnapshot>;
}

interface FakeDoc {
  id: string;
  data(): Record<string, unknown>;
  createTime?: unknown;
  updateTime?: unknown;
  readTime?: unknown;
  ref: { listCollections(): Promise<FakeColRef[]> };
}

interface FakeColRef extends FakeQuery {
  id: string;
}

function makeDoc(id: string, data: Record<string, unknown>, subcolRefs: FakeColRef[] = []): FakeDoc {
  return {
    id,
    data: () => data,
    ref: { listCollections: async () => subcolRefs }
  };
}

function makeQuery(pages: FakeDoc[][], failWith?: Error): FakeQuery {
  let pageIndex = 0;
  const query: FakeQuery = {
    orderBy: () => query,
    limit: () => query,
    startAfter: () => query,
    async get() {
      if (failWith) throw failWith;
      const page = pageIndex < pages.length ? (pages[pageIndex] ?? []) : [];
      pageIndex++;
      return { docs: page, empty: page.length === 0 };
    }
  };
  return query;
}

function makeColRef(id: string, pages: FakeDoc[][], failWith?: Error): FakeColRef {
  return { id, ...makeQuery(pages, failWith) };
}

function collections(ctx: ReturnType<typeof makeCtx>): Record<string, Record<string, unknown>> {
  return ctx.results.firestore.collections as Record<string, Record<string, unknown>>;
}

function usersOf(ctx: ReturnType<typeof makeCtx>): Record<string, unknown> {
  return collections(ctx).users ?? {};
}

function ctxFor(colRefs: FakeColRef[], overrides: Record<string, unknown> = {}) {
  return makeCtx(
    { db: { listCollections: async () => colRefs } },
    { enabledServices: onlyServices("firestore"), ...overrides }
  );
}

describe("dumpFirestore", () => {
  it("dumps all documents from a single page", async () => {
    const col = makeColRef("users", [
      [makeDoc("u1", { name: "A" }), makeDoc("u2", { name: "B" })]
    ]);
    const ctx = ctxFor([col]);

    await dumpFirestore(ctx);

    expect(Object.keys(usersOf(ctx))).toEqual(["u1", "u2"]);
    expect((usersOf(ctx).u1 as { _data: unknown })._data).toEqual({ name: "A" });
    expect((usersOf(ctx).u1 as { _createTime: unknown })._createTime).toBeNull();
    expect(ctx.results.firestore.stats.totalRootCollections).toBe(1);
    expect(ctx.results.firestore.stats.totalDocuments).toBe(2);
    expect(ctx.statuses.get("firestore")?.status).toBe("ok");
  });

  it("paginates until an empty page", async () => {
    const col = makeColRef("users", [
      [makeDoc("a", { n: 1 }), makeDoc("b", { n: 2 })],
      [makeDoc("c", { n: 3 }), makeDoc("d", { n: 4 })],
      []
    ]);
    const ctx = ctxFor([col], { firestorePageSize: 2 });

    await dumpFirestore(ctx);

    expect(Object.keys(usersOf(ctx))).toEqual(["a", "b", "c", "d"]);
    expect(ctx.results.firestore.stats.totalDocuments).toBe(4);
  });

  it("respects the maxDocsPerCollection cap", async () => {
    const col = makeColRef("users", [
      [makeDoc("a", { n: 1 }), makeDoc("b", { n: 2 })],
      [makeDoc("c", { n: 3 }), makeDoc("d", { n: 4 })]
    ]);
    const ctx = ctxFor([col], { firestorePageSize: 2, maxDocsPerCollection: 3 });

    await dumpFirestore(ctx);

    expect(Object.keys(usersOf(ctx))).toEqual(["a", "b", "c"]);
    expect(ctx.results.firestore.stats.totalDocuments).toBe(3);
  });

  it("recursively dumps subcollections", async () => {
    const subCol = makeColRef("posts", [[makeDoc("p1", { title: "hi" })]]);
    const col = makeColRef("users", [[makeDoc("u1", { name: "A" }, [subCol])]]);
    const ctx = ctxFor([col]);

    await dumpFirestore(ctx);

    const sub = ctx.results.firestore.subcollections_recursive as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    expect(Object.keys(sub["users/u1"] ?? {})).toEqual(["posts"]);
    expect(Object.keys((sub["users/u1"] ?? {}).posts ?? {})).toEqual(["p1"]);
    expect(ctx.results.firestore.stats.totalSubcollections).toBe(1);
  });

  it("skips the service when the Firestore API is disabled", async () => {
    const col = makeColRef(
      "users",
      [],
      new Error("The Cloud Firestore API has not been used in project test-project before or it is disabled")
    );
    const ctx = ctxFor([col]);

    await dumpFirestore(ctx);

    expect(ctx.statuses.get("firestore")?.status).toBe("skipped");
    expect(ctx.results.skipped[0]?.reason).toMatch(/not enabled/i);
  });

  it("records an error when a page fetch fails", async () => {
    const col = makeColRef("users", [], new Error("UNAVAILABLE"));
    const ctx = ctxFor([col], { retries: 0 });

    await dumpFirestore(ctx);

    expect(ctx.statuses.get("firestore")?.status).toBe("error");
    expect(ctx.results.errors[0]?.service).toBe("firestore");
  });
});
