// The /notes filter. Two axes with deliberately different shapes — category is
// one-of, tags are many-of — plus a text box that reuses the SAME query grammar
// as global search. These pin that: a category filter is exact, tags are AND,
// and "#tag" never degrades into a substring match.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UNCATEGORIZED, filterNotes, hasActiveNoteFilters, noteCategoryCounts, noteTagCounts } from "@/lib/notes";
import type { FreeNote } from "@/lib/types";

const note = (text: string, category: string | null, tags: string[]): FreeNote => ({
  id: text.slice(0, 8),
  createdAt: new Date("2026-08-20T10:00:00Z"),
  updatedAt: new Date("2026-08-20T10:00:00Z"),
  text,
  linkedTranscriptId: null,
  category,
  tags,
});

const notes = [
  note("SOL wants the 210 level", "ASSET", ["sol"]),
  note("Felt tilted after the BTC stop", "MINDSET", ["btc", "tilt"]),
  note("Funding flipped positive", "MARKET", []),
  note("A stray thought about winners", null, ["win"]),
];

describe("filterNotes", () => {
  it("matches a category exactly", () => {
    assert.equal(filterNotes(notes, { category: "ASSET", tags: [], q: "" }).length, 1);
  });

  it("has a first-class filter for notes with no category at all", () => {
    const uncategorised = filterNotes(notes, { category: UNCATEGORIZED, tags: [], q: "" });
    assert.equal(uncategorised.length, 1);
    assert.equal(uncategorised[0].category, null);
  });

  it("ANDs tags rather than ORing them", () => {
    assert.equal(filterNotes(notes, { category: null, tags: ["btc"], q: "" }).length, 1);
    assert.equal(filterNotes(notes, { category: null, tags: ["btc", "sol"], q: "" }).length, 0);
  });

  it("keeps #tag exact in the text box — #win must never match the #winner text", () => {
    assert.equal(filterNotes(notes, { category: null, tags: [], q: "#win" }).length, 1);
    assert.equal(filterNotes(notes, { category: null, tags: [], q: "#winner" }).length, 0);
  });

  it("mixes tags and words, order-independent and case-insensitive", () => {
    assert.equal(filterNotes(notes, { category: null, tags: [], q: "#sol LEVEL" }).length, 1);
    assert.equal(filterNotes(notes, { category: null, tags: [], q: "level #sol" }).length, 1);
    assert.equal(filterNotes(notes, { category: null, tags: [], q: "#sol funding" }).length, 0);
  });

  it("combines the two axes", () => {
    assert.equal(filterNotes(notes, { category: "MINDSET", tags: ["btc"], q: "tilted" }).length, 1);
    assert.equal(filterNotes(notes, { category: "ASSET", tags: ["btc"], q: "" }).length, 0);
  });
});

describe("the chip counts", () => {
  it("counts uncategorised notes under their own key so the chip can't lie", () => {
    const counts = noteCategoryCounts(notes);
    assert.equal(counts.get("ASSET"), 1);
    assert.equal(counts.get(UNCATEGORIZED), 1);
  });

  it("ranks tags by use", () => {
    assert.deepEqual(noteTagCounts(notes).map((entry) => entry.tag), ["btc", "sol", "tilt", "win"]);
  });
});

describe("hasActiveNoteFilters", () => {
  it("treats whitespace as no query", () => {
    assert.equal(hasActiveNoteFilters({ category: null, tags: [], q: "   " }), false);
    assert.equal(hasActiveNoteFilters({ category: null, tags: [], q: "btc" }), true);
    assert.equal(hasActiveNoteFilters({ category: "ASSET", tags: [], q: "" }), true);
  });
});
