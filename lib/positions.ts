// Fills → positions. Pure functions, no store, no network.
//
// The exchange does not know what a "trade" is. It knows about *fills*: forty
// rows saying "sold 0.099 ETH at 2512.00, fee 0.06". A journal trade is a
// **position** — the whole arc from the first unit opened to the last unit
// closed, with every scale-in, every scale-out, every fee and every funding
// payment that happened in between folded into it. Reconstructing that arc is
// the only real work in importing from an exchange, and it is identical no
// matter how the fills arrived (API, paste, CSV), which is why it lives here
// on its own rather than inside an exchange adapter.
//
// The rule the whole fold is built around: **a position is open while the
// running signed size is non-zero.** Size crossing zero closes it; a fill big
// enough to cross zero *and keep going* closes one position and opens another
// in the opposite direction (a flip), which is the case naive importers get
// wrong and then quietly report as one enormous trade.
//
// **Two currencies, and they are not the same one.** A pair like `B-SOL_USDT`
// is PRICED in USDT — that is the quote currency, and it is what entry, exit
// and the raw fee arrive in. Which wallet the money actually moves in is a
// separate fact: this trader runs both an INR and a USDT margin account, and an
// INR-margined SOL trade is still priced in USDT. Computing P&L from prices and
// then labelling it with the margin currency produced a number ~100x too small
// wearing an INR label — right by luck whenever the two happened to match, and
// silently wrong whenever they did not. So money derived from PRICES is scaled
// by `settlementRate` into the wallet's currency, funding (which the exchange
// already reports in the wallet's currency) is added as-is, and prices stay in
// the quote currency because a price converted to INR is unrecognisable.
//
// Two deliberate refusals:
//   - Nothing here rounds or "tidies" a number. The exchange UI shows fees to
//     2dp (a 106.75 USDT fill shows "0.06" for a true 0.0534); the whole point
//     of importing is to stop guessing, so we keep whatever precision we were
//     handed and let the caller decide how to display it.
//   - Funding that can't be attributed to a position is **returned, not
//     dropped**. Silently swallowing it would understate the cost of exactly
//     the trades that held longest, which are the ones funding actually hurts.

/** One execution as the exchange reports it. Quantity is always positive; the
 *  side carries the sign. Fee is a positive cost in the quote currency. */
export type Fill = {
  /** The exchange's own id for this fill — the dedupe key on re-import. */
  id: string;
  /** Whatever symbol the caller groups by. Normalizing the exchange's
   *  `B-ETH_USDT` to the journal's `ETH` is the adapter's job, not this file's. */
  instrument: string;
  /** The margin currency this fill settled in ("USDT", "INR", …).
   *  Positions are grouped by instrument AND currency: the same symbol traded
   *  in two margin accounts is two positions, and folding them together would
   *  net one against the other and corrupt both. Defaults to "" for callers
   *  with a single account, which groups exactly as before. */
  currency?: string;
  /** What `price` and `fee` are denominated in — the pair's quote currency
   *  ("USDT" for `B-SOL_USDT`). Distinct from `currency`, which is the wallet. */
  quoteCurrency?: string;
  /** How many units of the settlement wallet's currency one unit of the quote
   *  currency was worth at this fill (~99.81 for a USDT-priced trade settling
   *  in INR; 1 when the two are the same). Money derived from prices is scaled
   *  by this; prices themselves are not. Defaults to 1. */
  settlementRate?: number;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee: number;
  timestamp: Date;
  orderId?: string | null;
};

/** A funding payment. Signed: negative means it was charged to you, which is
 *  the usual case and the one that quietly eats a long hold. */
export type FundingEvent = {
  id: string;
  instrument: string;
  /** Must match the position's currency, for the same reason as Fill.currency. */
  currency?: string;
  amount: number;
  timestamp: Date;
};

export type ReconstructedPosition = {
  instrument: string;
  /** The wallet this settled in. `fees`, `grossPnl`, `funding` and `netPnl` are
   *  in THIS currency. */
  currency: string;
  /** What `entryPrice` and `exitPrice` are in — the pair's quote currency.
   *  Deliberately not converted: SOL at 104.80 is a price a trader recognises;
   *  the same price as 10,460 INR is not. */
  quoteCurrency: string;
  direction: "LONG" | "SHORT";
  openedAt: Date;
  /** null while the position is still open. */
  closedAt: Date | null;
  status: "OPEN" | "CLOSED";
  /** The largest size held at any point — what the trade was actually worth,
   *  not the sum of the fills, which double-counts a scale-in. */
  quantity: number;
  /** Volume-weighted average of the opening legs. */
  entryPrice: number;
  /** Volume-weighted average of the closing legs; null until something closes. */
  exitPrice: number | null;
  /** How much of the position has been closed so far. */
  closedQuantity: number;
  /** Realized P&L before costs, on the portion actually closed. */
  grossPnl: number;
  /** Every fee on every leg of this position, as a positive cost. */
  fees: number;
  /** Signed sum of funding while this position was open. */
  funding: number;
  /** grossPnl − fees + funding. The number that actually hit the account. */
  netPnl: number;
  fillIds: string[];
  fundingIds: string[];
};

export type ReconstructResult = {
  positions: ReconstructedPosition[];
  /** Funding that fell outside every position's window — reported so it can be
   *  looked at, never folded in silently. */
  unattributedFunding: FundingEvent[];
};

// Far below any real crypto order size (the smallest live increments are ~1e-8),
// and far above the float dust a long chain of adds and reduces leaves behind.
const SIZE_EPSILON = 1e-9;

type OpenPosition = {
  instrument: string;
  currency: string;
  quoteCurrency: string;
  sign: 1 | -1;
  openedAt: Date;
  size: number;
  peakSize: number;
  entryNotional: number;
  entryQuantity: number;
  exitNotional: number;
  exitQuantity: number;
  grossPnl: number;
  fees: number;
  fillIds: string[];
};

/**
 * Fold a flat list of fills into positions, then attribute funding to the
 * position that was open when each payment landed.
 *
 * Fills may arrive in any order and may repeat — the exchange's own pagination
 * overlaps, and a re-import of the same day is normal. Both are handled here so
 * no caller has to remember to.
 */
export function reconstructPositions(fills: Fill[], funding: FundingEvent[] = []): ReconstructResult {
  const ordered = dedupeById(fills).sort(compareFills);
  const open = new Map<string, OpenPosition>();
  const positions: ReconstructedPosition[] = [];

  for (const fill of ordered) {
    if (!(fill.quantity > SIZE_EPSILON)) continue;
    const sign: 1 | -1 = fill.side === "BUY" ? 1 : -1;
    // Into the wallet's currency. 1 when quote and wallet already agree, which
    // is every USDT-margined trade.
    const rate = fill.settlementRate ?? 1;
    // Fees are charged per fill but a single fill can span two positions on a
    // flip, so spread the fee over the units it actually paid for.
    const feePerUnit = (fill.fee * rate) / fill.quantity;
    let remaining = fill.quantity;

    const bookKey = positionKey(fill.instrument, fill.currency);

    while (remaining > SIZE_EPSILON) {
      let current = open.get(bookKey);

      if (!current) {
        current = {
          instrument: fill.instrument,
          currency: fill.currency ?? "",
          quoteCurrency: fill.quoteCurrency ?? fill.currency ?? "",
          sign,
          openedAt: fill.timestamp,
          size: 0,
          peakSize: 0,
          entryNotional: 0,
          entryQuantity: 0,
          exitNotional: 0,
          exitQuantity: 0,
          grossPnl: 0,
          fees: 0,
          fillIds: [],
        };
        open.set(bookKey, current);
      }

      if (current.sign === sign) {
        // Opening or adding to the position.
        applyFill(current, fill.id, remaining, feePerUnit);
        current.entryNotional += fill.price * remaining;
        current.entryQuantity += remaining;
        current.size += remaining;
        current.peakSize = Math.max(current.peakSize, current.size);
        remaining = 0;
        continue;
      }

      // Reducing. A fill larger than the position closes it and the leftover
      // loops round to open a fresh one the other way.
      const closing = Math.min(remaining, current.size);
      const entryVwap = current.entryNotional / current.entryQuantity;
      // Realized in the quote currency, then carried into the wallet at the
      // rate that applied when it was realized.
      current.grossPnl += (fill.price - entryVwap) * closing * current.sign * rate;
      current.exitNotional += fill.price * closing;
      current.exitQuantity += closing;
      current.size -= closing;
      applyFill(current, fill.id, closing, feePerUnit);
      remaining -= closing;

      if (current.size <= SIZE_EPSILON) {
        positions.push(finalize(current, fill.timestamp));
        open.delete(bookKey);
      }
    }
  }

  for (const current of open.values()) {
    positions.push(finalize(current, null));
  }

  positions.sort((a, b) => a.openedAt.getTime() - b.openedAt.getTime());
  const unattributedFunding = attributeFunding(positions, dedupeById(funding));
  for (const position of positions) {
    position.netPnl = position.grossPnl - position.fees + position.funding;
  }

  return { positions, unattributedFunding };
}

function applyFill(current: OpenPosition, fillId: string, quantity: number, feePerUnit: number) {
  current.fees += feePerUnit * quantity;
  if (!current.fillIds.includes(fillId)) current.fillIds.push(fillId);
}

function finalize(current: OpenPosition, closedAt: Date | null): ReconstructedPosition {
  const closed = closedAt !== null;
  return {
    instrument: current.instrument,
    currency: current.currency,
    quoteCurrency: current.quoteCurrency,
    direction: current.sign === 1 ? "LONG" : "SHORT",
    openedAt: current.openedAt,
    closedAt,
    status: closed ? "CLOSED" : "OPEN",
    quantity: current.peakSize,
    entryPrice: current.entryNotional / current.entryQuantity,
    exitPrice: current.exitQuantity > 0 ? current.exitNotional / current.exitQuantity : null,
    closedQuantity: current.exitQuantity,
    grossPnl: current.grossPnl,
    fees: current.fees,
    funding: 0,
    netPnl: 0,
    fillIds: current.fillIds,
    fundingIds: [],
  };
}

/**
 * Give each funding payment to the position that was open on that instrument
 * when it landed. Returns whatever found no home — usually a payment taken
 * while flat, or one timestamped a beat after the close.
 */
function attributeFunding(positions: ReconstructedPosition[], funding: FundingEvent[]): FundingEvent[] {
  const unattributed: FundingEvent[] = [];
  for (const event of funding) {
    const at = event.timestamp.getTime();
    const host = positions.find(
      (position) =>
        position.instrument === event.instrument &&
        position.currency === (event.currency ?? "") &&
        at >= position.openedAt.getTime() &&
        (position.closedAt === null || at <= position.closedAt.getTime()),
    );
    if (!host) {
      unattributed.push(event);
      continue;
    }
    host.funding += event.amount;
    host.fundingIds.push(event.id);
  }
  return unattributed;
}

/** One book per instrument per margin currency. */
function positionKey(instrument: string, currency: string | undefined): string {
  return `${instrument}\u0000${currency ?? ""}`;
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Map<string, T>();
  for (const item of items) {
    if (!seen.has(item.id)) seen.set(item.id, item);
  }
  return [...seen.values()];
}

// Timestamp first, then id — so a re-import of the same rows always folds to the
// same positions even when several fills share a millisecond.
function compareFills(a: Fill, b: Fill): number {
  return a.timestamp.getTime() - b.timestamp.getTime() || a.id.localeCompare(b.id);
}
