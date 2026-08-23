// lib/options.ts is THE custom-label registry. One normalizer is what stops
// "Chased breakout", "chased breakout" and "Chased  Breakout" becoming three
// separate pills — the same class of bug as two tag tokenizers.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { cleanOptionLabel, normalizeOptionValue } from "@/lib/options";

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

describe("cleanOptionLabel — the display label is stored verbatim", () => {
  it("keeps what was typed, tidying only stray whitespace", () => {
    assert.equal(cleanOptionLabel("  Cut   winner early!  "), "Cut winner early!");
  });

  it("preserves casing, because the label is the trader's own wording", () => {
    assert.equal(cleanOptionLabel("FOMO chase"), "FOMO chase");
  });
});
