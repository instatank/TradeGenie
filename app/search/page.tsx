import Link from "next/link";
import { format } from "date-fns";
import { PageTitle } from "@/components/Fields";
import { humanize } from "@/lib/constants";
import { db, getTranscriptsWithLinks, getTradesWithMistakes } from "@/lib/data";
import { getTradePnl } from "@/lib/metrics";
import { stripFormatting } from "@/lib/richtext";

export default async function SearchPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams ?? {};
  const query = (params.q ?? "").trim();
  const normalized = query.toLowerCase();
  const [trades, transcripts, lessons, rawExecutions, weeklyReviews] = await Promise.all([
    getTradesWithMistakes(),
    getTranscriptsWithLinks(),
    db.list("lessons"),
    db.list("rawExecutions"),
    db.list("weeklyReviews"),
  ]);

  const results = normalized
    ? {
        trades: trades.filter((trade) => includesAny(normalized, [
          trade.instrument,
          trade.setupName,
          trade.entryThesis,
          trade.invalidation,
          trade.concern,
          trade.lesson,
          trade.notes,
          trade.direction,
          trade.status,
          ...trade.mistakeTags.map((link) => link.mistakeTag.label),
        ])).sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime()),
        transcripts: transcripts.filter((transcript) => includesAny(normalized, [
          transcript.rawText,
          transcript.cleanedSummary,
          transcript.sourceTool,
          transcript.transcriptType,
          transcript.processingStatus,
        ])).sort((a, b) => b.transcriptDateTime.getTime() - a.transcriptDateTime.getTime()),
        lessons: lessons.filter((lesson) => includesAny(normalized, [
          lesson.lessonText,
          lesson.category,
          lesson.sourceType,
        ])).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
        rawExecutions: rawExecutions.filter((execution) => includesAny(normalized, [
          execution.instrument,
          execution.side,
          execution.exchangeBroker,
          execution.orderId,
          execution.rawJson,
        ])).sort((a, b) => b.executionDateTime.getTime() - a.executionDateTime.getTime()),
        weeklyReviews: weeklyReviews.filter((review) => includesAny(normalized, [
          review.summaryText,
          review.bestLesson,
          review.actionItem,
          review.mostCommonMistake,
        ])).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      }
    : null;

  const total = results
    ? results.trades.length + results.transcripts.length + results.lessons.length + results.rawExecutions.length + results.weeklyReviews.length
    : 0;

  return (
    <main className="page-shell">
      <PageTitle title="Search" subtitle="Find trades, voice notes, lessons, imported rows, and reviews from one place." />
      <form className="panel mb-5 flex flex-col gap-3 sm:flex-row">
        <input name="q" type="search" defaultValue={query} placeholder="Search by instrument, setup, mistake, note text..." className="input flex-1" />
        <button className="button" type="submit">Search</button>
      </form>

      {!query ? <div className="panel muted">Type a term above or use the header search.</div> : null}
      {query && results ? (
        <div className="space-y-5">
          <p className="text-sm text-forge-muted">{total} result{total === 1 ? "" : "s"} for <span className="font-medium text-forge-ink">{query}</span></p>
          <ResultSection title="Trades" count={results.trades.length}>
            {results.trades.slice(0, 10).map((trade) => (
              <Link key={trade.id} href={`/trades/${trade.id}`} className="block rounded-md border border-forge-line p-3 transition hover:bg-forge-panel">
                <div className="font-medium">{trade.instrument} · {humanize(trade.direction)} · {humanize(trade.status)}</div>
                <div className="mt-1 text-sm text-forge-muted">{format(trade.tradeDateTime, "dd MMM yyyy")} · P&L {formatNumber(getTradePnl(trade))} · {trade.setupName ?? "No setup"}</div>
              </Link>
            ))}
          </ResultSection>
          <ResultSection title="Voice Notes" count={results.transcripts.length}>
            {results.transcripts.slice(0, 10).map((transcript) => (
              <Link key={transcript.id} href="/inbox" className="block rounded-md border border-forge-line p-3 transition hover:bg-forge-panel">
                <div className="font-medium">{humanize(transcript.transcriptType)} · {humanize(transcript.processingStatus)}</div>
                <div className="mt-1 text-sm text-forge-muted">{format(transcript.transcriptDateTime, "dd MMM yyyy HH:mm")} · {preview(transcript.cleanedSummary ?? transcript.rawText)}</div>
              </Link>
            ))}
          </ResultSection>
          <ResultSection title="Lessons" count={results.lessons.length}>
            {results.lessons.slice(0, 10).map((lesson) => (
              <Link key={lesson.id} href="/lessons" className="block rounded-md border border-forge-line p-3 transition hover:bg-forge-panel">
                <div className="font-medium">{stripFormatting(lesson.lessonText)}</div>
                <div className="mt-1 text-sm text-forge-muted">{humanize(lesson.category)} · {humanize(lesson.sourceType)}</div>
              </Link>
            ))}
          </ResultSection>
          <ResultSection title="Raw Executions" count={results.rawExecutions.length}>
            {results.rawExecutions.slice(0, 10).map((execution) => (
              <Link key={execution.id} href="/import" className="block rounded-md border border-forge-line p-3 transition hover:bg-forge-panel">
                <div className="font-medium">{execution.instrument} · {execution.side ?? "Side NA"}</div>
                <div className="mt-1 text-sm text-forge-muted">{format(execution.executionDateTime, "dd MMM yyyy HH:mm")} · qty {execution.quantity ?? "NA"} · value {execution.totalOrderValue ?? "NA"}</div>
              </Link>
            ))}
          </ResultSection>
          <ResultSection title="Weekly Reviews" count={results.weeklyReviews.length}>
            {results.weeklyReviews.slice(0, 10).map((review) => (
              <Link key={review.id} href="/weekly-review" className="block rounded-md border border-forge-line p-3 transition hover:bg-forge-panel">
                <div className="font-medium">{format(review.weekStart, "dd MMM")} - {format(review.weekEnd, "dd MMM yyyy")}</div>
                <div className="mt-1 text-sm text-forge-muted">{preview(stripFormatting(review.summaryText))}</div>
              </Link>
            ))}
          </ResultSection>
        </div>
      ) : null}
    </main>
  );
}

function ResultSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="panel">
      <h2 className="mb-3 font-semibold">{title} <span className="text-sm font-normal text-forge-muted">({count})</span></h2>
      <div className="space-y-2">{count ? children : <p className="muted">No matches.</p>}</div>
    </section>
  );
}

function includesAny(query: string, values: Array<string | number | null | undefined>) {
  return values.some((value) => String(value ?? "").toLowerCase().includes(query));
}

function preview(value: string | null) {
  if (!value) return "No preview";
  return value.length > 180 ? `${value.slice(0, 180)}...` : value;
}

function formatNumber(value: number | null | undefined) {
  return value == null ? "NA" : value.toFixed(2);
}
