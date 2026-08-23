import Link from "next/link";
import { ClipboardCheck, Pencil, Trash2 } from "lucide-react";
import { createSetupAction, deleteSetupAction, toggleSetupActiveAction, updateSetupAction } from "@/app/actions";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { TagPicker } from "@/components/TagPicker";
import { humanize, setupDirectionBiases } from "@/lib/constants";
import { db, getTagVocabulary, getTradesWithMistakes } from "@/lib/data";
import { isThinSample, MIN_SAMPLE, setupPerformance } from "@/lib/metrics";
import { checklistLines, setupSteps } from "@/lib/setups";

export default async function PlaybookPage() {
  const [setups, trades, tagVocabulary] = await Promise.all([db.list("setups"), getTradesWithMistakes(), getTagVocabulary()]);
  const tagNames = tagVocabulary.map((entry) => entry.tag);
  const nameById = new Map(setups.map((setup) => [setup.id, setup.name]));
  const performance = new Map(setupPerformance(trades, nameById).map((bucket) => [bucket.key, bucket]));
  const sortedSetups = [...setups].sort((a, b) => Number(b.isActive) - Number(a.isActive) || a.name.localeCompare(b.name));

  return (
    <main className="page-shell">
      <PageTitle title="Playbook" subtitle="Define your setups once. Every trade scores itself against them so you can see which edge is real." />

      <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <form action={createSetupAction} className="panel h-fit space-y-3">
          <h2 className="font-semibold">Add a setup</h2>
          <TextField label="Name" name="name" required placeholder="Range reclaim, Failed breakout..." />
          <SelectField label="Direction bias" name="directionBias" options={setupDirectionBiases} defaultValue="BOTH" />
          <TextField label="Ideal risk:reward (e.g. 2)" name="idealRiskReward" type="number" step="0.1" />
          <TextAreaField label="Rules (what must be true to take it)" name="rules" rows={4} />
          <TextAreaField label="Entry checklist — one step per line" name="checklist" rows={5} placeholder={"HTF bias / trend\nMTF + LTF market structure\nDisplacement\nLiquidity taken\nEntry (OTE, OB, FVG)"} />
          <p className="-mt-1 text-xs text-forge-muted">Each line becomes a tick chip on every trade you take on this setup.</p>
          <TextAreaField label="Notes" name="notes" rows={2} />
          <TagPicker vocabulary={tagNames} />
          <button className="button" type="submit">Add setup</button>
        </form>

        <div className="space-y-3">
          {sortedSetups.map((setup) => {
            const stats = performance.get(setup.id);
            return (
              <details key={setup.id} className={`panel ${setup.isActive ? "" : "opacity-60"}`} open={false}>
                <summary className="grid cursor-pointer gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {setup.name}
                      <span className="ml-2 text-xs font-normal text-forge-muted">{humanize(setup.directionBias)}{setup.idealRiskReward ? ` · ${setup.idealRiskReward}R target` : ""}</span>
                      {!setup.isActive ? <span className="ml-2 rounded-md bg-forge-panel px-2 py-0.5 text-xs">Archived</span> : null}
                    </p>
                    <p className="mt-1 text-sm text-forge-muted">
                      {stats ? `${stats.count} closed · win ${stats.winRate == null ? "NA" : `${(stats.winRate * 100).toFixed(0)}%`} · exp ${stats.expectancyR == null ? "NA" : `${stats.expectancyR.toFixed(2)}R`}` : "No closed trades yet"}
                    </p>
                  </div>
                  <SetupStat stats={stats} />
                </summary>

                {setupSteps(setup.checklist).length ? (
                  <Link
                    href={`/playbook/${setup.id}/run`}
                    className="mt-4 inline-flex items-center gap-2 rounded-lg border border-forge-blue/40 bg-sky-50 px-3 py-2 text-sm font-medium text-forge-blue transition hover:border-forge-blue hover:bg-sky-100"
                  >
                    <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
                    Run this setup — tick the model before you enter
                  </Link>
                ) : null}

                <div className="mt-4 space-y-3 text-sm">
                  {setup.rules ? <Block label="Rules" body={setup.rules} /> : null}
                  {setup.checklist ? <Checklist checklist={setup.checklist} /> : null}
                  {setup.notes ? <Block label="Notes" body={setup.notes} /> : null}
                </div>

                <div className="mt-4 flex justify-end gap-1">
                  <form action={toggleSetupActiveAction}>
                    <input type="hidden" name="id" value={setup.id} />
                    <input type="hidden" name="isActive" value={String(setup.isActive)} />
                    <button className="button-secondary min-h-8 px-2" type="submit">{setup.isActive ? "Archive" : "Reactivate"}</button>
                  </form>
                  <form action={deleteSetupAction}>
                    <input type="hidden" name="id" value={setup.id} />
                    <button className="button-danger min-h-8 px-2" type="submit" title="Delete setup" aria-label="Delete setup">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </form>
                </div>

                <details className="mt-4 rounded-lg border border-forge-line p-3">
                  <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                    <Pencil className="h-4 w-4 text-forge-blue" aria-hidden="true" />
                    Edit setup
                  </summary>
                  <form action={updateSetupAction} className="mt-4 space-y-3">
                    <input type="hidden" name="id" value={setup.id} />
                    <TextField label="Name" name="name" defaultValue={setup.name} />
                    <SelectField label="Direction bias" name="directionBias" options={setupDirectionBiases} defaultValue={setup.directionBias} />
                    <TextField label="Ideal risk:reward" name="idealRiskReward" type="number" step="0.1" defaultValue={setup.idealRiskReward} />
                    <TextAreaField label="Rules" name="rules" defaultValue={setup.rules} rows={4} />
                    <TextAreaField label="Entry checklist — one step per line" name="checklist" defaultValue={setup.checklist} rows={5} placeholder={"HTF bias / trend\nMTF + LTF market structure\nDisplacement\nLiquidity taken\nEntry (OTE, OB, FVG)"} />
                    <p className="-mt-1 text-xs text-forge-muted">Each line becomes a tick chip on every trade you take on this setup.</p>
                    <TextAreaField label="Notes" name="notes" defaultValue={setup.notes} rows={2} />
                    <TagPicker selected={setup.tags ?? []} vocabulary={tagNames} />
                    <button className="button-secondary" type="submit">Save setup</button>
                  </form>
                </details>
              </details>
            );
          })}
          {!sortedSetups.length ? <div className="panel muted">No setups yet. Add your first one — even a rough version beats freeform.</div> : null}
        </div>
      </section>
    </main>
  );
}

function SetupStat({ stats }: { stats?: { expectancyR: number | null; netPnl: number; count: number } }) {
  if (!stats) return null;
  // Same honesty rule as the analytics tables: under MIN_SAMPLE closed trades
  // the number is shown, but not in a colour that reads as a verdict.
  const light = isThinSample(stats.count);
  const positive = (stats.expectancyR ?? 0) >= 0;
  return (
    <div className="text-right">
      <div className={`text-lg font-semibold ${light ? "text-forge-muted" : positive ? "text-forge-green" : "text-forge-red"}`}>
        {stats.expectancyR == null ? "NA" : `${stats.expectancyR.toFixed(2)}R`}
      </div>
      <div className="text-xs text-forge-muted">
        {light ? `too few trades to read (${stats.count}/${MIN_SAMPLE})` : "expectancy / trade"}
      </div>
    </div>
  );
}

// The checklist, shown as the steps a trade will actually tick — so what you
// see here is exactly what the trade form offers. A line too long to be a step
// (a paragraph of prose) still reads, it just isn't numbered; a line that reads
// like a step but is too long to tokenize says so, rather than disappearing.
function Checklist({ checklist }: { checklist: string }) {
  const lines = checklistLines(checklist);
  const tickable = lines.filter((line) => line.value).length;
  if (!tickable) return <Block label="Checklist" body={checklist} />;
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-forge-muted">
        Checklist · {tickable} step{tickable === 1 ? "" : "s"} you can tick on a trade
      </div>
      <ol className="mt-1 space-y-1">
        {lines.map((line, index) => (
          <li key={line.label} className={`flex gap-2 ${line.value ? "" : "text-forge-muted"}`}>
            <span className="text-forge-muted">{index + 1}.</span>
            <span>
              {line.label}
              {line.value ? null : <span className="ml-2 text-xs">· too long to tick — shorten it to make it a chip</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Block({ label, body }: { label: string; body: string }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-forge-muted">{label}</div>
      <p className="mt-1 whitespace-pre-wrap">{body}</p>
    </div>
  );
}
