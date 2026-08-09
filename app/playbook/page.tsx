import { Pencil, Trash2 } from "lucide-react";
import { createSetupAction, deleteSetupAction, toggleSetupActiveAction, updateSetupAction } from "@/app/actions";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { TagPicker } from "@/components/TagPicker";
import { humanize, setupDirectionBiases } from "@/lib/constants";
import { db, getTagVocabulary, getTradesWithMistakes } from "@/lib/data";
import { setupPerformance } from "@/lib/metrics";

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
          <TextAreaField label="Entry checklist" name="checklist" rows={3} />
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

                <div className="mt-4 space-y-3 text-sm">
                  {setup.rules ? <Block label="Rules" body={setup.rules} /> : null}
                  {setup.checklist ? <Block label="Checklist" body={setup.checklist} /> : null}
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
                    <TextAreaField label="Entry checklist" name="checklist" defaultValue={setup.checklist} rows={3} />
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

function SetupStat({ stats }: { stats?: { expectancyR: number | null; netPnl: number } }) {
  if (!stats) return null;
  const positive = (stats.expectancyR ?? 0) >= 0;
  return (
    <div className="text-right">
      <div className={`text-lg font-semibold ${positive ? "text-forge-green" : "text-forge-red"}`}>
        {stats.expectancyR == null ? "NA" : `${stats.expectancyR.toFixed(2)}R`}
      </div>
      <div className="text-xs text-forge-muted">expectancy / trade</div>
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
