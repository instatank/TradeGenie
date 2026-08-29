// Matching what the exchange did against what you wrote down.
//
// The journal and the exchange record the same trade from two ends. You log at
// entry, in your own words, approximately. The exchange knows the exact prices,
// the real fees and the funding — but nothing about why. Reconciling means
// joining them without either side overwriting what the other is authoritative
// about.
//
// The rules that follow from that, and which the rest of this file enforces:
//
//   - The exchange owns the NUMBERS. Entry, exit, size, fees, funding, P&L.
//   - You own the WORDS, and everything judgemental: thesis, mind state, setup,
//     mechanisms, grade, mistakes, lesson, tags. Nothing here ever writes those.
//   - A position you never journaled is NOT silently turned into a trade. It is
//     surfaced so you can log it. Auto-creating trades would remove the reason
//     the journal exists, which is the habit of writing down why. The one
//     deliberate exception is archiveTradeRecord() at the foot of this file:
//     a back catalogue from before the journal existed, logged only when the
//     trader explicitly asks, with every subjective field left empty and the
//     record flagged as never-journaled. It is opt-in and it never runs during
//     a sync.
//
// Pure and store-free, so the matching can be tested without a network or a
// database — the same reasoning as lib/calculator.ts and lib/positions.ts.

import type { ReconstructedPosition } from "@/lib/positions";
import type { Trade } from "@/lib/types";

/**
 * How far apart a logged trade and an exchange position may sit and still be
 * the same trade. You normally log within minutes of entering, but writing up
 * the evening after is normal too, and a trade taken late at night gets
 * journaled the next morning. 36 hours covers that without being so wide that
 * two separate swings at the same symbol blur together.
 */
export const MATCH_WINDOW_HOURS = 36;

const MATCH_WINDOW_MS = MATCH_WINDOW_HOURS * 60 * 60 * 1000;

export type Match = {
  position: ReconstructedPosition;
  trade: Trade;
  /** How far apart the two entry times were, in minutes. Shown so a match that
   *  looks wrong can be judged rather than just trusted. */
  minutesApart: number;
  /** True when the trade already carries this position's key — an established
   *  link, not a fresh guess. */
  confirmed: boolean;
};

export type MatchResult = {
  matches: Match[];
  /** Exchange positions with no journal entry. These become the Today nudge —
   *  never an auto-created trade. */
  unmatched: ReconstructedPosition[];
};

function sameDirection(position: ReconstructedPosition, trade: Trade): boolean {
  return position.direction === trade.direction;
}

/**
 * Join exchange positions to journal trades.
 *
 * An existing link always wins: once a trade carries a position's key, that
 * pairing is settled and no proximity heuristic gets to second-guess it.
 * Everything else is matched nearest-in-time first, so when two candidates
 * compete for one trade the closer one takes it and the other is reported
 * unmatched rather than both quietly claiming it.
 */
export function matchPositions(positions: ReconstructedPosition[], trades: Trade[], keyOf: (position: ReconstructedPosition) => string): MatchResult {
  const matches: Match[] = [];
  const unmatched: ReconstructedPosition[] = [];
  const claimedTradeIds = new Set<string>();

  const byKey = new Map<string, Trade>();
  for (const trade of trades) {
    if (trade.exchangeKey) byKey.set(trade.exchangeKey, trade);
  }

  // Established links first, so they can't be stolen by a closer stranger.
  const stillLoose: ReconstructedPosition[] = [];
  for (const position of positions) {
    const linked = byKey.get(keyOf(position));
    if (!linked) {
      stillLoose.push(position);
      continue;
    }
    claimedTradeIds.add(linked.id);
    matches.push({
      position,
      trade: linked,
      minutesApart: minutesBetween(position.openedAt, linked.tradeDateTime),
      confirmed: true,
    });
  }

  // Then proposals, best-first across all candidates rather than per position,
  // so the order positions happen to arrive in cannot change the outcome.
  //
  // Bucketed by symbol rather than compared as a full cross product: only a
  // same-symbol pair can ever match. Measured at 3x the real account (640
  // positions x 200 trades), the cross product cost 12.2ms median and this
  // costs 2.1ms — worth doing because Today renders in ~9ms total, so the naive
  // version would have more than doubled the one page with a 60-second budget.
  type Proposal = { position: ReconstructedPosition; trade: Trade; distance: number };
  const proposals: Proposal[] = [];
  const bySymbol = new Map<string, Trade[]>();
  for (const trade of trades) {
    if (trade.exchangeKey) continue;
    const symbol = trade.instrument.trim().toUpperCase();
    const bucket = bySymbol.get(symbol);
    if (bucket) bucket.push(trade);
    else bySymbol.set(symbol, [trade]);
  }

  for (const position of stillLoose) {
    for (const trade of bySymbol.get(position.instrument.trim().toUpperCase()) ?? []) {
      if (!sameDirection(position, trade)) continue;
      const distance = Math.abs(position.openedAt.getTime() - trade.tradeDateTime.getTime());
      if (distance > MATCH_WINDOW_MS) continue;
      proposals.push({ position, trade, distance });
    }
  }
  proposals.sort((a, b) => a.distance - b.distance);

  const takenPositions = new Set<ReconstructedPosition>();
  for (const proposal of proposals) {
    if (takenPositions.has(proposal.position)) continue;
    if (claimedTradeIds.has(proposal.trade.id)) continue;
    takenPositions.add(proposal.position);
    claimedTradeIds.add(proposal.trade.id);
    matches.push({
      position: proposal.position,
      trade: proposal.trade,
      minutesApart: Math.round(proposal.distance / 60000),
      confirmed: false,
    });
  }

  for (const position of stillLoose) {
    if (!takenPositions.has(position)) unmatched.push(position);
  }

  return { matches, unmatched };
}

function minutesBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / 60000);
}

export type FieldDiff = {
  field: keyof Trade;
  label: string;
  logged: number | null;
  exchange: number | null;
  /** True when accepting would actually change the stored value. */
  changed: boolean;
  /**
   * What this row is measured in. Deliberately per-row, because a single
   * position mixes three: prices in the quote currency, money in the settlement
   * wallet, and quantity in units of the coin — which is not a currency at all.
   * Labelling a quantity of 4.67 SOL as "4.670 INR" is how a unit bug hides.
   */
  unit: string;
};

// Below this, two numbers are the same number wearing different rounding.
const SAME = 1e-9;

function differs(logged: number | null, exchange: number | null): boolean {
  if (exchange === null) return false;
  if (logged === null) return true;
  return Math.abs(logged - exchange) > SAME;
}

/**
 * What accepting the exchange's version would change.
 *
 * Only the objective columns appear here — this is the list of fields the
 * exchange is allowed to touch, and it is deliberately short. A field absent
 * from it can never be written by a sync, which is what keeps the journal's
 * subjective half safe by construction rather than by care.
 */
export function diffTrade(trade: Trade, position: ReconstructedPosition): FieldDiff[] {
  const price = position.quoteCurrency || position.currency;
  const money = position.currency;
  const size = position.instrument;

  const rows: Array<[keyof Trade, string, number | null, number | null, string]> = [
    ["entryPrice", "Entry price", trade.entryPrice, position.entryPrice, price],
    ["exitPrice", "Exit price", trade.exitPrice, position.exitPrice, price],
    ["quantity", "Quantity", trade.quantity, position.quantity, size],
    ["fees", "Fees", trade.fees, position.fees, money],
    ["funding", "Funding", trade.funding, position.funding, money],
    ["realizedPnl", "Realized P&L (gross)", trade.realizedPnl, position.status === "CLOSED" ? position.grossPnl : null, money],
    ["netPnl", "Net P&L (after costs)", trade.netPnl, position.status === "CLOSED" ? position.netPnl : null, money],
  ];

  return rows.map(([field, label, logged, exchange, unit]) => ({
    field,
    label,
    logged,
    exchange,
    changed: differs(logged, exchange),
    unit,
  }));
}

/**
 * Would accepting this match close a trade the journal still shows as open?
 *
 * This is the single most consequential thing an accept can do — it is how a
 * position closed on the exchange days ago finally gets closed in the journal —
 * and it is not a number, so it cannot live in diffTrade(). It gets its own
 * function so the card can SAY it will happen rather than doing it quietly
 * underneath a table of prices.
 */
export function willCloseTrade(match: Match): boolean {
  return match.position.status === "CLOSED" && match.trade.status !== "CLOSED";
}

/** Just the fields worth writing — the ones that would actually change. */
export function changedFields(diff: FieldDiff[]): FieldDiff[] {
  return diff.filter((row) => row.changed);
}

/**
 * Fields an accept may write that are NOT numbers from the diff.
 *
 * The structural guarantee is "a field absent from diffTrade cannot be written
 * by a sync", and these are the deliberate, named exceptions: the link itself,
 * the status the exchange is authoritative about, and the provenance that says
 * what the numbers just written are denominated in. Naming them here rather
 * than letting them accrete is what keeps the guarantee checkable — a test
 * asserts an accept patch touches nothing outside diffTrade ∪ this set.
 */
export const PROVENANCE_FIELDS = ["exchangeKey", "status", "currency", "moneyRate"] as const;

/**
 * The patch to apply when a match is accepted.
 *
 * Built only from the diff, so it can never contain a field diffTrade does not
 * list. Status follows the exchange too: a position the exchange shows closed
 * is closed, whatever the journal still says.
 *
 * The currency and rate ride along with the numbers because they are part of
 * what the numbers MEAN. A stored 13.21 is meaningless on its own once two
 * margin accounts exist; 13.21 USDT at 99.81 INR/USDT is a fact that can still
 * be added to an INR total correctly in a year's time.
 */
export function acceptPatch(match: Match, key: string): Partial<Trade> {
  const patch: Partial<Trade> = {
    exchangeKey: key,
    currency: match.position.currency || null,
    moneyRate: match.position.moneyRate ?? null,
  };
  for (const row of changedFields(diffTrade(match.trade, match.position))) {
    if (row.exchange === null) continue;
    (patch as Record<string, unknown>)[row.field] = row.exchange;
  }
  if (willCloseTrade(match)) patch.status = "CLOSED";
  return patch;
}

/**
 * Fields an archive log writes that are neither numbers from the diff nor
 * provenance: what the trade WAS. An exchange position knows the symbol, the
 * side, and when it opened, and those are facts about the trade rather than
 * judgements about it — so they are named here for the same reason
 * PROVENANCE_FIELDS is, and a test asserts an archived record touches nothing
 * outside diffTrade ∪ PROVENANCE_FIELDS ∪ this set ∪ the record's own
 * bookkeeping (id / createdAt / updatedAt / marketType).
 */
export const ARCHIVE_IDENTITY_FIELDS = ["instrument", "direction", "tradeDateTime", "reconstructed"] as const;

/**
 * Every field on a Trade that carries the trader's own judgement or words. An
 * archived position has none of them, and a test asserts each one comes back
 * empty — which is what makes "the exchange never writes your words" checkable
 * on the create path as well as on the update path.
 */
export const SUBJECTIVE_FIELDS = [
  "setupName",
  "setupId",
  "entryThesis",
  "invalidation",
  "concern",
  "premortem",
  "conditions",
  "timeframes",
  "mechanisms",
  "checklistSteps",
  "emotionalState",
  "riskPosture",
  "confidenceScore",
  "exitReason",
  "followedPlan",
  "lesson",
  "notes",
  "tags",
] as const;

/**
 * An exchange position, as a journal trade with nothing invented.
 *
 * This is the deliberate exception to "nothing auto-creates a trade", and it
 * exists for exactly one situation: a back catalogue of trades taken before the
 * journal was being kept. The habit this app protects is writing down WHY, and
 * for a trade from eight months ago that why is gone — it was never recorded
 * and cannot be recovered by pretending. Refusing to store the trade does not
 * bring the reasoning back; it just leaves the P&L history incomplete too.
 *
 * So the archive path stores the half that survives and is honest about the
 * half that doesn't:
 *
 *   - Every number comes from diffTrade(), the same short list the sync is
 *     allowed to touch. Nothing else can be written, by construction.
 *   - Every subjective field is left empty. Not "NA", not a placeholder
 *     sentence, not a machine-minted tag — empty, because nothing was thought.
 *   - `reconstructed: true` records that this trade was never journaled, so the
 *     review nudge and the process score skip it rather than treating a missing
 *     plan as an unreviewed one (see lib/metrics.ts).
 *   - `marketContext` is null. The bridge captures what the market looked like
 *     AT ENTRY; snapshotting today's market onto a trade from March would be a
 *     fabrication wearing a timestamp.
 *   - Status follows the exchange. A position still open on the exchange is
 *     logged OPEN, and the ordinary mechanic — you close it, the sync fills in
 *     the exit — takes over from there.
 *
 * `createdAt` is now, not the trade's date: the record really was created
 * today, and back-dating it would credit the journaling streak with days the
 * trader did not show up. `tradeDateTime` is when the position opened, which is
 * what every list, calendar and analytic actually files a trade by.
 */
export function archiveTradeRecord(
  position: ReconstructedPosition,
  key: string,
  context: { marketType: Trade["marketType"]; now: Date },
): Omit<Trade, "id"> {
  const blank = { entryPrice: null, exitPrice: null, quantity: null, fees: null, funding: null, realizedPnl: null, netPnl: null } as Trade;
  const numbers: Partial<Trade> = {};
  for (const row of diffTrade(blank, position)) {
    if (row.exchange === null) continue;
    (numbers as Record<string, unknown>)[row.field] = row.exchange;
  }

  return {
    createdAt: context.now,
    updatedAt: context.now,
    tradeDateTime: position.openedAt,
    marketType: context.marketType,
    instrument: position.instrument,
    direction: position.direction,
    status: position.status === "CLOSED" ? "CLOSED" : "OPEN",
    reconstructed: true,
    exchangeKey: key,
    currency: position.currency || null,
    moneyRate: position.moneyRate ?? null,

    // Not in the diff and not knowable from fills: a stop and a target are
    // plan, not execution, and leverage is a margin setting the fills don't
    // report. Left null rather than back-solved from anything.
    stopPrice: null,
    targetPrice: null,
    maePrice: null,
    mfePrice: null,
    totalOrderValue: null,
    leverage: null,
    // R is measured against the stop that was planned. There wasn't one.
    rMultiple: null,
    marketContext: null,

    // Nothing was written down. Nothing gets written down now.
    setupName: null,
    setupId: null,
    entryThesis: null,
    invalidation: null,
    concern: null,
    premortem: null,
    conditions: [],
    timeframes: [],
    mechanisms: [],
    checklistSteps: [],
    emotionalState: null,
    riskPosture: null,
    confidenceScore: null,
    entryGrade: "NA",
    exitReason: null,
    followedPlan: null,
    lesson: null,
    notes: null,
    tags: [],

    entryPrice: null,
    exitPrice: null,
    quantity: null,
    fees: null,
    funding: null,
    realizedPnl: null,
    netPnl: null,
    ...numbers,
  };
}
