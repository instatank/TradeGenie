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
import { FALLBACK_INR_PER_USDT, type MoneyRate } from "@/lib/currency";
import { createRecord, listRecords, updateRecord } from "@/lib/store";
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
  /** Held rows topped up with a field they predate. Visible so a schema
   *  migration is never silent. */
  fillsBackfilled: number;
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
    fillsBackfilled: 0,
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
    quoteCurrency: fill.quoteCurrency ?? "",
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
  const heldLedger = new Set(existingLedger.map((entry) => entry.id));

  // Rows already held are skipped — that is what makes the sync idempotent —
  // but a field ADDED to the shape after they were written would then never
  // reach them. `quoteCurrency` was exactly that: 425 rows stored without it,
  // and no amount of re-syncing would have fixed them. So held rows are checked
  // for fields they predate and topped up in place.
  const heldById = new Map(existingFills.map((fill) => [fill.id, fill]));
  for (const fill of parsedFills.fills) {
    const held = heldById.get(fill.id);
    if (!held) {
      await createRecord("exchangeFills", toStoredFill(fill));
      report.fillsStored += 1;
      continue;
    }
    if (!held.quoteCurrency && fill.quoteCurrency) {
      await updateRecord("exchangeFills", fill.id, { quoteCurrency: fill.quoteCurrency });
      report.fillsBackfilled += 1;
    }
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
    const backfill = report.fillsBackfilled ? ` Repaired ${report.fillsBackfilled} older fill${report.fillsBackfilled === 1 ? "" : "s"} missing their price currency.` : "";
    report.detail = `Stored ${report.fillsStored} new fill${report.fillsStored === 1 ? "" : "s"} and ${report.ledgerStored} new ledger row${report.ledgerStored === 1 ? "" : "s"}.${backfill}`;
  }
  return report;
}

/**
 * What a stored fill is priced in.
 *
 * Rows written before `quoteCurrency` existed have it empty, and the sync is
 * idempotent — it skips ids it already holds — so nothing would ever have
 * backfilled them. Left unhandled, a blank quote currency silently disables the
 * conversion AND makes prices render with the wallet's label: both symptoms of
 * the ~100x INR bug, reappearing purely as a data-migration gap.
 *
 * Defaulting to USDT is safe because every CoinDCX perp is USDT-quoted
 * (`B-SOL_USDT`, `B-ETH_USDT`, …) — three probe rounds against the live account
 * returned nothing else. If a pair ever settles in the same currency it is
 * quoted in, the rate is 1 and this default changes nothing anyway.
 */
function quoteOf(fill: { quoteCurrency?: string }): string {
  return fill.quoteCurrency || "USDT";
}

type RatePoint = { at: number; perUsdt: number };
type RateHistory = Map<string, RatePoint[]>;

/**
 * Wallet currency -> observed "units per 1 USDT", oldest first.
 *
 * Read off `price_in_usdt`, which is the value of ONE unit of that row's wallet
 * currency in USDT. Inverting it gives units-per-USDT. A USDT row reads 1 and
 * inverts to 1, which is exactly right.
 */
function buildRateHistory(ledger: ExchangeLedgerEntry[]): RateHistory {
  const history: RateHistory = new Map();
  for (const entry of ledger) {
    const perUnitUsdt = entry.rateUsdt;
    if (!entry.currency || typeof perUnitUsdt !== "number" || !Number.isFinite(perUnitUsdt) || perUnitUsdt <= 0) continue;
    const points = history.get(entry.currency) ?? [];
    points.push({ at: entry.occurredAt.getTime(), perUsdt: 1 / perUnitUsdt });
    history.set(entry.currency, points);
  }
  for (const points of history.values()) points.sort((a, b) => a.at - b.at);
  return history;
}

/**
 * The rate to carry money priced in `quote` into the `wallet` currency.
 *
 * 1 when they are the same currency — every USDT-margined trade — so the common
 * case does no work and cannot drift. Falls back to the flat 100:1 only when the
 * ledger has nothing for that wallet at all, which is the pre-ledger window.
 */
function settlementRateFor(history: RateHistory, wallet: string, quote: string, at: Date): number {
  if (!wallet || !quote || wallet === quote) return 1;
  if (quote !== "USDT") return 1; // Every pair here is USDT-quoted; refuse to guess otherwise.

  const recorded = nearestRate(history, wallet, at);
  if (recorded === null) return wallet === "INR" ? FALLBACK_INR_PER_USDT : 1;
  return recorded;
}

/**
 * Units of `wallet` per 1 USDT at the moment nearest `at`, or null when the
 * ledger recorded nothing for that wallet.
 *
 * Null rather than a fallback on purpose: this is also what decides whether a
 * converted total gets to call itself exact, and a silent 100:1 substitution
 * would make an approximation indistinguishable from a measurement.
 */
function nearestRate(history: RateHistory, wallet: string, at: Date): number | null {
  const points = history.get(wallet);
  if (!points?.length) return null;
  const target = at.getTime();
  let nearest = points[0];
  for (const point of points) {
    if (Math.abs(point.at - target) < Math.abs(nearest.at - target)) nearest = point;
  }
  return nearest.perUsdt;
}

/**
 * What one unit of the wallet's currency was worth in each currency, so a trade
 * can be added to a base-currency total later at the rate that applied then.
 *
 * Both directions are stored because either currency can be the base. Only INR
 * and USDT are known here — an unrecognised wallet returns nulls, and
 * convertAmount() then reports the total as inexact rather than inventing a rate.
 */
function moneyRateFor(history: RateHistory, wallet: string, at: Date): MoneyRate | null {
  const inrPerUsdt = nearestRate(history, "INR", at);
  if (wallet === "USDT") return { inr: inrPerUsdt, usdt: 1 };
  if (wallet === "INR") return { inr: 1, usdt: inrPerUsdt ? 1 / inrPerUsdt : null };
  return null;
}

/**
 * The margin wallet encoded in a position key, for a trade reconciled before
 * `Trade.currency` existed.
 *
 * positionKey() is `instrument|currency|openedAt`, so the wallet is recoverable
 * exactly — no guess, no migration. Without this, a trade accepted last week
 * would have USDT numbers read as if they were already in the base currency,
 * which is the very bug this whole change exists to fix.
 */
export function currencyFromPositionKey(key: string): string | null {
  const parts = key.split("|");
  if (parts.length < 3) return null;
  return parts[1]?.trim().toUpperCase() || null;
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

  // How many units of each wallet currency one USDT was worth, over time. The
  // exchange stamps this on every ledger row (an INR row reads price_in_usdt
  // 0.010019, i.e. 1 USDT = 99.81 INR), so no FX feed is needed — and using the
  // rate NEAREST each fill keeps a year-old trade converted at the rate that
  // actually applied rather than today's.
  const rateHistory = buildRateHistory(storedLedger);

  const fills: Fill[] = storedFills.map((fill) => ({
    id: fill.id,
    instrument: fill.instrument,
    currency: fill.currency,
    quoteCurrency: quoteOf(fill),
    settlementRate: settlementRateFor(rateHistory, fill.currency, quoteOf(fill), fill.executedAt),
    moneyRate: moneyRateFor(rateHistory, fill.currency, fill.executedAt),
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
