import { Suspense } from "react";
import { format } from "date-fns";
import { CloudUpload, Download, Eye, EyeOff, Lock, Pencil, ShieldCheck, SlidersHorizontal, Stethoscope, Tags, X } from "lucide-react";
import {
  toggleFeatureAction,
  hideTagAction,
  removeCustomMistakeTagAction,
  removeCustomOptionAction,
  renameCustomMistakeTagAction,
  renameCustomOptionAction,
  restoreBackupAction,
  runBackupNowAction,
  checkBackupConnectionAction,
  saveSettingsAction,
  setDisplayCurrencyAction,
  showTagAction,
  testAiConnectionAction,
} from "@/app/actions";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { activeModel } from "@/lib/ai-status";
import { checkDestination, destinationEnv } from "@/lib/backup-github";
import { defaultMistakeTagNames, marketTypes } from "@/lib/constants";
import { FEATURE_TOGGLES, featureEnabled } from "@/lib/feature-flags";
import { USAGE_GROUPS } from "@/lib/feature-usage";
import { db, getTagVocabulary } from "@/lib/data";
import { getOptionCatalog, optionGroupKeys, optionGroups } from "@/lib/options";
import { promptLabels, type PromptTemplateKey } from "@/lib/prompts";
import { getRole } from "@/lib/role";
import { getSettings, type AppSettings } from "@/lib/settings-store";
import { siteAuthConfigured, viewerAuthConfigured } from "@/lib/site-auth";
import { storageStatus } from "@/lib/store";
import { colocation, deploymentInfo } from "@/lib/deployment-info";

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
  const backupCheck = single(params.backupCheck);
  const backupCheckDetail = single(params.backupCheckDetail);
  const backupRun = single(params.backupRun);
  const backupRunDetail = single(params.backupRunDetail);
  const backupRunCommit = single(params.backupRunCommit);
  const aiCheckDetail = single(params.aiCheckDetail);
  const aiCheckModel = single(params.aiCheckModel);
  const siteLocked = siteAuthConfigured();
  const role = await getRole();
  const viewerLocked = viewerAuthConfigured();

  return (
    <main className="page-shell max-w-4xl">
      <PageTitle title="Settings" subtitle="Local preferences only. The API key status is shown, not stored here." />

      {siteLocked ? (
        <section className="panel mb-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-forge-panel p-3">
            <div className="flex items-center gap-2 text-sm">
              <Lock className="h-4 w-4 text-forge-blue" aria-hidden="true" />
              <div>
                <div className="font-medium">
                  Site is password-locked{role === "viewer" ? " — you're signed in read-only" : ""}
                </div>
                <div className="text-forge-muted">A password gate covers the whole app. This clears your login on this device.</div>
              </div>
            </div>
            <a className="button-secondary" href="/logout">Log out</a>
          </div>

          {role === "owner" ? (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-forge-panel p-3 text-sm">
              <ShieldCheck className={`h-4 w-4 ${viewerLocked ? "text-forge-green" : "text-forge-muted"}`} aria-hidden="true" />
              <div>
                <div className="font-medium">
                  Viewer access {viewerLocked ? "is on" : "is off"}
                </div>
                <div className="text-forge-muted">
                  {viewerLocked
                    ? "Anyone with the viewer password can browse every page but can't save, delete, or export anything."
                    : "Set a VIEWER_PASSWORD in Vercel → Settings → Environment Variables to hand someone a read-only link, without giving them your own password."}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel mb-5 space-y-3">
        <h2 className="font-semibold">Base currency</h2>
        <div className="rounded-lg bg-forge-panel p-3 text-sm">
          <p className="text-forge-muted">
            You trade an INR margin account and a USDT one. Every number that gets <span className="font-medium text-forge-ink">added up</span> —
            a day&apos;s P&amp;L, the week strip, the equity curve, every analytics table — is converted into this currency first, at the rate
            CoinDCX itself recorded on the day of the trade. Without that, a +10 USDT trade and a +100 INR trade would add to 110 when the
            honest answer is nearer 1,100.
          </p>
          <p className="mt-2 text-forge-muted">
            What each trade is <span className="font-medium text-forge-ink">stored</span> as never changes — its own page keeps showing the
            exchange&apos;s numbers in the wallet they settled in, so you can always check a trade against your CoinDCX statement.
          </p>
          <form action={setDisplayCurrencyAction} className="mt-3 flex flex-wrap items-center gap-2">
            <SelectField
              label="Totals in"
              name="displayCurrency"
              options={["INR", "USDT"]}
              defaultValue={settings.displayCurrency}
            />
            <button className="button-secondary self-end" type="submit">Save</button>
          </form>
        </div>
      </section>

      <section className="panel mb-5 space-y-3" id="backup">
        <h2 className="font-semibold">Data &amp; backup</h2>
        <StorageBanner storage={storage} />

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-forge-panel p-3">
          <div className="text-sm">
            <div className="font-medium">Download a copy now</div>
            <div className="text-forge-muted">One JSON file with every trade, note, journal, lesson and setting. Keep it anywhere you like.</div>
          </div>
          <a className="button-secondary" href="/api/export" download>
            <Download className="h-4 w-4" aria-hidden="true" />
            Export backup
          </a>
        </div>

        <Suspense fallback={<div className="rounded-lg bg-forge-panel p-3 text-sm text-forge-muted">Checking offsite backup…</div>}>
          <OffsiteBackupPanel />
        </Suspense>
        {backupCheck ? <BackupNotice tone={backupCheck === "ready" ? "good" : backupCheck === "off" ? "neutral" : "bad"} title={backupCheck === "ready" ? "Connected" : backupCheck === "off" ? "Not set up yet" : "Not working"} detail={backupCheckDetail} /> : null}
        {backupRun ? (
          <BackupNotice
            tone={backupRun === "ok" ? "good" : backupRun === "failed" ? "bad" : "neutral"}
            title={
              backupRun === "ok" ? "Backed up" :
              backupRun === "unchanged" ? "Nothing to back up" :
              backupRun === "blocked" ? "Backup refused" :
              backupRun === "off" ? "Offsite backup is off" : "Backup failed"
            }
            detail={backupRunDetail}
            link={backupRunCommit ? { href: backupRunCommit, label: "See it on GitHub" } : undefined}
          />
        ) : null}

        <details className="rounded-lg bg-forge-panel p-3 text-sm">
          <summary className="cursor-pointer font-medium">Restore from a backup</summary>
          <form action={restoreBackupAction} className="mt-3 space-y-3" encType="multipart/form-data">
            <p className="text-forge-muted">
              Pick a <code>tradegenie-backup.json</code> file — one you downloaded above, or one from the backup
              repository. Nothing is ever deleted by a restore: records the file doesn&rsquo;t mention are left
              exactly as they are.
            </p>
            <input className="input w-full" type="file" name="backupFile" accept="application/json,.json" required />
            <fieldset className="space-y-2">
              <label className="flex items-start gap-2">
                <input type="radio" name="restoreMode" value="fill-gaps" defaultChecked className="mt-1" />
                <span>
                  <span className="font-medium">Put back what&rsquo;s missing</span>
                  <span className="block text-forge-muted">Only adds records that aren&rsquo;t there. Can&rsquo;t overwrite anything you&rsquo;ve written since.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="restoreMode" value="overwrite" className="mt-1" />
                <span>
                  <span className="font-medium">Roll everything back to this file</span>
                  <span className="block text-forge-muted">Also replaces records that exist now — so edits made after this backup was taken are lost.</span>
                </span>
              </label>
            </fieldset>
            <label className="flex items-center gap-2 text-forge-muted">
              <input type="checkbox" name="restoreSettings" value="yes" />
              Restore settings too (currency, hidden tags, prompt edits)
            </label>
            <button className="button-secondary" type="submit">Restore</button>
          </form>
        </details>
      </section>

      <section className="panel mb-5 space-y-3">
        <h2 className="font-semibold">Where this runs</h2>
        <Suspense fallback={<div className="rounded-lg bg-forge-panel p-3 text-sm text-forge-muted">Checking…</div>}>
          <DeploymentPanel />
        </Suspense>
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

      {/* Owner-only. The toggles are POSTs, so middleware.ts already refuses
          them for a read-only viewer — this hides a screen a viewer could not
          act on anyway, rather than being the thing that stops them. */}
      {role === "owner" ? <OptionalFeaturesPanel settings={settings} /> : null}

      <Suspense fallback={<section className="panel mb-5"><p className="text-sm text-forge-muted">Reading your tags…</p></section>}>
        <TagVocabularyPanel />
      </Suspense>

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

// The offsite backup's own status, read live from the backup repository rather
// than from anything this app stores. That matters: a status this app kept for
// itself would keep saying "backed up" long after the backups had stopped, and
// a backup you wrongly believe you have is worse than none. Wrapped in its own
// <Suspense> so a slow or unreachable GitHub can never hold up the rest of the
// settings page — same treatment as the deployment panel.
async function OffsiteBackupPanel() {
  const check = await checkDestination();

  if (check.status === "off") {
    // Setting this up is the ONE moment the panel is read closely, so it says
    // exactly what the app can and cannot see rather than a generic "off".
    // Without this, a variable that is present but misspelled or malformed
    // looks identical to one that was never added — and the two have completely
    // different fixes.
    const env = destinationEnv();
    return (
      <div className="rounded-lg border-l-4 border-forge-muted bg-forge-panel p-3 text-sm">
        <div className="font-medium">Automatic offsite backup: off</div>
        <div className="mt-1 text-forge-muted">
          Nothing is being copied anywhere, and no journal data leaves this app.
        </div>
        <ul className="mt-2 space-y-1">
          <li>
            <code>BACKUP_GITHUB_REPO</code>:{" "}
            {env.repoMalformed ? (
              <span className="text-forge-red">
                set to &ldquo;{env.repo}&rdquo; — that isn&rsquo;t <code>owner/repo</code>. It needs the owner in
                front, e.g. <code>instatank/tradegenie-backups</code>.
              </span>
            ) : env.repoSet ? (
              <span className="text-forge-green">{env.repo}</span>
            ) : (
              <span className="text-forge-red">not set</span>
            )}
          </li>
          <li>
            <code>BACKUP_GITHUB_TOKEN</code>:{" "}
            {env.tokenSet ? (
              <span className="text-forge-green">set</span>
            ) : (
              <span className="text-forge-red">not set</span>
            )}
          </li>
        </ul>
        {/* "Off" means at least one of the two above is missing or malformed —
            both present and well-formed is by definition not this state — so the
            fix is always the same one, and there is no second case to branch on. */}
        <div className="mt-2 text-forge-muted">
          Fix the red line in Vercel &rarr; your project &rarr; Settings &rarr; Environment Variables
          (Production), then <strong>redeploy</strong>. Environment variables only reach a NEW build, so
          this page cannot see them until you do.
        </div>
        <BackupButtons />
      </div>
    );
  }

  if (check.status === "problem") {
    return (
      <div className="rounded-lg border-l-4 border-forge-red bg-forge-panel p-3 text-sm">
        <div className="font-medium text-forge-red">Automatic offsite backup is not working</div>
        <div className="mt-1 text-forge-muted">{check.detail}</div>
        <BackupButtons />
      </div>
    );
  }

  // A backup that silently stopped looks exactly like one that is working,
  // so staleness is called out rather than left to be noticed.
  const stale = check.lastBackupAt ? Date.now() - new Date(check.lastBackupAt).getTime() > STALE_AFTER_MS : true;
  return (
    <div className={`rounded-lg border-l-4 bg-forge-panel p-3 text-sm ${stale ? "border-forge-red" : "border-forge-green"}`}>
      <div className={`font-medium ${stale ? "text-forge-red" : "text-forge-green"}`}>
        {check.lastBackupAt
          ? stale
            ? "Offsite backup is out of date"
            : "Offsite backup is on"
          : "Offsite backup is on — nothing backed up yet"}
      </div>
      <div className="mt-1 text-forge-muted">
        {check.lastBackupAt ? (
          <>
            Last copy {format(new Date(check.lastBackupAt), "d MMM yyyy, HH:mm")}
            {check.lastBackupRecords == null ? "" : ` — ${check.lastBackupRecords} records`}. Runs every Sunday.
          </>
        ) : (
          <>Runs every Sunday. Press &ldquo;Back up now&rdquo; if you don&rsquo;t want to wait.</>
        )}
        {" "}
        <a className="underline" href={check.repoUrl} target="_blank" rel="noreferrer">
          Open the backup repository
        </a>
        .
      </div>
      <BackupButtons />
    </div>
  );
}

/** A week and a half: long enough that a missed Sunday isn't an alarm, short
 *  enough that two missed ones are. */
const STALE_AFTER_MS = 10 * 24 * 60 * 60 * 1000;

function BackupButtons() {
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <form action={runBackupNowAction}>
        <button className="button-secondary" type="submit">
          <CloudUpload className="h-4 w-4" aria-hidden="true" />
          Back up now
        </button>
      </form>
      <form action={checkBackupConnectionAction}>
        <button className="button-secondary" type="submit">
          <Stethoscope className="h-4 w-4" aria-hidden="true" />
          Check connection
        </button>
      </form>
    </div>
  );
}

function BackupNotice({
  tone,
  title,
  detail,
  link,
}: {
  tone: "good" | "bad" | "neutral";
  title: string;
  detail: string;
  link?: { href: string; label: string };
}) {
  const border = tone === "good" ? "border-forge-green" : tone === "bad" ? "border-forge-red" : "border-forge-muted";
  const text = tone === "good" ? "text-forge-green" : tone === "bad" ? "text-forge-red" : "";
  return (
    <div className={`rounded-lg border-l-4 bg-forge-panel p-3 text-sm ${border}`}>
      <div className={`font-medium ${text}`}>{title}</div>
      <div className="mt-1 text-forge-muted">{detail}</div>
      {link ? (
        <a className="mt-1 inline-block underline" href={link.href} target="_blank" rel="noreferrer">
          {link.label}
        </a>
      ) : null}
      {/* A refused backup is recoverable by the owner, so say how. */}
      {title === "Backup refused" ? (
        <form action={runBackupNowAction} className="mt-2">
          <input type="hidden" name="force" value="yes" />
          <button className="button-secondary" type="submit">
            Back up anyway
          </button>
        </form>
      ) : null}
    </div>
  );
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

// Two numbers that decide most of the page-load latency: the distance from the
// browser to the function, and from the function to the database. Both are
// invisible from inside the app otherwise, and after a region change this is
// how we confirm it actually took effect.
async function DeploymentPanel() {
  const info = await deploymentInfo();
  const proximity = colocation(info);
  const tone =
    proximity.verdict === "together"
      ? "border-forge-green"
      : proximity.verdict === "apart"
        ? "border-amber-500"
        : "border-forge-line";
  return (
    <div className={`rounded-lg border-l-4 ${tone} bg-forge-panel p-3 text-sm`}>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div>
          <dt className="text-forge-muted">Function region</dt>
          <dd className="font-medium">{info.functionRegion ?? "Not on Vercel (local)"}</dd>
        </div>
        <div>
          <dt className="text-forge-muted">Firestore location</dt>
          <dd className="font-medium">{info.firestoreLocation ?? "Unknown"}</dd>
        </div>
      </dl>
      <div className="mt-2 text-forge-muted">{proximity.detail}</div>
      {info.firestoreLocationNote ? (
        <div className="mt-1 text-xs text-forge-muted">{info.firestoreLocationNote}</div>
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

// The lifecycle screen (playbook/LIFECYCLE.md in instatank/time-tracker).
//
// Two halves that answer two different questions. The toggles answer "what is
// switched on"; the usage list answers "what do I actually use" — which is the
// question the monthly census runs on, and the one this app could not answer at
// all before it existed.
//
// The usage half is READ-ONLY. It renders numbers and writes nothing: a screen
// that reported on use and changed it in the same breath would make its own
// numbers untrustworthy. It is also deliberately not hidden behind a fold — it
// is the "you were reminded this exists" half of §R4's fair-trial rule, and a
// reminder nobody unfolds is not a reminder.
function OptionalFeaturesPanel({ settings }: { settings: AppSettings }) {
  const usage = settings.featureUsage ?? {};
  // An id that is counted but not catalogued lists under "Other" rather than
  // disappearing — instrumenting something and forgetting to label it should
  // cost a tidy name, not a silently invisible number.
  const cataloged = new Set(USAGE_GROUPS.flatMap((group) => group.ids.map((entry) => entry.id)));
  const strays = Object.keys(usage).filter((id) => !cataloged.has(id)).sort();
  const groups = [
    ...USAGE_GROUPS,
    ...(strays.length ? [{ label: "Other", note: undefined, ids: strays.map((id) => ({ id, label: id })) }] : []),
  ];
  const totalUses = Object.values(usage).reduce((sum, entry) => sum + (entry?.n ?? 0), 0);

  return (
    <section className="panel mb-5 space-y-4" id="optional-features">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <SlidersHorizontal className="h-4 w-4 text-forge-blue" aria-hidden="true" />
          Optional features
        </h2>
        <p className="mt-1 text-sm text-forge-muted">
          Features on trial. Each one is off until you switch it on, and each has a written note in{" "}
          <code>docs/lifecycle.md</code> saying what would make it earn its place — decided before it was built, so it
          can&apos;t be talked into staying afterwards.
        </p>
      </div>

      {FEATURE_TOGGLES.length === 0 ? (
        <p className="rounded-lg bg-forge-panel px-3 py-2 text-sm text-forge-muted">
          Nothing is on trial right now. That is the normal state — a switch here means a feature is being tried out
          and might not stay, so an empty list means everything in the app is just part of the app.
        </p>
      ) : (
        <ul className="space-y-2">
          {FEATURE_TOGGLES.map((toggle) => {
            const on = featureEnabled(toggle.key, settings);
            const used = usage[toggle.key];
            return (
              <li key={toggle.key} className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-forge-panel p-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">{toggle.label}</div>
                  <div className="text-forge-muted">{toggle.desc}</div>
                  <div className="mt-1 text-xs text-forge-muted">
                    {used ? `Used ${used.n === 1 ? "once" : `${used.n}×`} · last ${format(new Date(used.last), "d MMM yyyy")}` : "Never used"}
                    {" · "}
                    {stageLabel(toggle.stage)} · {exitCostLabel(toggle.exitCost)}
                  </div>
                </div>
                <form action={toggleFeatureAction}>
                  <input type="hidden" name="key" value={toggle.key} />
                  <button className={on ? "button" : "button-secondary"} type="submit">
                    {on ? "On" : "Off"}
                  </button>
                </form>
              </li>
            );
          })}
        </ul>
      )}

      <details className="rounded-lg bg-forge-panel p-3 text-sm">
        <summary className="cursor-pointer font-medium">
          Usage — what you actually use ({totalUses === 0 ? "nothing counted yet" : `${totalUses} recorded`})
        </summary>
        <p className="mt-2 text-forge-muted">
          Counted when you <span className="font-medium text-forge-ink">do</span> something, not when you visit a page —
          opening a screen and backing out of it is not use. Nothing here leaves this journal. Read-only: this list
          changes nothing.
        </p>
        <div className="mt-3 space-y-4">
          {groups.map((group) => (
            <div key={group.label}>
              <div className="font-medium">{group.label}</div>
              {group.note ? <div className="text-xs text-forge-muted">{group.note}</div> : null}
              <table className="mt-1 min-w-full text-sm">
                <tbody>
                  {group.ids.map((entry) => {
                    const used = usage[entry.id];
                    return (
                      <tr key={entry.id} className={`border-t border-forge-line ${used ? "" : "text-forge-muted"}`}>
                        <td className="py-1 pr-3">{entry.label}</td>
                        <td className="w-20 py-1 text-right tabular-nums">{used ? used.n : "—"}</td>
                        <td className="w-32 py-1 text-right text-xs text-forge-muted">
                          {used ? format(new Date(used.last), "d MMM yyyy") : "never"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </details>
    </section>
  );
}

// Plain English, because the codes mean nothing to the person reading the screen.
function stageLabel(stage: string) {
  if (stage === "S0") return "sketched, not built";
  if (stage === "S1") return "on trial";
  if (stage === "S2") return "on by default";
  return "part of the app";
}

function exitCostLabel(cost: string) {
  if (cost === "REVERSIBLE") return "removing it is a clean delete";
  if (cost === "STICKY") return "removing it leaves a field behind on old records";
  return "removing it is an architecture change";
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


// The tag vocabulary, and the one piece of housekeeping it needs: keeping the
// pickers uncrowded. Hiding is picker-only — a hidden tag still matches in
// search, still shows as a pill, and still appears in the picker on a record
// that already carries it, so nothing you wrote is ever changed here.
//
// Deliberately NOT a "remove this tag everywhere" button: tags are derived from
// the text on every full save, so a tag typed as an inline #hashtag would come
// straight back and look like the delete had failed.
async function TagVocabularyPanel() {
  const vocabulary = await getTagVocabulary({ includeHidden: true });
  const visible = vocabulary.filter((entry) => !entry.hidden);
  const hidden = vocabulary.filter((entry) => entry.hidden);

  return (
    <section className="panel mb-5 space-y-3">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <Tags className="h-4 w-4 text-forge-blue" aria-hidden="true" />
          Your tags
        </h2>
        <p className="mt-1 text-sm text-forge-muted">
          Every tag you&apos;ve used, most recent first. Retiring one takes it out of the tag pickers so they stay
          uncrowded — it changes nothing on your records, and search still finds it.
        </p>
      </div>

      {!vocabulary.length ? (
        <p className="rounded-lg bg-forge-panel px-3 py-2 text-sm text-forge-muted">
          No tags yet. Type <span className="font-medium">#something</span> in any note, thesis or lesson.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-forge-line">
          <table className="min-w-full text-sm">
            <thead className="bg-forge-panel">
              <tr>
                {["Tag", "Used", "Last used", "Where", ""].map((header) => (
                  <th key={header} className="px-3 py-2 text-left font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...visible, ...hidden].map((entry) => (
                <tr key={entry.tag} className={`border-t border-forge-line ${entry.hidden ? "bg-forge-panel/40 text-forge-muted" : ""}`}>
                  <td className="px-3 py-2 font-medium">#{entry.tag}</td>
                  <td className="px-3 py-2">
                    {entry.count === 1 ? "once" : `${entry.count}×`}
                  </td>
                  <td className="px-3 py-2">{format(entry.lastUsed, "d MMM yyyy")}</td>
                  <td className="px-3 py-2 text-forge-muted">{entry.kinds.join(", ")}</td>
                  <td className="px-3 py-2 text-right">
                    <form action={entry.hidden ? showTagAction : hideTagAction}>
                      <input type="hidden" name="tag" value={entry.tag} />
                      <button
                        type="submit"
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-forge-muted transition hover:bg-forge-panel hover:text-forge-ink"
                      >
                        {entry.hidden ? (
                          <>
                            <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                            Bring back
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                            Retire
                          </>
                        )}
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hidden.length ? (
        <p className="text-xs text-forge-muted">
          {hidden.length} retired tag{hidden.length === 1 ? "" : "s"} — still on every record that carried them, just not
          offered as chips any more.
        </p>
      ) : null}
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
