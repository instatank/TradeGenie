import Link from "next/link";
import { format } from "date-fns";
import { CalendarDays, CheckCircle2, ChevronRight, Link2, Mic, Pencil, Sparkles, Trash2, X } from "lucide-react";
import {
  archiveTranscriptAction,
  confirmTranscriptAction,
  deleteTranscriptAction,
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
import { directions, followedPlanOptions, humanize, mindStateOptions, riskPostures, transcriptTypes } from "@/lib/constants";
import { db, getTagVocabulary, getTranscriptsWithLinks } from "@/lib/data";
import { getSettings } from "@/lib/settings-store";

const inboxViews = [
  { label: "To review", value: "review" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" },
];

// Capture: one big paste box, then a queue of drafts to confirm. The review
// card leads each note — every other action is folded behind "More".
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
  const recentTrades = trades.sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime()).slice(0, 50);
  const recentJournals = journals.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 30);
  const toReviewCount = transcripts.filter((transcript) => applyInboxView(transcript, "review")).length;

  return (
    <main className="page-shell max-w-4xl">
      <PageTitle title="Capture" subtitle="Talk or type, paste, done. It becomes a draft you confirm — nothing writes to your journal until you say so." />

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
            placeholder="“BTC long at 64200, stop 63400. Range reclaim, buyers defended the retest. Feeling calm.” — say it however it comes out; I'll sort the fields."
            className="textarea"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button className="button" type="submit">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
            Save &amp; review
          </button>
          <span className="text-xs text-forge-muted">Auto-structures on save → review the draft below → confirm.</span>
        </div>
        <details>
          <summary className="cursor-pointer text-sm font-medium text-forge-muted hover:text-forge-ink">Details (optional) — time, source, note type, tags</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <TextField label="Note time" name="transcriptDateTime" type="datetime-local" defaultValue={format(new Date(), "yyyy-MM-dd'T'HH:mm")} />
            <TextField label="Dictation source" name="sourceTool" defaultValue={settings.defaultSourceTool} />
            <SelectField label="Note type" name="transcriptType" options={transcriptTypes} defaultValue="UNKNOWN" />
          </div>
          <div className="mt-3">
            <TagPicker vocabulary={tagNames} />
          </div>
          <p className="mt-2 text-xs text-forge-muted">Leave the type on Unknown — it gets detected from what you wrote.</p>
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
          const structured = parseStructuredJson(transcript.structuredJson);
          const detectedType = getText(structured, "transcriptType") ?? transcript.transcriptType;
          const destination = destinationLabel(detectedType, Boolean(transcript.linkedTradeId), Boolean(transcript.linkedDailyJournalId));
          const needsTradeLink = detectedType === "TRADE_EXIT_REVIEW" && !transcript.linkedTradeId;
          const isActionable = transcript.processingStatus === "UNPROCESSED" || transcript.processingStatus === "STRUCTURED";
          return (
            <details key={transcript.id} id={`note-${transcript.id}`} className={`panel group scroll-mt-24 ${isActionable ? "border-l-4 border-forge-blue/60" : ""}`}>
              <summary className="flex cursor-pointer items-center gap-3">
                <ChevronRight className="h-4 w-4 shrink-0 text-forge-muted transition group-open:rotate-90" aria-hidden="true" />
                <TypeBadge type={detectedType} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{transcript.cleanedSummary ?? transcript.rawText}</span>
                  <span className="mt-0.5 block text-xs text-forge-muted">
                    {format(transcript.transcriptDateTime, "d MMM HH:mm")}
                    {transcript.linkedTrade ? ` · linked to ${transcript.linkedTrade.instrument}` : ""}
                    {transcript.linkedDailyJournal ? ` · daily ${format(transcript.linkedDailyJournal.date, "d MMM")}` : ""}
                  </span>
                </span>
                <StatusBadge status={transcript.processingStatus} confidence={getText(structured, "confidence") ?? transcript.aiConfidence} />
              </summary>

              <div className="mt-4 space-y-4 border-t border-forge-line pt-4">
                <TagPills tags={transcript.tags} />
                {transcript.structuredJson ? (
                  <section className="rounded-xl border border-forge-blue/40 bg-sky-50/40 p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                      <h3 className="text-sm font-semibold">Review this draft, then confirm</h3>
                      <span className="text-xs text-forge-muted">{destination}</span>
                    </div>
                    {(getText(structured, "confidence") ?? transcript.aiConfidence) === "LOW" ? (
                      <p className="mt-2 text-xs font-medium text-amber-700">Low confidence — double-check the fields before confirming.</p>
                    ) : null}
                    <form action={confirmTranscriptAction} className="mt-3 space-y-3">
                      <input type="hidden" name="id" value={transcript.id} />
                      <ReviewFields structured={structured} detectedType={detectedType} />
                      {getList(structured, "suggestedMistakeTags") ? (
                        <p className="text-xs text-forge-muted">Mistakes detected: {getList(structured, "suggestedMistakeTags")} (saved with this record).</p>
                      ) : null}
                      {needsTradeLink ? (
                        <p className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                          This reviews a trade — pick which one under &quot;More&quot; below, then confirm.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-3 border-t border-forge-line pt-3">
                        <button className="button" type="submit" disabled={needsTradeLink}>
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                          {confirmButtonLabel(detectedType)}
                        </button>
                        <span className="text-xs text-forge-muted">Nothing is saved to your journal until you confirm.</span>
                      </div>
                    </form>
                  </section>
                ) : (
                  <form action={structureTranscriptAction} className="rounded-lg border border-dashed border-forge-line p-3 text-sm text-forge-muted">
                    <input type="hidden" name="id" value={transcript.id} />
                    Not structured yet.{" "}
                    <button className="font-medium text-forge-blue hover:underline" type="submit">Structure it now</button> to get a reviewable draft.
                  </form>
                )}

                <details className="rounded-lg border border-forge-line p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-forge-muted">What you said (raw note)</summary>
                  <p className="mt-2 whitespace-pre-wrap rounded-md bg-forge-panel p-3 text-sm text-forge-muted">{transcript.rawText}</p>
                  <details className="mt-3">
                    <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-forge-muted">
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> Edit the raw note
                    </summary>
                    <form action={updateTranscriptAction} className="mt-3 grid gap-3 sm:grid-cols-3">
                      <input type="hidden" name="id" value={transcript.id} />
                      <div className="sm:col-span-3">
                        <TextAreaField label="Transcript" name="rawText" defaultValue={transcript.rawText} rows={5} />
                      </div>
                      <TextField label="Note time" name="transcriptDateTime" type="datetime-local" defaultValue={format(transcript.transcriptDateTime, "yyyy-MM-dd'T'HH:mm")} />
                      <TextField label="Source" name="sourceTool" defaultValue={transcript.sourceTool} />
                      <SelectField label="Note type" name="transcriptType" options={transcriptTypes} defaultValue={transcript.transcriptType} />
                      <div className="sm:col-span-3">
                        <TagPicker selected={transcript.tags ?? []} vocabulary={tagNames} />
                      </div>
                      <p className="text-xs text-forge-muted sm:col-span-2">Saving edits re-queues the note for structuring.</p>
                      <div className="flex items-end justify-end">
                        <button className="button-secondary" type="submit">Save edits</button>
                      </div>
                    </form>
                  </details>
                </details>

                <details className="rounded-lg border border-forge-line p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-forge-muted">More — links, re-structure, archive, delete</summary>
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
                            <button className="button-secondary" type="submit"><Sparkles className="h-4 w-4" aria-hidden="true" /> Re-structure</button>
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

// Plain-language type chips, color-grouped: trades green/red-adjacent, daily gold, learning gray.
function TypeBadge({ type }: { type: string }) {
  const config: Record<string, { label: string; className: string }> = {
    TRADE_ENTRY_NOTE: { label: "Trade", className: "bg-emerald-50 text-forge-green" },
    TRADE_EXIT_REVIEW: { label: "Exit review", className: "bg-sky-50 text-forge-blue" },
    DAILY_CHECKIN: { label: "Check-in", className: "bg-amber-50 text-amber-700" },
    EOD_REVIEW: { label: "Day review", className: "bg-amber-50 text-amber-700" },
    WEEKLY_REFLECTION: { label: "Weekly", className: "bg-amber-50 text-amber-700" },
    PLAYBOOK_NOTE: { label: "Playbook", className: "bg-forge-panel text-forge-muted" },
    GENERAL_LEARNING_NOTE: { label: "Learning", className: "bg-forge-panel text-forge-muted" },
    MISTAKE_REFLECTION: { label: "Mistake note", className: "bg-forge-panel text-forge-muted" },
  };
  const { label, className } = config[type] ?? { label: "Note", className: "bg-forge-panel text-forge-muted" };
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${className}`}>{label}</span>;
}

function StatusBadge({ status, confidence }: { status: string; confidence: string | null }) {
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
        Ready to confirm
      </span>
    );
  }
  return <span className="shrink-0 text-xs text-forge-muted">Raw</span>;
}

function parseStructuredJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function destinationLabel(type: string, hasTradeLink: boolean, hasDailyLink: boolean) {
  if (type === "TRADE_ENTRY_NOTE") return "Confirming creates a new trade in your log.";
  if (type === "TRADE_EXIT_REVIEW") return hasTradeLink ? "Confirming updates the linked trade's review." : "Needs a trade link before confirming.";
  if (type === "EOD_REVIEW") return hasDailyLink ? "Confirming updates the linked daily review." : "Confirming saves this date's evening review.";
  if (type === "DAILY_CHECKIN") return hasDailyLink ? "Confirming updates the linked check-in." : "Confirming saves this date's check-in.";
  if (type === "GENERAL_LEARNING_NOTE" || type === "PLAYBOOK_NOTE" || type === "MISTAKE_REFLECTION") return "Confirming saves the lessons from this note.";
  return "Check the type, then confirm.";
}

function confirmButtonLabel(type: string) {
  if (type === "TRADE_ENTRY_NOTE") return "Create trade";
  if (type === "TRADE_EXIT_REVIEW") return "Save exit review";
  if (type === "EOD_REVIEW") return "Save day review";
  if (type === "DAILY_CHECKIN") return "Save check-in";
  return "Confirm";
}

// Editable review card. Only the fields relevant to the detected note type are
// shown; the confirm action reads back exactly the inputs that were rendered.
function ReviewFields({ structured, detectedType }: { structured: Record<string, unknown> | null; detectedType: string }) {
  const v = (key: string) => getText(structured, key);
  const isTrade = detectedType === "TRADE_ENTRY_NOTE" || detectedType === "TRADE_EXIT_REVIEW";
  const isExit = detectedType === "TRADE_EXIT_REVIEW";
  const isDaily = detectedType === "EOD_REVIEW" || detectedType === "DAILY_CHECKIN";

  if (isTrade) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Type" name="transcriptType" options={transcriptTypes} defaultValue={detectedType} />
          <TextField label="Instrument" name="instrument" defaultValue={v("instrument")} />
          <SelectField label="Direction" name="direction" options={directions} defaultValue={v("direction") ?? "UNKNOWN"} />
          <TextField label="Setup" name="setupName" defaultValue={v("setupName")} />
          <SelectField label="Mind state" name="emotionalState" options={mindStateOptions} defaultValue={v("emotionalState")} includeBlank />
          {!isExit ? <SelectField label="Risk posture" name="riskPosture" options={riskPostures} defaultValue={v("riskPosture") ?? "NORMAL"} /> : null}
        </div>
        <TextAreaField label="Thesis" name="entryThesis" rows={2} defaultValue={v("entryThesis")} />
        <TextField label="Invalidation" name="invalidation" defaultValue={v("invalidation")} />
        {isExit ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextAreaField label="Exit reason" name="exitReason" rows={2} defaultValue={v("exitReason")} />
            <SelectField label="Followed plan" name="followedPlan" options={followedPlanOptions} defaultValue={v("followedPlan") ?? "NA"} />
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Entry price" name="entryPrice" type="number" defaultValue={v("entryPrice")} />
          <TextField label="Stop price" name="stopPrice" type="number" defaultValue={v("stopPrice")} />
          <TextField label="Target price" name="targetPrice" type="number" defaultValue={v("targetPrice")} />
          <TextField label="Exit price" name="exitPrice" type="number" defaultValue={v("exitPrice")} />
          <TextField label="Quantity" name="quantity" type="number" defaultValue={v("quantity")} />
          <TextField label="Leverage" name="leverage" type="number" defaultValue={v("leverage")} />
          <TextField label="Realized P&amp;L" name="realizedPnl" type="number" defaultValue={v("realizedPnl")} />
        </div>
        <LessonsField structured={structured} />
      </div>
    );
  }

  if (isDaily) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="Type" name="transcriptType" options={transcriptTypes} defaultValue={detectedType} />
          <SelectField label="Main emotion" name="mainEmotion" options={mindStateOptions} defaultValue={v("mainEmotion")} includeBlank />
          <BoolSelect label="Traded today" name="tradedToday" defaultValue={getBool(structured, "tradedToday")} />
          <BoolSelect label="Followed max loss" name="followedMaxLoss" defaultValue={getBool(structured, "followedMaxLoss")} />
          <BoolSelect label="Followed max trades" name="followedMaxTrades" defaultValue={getBool(structured, "followedMaxTrades")} />
          <TextField label="Discipline (1-10)" name="disciplineScore" type="number" defaultValue={v("disciplineScore")} />
        </div>
        <TextField label="Best decision" name="bestDecision" defaultValue={v("bestDecision")} />
        <TextField label="Worst decision" name="worstDecision" defaultValue={v("worstDecision")} />
        <TextField label="Main mistake" name="mainMistake" defaultValue={v("mainMistake")} />
        <TextField label="One thing done well" name="oneThingDoneWell" defaultValue={v("oneThingDoneWell")} />
        <TextField label="Avoid tomorrow" name="oneThingToAvoidTomorrow" defaultValue={v("oneThingToAvoidTomorrow")} />
        <LessonsField structured={structured} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <SelectField label="Type" name="transcriptType" options={transcriptTypes} defaultValue={detectedType} />
      <LessonsField structured={structured} />
    </div>
  );
}

function LessonsField({ structured }: { structured: Record<string, unknown> | null }) {
  return <TextAreaField label="Lessons (one per line)" name="lessonsText" rows={3} defaultValue={getLessonsList(structured).join("\n")} />;
}

function getBool(structured: Record<string, unknown> | null, key: string) {
  const value = structured?.[key];
  return typeof value === "boolean" ? value : null;
}

function getText(structured: Record<string, unknown> | null, key: string) {
  const value = structured?.[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return null;
}

function getList(structured: Record<string, unknown> | null, key: string) {
  const value = structured?.[key];
  if (!Array.isArray(value) || !value.length) return null;
  return value.map((item) => String(item)).join(", ");
}

function getLessonsList(structured: Record<string, unknown> | null): string[] {
  const value = structured?.lessons;
  if (!Array.isArray(value) || !value.length) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "lessonText" in item) return String((item as { lessonText: unknown }).lessonText);
      return null;
    })
    .filter((item): item is string => Boolean(item));
}
