// The feature lifecycle mechanism: the flag gate and the usage counters.
//
// Two of these tests exist because of bugs this file caught at runtime rather
// than in review — see "counters must not delete each other" below, which
// reproduces a real backend asymmetry between Firestore and the local JSON
// store.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readdirSync, readFileSync as readSource, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, describe, it } from "node:test";

const scratch = mkdtempSync(path.join(tmpdir(), "tradegenie-lifecycle-"));
process.env.TRADEGENIE_LOCAL_STORE = path.join(scratch, "store.json");
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

const { FEATURE_TOGGLES, featureEnabled } = await import("@/lib/feature-flags");
const { USAGE_GROUPS, catalogedUsageIds, noteUse } = await import("@/lib/feature-usage");
const { defaultSettings, getSettings, saveSettings } = await import("@/lib/settings-store");

after(() => rmSync(scratch, { recursive: true, force: true }));

describe("the gate defaults off", () => {
  it("is off for a key nothing has written", () => {
    assert.equal(featureEnabled("anything", defaultSettings), false);
  });

  it("is off for a settings document written before flags existed", () => {
    // mergeSettings fills the field in, but a caller holding a raw object
    // must get the same answer rather than crashing on the missing key.
    assert.equal(featureEnabled("anything", {}), false);
    assert.equal(featureEnabled("anything", { featureFlags: null }), false);
  });

  it("is off for anything but an explicit true", () => {
    // A stray string or number in the document must not read as "on" — the
    // gate is what decides, not JavaScript truthiness.
    const settings = { featureFlags: { a: "yes", b: 1, c: true } as unknown as Record<string, boolean> };
    assert.equal(featureEnabled("a", settings), false);
    assert.equal(featureEnabled("b", settings), false);
    assert.equal(featureEnabled("c", settings), true);
  });

  it("every catalogued toggle is off with a fresh settings document", () => {
    for (const toggle of FEATURE_TOGGLES) {
      assert.equal(featureEnabled(toggle.key, defaultSettings), false, `${toggle.key} defaults on`);
    }
  });
});

describe("the toggle catalog stays within its budget", () => {
  it("holds at most 4 toggles (LIFECYCLE.md §R5)", () => {
    // Every entry is a permanent second code path. A fifth means retiring one
    // in the same commit, or writing down in the census why not.
    assert.ok(FEATURE_TOGGLES.length <= 4, `${FEATURE_TOGGLES.length} toggles — the cap is 4`);
  });

  it("has no duplicate keys", () => {
    const keys = FEATURE_TOGGLES.map((toggle) => toggle.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("gives every toggle a stage and an exit cost", () => {
    for (const toggle of FEATURE_TOGGLES) {
      assert.ok(["S0", "S1", "S2", "S3"].includes(toggle.stage), `${toggle.key} has no stage`);
      assert.ok(["REVERSIBLE", "STICKY", "STRUCTURAL"].includes(toggle.exitCost), `${toggle.key} has no exit cost`);
    }
  });
});

describe("usage counters", () => {
  it("counts, keeps the first use, and moves the last", async () => {
    await noteUse("test.alpha");
    const afterOne = (await getSettings()).featureUsage["test.alpha"];
    await noteUse("test.alpha");
    const afterTwo = (await getSettings()).featureUsage["test.alpha"];
    assert.equal(afterOne.n, 1);
    assert.equal(afterTwo.n, 2);
    // `first` is what makes a count readable: 40 uses means something different
    // over three days than over three months.
    assert.equal(afterTwo.first, afterOne.first);
    assert.ok(afterTwo.last >= afterOne.last);
  });

  it("counters must not delete each other", async () => {
    // THE REGRESSION. The first cut patched { featureUsage: { [id]: … } } and
    // leaned on the backend to merge it into the stored map. Firestore's
    // set({merge:true}) does; the local JSON store shallow-spreads, so every
    // other counter was silently wiped on each bump — a real bug, found by
    // counting two things and reading back only the second.
    await noteUse("test.beta");
    await noteUse("test.gamma");
    const usage = (await getSettings()).featureUsage;
    assert.ok(usage["test.beta"], "beta was deleted by gamma's write");
    assert.ok(usage["test.gamma"]);
    assert.ok(usage["test.alpha"], "an earlier counter was deleted by a later one");
  });

  it("leaves the rest of the settings document alone", async () => {
    await saveSettings({ ...defaultSettings, displayCurrency: "USDT", hiddenTags: ["keepme"] });
    await noteUse("test.delta");
    const settings = await getSettings();
    assert.equal(settings.displayCurrency, "USDT");
    assert.deepEqual(settings.hiddenTags, ["keepme"]);
  });

  it("is never load-bearing — a failed write is swallowed", async () => {
    // Rule 2 of lib/feature-usage.ts. If this ever throws, a counter can cost
    // the trader a saved trade, which is the one thing it must never do.
    //
    // Broken for real rather than by stubbing: an ES module's imported binding
    // cannot be reassigned from a test, so a monkeypatch here proves nothing
    // (the first attempt at this test failed for exactly that reason). Putting
    // a DIRECTORY where the settings file goes makes the write fail with
    // EISDIR — which even root cannot write through.
    const settingsFile = path.join(scratch, "settings.json");
    rmSync(settingsFile, { force: true });
    mkdirSync(settingsFile);
    try {
      await assert.doesNotReject(() => noteUse("test.epsilon"));
    } finally {
      rmSync(settingsFile, { recursive: true, force: true });
    }
  });
});

describe("the usage catalog", () => {
  it("has no duplicate ids", () => {
    const ids = catalogedUsageIds();
    assert.equal(new Set(ids).size, ids.length);
  });

  it("labels every id it lists", () => {
    for (const group of USAGE_GROUPS) {
      assert.ok(group.label);
      for (const entry of group.ids) assert.ok(entry.label, `${entry.id} has no label`);
    }
  });

  it("gives every catalogued toggle a counter", () => {
    // §R3: a feature at S1 or S2 that is not instrumented cannot be judged at
    // census, so it would be cut or kept on recall — the exact thing this
    // mechanism exists to replace.
    const counted = new Set(catalogedUsageIds());
    for (const toggle of FEATURE_TOGGLES) {
      assert.ok(counted.has(toggle.key), `${toggle.key} is toggleable but not counted`);
    }
  });
});


// ---------------------------------------------------------------------------
// The mechanism must be a NO-OP until something is deliberately gated.
//
// This is a source-level guard rather than a render comparison, and that is the
// stronger claim, not the weaker one: a byte-for-byte diff of every page proves
// the flags changed nothing on the day it ran, whereas asserting that NOTHING
// READS THE GATE proves they cannot change anything at all. `featureEnabled`
// is a pure function of a key and the settings object, so a page that never
// calls it cannot depend on a flag by any route.
//
// Two call sites are legitimate and neither gates a feature: toggleFeatureAction
// reads the current value to flip it, and the Optional features panel reads it
// to draw On/Off on its own switch. Anything else means a real feature is now
// behind a flag — at which point this test SHOULD fail, and the fix is to add
// the file to the list below in the same commit as the ledger row that explains
// what was gated and what would kill it.
// ---------------------------------------------------------------------------

const ALLOWED_GATE_SITES = new Set([
  "app/actions.ts", // toggleFeatureAction — flips the flag; gates nothing
  "app/settings/page.tsx", // OptionalFeaturesPanel — draws the switch's own state
]);

// A counter belongs in a server action. In a page or a component it would be
// counting a render, which is the one thing lib/feature-usage.ts forbids.
const ALLOWED_COUNTER_SITES = new Set(["app/actions.ts"]);

// Comments are stripped before scanning. Without this the guard fires on prose:
// lib/settings-store.ts's field comment says "read ONLY through featureEnabled()",
// which is documentation pointing AT the rule, not a gate site breaking it.
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

function sourceFiles(): { path: string; body: string }[] {
  const root = fileURLToPath(new URL("../..", import.meta.url));
  const found: { path: string; body: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === "node_modules" || entry === ".next" || entry === ".git") continue;
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mts)$/.test(entry)) found.push({ path: path.relative(root, full), body: withoutComments(readSource(full, "utf8")) });
    }
  };
  for (const dir of ["app", "components", "lib"]) walk(path.join(root, dir));
  return found;
}

describe("with every flag off, no page changes", () => {
  it("nothing but the switch itself reads the gate", () => {
    const offenders = sourceFiles()
      .filter(({ path: file, body }) => body.includes("featureEnabled(") && !ALLOWED_GATE_SITES.has(file))
      .map(({ path: file }) => file)
      .filter((file) => file !== "lib/feature-flags.ts");
    assert.deepEqual(
      offenders,
      [],
      `these files gate something on a feature flag: ${offenders.join(", ")}. ` +
        "That is fine — but it means the mechanism is no longer a no-op, so add the file here " +
        "in the same commit as the docs/lifecycle.md row saying what was gated and what would kill it.",
    );
  });

  it("the catalog is empty, so there is nothing to gate", () => {
    // The pairing with the test above is what makes "no-op" true rather than
    // merely tidy: no toggles exist AND no render path consults one.
    assert.deepEqual(FEATURE_TOGGLES, [], "a toggle was added — see docs/lifecycle.md before shipping it");
  });

  it("counters are only bumped from server actions, never from a render", () => {
    const offenders = sourceFiles()
      .filter(({ path: file, body }) => /\bnoteUse\(/.test(body) && !ALLOWED_COUNTER_SITES.has(file))
      .map(({ path: file }) => file)
      .filter((file) => file !== "lib/feature-usage.ts");
    assert.deepEqual(
      offenders,
      [],
      `these files call noteUse outside a server action: ${offenders.join(", ")}. ` +
        "A page render is a navigation, not a decision — counting one makes the census read noise.",
    );
  });

  it("finds the files it is guarding", () => {
    // Guards against the walk silently matching nothing and all three passing
    // vacuously — the failure mode of every source-level test.
    const files = sourceFiles();
    assert.ok(files.length > 40, `only walked ${files.length} source files`);
    assert.ok(files.some(({ path: file }) => file === "app/actions.ts"));
  });
});
