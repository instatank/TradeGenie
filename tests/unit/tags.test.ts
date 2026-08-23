// lib/tags.ts is THE tag tokenizer. CLAUDE.md records that DayOS shipped two
// tokenizers which quietly diverged and the split haunted every tag feature —
// these tests pin the exact behaviour so a second one can't creep back in.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveTags, extractTags, mergeTags, normalizeTag, parseTagInput } from "@/lib/tags";

describe("normalizeTag", () => {
  it("lowercases and strips a leading hash", () => {
    assert.equal(normalizeTag("#Side-Project"), "side-project");
    assert.equal(normalizeTag("FOMO"), "fomo");
  });

  it("rejects anything shorter than 2 or longer than 40 characters", () => {
    assert.equal(normalizeTag("#1"), null);
    assert.equal(normalizeTag("a"), null);
    assert.equal(normalizeTag("a".repeat(41)), null);
    assert.equal(normalizeTag("a".repeat(40)), "a".repeat(40));
  });

  it("folds unsupported characters to hyphens rather than dropping the tag", () => {
    assert.equal(normalizeTag("break out!!"), "break-out");
    assert.equal(normalizeTag("#risk__mgmt"), "risk__mgmt");
  });

  it("never returns leading or trailing separators", () => {
    assert.equal(normalizeTag("--fomo--"), "fomo");
    assert.equal(normalizeTag("__fomo__"), "fomo");
  });

  it("returns null for junk with no usable body", () => {
    assert.equal(normalizeTag("   "), null);
    assert.equal(normalizeTag("!!"), null);
  });
});

describe("extractTags — the '#' must start a word", () => {
  it("picks up inline hashtags", () => {
    assert.deepEqual(extractTags("felt #fomo and chased the #breakout"), ["breakout", "fomo"]);
  });

  it("ignores a hash inside a word, so a price typo is not a tag", () => {
    // The documented case: "stop 64#200" is a typo, not a tag.
    assert.deepEqual(extractTags("stop 64#200"), []);
  });

  it("dedupes and sorts", () => {
    assert.deepEqual(extractTags("#fomo #fomo #anger"), ["anger", "fomo"]);
  });

  it("handles empty and null text", () => {
    assert.deepEqual(extractTags(null), []);
    assert.deepEqual(extractTags(""), []);
  });
});

describe("parseTagInput", () => {
  it("accepts comma or space separated tags with optional hashes", () => {
    assert.deepEqual(parseTagInput("#fomo, tilt  revenge"), ["fomo", "revenge", "tilt"]);
  });

  it("drops tokens that normalize to nothing", () => {
    assert.deepEqual(parseTagInput("ok, a, !!"), ["ok"]);
  });
});

describe("deriveTags — the canonical save-time derivation", () => {
  it("unions inline hashtags across fields with the tag input", () => {
    assert.deepEqual(
      deriveTags(["thesis with #breakout", "note with #fomo"], "manual, #tilt"),
      ["breakout", "fomo", "manual", "tilt"],
    );
  });

  it("survives null fields", () => {
    assert.deepEqual(deriveTags([null, undefined, "#one"], null), ["one"]);
  });
});

describe("mergeTags — the partial-save rule: tags only ever grow", () => {
  it("unions rather than replaces, so a quick save never wipes tags set elsewhere", () => {
    assert.deepEqual(mergeTags(["existing"], ["new"]), ["existing", "new"]);
  });

  it("treats undefined existing tags as empty", () => {
    assert.deepEqual(mergeTags(undefined, ["new"]), ["new"]);
  });
});
