import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { defaultPromptTemplates } from "@/lib/prompts";
import { getFirestoreDb, usesFirebase } from "@/lib/store";

export type AppSettings = {
  aiEnabled: boolean;
  defaultMarketType: string;
  defaultSourceTool: string;
  promptTemplates: typeof defaultPromptTemplates;
};

const SETTINGS_COLLECTION = "appSettings";
const SETTINGS_DOC_ID = "singleton";
const localSettingsPath = path.join(process.cwd(), "data", "settings.json");

export const defaultSettings: AppSettings = {
  aiEnabled: true,
  defaultMarketType: "CRYPTO_PERP",
  defaultSourceTool: "Voice memo",
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
  return {
    ...defaultSettings,
    ...(parsed ?? {}),
    promptTemplates: {
      ...defaultPromptTemplates,
      ...(parsed?.promptTemplates ?? {}),
    },
  };
}
