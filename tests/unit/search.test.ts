// The query grammar is a documented promise: "#win never matches #winner", so
// the tag pills and the search box always agree. These tests hold that line.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseQuery, searchIndex, tagUsage, type SearchDoc } from "@/lib/search";

const doc = (over: Partial<SearchDoc> & Pick<SearchDoc, "id">): SearchDoc => ({
  kind: "trade",
  href: `/trades/${over.id}`,
  title: "BTC · Long · Closed",
  subtitle: "Breakout",
  date: new Date("2026-01-01"),
  tags: [],
  fields: [],
  ...over,
});

// Distinct titles and subtitles on purpose: the haystack covers title and
// subtitle too, so shared boilerplate would make every doc match every word.
const corpus: SearchDoc[] = [
  doc({
    id: "1",
    title: "Doc one",
    subtitle: "first",
    tags: ["win"],
    fields: [{ label: "Thesis", text: "clean btc breakout above the range" }],
  }),
  doc({
    id: "2",
    title: "Doc two",
    subtitle: "second",
    tags: ["winner"],
    fields: [{ label: "Thesis", text: "eth stop ran too tight" }],
  }),
  doc({
    id: "3",
    title: "Doc three",
    subtitle: "third",
    tags: ["win", "fomo"],
    fields: [{ label: "Thesis", text: "btc chased the stop" }],
  }),
];

describe("parseQuery", () => {
  it("separates #tags from plain words", () => {
    assert.deepEqual(parseQuery("#fomo btc stop"), { tags: ["fomo"], terms: ["btc", "stop"] });
  });

  it("normalizes tags through the one tokenizer", () => {
    assert.deepEqual(parseQuery("#FOMO").tags, ["fomo"]);
  });

  it("dedupes both halves", () => {
    assert.deepEqual(parseQuery("#a1 #a1 btc btc"), { tags: ["a1"], terms: ["btc"] });
  });
});

describe("searchIndex", () => {
  it("matches a #tag by exact membership, never as a prefix", () => {
    const ids = searchIndex(corpus, "#win").map((r) => r.id);
    assert.deepEqual(ids.sort(), ["1", "3"], "#win must not match the #winner doc");
  });

  it("matches plain words as order-independent AND substrings", () => {
    assert.deepEqual(searchIndex(corpus, "btc breakout").map((r) => r.id), ["1"]);
    assert.deepEqual(searchIndex(corpus, "breakout btc").map((r) => r.id), ["1"]);
  });

  it("mixes tags and words", () => {
    assert.deepEqual(searchIndex(corpus, "#win stop").map((r) => r.id), ["3"]);
  });

  it("requires every tag, not any", () => {
    assert.deepEqual(searchIndex(corpus, "#win #fomo").map((r) => r.id), ["3"]);
  });

  it("returns nothing for an empty query rather than everything", () => {
    assert.deepEqual(searchIndex(corpus, "   "), []);
  });

  it("attaches a snippet labelled with the field that matched", () => {
    const [hit] = searchIndex(corpus, "breakout");
    assert.ok(hit.snippet, "a word match should produce a snippet");
    assert.equal(hit.snippet!.fieldLabel, "Thesis");
    assert.equal(hit.snippet!.match.toLowerCase(), "breakout");
  });
});

describe("tagUsage — the tag index behind the empty search page", () => {
  it("counts each tag across docs, most used first", () => {
    assert.deepEqual(tagUsage(corpus), [
      { tag: "win", count: 2, kinds: ["trade"] },
      { tag: "fomo", count: 1, kinds: ["trade"] },
      { tag: "winner", count: 1, kinds: ["trade"] },
    ]);
  });
});
