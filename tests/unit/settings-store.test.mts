// Settings persistence must respect the same test-isolation hook as the main
// store, or a test server silently reads and writes the real project's
// data/settings.json instead of a throwaway one.
//
// Found by hand, not by a test: verifying the exchange bulk-dismiss feature
// against a scratch TRADEGENIE_LOCAL_STORE, the dismissed key landed in the
// real repo's settings.json anyway, because this file resolved its path
// independently and never consulted the override every other test relies on.
// A real dev settings file (custom labels, prompt template edits, the display
// currency choice) got contaminated as a side effect of running a test.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const scratch = mkdtempSync(path.join(tmpdir(), "tradegenie-settings-"));
const storeFile = path.join(scratch, "store.json");
process.env.TRADEGENIE_LOCAL_STORE = storeFile;
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

const { getSettings, saveSettings, defaultSettings } = await import("@/lib/settings-store");

after(() => rmSync(scratch, { recursive: true, force: true }));

describe("settings-store respects TRADEGENIE_LOCAL_STORE", () => {
  it("writes beside the overridden store file, not to the real repo", async () => {
    await saveSettings({ ...defaultSettings, dismissedExchangeKeys: ["ETH|USDT|123"] });
    // Same directory as the store override — one env var isolates a whole run,
    // not two separate ones a caller has to remember to set.
    const expected = path.join(scratch, "settings.json");
    assert.ok(existsSync(expected), `expected settings written to ${expected}`);
  });

  it("reads back what it wrote from the overridden location", async () => {
    await saveSettings({ ...defaultSettings, dismissedExchangeKeys: ["SOL|INR|456"] });
    const settings = await getSettings();
    assert.deepEqual(settings.dismissedExchangeKeys, ["SOL|INR|456"]);
  });

  it("never touches the real project's data/settings.json", async () => {
    const realPath = path.join(process.cwd(), "data", "settings.json");
    const before = existsSync(realPath);
    await saveSettings({ ...defaultSettings, dismissedExchangeKeys: ["SHOULD|NOT|LAND|HERE"] });
    // Either it already existed and is unchanged, or it still doesn't exist —
    // either way this test run must not be the thing that created or altered it.
    if (before) {
      const { readFileSync } = await import("node:fs");
      const contents = readFileSync(realPath, "utf8");
      assert.ok(!contents.includes("SHOULD|NOT|LAND|HERE"), "test data leaked into the real settings file");
    } else {
      assert.ok(!existsSync(realPath), "test run must not create the real settings file");
    }
  });
});
