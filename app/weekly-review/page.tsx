import Link from "next/link";
import { format, startOfMonth, startOfWeek } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { deleteWeeklyReviewAction, generateWeeklyReviewAction, updateWeeklyReviewAction } from "@/app/actions";
import { CalendarRangeControls } from "@/components/CalendarRangeControls";
import { PageTitle, TextAreaField, TextField } from "@/components/Fields";
import { FormattedText } from "@/components/FormattedText";
import { PaginationControls, ViewTabs, normalizePage, normalizePageSize, paginate } from "@/components/ListControls";
import { getCalendarRange } from "@/lib/calendar";
import { db } from "@/lib/data";
import { stripFormatting } from "@/lib/richtext";
import type { WeeklyReview } from "@/lib/types";

const weeklyViews = [
  { label: "All", value: "all" },
  { label: "This Month", value: "this-month" },
  { label: "Profitable", value: "profitable" },
  { label: "Needs Action", value: "needs-action" },
  { label: "With Action", value: "with-action" },
];

export default async function WeeklyReviewPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams ?? {};
  const view = params.view ?? "all";
  const sort = params.sort ?? "saved-desc";
  const page = normalizePage(params.page);
  const pageSize = normalizePageSize(params.pageSize, [5, 10, 25], 10);
  const calendarRange = getCalendarRange(params);
  const monthStart = startOfMonth(new Date());
  const reviews = (await db.list("weeklyReviews"))
    .filter((review) => applyWeeklyView(review, view, monthStart))
    .filter((review) => isWeeklyReviewInRange(review, calendarRange))
    .sort((a, b) => compareWeeklyReviews(a, b, sort));
  const pagedReviews = paginate(reviews, page, pageSize);
  const today = new Date();
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });

  return (
    <main className="page-shell max-w-4xl">
      <PageTitle title="Weekly Review" subtitle="Generate the numbers, then save one simple written review." />
      <ViewTabs basePath="/weekly-review" current={view} params={params} tabs={weeklyViews} />
      <CalendarRangeControls basePath="/weekly-review" params={params} range={calendarRange} total={reviews.length} />
      <section className="panel mb-5">
        <form action={generateWeeklyReviewAction} className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
          <TextField label="Week containing date" name="weekDate" type="date" defaultValue={format(weekStart, "yyyy-MM-dd")} />
          <button className="button" type="submit">Generate and save review</button>
        </form>
      </section>

      <details className="panel mb-5" open={sort !== "saved-desc" || pageSize !== 10}>
        <summary className="cursor-pointer text-sm font-semibold">
          Sorting
          <span className="ml-2 font-normal text-forge-muted">{reviews.length} review{reviews.length === 1 ? "" : "s"}</span>
        </summary>
        <form className="mt-4 grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="view" value={view} />
          <label className="field">
            <span className="label">Sort</span>
            <select name="sort" defaultValue={sort} className="input">
              <option value="saved-desc">Recently saved</option>
              <option value="week-desc">Latest week first</option>
              <option value="week-asc">Oldest week first</option>
              <option value="pnl-desc">P&L high-low</option>
              <option value="pnl-asc">P&L low-high</option>
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
            <Link href="/weekly-review" className="button-secondary">Reset</Link>
          </div>
        </form>
      </details>

      <div className="space-y-4">
        {pagedReviews.map((review) => (
          <article key={review.id} className="panel">
            <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="font-semibold">{format(review.weekStart, "dd MMM")} - {format(review.weekEnd, "dd MMM yyyy")}</h2>
                <span className="text-sm text-forge-muted">Saved {format(review.createdAt, "dd MMM HH:mm")}</span>
              </div>
              <div className="flex justify-end gap-1">
                <details className="relative">
                  <summary className="button-secondary min-h-8 cursor-pointer list-none px-2" title="Edit weekly review" aria-label="Edit weekly review">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </summary>
                  <div className="absolute right-0 z-10 mt-2 w-[min(680px,calc(100vw-2rem))] rounded-lg border border-forge-line bg-white p-4 shadow-lg">
                    <form action={updateWeeklyReviewAction} className="space-y-3">
                      <input type="hidden" name="id" value={review.id} />
                      <TextAreaField label="Summary" name="summaryText" defaultValue={review.summaryText} rows={5} />
                      <TextAreaField label="Best lesson" name="bestLesson" defaultValue={review.bestLesson} rows={3} />
                      <TextAreaField label="Action item" name="actionItem" defaultValue={review.actionItem} rows={3} />
                      <button className="button-secondary" type="submit">Save review</button>
                    </form>
                  </div>
                </details>
                <form action={deleteWeeklyReviewAction}>
                  <input type="hidden" name="id" value={review.id} />
                  <button className="button-danger min-h-8 px-2" type="submit" title="Delete weekly review" aria-label="Delete weekly review">
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </form>
              </div>
            </div>
            <FormattedText text={review.summaryText} className="text-sm leading-6" />
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <MiniMetric label="Trades" value={review.totalTrades} />
              <MiniMetric label="Net P&L" value={formatMaybe(review.totalPnl)} />
              <MiniMetric label="Total R" value={formatMaybe(review.totalR)} />
              <MiniMetric label="Win rate" value={review.winRate == null ? "NA" : `${(review.winRate * 100).toFixed(0)}%`} />
              <MiniMetric label="Profit factor" value={formatMaybe(review.profitFactor)} />
              <MiniMetric label="Expectancy" value={formatMaybe(review.expectancy)} />
              <MiniMetric label="Rule adherence" value={review.ruleAdherenceRate == null ? "NA" : `${(review.ruleAdherenceRate * 100).toFixed(0)}%`} />
              <MiniMetric label="Common mistake" value={review.mostCommonMistake ?? "NA"} />
              <MiniMetric label="Action item" value={review.actionItem ? stripFormatting(review.actionItem) : "NA"} />
            </div>
          </article>
        ))}
        {!reviews.length ? <div className="panel muted">No weekly reviews yet.</div> : null}
        <PaginationControls basePath="/weekly-review" params={params} page={page} pageSize={pageSize} total={reviews.length} />
      </div>
    </main>
  );
}

function MiniMetric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-forge-panel p-3">
      <div className="text-xs uppercase tracking-wide text-forge-muted">{label}</div>
      <div className="mt-1 font-semibold">{value}</div>
    </div>
  );
}

function formatMaybe(value: number | null) {
  return value == null ? "NA" : value.toFixed(2);
}

function applyWeeklyView(review: WeeklyReview, view: string, monthStart: Date) {
  if (view === "this-month") return review.weekStart >= monthStart;
  if (view === "profitable") return (review.totalPnl ?? 0) > 0;
  if (view === "needs-action") return !review.actionItem;
  if (view === "with-action") return Boolean(review.actionItem);
  return true;
}

function compareWeeklyReviews(a: WeeklyReview, b: WeeklyReview, sort: string) {
  if (sort === "week-desc") return b.weekStart.getTime() - a.weekStart.getTime();
  if (sort === "week-asc") return a.weekStart.getTime() - b.weekStart.getTime();
  if (sort === "pnl-desc") return (b.totalPnl ?? Number.NEGATIVE_INFINITY) - (a.totalPnl ?? Number.NEGATIVE_INFINITY);
  if (sort === "pnl-asc") return (a.totalPnl ?? Number.POSITIVE_INFINITY) - (b.totalPnl ?? Number.POSITIVE_INFINITY);
  return b.createdAt.getTime() - a.createdAt.getTime();
}

function isWeeklyReviewInRange(review: WeeklyReview, range: ReturnType<typeof getCalendarRange>) {
  if (!range.active) return true;
  return review.weekStart <= range.end && review.weekEnd >= range.start;
}
