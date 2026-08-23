// Guards on app/actions.ts that no runtime test can express.
//
// The 40-call revalidatePath fan-out did not appear all at once — it grew one
// action at a time, and it had already rotted into real staleness bugs before
// anyone noticed (/analytics reads every trade but no trade action revalidated
// it). Collapsing it to one call fixes today; these tests stop it growing back,
// which matters more in a codebase where new actions arrive regularly.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync(new URL("../../app/actions.ts", import.meta.url), "utf8");

// A rough split into top-level exported actions. Good enough to spot an action
// that writes and forgets to revalidate.
function exportedActions(): { name: string; body: string }[] {
  return source
    .split("\nexport async function ")
    .slice(1)
    .map((part) => ({ name: part.split("(")[0], body: part.split("\nexport ")[0] }));
}

const WRITES = /db\.(create|update|deleteWhere|upsertBy)|saveSettings\(|registerCustom|removeCustom|renameCustom/;

describe("revalidation stays in one place", () => {
  it("no action calls revalidatePath directly", () => {
    const offenders = exportedActions()
      .filter(({ body }) => body.includes("revalidatePath("))
      .map(({ name }) => name);
    assert.deepEqual(
      offenders,
      [],
      `these actions call revalidatePath directly instead of revalidateEverything(): ${offenders.join(", ")}. ` +
        "Per-action path lists drift — that is how /analytics went stale.",
    );
  });

  it("revalidateEverything expires the whole route cache, not one page", () => {
    // The layout tag is what makes one call cover every route; "page" would
    // silently only cover "/" and quietly reintroduce the staleness bugs.
    assert.match(source, /revalidatePath\("\/",\s*"layout"\)/);
  });

  it("every action that writes also revalidates", () => {
    const missing = exportedActions()
      .filter(({ body }) => WRITES.test(body) && !body.includes("revalidateEverything()"))
      .map(({ name }) => name);
    assert.deepEqual(
      missing,
      [],
      `these actions write to the store but never revalidate, so the change won't show up: ${missing.join(", ")}`,
    );
  });
});

describe("sanity on the action surface", () => {
  it("still exports a meaningful number of actions", () => {
    // Guards against the parsing above silently matching nothing and the
    // tests above passing vacuously.
    assert.ok(exportedActions().length > 30, `only found ${exportedActions().length} actions`);
  });

  it("finds actions that actually write", () => {
    const writers = exportedActions().filter(({ body }) => WRITES.test(body));
    assert.ok(writers.length > 20, `only found ${writers.length} writing actions`);
  });
});
