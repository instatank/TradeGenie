import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Trash2 } from "lucide-react";
import { deleteAssetAction, saveAssetWorkspaceAction } from "@/app/actions";
import { AssetNoteComposer } from "@/components/AssetNoteComposer";
import { AssetStats } from "@/components/AssetStats";
import { AssetTimeline } from "@/components/AssetTimeline";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { SaveBar } from "@/components/SaveBar";
import { TagPicker } from "@/components/TagPicker";
import { splitTimeline, TIMELINE_RECENT_DAYS } from "@/lib/asset-history";
import { humanize, marketTypes } from "@/lib/constants";
import { getAssetWorkspace, getTagVocabulary } from "@/lib/data";
import { getOptionCatalog, optionGroups } from "@/lib/options";

// The whole page is ONE form: current view, new thread note, and edits to notes
// already in the thread. One Save captures all of it — there is no way to save
// half of what is on screen and lose the rest.
export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [asset, tagVocabulary, options] = await Promise.all([getAssetWorkspace(id), getTagVocabulary(), getOptionCatalog()]);
  if (!asset) notFound();
  const tagNames = tagVocabulary.map((entry) => entry.tag);
  const timeframeChoices = options.choices("assetTimeframe");
  const timeframeLabel = (value: string) => options.label("assetTimeframe", value);
  // Recent by default, older folded — same shape as the calendar. A quiet month
  // still shows its last few entries rather than an empty column above a
  // disclosure.
  const { recent, earlier } = splitTimeline(asset.timeline);

  const timelineProps = {
    baseCurrency: asset.baseCurrency,
    timeframeChoices,
    timeframePlaceholder: optionGroups.assetTimeframe.placeholder,
    timeframeLabel,
    tagVocabulary: tagNames,
    screenshotsByNote: asset.screenshotsByNote,
  };

  return (
    <main className="page-shell pb-28">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <Link href="/assets" className="mb-2 inline-flex items-center gap-1 text-sm text-forge-muted transition hover:text-forge-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All assets
          </Link>
          <PageTitle title={asset.symbol} subtitle={`${humanize(asset.marketType)} · tracked since ${format(asset.createdAt, "dd MMM yyyy")}`} />
        </div>
        {/* Its own form, outside the page form: removing the asset should never
            be entangled with saving it. */}
        <form action={deleteAssetAction}>
          <input type="hidden" name="id" value={asset.id} />
          <button className="button-danger min-h-9 px-3" type="submit" title="Stop tracking this asset" aria-label="Stop tracking this asset">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </div>

      <form action={saveAssetWorkspaceAction}>
        <input type="hidden" name="assetId" value={asset.id} />
        {/* First submit button in the form, so Enter saves everything. */}
        <SaveBar label="Save" hint="Saves your view, your new note and any note edits together." />

        <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
          {/* Current view — always-current, edited in place. The glance you open daily. */}
          <div className="space-y-4 self-start">
            <div className="panel space-y-4">
              <h2 className="font-semibold">Current view</h2>
              <p className="-mt-2 text-xs text-forge-muted">
                Your live snapshot. Edit it as the picture changes — every change is filed into the timeline, so the read you
                replace is never lost.
              </p>
              <TextField label="HTF bias" name="htfBias" defaultValue={asset.htfBias} placeholder="e.g. Accumulation, higher lows intact" />
              <TextField label="LTF bias" name="ltfBias" defaultValue={asset.ltfBias} placeholder="e.g. Pullback to support, watching reaction" />
              <TextAreaField
                label="Levels I'm watching"
                name="levels"
                defaultValue={asset.levels}
                rows={4}
                placeholder={"e.g.\nSupport 38.2 — tracking for hold\nIf breaks → next target 35.0\nSFP off 41.4"}
              />
              <TextAreaField
                label="Current thesis & game plan"
                name="gamePlan"
                defaultValue={asset.gamePlan}
                rows={6}
                placeholder="What you want to do and why — the plan you'd want to re-read tomorrow."
              />
              <SelectField label="Market" name="marketType" options={marketTypes} defaultValue={asset.marketType} />
              <TagPicker selected={asset.tags ?? []} vocabulary={tagNames} label="Tags for this asset" />
            </div>

            {/* Below the current view, not above it. This page is the daily
                glance — its first message should be "here is your plan", not
                "here is your P&L". Same reason the journaling streak rewards
                showing up and never rewards a green day. */}
            <AssetStats
              stats={asset.stats}
              baseCurrency={asset.baseCurrency}
              noteCount={asset.notes.length}
              openTradeCount={asset.openTradeCount}
              symbol={asset.symbol}
            />
          </div>

          {/* The story of this symbol, in one column and in order. */}
          <div className="space-y-4">
            <AssetNoteComposer
              resetKey={`${asset.notes.length}-${asset.notes[0]?.id ?? "none"}`}
              tagVocabulary={tagNames}
              timeframeChoices={timeframeChoices}
              timeframePlaceholder={optionGroups.assetTimeframe.placeholder}
            />

            {asset.timeline.length ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-semibold">The story so far</h2>
                  <p className="text-xs text-forge-muted">
                    Your notes, the moments your read changed, the trades you took
                    {asset.symbolTag ? <> and any quick note tagged #{asset.symbolTag}</> : null} — newest first.
                  </p>
                </div>
                <AssetTimeline items={recent} {...timelineProps} />
                {earlier.length ? (
                  <details className="rounded-xl border border-forge-line bg-white/60 p-3">
                    <summary className="cursor-pointer text-sm font-semibold text-forge-muted hover:text-forge-ink">
                      Show {earlier.length} earlier {earlier.length === 1 ? "entry" : "entries"} (older than {TIMELINE_RECENT_DAYS} days)
                    </summary>
                    <div className="mt-3">
                      <AssetTimeline items={earlier} {...timelineProps} />
                    </div>
                  </details>
                ) : null}
              </div>
            ) : (
              <div className="panel muted">
                Nothing logged yet. Add your first note above — tomorrow you&apos;ll be glad you wrote down what you were watching.
              </div>
            )}
          </div>
        </section>
      </form>
    </main>
  );
}
