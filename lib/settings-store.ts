import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { PROMPT_TEMPLATES_VERSION, defaultPromptTemplates } from "@/lib/prompts";
import { getFirestoreDb, usesFirebase } from "@/lib/store";

export type AppSettings = {
  aiEnabled: boolean;
  /** Tags kept out of the pickers to stop them crowding, without touching a
   *  single record. A hidden tag still works everywhere else: it still matches
   *  in search, still shows as a pill, and still appears in the picker on a
   *  record that already carries it — it just stops being offered as a chip. */
  hiddenTags: string[];
  /** Exchange positions the trader has decided not to journal. Without this an
   *  unlogged position nags forever, which trains you to ignore the nudge —
   *  and the nudge is the only thing protecting the logging habit. Stored as
   *  position keys, so dismissing survives a re-sync. */
  dismissedExchangeKeys: string[];
  /** Which currency combined totals are shown in. Per-trade numbers always
   *  stay in the account they were traded in; only sums are converted. */
  displayCurrency: "INR" | "USDT";
  defaultMarketType: string;
  defaultSourceTool: string;
  promptTemplatesVersion: number;
  promptTemplates: typeof defaultPromptTemplates;
};

const SETTINGS_COLLECTION = "appSettings";
const SETTINGS_DOC_ID = "singleton";
// Mirrors lib/store.ts's TRADEGENIE_LOCAL_STORE handling — before this, a
// test server started with that env var (every smoke run, every manual
// verification against a throwaway store) still silently read AND WROTE the
// real project's data/settings.json, because this file resolved its path
// independently and never consulted the same override. Found when verifying
// the exchange bulk-dismiss action against a scratch store: the dismissed key
// landed in the real settings file instead. Same directory as the override
// (not a sibling "-settings" file) so one override still isolates a whole run.
const localSettingsPath = process.env.TRADEGENIE_LOCAL_STORE
  ? path.join(path.dirname(path.resolve(process.env.TRADEGENIE_LOCAL_STORE)), "settings.json")
  : path.join(process.cwd(), "data", "settings.json");

export const defaultSettings: AppSettings = {
  aiEnabled: true,
  hiddenTags: [],
  dismissedExchangeKeys: [],
  displayCurrency: "INR",
  defaultMarketType: "CRYPTO_PERP",
  defaultSourceTool: "Voice memo",
  promptTemplatesVersion: PROMPT_TEMPLATES_VERSION,
  promptTemplates: defaultPromptTemplates,
};

export async function getSettings(): Promise<AppSettings> {
  if (usesFirebase()) {
    const doc = await getFirestoreDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).get();
    const parsed = (doc.exists ? doc.data() : null) as Partial<AppSettings> | null;
    return mergeSettings(parsed);
  }
  try {
    const raw = await readFile(localSettingsPath, "utf8");
    return mergeSettings(JSON.parse(raw) as Partial<AppSettings>);
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(settings: AppSettings) {
  if (usesFirebase()) {
    await getFirestoreDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set(settings, { merge: true });
    return;
  }
  await mkdir(path.dirname(localSettingsPath), { recursive: true });
  await writeFile(localSettingsPath, JSON.stringify(settings, null, 2));
}

function mergeSettings(parsed: Partial<AppSettings> | null | undefined): AppSettings {
  // If the saved templates predate the current version, ignore them and use the
  // improved defaults — otherwise old thin prompts would shadow the new ones.
  // A trader's own customizations survive because saving stamps the current version.
  const templatesAreCurrent = parsed?.promptTemplatesVersion === PROMPT_TEMPLATES_VERSION;
  return {
    ...defaultSettings,
    ...(parsed ?? {}),
    promptTemplatesVersion: PROMPT_TEMPLATES_VERSION,
    promptTemplates: templatesAreCurrent
      ? { ...defaultPromptTemplates, ...(parsed?.promptTemplates ?? {}) }
      : defaultPromptTemplates,
  };
}
