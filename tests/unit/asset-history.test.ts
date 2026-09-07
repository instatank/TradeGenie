// The bias history is the only record of a thesis that has been overwritten, so
// the two failure modes worth guarding are opposite: losing a real change of
// mind, and minting noise rows for a save that changed nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAssetTimeline, describeBiasChange, diffBias, splitTimeline } from "@/lib/asset-history";

const blank = { htfBias: null, ltfBias: null, levels: null, gamePlan: null };

describe("diffBias", () => {
  it("records nothing when nothing moved", () => {
    const view = { ...blank, htfBias: "Accumulation" };
    assert.deepEqual(diffBias(view, view), []);
  });

  it("treats whitespace-only edits as no change", () => {
    // Otherwise pressing Save after adding a stray newline to the game plan
    // would file a "changed my mind" row, and the history stops being readable.
    const before = { ...blank, gamePlan: "Wait for the sweep" };
    const after = { ...blank, gamePlan: "  Wait for the sweep\n" };
    assert.deepEqual(diffBias(before, after), []);
  });

  it("treats empty string and null as the same nothing", () => {
    // The form posts "" for a field the trader cleared; the store holds null.
    assert.deepEqual(diffBias({ ...blank }, { ...blank, ltfBias: "" }), []);
  });

  it("treats a CRLF-only difference as no change", () => {
    // Not theoretical, and the reason this whole guard exists: a browser posts
    // textarea newlines as CRLF while the seed, the capture pipeline and a
    // restore all write bare LF. Without this, the first save on any asset with
    // a multi-line field files a "Levels changed" row whose before and after
    // look identical — on every save, forever. Found in a real browser.
    const before = { ...blank, levels: "Support 178.4\nTarget 168.0" };
    const after = { ...blank, levels: "Support 178.4\r\nTarget 168.0" };
    assert.deepEqual(diffBias(before, after), []);
  });

  it("still sees a real edit inside a multi-line field", () => {
    // The CRLF rule must not be so broad that it swallows a genuine change.
    const before = { ...blank, levels: "Support 178.4\nTarget 168.0" };
    const after = { ...blank, levels: "Support 178.4\r\nTarget 162.0" };
    assert.equal(diffBias(before, after).length, 1);
  });

  it("records a change of mind with both sides intact", () => {
    const changes = diffBias({ ...blank, htfBias: "Accumulation" }, { ...blank, htfBias: "Distribution" });
    assert.deepEqual(changes, [{ field: "htfBias", from: "Accumulation", to: "Distribution" }]);
  });

  it("records the first time a field is filled in", () => {
    // "Bias set" is a real event in the story of an asset. Dropping it would
    // leave the first read of every symbol missing from its own history.
    const changes = diffBias(blank, { ...blank, htfBias: "Uptrend intact" });
    assert.deepEqual(changes, [{ field: "htfBias", from: null, to: "Uptrend intact" }]);
  });

  it("records a field being cleared", () => {
    const changes = diffBias({ ...blank, gamePlan: "Long the retest" }, blank);
    assert.deepEqual(changes, [{ field: "gamePlan", from: "Long the retest", to: null }]);
  });

  it("records every field that moved in one save", () => {
    const before = { htfBias: "Up", ltfBias: "Pullback", levels: "38.2", gamePlan: "Buy dips" };
    const after = { htfBias: "Down", ltfBias: "Pullback", levels: "35.0", gamePlan: "Sell rips" };
    assert.deepEqual(
      diffBias(before, after).map((change) => change.field),
      ["htfBias", "levels", "gamePlan"],
    );
  });
});

describe("describeBiasChange", () => {
  it("names what happened rather than the field", () => {
    assert.equal(describeBiasChange({ field: "htfBias", from: null, to: "Up" }), "HTF bias set");
    assert.equal(describeBiasChange({ field: "htfBias", from: "Up", to: null }), "HTF bias cleared");
    assert.equal(describeBiasChange({ field: "gamePlan", from: "a", to: "b" }), "Game plan changed");
  });

  it("falls back to the stored field name rather than throwing", () => {
    // `field` is a plain string in the store on purpose: a renamed field must
    // read back, not crash the page that renders it.
    assert.equal(describeBiasChange({ field: "someOldField", from: "a", to: "b" }), "someOldField changed");
  });
});

describe("buildAssetTimeline", () => {
  const at = (iso: string) => new Date(iso);

  it("interleaves every kind newest first", () => {
    const items = buildAssetTimeline({
      notes: [{ id: "n1", createdAt: at("2026-03-02T10:00:00Z") }],
      biasChanges: [{ id: "b1", createdAt: at("2026-03-04T10:00:00Z") }],
      trades: [{ id: "t1", tradeDateTime: at("2026-03-03T10:00:00Z") }],
      freeNotes: [{ id: "f1", createdAt: at("2026-03-01T10:00:00Z") }],
    });
    assert.deepEqual(items.map((item) => item.id), ["b1", "t1", "n1", "f1"]);
    assert.deepEqual(items.map((item) => item.kind), ["bias", "trade", "note", "freeNote"]);
  });

  it("places a trade at tradeDateTime, not createdAt", () => {
    // An archived position from March is WRITTEN today. Filing it under today
    // would put it at the top of the story of a symbol it left months ago.
    const items = buildAssetTimeline({
      notes: [{ id: "recent", createdAt: at("2026-03-10T10:00:00Z") }],
      biasChanges: [],
      trades: [{ id: "archived", tradeDateTime: at("2025-06-01T10:00:00Z"), createdAt: at("2026-03-11T10:00:00Z") }],
      freeNotes: [],
    });
    assert.deepEqual(items.map((item) => item.id), ["recent", "archived"]);
  });

  it("survives having nothing to show", () => {
    assert.deepEqual(buildAssetTimeline({ notes: [], biasChanges: [], trades: [], freeNotes: [] }), []);
  });
});

describe("splitTimeline", () => {
  const now = new Date("2026-03-31T12:00:00Z");
  const daysAgo = (days: number) => ({ at: new Date(now.getTime() - days * 24 * 3600_000) });

  it("shows everything inside the window and folds the rest", () => {
    const items = [daysAgo(1), daysAgo(10), daysAgo(29), daysAgo(45), daysAgo(200)];
    const { recent, earlier } = splitTimeline(items, { now, minItems: 1 });
    assert.equal(recent.length, 3);
    assert.equal(earlier.length, 2);
  });

  it("shows a busy month in full rather than capping it", () => {
    // The opposite failure to a flat "most recent N": a week with 30 entries
    // in it is exactly the week you want to read whole.
    const items = Array.from({ length: 30 }, (_, index) => daysAgo(index % 7));
    const { recent, earlier } = splitTimeline(items, { now });
    assert.equal(recent.length, 30);
    assert.equal(earlier.length, 0);
  });

  it("still shows the last few entries on an asset nobody has touched in months", () => {
    // Otherwise a quiet symbol renders a disclosure with an empty column above
    // it, which reads as a page that failed to load.
    const items = Array.from({ length: 12 }, (_, index) => daysAgo(90 + index));
    const { recent, earlier } = splitTimeline(items, { now, minItems: 8 });
    assert.equal(recent.length, 8);
    assert.equal(earlier.length, 4);
  });

  it("never shows more than there is", () => {
    const { recent, earlier } = splitTimeline([daysAgo(400)], { now, minItems: 8 });
    assert.equal(recent.length, 1);
    assert.equal(earlier.length, 0);
  });

  it("orders by date even if handed an unsorted list", () => {
    const { recent } = splitTimeline([daysAgo(5), daysAgo(1), daysAgo(3)], { now });
    assert.deepEqual(recent.map((item) => item.at.getTime()), [daysAgo(1).at.getTime(), daysAgo(3).at.getTime(), daysAgo(5).at.getTime()]);
  });
});
