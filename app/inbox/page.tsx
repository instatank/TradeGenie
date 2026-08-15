import Link from "next/link";
import { format } from "date-fns";
import { CalendarDays, CheckCircle2, ChevronRight, Link2, Mic, Pencil, Sparkles, Trash2, X } from "lucide-react";
import {
  archiveTranscriptAction,
  confirmTranscriptAction,
  deleteTranscriptAction,
  dropTranscriptEntryAction,
  extractLessonsAction,
  linkTranscriptAction,
  saveTranscriptAction,
  structureTranscriptAction,
  updateTranscriptAction,
} from "@/app/actions";
import { BoolSelect, PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { TagPills } from "@/components/TagPills";
import { TagPicker } from "@/components/TagPicker";
import { PaginationControls, ViewTabs, normalizePage, normalizePageSize, paginate } from "@/components/ListControls";
import { getCalendarRange, isWithinCalendarRange } from "@/lib/calendar";
import {
  assetTimeframes,
  coreLessonCategories,
  directions,
  followedPlanOptions,
  humanize,
  mindStateOptions,
  riskPostures,
} from "@/lib/constants";
import {
  entryKindDestinations,
  entryKindLabels,
  entrySummary,
  normalizeExtraction,
  type ExtractedEntry,
  type SegmentedExtraction,
} from "@/lib/extraction";
import { db, getTagVocabulary, getTranscriptsWithLinks } from "@/lib/data";
import { getSettings } from "@/lib/settings-store";
import type { Trade } from "@/lib/types";

const inboxViews = [
  { label: "To review", value: "review" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" },
];

// Capture: one big paste box, then a queue of drafts to confirm. A note now
// becomes a LIST of typed entries — one card each, each individually editable
// and individually removable — instead of a single record that quietly threw
// away everything after the first thing you said.
export default async function InboxPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams ?? {};
  const [settings, transcripts, trades, journals, tagVocabulary] = await Promise.all([
    getSettings(),
    getTranscriptsWithLinks(),
    db.list("trades"),
    db.list("dailyJournals"),
    getTagVocabulary(),
  ]);
  const tagNames = tagVocabulary.map((entry) => entry.tag);
  const view = params.view ?? "review";
  const page = normalizePage(params.page);
  const pageSize = normalizePageSize(params.pageSize, [5, 10, 25], 10);
  const calendarRange = getCalendarRange(params);
  const filteredTranscripts = transcripts
    .filter((transcript) => applyInboxView(transcript, view))
    .filter((transcript) => isWithinCalendarRange(transcript.transcriptDateTime, calendarRange));
  const pagedTranscripts = paginate(filteredTranscripts, page, pageSize);
  const sortedTrades = trades.sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime());
  const recentTrades = sortedTrades.slice(0, 50);
  const openTrades = sortedTrades.filter((trade) => trade.status === "OPEN");
  const recentJournals = journals.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 30);
  const toReviewCount = transcripts.filter((transcript) => applyInboxView(transcript, "review")).length;

  return (
    <main className="page-shell max-w-4xl">
      <PageTitle title="Capture" subtitle="Talk or type, paste, done. Say several things at once — each one becomes its own draft entry you can edit, drop or confirm. Nothing writes to your journal until you say so." />

      {/* ---- The paste box: the whole point of this page ---- */}
      <form action={saveTranscriptAction} className="panel space-y-3 border-l-4 border-forge-green">
        <label className="field">
          <span className="flex items-center gap-2 font-semibold">
            <Mic className="h-4 w-4 text-forge-green" aria-hidden="true" />
            Drop your voice note or thought
          </span>
          <textarea
            name="rawText"
            required
            rows={5}
            placeholder="“BTC long at 64200, stop 63400, range reclaim. Watching SOL under 150 but no trade there. Feeling calm today.” — say it however it comes out; I'll split it up."
            className="textarea"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button className="button" type="submit">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Save &amp; review
          </button>
          <span className="text-xs text-forge-muted">Splits into entries on save → review each one below → confirm.</span>
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-forge-muted hover:text-forge-ink">Details (optional) — time, source, tags</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <TextField label="Note time" name="transcriptDateTime" type="datetime-local" defaultValue={format(new Date(), "yyyy-MM-dd'T'HH:mm")} />
            <TextField label="Dictation source" name="sourceTool" defaultValue={settings.defaultSourceTool} />
          </div>
          <div className="mt-3">
            <TagPicker vocabulary={tagNames} />
          </div>
        </details>
      </form>

      {/* ---- The queue ---- */}
      <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Your notes</h2>
        {toReviewCount ? <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-medium text-forge-blue">{toReviewCount} waiting for review</span> : null}
      </div>
      <ViewTabs basePath="/inbox" current={view} params={params} tabs={inboxViews} />
      {calendarRange.active ? (
        <p className="mb-4 flex w-fit items-center gap-2 rounded-full border border-forge-blue/30 bg-sky-50 px-3 py-1.5 text-sm">
          <CalendarDays className="h-4 w-4 text-forge-blue" aria-hidden="true" />
          {calendarRange.label}
          <Link href={view === "review" ? "/inbox" : `/inbox?view=${view}`} className="text-forge-muted transition hover:text-forge-ink" title="Show all dates" aria-label="Clear date range">
            <X className="h-4 w-4" aria-hidden="true" />
          </Link>
        </p>
      ) : null}

      <div className="space-y-3">
        {pagedTranscripts.map((transcript) => {
          const extraction = parseExtraction(transcript.structuredJson);
          const entries = extraction?.entries ?? [];
          const isActionable = transcript.processingStatus === "UNPROCESSED" || transcript.processingStatus === "STRUCTURED";
          const isConfirmed = transcript.processingStatus === "CONFIRMED";
          const unresolvedExits = entries.filter((entry) => entry.kind === "TRADE_EXIT" && !entry.linkTradeId).length;
          return (
            <details key={transcript.id} id={`note-${transcript.id}`} className={`panel group scroll-mt-24 ${isActionable ? "border-l-4 border-forge-blue/60" : ""}`}>
              <summary className="flex cursor-pointer items-start gap-3">
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-forge-muted transition group-open:rotate-90" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="mb-1 flex flex-wrap gap-1">
                    {entries.length ? entries.map((entry, index) => <KindChip key={index} kind={entry.kind} />) : <KindChip kind={null} />}
                  </span>
                  <span className="block truncate text-sm">{transcript.cleanedSummary ?? transcript.rawText}</span>
                  <span className="mt-0.5 block text-xs text-forge-muted">
                    {format(transcript.transcriptDateTime, "d MMM HH:mm")}
                    {transcript.linkedTrade ? ` · linked to ${transcript.linkedTrade.instrument}` : ""}
                    {transcript.linkedDailyJournal ? ` · daily ${format(transcript.linkedDailyJournal.date, "d MMM")}` : ""}
                  </span>
                </span>
                <StatusBadge status={transcript.processingStatus} confidence={extraction?.overallConfidence ?? transcript.aiConfidence} count={entries.length} />
              </summary>

              <div className="mt-4 space-y-4 border-t border-forge-line pt-4">
                <TagPills tags={transcript.tags} />

                {/* Removing an entry is its own submission, so these forms sit
                    OUTSIDE the confirm form and the buttons reach them via the
                    HTML form= attribute (forms can't nest). */}
                {isActionable
                  ? entries.map((_, index) => (
                      <form key={`drop-${index}`} id={`drop-${transcript.id}-${index}`} action={dropTranscriptEntryAction} className="hidden">
                        <input type="hidden" name="id" value={transcript.id} />
                        <input type="hidden" name="entryIndex" value={index} />
                      </form>
                    ))
                  : null}

                {extraction && entries.length && isActionable ? (
                  <section className="rounded-xl border border-forge-blue/40 bg-sky-50/40 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <h3 className="text-sm font-semibold">
                        {entries.length === 1 ? "Review this entry, then confirm" : `Review these ${entries.length} entries, then confirm`}
                      </h3>
                      <span className="text-xs text-forge-muted">Drop anything that isn&apos;t really a separate thing.</span>
                    </div>
                    {extraction.overallConfidence === "LOW" ? (
                      <p className="mt-2 text-xs font-medium text-amber-700">Low confidence — double-check the fields before confirming.</p>
                    ) : null}
                    {extraction.missingInfo.length ? (
                      <p className="mt-2 text-xs text-forge-muted">Not stated in the note: {extraction.missingInfo.join(", ")}.</p>
                    ) : null}

                    <form action={confirmTranscriptAction} className="mt-3 space-y-3">
                      <input type="hidden" name="id" value={transcript.id} />
                      {entries.map((entry, index) => (
                        <EntryCard key={index} entry={entry} index={index} transcriptId={transcript.id} openTrades={openTrades} />
                      ))}
                      {unresolvedExits ? (
                        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          Pick which open trade the exit closes. An exit only ever updates a trade you already have — it never creates a new one.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-3 border-t border-forge-line pt-3">
                        <button className="button" type="submit">
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          {entries.length === 1 ? "Confirm entry" : `Confirm all ${entries.length}`}
                        </button>
                        <span className="text-xs text-forge-muted">Nothing is saved to your journal until you confirm.</span>
                      </div>
                    </form>
                  </section>
                ) : null}

                {extraction && !entries.length && isActionable ? (
                  <p className="rounded-lg border border-dashed border-forge-line p-3 text-sm text-forge-muted">
                    Nothing left to confirm on this note — you dropped every entry. Re-read it under &quot;More&quot; if that was a mistake.
                  </p>
                ) : null}

                {isConfirmed && entries.length ? (
                  <section className="rounded-xl border border-forge-green/40 bg-emerald-50/40 p-4">
                    <h3 className="text-sm font-semibold text-forge-green">Saved from this note</h3>
                    <ul className="mt-2 space-y-1.5">
                      {entries.map((entry, index) => (
                        <li key={index} className="flex items-start gap-2 text-sm">
                          <KindChip kind={entry.kind} />
                          <span className="min-w-0 flex-1 text-forge-muted">{entrySummary(entry)}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {!transcript.structuredJson ? (
                  <form action={structureTranscriptAction} className="rounded-lg border border-dashed border-forge-line p-3 text-sm text-forge-muted">
                    <input type="hidden" name="id" value={transcript.id} />
                    Not read yet.{" "}
                    <button className="font-medium text-forge-blue hover:underline" type="submit">Split it into entries</button> to get a reviewable draft.
                  </form>
                ) : null}

                <details className="rounded-lg border border-forge-line p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-forge-muted">What you said (raw note)</summary>
                  <p className="mt-2 whitespace-pre-wrap rounded-md bg-forge-panel p-3 text-sm text-forge-muted">{transcript.rawText}</p>
                  <details className="mt-3">
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-forge-muted">
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit the raw note
                    </summary>
                    <form action={updateTranscriptAction} className="mt-3 grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="id" value={transcript.id} />
                      <div className="sm:col-span-2">
                        <TextAreaField label="Transcript" name="rawText" defaultValue={transcript.rawText} rows={5} />
                      </div>
                      <TextField label="Note time" name="transcriptDateTime" type="datetime-local" defaultValue={format(transcript.transcriptDateTime, "yyyy-MM-dd'T'HH:mm")} />
                      <TextField label="Source" name="sourceTool" defaultValue={transcript.sourceTool} />
                      {/* No "Note type" select: the type is derived from the entries a
                          note produces, so there is nothing here left to choose. */}
                      <div className="sm:col-span-2">
                        <TagPicker selected={transcript.tags ?? []} vocabulary={tagNames} />
                      </div>
                      <p className="text-xs text-forge-muted">Saving edits clears the draft entries — re-read the note to get fresh ones.</p>
                      <div className="flex items-end justify-end">
                        <button className="button-secondary" type="submit">Save edits</button>
                      </div>
                    </form>
                  </details>
                </details>

                <details className="rounded-lg border border-forge-line p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-forge-muted">More — links, re-read, archive, delete</summary>
                  <div className="mt-3 space-y-3">
                    <form action={linkTranscriptAction} className="grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="id" value={transcript.id} />
                      <div className="flex items-center gap-2 sm:col-span-2">
                        <Link2 className="h-4 w-4 text-forge-blue" aria-hidden="true" />
                        <h4 className="text-sm font-semibold">Attach to an existing record</h4>
                      </div>
                      <label className="field">
                        <span className="label">Trade</span>
                        <select name="linkedTradeId" defaultValue={transcript.linkedTradeId ?? ""} className="input">
                          <option value="">No trade</option>
                          {recentTrades.map((trade) => (
                            <option key={trade.id} value={trade.id}>
                              {format(trade.tradeDateTime, "dd MMM")} · {trade.instrument} · {humanize(trade.direction)}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field">
                        <span className="label">Daily journal</span>
                        <select name="linkedDailyJournalId" defaultValue={transcript.linkedDailyJournalId ?? ""} className="input">
                          <option value="">No daily journal</option>
                          {recentJournals.map((journal) => (
                            <option key={journal.id} value={journal.id}>{format(journal.date, "dd MMM yyyy")}</option>
                          ))}
                        </select>
                      </label>
                      <div className="sm:col-span-2">
                        <button className="button-secondary" type="submit">Save links</button>
                      </div>
                    </form>

                    <div className="flex flex-wrap gap-2 border-t border-forge-line pt-3">
                      {transcript.structuredJson ? (
                        <>
                          <form action={structureTranscriptAction}>
                            <input type="hidden" name="id" value={transcript.id} />
                            <button className="button-secondary" type="submit"><Sparkles className="h-4 w-4" aria-hidden="true" /> Read it again</button>
                          </form>
                          <form action={extractLessonsAction}>
                            <input type="hidden" name="id" value={transcript.id} />
                            <button className="button-secondary" type="submit">Save lessons only</button>
                          </form>
                        </>
                      ) : null}
                      <form action={archiveTranscriptAction}>
                        <input type="hidden" name="id" value={transcript.id} />
                        <button className="button-secondary" type="submit">Archive</button>
                      </form>
                      <form action={deleteTranscriptAction}>
                        <input type="hidden" name="id" value={transcript.id} />
                        <button className="button-danger" type="submit"><Trash2 className="h-4 w-4" aria-hidden="true" /> Delete</button>
                      </form>
                    </div>

                    {transcript.structuredJson ? (
                      <details>
                        <summary className="cursor-pointer text-xs font-semibold text-forge-muted">Raw structured JSON</summary>
                        <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-[#101418] p-3 text-xs text-white">{transcript.structuredJson}</pre>
                      </details>
                    ) : null}

                    <div className="flex flex-wrap gap-3 text-sm">
                      {transcript.linkedTrade ? <Link className="text-forge-blue hover:underline" href={`/trades/${transcript.linkedTrade.id}`}>Open linked trade: {transcript.linkedTrade.instrument} →</Link> : null}
                      {transcript.linkedDailyJournal ? <Link className="text-forge-blue hover:underline" href={`/daily?date=${format(transcript.linkedDailyJournal.date, "yyyy-MM-dd")}`}>Open linked daily →</Link> : null}
                    </div>
                  </div>
                </details>
              </div>
            </details>
          );
        })}
        {!filteredTranscripts.length ? (
          <div className="panel muted">
            {view === "review" ? "Nothing waiting for review — paste a note above and it lands here as a draft." : "No notes in this view."}
          </div>
        ) : null}
      </div>
      {filteredTranscripts.length > pageSize ? (
        <PaginationControls basePath="/inbox" params={params} page={page} pageSize={pageSize} total={filteredTranscripts.length} />
      ) : null}
    </main>
  );
}

type InboxRow = Awaited<ReturnType<typeof getTranscriptsWithLinks>>[number];

function applyInboxView(transcript: InboxRow, view: string) {
  if (view === "review") return transcript.processingStatus === "UNPROCESSED" || transcript.processingStatus === "STRUCTURED";
  if (view === "confirmed") return transcript.processingStatus === "CONFIRMED";
  if (view === "archived") return transcript.processingStatus === "ARCHIVED";
  return true;
}

// Plain-language kind chips, color-grouped: trades green/blue, daily gold,
// learning and loose thoughts gray.
function KindChip({ kind }: { kind: ExtractedEntry["kind"] | null }) {
  const config: Record<string, string> = {
    TRADE_ENTRY: "bg-emerald-50 text-forge-green",
    TRADE_EXIT: "bg-sky-50 text-forge-blue",
    ASSET_NOTE: "bg-violet-50 text-violet-700",
    JOURNAL: "bg-amber-50 text-amber-700",
    WEEKLY_REFLECTION: "bg-amber-50 text-amber-700",
    LESSON: "bg-forge-panel text-forge-muted",
    FREE_NOTE: "bg-forge-panel text-forge-muted",
  };
  const label = kind ? entryKindLabels[kind] : "Note";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${kind ? config[kind] : "bg-forge-panel text-forge-muted"}`}>{label}</span>;
}

function StatusBadge({ status, confidence, count }: { status: string; confidence: string | null; count: number }) {
  if (status === "CONFIRMED") {
    return <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-forge-green"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Confirmed</span>;
  }
  if (status === "ARCHIVED") return <span className="shrink-0 text-xs text-forge-muted">Archived</span>;
  if (status === "STRUCTURED") {
    const level = (confidence ?? "LOW").toUpperCase();
    const dot = level === "HIGH" ? "bg-forge-green" : level === "MEDIUM" ? "bg-forge-blue" : "bg-amber-500";
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-forge-blue">
        <span className={`h-2 w-2 rounded-full ${dot}`} title={`${humanize(level)} confidence`} />
        {count === 1 ? "1 entry" : `${count} entries`}
      </span>
    );
  }
  return <span className="shrink-0 text-xs text-forge-muted">Raw</span>;
}

function parseExtraction(value: string | null): SegmentedExtraction | null {
  if (!value) return null;
  try {
    return normalizeExtraction(JSON.parse(value));
  } catch {
    return null;
  }
}

// One card per entry: what it is, where confirming sends it, its own editable
// fields, and a way to drop it. Field names are prefixed with the entry index
// so confirmTranscriptAction can merge each card's edits over its own entry.
function EntryCard({
  entry,
  index,
  transcriptId,
  openTrades,
}: {
  entry: ExtractedEntry;
  index: number;
  transcriptId: string;
  openTrades: Trade[];
}) {
  const n = (field: string) => `e${index}_${field}`;
  return (
    <section className="rounded-lg border border-forge-line bg-white p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-forge-line pb-2">
        <span className="flex items-center gap-2">
          <KindChip kind={entry.kind} />
          <span className="text-xs text-forge-muted">{entryKindDestinations[entry.kind]}</span>
        </span>
        <button
          type="submit"
          form={`drop-${transcriptId}-${index}`}
          className="text-xs font-medium text-forge-muted underline-offset-2 hover:text-forge-red hover:underline"
          title="This isn't a separate thing — drop it"
        >
          Remove
        </button>
      </div>
      <EntryFields entry={entry} n={n} openTrades={openTrades} />
    </section>
  );
}

function EntryFields({ entry, n, openTrades }: { entry: ExtractedEntry; n: (field: string) => string; openTrades: Trade[] }) {
  switch (entry.kind) {
    case "TRADE_ENTRY":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Instrument" name={n("instrument")} defaultValue={entry.instrument} />
            <SelectField label="Direction" name={n("direction")} options={directions} defaultValue={entry.direction} />
            <SelectField label="Status" name={n("status")} options={["OPEN", "IDEA"]} defaultValue={entry.status} />
            <TextField label="Setup" name={n("setupName")} defaultValue={entry.setupName} />
            <SelectField label="Mind state" name={n("emotionalState")} options={mindStateOptions} defaultValue={entry.emotionalState} includeBlank />
            <SelectField label="Risk posture" name={n("riskPosture")} options={riskPostures} defaultValue={entry.riskPosture} />
          </div>
          <TextAreaField label="Thesis" name={n("entryThesis")} rows={2} defaultValue={entry.entryThesis} />
          <TextField label="Invalidation" name={n("invalidation")} defaultValue={entry.invalidation} />
          <TextField label="Concern" name={n("concern")} defaultValue={entry.concern} />
          <div className="grid gap-3 sm:grid-cols-3">
            <TextField label="Entry price" name={n("entryPrice")} type="number" defaultValue={entry.entryPrice} />
            <TextField label="Stop price" name={n("stopPrice")} type="number" defaultValue={entry.stopPrice} />
            <TextField label="Target price" name={n("targetPrice")} type="number" defaultValue={entry.targetPrice} />
            <TextField label="Quantity" name={n("quantity")} type="number" defaultValue={entry.quantity} />
            <TextField label="Leverage" name={n("leverage")} type="number" defaultValue={entry.leverage} />
            <TextField label="Conviction (1-10)" name={n("confidenceScore")} type="number" defaultValue={entry.confidenceScore} />
          </div>
          <MistakeHint tags={entry.suggestedMistakeTags} />
        </div>
      );
    case "TRADE_EXIT":
      return (
        <div className="space-y-3">
          <label className="field">
            <span className="label">Which trade does this close?</span>
            <select name={n("linkTradeId")} defaultValue={entry.linkTradeId ?? ""} className="input">
              <option value="">Pick an open trade…</option>
              {openTrades.map((trade) => (
                <option key={trade.id} value={trade.id}>
                  {format(trade.tradeDateTime, "dd MMM")} · {trade.instrument} · {humanize(trade.direction)}
                  {trade.entryPrice == null ? "" : ` · entry ${trade.entryPrice}`}
                </option>
              ))}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Exit price" name={n("exitPrice")} type="number" defaultValue={entry.exitPrice} />
            <TextField label="Realized P&amp;L" name={n("realizedPnl")} type="number" defaultValue={entry.realizedPnl} />
            <SelectField label="Followed plan" name={n("followedPlan")} options={followedPlanOptions} defaultValue={entry.followedPlan} />
            <SelectField label="Mind state" name={n("emotionalState")} options={mindStateOptions} defaultValue={entry.emotionalState} includeBlank />
          </div>
          <TextAreaField label="Exit reason" name={n("exitReason")} rows={2} defaultValue={entry.exitReason} />
          <TextField label="Takeaway for this trade" name={n("lesson")} defaultValue={entry.lesson} />
          <MistakeHint tags={entry.suggestedMistakeTags} />
        </div>
      );
    case "ASSET_NOTE":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Symbol" name={n("assetSymbol")} defaultValue={entry.assetSymbol} />
            <SelectField label="Timeframe" name={n("timeframe")} options={assetTimeframes} defaultValue={entry.timeframe} />
          </div>
          <TextAreaField label="Note" name={n("text")} rows={3} defaultValue={entry.text} />
        </div>
      );
    case "JOURNAL":
      return (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label="Mind state" name={n("mainEmotion")} options={mindStateOptions} defaultValue={entry.mainEmotion} includeBlank />
            <TextField label="Discipline (1-10)" name={n("disciplineScore")} type="number" defaultValue={entry.disciplineScore} />
            <BoolSelect label="Traded today" name={n("tradedToday")} defaultValue={entry.tradedToday} />
            <BoolSelect label="Followed max loss" name={n("followedMaxLoss")} defaultValue={entry.followedMaxLoss} />
            <BoolSelect label="Followed max trades" name={n("followedMaxTrades")} defaultValue={entry.followedMaxTrades} />
          </div>
          <TextField label="Best decision" name={n("bestDecision")} defaultValue={entry.bestDecision} />
          <TextField label="Worst decision" name={n("worstDecision")} defaultValue={entry.worstDecision} />
          <TextField label="Main mistake" name={n("mainMistake")} defaultValue={entry.mainMistake} />
          <TextField label="One thing done well" name={n("oneThingDoneWell")} defaultValue={entry.oneThingDoneWell} />
          <TextField label="Avoid tomorrow" name={n("oneThingToAvoidTomorrow")} defaultValue={entry.oneThingToAvoidTomorrow} />
        </div>
      );
    case "LESSON":
      return (
        <div className="space-y-3">
          <TextAreaField label="Lesson" name={n("lessonText")} rows={2} defaultValue={entry.lessonText} />
          <SelectField label="Category" name={n("category")} options={coreLessonCategories} defaultValue={entry.category} />
        </div>
      );
    case "WEEKLY_REFLECTION":
      return (
        <div className="space-y-3">
          <TextAreaField label="Summary of the week" name={n("summaryText")} rows={3} defaultValue={entry.summaryText} />
          <TextField label="What improved" name={n("whatImproved")} defaultValue={entry.whatImproved} />
          <TextField label="What got worse" name={n("whatDeteriorated")} defaultValue={entry.whatDeteriorated} />
          <TextField label="Key lesson" name={n("keyLesson")} defaultValue={entry.keyLesson} />
        </div>
      );
    case "FREE_NOTE":
      return <TextAreaField label="Thought" name={n("text")} rows={3} defaultValue={entry.text} />;
  }
}

function MistakeHint({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <p className="text-xs text-forge-muted">
      Mistakes detected: {tags.map((tag) => humanize(tag)).join(", ")} (saved with this trade).
    </p>
  );
}
