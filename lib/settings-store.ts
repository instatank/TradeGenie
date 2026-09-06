import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { cache } from "react";
import type { FeatureFlags, FeatureUsage } from "@/lib/feature-flags";
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
  /** Feature lifecycle flags, keyed by a toggle's stable id. Read ONLY through
   *  featureEnabled() in lib/feature-flags.ts — never indexed directly, so
   *  there is one place that decides what "on" means. Absent = off. */
  featureFlags: FeatureFlags;
  /** How often each instrumented act has actually been done, so the monthly
   *  census reads numbers instead of the owner's recall. Local to this journal:
   *  it never leaves this Firestore document, and no third-party analytics are
   *  ever added — that is settled, not reopened here. */
  featureUsage: FeatureUsage;
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
  featureFlags: {},
  featureUsage: {},
  defaultMarketType: "CRYPTO_PERP",
  defaultSourceTool: "Voice memo",
  promptTemplatesVersion: PROMPT_TEMPLATES_VERSION,
  promptTemplates: defaultPromptTemplates,
};

// Request-scoped, exactly like lib/store.ts's read cache and for the same
// reason: settings are now read by getTagVocabulary, getTradesWithMistakes and
// the base-currency label, so a single page render asked for the same document
// three times. React's cache() hands back one Map per render or server action,
// and saveSettings clears it so a read-after-write inside one action still sees
// the write. Outside a request (seed, eval, tests) cache() degrades to no
// memoization, which is what those want.
const settingsCache = cache(() => new Map<string, Promise<AppSettings>>());

export function getSettings(): Promise<AppSettings> {
  const pending = settingsCache();
  const hit = pending.get(SETTINGS_DOC_ID);
  if (hit) return hit;
  const read = readSettings().catch((error: unknown) => {
    pending.delete(SETTINGS_DOC_ID);
    throw error;
  });
  pending.set(SETTINGS_DOC_ID, read);
  return read;
}

async function readSettings(): Promise<AppSettings> {
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
  try {
    if (usesFirebase()) {
      await getFirestoreDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set(settings, { merge: true });
      return;
    }
    await mkdir(path.dirname(localSettingsPath), { recursive: true });
    await writeFile(localSettingsPath, JSON.stringify(settings, null, 2));
  } finally {
    // After the write, not before: dropping it first would let a read landing
    // mid-write cache the pre-write document for the rest of the request.
    settingsCache().delete(SETTINGS_DOC_ID);
  }
}

/**
 * Write a few fields without sending the whole document back.
 *
 * saveSettings() reads nothing — it writes whatever object it is handed — so a
 * usage counter built on it would have to send the entire settings document,
 * prompt templates included, and would overwrite anything saved between its
 * read and its write. Firestore merges a nested map by path, so patching
 * { featureUsage: { [id]: … } } touches that one counter and nothing else.
 *
 * Still one writer file, so cache invalidation stays in one place.
 */
export async function saveSettingsPatch(patch: Partial<AppSettings>) {
  try {
    if (usesFirebase()) {
      await getFirestoreDb().collection(SETTINGS_COLLECTION).doc(SETTINGS_DOC_ID).set(patch, { merge: true });
      return;
    }
    // The local JSON file has no merge semantics of its own, so do the same
    // thing by hand: read what is there, lay the patch over it, write it back.
    const current = await readSettings();
    await mkdir(path.dirname(localSettingsPath), { recursive: true });
    await writeFile(localSettingsPath, JSON.stringify({ ...current, ...patch }, null, 2));
  } finally {
    settingsCache().delete(SETTINGS_DOC_ID);
  }
}

function mergeSettings(parsed: Partial<AppSettings> | null | undefined): AppSettings {
  // If the saved templates predate the current version, ignore them and use the
  // improved defaults — otherwise old thin prompts would shadow the new ones.
  // A trader's own customizations survive because saving stamps the current version.
  const templatesAreCurrent = parsed?.promptTemplatesVersion === PROMPT_TEMPLATES_VERSION;
  return {
    ...defaultSettings,
    ...(parsed ?? {}),
    // A settings document written before these existed has neither key, and
    // spreading `parsed` would put `undefined` over the default {} — which is
    // not the same thing as an empty object to every caller that indexes it.
    featureFlags: parsed?.featureFlags ?? {},
    featureUsage: parsed?.featureUsage ?? {},
    promptTemplatesVersion: PROMPT_TEMPLATES_VERSION,
    promptTemplates: templatesAreCurrent
      ? { ...defaultPromptTemplates, ...(parsed?.promptTemplates ?? {}) }
      : defaultPromptTemplates,
  };
}
