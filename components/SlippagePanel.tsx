import { getTradeSlippage } from "@/lib/slippage-view";
import type { EntrySlippageReading, SlippageReading } from "@/lib/slippage";
import type { Trade } from "@/lib/types";

// What your fills actually cost you on this one trade.
//
// An async server component in its own <Suspense>, same shape and same reason
// as TradeReplayPanel: it folds the whole exchange fill history to find this
// trade's position, and the trade page's job is to show you your trade first.
//
// The panel is deliberately talkative when it has nothing to show. "No reading"
// is almost always because this exit cannot be measured — you closed it
// yourself, or no stop was written down — and a silent empty box would read as
// a broken feature rather than as the honest answer it is.

function fmt(value: number, digits = 2) {
  return value.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Signed, and formatted as ONE text node.
 *
 * React emits `+<!-- -->48.8<!-- --> bps` for `{sign}{value} bps`, which splits
 * the figure across three nodes with comment markers between them. That is not
 * cosmetic: a gate assertion — and a reader's Ctrl+F — looking for "+48.8 bps"
 * then fails against a page that rendered perfectly. This repo has been bitten
 * by exactly that before; see the note in scripts/smoke.mts. */
function signed(value: number, digits: number, unit = "") {
  return `${value > 0 ? "+" : ""}${fmt(value, digits)}${unit}`;
}

/** Positive is worse for you, so red is positive here — the opposite of P&L. */
function toneFor(bps: number) {
  if (bps > 0.5) return "text-forge-red";
  if (bps < -0.5) return "text-forge-green";
  return "text-forge-ink";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-forge-panel p-3">
      <div className="text-xs text-forge-muted">{label}</div>
      <div className="text-lg font-semibold">{children}</div>
    </div>
  );
}

function ExitReading({ reading }: { reading: SlippageReading }) {
  const legLabel = reading.leg === "STOP" ? "stop" : "target";
  const worse = reading.priceDelta > 0;

  return (
    <div className="space-y-3">
      <p className="text-sm text-forge-muted">
        Your {legLabel} was <strong className="font-medium text-forge-ink">{fmt(reading.reference, 4)}</strong>. The exchange
        filled you at <strong className="font-medium text-forge-ink">{fmt(reading.filled, 4)}</strong>
        {reading.legs > 1 ? <> across {reading.legs} legs</> : null} — {worse ? "worse" : "better"} than you asked for.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Row label={`Slipped by (${reading.quoteCurrency})`}>
          <span className={toneFor(reading.bps)}>{signed(reading.priceDelta, 4)}</span>
        </Row>
        <Row label="As basis points">
          <span className={toneFor(reading.bps)}>{signed(reading.bps, 1, " bps")}</span>
        </Row>
        {/* The headline. bps alone cannot tell you whether a fill hurt: the same
            5bps is a rounding error against a wide stop and a third of the
            budget against a tight one. */}
        <Row label="Share of your planned risk">
          {reading.riskFraction == null ? (
            <span className="text-forge-muted">NA</span>
          ) : (
            <span className={toneFor(reading.bps)}>{signed(reading.riskFraction * 100, 0, "%")}</span>
          )}
        </Row>
      </div>

      {reading.cost != null ? (
        <p className="text-sm text-forge-muted">
          At this size that is <strong className="font-medium text-forge-ink">{fmt(Math.abs(reading.cost), 2)} {reading.quoteCurrency}</strong>{" "}
          {worse ? "you did not plan to lose" : "better than planned"}, on top of fees and funding.
        </p>
      ) : null}

      {reading.suspect ? (
        <p className="rounded-md border border-forge-line bg-forge-panel p-3 text-sm">
          <strong className="font-medium">This reading is larger than your whole planned risk</strong>, so it is almost
          certainly not slippage — a stop moved after entry, a partial take-profit folded into the same average, or the exit
          matched to the wrong price. It is shown here and left out of every average on{" "}
          <span className="font-medium">Analytics</span>.
        </p>
      ) : null}

      {reading.spreadFraction > 0.001 && reading.legs > 1 ? (
        <p className="text-xs text-forge-muted">
          The closing legs were spread over {fmt(reading.spreadFraction * 10_000, 0)} bps, so this fill walked the book rather
          than clearing at one price.
        </p>
      ) : null}
    </div>
  );
}

function EntryReading({ reading }: { reading: EntrySlippageReading }) {
  const worse = reading.priceDelta > 0;
  return (
    <p className="text-sm text-forge-muted">
      You wanted in at <strong className="font-medium text-forge-ink">{fmt(reading.reference, 4)}</strong> and were filled at{" "}
      <strong className="font-medium text-forge-ink">{fmt(reading.filled, 4)}</strong> —{" "}
      <span className={toneFor(reading.bps)}>{`${signed(reading.bps, 1, " bps")} ${worse ? "against" : "in favour of"} you`}</span>
      {reading.riskFraction != null ? <>, {fmt(Math.abs(reading.riskFraction) * 100, 0)}% of your planned risk</> : null}
      {reading.cost != null ? <> ({fmt(Math.abs(reading.cost), 2)} {reading.quoteCurrency})</> : null}.
    </p>
  );
}

export async function SlippagePanel({ trade }: { trade: Trade }) {
  const { exit, entry } = await getTradeSlippage(trade);

  return (
    <section className="panel space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">What your fills cost you</h2>
        <span className="text-xs text-forge-muted">the price you asked for, against the one you got</span>
      </div>

      {exit.ok ? <ExitReading reading={exit} /> : <p className="text-sm text-forge-muted">{exit.detail}</p>}

      <div className="border-t border-forge-line pt-3">
        <h3 className="text-sm font-semibold">Getting in</h3>
        <div className="mt-2">
          {entry.ok ? <EntryReading reading={entry} /> : <p className="text-sm text-forge-muted">{entry.detail}</p>}
        </div>
      </div>
    </section>
  );
}

export function SlippagePanelSkeleton() {
  return (
    <section className="panel">
      <h2 className="font-semibold">What your fills cost you</h2>
      <p className="mt-2 text-sm text-forge-muted">Reading your fills&hellip;</p>
      <div className="mt-4 h-24 animate-pulse rounded-lg bg-forge-panel" />
    </section>
  );
}
