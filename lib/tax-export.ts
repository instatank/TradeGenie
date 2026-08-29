// The tax year, and the line items in it.
//
// Pure: no store, no network, no Response objects. The routes in
// app/api/tax-summary and app/api/tax-export only wire this up, for the same
// reason app/api/cron/sync-exchange keeps its logic in lib — a route cannot be
// unit-tested, and the arithmetic here is going to a chartered accountant.
//
// THE financial-year boundary lives here too. India's year runs 1 April to
// 31 March **in IST**, so the cutoff is 18:30 UTC the day before. That is not
// pedantry: a position closed at 02:00 IST on 1 April is 20:30 UTC on 31 March,
// and a UTC-midnight comparison files it in the wrong year. Both routes read it
// from here so the summary and the CSV can never disagree about which trades
// are in the period — the whole point of the CSV is that it is the evidence for
// the summary.

import { convertAmount } from "@/lib/currency";
import type { Fill, ReconstructedPosition } from "@/lib/positions";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Midnight IST on `iso` (YYYY-MM-DD), as a real instant. */
export function istMidnight(iso: string): Date {
  return new Date(new Date(`${iso}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

/** IST wall-clock, unambiguous and spreadsheet-friendly. */
export function istStamp(date: Date | null | undefined, seconds = true): string {
  if (!date) return "";
  const shifted = new Date(date.getTime() + IST_OFFSET_MS).toISOString().replace("T", " ");
  return seconds ? shifted.slice(0, 19) : shifted.slice(0, 16);
}

/**
 * A position is realized on its CLOSE — that is the taxable event, and so the
 * thing that decides which financial year it falls in. A position opened in
 * March and closed in April belongs to the NEXT year.
 */
export function closedBefore(position: ReconstructedPosition, cutoff: Date): boolean {
  return (
    position.status === "CLOSED" &&
    position.closedAt !== null &&
    position.closedAt.getTime() < cutoff.getTime()
  );
}

/**
 * A number as a spreadsheet will read it: full precision, never exponential.
 *
 * `String(1e-7)` is "1e-7", which Excel imports as text and then silently sums
 * as zero. Nothing here is rounded — this is a tax document, and the reason for
 * importing from the API rather than the exchange's own 2dp screen is to keep
 * the precision it actually charged at.
 */
export function csvNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "";
  const fixed = value.toFixed(10);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}

/**
 * Neutralise a leading spreadsheet formula character.
 *
 * Applied only to free text from the exchange (symbols, ids) — never to
 * numbers, because a negative P&L legitimately starts with "-" and quoting that
 * away would corrupt the very column being summed.
 */
export function csvText(value: string): string {
  return /^[=+@\t\r]/.test(value) ? `'${value}` : value;
}

export type CsvTable = { fields: string[]; data: string[][] };

export const POSITION_COLUMNS = [
  "sr_no",
  "opened_at_ist",
  "closed_at_ist",
  "symbol",
  "direction",
  "margin_account",
  "price_currency",
  "quantity",
  "closed_quantity",
  "entry_price",
  "exit_price",
  "entry_value",
  "exit_value",
  "gross_pnl",
  "fees",
  "funding",
  "net_pnl",
  "abs_gross_pnl",
  "abs_net_pnl",
  "pnl_currency",
  "fx_rate_to_inr",
  "net_pnl_inr",
  "abs_net_pnl_inr",
  "fx_rate_is_exact",
  "funding_data_complete",
  "exchange_fill_ids",
];

/**
 * One row per position closed before the cutoff — the turnover basis.
 *
 * Under the ICAI guidance note for derivatives, turnover is the sum of absolute
 * favourable and unfavourable differences: a loss adds to turnover exactly as a
 * win does. Hence `abs_gross_pnl` and `abs_net_pnl` as first-class columns
 * rather than something the CA has to derive with a formula they might get
 * wrong. Both bases ship because practice differs on whether trading costs come
 * out before the absolute is taken.
 */
export function positionsTable(
  positions: ReconstructedPosition[],
  fundingIncomplete: (position: ReconstructedPosition) => boolean,
): CsvTable {
  const data = positions.map((position, index) => {
    const wallet = position.currency || "";
    // A price times a quantity is in the currency the PRICE is quoted in, never
    // the wallet's. Conflating those two produced a ~100x error here once.
    const entryValue = position.entryPrice * position.closedQuantity;
    const exitValue = position.exitPrice == null ? null : position.exitPrice * position.closedQuantity;

    const toInr = convertAmount(position.netPnl, wallet, "INR", position.moneyRate);
    const rate = wallet.toUpperCase() === "INR" ? 1 : position.moneyRate?.inr ?? null;
    const inr = Number.isFinite(toInr.amount) ? toInr.amount : null;

    return [
      String(index + 1),
      istStamp(position.openedAt),
      istStamp(position.closedAt),
      csvText(position.instrument),
      position.direction,
      csvText(wallet),
      csvText(position.quoteCurrency || ""),
      csvNumber(position.quantity),
      csvNumber(position.closedQuantity),
      csvNumber(position.entryPrice),
      csvNumber(position.exitPrice),
      csvNumber(entryValue),
      csvNumber(exitValue),
      csvNumber(position.grossPnl),
      csvNumber(position.fees),
      csvNumber(position.funding),
      csvNumber(position.netPnl),
      csvNumber(Math.abs(position.grossPnl)),
      csvNumber(Math.abs(position.netPnl)),
      csvText(wallet),
      csvNumber(rate),
      csvNumber(inr),
      csvNumber(inr === null ? null : Math.abs(inr)),
      toInr.exact ? "yes" : "no",
      fundingIncomplete(position) ? "no (pre-ledger: funding unavailable from exchange)" : "yes",
      csvText(position.fillIds.join(" ")),
    ];
  });

  return { fields: POSITION_COLUMNS, data };
}

export const FILL_COLUMNS = [
  "sr_no",
  "executed_at_ist",
  "symbol",
  "side",
  "quantity",
  "price",
  "price_currency",
  "value",
  "fee",
  "fee_currency",
  "margin_account",
  "exchange_fill_id",
  "exchange_order_id",
];

/** One row per individual execution — the audit trail back to the statement. */
export function fillsTable(fills: Fill[]): CsvTable {
  const data = fills.map((fill, index) => {
    // Price, value and fee are all in the pair's QUOTE currency; the margin
    // account is a separate column precisely so the two are never read as one.
    const quote = fill.quoteCurrency ?? "";
    return [
      String(index + 1),
      istStamp(fill.timestamp),
      csvText(fill.instrument),
      fill.side,
      csvNumber(fill.quantity),
      csvNumber(fill.price),
      csvText(quote),
      csvNumber(fill.price * fill.quantity),
      csvNumber(fill.fee),
      csvText(quote),
      csvText(fill.currency ?? ""),
      csvText(fill.id),
      csvText(fill.orderId ?? ""),
    ];
  });

  return { fields: FILL_COLUMNS, data };
}
