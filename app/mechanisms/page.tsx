import Link from "next/link";
import { BookOpen } from "lucide-react";
import { PageTitle } from "@/components/Fields";
import { getTradesWithMistakes } from "@/lib/data";
import { isThinSample, MIN_SAMPLE } from "@/lib/metrics";
import { mechanismStats, summarizeMechanism } from "@/lib/mechanisms";
import { getOptionCatalog } from "@/lib/options";

// The concept library — but built out of your own trades, not a textbook.
//
// Each card is the definition plus what the concept has actually done for you.
// Nothing here is authored twice: the vocabulary is the `mechanism` option
// group (so a concept you typed yourself appears here for free), and every
// number comes from the trades you tagged with it.
export default async function MechanismsPage() {
  const [options, trades] = await Promise.all([getOptionCatalog(), getTradesWithMistakes()]);
  const summaries = options
    .choices("mechanism")
    .map((choice) => summarizeMechanism(choice, trades))
    .sort((a, b) => b.closed.length - a.closed.length || a.label.localeCompare(b.label));
  const used = summaries.filter((entry) => entry.trades.length);
  const unused = summaries.filter((entry) => !entry.trades.length);

  return (
    <main className="page-shell max-w-4xl">
      <PageTitle
        title="Mechanisms"
        subtitle="What each concept means, and what it has actually done for you. Every number here comes from trades you tagged yourself."
      />

      {used.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {used.map((entry) => (
            <MechanismCard key={entry.value} entry={entry} />
          ))}
        </div>
      ) : (
        <p className="panel text-sm text-forge-muted">
          Nothing tagged yet. Tick the mechanisms on a trade — in &ldquo;Setup &amp; execution&rdquo; on the trade page, or as you
          take one from a playbook model — and this page fills itself in.
        </p>
      )}

      {unused.length ? (
        <section className="mt-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-forge-muted">
            <BookOpen className="h-4 w-4" aria-hidden="true" />
            Not used yet
          </h2>
          <div className="flex flex-wrap gap-2">
            {unused.map((entry) => (
              <Link
                key={entry.value}
                href={`/mechanisms/${entry.value}`}
                title={entry.hint}
                className="rounded-full border border-forge-line bg-white px-3 py-1.5 text-sm text-forge-muted transition hover:border-forge-blue hover:text-forge-blue"
              >
                {entry.label}
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}

function MechanismCard({ entry }: { entry: ReturnType<typeof summarizeMechanism> }) {
  const stats = mechanismStats(entry);
  // Same honesty rule as the analytics tables: under MIN_SAMPLE closed trades
  // the numbers show, but never in a colour that reads as a verdict.
  const light = isThinSample(stats.count);
  return (
    <Link href={`/mechanisms/${entry.value}`} className="panel block transition hover:border-forge-blue">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{entry.label}</h2>
        <span
          className={`text-lg font-semibold ${
            light || stats.expectancyR == null ? "text-forge-muted" : stats.expectancyR >= 0 ? "text-forge-green" : "text-forge-red"
          }`}
        >
          {stats.expectancyR == null ? "—" : `${stats.expectancyR.toFixed(2)}R`}
        </span>
      </div>
      {entry.hint ? <p className="mt-1 text-sm text-forge-muted">{entry.hint}</p> : null}
      <p className="mt-2 text-xs text-forge-muted">
        {entry.trades.length} trade{entry.trades.length === 1 ? "" : "s"}
        {stats.count ? ` · ${stats.count} closed` : ""}
        {stats.winRate != null ? ` · win ${(stats.winRate * 100).toFixed(0)}%` : ""}
        {light && stats.count ? ` · ${MIN_SAMPLE - stats.count} more to read this` : ""}
      </p>
    </Link>
  );
}
