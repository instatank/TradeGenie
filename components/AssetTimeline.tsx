import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight, GitCommitHorizontal, MessageSquare, Pencil, StickyNote } from "lucide-react";
import { deleteAssetNoteAction } from "@/app/actions";
import { TextAreaField } from "@/components/Fields";
import { OptionSelectField } from "@/components/OptionField";
import { ScreenshotField } from "@/components/ScreenshotField";
import { TagPicker } from "@/components/TagPicker";
import { TagPills } from "@/components/TagPills";
import { biasFieldLabels, describeBiasChange, longBiasFields, type BiasField } from "@/lib/asset-history";
import { humanize } from "@/lib/constants";
import { formatMoney, type Currency } from "@/lib/currency";
import type { AssetWorkspace } from "@/lib/data";
import { getTradePnl } from "@/lib/metrics";
import type { OptionChoice } from "@/lib/options";
import type { Screenshot } from "@/lib/types";

type Item = AssetWorkspace["timeline"][number];

// One chronological column: the trader's notes, the moments their read changed,
// the trades they actually took, and any loose note tagged with the symbol.
// Rendering only — every item was already dated, they were just being displayed
// in three lists that never met.
export function AssetTimeline({
  items,
  baseCurrency,
  timeframeChoices,
  timeframePlaceholder,
  timeframeLabel,
  tagVocabulary,
  screenshotsByNote,
}: {
  items: Item[];
  baseCurrency: Currency;
  timeframeChoices: OptionChoice[];
  timeframePlaceholder: string;
  timeframeLabel: (value: string) => string;
  tagVocabulary: string[];
  screenshotsByNote: Map<string, Screenshot[]>;
}) {
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`}>
          {item.kind === "note" ? (
            <ThreadNote
              item={item}
              timeframeChoices={timeframeChoices}
              timeframePlaceholder={timeframePlaceholder}
              timeframeLabel={timeframeLabel}
              tagVocabulary={tagVocabulary}
              screenshots={screenshotsByNote.get(item.id) ?? []}
            />
          ) : null}
          {item.kind === "bias" ? <BiasRow item={item} /> : null}
          {item.kind === "trade" ? <TradeRow item={item} baseCurrency={baseCurrency} /> : null}
          {item.kind === "freeNote" ? <FreeNoteRow item={item} /> : null}
        </li>
      ))}
    </ol>
  );
}

function Stamp({ at, children }: { at: Date; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-forge-muted">
      <span>{format(at, "EEE dd MMM yyyy · HH:mm")}</span>
      {children}
    </div>
  );
}

function Chip({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "green" | "red" | "blue" }) {
  const tones = {
    muted: "bg-forge-panel text-forge-ink",
    green: "bg-emerald-50 text-forge-green",
    red: "bg-rose-50 text-forge-red",
    blue: "bg-sky-50 text-forge-blue",
  } as const;
  return <span className={`rounded-md px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

// A note in the asset's own thread. Its edit fold stays inside the page's one
// form, so the page-wide Save still captures an edit made here.
function ThreadNote({
  item,
  timeframeChoices,
  timeframePlaceholder,
  timeframeLabel,
  tagVocabulary,
  screenshots,
}: {
  item: Extract<Item, { kind: "note" }>;
  timeframeChoices: OptionChoice[];
  timeframePlaceholder: string;
  timeframeLabel: (value: string) => string;
  tagVocabulary: string[];
  screenshots: Screenshot[];
}) {
  const note = item.note;
  return (
    <article id={`note-${note.id}`} className="panel scroll-mt-24">
      <Stamp at={note.createdAt}>
        <Chip>
          <MessageSquare className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />
          Note
        </Chip>
        {note.timeframe ? <Chip>{timeframeLabel(note.timeframe)}</Chip> : null}
      </Stamp>
      <p className="mt-2 whitespace-pre-wrap text-base">{note.text}</p>
      <ScreenshotGallery screenshots={screenshots} alt={`Chart on ${format(note.createdAt, "dd MMM")}`} />
      <TagPills tags={note.tags} className="mt-2" />
      <details className="mt-3 rounded-lg border border-forge-line p-3">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <Pencil className="h-4 w-4 text-forge-blue" aria-hidden="true" />
          Edit note
        </summary>
        <div className="mt-3 space-y-3">
          <TextAreaField label="Note" name={`noteText-${note.id}`} defaultValue={note.text} rows={5} />
          <ScreenshotField
            name={`noteScreenshot-${note.id}`}
            label="Add charts to this note"
            hint="Paste a TradingView screenshot straight in (Ctrl/Cmd+V), drop an image here, or browse."
          />
          <div className="flex flex-wrap items-end justify-between gap-3">
            <OptionSelectField
              label="Timeframe"
              name={`noteTimeframe-${note.id}`}
              choices={timeframeChoices}
              includeBlank
              defaultValue={note.timeframe}
              placeholder={timeframePlaceholder}
            />
            {/* Deletes this note, but still saves everything else typed on the
                page first. */}
            <button className="button-danger min-h-8 px-2 text-sm" type="submit" formAction={deleteAssetNoteAction.bind(null, note.id)}>
              Delete note
            </button>
          </div>
          <TagPicker name={`noteTags-${note.id}`} selected={note.tags ?? []} vocabulary={tagVocabulary} label="Tags" />
          <p className="text-xs text-forge-muted">Edits here are saved by the Save button — no separate save needed.</p>
        </div>
      </details>
    </article>
  );
}

// The moment a read changed. Read-only by design: it is an audit row, not a
// thought. A short field reads inline; a long one folds so the game plan you
// replaced is recoverable without swamping the column.
function BiasRow({ item }: { item: Extract<Item, { kind: "bias" }> }) {
  const change = item.change;
  const isLong = longBiasFields.has(change.field as BiasField);
  const label = biasFieldLabels[change.field as BiasField] ?? change.field;
  return (
    <div className="rounded-xl border border-dashed border-forge-line bg-white/60 px-4 py-3">
      <Stamp at={change.createdAt}>
        <Chip tone="blue">
          <GitCommitHorizontal className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />
          {describeBiasChange(change)}
        </Chip>
      </Stamp>
      {isLong ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-forge-muted hover:text-forge-ink">
            {change.from ? `See what your ${label.toLowerCase()} said before this` : `See what you wrote`}
          </summary>
          <div className="mt-2 space-y-2 text-sm">
            {change.from ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-forge-muted">Before</p>
                <p className="whitespace-pre-wrap text-forge-muted line-through decoration-forge-muted/40">{change.from}</p>
              </div>
            ) : null}
            {change.to ? (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-forge-muted">After</p>
                <p className="whitespace-pre-wrap">{change.to}</p>
              </div>
            ) : null}
          </div>
        </details>
      ) : (
        <p className="mt-1 text-sm">
          {change.from ? <span className="text-forge-muted line-through decoration-forge-muted/40">{change.from}</span> : null}
          {change.from && change.to ? <ArrowRight className="mx-1.5 inline h-3.5 w-3.5 align-[-2px] text-forge-muted" aria-hidden="true" /> : null}
          {change.to ? <span className="font-medium">{change.to}</span> : <span className="text-forge-muted italic">cleared</span>}
        </p>
      )}
    </div>
  );
}

// A trade on this symbol, in the story where it happened. This is the row that
// makes the plan and the execution readable together.
function TradeRow({ item, baseCurrency }: { item: Extract<Item, { kind: "trade" }>; baseCurrency: Currency }) {
  const trade = item.trade;
  const pnl = getTradePnl(trade);
  return (
    <Link
      href={`/trades/${trade.id}`}
      className="block rounded-xl border-l-4 border-forge-blue/50 bg-white px-4 py-3 shadow-sm ring-1 ring-forge-line transition hover:ring-forge-blue"
    >
      <Stamp at={trade.tradeDateTime}>
        <Chip tone="blue">Trade</Chip>
        <Chip tone={trade.direction === "SHORT" ? "red" : "green"}>{humanize(trade.direction)}</Chip>
        <Chip>{humanize(trade.status)}</Chip>
        {trade.reconstructed ? <Chip>archive</Chip> : null}
      </Stamp>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">{trade.instrument}</span>
        {pnl != null ? (
          <span className={`text-sm font-semibold ${pnl >= 0 ? "text-forge-green" : "text-forge-red"}`}>
            {formatMoney(pnl, baseCurrency, { signed: true })}
            {trade.rMultiple != null ? <span className="ml-1.5 font-normal text-forge-muted">{trade.rMultiple.toFixed(2)}R</span> : null}
          </span>
        ) : null}
      </div>
      {trade.entryThesis ? <p className="mt-1 line-clamp-2 text-sm text-forge-muted">{trade.entryThesis}</p> : null}
    </Link>
  );
}

// A loose note that reached this page through the symbol's own tag. Read-only
// here: its home is the day it was written, and editing it in two places is how
// you lose one of the edits.
function FreeNoteRow({ item }: { item: Extract<Item, { kind: "freeNote" }> }) {
  const note = item.note;
  return (
    <div className="rounded-xl border border-forge-line bg-forge-panel/60 px-4 py-3">
      <Stamp at={note.createdAt}>
        <Chip>
          <StickyNote className="mr-1 inline h-3 w-3 align-[-1px]" aria-hidden="true" />
          Quick note
        </Chip>
      </Stamp>
      <p className="mt-2 whitespace-pre-wrap text-sm">{note.text}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <TagPills tags={note.tags} />
        <Link
          href={`/daily?date=${format(note.createdAt, "yyyy-MM-dd")}#note-${note.id}`}
          className="text-xs text-forge-blue hover:underline"
        >
          Open the day this was written →
        </Link>
      </div>
    </div>
  );
}

export function ScreenshotGallery({ screenshots, alt }: { screenshots: Screenshot[]; alt: string }) {
  if (!screenshots.length) return null;
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {screenshots.map((screenshot) => (
        <a
          key={screenshot.id}
          href={`/api/screenshots/${screenshot.id}`}
          target="_blank"
          rel="noreferrer"
          className="overflow-hidden rounded-lg border border-forge-line transition hover:border-forge-blue"
        >
          {/* Plain <img>: these are user uploads served through our own route,
              which next/image cannot size at build time anyway. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/screenshots/${screenshot.id}`} alt={screenshot.caption ?? alt} className="h-auto w-full object-cover" />
        </a>
      ))}
    </div>
  );
}
