// lib/options.ts is THE custom-label registry. One normalizer is what stops
// "Chased breakout", "chased breakout" and "Chased  Breakout" becoming three
// separate pills — the same class of bug as two tag tokenizers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanOptionLabel, normalizeForGroup, normalizeOptionValue, optionGroups } from "@/lib/options";

describe("normalizeOptionValue", () => {
  it("turns a typed label into a stable stored value", () => {
    assert.equal(normalizeOptionValue("Cut winner early!"), "CUT_WINNER_EARLY");
  });

  it("collapses casing and spacing so re-typing selects rather than duplicates", () => {
    const variants = ["Chased breakout", "chased breakout", "Chased  Breakout", "  CHASED BREAKOUT  "];
    const values = new Set(variants.map((v) => normalizeOptionValue(v)));
    assert.equal(values.size, 1, `all variants must normalize alike, got ${[...values].join(", ")}`);
    assert.equal([...values][0], "CHASED_BREAKOUT");
  });

  it("registers nothing for junk", () => {
    assert.equal(normalizeOptionValue(" !! "), null);
    assert.equal(normalizeOptionValue(""), null);
    assert.equal(normalizeOptionValue(null), null);
    assert.equal(normalizeOptionValue(undefined), null);
  });

  it("never leaves leading or trailing underscores", () => {
    const value = normalizeOptionValue("!!wrong side!!")!;
    assert.ok(!value.startsWith("_") && !value.endsWith("_"), `got ${value}`);
    assert.equal(value, "WRONG_SIDE");
  });

  it("rejects a single character as too short to be a label", () => {
    assert.equal(normalizeOptionValue("a"), null);
  });
});

// The one variation on the normalizer, and the reason it exists: a grade's
// modifier IS its meaning. Under the prose rules A+, A and A- all store as "A",
// which would quietly merge three grades into one bucket in every filter and
// every analytics row.
describe("normalizeOptionValue — the grade shape", () => {
  it("keeps + and - apart instead of stripping them to the same letter", () => {
    const values = ["A+", "A", "A-"].map((label) => normalizeOptionValue(label, "grade"));
    assert.deepEqual(values, ["A_PLUS", "A", "A_MINUS"]);
    assert.equal(new Set(values).size, 3, "three grades must not collapse into one value");
  });

  it("accepts a single character, because 'A' is a whole grade", () => {
    assert.equal(normalizeOptionValue("C", "grade"), "C");
    // …while the prose shape still rejects it, unchanged.
    assert.equal(normalizeOptionValue("C"), null);
  });

  it("still collapses casing and spacing, so re-typing selects rather than duplicates", () => {
    const values = new Set([" a+ ", "A+", "a +"].map((label) => normalizeOptionValue(label, "grade")));
    assert.equal(values.size, 1);
    assert.equal([...values][0], "A_PLUS");
  });

  it("registers nothing for junk", () => {
    assert.equal(normalizeOptionValue(" ", "grade"), null);
    assert.equal(normalizeOptionValue("!!", "grade"), null);
  });
});

describe("normalizeForGroup — a group declares its shape, it does not bring a second tokenizer", () => {
  it("normalizes setup grades as grades and everything else as prose", () => {
    assert.equal(normalizeForGroup("setupGrade", "A+"), "A_PLUS");
    assert.equal(normalizeForGroup("mechanism", "A+"), null);
    assert.equal(normalizeForGroup("mechanism", "Order block"), "ORDER_BLOCK");
  });

  it("maps every built-in setup grade back onto its own stored value", () => {
    // This is what stops typing "A+" minting a second chip beside the built-in
    // one — the same trap "Just watching" → OBSERVE_ONLY fell into.
    for (const choice of optionGroups.setupGrade.builtin) {
      assert.equal(normalizeForGroup("setupGrade", choice.label), choice.value, `${choice.label} must resolve to itself`);
    }
  });
});

describe("cleanOptionLabel — the display label is stored verbatim", () => {
  it("keeps what was typed, tidying only stray whitespace", () => {
    assert.equal(cleanOptionLabel("  Cut   winner early!  "), "Cut winner early!");
  });

  it("preserves casing, because the label is the trader's own wording", () => {
    assert.equal(cleanOptionLabel("FOMO chase"), "FOMO chase");
  });
});
