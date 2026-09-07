import Link from "next/link";
import { formatMoney, type Currency } from "@/lib/currency";
import { isThinSample, MIN_SAMPLE, type BucketStats } from "@/lib/metrics";

/**
 * Does this symbol actually pay you?
 *
 * The asset page listed the trades on a symbol and told you nothing about what
 * they returned, so the most useful question a tracked asset can answer — the
 * gap between how much you think about something and what it gives back — was
 * invisible. Forty notes on a symbol you lose money on is a finding; it was
 * unreadable while the note count and the P&L lived on different pages.
 *
 * Scored with `bucketStatsFor` in lib/data.ts, which is the same maths every
 * analytics table uses, so a number here can never disagree with the same
 * number on /analytics.
 */
export function AssetStats({
  stats,
  baseCurrency,
  noteCount,
  openTradeCount,
  symbol,
}: {
  stats: BucketStats;
  baseCurrency: Currency;
  noteCount: number;
  openTradeCount: number;
  symbol: string;
}) {
  // Colour is what makes a number read as a verdict, so a thin sample loses it
  // — same rule every grouped table in the app follows. Three trades and a 100%
  // win rate is one lucky week.
  const light = isThinSample(stats.count);

  return (
    <div className="panel space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">What {symbol} has done for you</h2>
        {stats.count ? (
          <Link href={`/analytics?instrument=${encodeURIComponent(symbol)}`} className="text-xs text-forge-blue hover:underline">
            Break it down →
          </Link>
        ) : null}
      </div>

      {stats.count === 0 && openTradeCount === 0 ? (
        <p className="text-sm text-forge-muted">
          No trades logged on {symbol} yet — {noteCount ? `${noteCount} note${noteCount === 1 ? "" : "s"} in the thread, though.` : "just the thesis so far."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Closed trades" value={String(stats.count)} />
            <Stat label="Notes written" value={String(noteCount)} />
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
          <div className="rounded-lg bg-forge-panel p-3">
            <div className="text-xs text-forge-muted">Net P&amp;L on {symbol}</div>
            <div
              className={`text-2xl font-semibold ${
                light ? "text-forge-muted" : stats.netPnl >= 0 ? "text-forge-green" : "text-forge-red"
              }`}
            >
              {formatMoney(stats.netPnl, baseCurrency, { signed: true })}
            </div>
          </div>
          {openTradeCount ? (
            <p className="text-xs text-forge-muted">
              {openTradeCount} open {openTradeCount === 1 ? "position" : "positions"} — not counted above until closed.
            </p>
          ) : null}
          {light && stats.count > 0 ? (
            <p className="text-xs text-forge-muted">
              {MIN_SAMPLE - stats.count} more closed {MIN_SAMPLE - stats.count === 1 ? "trade" : "trades"} before these read as
              anything but a small sample.
            </p>
          ) : null}
        </>
      )}
    </div>
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
