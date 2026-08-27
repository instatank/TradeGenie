// Pulling the account down and keeping it. Paging, storage, and the honest
// account of what was and wasn't captured.
//
// Two design decisions shape this file:
//
// **Raw rows are stored; positions are not.** Everything lands in
// `exchangeFills` and `exchangeLedger` keyed by the exchange's own ids, and
// positions are recomputed on read by reconstructPositions(). One source of
// truth, no sync state to drift, and the fold can be improved later without a
// migration. Recomputing a few hundred rows costs nothing at this scale.
//
// **Capturing beats fetching.** The CoinDCX ledger only reaches back about
// three weeks while fills reach back ten months, so a funding charge not stored
// today is gone for good. That asymmetry is the whole reason this writes rows
// rather than querying live.
//
// Nothing here is load-bearing for the journal: the sync failing must never
// stop a trade being logged, so every path returns a result describing what
// happened instead of throwing.

import {
  callFutures,
  fundingEventsFrom,
  parseFills,
  parseTransactions,
  TRADES_PATH,
  TRANSACTIONS_PATH,
  type CoindcxCredentials,
  type CoindcxTransaction,
} from "@/lib/coindcx";
import { reconstructPositions, type Fill, type FundingEvent, type ReconstructedPosition } from "@/lib/positions";
import { createRecord, listRecords } from "@/lib/store";
import type { ExchangeFill, ExchangeLedgerEntry } from "@/lib/types";

export const SOURCE = "coindcx";

/** The exchange returns at most this many rows per call. */
const PAGE_SIZE = 100;

/**
 * Hard stop on paging. The measured account is ~425 fills (5 pages) and a
 * ledger of ~200 rows, so 40 pages is roughly eight times the whole history —
 * generous, while still guaranteeing a bug in the stop condition cannot spin
 * against the exchange forever.
 */
const MAX_PAGES = 40;

/** Between calls, so a full backfill can't trip a rate limit. */
const PAUSE_MS = 300;

export type SyncReport = {
  ok: boolean;
  /** Plain-English reason when ok is false. */
  detail: string;
  fillsSeen: number;
  fillsStored: number;
  ledgerSeen: number;
  ledgerStored: number;
  pages: number;
  /** Rows the exchange returned that could not be parsed. Should be 0. */
  unusable: number;
  /** Stage values we have no rule for — a loud signal, not a silent bucket. */
  unknownStages: string[];
  /** Oldest and newest fill actually held after this run. */
  fillsFrom: Date | null;
  fillsTo: Date | null;
  /** Oldest and newest ledger row held. The gap against fillsFrom is the
   *  window where positions have exact fees but no funding. */
  ledgerFrom: Date | null;
  ledgerTo: Date | null;
  startedAt: Date;
  finishedAt: Date;
};

function emptyReport(detail: string, ok = false): SyncReport {
  const now = new Date();
  return {
    ok,
    detail,
    fillsSeen: 0,
    fillsStored: 0,
    ledgerSeen: 0,
    ledgerStored: 0,
    pages: 0,
    unusable: 0,
    unknownStages: [],
    fillsFrom: null,
    fillsTo: null,
    ledgerFrom: null,
    ledgerTo: null,
    startedAt: now,
    finishedAt: now,
  };
}

type Page = { rows: unknown[]; error: string | null };

/** One page. A non-array body means the call failed or the ledger ended. */
async function fetchPage(
  credentials: CoindcxCredentials,
  path: string,
  page: number,
): Promise<Page> {
  const outcome = await callFutures(credentials, {
    label: `sync ${path} page ${page}`,
    path,
    payload: { page: String(page), size: String(PAGE_SIZE) },
  });

  if (outcome.error) return { rows: [], error: outcome.error };
  if (!outcome.ok) {
    const body = typeof outcome.body === "string" ? outcome.body : JSON.stringify(outcome.body);
    return { rows: [], error: `HTTP ${outcome.status}: ${body}` };
  }
  // A 200 that is not an array is an error dressed as a success — CoinDCX
  // answers some failures that way. Treating it as "no more pages" would end
  // the sync quietly and report a clean run that fetched nothing, which is the
  // exact failure mode this whole integration is built to avoid.
  if (!Array.isArray(outcome.body)) {
    const body = typeof outcome.body === "string" ? outcome.body : JSON.stringify(outcome.body);
    return { rows: [], error: `${path} page ${page} returned a non-list body: ${body}` };
  }
  return { rows: outcome.body, error: null };
}

/**
 * Page until the exchange runs out.
 *
 * Stops on an empty page, a short page (fewer rows than asked for means the
 * end), the page cap, or an error. An error stops paging but keeps everything
 * already collected — a partial sync that says so beats losing a good page to a
 * bad one.
 */
async function fetchAll(
  credentials: CoindcxCredentials,
  path: string,
): Promise<{ rows: unknown[]; pages: number; error: string | null }> {
  const rows: unknown[] = [];
  let pages = 0;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await fetchPage(credentials, path, page);
    pages += 1;
    if (result.error) return { rows, pages, error: result.error };
    if (!result.rows.length) break;
    rows.push(...result.rows);
    if (result.rows.length < PAGE_SIZE) break;
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }

  return { rows, pages, error: null };
}

function toStoredFill(fill: Fill): Omit<ExchangeFill, "id"> & { id: string } {
  return {
    id: fill.id,
    createdAt: new Date(),
    source: SOURCE,
    instrument: fill.instrument,
    currency: fill.currency ?? "",
    side: fill.side,
    quantity: fill.quantity,
    price: fill.price,
    fee: fill.fee,
    executedAt: fill.timestamp,
    orderId: fill.orderId ?? null,
  };
}

function toStoredLedger(transaction: CoindcxTransaction): Omit<ExchangeLedgerEntry, "id"> & { id: string } {
  return {
    id: transaction.id,
    createdAt: new Date(),
    source: SOURCE,
    instrument: transaction.instrument,
    currency: transaction.currency,
    stage: transaction.stage,
    kind: transaction.kind,
    amount: transaction.amount,
    fee: transaction.fee,
    positionId: transaction.positionId,
    orderId: transaction.orderId,
    rateInr: transaction.rate.inr,
    rateUsdt: transaction.rate.usdt,
    occurredAt: transaction.timestamp,
  };
}

function span(dates: Date[]): { from: Date | null; to: Date | null } {
  if (!dates.length) return { from: null, to: null };
  const times = dates.map((date) => date.getTime());
  return { from: new Date(Math.min(...times)), to: new Date(Math.max(...times)) };
}

/**
 * Fetch everything and store what is new.
 *
 * Idempotent by the exchange's own ids: a row already held is skipped, so
 * running this hourly, twice in a row, or after a month away all converge on
 * the same store. That is checked against the ids already present rather than
 * relying on the backend, because the local JSON store would happily append a
 * duplicate where Firestore would overwrite.
 */
export async function syncExchange(credentials: CoindcxCredentials): Promise<SyncReport> {
  const startedAt = new Date();
  const report = emptyReport("", true);
  report.startedAt = startedAt;

  const [tradeResult, ledgerResult] = [
    await fetchAll(credentials, TRADES_PATH),
    await fetchAll(credentials, TRANSACTIONS_PATH),
  ];
  report.pages = tradeResult.pages + ledgerResult.pages;

  const parsedFills = parseFills(tradeResult.rows);
  const parsedLedger = parseTransactions(ledgerResult.rows);
  report.fillsSeen = parsedFills.fills.length;
  report.ledgerSeen = parsedLedger.transactions.length;
  report.unusable = parsedFills.skipped + parsedLedger.skipped;
  report.unknownStages = parsedLedger.unknownStages;

  const errors = [tradeResult.error, ledgerResult.error].filter(Boolean);
  if (errors.length) {
    report.ok = false;
    report.detail = errors.join(" · ");
  }

  const [existingFills, existingLedger] = await Promise.all([
    listRecords("exchangeFills"),
    listRecords("exchangeLedger"),
  ]);
  const heldFills = new Set(existingFills.map((fill) => fill.id));
  const heldLedger = new Set(existingLedger.map((entry) => entry.id));

  for (const fill of parsedFills.fills) {
    if (heldFills.has(fill.id)) continue;
    await createRecord("exchangeFills", toStoredFill(fill));
    report.fillsStored += 1;
  }
  for (const transaction of parsedLedger.transactions) {
    if (heldLedger.has(transaction.id)) continue;
    await createRecord("exchangeLedger", toStoredLedger(transaction));
    report.ledgerStored += 1;
  }

  // Report the span of what is HELD, not of what this run happened to fetch —
  // the point of storing is that coverage outlives any single call.
  const [allFills, allLedger] = await Promise.all([
    listRecords("exchangeFills"),
    listRecords("exchangeLedger"),
  ]);
  const fillSpan = span(allFills.map((fill) => fill.executedAt));
  const ledgerSpan = span(allLedger.map((entry) => entry.occurredAt));
  report.fillsFrom = fillSpan.from;
  report.fillsTo = fillSpan.to;
  report.ledgerFrom = ledgerSpan.from;
  report.ledgerTo = ledgerSpan.to;

  report.finishedAt = new Date();
  if (report.ok) {
    report.detail = `Stored ${report.fillsStored} new fill${report.fillsStored === 1 ? "" : "s"} and ${report.ledgerStored} new ledger row${report.ledgerStored === 1 ? "" : "s"}.`;
  }
  return report;
}

/** A stable handle for a reconstructed position. One book per instrument per
 *  margin currency, so two positions cannot open in the same millisecond. */
export function positionKey(position: ReconstructedPosition): string {
  return `${position.instrument}|${position.currency}|${position.openedAt.getTime()}`;
}

export type ExchangeView = {
  positions: ReconstructedPosition[];
  unattributedFunding: FundingEvent[];
  /** Positions opened before the ledger begins, so their funding is missing
   *  and their net P&L understates the true cost. Named, never hidden. */
  positionsMissingFunding: ReconstructedPosition[];
  ledgerFrom: Date | null;
};

/**
 * Everything the exchange knows, folded into positions.
 *
 * Derived on every read rather than stored — see the note at the top. Positions
 * that predate the ledger are flagged rather than quietly presented as complete:
 * their fees are exact but their funding is unknowable now.
 */
export async function exchangeView(): Promise<ExchangeView> {
  const [storedFills, storedLedger] = await Promise.all([
    listRecords("exchangeFills"),
    listRecords("exchangeLedger"),
  ]);

  const fills: Fill[] = storedFills.map((fill) => ({
    id: fill.id,
    instrument: fill.instrument,
    currency: fill.currency,
    side: fill.side,
    quantity: fill.quantity,
    price: fill.price,
    fee: fill.fee,
    timestamp: fill.executedAt,
    orderId: fill.orderId,
  }));

  const funding: FundingEvent[] = fundingEventsFrom(
    storedLedger.map((entry) => ({
      id: entry.id,
      instrument: entry.instrument,
      currency: entry.currency,
      stage: entry.stage,
      kind: entry.kind,
      amount: entry.amount,
      fee: entry.fee,
      positionId: entry.positionId,
      orderId: entry.orderId,
      rate: { inr: entry.rateInr, usdt: entry.rateUsdt },
      timestamp: entry.occurredAt,
    })),
  );

  const { positions, unattributedFunding } = reconstructPositions(fills, funding);
  const ledgerSpan = span(storedLedger.map((entry) => entry.occurredAt));
  const positionsMissingFunding = ledgerSpan.from
    ? positions.filter((position) => position.openedAt < ledgerSpan.from!)
    : positions;

  return {
    positions,
    unattributedFunding,
    positionsMissingFunding,
    ledgerFrom: ledgerSpan.from,
  };
}
