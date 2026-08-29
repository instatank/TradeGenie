"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";

// The one-filter-at-a-time box on /trades.
//
// The "More filters & sorting" panel is for combining filters deliberately;
// this is for the far more common case — you remember ONE thing about the
// trade (the setup, the mood, a mechanism, a word from the thesis, a #tag) and
// want the list narrowed to it without hunting for which dropdown owns it.
// It runs the same query grammar as global search (`filterTradesByQuery`), so
// `#fomo btc` means here exactly what it means on /search.
//
// The URL is still the truth: `?q=` is a real, bookmarkable, saveable filter
// (SavedViews picks it up for free) and the server does the filtering, so the
// summary line, the day groups and the pagination all agree with what's on
// screen. This component only makes it feel live — it debounces typing into a
// `router.replace`, inside a transition so the page's loading skeleton never
// swaps out (and the caret never moves) while the new list is fetched.
//
// It is a progressive enhancement, not a requirement: it renders a plain
// `<input name="q">` inside the page's own filter form, so with JS off typing
// and pressing Filter works exactly as every other field here does.

const DEBOUNCE_MS = 250;

export function TradeFilterBox({
  value: initialValue,
  params,
  matchCount,
}: {
  value: string;
  /** The page's current query params — what a navigation must preserve. */
  params: Record<string, string | undefined>;
  /** How many trades the current query matched, for the live hint. */
  matchCount: number;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [pending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const committed = useRef(initialValue);

  // A back/forward navigation, a "Clear", or a saved view changes q under us;
  // adopt it unless the trader is mid-edit of something else.
  useEffect(() => {
    if (initialValue !== committed.current) {
      committed.current = initialValue;
      setValue(initialValue);
    }
  }, [initialValue]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function commit(next: string) {
    if (timer.current) clearTimeout(timer.current);
    if (next === committed.current) return;
    committed.current = next;
    const search = new URLSearchParams();
    for (const [key, entry] of Object.entries(params)) {
      // A changed filter always starts at page one, and the expanded row is
      // very likely no longer in the list.
      if (entry && !["q", "page", "open", "feedback", "feedbackType"].includes(key)) search.set(key, entry);
    }
    if (next.trim()) search.set("q", next.trim());
    const query = search.toString();
    startTransition(() => router.replace(query ? `/trades?${query}` : "/trades", { scroll: false }));
  }

  function onChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => commit(next), DEBOUNCE_MS);
  }

  return (
    <label className="field min-w-0 flex-1 basis-full sm:basis-72">
      {/* Named for its scope: the header box searches everything, this one
          narrows the list you are looking at. */}
      <span className="text-xs font-medium text-forge-muted">Search these trades</span>
      <span className="relative flex items-center">
        <Search className="pointer-events-none absolute left-2.5 h-4 w-4 text-forge-muted" aria-hidden="true" />
        <input
          name="q"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            // Enter has already been answered by the live filter — flush the
            // pending debounce rather than doing a full form GET.
            if (event.key === "Enter") {
              event.preventDefault();
              commit(value);
            }
            if (event.key === "Escape" && value) {
              event.preventDefault();
              setValue("");
              commit("");
            }
          }}
          placeholder="Setup, mood, mechanism, a word from the thesis, #tag…"
          aria-label="Filter trades by any word or tag"
          className="input w-full pl-8 pr-8"
        />
        {value ? (
          <button
            type="button"
            onClick={() => { setValue(""); commit(""); }}
            className="absolute right-2 rounded-md p-0.5 text-forge-muted transition hover:bg-forge-panel hover:text-forge-ink"
            title="Clear search"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </span>
      {value.trim() ? (
        <span className="mt-1 text-xs text-forge-muted" aria-live="polite">
          {pending ? "filtering…" : `${matchCount} trade${matchCount === 1 ? "" : "s"} match`}
        </span>
      ) : null}
    </label>
  );
}
