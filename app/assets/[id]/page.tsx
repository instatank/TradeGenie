import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import {
  addAssetNoteAction,
  deleteAssetAction,
  deleteAssetNoteAction,
  updateAssetAction,
  updateAssetNoteAction,
} from "@/app/actions";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { assetTimeframes, humanize, marketTypes } from "@/lib/constants";
import { getAssetWorkspace } from "@/lib/data";

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const asset = await getAssetWorkspace(id);
  if (!asset) notFound();

  return (
    <main className="page-shell">
      <div className="mb-5 flex items-start justify-between gap-3">
        <PageTitle title={asset.symbol} subtitle={`${humanize(asset.marketType)} · tracked since ${format(asset.createdAt, "dd MMM yyyy")}`} />
        <div className="flex items-center gap-2">
          <Link href="/assets" className="button-secondary">All assets</Link>
          <form action={deleteAssetAction}>
            <input type="hidden" name="id" value={asset.id} />
            <button className="button-danger min-h-9 px-3" type="submit" title="Stop tracking this asset" aria-label="Stop tracking this asset">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      </div>

      <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
        {/* Current view — always-current, edited in place. The glance you open daily. */}
        <div className="space-y-4 self-start">
          <form action={updateAssetAction} className="panel space-y-4">
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
            <input type="hidden" name="id" value={asset.id} />
            <button className="button" type="submit">Save current view</button>
          </form>

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
          <form action={addAssetNoteAction} className="panel space-y-3">
            <h2 className="font-semibold">Add to the thread</h2>
            <TextAreaField
              label="What are you thinking right now?"
              name="text"
              required
              rows={6}
              placeholder="Dump your thought process — analysis, what changed, what you're watching for. Free-form."
            />
            <div className="grid gap-3 sm:grid-cols-[200px_auto] sm:items-end">
              <SelectField label="Timeframe (optional)" name="timeframe" options={assetTimeframes} includeBlank />
              <button className="button" type="submit">Add note</button>
            </div>
            <input type="hidden" name="assetId" value={asset.id} />
          </form>

          <div className="space-y-3">
            {asset.notes.map((note) => (
              <article key={note.id} className="panel">
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
                <details className="mt-3 rounded-lg border border-forge-line p-3">
                  <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                    <Pencil className="h-4 w-4 text-forge-blue" aria-hidden="true" />
                    Edit note
                  </summary>
                  <form action={updateAssetNoteAction} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={note.id} />
                    <input type="hidden" name="assetId" value={asset.id} />
                    <TextAreaField label="Note" name="text" defaultValue={note.text} rows={5} />
                    <div className="flex items-end justify-between gap-3">
                      <SelectField label="Timeframe" name="timeframe" options={assetTimeframes} includeBlank defaultValue={note.timeframe} />
                      <div className="flex gap-2">
                        <button className="button-secondary" type="submit">Save</button>
                      </div>
                    </div>
                  </form>
                  <form action={deleteAssetNoteAction} className="mt-2">
                    <input type="hidden" name="id" value={note.id} />
                    <input type="hidden" name="assetId" value={asset.id} />
                    <button className="button-danger min-h-8 px-2 text-sm" type="submit">Delete note</button>
                  </form>
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
    </main>
  );
}
