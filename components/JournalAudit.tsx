import Link from "next/link";
import { format } from "date-fns";
import { countScaleSlips, type JournalAudit } from "@/lib/reconcile-audit";

// How much of the journal's money agrees with the exchange.
//
// Read-only and deliberately blunt. The owner suspected their hand-typed
// figures were wrong by a factor of 100 in places; the point of this panel is
// to settle that with counts rather than leave it as a worry, and to say
// plainly which trades can never be checked at all.

function money(value: number | null) {
  return value === null ? "—" : value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function JournalAuditPanel({ audit }: { audit: JournalAudit }) {
  const slips = countScaleSlips(audit);

  return (
    <section className="panel mb-5 space-y-3">
      <div>
        <h2 className="font-semibold">Does your journal agree with CoinDCX?</h2>
        <p className="text-sm text-forge-muted">
          The exchange is the source of truth for money, so anywhere the two differ, the journal is the one that is wrong.
          Syncing now corrects these automatically — this panel is here so you can see what changed and what cannot be checked.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-forge-panel p-3">
          <div className="text-xs text-forge-muted">Closed trades</div>
          <div className="text-lg font-semibold">{audit.considered}</div>
        </div>
        <div className="rounded-lg bg-forge-panel p-3">
          <div className="text-xs text-forge-muted">Already agree</div>
          <div className="text-lg font-semibold text-forge-green">{audit.clean}</div>
        </div>
        <div className="rounded-lg bg-forge-panel p-3">
          <div className="text-xs text-forge-muted">Disagree</div>
          <div className={`text-lg font-semibold ${audit.disagreeing.length ? "text-forge-red" : ""}`}>
            {audit.disagreeing.length}
          </div>
        </div>
        <div className="rounded-lg bg-forge-panel p-3">
          {/* The one that cannot be fixed by syncing, so it is shown beside the
              ones that can rather than buried under them. */}
          <div className="text-xs text-forge-muted">Not on CoinDCX</div>
          <div className="text-lg font-semibold">{audit.unmatched.length}</div>
        </div>
      </div>

      {slips > 0 ? (
        <p className="rounded-md border border-forge-line bg-forge-panel p-3 text-sm">
          <strong className="font-medium">{slips} trade{slips === 1 ? " looks" : "s look"} to be out by roughly 100x.</strong>{" "}
          That is the rupee-conversion slip — a $5 loss typed as 5 instead of 500. Syncing replaces these with the
          exchange&rsquo;s own figures.
        </p>
      ) : null}

      {audit.disagreeing.length ? (
        <details className="rounded-lg border border-forge-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">What disagrees, trade by trade</summary>
          <ul className="mt-3 space-y-2 text-sm">
            {audit.disagreeing.slice(0, 40).map((entry) => (
              <li key={entry.trade.id} className="border-b border-forge-line/40 pb-2 last:border-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <Link href={`/trades/${entry.trade.id}`} className="font-medium text-forge-blue hover:underline">
                    {entry.instrument}
                  </Link>
                  <span className="text-xs text-forge-muted">{format(entry.trade.tradeDateTime, "d MMM yyyy")}</span>
                  {entry.looksScaled ? (
                    <span className="rounded bg-forge-panel px-1.5 py-0.5 text-[11px] font-medium">~100x out</span>
                  ) : null}
                  {!entry.confirmed ? (
                    <span className="text-[11px] text-forge-muted">newly matched</span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-forge-muted">
                  {entry.gaps.map((gap) => (
                    <span key={gap.field} className="mr-3 inline-block">
                      {gap.label}: <span className="line-through">{money(gap.logged)}</span> → {money(gap.exchange)}
                      {gap.ratio !== null && Math.abs(gap.ratio) >= 50 && Math.abs(gap.ratio) <= 200
                        ? ` (${gap.ratio.toFixed(0)}x)`
                        : ""}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {audit.disagreeing.length > 40 ? (
            <p className="mt-2 text-xs text-forge-muted">…and {audit.disagreeing.length - 40} more.</p>
          ) : null}
        </details>
      ) : null}

      {audit.unmatched.length ? (
        <details className="rounded-lg border border-forge-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">
            {audit.unmatched.length} closed trade{audit.unmatched.length === 1 ? "" : "s"} CoinDCX has never heard of
          </summary>
          {/* A wrong number can be corrected. An unverifiable one can only be
              trusted or deleted, which is a decision and not a sync. */}
          <p className="mt-2 text-sm text-forge-muted">
            These have no matching position, so nothing can check their numbers — not now and not later. Either they were
            traded somewhere else, logged twice, or never really happened. Worth opening and deciding on one by one.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2 text-sm">
            {audit.unmatched.slice(0, 40).map((trade) => (
              <li key={trade.id}>
                <Link href={`/trades/${trade.id}`} className="text-forge-blue hover:underline">
                  {trade.instrument} {format(trade.tradeDateTime, "d MMM")}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
