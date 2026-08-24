// The storage adapter is where a bug costs data rather than pixels. These run
// against a throwaway local store via TRADEGENIE_LOCAL_STORE, the same hook the
// capture eval harness uses, so they never touch a real journal.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const scratch = mkdtempSync(path.join(tmpdir(), "tradegenie-store-"));
process.env.TRADEGENIE_LOCAL_STORE = path.join(scratch, "store.json");
// Belt and braces: make sure no stray Firebase config sends these at a real DB.
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

const store = await import("@/lib/store");
const { collectionNames, createRecord, dehydrate, deleteWhere, getRecord, listRecords, storageStatus, updateRecord, upsertBy } =
  store;

after(() => rmSync(scratch, { recursive: true, force: true }));

const lesson = (text: string) => ({
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  lessonText: text,
  category: "PROCESS",
  sourceType: "MANUAL",
  linkedTradeId: null,
  linkedTranscriptId: null,
  isActive: true,
  isPinned: false,
}) as unknown as Parameters<typeof createRecord<"lessons">>[1];

describe("storageStatus", () => {
  it("reports local mode when no Firebase credentials are present", () => {
    assert.equal(storageStatus().mode, "local");
    assert.equal(storageStatus().durable, false);
  });

  it("refuses to guess on a partial Firebase config rather than silently falling back", () => {
    process.env.FIREBASE_PROJECT_ID = "some-project";
    try {
      const status = storageStatus();
      assert.equal(status.mode, "invalid", "a partial config must be invalid, never local");
      assert.throws(() => store.usesFirebase(), /partially configured/i);
    } finally {
      delete process.env.FIREBASE_PROJECT_ID;
    }
  });
});

describe("collectionNames", () => {
  it("is derived from the store shape, so a backup can never miss a collection", () => {
    // /api/export iterates this. A hardcoded list here had already gone stale.
    for (const required of ["trades", "assets", "assetNotes", "customOptions", "freeNotes"]) {
      assert.ok(collectionNames.includes(required as never), `${required} must be backed up`);
    }
  });
});

describe("CRUD round trips", () => {
  before(async () => {
    for (const existing of await listRecords("lessons")) {
      await deleteWhere("lessons", (record) => record.id === existing.id);
    }
  });

  it("creates and reads back", async () => {
    const created = await createRecord("lessons", lesson("size down after two losers"));
    const all = await listRecords("lessons");
    assert.equal(all.length, 1);
    assert.equal(all[0].id, created.id);
    assert.equal(all[0].lessonText, "size down after two losers");
  });

  it("reads its own write — the invalidation contract", async () => {
    // This is the property the request-scoped read cache must never break: a
    // write followed by a read inside the same action sees the new value.
    const created = await createRecord("lessons", lesson("original"));
    await updateRecord("lessons", created.id, { lessonText: "edited" } as never);
    const reread = await listRecords("lessons");
    const found = reread.find((record) => record.id === created.id);
    assert.equal(found?.lessonText, "edited", "a read after a write must not serve a stale cache");
    assert.equal((await getRecord("lessons", created.id))?.lessonText, "edited");
  });

  it("deletes by predicate and the deletion is visible immediately", async () => {
    const created = await createRecord("lessons", lesson("temporary"));
    await deleteWhere("lessons", (record) => record.id === created.id);
    const remaining = await listRecords("lessons");
    assert.equal(remaining.find((record) => record.id === created.id), undefined);
  });

  it("upsertBy creates once, then updates in place", async () => {
    const marker = "upsert-me";
    const first = await upsertBy("lessons", (r) => r.lessonText === marker, lesson(marker), {});
    const second = await upsertBy(
      "lessons",
      (r) => r.lessonText === marker,
      lesson(marker),
      { isPinned: true } as never,
    );
    assert.equal(second.id, first.id, "the second upsert must update, not duplicate");
    const matches = (await listRecords("lessons")).filter((r) => r.lessonText === marker);
    assert.equal(matches.length, 1);
    assert.equal(matches[0].isPinned, true);
  });

  it("round-trips Dates rather than leaving them as strings", async () => {
    const created = await createRecord("lessons", lesson("date check"));
    const reread = (await listRecords("lessons")).find((r) => r.id === created.id);
    assert.ok(reread!.createdAt instanceof Date, "createdAt must hydrate back to a Date");
    assert.equal(reread!.createdAt.toISOString(), "2026-01-01T00:00:00.000Z");
  });

  it("returns null for a missing record instead of throwing", async () => {
    assert.equal(await getRecord("lessons", "does-not-exist"), null);
  });
});

describe("request-scoped read cache — invalidation guard", () => {
  // React's cache() only memoizes inside a React request scope, so in a plain
  // node test listRecords never actually caches and a missing invalidateRead()
  // would pass every behavioural test above while breaking read-after-write in
  // production. The dedupe itself was verified by instrumenting fetchRecords
  // and counting reads through a real render (Today 18 -> 11, /inbox 13 -> 7).
  // What that leaves uncovered is a *new* write path forgetting to invalidate,
  // so this reads the source and insists every mutator does.
  const source = readFileSync(new URL("../../lib/store.ts", import.meta.url), "utf8");

  const bodyOf = (name: string) => {
    const start = source.indexOf(`export async function ${name}`);
    assert.notEqual(start, -1, `${name} should still exist in lib/store.ts`);
    const next = source.indexOf("\nexport ", start + 1);
    return source.slice(start, next === -1 ? undefined : next);
  };

  for (const mutator of ["createRecord", "updateRecord", "deleteWhere"]) {
    it(`${mutator} invalidates the cached collection after writing`, () => {
      const body = bodyOf(mutator);
      assert.ok(
        body.includes("invalidateRead("),
        `${mutator} writes but never calls invalidateRead() — a read after this write would serve stale data`,
      );
    });
  }

  it("listRecords caches the promise, not the resolved value", () => {
    // Caching the value would let concurrent callers inside one Promise.all
    // each start their own round trip before the first resolved.
    const body = bodyOf("listRecords");
    assert.ok(body.includes("readCache()"), "listRecords should consult the request cache");
    assert.ok(
      /pending\.set\([^)]*,\s*read\)/.test(body) || body.includes(".set(collection, read)"),
      "listRecords should store the in-flight promise",
    );
  });
});

// The bug this pins cost a production 500 (digest 516351032): a review saved on
// a trade older than `checklistSteps` sent `checklistSteps: undefined`, which
// Firestore rejects outright while the local JSON store silently drops it — so
// dev, the tests and the smoke run were all green and only the real database
// failed. The fix lives at the one boundary every write passes through.
describe("undefined never reaches the database", () => {
  it("drops undefined properties instead of writing them", () => {
    const doc = dehydrate({ kept: 1, missing: undefined, nested: { kept: "yes", missing: undefined } }) as Record<
      string,
      Record<string, unknown>
    >;
    assert.deepEqual(Object.keys(doc), ["kept", "nested"]);
    assert.deepEqual(Object.keys(doc.nested), ["kept"]);
  });

  it("keeps null, which is how a field is actually cleared", () => {
    const doc = dehydrate({ cleared: null, absent: undefined }) as Record<string, unknown>;
    assert.deepEqual(doc, { cleared: null });
  });

  it("still turns Dates into ISO strings on the way out", () => {
    const doc = dehydrate({ createdAt: new Date("2026-01-01T00:00:00Z") }) as Record<string, unknown>;
    assert.equal(doc.createdAt, "2026-01-01T00:00:00.000Z");
  });

  it("treats an undefined patch value as 'leave this field alone', not as a wipe", async () => {
    const created = await createRecord("lessons", { ...lesson("keep my category"), tags: ["process"] } as never);
    const patched = await updateRecord("lessons", created.id, {
      lessonText: "edited",
      tags: undefined,
      category: undefined,
    } as never);
    assert.equal(patched.lessonText, "edited");
    assert.deepEqual(patched.tags, ["process"]);
    assert.equal(patched.category, "PROCESS");
    const reread = await getRecord("lessons", created.id);
    assert.deepEqual(reread?.tags, ["process"]);
    assert.equal(reread?.category, "PROCESS");
  });
});
