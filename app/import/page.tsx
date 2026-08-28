import Link from "next/link";
import { format } from "date-fns";
import { AlertTriangle, RefreshCw, Trash2 } from "lucide-react";
import {
  acceptAllExchangeMatchesAction,
  acceptSelectedExchangeMatchesAction,
  deleteImportBatchAction,
  deleteRawExecutionAction,
  dismissSelectedExchangePositionsAction,
  restoreExchangePositionsAction,
  syncExchangeAction,
} from "@/app/actions";
import { ImportCsvClient } from "@/components/ImportCsvClient";
import { MatchCard, UnmatchedCard } from "@/components/ExchangeReconcile";
import { PageTitle } from "@/components/Fields";
import { SubmitButton } from "@/components/SubmitButton";
import { credentialsFromEnv } from "@/lib/coindcx";
import { exchangeView, positionKey } from "@/lib/coindcx-sync";
import { db } from "@/lib/data";
import { changedFields, diffTrade, matchPositions, willCloseTrade } from "@/lib/reconcile";
import { getSettings } from "@/lib/settings-store";
import { listRecords } from "@/lib/store";

// The exchange, reconciled against the journal.
//
// This page used to be a CSV mapper, which was the best available answer when
// the exchange offered no export. It does have an API, so the CSV path moves
// under a fold rather than being deleted — the exhaustive-but-lean rule — and
// the top of the page is now the thing actually used daily.
//
// Deliberately NOT a new nav item: "Import" was already the home for objective
// data arriving from outside, and adding "Exchange" beside it would have made
// two doors to one room.
// Never prerendered. This page reports live state — how many fills are held,
// when the last sync ran, what still disagrees with the journal — and a
// build-time snapshot of that is worse than useless: it would confidently show
// a sync status from whenever the app was last deployed. Every other page here
// can be cached and revalidated on write; this one genuinely cannot.
export const dynamic = "force-dynamic";

const REVIEW_BULK_FORM_ID = "exchange-review-select";
const UNJOURNALED_BULK_FORM_ID = "exchange-unjournaled-select";

export default async function ImportPage() {
  const [view, trades, settings, storedFills, storedLedger, batches] = await Promise.all([
    exchangeView(),
    db.list("trades"),
    getSettings(),
    listRecords("exchangeFills"),
    listRecords("exchangeLedger"),
    db.list("importBatches"),
  ]);
  const rawExecutions = (await db.list("rawExecutions")).sort(
    (a, b) => b.executionDateTime.getTime() - a.executionDateTime.getTime(),
  );

  const configured = Boolean(credentialsFromEnv());
  const dismissed = new Set(settings.dismissedExchangeKeys ?? []);
  const { matches, unmatched } = matchPositions(view.positions, trades, positionKey);

  // Only matches that would actually change something need attention. One that
  // already agrees is a confirmation, not a task, and mixing the two would bury
  // the handful that matter.
  //
  // "Something" includes CLOSING a trade the journal still shows as open, which
  // is not a numeric diff. Filtering on numbers alone would have hidden exactly
  // the case this is most useful for: a position closed on the exchange days ago
  // that the journal never caught up with.
  // Newest first, like every other list in this app (trades, notes, inbox).
  // matchPositions returns matches ordered by how CLOSE each match was, which
  // is an implementation detail and reads as random to a human.
  const needsReview = matches
    .filter((match) => willCloseTrade(match) || changedFields(diffTrade(match.trade, match.position)).length > 0)
    .sort((a, b) => b.position.openedAt.getTime() - a.position.openedAt.getTime());
  const agreed = matches.length - needsReview.length;
  const toJournal = unmatched
    .filter((position) => !dismissed.has(positionKey(position)))
    .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
  const hiddenCount = unmatched.length - toJournal.length;

  const lastFill = storedFills.length
    ? new Date(Math.max(...storedFills.map((fill) => fill.executedAt.getTime())))
    : null;

  return (
    <main className="page-shell">
      <PageTitle
        title="Exchange"
        subtitle="Your CoinDCX fills, folded into positions and checked against what you wrote down."
      />

      <section className="panel mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="text-sm">
            <div className="font-medium">
              CoinDCX:{" "}
              <span className={configured ? "text-forge-green" : "text-forge-red"}>
                {configured ? "connected" : "no API key set"}
              </span>
            </div>
            <p className="mt-1 text-forge-muted">
              {storedFills.length
                ? `${storedFills.length} fills and ${storedLedger.length} ledger rows held${lastFill ? `, latest ${format(lastFill, "dd MMM HH:mm")}` : ""}. ${view.positions.length} positions.`
                : configured
                  ? "Nothing pulled yet. Sync to bring your history in."
                  : "Set COINDCX_API_KEY and COINDCX_API_SECRET in Vercel, then sync."}
            </p>
          </div>
          <form action={syncExchangeAction}>
            <SubmitButton
              disabled={!configured}
              pendingLabel="Syncing…"
              icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            >
              Sync now
            </SubmitButton>
          </form>
        </div>

        {view.positionsMissingFunding.length ? (
          <p className="mt-3 flex items-start gap-2 rounded-lg border-l-4 border-forge-gold bg-amber-50 px-3 py-2 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-forge-gold" aria-hidden="true" />
            <span>
              <span className="font-medium">{view.positionsMissingFunding.length} older position{view.positionsMissingFunding.length === 1 ? "" : "s"}</span>{" "}
              opened before {view.ledgerFrom ? format(view.ledgerFrom, "dd MMM yyyy") : "the ledger starts"}, which is as far back as
              CoinDCX&apos;s transaction ledger goes. Those have exact prices and fees but no funding, so their net P&amp;L understates
              the real cost slightly. Everything after that date is complete, and stays complete now it is captured daily.
            </span>
          </p>
        ) : null}

        {view.unattributedFunding.length ? (
          <p className="mt-3 text-sm text-forge-muted">
            {view.unattributedFunding.length} funding row{view.unattributedFunding.length === 1 ? "" : "s"} matched no open
            position — reported rather than folded in silently.
          </p>
        ) : null}
      </section>

      <section className="panel mb-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Needs review</h2>
            <p className="text-sm text-forge-muted">
              {needsReview.length
                ? `${needsReview.length} trade${needsReview.length === 1 ? "" : "s"} where the exchange disagrees with what you logged.`
                : "Nothing to reconcile."}
              {agreed ? ` ${agreed} already match.` : ""}
            </p>
          </div>
          {needsReview.length > 1 ? (
            <div className="flex gap-2">
              <form id={REVIEW_BULK_FORM_ID} action={acceptSelectedExchangeMatchesAction}>
                <SubmitButton className="button-secondary" pendingLabel="Accepting…">Accept selected</SubmitButton>
              </form>
              <form action={acceptAllExchangeMatchesAction}>
                <SubmitButton className="button-secondary" pendingLabel="Reconciling…">
                  Accept all {needsReview.length}
                </SubmitButton>
              </form>
            </div>
          ) : null}
        </div>
        <div className="space-y-3">
          {needsReview.map((match) => (
            <MatchCard
              key={match.trade.id}
              match={match}
              positionKey={positionKey(match.position)}
              bulkFormId={needsReview.length > 1 ? REVIEW_BULK_FORM_ID : undefined}
            />
          ))}
          {!needsReview.length && storedFills.length ? (
            <p className="text-sm text-forge-muted">Your journal agrees with the exchange on every matched trade.</p>
          ) : null}
        </div>
      </section>

      <section className="panel mb-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold">Not journaled</h2>
            <p className="text-sm text-forge-muted">
              {toJournal.length
                ? `${toJournal.length} position${toJournal.length === 1 ? "" : "s"} on the exchange you haven't written up.`
                : "Every exchange position has a journal entry."}
            </p>
          </div>
          {toJournal.length > 1 ? (
            <form id={UNJOURNALED_BULK_FORM_ID} action={dismissSelectedExchangePositionsAction}>
              <SubmitButton className="button-secondary" pendingLabel="Hiding…">Dismiss selected</SubmitButton>
            </form>
          ) : null}
        </div>
        {toJournal.length > 1 ? (
          <p className="mb-3 text-xs text-forge-muted">
            Checking a box here only hides it from this list — logging a trade always needs its own thesis, so there is no
            bulk &quot;log selected&quot;. Use the checkbox to clear out the ones you don&apos;t plan to journal.
          </p>
        ) : null}
        <div className="space-y-3">
          {toJournal.map((position) => (
            <UnmatchedCard
              key={positionKey(position)}
              position={position}
              positionKey={positionKey(position)}
              bulkFormId={toJournal.length > 1 ? UNJOURNALED_BULK_FORM_ID : undefined}
            />
          ))}
        </div>
        {hiddenCount ? (
          <form action={restoreExchangePositionsAction} className="mt-3">
            <button className="button-secondary min-h-8 px-2 text-sm" type="submit">
              Show {hiddenCount} hidden
            </button>
          </form>
        ) : null}
      </section>

      <details className="panel">
        <summary className="cursor-pointer font-semibold">CSV import (manual fallback)</summary>
        <p className="mt-2 text-sm text-forge-muted">
          From before the API worked. Kept for any broker that only offers a file — nothing here needs it now.
        </p>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ImportCsvClient />
          <section>
            <h3 className="mb-2 text-sm font-semibold">Past batches</h3>
            <div className="space-y-2">
              {batches
                .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
                .slice(0, 8)
                .map((batch) => (
                  <div key={batch.id} className="flex items-start justify-between gap-3 rounded-md bg-forge-panel p-3 text-sm">
                    <div>
                      <div className="font-medium">{batch.fileName ?? "CSV import"}</div>
                      <div className="text-forge-muted">
                        {format(batch.createdAt, "dd MMM HH:mm")} · {batch.importedCount}/{batch.rowCount} imported
                      </div>
                    </div>
                    <form action={deleteImportBatchAction}>
                      <input type="hidden" name="importBatchId" value={batch.id} />
                      <button className="button-danger min-h-8 px-2" type="submit" aria-label="Delete import batch">
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </form>
                  </div>
                ))}
              {!batches.length ? <p className="muted">No CSV imports.</p> : null}
            </div>
            <Link href="/trades" className="mt-3 inline-block text-sm text-forge-blue hover:underline">
              Go to the trade journal →
            </Link>
          </section>
        </div>

        {/* CSV import writes rows here, so they have to remain visible — a path
            that saves into somewhere you cannot look is worse than no path. The
            old filter/sort/pagination panel is gone on purpose: it was built for
            a primary workflow, and this is a fallback. */}
        <section className="mt-4">
          <h3 className="mb-2 text-sm font-semibold">Rows from CSV ({rawExecutions.length})</h3>
          {rawExecutions.length ? (
            <div className="overflow-x-auto rounded-lg border border-forge-line">
              <table className="min-w-full text-sm">
                <thead className="bg-forge-panel">
                  <tr>
                    {["Time", "Instrument", "Side", "Qty", "Price", "P&L", ""].map((header) => (
                      <th key={header} className="px-3 py-2 text-left font-medium">{header}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rawExecutions.slice(0, 25).map((execution) => (
                    <tr key={execution.id} className="border-t border-forge-line">
                      <td className="whitespace-nowrap px-3 py-2">{format(execution.executionDateTime, "dd MMM HH:mm")}</td>
                      <td className="px-3 py-2">{execution.instrument}</td>
                      <td className="px-3 py-2">{execution.side ?? "—"}</td>
                      <td className="px-3 py-2">{execution.quantity ?? "—"}</td>
                      <td className="px-3 py-2">{execution.price ?? "—"}</td>
                      <td className="px-3 py-2">{execution.realizedPnl ?? "—"}</td>
                      <td className="px-3 py-2">
                        <form action={deleteRawExecutionAction}>
                          <input type="hidden" name="rawExecutionId" value={execution.id} />
                          <button className="button-danger min-h-8 px-2" type="submit" aria-label="Delete row">
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rawExecutions.length > 25 ? (
                <p className="p-3 text-sm text-forge-muted">Showing the newest 25 of {rawExecutions.length}.</p>
              ) : null}
            </div>
          ) : (
            <p className="muted">No CSV rows.</p>
          )}
        </section>
      </details>
    </main>
  );
}
