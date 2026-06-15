import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { defaultPromptTemplates } from "@/lib/prompts";

export type AppSettings = {
  aiEnabled: boolean;
  defaultMarketType: string;
  defaultSourceTool: string;
  promptTemplates: typeof defaultPromptTemplates;
};

const settingsPath = path.join(process.cwd(), "data", "settings.json");

export const defaultSettings: AppSettings = {
  aiEnabled: true,
  defaultMarketType: "CRYPTO_PERP",
  defaultSourceTool: "Voice memo",
  promptTemplates: defaultPromptTemplates,
};

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(settingsPath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      promptTemplates: {
        ...defaultPromptTemplates,
        ...(parsed.promptTemplates ?? {}),
      },
    };
  } catch {
    return defaultSettings;
  }
}

export async function saveSettings(settings: AppSettings) {
  await mkdir(path.dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}
