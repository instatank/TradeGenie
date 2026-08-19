import { Download, Pencil, Stethoscope, X } from "lucide-react";
import {
  removeCustomMistakeTagAction,
  removeCustomOptionAction,
  renameCustomMistakeTagAction,
  renameCustomOptionAction,
  saveSettingsAction,
  testAiConnectionAction,
} from "@/app/actions";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { activeModel } from "@/lib/ai-status";
import { defaultMistakeTagNames, marketTypes } from "@/lib/constants";
import { db } from "@/lib/data";
import { getOptionCatalog, optionGroupKeys, optionGroups } from "@/lib/options";
import { promptLabels, type PromptTemplateKey } from "@/lib/prompts";
import { getSettings } from "@/lib/settings-store";
import { storageStatus } from "@/lib/store";

// One template now — the capture pipeline makes a single call that returns every
// entry, so there is no per-note-type routing left to configure.
const promptKeys: PromptTemplateKey[] = ["capture"];

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const settings = await getSettings();
  const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  const storage = storageStatus();
  const aiCheck = single(params.aiCheck);
  const aiCheckDetail = single(params.aiCheckDetail);
  const aiCheckModel = single(params.aiCheckModel);

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

      <section className="panel mb-5 space-y-3">
        <h2 className="font-semibold">AI status</h2>
        <div className="rounded-lg bg-forge-panel p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="font-medium">
                API key:{" "}
                <span className={hasAnthropicKey ? "text-forge-green" : "text-forge-red"}>
                  {hasAnthropicKey ? "present" : "not set"}
                </span>
                {" · "}AI enabled:{" "}
                <span className={settings.aiEnabled ? "text-forge-green" : "text-forge-red"}>
                  {settings.aiEnabled ? "yes" : "no"}
                </span>
              </div>
              <div className="mt-1 text-forge-muted">
                Model: <code>{activeModel()}</code>. Both must be green or captured notes stay as plain text.
              </div>
            </div>
            <form action={testAiConnectionAction}>
              <button className="button-secondary" type="submit">
                <Stethoscope className="h-4 w-4" aria-hidden="true" />
                Test AI connection
              </button>
            </form>
          </div>
        </div>
        {aiCheck ? <AiCheckResult ok={aiCheck === "ok"} detail={aiCheckDetail} model={aiCheckModel} /> : null}
      </section>

      <CustomLabelsPanel />

      <form action={saveSettingsAction} className="space-y-5">
        <section className="panel space-y-4">
          <h2 className="font-semibold">General</h2>
          <div className="grid gap-4 sm:grid-cols-2">
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

function single(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function AiCheckResult({ ok, detail, model }: { ok: boolean; detail: string; model: string }) {
  return (
    <div className={`rounded-lg border-l-4 p-3 text-sm ${ok ? "border-forge-green bg-forge-panel" : "border-forge-red bg-forge-panel"}`}>
      <div className={`font-medium ${ok ? "text-forge-green" : "text-forge-red"}`}>
        {ok ? "AI is working" : "AI is not working"}
        {model ? ` — ${model}` : ""}
      </div>
      <div className="mt-1 text-forge-muted">{detail}</div>
      {!ok ? (
        <div className="mt-2 text-forge-muted">
          Until this passes, captured notes are saved as a single plain thought instead of being split into
          trades, lessons and journal entries.
        </div>
      ) : null}
    </div>
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

// Everything the trader has added to a preset-pill list, in one place to review
// or retire. Adding happens where the work happens (the "type another" box on
// each picker); this panel exists only so the vocabulary can be pruned without
// hunting for the form that created it.
async function CustomLabelsPanel() {
  const [options, mistakeTags] = await Promise.all([getOptionCatalog(), db.list("mistakeTags")]);
  const customMistakes = mistakeTags
    .filter((tag) => !defaultMistakeTagNames.has(tag.name))
    .sort((a, b) => a.label.localeCompare(b.label));
  const groups = optionGroupKeys
    .map((key) => ({ key, title: optionGroups[key].title, entries: options.custom(key) }))
    .filter((group) => group.entries.length);
  const total = groups.reduce((sum, group) => sum + group.entries.length, 0) + customMistakes.length;

  return (
    <section className="panel mb-5 space-y-3">
      <div>
        <h2 className="font-semibold">Your own labels</h2>
        <p className="mt-1 text-sm text-forge-muted">
          The moods, market conditions, mistakes, categories and timeframes you added yourself. Add a new one from any
          picker&apos;s &ldquo;type another&rdquo; box — this is just where you retire one you no longer use.
        </p>
      </div>

      {total === 0 ? (
        <p className="rounded-lg bg-forge-panel px-3 py-2 text-sm text-forge-muted">
          Nothing yet. Type a label into any pill row — a mood on the morning check-in, a mistake in a trade review, a
          market condition on a trade — and it shows up here.
        </p>
      ) : (
        <div className="space-y-4">
          {customMistakes.length ? (
            <LabelGroup title="Trade review — mistakes">
              {customMistakes.map((tag) => (
                <LabelChip
                  key={tag.id}
                  id={tag.id}
                  label={tag.label}
                  action={removeCustomMistakeTagAction}
                  renameAction={renameCustomMistakeTagAction}
                />
              ))}
            </LabelGroup>
          ) : null}
          {groups.map((group) => (
            <LabelGroup key={group.key} title={group.title}>
              {group.entries.map((entry) => (
                <LabelChip
                  key={entry.id}
                  id={entry.id}
                  label={entry.label}
                  action={removeCustomOptionAction}
                  renameAction={renameCustomOptionAction}
                />
              ))}
            </LabelGroup>
          ))}
          <p className="text-xs text-forge-muted">
            Tap a label to rename or retire it. Renaming changes how it reads everywhere, including on entries that
            already carry it. Removing only takes it out of the pickers. Entries that already carry it keep it — except a mistake
            tag, which trades link to by id, so removing one un-tags those trades and says how many.
          </p>
        </div>
      )}
    </section>
  );
}

function LabelGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-forge-muted">{title}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// Tapping a label opens its housekeeping: rename it, or retire it. Both live
// behind the same tap because both are rare — this panel exists for the once-in-
// a-while tidy-up, not for the daily loop. Two sibling forms, never nested, so
// neither submit can swallow the other. Zero client JS, like every other pill.
function LabelChip({
  id,
  label,
  action,
  renameAction,
}: {
  id: string;
  label: string;
  action: (formData: FormData) => Promise<void>;
  renameAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <details className="inline-block align-top">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-forge-line bg-white px-3 py-1 text-sm transition hover:border-forge-blue hover:text-forge-blue">
        {label}
        <Pencil className="h-3 w-3 text-forge-muted" aria-hidden="true" />
      </summary>
      <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-forge-line bg-forge-panel p-2">
        <form action={renameAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={id} />
          <label className="sr-only" htmlFor={`rename-${id}`}>{`Rename ${label}`}</label>
          <input id={`rename-${id}`} name="label" defaultValue={label} className="input min-h-8 w-44 text-sm" />
          <button className="button-secondary min-h-8 px-2 text-sm" type="submit">Rename</button>
        </form>
        <form action={action}>
          <input type="hidden" name="id" value={id} />
          <button
            type="submit"
            className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-sm text-forge-muted transition hover:bg-red-50 hover:text-forge-red"
            title={`Remove ${label}`}
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Remove
          </button>
        </form>
      </div>
    </details>
  );
}
