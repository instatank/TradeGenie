import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, Pencil, Trash2 } from "lucide-react";
import { deleteAssetAction, deleteAssetNoteAction, saveAssetWorkspaceAction } from "@/app/actions";
import { AssetNoteComposer } from "@/components/AssetNoteComposer";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { SaveBar } from "@/components/SaveBar";
import { TagPicker } from "@/components/TagPicker";
import { TagPills } from "@/components/TagPills";
import { assetTimeframes, humanize, marketTypes } from "@/lib/constants";
import { getAssetWorkspace, getTagVocabulary } from "@/lib/data";

// The whole page is ONE form: current view, new thread note, and edits to notes
// already in the thread. One Save captures all of it — there is no way to save
// half of what is on screen and lose the rest.
export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [asset, tagVocabulary] = await Promise.all([getAssetWorkspace(id), getTagVocabulary()]);
  if (!asset) notFound();
  const tagNames = tagVocabulary.map((entry) => entry.tag);

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
              <p className="-mt-2 text-xs text-forge-muted">Your live snapshot. Edit it as the picture changes — history lives in the thread.</p>
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

            {asset.relatedTrades.length ? (
              <div className="panel space-y-2">
                <h2 className="font-semibold">Trades on {asset.symbol}</h2>
                {asset.relatedTrades.slice(0, 6).map((trade) => (
                  <Link
                    key={trade.id}
                    href={`/trades/${trade.id}`}
                    className="flex items-center justify-between gap-2 rounded-md border border-forge-line px-3 py-2 text-sm transition hover:border-forge-blue"
                  >
                    <span className="truncate">
                      {humanize(trade.direction)} · {humanize(trade.status)}
                    </span>
                    <span className="shrink-0 text-xs text-forge-muted">{format(trade.tradeDateTime, "dd MMM")}</span>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>

          {/* The thread — append-only running thought log, newest first. */}
          <div className="space-y-4">
            <AssetNoteComposer resetKey={`${asset.notes.length}-${asset.notes[0]?.id ?? "none"}`} tagVocabulary={tagNames} />

            <div className="space-y-3">
              {asset.notes.map((note) => (
                <article key={note.id} id={`note-${note.id}`} className="panel scroll-mt-24">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm text-forge-muted">
                      <span>{format(note.createdAt, "EEE dd MMM yyyy · HH:mm")}</span>
                      {note.timeframe ? (
                        <span className="rounded-md bg-forge-panel px-2 py-0.5 text-xs font-medium text-forge-ink">
                          {note.timeframe}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-base">{note.text}</p>
                  <TagPills tags={note.tags} className="mt-2" />
                  <details className="mt-3 rounded-lg border border-forge-line p-3">
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                      <Pencil className="h-4 w-4 text-forge-blue" aria-hidden="true" />
                      Edit note
                    </summary>
                    <div className="mt-3 space-y-3">
                      <TextAreaField label="Note" name={`noteText-${note.id}`} defaultValue={note.text} rows={5} />
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <SelectField
                          label="Timeframe"
                          name={`noteTimeframe-${note.id}`}
                          options={assetTimeframes}
                          includeBlank
                          defaultValue={note.timeframe}
                        />
                        {/* Deletes this note, but still saves everything else
                            typed on the page first. */}
                        <button
                          className="button-danger min-h-8 px-2 text-sm"
                          type="submit"
                          formAction={deleteAssetNoteAction.bind(null, note.id)}
                        >
                          Delete note
                        </button>
                      </div>
                      <TagPicker
                        name={`noteTags-${note.id}`}
                        selected={note.tags ?? []}
                        vocabulary={tagNames}
                        label="Tags"
                      />
                      <p className="text-xs text-forge-muted">Edits here are saved by the Save button — no separate save needed.</p>
                    </div>
                  </details>
                </article>
              ))}
              {!asset.notes.length ? (
                <div className="panel muted">
                  No thoughts logged yet. Add your first note above — tomorrow you&apos;ll be glad you wrote down what you were watching.
                </div>
              ) : null}
            </div>
          </div>
        </section>
      </form>
    </main>
  );
}
