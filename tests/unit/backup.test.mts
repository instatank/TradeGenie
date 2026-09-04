// The only test in this repo whose subject is "can we get the data back".
//
// Everything else about a backup is easy to get superficially right — a file
// downloads, a cron returns 200 — and none of that proves the one thing that
// matters. So the central assertion here is a full round trip against a real
// store: snapshot it, wipe it to nothing, restore from the file, and demand the
// result be byte-identical to what was there before. That is the claim the
// whole feature makes, stated as something that can fail.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const scratch = mkdtempSync(path.join(tmpdir(), "tradegenie-backup-"));
process.env.TRADEGENIE_LOCAL_STORE = path.join(scratch, "store.json");
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;
delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

const {
  BACKUP_FORMAT_VERSION,
  BackupFormatError,
  buildSnapshot,
  parseSnapshot,
  restoreSnapshot,
} = await import("@/lib/backup");
const { collectionNames, createRecord, deleteWhere, listRecords } = await import("@/lib/store");

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

const trade = (instrument: string) => ({
  createdAt: new Date("2026-02-03T09:30:00Z"),
  updatedAt: new Date("2026-02-03T09:30:00Z"),
  tradeDateTime: new Date("2026-02-03T09:30:00Z"),
  instrument,
  direction: "LONG",
  status: "CLOSED",
  entryPrice: 100,
  exitPrice: 110,
  realizedPnl: 250,
  entryThesis: "swept lows then displaced #fvg",
  tags: ["fvg"],
}) as unknown as Parameters<typeof createRecord<"trades">>[1];

async function wipeEverything() {
  for (const collection of collectionNames) {
    await deleteWhere(collection, () => true);
  }
}

async function snapshotOfStore() {
  const state: Record<string, unknown[]> = {};
  for (const collection of collectionNames) {
    state[collection] = [...(await listRecords(collection))].sort((a, b) =>
      String((a as { id: string }).id).localeCompare(String((b as { id: string }).id)),
    );
  }
  return JSON.stringify(state);
}

describe("backup round trip", () => {
  it("restores a wiped store to exactly what was backed up", async () => {
    await wipeEverything();
    await createRecord("lessons", lesson("size down after two losers"));
    await createRecord("lessons", lesson("do not chase the third push"));
    await createRecord("trades", trade("BTCUSDT"));
    await createRecord("trades", trade("SOLUSDT"));

    const before = await snapshotOfStore();

    // The file, exactly as it would land on disk or in the backup repo: the
    // JSON text, not the in-memory object. A Date that survives as an object in
    // memory and dies in serialization is precisely the failure this catches.
    const file = JSON.stringify(await buildSnapshot());

    await wipeEverything();
    assert.equal(
      (await listRecords("trades")).length,
      0,
      "the wipe itself must work, or the restore below proves nothing",
    );

    const { snapshot, issues } = parseSnapshot(JSON.parse(file));
    const report = await restoreSnapshot(snapshot, { mode: "fill-gaps", restoreSettings: false, issues });

    assert.equal(issues.length, 0, "a backup this app just wrote must parse without complaint");
    assert.equal(report.totalWritten, 4);
    assert.equal(await snapshotOfStore(), before, "restored store must be identical to the backed-up one");
  });

  it("round-trips again from the restored data, so a restore is not lossy the second time", async () => {
    // A restore that quietly drops a field looks fine once — the data is there
    // — and empties the journal over successive generations of backup.
    const first = JSON.stringify((await buildSnapshot()).data);
    const file = JSON.parse(JSON.stringify(await buildSnapshot()));
    await wipeEverything();
    const { snapshot } = parseSnapshot(file);
    await restoreSnapshot(snapshot, { mode: "fill-gaps", restoreSettings: false });
    assert.equal(JSON.stringify((await buildSnapshot()).data), first);
  });
});

describe("restore modes", () => {
  it("fill-gaps never overwrites a record that is already there", async () => {
    await wipeEverything();
    const original = await createRecord("lessons", lesson("the original wording"));
    const file = JSON.parse(JSON.stringify(await buildSnapshot()));

    // Simulate the trader editing that lesson AFTER the backup was taken.
    await deleteWhere("lessons", () => true);
    await createRecord("lessons", { ...lesson("the wording I edited today"), id: original.id } as never);

    const { snapshot } = parseSnapshot(file);
    const report = await restoreSnapshot(snapshot, { mode: "fill-gaps", restoreSettings: false });

    assert.equal(report.totalWritten, 0);
    assert.equal(report.totalSkipped, 1);
    const [kept] = await listRecords("lessons");
    assert.equal(kept.lessonText, "the wording I edited today", "today's edit must survive the default restore");
  });

  it("overwrite mode is the rollback, and does replace an edited record", async () => {
    const { snapshot } = parseSnapshot(JSON.parse(JSON.stringify(await buildSnapshot())));
    // Re-read the file made above the *first* time, where the wording was original.
    await wipeEverything();
    const original = await createRecord("lessons", lesson("the original wording"));
    const file = JSON.parse(JSON.stringify(await buildSnapshot()));
    await restoreSnapshot(parseSnapshot(file).snapshot, { mode: "fill-gaps", restoreSettings: false });

    await deleteWhere("lessons", () => true);
    await createRecord("lessons", { ...lesson("a bad edit"), id: original.id } as never);

    const report = await restoreSnapshot(parseSnapshot(file).snapshot, { mode: "overwrite", restoreSettings: false });
    assert.equal(report.totalWritten, 1);
    const [rolled] = await listRecords("lessons");
    assert.equal(rolled.lessonText, "the original wording");
    void snapshot;
  });

  it("never deletes records the backup does not mention", async () => {
    await wipeEverything();
    await createRecord("lessons", lesson("in the backup"));
    const file = JSON.parse(JSON.stringify(await buildSnapshot()));
    const extra = await createRecord("lessons", lesson("written after the backup"));

    await restoreSnapshot(parseSnapshot(file).snapshot, { mode: "overwrite", restoreSettings: false });

    const ids = (await listRecords("lessons")).map((record) => record.id);
    assert.ok(ids.includes(extra.id), "a restore must never remove work the backup predates");
  });
});

describe("reading a file we did not just write", () => {
  it("still restores a backup from BEFORE this format existed", async () => {
    // Every backup the owner has already downloaded has no formatVersion,
    // no counts and no appCommit. Refusing those would mean shipping a restore
    // that cannot read the only backups that currently exist.
    await wipeEverything();
    const legacy = {
      exportedAt: "2026-03-01T00:00:00.000Z",
      storageMode: "firestore",
      durable: true,
      settings: { displayCurrency: "INR" },
      data: {
        lessons: [
          {
            id: "legacy-lesson-1",
            createdAt: "2026-03-01T00:00:00.000Z",
            updatedAt: "2026-03-01T00:00:00.000Z",
            lessonText: "from an old export",
            category: "PROCESS",
            sourceType: "MANUAL",
            linkedTradeId: null,
            linkedTranscriptId: null,
            isActive: true,
            isPinned: false,
          },
        ],
      },
    };
    const { snapshot, issues } = parseSnapshot(legacy);
    assert.equal(issues.length, 0);
    const report = await restoreSnapshot(snapshot, { mode: "fill-gaps", restoreSettings: false });
    assert.equal(report.totalWritten, 1);
    const [restored] = await listRecords("lessons");
    assert.equal(restored.lessonText, "from an old export");
    assert.ok(restored.createdAt instanceof Date, "an ISO string in the file must come back as a Date");
  });

  it("drops a collection this build has never heard of, and says so, instead of failing", async () => {
    const { snapshot, issues } = parseSnapshot({
      formatVersion: 1,
      data: { lessons: [], somethingFromTheFuture: [{ id: "x" }] },
    });
    assert.equal(snapshot.totalRecords, 0);
    assert.equal(issues.length, 1);
    assert.match(issues[0].detail, /somethingFromTheFuture/);
  });

  it("drops records with no id rather than inventing one", async () => {
    const { snapshot, issues } = parseSnapshot({
      formatVersion: 1,
      data: { lessons: [{ id: "keeper" }, { lessonText: "no id" }, null] },
    });
    assert.equal(snapshot.data.lessons.length, 1);
    assert.match(issues[0].detail, /2 record\(s\)/);
  });

  it("refuses a file that is not a backup at all", () => {
    assert.throws(() => parseSnapshot({ hello: "world" }), BackupFormatError);
    assert.throws(() => parseSnapshot("nope"), BackupFormatError);
    assert.throws(() => parseSnapshot(null), BackupFormatError);
  });

  it("refuses a backup from a newer app rather than guessing at it", () => {
    assert.throws(
      () => parseSnapshot({ formatVersion: BACKUP_FORMAT_VERSION + 1, data: {} }),
      /newer version/,
    );
  });
});

describe("the snapshot covers everything", () => {
  it("includes every collection in the store shape, not a hand-written list", async () => {
    const snapshot = await buildSnapshot();
    for (const collection of collectionNames) {
      assert.ok(collection in snapshot.data, `${collection} is missing from the backup`);
      assert.ok(collection in snapshot.counts, `${collection} has no count in the backup`);
    }
  });

  it("counts what it actually carries", async () => {
    const snapshot = await buildSnapshot();
    const summed = Object.values(snapshot.counts).reduce((total, count) => total + count, 0);
    assert.equal(summed, snapshot.totalRecords);
    for (const [collection, records] of Object.entries(snapshot.data)) {
      assert.equal(records.length, snapshot.counts[collection]);
    }
  });
});
