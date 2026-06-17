import Link from "next/link";
import { format } from "date-fns";
import { Pencil, Pin, Trash2 } from "lucide-react";
import { addManualLessonAction, deleteLessonAction, toggleLessonActiveAction, toggleLessonPinAction, updateLessonAction } from "@/app/actions";
import { CalendarRangeControls } from "@/components/CalendarRangeControls";
import { PageTitle, SelectField, TextAreaField } from "@/components/Fields";
import { PaginationControls, ViewTabs, normalizePage, normalizePageSize, paginate } from "@/components/ListControls";
import { getCalendarRange, isWithinCalendarRange } from "@/lib/calendar";
import { humanize, lessonCategories, lessonSourceTypes } from "@/lib/constants";
import { db } from "@/lib/data";
import type { Lesson } from "@/lib/types";

const lessonViews = [
  { label: "Active", value: "active" },
  { label: "Manual", value: "manual" },
  { label: "From Trades", value: "trade" },
  { label: "From Voice Notes", value: "transcript" },
  { label: "Inactive", value: "inactive" },
  { label: "All", value: "all" },
];

export default async function LessonsPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams ?? {};
  const view = params.view ?? "active";
  const sort = params.sort ?? "date-desc";
  const page = normalizePage(params.page);
  const pageSize = normalizePageSize(params.pageSize, [10, 25, 50], 10);
  const calendarRange = getCalendarRange(params);
  const [allLessons, trades, transcripts] = await Promise.all([db.list("lessons"), db.list("trades"), db.list("transcripts")]);
  const lessons = allLessons
    .filter((lesson) => applyLessonView(lesson, view))
    .filter((lesson) => isWithinCalendarRange(lesson.createdAt, calendarRange))
    .filter((lesson) => !pickEnum(lessonCategories, params.category) || lesson.category === params.category)
    .filter((lesson) => !pickEnum(lessonSourceTypes, params.sourceType) || lesson.sourceType === params.sourceType)
    .sort((a, b) => compareLessons(a, b, sort))
    .map((lesson) => ({
      ...lesson,
      linkedTrade: trades.find((trade) => trade.id === lesson.linkedTradeId) ?? null,
      linkedTranscript: transcripts.find((transcript) => transcript.id === lesson.linkedTranscriptId) ?? null,
    }));
  const pagedLessons = paginate(lessons, page, pageSize);

  return (
    <main className="page-shell">
      <PageTitle title="Lessons" subtitle="A bank of reusable rules and reminders, not a dumping ground." />
      <ViewTabs basePath="/lessons" current={view} params={params} tabs={lessonViews} />
      <CalendarRangeControls basePath="/lessons" params={params} range={calendarRange} total={lessons.length} />
      <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div className="space-y-4">
          <form action={addManualLessonAction} className="panel space-y-4">
            <h2 className="font-semibold">Add manual lesson</h2>
            <TextAreaField label="Lesson" name="lessonText" required rows={4} />
            <SelectField label="Category" name="category" options={lessonCategories} defaultValue="PROCESS" />
            <button className="button" type="submit">Add lesson</button>
          </form>

          <details className="panel" open={hasActiveLessonControls(params)}>
            <summary className="cursor-pointer text-sm font-semibold">
              Filters & sorting
              <span className="ml-2 font-normal text-forge-muted">{lessons.length} lesson{lessons.length === 1 ? "" : "s"}</span>
            </summary>
            <form className="mt-4 space-y-3">
              <input type="hidden" name="view" value={view} />
              <SelectField label="Category" name="category" options={lessonCategories} includeBlank defaultValue={params.category} />
              <SelectField label="Source type" name="sourceType" options={lessonSourceTypes} includeBlank defaultValue={params.sourceType} />
              <label className="field">
                <span className="label">Sort</span>
                <select name="sort" defaultValue={sort} className="input">
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="category-asc">Category A-Z</option>
                  <option value="source-asc">Source A-Z</option>
                </select>
              </label>
              <label className="field">
                <span className="label">Rows</span>
                <select name="pageSize" defaultValue={String(pageSize)} className="input">
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                </select>
              </label>
              <div className="flex gap-2">
                <button className="button" type="submit">Apply</button>
                <Link href="/lessons" className="button-secondary">Clear</Link>
              </div>
            </form>
          </details>
        </div>

        <div className="space-y-3">
          {pagedLessons.map((lesson) => (
            <details key={lesson.id} className={`panel ${lesson.isActive ? "" : "opacity-60"}`}>
              <summary className="grid cursor-pointer gap-3 sm:grid-cols-[1fr_180px] sm:items-center">
                <div className="min-w-0">
                  <p className="truncate font-medium">{lesson.lessonText}</p>
                  <p className="mt-1 text-sm text-forge-muted">
                    {humanize(lesson.category)} · {humanize(lesson.sourceType)}
                  </p>
                </div>
                <div className="text-sm text-forge-muted sm:text-right">
                  {format(lesson.createdAt, "dd MMM yyyy")}
                  {!lesson.isActive ? <span className="ml-2 rounded-md bg-forge-panel px-2 py-1 text-xs">Inactive</span> : null}
                </div>
              </summary>
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-base font-medium">{lesson.lessonText}</p>
                  <p className="mt-2 text-sm text-forge-muted">
                    {humanize(lesson.category)} · {humanize(lesson.sourceType)} · {format(lesson.createdAt, "dd MMM yyyy")}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-sm">
                    {lesson.linkedTrade ? <Link className="text-forge-blue hover:underline" href={`/trades/${lesson.linkedTrade.id}`}>Trade: {lesson.linkedTrade.instrument}</Link> : null}
                    {lesson.linkedTranscript ? <Link className="text-forge-blue hover:underline" href="/inbox">Transcript source</Link> : null}
                  </div>
                </div>
                <div className="flex justify-end gap-1">
                  <form action={toggleLessonPinAction}>
                    <input type="hidden" name="id" value={lesson.id} />
                    <input type="hidden" name="isPinned" value={String(Boolean(lesson.isPinned))} />
                    <button className={`button-secondary min-h-8 px-2 ${lesson.isPinned ? "text-forge-blue" : ""}`} type="submit" title={lesson.isPinned ? "Unpin lesson" : "Pin lesson"} aria-label={lesson.isPinned ? "Unpin lesson" : "Pin lesson"}>
                      <Pin className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </form>
                  <form action={toggleLessonActiveAction}>
                    <input type="hidden" name="id" value={lesson.id} />
                    <input type="hidden" name="isActive" value={String(lesson.isActive)} />
                    <button className="button-secondary min-h-8 px-2" type="submit">{lesson.isActive ? "Inactive" : "Active"}</button>
                  </form>
                  <form action={deleteLessonAction}>
                    <input type="hidden" name="id" value={lesson.id} />
                    <button className="button-danger min-h-8 px-2" type="submit" title="Delete lesson" aria-label="Delete lesson">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </form>
                </div>
              </div>
              <details className="mt-4 rounded-lg border border-forge-line p-3">
                <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                  <Pencil className="h-4 w-4 text-forge-blue" aria-hidden="true" />
                  Edit lesson
                </summary>
                <form action={updateLessonAction} className="mt-4 grid gap-3 sm:grid-cols-[1fr_220px_auto] sm:items-end">
                  <input type="hidden" name="id" value={lesson.id} />
                  <TextAreaField label="Lesson" name="lessonText" defaultValue={lesson.lessonText} rows={3} />
                  <SelectField label="Category" name="category" options={lessonCategories} defaultValue={lesson.category} />
                  <button className="button-secondary" type="submit">Save</button>
                </form>
              </details>
            </details>
          ))}
          {!lessons.length ? <div className="panel muted">No lessons match these filters.</div> : null}
          <PaginationControls basePath="/lessons" params={params} page={page} pageSize={pageSize} total={lessons.length} />
        </div>
      </section>
    </main>
  );
}

function pickEnum(options: readonly string[], value: string | undefined) {
  return value && options.includes(value) ? value : undefined;
}

function applyLessonView(lesson: Lesson, view: string) {
  if (view === "manual") return lesson.sourceType === "MANUAL" && lesson.isActive;
  if (view === "trade") return lesson.sourceType === "TRADE" && lesson.isActive;
  if (view === "transcript") return lesson.sourceType === "TRANSCRIPT" && lesson.isActive;
  if (view === "inactive") return !lesson.isActive;
  if (view === "all") return true;
  return lesson.isActive;
}

function compareLessons(a: Lesson, b: Lesson, sort: string) {
  if (sort === "date-asc") return a.createdAt.getTime() - b.createdAt.getTime();
  if (sort === "category-asc") return a.category.localeCompare(b.category) || b.createdAt.getTime() - a.createdAt.getTime();
  if (sort === "source-asc") return a.sourceType.localeCompare(b.sourceType) || b.createdAt.getTime() - a.createdAt.getTime();
  return b.createdAt.getTime() - a.createdAt.getTime();
}

function hasActiveLessonControls(params: Record<string, string | undefined>) {
  const passiveKeys = new Set(["view", "page", "period", "date"]);
  return Object.entries(params).some(([key, value]) => Boolean(value) && !passiveKeys.has(key));
}
