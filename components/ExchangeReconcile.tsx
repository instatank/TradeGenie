import Link from "next/link";
import { format } from "date-fns";
import { ArrowRight, Check, EyeOff } from "lucide-react";
import { acceptExchangeMatchAction, dismissExchangePositionAction } from "@/app/actions";
import { TagPills } from "@/components/TagPills";
import { changedFields, diffTrade, willCloseTrade, type Match } from "@/lib/reconcile";
import type { ReconstructedPosition } from "@/lib/positions";

// What the exchange says, next to what you wrote — and one button to take the
// exchange's version.
//
// The design rule: only the rows that would actually CHANGE are shown. A diff
// listing seven fields where five already agree buries the one number that
// matters, and the whole point of this screen is noticing that you thought you
// got in at 2,480 and actually got 2,484.

function DirectionBadge({ direction }: { direction: string }) {
  const isLong = direction === "LONG";
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${isLong ? "bg-emerald-50 text-forge-green" : "bg-red-50 text-forge-red"}`}>
      {isLong ? "Long" : "Short"}
    </span>
  );
}

function InfoChip({ label }: { label: string }) {
  return <span className="shrink-0 rounded-full bg-forge-panel px-2 py-0.5 text-xs font-medium text-forge-muted">{label}</span>;
}

function money(value: number | null, currency: string): string {
  if (value === null) return "—";
  const decimals = Math.abs(value) >= 100 ? 2 : Math.abs(value) >= 1 ? 3 : 6;
  return `${value.toFixed(decimals)} ${currency}`;
}

export function MatchCard({ match, positionKey }: { match: Match; positionKey: string }) {
  const changes = changedFields(diffTrade(match.trade, match.position));
  const closes = willCloseTrade(match);
  const { position, trade } = match;

  return (
    <article className="rounded-xl border border-forge-line p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">{position.instrument}</span>
            <DirectionBadge direction={position.direction} />
            <InfoChip label={position.currency} />
            {position.status === "OPEN" ? <InfoChip label="Still open" /> : null}
          </div>
          <p className="mt-1 text-sm text-forge-muted">
            Exchange opened {format(position.openedAt, "dd MMM HH:mm")}
            {" · "}
            you logged it {match.minutesApart === 0 ? "at the same minute" : `${match.minutesApart} min ${trade.tradeDateTime > position.openedAt ? "later" : "earlier"}`}
            {match.confirmed ? " · already linked" : ""}
          </p>
          {trade.entryThesis ? <p className="mt-1 text-sm italic text-forge-muted">“{trade.entryThesis}”</p> : null}
          {trade.tags?.length ? <TagPills tags={trade.tags} /> : null}
        </div>
        <Link href={`/trades/${trade.id}`} className="button-secondary min-h-8 shrink-0 px-2 text-sm">
          Open trade
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </header>

      {closes ? (
        <p className="mb-3 flex items-start gap-2 rounded-lg border-l-4 border-forge-green bg-emerald-50 px-3 py-2 text-sm">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-forge-green" aria-hidden="true" />
          <span>
            <span className="font-medium">This trade is still open in your journal but closed on the exchange.</span>{" "}
            Accepting closes it and fills in the exit — then it will show up for your one-minute review, which is still yours to do.
          </span>
        </p>
      ) : null}

      {changes.length || closes ? (
        <>
          <div className="overflow-x-auto rounded-lg border border-forge-line">
            <table className="min-w-full text-sm">
              <thead className="bg-forge-panel">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Field</th>
                  <th className="px-3 py-2 text-left font-medium">You logged</th>
                  <th className="px-3 py-2 text-left font-medium">Exchange says</th>
                </tr>
              </thead>
              <tbody>
                {changes.map((row) => (
                  <tr key={String(row.field)} className="border-t border-forge-line">
                    <td className="px-3 py-2">{row.label}</td>
                    <td className="px-3 py-2 text-forge-muted">{money(row.logged, position.currency)}</td>
                    <td className="px-3 py-2 font-medium">{money(row.exchange, position.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={acceptExchangeMatchAction} className="mt-3">
            <input type="hidden" name="tradeId" value={trade.id} />
            <input type="hidden" name="exchangeKey" value={positionKey} />
            <button className="button" type="submit">
              <Check className="h-4 w-4" aria-hidden="true" />
              Use the exchange&apos;s numbers
            </button>
          </form>
          <p className="mt-2 text-xs text-forge-muted">
            Only these numbers change. Your thesis, mood, setup, mistakes and lesson are never touched.
          </p>
        </>
      ) : (
        <p className="text-sm text-forge-muted">Everything already matches the exchange.</p>
      )}
    </article>
  );
}

/**
 * A position with no journal entry.
 *
 * Deliberately NOT auto-created as a trade. The prompt to log it is the point:
 * an app that silently filled these in would leave you with a P&L spreadsheet
 * instead of a journal, and the writing-down is the habit worth protecting.
 */
export function UnmatchedCard({ position, positionKey }: { position: ReconstructedPosition; positionKey: string }) {
  const logHref = `/trades/new?instrument=${encodeURIComponent(position.instrument)}&direction=${position.direction}`;

  return (
    <article className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-forge-line p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">{position.instrument}</span>
          <DirectionBadge direction={position.direction} />
          <InfoChip label={position.currency} />
        </div>
        <p className="mt-1 text-sm text-forge-muted">
          {format(position.openedAt, "dd MMM HH:mm")}
          {" · "}
          {position.quantity} @ {position.entryPrice.toFixed(4)}
          {position.status === "CLOSED" ? ` → ${position.exitPrice?.toFixed(4)}` : " · still open"}
          {position.status === "CLOSED" ? ` · net ${money(position.netPnl, position.currency)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Link href={logHref} className="button min-h-8 px-3 text-sm">Log this trade</Link>
        <form action={dismissExchangePositionAction}>
          <input type="hidden" name="exchangeKey" value={positionKey} />
          <button className="button-secondary min-h-8 px-2 text-sm" type="submit" title="Stop showing this">
            <EyeOff className="h-4 w-4" aria-hidden="true" />
          </button>
        </form>
      </div>
    </article>
  );
}
