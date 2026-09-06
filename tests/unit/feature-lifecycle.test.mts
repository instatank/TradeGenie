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
