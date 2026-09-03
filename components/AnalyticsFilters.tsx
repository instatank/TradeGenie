import Link from "next/link";
import { SlidersHorizontal, X } from "lucide-react";
import { TRADE_FILTER_PARAMS, MISTAKE_ANY, MISTAKE_NONE, type FilterParams } from "@/lib/trade-filters";

// The drill-down controls for /analytics.
//
// Zero client JS, like every other form in this app: one plain `<form method="get">`
// whose fields ARE the query string, plus links for the things a link expresses
// better (a date preset, dropping one filter, clearing everything). Submitting
// reloads the page with a new URL — which is the whole design, because the URL
// is the filter (lib/trade-filters.ts) and that is what makes an analytics view
// saveable, bookmarkable and shareable with no second representation to keep in
// sync.
//
// A `<form method="get">` drops every param it does not render, so the fields
// below plus the hidden inputs are the complete set of what survives a submit.
// That is deliberate: it means "Apply" can never carry a stale param the panel
// no longer shows.

export type FilterChoice = { value: string; label: string };

export type FilterSelect = {
  /** The query param this control owns. */
  name: string;
  label: string;
  choices: FilterChoice[];
  /** What the blank option reads as — "Any setup" beats a bare "Any". */
  anyLabel?: string;
};

/** Params the panel does not own and must carry through a submit untouched
 *  (the table sort, and the toast the redirect leaves behind). */
const CARRIED_PARAMS = ["sort", "dir"];

function queryWithout(params: FilterParams, drop: string[]): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value || drop.includes(key) || key === "feedback" || key === "feedbackType") continue;
    next.set(key, value);
  }
  return next.toString();
}

export function analyticsHref(params: FilterParams, changes: Record<string, string | null>) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && key !== "feedback" && key !== "feedbackType") next.set(key, value);
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `/analytics?${query}` : "/analytics";
}

/** One dismissible chip per active filter. The label is the human reading of
 *  the filter ("Direction: Long"), never the raw value, and the X drops just
 *  that one param — narrowing is easy to do and must be just as easy to undo. */
export function ActiveFilterChips({
  params,
  chips,
}: {
  params: FilterParams;
  chips: { param: string; label: string }[];
}) {
  if (!chips.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {chips.map((chip) => (
        <span
          key={`${chip.param}-${chip.label}`}
          className="inline-flex items-center rounded-full border border-forge-blue/40 bg-sky-50 text-sm text-forge-ink"
        >
          <span className="py-1 pl-3 pr-1.5">{chip.label}</span>
          <Link
            href={analyticsHref(params, { [chip.param]: null })}
            className="rounded-full p-1 pr-2 text-forge-muted transition hover:text-forge-red"
            title={`Remove the ${chip.label} filter`}
            aria-label={`Remove the ${chip.label} filter`}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </Link>
        </span>
      ))}
      <Link
        href={`/analytics${queryWithout(params, [...TRADE_FILTER_PARAMS]) ? `?${queryWithout(params, [...TRADE_FILTER_PARAMS])}` : ""}`}
        className="text-sm text-forge-blue hover:underline"
      >
        Clear all filters
      </Link>
    </div>
  );
}

export function AnalyticsFilters({
  params,
  selects,
  mistakeChoices,
  datePresets,
  open,
}: {
  params: FilterParams;
  selects: FilterSelect[];
  /** Mistake tags get their own prop rather than joining `selects`: the control
   *  carries two meta-answers (any / none) that are not tags at all. */
  mistakeChoices: FilterChoice[];
  datePresets: { label: string; href: string; active: boolean }[];
  /** Open when something is filtered — a panel that hides the reason the
   *  numbers look odd is worse than no panel. */
  open: boolean;
}) {
  return (
    <details className="panel mb-4" open={open}>
      <summary className="flex cursor-pointer items-center gap-2 font-semibold">
        <SlidersHorizontal className="h-4 w-4 text-forge-blue" aria-hidden="true" />
        Filter &amp; drill down
        <span className="text-xs font-normal text-forge-muted">
          — every number on this page follows what you pick here
        </span>
      </summary>

      <form method="get" action="/analytics" className="mt-4 space-y-4">
        {CARRIED_PARAMS.map((key) =>
          params[key] ? <input key={key} type="hidden" name={key} value={params[key]} /> : null,
        )}

        <label className="field">
          <span className="label">Anything written on the trade</span>
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="setup, mood, mechanism, mistake, a word from the thesis, #tag…"
            className="input w-full"
          />
          <span className="text-xs text-forge-muted">
            Same search as everywhere else: words match anywhere and combine, <span className="font-medium">#tag</span> matches
            that exact tag.
          </span>
        </label>

        <div className="flex flex-wrap items-end gap-3">
          <label className="field">
            <span className="label">From</span>
            <input name="from" type="date" defaultValue={params.from ?? ""} className="input" />
          </label>
          <label className="field">
            <span className="label">To</span>
            <input name="to" type="date" defaultValue={params.to ?? ""} className="input" />
          </label>
          <div className="field">
            <span className="label">Quick ranges</span>
            <div className="flex flex-wrap gap-1.5">
              {datePresets.map((preset) => (
                <Link
                  key={preset.label}
                  href={preset.href}
                  className={`rounded-full border px-3 py-1.5 text-sm transition ${
                    preset.active
                      ? "border-forge-ink bg-forge-ink text-white"
                      : "border-forge-line bg-white text-forge-ink hover:border-forge-muted"
                  }`}
                >
                  {preset.label}
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <label className="field">
            <span className="label">Symbol</span>
            <input
              name="instrument"
              defaultValue={params.instrument ?? ""}
              placeholder="BTC…"
              className="input uppercase placeholder:normal-case"
            />
          </label>
          {selects.map((select) => (
            <label key={select.name} className="field">
              <span className="label">{select.label}</span>
              <select name={select.name} defaultValue={params[select.name] ?? ""} className="input">
                <option value="">{select.anyLabel ?? "Any"}</option>
                {select.choices.map((choice) => (
                  <option key={choice.value} value={choice.value}>
                    {choice.label}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label className="field">
            <span className="label">Result</span>
            <select name="outcome" defaultValue={params.outcome ?? ""} className="input">
              <option value="">Any result</option>
              <option value="wins">Winners only</option>
              <option value="losses">Losers only</option>
            </select>
          </label>
          <label className="field">
            <span className="label">Mistakes</span>
            <select name="mistakeTagId" defaultValue={params.mistakeTagId ?? ""} className="input">
              <option value="">Any</option>
              <option value={MISTAKE_ANY}>Any mistake tagged</option>
              <option value={MISTAKE_NONE}>Clean — no mistakes</option>
              {mistakeChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="label">Journaled?</span>
            <select name="journaled" defaultValue={params.journaled ?? ""} className="input">
              <option value="">All trades</option>
              <option value="journaled">Journaled only</option>
              <option value="archive">Archive only (rebuilt from fills)</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="button" type="submit">Apply filters</button>
          <Link href="/analytics" className="button-secondary">Clear all</Link>
          <span className="text-xs text-forge-muted">
            Filters are the page&apos;s URL — bookmark it, or save it as a view above.
          </span>
        </div>
      </form>
    </details>
  );
}
