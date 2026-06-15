import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";

export type CalendarPeriod = "day" | "week" | "month";

export type CalendarRange = {
  active: boolean;
  period: CalendarPeriod;
  anchorDate: Date;
  start: Date;
  end: Date;
  label: string;
  dateValue: string;
};

type QueryParams = Record<string, string | undefined>;

export function getCalendarRange(params: QueryParams, fallbackDate = new Date()): CalendarRange {
  const period = getCalendarPeriod(params.period);
  const anchorDate = getAnchorDate(params.date, fallbackDate);
  const { start, end } = getRangeBounds(period, anchorDate);

  return {
    active: Boolean(params.period || params.date),
    period,
    anchorDate,
    start,
    end,
    label: formatRangeLabel(period, start, end),
    dateValue: format(anchorDate, "yyyy-MM-dd"),
  };
}

export function isWithinCalendarRange(date: Date, range: CalendarRange) {
  if (!range.active) return true;
  return date >= range.start && date <= range.end;
}

export function shiftCalendarDate(period: CalendarPeriod, date: Date, amount: number) {
  if (period === "month") return addMonths(date, amount);
  if (period === "week") return addWeeks(date, amount);
  return addDays(date, amount);
}

export function getCalendarPeriod(value: string | undefined): CalendarPeriod {
  if (value === "week" || value === "month") return value;
  return "day";
}

function getAnchorDate(value: string | undefined, fallbackDate: Date) {
  if (!value) return fallbackDate;
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : fallbackDate;
}

function getRangeBounds(period: CalendarPeriod, date: Date) {
  if (period === "month") return { start: startOfMonth(date), end: endOfMonth(date) };
  if (period === "week") return { start: startOfWeek(date, { weekStartsOn: 1 }), end: endOfWeek(date, { weekStartsOn: 1 }) };
  return { start: startOfDay(date), end: endOfDay(date) };
}

function formatRangeLabel(period: CalendarPeriod, start: Date, end: Date) {
  if (period === "month") return format(start, "MMMM yyyy");
  if (period === "week") return `${format(start, "dd MMM")} - ${format(end, "dd MMM yyyy")}`;
  return format(start, "EEEE, dd MMM yyyy");
}
