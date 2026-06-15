import Link from "next/link";
import { format } from "date-fns";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { shiftCalendarDate, type CalendarRange } from "@/lib/calendar";

type QueryParams = Record<string, string | undefined>;

export function CalendarRangeControls({
  basePath,
  params,
  range,
  total,
}: {
  basePath: string;
  params: QueryParams;
  range: CalendarRange;
  total?: number;
}) {
  const previousDate = format(shiftCalendarDate(range.period, range.anchorDate, -1), "yyyy-MM-dd");
  const nextDate = format(shiftCalendarDate(range.period, range.anchorDate, 1), "yyyy-MM-dd");
  const today = format(new Date(), "yyyy-MM-dd");

  return (
    <details className="panel mb-4" open={range.active}>
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <CalendarDays className="h-4 w-4 text-forge-blue" aria-hidden="true" />
        Calendar range
        <span className="font-normal text-forge-muted">
          {range.active ? range.label : "All dates"}
          {typeof total === "number" ? ` · ${total} result${total === 1 ? "" : "s"}` : ""}
        </span>
      </summary>
      <div className="mt-4 grid gap-3 lg:grid-cols-[auto_1fr_auto] lg:items-end">
        <div className="flex gap-2">
          <Link
            href={hrefWithParams(basePath, params, { period: range.period, date: previousDate, page: undefined })}
            className="button-secondary min-h-10 px-2"
            title="Previous range"
            aria-label="Previous range"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Link>
          <Link
            href={hrefWithParams(basePath, params, { period: range.period, date: nextDate, page: undefined })}
            className="button-secondary min-h-10 px-2"
            title="Next range"
            aria-label="Next range"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>

        <form action={basePath} className="grid gap-3 sm:grid-cols-[160px_1fr_auto_auto] sm:items-end">
          {preservedParams(params).map(([key, value]) => (
            <input key={key} type="hidden" name={key} value={value} />
          ))}
          <label className="field">
            <span className="label">Range</span>
            <select name="period" defaultValue={range.period} className="input">
              <option value="day">Day</option>
              <option value="week">Week</option>
              <option value="month">Month</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Date</span>
            <input name="date" type="date" defaultValue={range.dateValue} className="input" />
          </label>
          <button className="button" type="submit">Apply</button>
          <Link href={hrefWithParams(basePath, params, { period: "day", date: today, page: undefined })} className="button-secondary">
            Today
          </Link>
        </form>

        <Link href={hrefWithParams(basePath, params, { period: undefined, date: undefined, page: undefined })} className="button-secondary">
          All dates
        </Link>
      </div>
    </details>
  );
}

function preservedParams(params: QueryParams) {
  const omitted = new Set(["period", "date", "page", "from", "to"]);
  return Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]) && !omitted.has(entry[0]));
}

function hrefWithParams(basePath: string, params: QueryParams, patch: QueryParams) {
  const nextParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) nextParams.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) {
    if (value) nextParams.set(key, value);
    else nextParams.delete(key);
  }
  const query = nextParams.toString();
  return query ? `${basePath}?${query}` : basePath;
}
