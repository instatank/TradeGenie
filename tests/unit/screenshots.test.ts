// Guards on screenshot attachment that no runtime test here can express.
//
// A screenshot is the one record in this app whose real payload lives outside
// the database — bytes in Firebase Storage, or on local disk. That makes an
// orphan invisible: the row is gone from every page, the file is not, and it
// costs storage and a slot in every backup from then on. Deleting a trade has
// always cascaded; asset notes are a second owner kind, and a third will be
// added by someone who has never read this file.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const actions = readFileSync(new URL("../../app/actions.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../../lib/types.ts", import.meta.url), "utf8");
const storage = readFileSync(new URL("../../lib/screenshot-storage.ts", import.meta.url), "utf8");

/** Every `linkedXId` field declared on the Screenshot record. */
function screenshotLinkFields(): string[] {
  const block = types.split("export type Screenshot = {")[1]?.split("\n};")[0] ?? "";
  return [...block.matchAll(/^\s{2}(linked\w+Id)\??:/gm)].map((match) => match[1]);
}

describe("screenshots cannot be orphaned", () => {
  // Scope, stated honestly: this proves each link field is cascaded SOMEWHERE,
  // which is what catches a new owner kind added with no cleanup at all. It
  // cannot prove that every delete path for an existing kind cascades — that
  // needs reading the code, and the comment above is there to prompt it.
  it("every link field on Screenshot is cascaded somewhere in app/actions.ts", () => {
    const fields = screenshotLinkFields();
    // Sanity: if the regex stops matching, the rest of this test passes
    // vacuously and guards nothing.
    assert.ok(fields.length >= 4, `expected to find the link fields, found ${fields.join(", ") || "none"}`);
    for (const field of fields) {
      assert.ok(
        new RegExp(`deleteWhere\\("screenshots"[\\s\\S]{0,200}?${field}`).test(actions),
        `Screenshot.${field} is never cascaded in app/actions.ts — deleting its owner would leave the image file behind`,
      );
    }
  });

  it("attaching reads every posted file, not just the first", () => {
    // getAll, not get. Pasting is the point of the control now, and pasting
    // three charts into one note is normal — silently keeping one and dropping
    // two is the worst failure an upload can have, because it looks like it
    // worked.
    const helper = actions.split("async function saveScreenshots(")[1]?.split("\n}")[0] ?? "";
    assert.ok(helper, "saveScreenshots helper not found");
    assert.ok(helper.includes("formData.getAll("), "saveScreenshots must read every posted file with getAll()");
    assert.ok(!/formData\.get\(/.test(helper), "saveScreenshots must not read a single file with get()");
  });
});

describe("stored paths stay separated by owner", () => {
  it("the object path folder is derived from the owner kind, never passed in", () => {
    // The old path spliced a trade id into a hardcoded `screenshots/trades/`.
    // A caller-supplied folder is how a new owner kind ends up writing into
    // another one's prefix.
    assert.ok(storage.includes("const ownerFolders"), "expected an owner -> folder map");
    assert.ok(
      /screenshots\/\$\{folder\}\/\$\{owner\.id\}/.test(storage),
      "the object path must be built from the derived folder and the owner id",
    );
  });

  it("every owner kind maps to its own distinct folder", () => {
    const map = storage.split("const ownerFolders")[1]?.split("};")[0] ?? "";
    const folders = [...map.matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(folders.length >= 2, "expected at least trade and assetNote folders");
    assert.equal(new Set(folders).size, folders.length, `two owner kinds share a storage folder: ${folders.join(", ")}`);
  });
});
