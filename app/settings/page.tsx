import { Download } from "lucide-react";
import { saveSettingsAction } from "@/app/actions";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { marketTypes } from "@/lib/constants";
import { promptLabels, type PromptTemplateKey } from "@/lib/prompts";
import { getSettings } from "@/lib/settings-store";
import { storageStatus } from "@/lib/store";

// One template now — the capture pipeline makes a single call that returns every
// entry, so there is no per-note-type routing left to configure.
const promptKeys: PromptTemplateKey[] = ["capture"];

export default async function SettingsPage() {
  const settings = await getSettings();
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const storage = storageStatus();

  return (
    <main className="page-shell max-w-4xl">
      <PageTitle title="Settings" subtitle="Local preferences only. The API key status is shown, not stored here." />

      <section className="panel mb-5 space-y-3">
        <h2 className="font-semibold">Data &amp; backup</h2>
        <StorageBanner storage={storage} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-forge-panel p-3">
          <div className="text-sm">
            <div className="font-medium">Export everything</div>
            <div className="text-forge-muted">One JSON file with all trades, transcripts, journals, lessons, settings. Your manual safety net.</div>
          </div>
          <a className="button-secondary" href="/api/export" download>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export backup
          </a>
        </div>
      </section>

      <form action={saveSettingsAction} className="space-y-5">
        <section className="panel space-y-4">
          <h2 className="font-semibold">General</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-forge-panel p-3">
              <div className="text-sm font-medium">Anthropic API key</div>
              <div className={`mt-1 text-sm ${hasAnthropicKey ? "text-forge-green" : "text-forge-muted"}`}>
                {hasAnthropicKey ? "Present" : "Not present (voice notes use the offline fallback)"}
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
          <h2 className="font-semibold">Capture prompt template</h2>
          <p className="text-sm text-forge-muted">
            This describes the entry types a captured note can split into. The correctness rules — never invent a
            number, enum discipline, how exits link to open trades, your live mistake-tag list — live in code and
            can&apos;t be broken from here.
          </p>
          {promptKeys.map((key) => (
            <TextAreaField
              key={key}
              label={promptLabels[key]}
              name={key}
              defaultValue={settings.promptTemplates[key]}
              rows={12}
            />
          ))}
        </section>

        <button className="button" type="submit">Save settings</button>
      </form>
    </main>
  );
}

function StorageBanner({ storage }: { storage: ReturnType<typeof storageStatus> }) {
  if (storage.mode === "firestore") {
    return (
      <div className="rounded-lg border-l-4 border-forge-green bg-forge-panel p-3 text-sm">
        <div className="font-medium text-forge-green">Storage: Durable (Firebase Firestore)</div>
        <div className="mt-1 text-forge-muted">
          Your journal is saved to Firestore using {storage.source === "service-account" ? "a service account" : "application default credentials"}. Safe on Vercel and across redeploys.
        </div>
      </div>
    );
  }
  if (storage.mode === "invalid") {
    return (
      <div className="rounded-lg border-l-4 border-forge-red bg-forge-panel p-3 text-sm">
        <div className="font-medium text-forge-red">Storage misconfigured</div>
        <div className="mt-1">{storage.message}</div>
      </div>
    );
  }
  return (
    <div className="rounded-lg border-l-4 border-amber-500 bg-forge-panel p-3 text-sm">
      <div className="font-medium text-amber-700">Storage: Local file (not safe on Vercel)</div>
      <div className="mt-1 text-forge-muted">
        No Firebase credentials detected. Writes go to <code>data/tradeforge-store.json</code> on this machine&apos;s disk. This is fine for local development; on Vercel this file is ephemeral and entries can disappear on every deploy. Set <code>FIREBASE_PROJECT_ID</code>, <code>FIREBASE_CLIENT_EMAIL</code>, <code>FIREBASE_PRIVATE_KEY</code> (and <code>FIREBASE_STORAGE_BUCKET</code>) to switch to durable storage.
      </div>
    </div>
  );
}
