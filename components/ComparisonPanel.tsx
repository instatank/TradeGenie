import Link from "next/link";
import { X } from "lucide-react";
import { formatMoney, type Currency } from "@/lib/currency";
import { MIN_SAMPLE } from "@/lib/metrics";
import { TOTAL_METRICS, type Comparison, type ComparisonMetric } from "@/lib/compare";

// Two sets of trades, the same six numbers, side by side.
//
// Deliberately NOT the whole page twice: duplicating every table and chart
// would double the reading for a question that is answered by six rows. If the
// comparison says "this is worth more of", the filtered page below is already
// the place to go and find out why.
export function ComparisonPanel({
  comparison,
  currency,
  clearHref,
}: {
  comparison: Comparison;
  currency: Currency;
  clearHref: string;
}) {
  return (
    <section className="panel mb-4 border-l-4 border-forge-blue">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">
          {comparison.aLabel} <span className="text-forge-muted">vs</span> {comparison.bLabel}
        </h2>
        <Link href={clearHref} className="inline-flex items-center gap-1 text-sm text-forge-muted hover:text-forge-ink">
          <X className="h-3.5 w-3.5" aria-hidden="true" /> Stop comparing
        </Link>
      </div>

      <div className="overflow-x-auto rounded-lg border border-forge-line">
        <table className="min-w-full text-sm">
          <thead className="bg-forge-panel">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Measure</th>
              <th className="px-3 py-2 text-right font-medium">{comparison.aLabel}</th>
              <th className="px-3 py-2 text-right font-medium">{comparison.bLabel}</th>
              <th className="px-3 py-2 text-right font-medium">Difference</th>
            </tr>
          </thead>
          <tbody>
            {comparison.metrics.map((metric) => (
              <MetricRow key={metric.label} metric={metric} currency={currency} thin={comparison.thin} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1.5 text-xs text-forge-muted">
        <p>
          Every row is a per-trade figure or a ratio, so it compares fairly whatever the two sample sizes are — except{" "}
          <span className="font-medium text-forge-ink">Net P&amp;L, which is a total</span>: the side with more trades
          tends to win that one whatever the quality.
        </p>
        <p>
          <span className="font-medium text-forge-ink">Expectancy</span> is your average R — what a trade returns as a
          multiple of what it risked, so +0.50R means a typical trade made half of what you put at risk. It only counts
          trades that have an entry, a stop and an exit recorded.{" "}
          <span className="font-medium text-forge-ink">Profit factor</span> is everything you won divided by everything
          you lost: 1.0 is breakeven, and it reads &ldquo;—&rdquo; until there is a losing trade to divide by.
        </p>
        {comparison.overlap > 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            <span className="font-medium">These two sets overlap:</span> {comparison.overlap} closed trade
            {comparison.overlap === 1 ? " is" : "s are"} counted on both sides. Comparing a set against one that contains
            it flatters the baseline — &ldquo;Everything else&rdquo; is the cleaner comparison.
          </p>
        ) : null}
        {comparison.thin ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800">
            One side has fewer than {MIN_SAMPLE} closed trades ({comparison.aCount} vs {comparison.bCount}). That is a
            sketch, not a verdict — the difference here can flip on a single trade.
          </p>
        ) : null}
      </div>
    </section>
  );
}

function MetricRow({ metric, currency, thin }: { metric: ComparisonMetric; currency: Currency; thin: boolean }) {
  const format = (value: number | null) => {
    if (value == null) return "—";
    if (metric.format === "count") return String(value);
    if (metric.format === "percent") return `${(value * 100).toFixed(0)}%`;
    if (metric.format === "r") return `${value >= 0 ? "+" : ""}${value.toFixed(2)}R`;
    if (metric.format === "score") return `${Math.round(value)}/100`;
    if (metric.format === "ratio") return value.toFixed(2);
    return formatMoney(value, currency);
  };

  const delta = metric.a != null && metric.b != null ? metric.a - metric.b : null;
  // Colour is what makes a number read as a verdict, so it is withheld exactly
  // when the number cannot support one: no direction to be better in, no
  // difference, or too small a sample on either side.
  const tone =
    delta == null || metric.higherIsBetter == null || delta === 0 || thin
      ? "text-forge-muted"
      : delta > 0 === metric.higherIsBetter
        ? "text-forge-green"
        : "text-forge-red";

  const deltaText = () => {
    if (delta == null) return "—";
    const sign = delta > 0 ? "+" : "";
    if (metric.format === "percent") return `${sign}${(delta * 100).toFixed(0)} pts`;
    if (metric.format === "r") return `${sign}${delta.toFixed(2)}R`;
    if (metric.format === "score") return `${sign}${Math.round(delta)}`;
    if (metric.format === "count") return `${sign}${delta}`;
    if (metric.format === "ratio") return `${sign}${delta.toFixed(2)}`;
    return `${sign}${formatMoney(delta, currency)}`;
  };

  return (
    <tr className="border-t border-forge-line">
      <td className="px-3 py-2 font-medium">
        {metric.label}
        {TOTAL_METRICS.has(metric.label) ? (
          <span className="ml-1.5 text-[11px] font-normal text-forge-muted">total</span>
        ) : null}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{format(metric.a)}</td>
      <td className="px-3 py-2 text-right tabular-nums text-forge-muted">{format(metric.b)}</td>
      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${tone}`}>{deltaText()}</td>
    </tr>
  );
}
