import { saveSettingsAction } from "@/app/actions";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { marketTypes } from "@/lib/constants";
import { promptLabels, type PromptTemplateKey } from "@/lib/prompts";
import { getSettings } from "@/lib/settings-store";

const promptKeys: PromptTemplateKey[] = ["tradeEntry", "tradeExit", "eodReview", "lessonExtraction", "weeklyReview"];

export default async function SettingsPage() {
  const settings = await getSettings();
  const hasOpenAiKey = Boolean(process.env.OPENAI_API_KEY);

  return (
    <main className="page-shell max-w-4xl">
      <PageTitle title="Settings" subtitle="Local preferences only. The API key status is shown, not stored here." />
      <form action={saveSettingsAction} className="space-y-5">
        <section className="panel space-y-4">
          <h2 className="font-semibold">General</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-forge-panel p-3">
              <div className="text-sm font-medium">OpenAI API key</div>
              <div className={`mt-1 text-sm ${hasOpenAiKey ? "text-forge-green" : "text-forge-muted"}`}>
                {hasOpenAiKey ? "Present" : "Not present"}
              </div>
            </div>
            <label className="flex items-center gap-2 rounded-lg bg-forge-panel p-3 text-sm font-medium">
              <input type="checkbox" name="aiEnabled" defaultChecked={settings.aiEnabled} />
              AI enabled
            </label>
            <SelectField label="Default market type" name="defaultMarketType" options={marketTypes} defaultValue={settings.defaultMarketType} />
            <TextField label="Default source tool name" name="defaultSourceTool" defaultValue={settings.defaultSourceTool} />
          </div>
        </section>

        <section className="panel space-y-4">
          <h2 className="font-semibold">Transcript prompt templates</h2>
          {promptKeys.map((key) => (
            <TextAreaField
              key={key}
              label={promptLabels[key]}
              name={key}
              defaultValue={settings.promptTemplates[key]}
              rows={5}
            />
          ))}
        </section>

        <button className="button" type="submit">Save settings</button>
      </form>
    </main>
  );
}
