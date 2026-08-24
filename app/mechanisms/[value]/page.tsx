import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { ArrowLeft, ArrowUpRight, NotebookPen } from "lucide-react";
import { PageTitle } from "@/components/Fields";
import { FreeNoteCard } from "@/components/FreeNoteCard";
import { QuickNoteComposer } from "@/components/QuickNoteComposer";
import { getFreeNotes, getSymbolTagSuggestions, getTagVocabulary, getTradesWithMistakes } from "@/lib/data";
import { getTradePnl, isThinSample, MIN_SAMPLE } from "@/lib/metrics";
import { extremeTrades, mechanismStats, mechanismTag, summarizeMechanism } from "@/lib/mechanisms";
import { getOptionCatalog, optionGroups } from "@/lib/options";

const RECENT_LIMIT = 8;

// One concept: what it means, what it has done for you, the two trades worth
// looking at again, and your own notes about it.
//
// The notes are ordinary quick notes tagged with the concept's own tag, so
// writing "#fvg" anywhere in the app lands here, and a note written here is
// findable from search like any other. No parallel store, no second vocabulary.
export default async function MechanismPage({ params }: { params: Promise<{ value: string }> }) {
  const { value } = await params;
  const [options, trades, notes, tagVocabulary, symbolTags] = await Promise.all([
    getOptionCatalog(),
    getTradesWithMistakes(),
    getFreeNotes(),
    getTagVocabulary(),
    getSymbolTagSuggestions(),
  ]);
  const choice = options.choices("mechanism").find((entry) => entry.value === value);
  if (!choice) notFound();

  const summary = summarizeMechanism(choice, trades);
  const stats = mechanismStats(summary);
  const light = isThinSample(stats.count);
  const { best, worst } = extremeTrades(summary.closed);
  const tag = mechanismTag(choice);
  const tagged = tag ? notes.filter((note) => (note.tags ?? []).includes(tag)) : [];
  const recent = [...summary.trades]
    .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime())
    .slice(0, RECENT_LIMIT);
  const selfHref = `/mechanisms/${value}`;

  return (
    <main className="page-shell max-w-3xl">
      <Link href="/mechanisms" className="mb-2 inline-flex items-center gap-1 text-sm text-forge-muted transition hover:text-forge-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        All mechanisms
      </Link>
      <PageTitle title={choice.label} subtitle={choice.hint ?? "One of the concepts your entries are built from."} />

      {/* ---- What it's done for you ---- */}
      <section className="panel mb-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Trades" value={String(summary.trades.length)} />
          <Stat label="Closed" value={String(stats.count)} />
          <Stat
            label="Win rate"
            value={stats.winRate == null ? "—" : `${(stats.winRate * 100).toFixed(0)}%`}
            muted={light}
          />
          <Stat
            label="Expectancy"
            value={stats.expectancyR == null ? "—" : `${stats.expectancyR.toFixed(2)}R`}
            tone={light || stats.expectancyR == null ? undefined : stats.expectancyR >= 0 ? "good" : "bad"}
            muted={light}
          />
        </div>
        {light ? (
          <p className="mt-3 text-xs text-forge-muted">
            {stats.count
              ? `${MIN_SAMPLE - stats.count} more closed trade${MIN_SAMPLE - stats.count === 1 ? "" : "s"} before these numbers mean anything. They're greyed out until then.`
              : "No closed trades with this yet — the numbers fill in as you use it."}
          </p>
        ) : null}
        {summary.pairedWith.length ? (
          <p className="mt-3 text-sm text-forge-muted">
            Usually stacked with{" "}
            {summary.pairedWith.map((pair, index) => (
              <span key={pair.value}>
                {index > 0 ? ", " : ""}
                <Link href={`/mechanisms/${pair.value}`} className="text-forge-blue hover:underline">
                  {options.label("mechanism", pair.value)}
                </Link>
                <span className="text-forge-muted"> ({pair.count})</span>
              </span>
            ))}
            .
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={`/trades?mechanism=${value}`} className="button-secondary min-h-9 px-3 text-sm">
            Every trade with this <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
          {tag ? (
            <Link href={`/search?q=%23${tag}`} className="button-secondary min-h-9 px-3 text-sm">
              Search #{tag}
            </Link>
          ) : null}
        </div>
      </section>

      {/* ---- The two worth looking at again ---- */}
      {best || worst ? (
        <section className="mb-5 grid gap-3 sm:grid-cols-2">
          {best ? <ExampleCard title="Your best with this" trade={best} tone="good" /> : null}
          {worst ? <ExampleCard title="Your worst with this" trade={worst} tone="bad" /> : null}
        </section>
      ) : null}

      {/* ---- Recent trades ---- */}
      {recent.length ? (
        <section className="panel mb-5">
          <h2 className="mb-2 font-semibold">Recent trades with this</h2>
          <div className="divide-y divide-forge-line">
            {recent.map((trade) => {
              const pnl = getTradePnl(trade);
              return (
                <Link key={trade.id} href={`/trades/${trade.id}`} className="flex items-center gap-3 py-2 text-sm transition hover:text-forge-blue">
                  <span className="w-20 shrink-0 text-xs text-forge-muted">{format(trade.tradeDateTime, "d MMM")}</span>
                  <span className="w-16 shrink-0 font-medium">{trade.instrument}</span>
                  <span className="min-w-0 flex-1 truncate text-forge-muted">{trade.setupName ?? trade.entryThesis ?? ""}</span>
                  <span className={`shrink-0 tabular-nums ${pnl == null ? "text-forge-muted" : pnl >= 0 ? "text-forge-green" : "text-forge-red"}`}>
                    {trade.rMultiple != null ? `${trade.rMultiple >= 0 ? "+" : ""}${trade.rMultiple.toFixed(2)}R` : trade.status === "OPEN" ? "open" : "—"}
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* ---- Your own notes on it ---- */}
      <section className="panel">
        <div className="mb-3 flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-forge-blue" aria-hidden="true" />
          <h2 className="font-semibold">What you&apos;ve worked out about it</h2>
        </div>
        <p className="-mt-2 mb-3 text-xs text-forge-muted">
          An ordinary quick note, pre-tagged {tag ? <span className="font-medium">#{tag}</span> : null} so it comes back here — and
          shows up in search and on your day like any other note.
        </p>
        <QuickNoteComposer
          date={format(new Date(), "yyyy-MM-dd")}
          redirectTo={selfHref}
          categoryChoices={options.choices("noteCategory")}
          tagVocabulary={tagVocabulary.map((entry) => entry.tag)}
          tagGroups={symbolTags.length ? [{ label: "Assets", tags: symbolTags }] : []}
          defaultTags={tag ? [tag] : []}
          resetKey={`${tagged.length}:${tagged[0]?.id ?? ""}`}
        />

        {tagged.length ? (
          <div className="mt-4 space-y-2 border-t border-forge-line pt-3">
            {tagged.map((note) => (
              <FreeNoteCard
                key={note.id}
                note={note}
                redirectTo={selfHref}
                categoryChoices={options.choices("noteCategory")}
                categoryLabel={note.category ? options.label("noteCategory", note.category) : null}
                categoryPlaceholder={optionGroups.noteCategory.placeholder}
                tagVocabulary={tagVocabulary.map((entry) => entry.tag)}
                tagGroups={symbolTags.length ? [{ label: "Assets", tags: symbolTags }] : []}
                showDate
              />
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function Stat({ label, value, tone, muted }: { label: string; value: string; tone?: "good" | "bad"; muted?: boolean }) {
  return (
    <div className="rounded-lg bg-forge-panel p-3">
      <div className="text-xs text-forge-muted">{label}</div>
      <div
        className={`text-lg font-semibold ${
          muted ? "text-forge-muted" : tone === "good" ? "text-forge-green" : tone === "bad" ? "text-forge-red" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ExampleCard({
  title,
  trade,
  tone,
}: {
  title: string;
  trade: { id: string; instrument: string; tradeDateTime: Date; rMultiple?: number | null; entryThesis?: string | null; lesson?: string | null };
  tone: "good" | "bad";
}) {
  return (
    <Link href={`/trades/${trade.id}`} className="panel block transition hover:border-forge-blue">
      <div className="text-xs text-forge-muted">{title}</div>
      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="font-semibold">{trade.instrument}</span>
        <span className={`font-semibold ${tone === "good" ? "text-forge-green" : "text-forge-red"}`}>
          {trade.rMultiple != null ? `${trade.rMultiple >= 0 ? "+" : ""}${trade.rMultiple.toFixed(2)}R` : "—"}
        </span>
      </div>
      <div className="text-xs text-forge-muted">{format(trade.tradeDateTime, "d MMM yyyy")}</div>
      {trade.lesson || trade.entryThesis ? (
        <p className="mt-2 line-clamp-3 text-sm text-forge-muted">{trade.lesson ?? trade.entryThesis}</p>
      ) : null}
    </Link>
  );
}
