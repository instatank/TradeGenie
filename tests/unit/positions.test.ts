// Reconstructing positions from fills. This is the piece that decides what a
// trade *was*, so the cases pinned here are the ones that would quietly corrupt
// the journal rather than throw: a flip counted as one huge trade, a scale-in
// double-counted as size, funding attached to the wrong position, and a
// re-import creating a second copy of a day.
//
// The ETH and ZEC numbers are the owner's real fills, read off the exchange's
// Trades tab — same reasoning as the calculator pinning his own worked example.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reconstructPositions, type Fill, type FundingEvent } from "@/lib/positions";

function fill(id: string, instrument: string, side: "BUY" | "SELL", quantity: number, price: number, fee: number, iso: string): Fill {
  return { id, instrument, side, quantity, price, fee, timestamp: new Date(iso) };
}

// A VWAP is notional ÷ quantity, so even a single-fill position lands a few ulps
// off the fill price. Compare like money, not like integers.
function closeTo(actual: number, expected: number, tolerance = 1e-9) {
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );
}

// The complete ZEC long from the Trades tab: bought 26 Aug, sold out 27 Aug.
const ZEC_ROUND_TRIP = [
  fill("z1", "ZEC", "BUY", 0.649, 771.5, 0.12, "2026-08-26T19:19:39Z"),
  fill("z2", "ZEC", "SELL", 0.649, 795.2, 0.12, "2026-08-27T03:45:55Z"),
];

// The ETH short being scaled into across five fills, still open on that page.
const ETH_SCALE_IN = [
  fill("e1", "ETH", "SELL", 0.202, 2438.0, 0.12, "2026-08-26T20:37:38Z"),
  fill("e2", "ETH", "SELL", 0.101, 2474.85, 0.06, "2026-08-27T00:56:26Z"),
  fill("e3", "ETH", "SELL", 0.201, 2484.0, 0.12, "2026-08-27T02:38:12Z"),
  fill("e4", "ETH", "SELL", 0.099, 2512.0, 0.06, "2026-08-27T03:49:00Z"),
  fill("e5", "ETH", "SELL", 0.007, 2553.12, 0.01, "2026-08-27T14:58:23Z"),
];

describe("reconstructPositions", () => {
  it("folds a real round trip into one closed position", () => {
    const { positions } = reconstructPositions(ZEC_ROUND_TRIP);
    assert.equal(positions.length, 1);
    const [zec] = positions;
    assert.equal(zec.instrument, "ZEC");
    assert.equal(zec.direction, "LONG");
    assert.equal(zec.status, "CLOSED");
    assert.equal(zec.quantity, 0.649);
    closeTo(zec.entryPrice, 771.5);
    closeTo(zec.exitPrice ?? NaN, 795.2);
    // (795.20 − 771.50) × 0.649
    closeTo(zec.grossPnl, 15.3813);
    closeTo(zec.fees, 0.24);
    closeTo(zec.netPnl, 15.3813 - 0.24);
    assert.deepEqual(zec.fillIds, ["z1", "z2"]);
  });

  it("treats a scale-in as one position at peak size, not the sum of the fills", () => {
    const { positions } = reconstructPositions(ETH_SCALE_IN);
    assert.equal(positions.length, 1);
    const [eth] = positions;
    assert.equal(eth.direction, "SHORT");
    assert.equal(eth.status, "OPEN");
    assert.equal(eth.closedAt, null);
    closeTo(eth.quantity, 0.61);
    // Volume-weighted, not the mean of the five prices (which would be 2492.39).
    // The notional is 1508.27969 — note 0.101 × 2474.85 is 249.95985, which the
    // exchange's own UI displays as "249.96". Rounded inputs are exactly what
    // importing is meant to stop, so the expectation uses the real figure.
    closeTo(eth.entryPrice, 1508.27969 / 0.61);
    assert.equal(eth.exitPrice, null);
    assert.equal(eth.closedQuantity, 0);
    assert.equal(eth.grossPnl, 0);
    closeTo(eth.fees, 0.37);
  });

  it("splits a flip into two positions and shares the fill's fee between them", () => {
    // Long 1, then sell 2: closes the long AND opens a short of 1.
    const { positions } = reconstructPositions([
      fill("f1", "SOL", "BUY", 1, 100, 0.1, "2026-08-27T01:00:00Z"),
      fill("f2", "SOL", "SELL", 2, 110, 0.2, "2026-08-27T02:00:00Z"),
    ]);
    assert.equal(positions.length, 2);
    const [long, short] = positions;

    assert.equal(long.direction, "LONG");
    assert.equal(long.status, "CLOSED");
    assert.equal(long.quantity, 1);
    assert.equal(long.grossPnl, 10);
    // 0.10 opening + half of the 0.20 closing fill.
    closeTo(long.fees, 0.2);

    assert.equal(short.direction, "SHORT");
    assert.equal(short.status, "OPEN");
    assert.equal(short.quantity, 1);
    assert.equal(short.entryPrice, 110);
    closeTo(short.fees, 0.1);
  });

  it("keeps a partial close open and records what has been closed so far", () => {
    const { positions } = reconstructPositions([
      fill("p1", "BTC", "BUY", 1, 100, 0, "2026-08-27T01:00:00Z"),
      fill("p2", "BTC", "SELL", 0.4, 120, 0, "2026-08-27T02:00:00Z"),
    ]);
    assert.equal(positions.length, 1);
    const [btc] = positions;
    assert.equal(btc.status, "OPEN");
    assert.equal(btc.quantity, 1);
    assert.equal(btc.closedQuantity, 0.4);
    assert.equal(btc.exitPrice, 120);
    closeTo(btc.grossPnl, 8);
  });

  it("gives funding to the position that was open when it landed", () => {
    const fills = [
      fill("a1", "ZEC", "BUY", 1, 700, 0, "2026-08-24T10:00:00Z"),
      fill("a2", "ZEC", "SELL", 1, 710, 0, "2026-08-24T22:59:17Z"),
      ...ZEC_ROUND_TRIP,
    ];
    const funding: FundingEvent[] = [
      { id: "fund-early", instrument: "ZEC", amount: -0.09, timestamp: new Date("2026-08-24T13:30:07Z") },
      { id: "fund-late", instrument: "ZEC", amount: -0.08, timestamp: new Date("2026-08-26T21:30:08Z") },
      // Charged while flat — belongs to neither.
      { id: "fund-orphan", instrument: "ZEC", amount: -0.05, timestamp: new Date("2026-08-25T21:30:08Z") },
    ];

    const { positions, unattributedFunding } = reconstructPositions(fills, funding);
    assert.equal(positions.length, 2);
    const [first, second] = positions;

    closeTo(first.funding, -0.09);
    assert.deepEqual(first.fundingIds, ["fund-early"]);
    closeTo(second.funding, -0.08);
    assert.deepEqual(second.fundingIds, ["fund-late"]);

    // Reported, never folded in silently.
    assert.deepEqual(unattributedFunding.map((event) => event.id), ["fund-orphan"]);
  });

  it("folds funding into net P&L, so a long hold costs what it actually cost", () => {
    const { positions } = reconstructPositions(ZEC_ROUND_TRIP, [
      { id: "f", instrument: "ZEC", amount: -0.5, timestamp: new Date("2026-08-26T21:30:00Z") },
    ]);
    closeTo(positions[0].netPnl, 15.3813 - 0.24 - 0.5);
  });

  it("is idempotent — re-importing the same rows cannot duplicate a position", () => {
    const once = reconstructPositions(ZEC_ROUND_TRIP);
    const twice = reconstructPositions([...ZEC_ROUND_TRIP, ...ZEC_ROUND_TRIP]);
    assert.deepEqual(twice.positions, once.positions);
  });

  it("does not care what order the fills arrive in", () => {
    const shuffled = [...ETH_SCALE_IN].reverse();
    assert.deepEqual(reconstructPositions(shuffled).positions, reconstructPositions(ETH_SCALE_IN).positions);
  });

  it("keeps instruments apart", () => {
    const { positions } = reconstructPositions([...ZEC_ROUND_TRIP, ...ETH_SCALE_IN]);
    assert.deepEqual(positions.map((position) => position.instrument).sort(), ["ETH", "ZEC"]);
  });

  it("does not leave a position open on float dust", () => {
    const { positions } = reconstructPositions([
      fill("d1", "HYPE", "BUY", 0.1, 80, 0, "2026-08-27T01:00:00Z"),
      fill("d2", "HYPE", "BUY", 0.2, 80, 0, "2026-08-27T02:00:00Z"),
      fill("d3", "HYPE", "SELL", 0.3, 83, 0, "2026-08-27T03:00:00Z"),
    ]);
    assert.equal(positions.length, 1);
    assert.equal(positions[0].status, "CLOSED");
  });
});
