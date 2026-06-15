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
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { PaginationControls, ViewTabs, normalizePage, normalizePageSize, paginate } from "@/components/ListControls";
import { getCalendarRange, isWithinCalendarRange } from "@/lib/calendar";
import { humanize, transcriptTypes } from "@/lib/constants";
import { db, getTranscriptsWithLinks } from "@/lib/data";
import { getSettings } from "@/lib/settings-store";

const inboxViews = [
  { label: "Unprocessed", value: "unprocessed" },
  { label: "Structured", value: "structured" },
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
  const view = params.view ?? "unprocessed";
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
      <PageTitle title="Voice Inbox" subtitle="Drop dictated notes here first. The app turns them into draft trade, daily, exit, or lesson records only after you confirm." />

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
          <button className="button" type="submit">Save voice note</button>
          <div className="rounded-lg bg-forge-panel p-3 text-sm text-forge-muted">
            <p className="font-medium text-forge-ink">Current flow</p>
            <div className="mt-2 grid gap-2">
              <Step icon={<FileText className="h-4 w-4" />} text="Save the raw note" />
              <Step icon={<Sparkles className="h-4 w-4" />} text="Structure it into suggested fields" />
              <Step icon={<CheckCircle2 className="h-4 w-4" />} text="Confirm the draft into the right journal record" />
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
            <article key={transcript.id} className="panel space-y-4">
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
                      Structure note
                    </button>
                  </form>
                  <form action={confirmTranscriptAction}>
                    <input type="hidden" name="id" value={transcript.id} />
                    <button className="button" type="submit" disabled={!transcript.structuredJson || needsTradeLink}>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                      {confirmButtonLabel(detectedType)}
                    </button>
                  </form>
                  <form action={extractLessonsAction}>
                    <input type="hidden" name="id" value={transcript.id} />
                    <button className="button-secondary" type="submit">Save lessons only</button>
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
                <section className="rounded-lg border border-forge-line p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <h3 className="text-sm font-semibold">Draft destination</h3>
                      <p className="mt-1 text-sm text-forge-muted">{destination}</p>
                    </div>
                    <span className="inline-flex w-fit items-center gap-1 rounded-md bg-forge-panel px-2 py-1 text-xs font-medium text-forge-muted">
                      {humanize(getText(structured, "confidence") ?? transcript.aiConfidence ?? "LOW")} confidence
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {structuredRows(structured).map((row) => (
                      <div key={row.label} className="rounded-md bg-forge-panel p-3">
                        <div className="text-xs font-medium uppercase tracking-wide text-forge-muted">{row.label}</div>
                        <div className="mt-1 text-sm">{row.value}</div>
                      </div>
                    ))}
                  </div>

                  {needsTradeLink ? (
                    <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                      Link this note to the trade it reviews before confirming.
                    </div>
                  ) : null}

                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-forge-muted">Raw structured JSON</summary>
                    <pre className="mt-2 max-h-80 overflow-auto rounded-md bg-[#101418] p-3 text-xs text-white">{transcript.structuredJson}</pre>
                  </details>
                </section>
              ) : null}

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
            </article>
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

function structuredRows(structured: Record<string, unknown> | null) {
  if (!structured) return [];
  const rows = [
    ["Type", getText(structured, "transcriptType")],
    ["Instrument", getText(structured, "instrument")],
    ["Direction", getText(structured, "direction")],
    ["Setup", getText(structured, "setupName")],
    ["Thesis", getText(structured, "entryThesis")],
    ["Invalidation", getText(structured, "invalidation")],
    ["Exit reason", getText(structured, "exitReason")],
    ["Followed plan", getText(structured, "followedPlan")],
    ["Emotion", getText(structured, "emotionalState") ?? getText(structured, "mainEmotion")],
    ["Mistakes", getList(structured, "suggestedMistakeTags") ?? getText(structured, "mainMistake")],
    ["Lessons", getLessons(structured)],
    ["Missing info", getList(structured, "missingInfo")],
  ];
  return rows
    .filter((row): row is [string, string] => Boolean(row[1]))
    .slice(0, 10)
    .map(([label, value]) => ({ label, value }));
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

function getLessons(structured: Record<string, unknown> | null) {
  const value = structured?.lessons;
  if (!Array.isArray(value) || !value.length) return null;
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "lessonText" in item) return String(item.lessonText);
      return null;
    })
    .filter(Boolean)
    .join("; ");
}
