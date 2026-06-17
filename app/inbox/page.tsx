import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight, CheckCircle2, FileText, Link2, Mic, Pencil, Sparkles, Trash2 } from "lucide-react";
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
import { CalendarRangeControls } from "@/components/CalendarRangeControls";
import { BoolSelect, PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { PaginationControls, ViewTabs, normalizePage, normalizePageSize, paginate } from "@/components/ListControls";
import { getCalendarRange, isWithinCalendarRange } from "@/lib/calendar";
import { directions, followedPlanOptions, humanize, mindStateOptions, riskPostures, transcriptTypes } from "@/lib/constants";
import { db, getTranscriptsWithLinks } from "@/lib/data";
import { getSettings } from "@/lib/settings-store";

const inboxViews = [
  { label: "To review", value: "review" },
  { label: "Needs Link", value: "needs-link" },
  { label: "Confirmed", value: "confirmed" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" },
];

export default async function InboxPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams ?? {};
  const [settings, transcripts, trades, journals] = await Promise.all([
    getSettings(),
    getTranscriptsWithLinks(),
    db.list("trades"),
    db.list("dailyJournals"),
  ]);
  const view = params.view ?? "review";
  const sort = params.sort ?? "date-desc";
  const page = normalizePage(params.page);
  const pageSize = normalizePageSize(params.pageSize, [5, 10, 25], 10);
  const calendarRange = getCalendarRange(params);
  const filteredTranscripts = transcripts
    .filter((transcript) => applyInboxView(transcript, view))
    .filter((transcript) => isWithinCalendarRange(transcript.transcriptDateTime, calendarRange))
    .sort((a, b) => compareTranscripts(a, b, sort));
  const pagedTranscripts = paginate(filteredTranscripts, page, pageSize);
  const recentTrades = trades.sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime()).slice(0, 50);
  const recentJournals = journals.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 30);

  return (
    <main className="page-shell">
      <PageTitle title="Voice Inbox" subtitle="Drop a note. It auto-structures into a draft you review, edit, and confirm in one place — nothing is saved until you confirm." />

      <ViewTabs basePath="/inbox" current={view} params={params} tabs={inboxViews} />
      <CalendarRangeControls basePath="/inbox" params={params} range={calendarRange} total={filteredTranscripts.length} />

      <section className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <form action={saveTranscriptAction} className="panel h-fit space-y-4">
          <div className="flex items-center gap-2">
            <Mic className="h-5 w-5 text-forge-blue" aria-hidden="true" />
            <h2 className="font-semibold">Paste a dictated note</h2>
          </div>
          <TextAreaField
            label="Voice note transcript"
            name="rawText"
            required
            rows={10}
            placeholder="Example: BTC long idea. Setup is range reclaim. Thesis is buyers defended the retest. Invalidation is back inside the range. I feel calm but slightly impatient."
          />
          <TextField label="Note time" name="transcriptDateTime" type="datetime-local" defaultValue={format(new Date(), "yyyy-MM-dd'T'HH:mm")} />
          <TextField label="Dictation source" name="sourceTool" defaultValue={settings.defaultSourceTool} />
          <SelectField label="Save as" name="transcriptType" options={transcriptTypes} defaultValue="UNKNOWN" />
          <button className="button" type="submit">Save &amp; review</button>
          <div className="rounded-lg bg-forge-panel p-3 text-sm text-forge-muted">
            <p className="font-medium text-forge-ink">How it works</p>
            <div className="mt-2 grid gap-2">
              <Step icon={<FileText className="h-4 w-4" />} text="Paste or dictate your note" />
              <Step icon={<Sparkles className="h-4 w-4" />} text="It auto-structures into a draft" />
              <Step icon={<CheckCircle2 className="h-4 w-4" />} text="Review, edit, and confirm in one place" />
            </div>
          </div>
        </form>

        <div className="space-y-4">
          <details className="panel" open={sort !== "date-desc" || pageSize !== 10}>
            <summary className="cursor-pointer text-sm font-semibold">
              Sorting
              <span className="ml-2 font-normal text-forge-muted">{filteredTranscripts.length} note{filteredTranscripts.length === 1 ? "" : "s"}</span>
            </summary>
            <form className="mt-4 grid gap-3 sm:grid-cols-2">
              <input type="hidden" name="view" value={view} />
              <label className="field">
                <span className="label">Sort</span>
                <select name="sort" defaultValue={sort} className="input">
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="type-asc">Type A-Z</option>
                  <option value="status-asc">Status A-Z</option>
                </select>
              </label>
              <label className="field">
                <span className="label">Rows</span>
                <select name="pageSize" defaultValue={String(pageSize)} className="input">
                  <option value="5">5</option>
                  <option value="10">10</option>
                  <option value="25">25</option>
                </select>
              </label>
              <div className="flex items-end gap-2 sm:col-span-2">
                <button className="button" type="submit">Apply</button>
                <Link href="/inbox" className="button-secondary">Reset</Link>
              </div>
            </form>
          </details>

          {pagedTranscripts.map((transcript) => {
            const structured = parseStructuredJson(transcript.structuredJson);
            const detectedType = getText(structured, "transcriptType") ?? transcript.transcriptType;
            const destination = destinationLabel(detectedType, Boolean(transcript.linkedTradeId), Boolean(transcript.linkedDailyJournalId));
            const needsTradeLink = detectedType === "TRADE_EXIT_REVIEW" && !transcript.linkedTradeId;
            return (
            <details key={transcript.id} className="panel group">
              <summary className="grid cursor-pointer gap-3 sm:grid-cols-[180px_1fr_180px] sm:items-center">
                <div>
                  <div className="font-semibold">{humanize(transcript.transcriptType)}</div>
                  <div className="text-xs text-forge-muted">{humanize(transcript.processingStatus)}</div>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm text-forge-muted">{transcript.cleanedSummary ?? transcript.rawText}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-forge-muted">
                    {transcript.linkedTrade ? <span>Trade: {transcript.linkedTrade.instrument}</span> : null}
                    {transcript.linkedDailyJournal ? <span>Daily: {format(transcript.linkedDailyJournal.date, "dd MMM")}</span> : null}
                    {transcript.structuredJson ? <span>Structured</span> : <span>Raw</span>}
                  </div>
                </div>
                <div className="text-sm text-forge-muted sm:text-right">
                  {format(transcript.transcriptDateTime, "dd MMM HH:mm")}
                </div>
              </summary>
              <div className="mt-4 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="font-semibold">{humanize(transcript.transcriptType)} · {humanize(transcript.processingStatus)}</h2>
                  <p className="muted">{format(transcript.transcriptDateTime, "dd MMM yyyy HH:mm")} · {transcript.sourceTool ?? "No source"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <form action={structureTranscriptAction}>
                    <input type="hidden" name="id" value={transcript.id} />
                    <button className={transcript.structuredJson ? "button-secondary" : "button"} type="submit">
                      <Sparkles className="h-4 w-4" aria-hidden="true" />
                      {transcript.structuredJson ? "Re-structure note" : "Structure note"}
                    </button>
                  </form>
                  <form action={archiveTranscriptAction}>
                    <input type="hidden" name="id" value={transcript.id} />
                    <button className="button-danger" type="submit">Archive</button>
                  </form>
                  <form action={deleteTranscriptAction}>
                    <input type="hidden" name="id" value={transcript.id} />
                    <button className="button-danger min-h-10 px-2" type="submit" title="Delete voice note" aria-label="Delete voice note">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </form>
                </div>
              </div>

              <div className="rounded-md bg-forge-panel p-3 text-sm text-forge-muted">
                {transcript.rawText}
              </div>

              <details className="rounded-lg border border-forge-line p-3">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                  <Pencil className="h-4 w-4 text-forge-blue" aria-hidden="true" />
                  Edit raw voice note
                </summary>
                <form action={updateTranscriptAction} className="mt-4 grid gap-3 sm:grid-cols-2">
                  <input type="hidden" name="id" value={transcript.id} />
                  <div className="sm:col-span-2">
                    <TextAreaField label="Voice note transcript" name="rawText" defaultValue={transcript.rawText} rows={5} />
                  </div>
                  <TextField label="Note time" name="transcriptDateTime" type="datetime-local" defaultValue={format(transcript.transcriptDateTime, "yyyy-MM-dd'T'HH:mm")} />
                  <TextField label="Dictation source" name="sourceTool" defaultValue={transcript.sourceTool} />
                  <SelectField label="Save as" name="transcriptType" options={transcriptTypes} defaultValue={transcript.transcriptType} />
                  <div className="flex items-end">
                    <button className="button-secondary w-full" type="submit">Save note edits</button>
                  </div>
                </form>
              </details>

              {transcript.structuredJson ? (
                <section className="rounded-lg border-2 border-forge-blue/40 p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Review &amp; edit this draft</h3>
                      <p className="mt-1 text-sm text-forge-muted">{destination}</p>
                    </div>
                    <ConfidenceBadge level={getText(structured, "confidence") ?? transcript.aiConfidence ?? "LOW"} />
                  </div>

                  {getText(structured, "confidence") === "LOW" || (transcript.aiConfidence === "LOW" && !getText(structured, "confidence")) ? (
                    <p className="mt-2 text-xs text-amber-700">Low confidence — read the fields carefully and fix anything below before confirming.</p>
                  ) : null}

                  <form action={confirmTranscriptAction} className="mt-3 space-y-3">
                    <input type="hidden" name="id" value={transcript.id} />
                    <ReviewFields structured={structured} detectedType={detectedType} />

                    {getList(structured, "suggestedMistakeTags") ? (
                      <p className="text-xs text-forge-muted">Mistakes detected: {getList(structured, "suggestedMistakeTags")} (saved with this record).</p>
                    ) : null}

                    {needsTradeLink ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        This is an exit review. Link it to the trade it reviews (below) before you can confirm.
                      </div>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-2 border-t border-forge-line pt-3">
                      <button className="button" type="submit" disabled={needsTradeLink}>
                        <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        {confirmButtonLabel(detectedType)}
                      </button>
                      <span className="text-xs text-forge-muted">Confirming writes to your journal. Nothing is saved until you click.</span>
                    </div>
                  </form>

                  <form action={extractLessonsAction} className="mt-2">
                    <input type="hidden" name="id" value={transcript.id} />
                    <button className="button-secondary" type="submit">Save lessons only</button>
                  </form>

                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-forge-muted">Raw structured JSON</summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-[#101418] p-3 text-xs text-white">{transcript.structuredJson}</pre>
                  </details>
                </section>
              ) : (
                <div className="rounded-lg border border-dashed border-forge-line p-3 text-sm text-forge-muted">
                  Not structured yet. Click <span className="font-medium text-forge-ink">Structure note</span> above to turn this into a reviewable draft you can confirm.
                </div>
              )}

              <form action={linkTranscriptAction} className="grid gap-3 rounded-lg border border-forge-line p-3 sm:grid-cols-2">
                <input type="hidden" name="id" value={transcript.id} />
                <div className="flex items-center gap-2 sm:col-span-2">
                  <Link2 className="h-4 w-4 text-forge-blue" aria-hidden="true" />
                  <h3 className="text-sm font-semibold">Attach to an existing record</h3>
                </div>
                <label className="field">
                  <span className="label">Link to trade</span>
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
                  <span className="label">Link to daily journal</span>
                  <select name="linkedDailyJournalId" defaultValue={transcript.linkedDailyJournalId ?? ""} className="input">
                    <option value="">No daily journal</option>
                    {recentJournals.map((journal) => (
                      <option key={journal.id} value={journal.id}>{format(journal.date, "dd MMM yyyy")}</option>
                    ))}
                  </select>
                </label>
                <button className="button-secondary sm:col-span-2" type="submit">
                  Save links
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </form>

              <div className="flex flex-wrap gap-2 text-sm">
                {transcript.linkedTrade ? <Link className="text-forge-blue hover:underline" href={`/trades/${transcript.linkedTrade.id}`}>Linked trade: {transcript.linkedTrade.instrument}</Link> : null}
                {transcript.linkedDailyJournal ? <Link className="text-forge-blue hover:underline" href={`/daily?date=${format(transcript.linkedDailyJournal.date, "yyyy-MM-dd")}`}>Linked daily: {format(transcript.linkedDailyJournal.date, "dd MMM yyyy")}</Link> : null}
              </div>
              </div>
            </details>
            );
          })}
          {!filteredTranscripts.length ? <div className="panel muted">No voice notes in this view.</div> : null}
          <PaginationControls basePath="/inbox" params={params} page={page} pageSize={pageSize} total={filteredTranscripts.length} />
        </div>
      </section>
    </main>
  );
}

type InboxRow = Awaited<ReturnType<typeof getTranscriptsWithLinks>>[number];

function applyInboxView(transcript: InboxRow, view: string) {
  if (view === "review") return transcript.processingStatus === "UNPROCESSED" || transcript.processingStatus === "STRUCTURED";
  if (view === "unprocessed") return transcript.processingStatus === "UNPROCESSED";
  if (view === "structured") return transcript.processingStatus === "STRUCTURED";
  if (view === "confirmed") return transcript.processingStatus === "CONFIRMED";
  if (view === "archived") return transcript.processingStatus === "ARCHIVED";
  if (view === "needs-link") {
    const structured = parseStructuredJson(transcript.structuredJson);
    const type = getText(structured, "transcriptType") ?? transcript.transcriptType;
    return type === "TRADE_EXIT_REVIEW" && !transcript.linkedTradeId;
  }
  return true;
}

function compareTranscripts(a: InboxRow, b: InboxRow, sort: string) {
  if (sort === "date-asc") return a.transcriptDateTime.getTime() - b.transcriptDateTime.getTime();
  if (sort === "type-asc") return a.transcriptType.localeCompare(b.transcriptType) || b.transcriptDateTime.getTime() - a.transcriptDateTime.getTime();
  if (sort === "status-asc") return a.processingStatus.localeCompare(b.processingStatus) || b.transcriptDateTime.getTime() - a.transcriptDateTime.getTime();
  return b.transcriptDateTime.getTime() - a.transcriptDateTime.getTime();
}

function ConfidenceBadge({ level }: { level: string }) {
  const normalized = level.toUpperCase();
  const tone =
    normalized === "HIGH" ? "bg-forge-green/15 text-forge-green" :
    normalized === "MEDIUM" ? "bg-forge-blue/15 text-forge-blue" :
    "bg-amber-100 text-amber-800";
  return (
    <span className={`inline-flex w-fit items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${tone}`}>
      {humanize(normalized)} confidence
    </span>
  );
}

function Step({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-forge-blue">{icon}</span>
      <span>{text}</span>
    </div>
  );
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
  if (type === "TRADE_ENTRY_NOTE") return "Confirming creates a new trade note from this voice note.";
  if (type === "TRADE_EXIT_REVIEW") return hasTradeLink ? "Confirming updates the linked trade's exit review." : "This is an exit review. Link it to a trade, then confirm.";
  if (type === "EOD_REVIEW") return hasDailyLink ? "Confirming updates the linked daily review." : "Confirming creates or updates the daily EOD review for this date.";
  if (type === "DAILY_CHECKIN") return hasDailyLink ? "Confirming updates the linked daily check-in." : "Confirming creates or updates the daily check-in for this date.";
  if (type === "GENERAL_LEARNING_NOTE" || type === "PLAYBOOK_NOTE" || type === "MISTAKE_REFLECTION") return "Confirming saves extracted lessons and keeps this note linked in the inbox.";
  return "Structure the note, review the suggested destination, then confirm or link it manually.";
}

function confirmButtonLabel(type: string) {
  if (type === "TRADE_ENTRY_NOTE") return "Create trade note";
  if (type === "TRADE_EXIT_REVIEW") return "Save exit review";
  if (type === "EOD_REVIEW") return "Save EOD review";
  if (type === "DAILY_CHECKIN") return "Save daily check-in";
  return "Confirm draft";
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
