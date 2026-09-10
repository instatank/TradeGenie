import Link from "next/link";
import { format } from "date-fns";
import { getSlippageReadings, SLIPPAGE_REASON_LABELS, type SlippageCoverage } from "@/lib/slippage-view";
import { isThinSample, MIN_SAMPLE } from "@/lib/metrics";
import { slippageByInstrument, summarizeSlippage } from "@/lib/slippage";
import type { Trade } from "@/lib/types";

// What the exchange's fills are really costing you, over every measurable trade
// in the current filter.
//
// PER SYMBOL, because slippage is a property of a BOOK and not of a trader. SOL
// and BTC do not have the same depth, and one number spanning both is the mean
// of two different questions. The overall row is kept as context, never as the
// answer.
//
// Async and in its own <Suspense>, same reason as the panels on the trade page:
// it folds the whole exchange fill history, and /analytics must paint first.

// ONE text node, not three. `{sign}{value}` makes React emit
// `+<!-- -->48.8`, which splits the figure with comment markers and breaks both
// a gate assertion and a reader's Ctrl+F on a page that rendered perfectly —
// the trap already documented in scripts/smoke.mts.
function bps(value: number | null) {
  if (value == null) return <span className="text-forge-muted">NA</span>;
  const worse = value > 0.5;
  const better = value < -0.5;
  return (
    <span className={worse ? "text-forge-red" : better ? "text-forge-green" : undefined}>
      {`${value > 0 ? "+" : ""}${value.toFixed(1)}`}
    </span>
  );
}

/**
 * Where the trades that produced no reading went.
 *
 * Never hidden, even when there ARE readings: "1 measurable out of 40" and "1
 * out of 1" are wildly different claims about how much the median means, and a
 * panel that shows only its successes lets the first read like the second.
 */
function Coverage({ coverage }: { coverage: SlippageCoverage }) {
  const misses = Object.entries(coverage.byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${SLIPPAGE_REASON_LABELS[reason] ?? reason.toLowerCase()}`);

  return (
    <p className="text-xs text-forge-muted">
      Checked {coverage.considered} closed trade{coverage.considered === 1 ? "" : "s"} ·{" "}
      <strong className="font-medium text-forge-ink">{coverage.measured} measurable</strong>
      {misses.length ? <> · {misses.join(" · ")}</> : null}
    </p>
  );
}

export async function SlippageTable({ trades }: { trades: Trade[] }) {
  const { readings, coverage } = await getSlippageReadings(trades);
  const overall = summarizeSlippage(readings.map((entry) => entry.reading));
  const groups = slippageByInstrument(readings.map((entry) => ({ instrument: entry.trade.instrument, reading: entry.reading })));

  if (!readings.length) {
    return (
      <div className="panel space-y-2">
        <h3 className="font-semibold">Slippage on your fills</h3>
        <p className="text-sm text-forge-muted">
          Nothing measurable yet. A trade can be measured when it is closed, reconciled against the exchange, closed by your
          own stop or target rather than by hand, and had that price written down before it closed. Discretionary exits are
          deliberately left out — you closed where you chose to, so there is no price it was supposed to hit.
        </p>
        <Coverage coverage={coverage} />
      </div>
    );
  }

  return (
    <div className="panel space-y-3">
      <div>
        <h3 className="font-semibold">Slippage on your fills</h3>
        <p className="text-sm text-forge-muted">
          How far the exchange filled your stops and targets from where you set them. Positive is worse for you. Per symbol,
          because depth belongs to the book and not to you.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-forge-line text-left text-xs text-forge-muted">
              <th className="py-2 pr-3 font-medium">Symbol</th>
              <th className="py-2 pr-3 font-medium">Fills</th>
              {/* Median, not mean: one gap-through on a thin book is ten times a
                  normal fill and would decide the average on its own. */}
              <th className="py-2 pr-3 font-medium">Typical (bps)</th>
              <th className="py-2 pr-3 font-medium">Worst (bps)</th>
              <th className="py-2 pr-3 font-medium">Share of risk</th>
              <th className="py-2 pr-3 font-medium">Better than asked</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const light = isThinSample(group.count);
              return (
                <tr key={group.key} className={`border-b border-forge-line/60 ${light ? "text-forge-muted" : ""}`}>
                  <td className="py-2 pr-3 font-medium">
                    {group.label}
                    {light ? (
                      <span className="ml-2 rounded bg-forge-panel px-1.5 py-0.5 text-[11px] font-normal">
                        {MIN_SAMPLE - group.count} more to read this
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3">{group.count}</td>
                  {/* A thin row keeps its numbers and loses its colour: colour is
                      what makes a figure read as a verdict. Same rule as every
                      other table on this page. */}
                  <td className="py-2 pr-3">{light ? (group.medianBps?.toFixed(1) ?? "NA") : bps(group.medianBps)}</td>
                  <td className="py-2 pr-3">{light ? (group.worstBps?.toFixed(1) ?? "NA") : bps(group.worstBps)}</td>
                  <td className="py-2 pr-3">
                    {group.medianRiskFraction == null ? "NA" : `${(group.medianRiskFraction * 100).toFixed(0)}%`}
                  </td>
                  <td className="py-2 pr-3">{group.betterThanAsked}</td>
                </tr>
              );
            })}
            <tr className="text-sm font-medium">
              <td className="py-2 pr-3">All symbols</td>
              <td className="py-2 pr-3">{overall.count}</td>
              <td className="py-2 pr-3">{bps(overall.medianBps)}</td>
              <td className="py-2 pr-3">{bps(overall.worstBps)}</td>
              <td className="py-2 pr-3">
                {overall.medianRiskFraction == null ? "NA" : `${(overall.medianRiskFraction * 100).toFixed(0)}%`}
              </td>
              <td className="py-2 pr-3">{overall.betterThanAsked}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* THE TRADES THEMSELVES. An aggregate with no way back to the rows it
          came from cannot be checked — the owner went looking for "which trades
          have this?" and the answer was clicking every trade in the journal.
          A per-symbol median is the verdict; this is the evidence. */}
      <details className="rounded-lg border border-forge-line p-3" open={readings.length <= 10}>
        <summary className="cursor-pointer text-sm font-semibold">
          The {readings.length} trade{readings.length === 1 ? "" : "s"} behind these numbers
        </summary>
        <ul className="mt-3 space-y-1 text-sm">
          {readings.map(({ trade, reading }) => (
            <li key={trade.id} className="flex flex-wrap items-baseline gap-x-2 border-b border-forge-line/40 py-1.5 last:border-0">
              <Link href={`/trades/${trade.id}`} className="font-medium text-forge-blue hover:underline">
                {trade.instrument}
              </Link>
              <span className="text-xs text-forge-muted">{format(trade.tradeDateTime, "d MMM yyyy")}</span>
              <span className="text-xs text-forge-muted">{reading.leg === "STOP" ? "stopped out" : "target hit"}</span>
              <span className={reading.bps > 0.5 ? "text-forge-red" : reading.bps < -0.5 ? "text-forge-green" : undefined}>
                {`${reading.bps > 0 ? "+" : ""}${reading.bps.toFixed(1)} bps`}
              </span>
              {reading.riskFraction != null ? (
                <span className="text-xs text-forge-muted">
                  {`${Math.abs(reading.riskFraction * 100).toFixed(0)}% of risk`}
                </span>
              ) : null}
              {reading.suspect ? (
                <span className="rounded bg-forge-panel px-1.5 py-0.5 text-[11px]">excluded — bigger than the whole risk</span>
              ) : null}
            </li>
          ))}
        </ul>
      </details>

      <Coverage coverage={coverage} />

      <p className="text-xs text-forge-muted">
        <strong className="font-medium text-forge-ink">Share of risk</strong> is the one to read: 5 bps against a tight stop
        can be a third of what you were risking, and the same 5 bps against a wide one is nothing.
        {overall.suspectCount > 0 ? (
          <>
            {" "}
            {overall.suspectCount} reading{overall.suspectCount === 1 ? " is" : "s are"} left out of the medians for being
            larger than the whole planned risk — that is a moved stop or a partial exit, not a fill.
          </>
        ) : null}
      </p>
    </div>
  );
}

export function SlippageTableSkeleton() {
  return (
    <div className="panel">
      <h3 className="font-semibold">Slippage on your fills</h3>
      <div className="mt-3 h-24 animate-pulse rounded-lg bg-forge-panel" />
    </div>
  );
}
