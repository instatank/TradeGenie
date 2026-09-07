// The bias history is the only record of a thesis that has been overwritten, so
// the two failure modes worth guarding are opposite: losing a real change of
// mind, and minting noise rows for a save that changed nothing.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { describeBiasChange, diffBias } from "@/lib/asset-history";

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
