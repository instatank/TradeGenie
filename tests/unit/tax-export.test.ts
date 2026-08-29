// The tax export: the financial-year boundary and the CSV cell contents.
//
// This output goes to a chartered accountant and is summed into a filing, so
// the failures worth pinning are the silent ones — a trade landing in the wrong
// year, a number Excel reads as text, a currency label on the wrong column.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Papa from "papaparse";

import {
  closedBefore,
  csvNumber,
  csvText,
  fillsTable,
  FILL_COLUMNS,
  istMidnight,
  istStamp,
  positionsTable,
  POSITION_COLUMNS,
} from "@/lib/tax-export";
import type { Fill, ReconstructedPosition } from "@/lib/positions";

function position(over: Partial<ReconstructedPosition> = {}): ReconstructedPosition {
  return {
    instrument: "SOL",
    currency: "INR",
    quoteCurrency: "USDT",
    moneyRate: { inr: 1, usdt: 0.010019036 },
    direction: "SHORT",
    openedAt: new Date("2026-02-11T02:00:00Z"),
    closedAt: new Date("2026-02-11T09:00:00Z"),
    status: "CLOSED",
    quantity: 4.67,
    entryPrice: 107.54,
    exitPrice: 104.8,
    closedQuantity: 4.67,
    grossPnl: 1277.1488,
    fees: 41.1018,
    funding: 0,
    netPnl: 1236.047,
    fillIds: ["f1", "f2"],
    fundingIds: [],
    ...over,
  };
}

const cell = (row: string[], column: string) => row[POSITION_COLUMNS.indexOf(column)];

describe("the financial-year boundary is IST, not UTC", () => {
  // India's FY ends 31 March 23:59:59 IST = 18:30 UTC. Every case below is one
  // a UTC-midnight comparison gets wrong.
  const cutoff = istMidnight("2026-04-01");

  it("puts the cutoff at 18:30 UTC on 31 March", () => {
    assert.equal(cutoff.toISOString(), "2026-03-31T18:30:00.000Z");
  });

  it("keeps a trade closed at 23:59 IST on 31 March inside the year", () => {
    assert.ok(closedBefore(position({ closedAt: new Date("2026-03-31T18:29:00Z") }), cutoff));
  });

  it("excludes a trade closed at 02:00 IST on 1 April — the case UTC gets wrong", () => {
    // 02:00 IST on 1 Apr is 20:30 UTC on 31 Mar. A UTC-midnight cutoff would
    // wrongly file this in the OLD year.
    assert.ok(!closedBefore(position({ closedAt: new Date("2026-03-31T20:30:00Z") }), cutoff));
  });

  it("never counts an open position — nothing is realized until it closes", () => {
    assert.ok(!closedBefore(position({ status: "OPEN", closedAt: null }), cutoff));
  });

  it("stamps IST wall-clock, not UTC", () => {
    assert.equal(istStamp(new Date("2026-03-31T18:29:00Z")), "2026-03-31 23:59:00");
  });
});

describe("numbers a spreadsheet can actually sum", () => {
  it("never emits exponential notation", () => {
    // String(1e-7) is "1e-7", which Excel imports as TEXT and then sums as zero.
    assert.equal(csvNumber(0.0000001), "0.0000001");
    assert.ok(!csvNumber(0.00000012345).includes("e"));
  });

  it("keeps the precision the exchange charged at, without trailing noise", () => {
    assert.equal(csvNumber(0.296304962), "0.296304962");
    assert.equal(csvNumber(14), "14");
  });

  it("leaves a negative sign alone", () => {
    // The formula guard must never touch numbers: quoting "-1277" would corrupt
    // the exact column being summed.
    assert.equal(csvNumber(-1277.15), "-1277.15");
    assert.equal(csvText("-1277.15"), "-1277.15");
  });

  it("blanks a missing value rather than writing 0", () => {
    // An absent exit price is not a zero exit price.
    assert.equal(csvNumber(null), "");
    assert.equal(csvNumber(Number.NaN), "");
  });

  it("defuses a leading formula character in exchange text", () => {
    assert.equal(csvText("=cmd()"), "'=cmd()");
    assert.equal(csvText("SOL"), "SOL");
  });
});

describe("the position rows", () => {
  const { data } = positionsTable([position()], () => false);
  const row = data[0];

  it("labels P&L with the WALLET and prices with the QUOTE currency", () => {
    // These are different facts. Conflating them made an INR-margined position
    // read ~100x too small once already, so the CSV keeps them in two columns.
    assert.equal(cell(row, "margin_account"), "INR");
    assert.equal(cell(row, "pnl_currency"), "INR");
    assert.equal(cell(row, "price_currency"), "USDT");
    assert.equal(cell(row, "entry_price"), "107.54");
  });

  it("carries both turnover bases as their own columns", () => {
    // Turnover is the sum of ABSOLUTE differences, so a loss adds to it exactly
    // as a win does. Giving the CA the absolutes directly means no formula of
    // theirs can get the sign convention wrong.
    assert.equal(cell(row, "abs_gross_pnl"), "1277.1488");
    assert.equal(cell(row, "abs_net_pnl"), "1236.047");
  });

  it("takes the absolute of a LOSS too", () => {
    const [loss] = positionsTable([position({ grossPnl: -500, netPnl: -540.5 })], () => false).data;
    assert.equal(cell(loss, "net_pnl"), "-540.5");
    assert.equal(cell(loss, "abs_net_pnl"), "540.5");
  });

  it("values the trade in the currency the price is quoted in", () => {
    // 107.54 x 4.67 = 502.2118 USDT. Rendering that as INR is the ~100x bug.
    assert.equal(cell(row, "entry_value"), "502.2118");
  });

  it("says when funding is missing rather than implying the net is complete", () => {
    const [flagged] = positionsTable([position()], () => true).data;
    assert.match(cell(flagged, "funding_data_complete"), /^no /);
    assert.equal(cell(row, "funding_data_complete"), "yes");
  });

  it("admits when the INR conversion used a fallback rate", () => {
    const [noRate] = positionsTable(
      [position({ currency: "USDT", moneyRate: null, netPnl: 13.66 })],
      () => false,
    ).data;
    assert.equal(cell(noRate, "fx_rate_is_exact"), "no");
    // Still converted, so the column is usable — just flagged as approximate.
    assert.equal(cell(noRate, "net_pnl_inr"), "1366");
  });

  it("keeps the exchange's fill ids so a row can be traced to the statement", () => {
    assert.equal(cell(row, "exchange_fill_ids"), "f1 f2");
  });
});

describe("the fills rows", () => {
  const fill: Fill = {
    id: "60c17b8d",
    instrument: "SOL",
    currency: "INR",
    quoteCurrency: "USDT",
    side: "BUY",
    quantity: 4.67,
    price: 107.54,
    fee: 0.296304962,
    timestamp: new Date("2026-02-11T02:00:00Z"),
    orderId: "27394361",
  };

  const fillCell = (row: string[], column: string) => row[FILL_COLUMNS.indexOf(column)];

  it("keeps the unrounded fee — the reason for importing at all", () => {
    const [row] = fillsTable([fill]).data;
    // The exchange's own UI shows this as "0.30".
    assert.equal(fillCell(row, "fee"), "0.296304962");
  });

  it("prices the execution in the quote currency, not the wallet", () => {
    const [row] = fillsTable([fill]).data;
    assert.equal(fillCell(row, "price_currency"), "USDT");
    assert.equal(fillCell(row, "fee_currency"), "USDT");
    assert.equal(fillCell(row, "margin_account"), "INR");
  });

  it("keeps the exchange's own ids for the audit trail", () => {
    const [row] = fillsTable([fill]).data;
    assert.equal(fillCell(row, "exchange_fill_id"), "60c17b8d");
    assert.equal(fillCell(row, "exchange_order_id"), "27394361");
  });
});

describe("the CSV actually round-trips", () => {
  it("survives a comma inside a field", () => {
    // The failure that hand-rolled joining always eventually hits.
    const table = positionsTable([position({ instrument: "A,B" })], () => false);
    const csv = Papa.unparse(table, { newline: "\r\n" });
    const parsed = Papa.parse<string[]>(csv.trim(), { newline: "\r\n" });
    assert.equal(parsed.data[1][POSITION_COLUMNS.indexOf("symbol")], "A,B");
  });

  it("emits a header row matching the declared columns", () => {
    const csv = Papa.unparse(positionsTable([position()], () => false), { newline: "\r\n" });
    assert.equal(csv.split("\r\n")[0], POSITION_COLUMNS.join(","));
  });
});
