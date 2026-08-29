import Link from "next/link";
import { format } from "date-fns";
import { Archive, ArrowRight, Check, EyeOff } from "lucide-react";
import { acceptExchangeMatchAction, archiveExchangePositionAction, dismissExchangePositionAction } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
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

function money(value: number | null, unit: string): string {
  if (value === null) return "—";
  const decimals = Math.abs(value) >= 100 ? 2 : Math.abs(value) >= 1 ? 3 : 6;
  return `${value.toFixed(decimals)} ${unit}`;
}

export function MatchCard({
  match,
  positionKey,
  bulkFormId,
}: {
  match: Match;
  positionKey: string;
  /** The id of the "Accept selected" form elsewhere on the page. The checkbox
   *  uses the HTML `form` attribute to submit there regardless of where it sits
   *  in the DOM — same trick the inbox's remove buttons use, since a form
   *  cannot nest inside this card's own per-item accept form. Omitted when
   *  there is nothing to bulk-act on (one match, same as "Accept all" being
   *  hidden then) — a checkbox with no form to reach would tick without doing
   *  anything, which is worse than not offering it. */
  bulkFormId?: string;
}) {
  const changes = changedFields(diffTrade(match.trade, match.position));
  const closes = willCloseTrade(match);
  const { position, trade } = match;

  return (
    <article className="rounded-xl border border-forge-line p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            {bulkFormId ? (
              <label className="inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  name="selected"
                  value={`${trade.id}::${positionKey}`}
                  form={bulkFormId}
                  defaultChecked
                  className="h-4 w-4 rounded border-forge-line"
                  aria-label={`Include ${position.instrument} in the bulk accept`}
                />
              </label>
            ) : null}
            <span className="font-semibold">{position.instrument}</span>
            <DirectionBadge direction={position.direction} />
            <InfoChip label={`${position.currency} wallet`} />
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
                    <td className="px-3 py-2 text-forge-muted">{money(row.logged, row.unit)}</td>
                    <td className="px-3 py-2 font-medium">{money(row.exchange, row.unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form action={acceptExchangeMatchAction} className="mt-3">
            <input type="hidden" name="tradeId" value={trade.id} />
            <input type="hidden" name="exchangeKey" value={positionKey} />
            <SubmitButton pendingLabel="Applying…" icon={<Check className="h-4 w-4" aria-hidden="true" />}>
              Use the exchange&apos;s numbers
            </SubmitButton>
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
 * Nothing here is ever auto-created. The prompt to log it is the point: an app
 * that silently filled these in would leave you with a P&L spreadsheet instead
 * of a journal, and the writing-down is the habit worth protecting.
 *
 * Three doors, in the order they deserve to be taken:
 *   - **Log this trade** opens the real form, where you write why. This is the
 *     one that keeps the journal a journal, so it stays the primary button.
 *   - **Log as archive** stores the exchange's numbers with every subjective
 *     field left empty, for a trade whose reasoning is genuinely gone — taken
 *     before the journal existed. It is secondary and it says what it costs.
 *   - **Hide** takes it out of the nudge and changes nothing.
 */
export function UnmatchedCard({
  position,
  positionKey,
  bulkFormId,
}: {
  position: ReconstructedPosition;
  positionKey: string;
  /** The id of the bulk form elsewhere on the page. Same `form` attribute trick
   *  as MatchCard: a checkbox cannot sit inside this card's own per-item forms,
   *  so it submits to a form it names. That form carries both bulk actions —
   *  dismiss, and archive the back catalogue — and neither of them is the
   *  default: boxes start unchecked here, because logging or hiding a batch of
   *  real trades is a deliberate act, not the common case. Omitted when there is
   *  nothing to bulk-act on. */
  bulkFormId?: string;
}) {
  const logHref = `/trades/new?instrument=${encodeURIComponent(position.instrument)}&direction=${position.direction}`;

  return (
    <article className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-forge-line p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {bulkFormId ? (
            <label className="inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                name="selected"
                value={positionKey}
                form={bulkFormId}
                className="h-4 w-4 rounded border-forge-line"
                aria-label={`Select ${position.instrument} to dismiss`}
              />
            </label>
          ) : null}
          <span className="font-semibold">{position.instrument}</span>
          <DirectionBadge direction={position.direction} />
          <InfoChip label={`${position.currency} wallet`} />
        </div>
        <p className="mt-1 text-sm text-forge-muted">
          {format(position.openedAt, "dd MMM HH:mm")}
          {" · "}
          {position.quantity} {position.instrument} @ {position.entryPrice.toFixed(4)}
          {position.status === "CLOSED" ? ` → ${position.exitPrice?.toFixed(4)} ${position.quoteCurrency}` : " · still open"}
          {position.status === "CLOSED" ? ` · net ${money(position.netPnl, position.currency)}` : ""}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap gap-2">
        <Link href={logHref} className="button min-h-8 px-3 text-sm">Log this trade</Link>
        <form action={archiveExchangePositionAction}>
          <input type="hidden" name="exchangeKey" value={positionKey} />
          <SubmitButton
            className="button-secondary min-h-8 px-3 text-sm"
            pendingLabel="Logging…"
            icon={<Archive className="h-4 w-4" aria-hidden="true" />}
          >
            Log as archive
          </SubmitButton>
        </form>
        <form action={dismissExchangePositionAction}>
          <input type="hidden" name="exchangeKey" value={positionKey} />
          <SubmitButton className="button-secondary min-h-8 px-2 text-sm" icon={<EyeOff className="h-4 w-4" aria-hidden="true" />}>
            <span className="sr-only">Stop showing this</span>
          </SubmitButton>
        </form>
      </div>
    </article>
  );
}
