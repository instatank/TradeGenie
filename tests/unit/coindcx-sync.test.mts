// exchangeView() against a real store.
//
// The pure fold is covered in positions.test.ts and the join in
// reconcile.test.ts. What neither can reach is the seam between them: reading
// stored rows back out, rebuilding Fills and FundingEvents from them, and
// deciding which positions predate the ledger. That seam is where a renamed
// field or a Date that came back as a string would break everything quietly,
// and it can only be tested against an actual store.
//
// Uses TRADEGENIE_LOCAL_STORE like store.test.mts, so it runs against the real
// persistence path rather than a mock of it.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

const scratch = mkdtempSync(path.join(tmpdir(), "tradegenie-sync-"));
process.env.TRADEGENIE_LOCAL_STORE = path.join(scratch, "store.json");
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

const { exchangeView, positionKey } = await import("@/lib/coindcx-sync");
const { createRecord } = await import("@/lib/store");

const LEDGER_START = new Date("2026-08-20T00:00:00Z");

before(async () => {
  // A complete ETH round trip, inside the ledger window.
  await createRecord("exchangeFills", {
    id: "f1", createdAt: new Date(), source: "coindcx", instrument: "ETH", currency: "USDT",
    side: "BUY", quantity: 0.5, price: 2484, fee: 0.12,
    executedAt: new Date("2026-08-25T02:00:00Z"), orderId: "o1",
  });
  await createRecord("exchangeFills", {
    id: "f2", createdAt: new Date(), source: "coindcx", instrument: "ETH", currency: "USDT",
    side: "SELL", quantity: 0.5, price: 2512, fee: 0.13,
    executedAt: new Date("2026-08-25T06:00:00Z"), orderId: "o2",
  });
  // Funding charged while that position was open.
  await createRecord("exchangeLedger", {
    id: "l1", createdAt: new Date(), source: "coindcx", instrument: "ETH", currency: "USDT",
    stage: "funding", kind: "FUNDING", amount: -0.09, fee: 0,
    positionId: "p1", orderId: null, rateInr: 99.88, rateUsdt: 1,
    occurredAt: new Date("2026-08-25T04:00:00Z"),
  });
  // A ledger row that marks where the ledger begins.
  await createRecord("exchangeLedger", {
    id: "l2", createdAt: new Date(), source: "coindcx", instrument: "ETH", currency: "USDT",
    stage: "default", kind: "EXIT", amount: 13.7, fee: 0.13,
    positionId: "p1", orderId: "o2", rateInr: 99.88, rateUsdt: 1,
    occurredAt: LEDGER_START,
  });
  // An OLD position, opened before the ledger reaches back to. Its fees are
  // exact but its funding is unknowable, and it must be reported as such.
  await createRecord("exchangeFills", {
    id: "f3", createdAt: new Date(), source: "coindcx", instrument: "BTC", currency: "USDT",
    side: "BUY", quantity: 0.01, price: 90000, fee: 0.45,
    executedAt: new Date("2026-02-01T10:00:00Z"), orderId: "o3",
  });
  await createRecord("exchangeFills", {
    id: "f4", createdAt: new Date(), source: "coindcx", instrument: "BTC", currency: "USDT",
    side: "SELL", quantity: 0.01, price: 91000, fee: 0.46,
    executedAt: new Date("2026-02-01T14:00:00Z"), orderId: "o4",
  });
});

after(() => rmSync(scratch, { recursive: true, force: true }));

describe("fills stored before quoteCurrency existed", () => {
  // The exact production situation: 425 fills written by an earlier sync, none
  // carrying a price currency, and an idempotent sync that skips ids it already
  // holds and so would never have repaired them. A blank quote currency
  // silently disabled the conversion AND made prices render with the wallet's
  // label — the ~100x INR bug returning purely as a data-migration gap.
  before(async () => {
    await createRecord("exchangeFills", {
      id: "legacy-1", createdAt: new Date(), source: "coindcx", instrument: "SOL", currency: "INR",
      side: "SELL", quantity: 4.67, price: 104.8, fee: 0.2,
      executedAt: new Date("2026-08-25T13:45:00Z"), orderId: "lo1",
      quoteCurrency: "",
    });
    await createRecord("exchangeFills", {
      id: "legacy-2", createdAt: new Date(), source: "coindcx", instrument: "SOL", currency: "INR",
      side: "BUY", quantity: 4.67, price: 107.54, fee: 0.211807,
      executedAt: new Date("2026-08-25T16:00:00Z"), orderId: "lo2",
      quoteCurrency: "",
    });
  });

  it("still converts into the wallet, without needing a re-sync", async () => {
    const sol = (await exchangeView()).positions.find((position) => position.instrument === "SOL");
    assert.ok(sol, "expected the legacy SOL position");
    assert.equal(sol.quoteCurrency, "USDT", "a blank price currency must default, not stay blank");

    // (104.80 - 107.54) x 4.67 = -12.7958 USDT. Anything near -12.8 means the
    // conversion silently did not happen.
    assert.ok(sol.grossPnl < -1200, `gross should be ~-1277 INR, got ${sol.grossPnl}`);
    assert.ok(sol.grossPnl > -1350, `gross should be ~-1277 INR, got ${sol.grossPnl}`);
    assert.ok(sol.fees > 30 && sol.fees < 50, `fees should be ~41 INR, got ${sol.fees}`);
  });

  it("keeps the price in the currency it was quoted in", async () => {
    const sol = (await exchangeView()).positions.find((position) => position.instrument === "SOL");
    // 104.80 is what a trader recognises. 10,460 INR is not.
    assert.ok(Math.abs((sol?.entryPrice ?? 0) - 104.8) < 1e-9);
  });
});

describe("exchangeView", () => {
  it("rebuilds positions from stored rows, with funding folded in", async () => {
    const view = await exchangeView();
    const eth = view.positions.find((position) => position.instrument === "ETH");
    assert.ok(eth, "expected an ETH position");
    assert.equal(eth.status, "CLOSED");
    assert.equal(eth.direction, "LONG");
    assert.equal(eth.currency, "USDT");
    // (2512 - 2484) * 0.5 = 14 gross, minus 0.25 fees, minus 0.09 funding.
    assert.ok(Math.abs(eth.grossPnl - 14) < 1e-9);
    assert.ok(Math.abs(eth.fees - 0.25) < 1e-9);
    assert.ok(Math.abs(eth.funding - -0.09) < 1e-9);
    assert.ok(Math.abs(eth.netPnl - (14 - 0.25 - 0.09)) < 1e-9);
  });

  it("survives the round trip through storage with real Dates", async () => {
    // hydrate() turns any key ending in "At" back into a Date. If that ever
    // stopped working these would be strings and every comparison downstream
    // would silently misbehave rather than throw.
    const view = await exchangeView();
    for (const position of view.positions) {
      assert.ok(position.openedAt instanceof Date, "openedAt must be a Date");
      assert.ok(!Number.isNaN(position.openedAt.getTime()), "openedAt must be valid");
    }
  });

  it("names the positions whose funding is unknowable, rather than implying completeness", async () => {
    const view = await exchangeView();
    const missing = view.positionsMissingFunding.map((position) => position.instrument);
    assert.deepEqual(missing, ["BTC"], "the pre-ledger BTC position should be flagged");
    assert.equal(view.ledgerFrom?.toISOString(), LEDGER_START.toISOString());
  });

  it("gives every position a key that survives a re-read", async () => {
    const first = (await exchangeView()).positions.map(positionKey);
    const second = (await exchangeView()).positions.map(positionKey);
    assert.deepEqual(first, second);
    assert.equal(new Set(first).size, first.length, "keys must be unique");
  });
});
