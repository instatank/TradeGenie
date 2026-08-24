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
  defaultMarketType: string;
  defaultSourceTool: string;
  promptTemplatesVersion: number;
  promptTemplates: typeof defaultPromptTemplates;
};

const SETTINGS_COLLECTION = "appSettings";
const SETTINGS_DOC_ID = "singleton";
const localSettingsPath = path.join(process.cwd(), "data", "settings.json");

export const defaultSettings: AppSettings = {
  aiEnabled: true,
  hiddenTags: [],
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
