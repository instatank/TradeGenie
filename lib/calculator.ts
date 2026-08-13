// The trade profitability math. Pure functions, no React, no store — everything
// the /calculator page shows is derived here so the numbers are testable and can
// be reused later (e.g. to grade a real trade against its planned R).
//
// The one idea the whole file is built around: **fees are charged on notional,
// not on your risk.** A 0.3% move with a 0.045% taker fee each side hands ~30% of
// the gross move to the exchange, which quietly turns a "2R" plan into well under
// 1R. So every number here comes in two flavours — gross (what the chart says)
// and net (what actually lands in the account) — and the net one is the headline.

export type CalcDirection = "LONG" | "SHORT";

export type CalcInput = {
  direction: CalcDirection;
  entry: number;
  stop: number;
  target: number;
  /** Taker/maker fee for the entry order, as a % of notional (0.045 = 0.045%). */
  entryFeePct: number;
  /** Fee for the exit order, as a % of notional. */
  exitFeePct: number;
  accountSize: number;
  /** % of the account you're willing to lose on this trade. */
  riskPct: number;
  /** Leverage, for margin + rough liquidation only. Never changes R or fees. */
  leverage: number;
  /** Funding per 8h as a % of notional. Positive = you pay it. */
  fundingPct: number;
  hoursHeld: number;
};

export type FeeDragRow = {
  movePct: number;
  /** Share of the gross move handed to the exchange, as a %. */
  bitePct: number;
  /** Gross R:R you'd need for this move to net exactly 1R. */
  grossRRForOneNetR: number | null;
};

export type TargetForRRow = {
  netR: number;
  price: number;
  movePct: number;
};

export type CalcResult = {
  /** Things that make the setup nonsense (stop on the wrong side, etc.). */
  warnings: string[];

  // --- per-unit building blocks ---
  grossRiskPerUnit: number;
  grossRewardPerUnit: number;
  netRiskPerUnit: number;
  netRewardPerUnit: number;

  // --- the move and what the exchange takes out of it ---
  /** Distance entry → target, as a % of entry. */
  grossMovePct: number;
  /** Distance entry → stop, as a % of entry. */
  stopDistancePct: number;
  /** Entry fee + exit fee, as a % of entry notional. */
  roundTripFeePct: number;
  /** Fees + funding as a share of the gross move — the "25% fee structure" number. */
  feeBitePct: number;
  /** Price where the trade is exactly flat after all costs. */
  breakEvenPrice: number;
  /** How far price must travel from entry just to cover costs, as a %. */
  breakEvenMovePct: number;

  // --- R ---
  grossR: number;
  netR: number;

  // --- the long-run question ---
  /** Win rate needed to break even on the gross numbers. */
  grossBreakEvenWinRate: number | null;
  /** Win rate needed to break even once fees are paid. Null if net R <= 0. */
  netBreakEvenWinRate: number | null;

  // --- sizing ---
  riskBudget: number;
  /** Sized so that a stop-out costs exactly the risk budget, fees included. */
  quantity: number;
  notional: number;
  margin: number;
  /** Rough isolated-margin liquidation. Excludes maintenance margin. */
  liquidationPrice: number | null;

  // --- money ---
  grossWin: number;
  netWin: number;
  /** Positive number: what a stop-out actually costs, fees included. */
  netLoss: number;
  entryFee: number;
  exitFeeAtTarget: number;
  exitFeeAtStop: number;
  fundingCost: number;
  totalCostAtTarget: number;

  // --- tables ---
  feeDrag: FeeDragRow[];
  targetsForNetR: TargetForRRow[];
};

export type Expectancy = {
  winRate: number;
  perTradeR: number;
  perTradeMoney: number;
  /** Net money over 100 trades at this win rate. */
  per100Trades: number;
};

const MOVE_LADDER = [0.25, 0.5, 1, 2, 3, 5];
const NET_R_LADDER = [1, 2, 3];

export function isCalcInputComplete(input: Partial<CalcInput>): input is CalcInput {
  return (
    isPositive(input.entry) &&
    isPositive(input.stop) &&
    isPositive(input.target) &&
    Number.isFinite(input.entryFeePct) &&
    Number.isFinite(input.exitFeePct)
  );
}

function isPositive(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function calculateTrade(input: CalcInput): CalcResult | null {
  const { entry, stop, target, direction } = input;
  if (!isPositive(entry) || !isPositive(stop) || !isPositive(target)) return null;
  if (entry === stop) return null;

  const dir = direction === "SHORT" ? -1 : 1;
  const feeEntry = Math.max(input.entryFeePct, 0) / 100;
  const feeExit = Math.max(input.exitFeePct, 0) / 100;
  const leverage = isPositive(input.leverage) ? input.leverage : 1;

  const warnings: string[] = [];
  if (dir === 1 && stop >= entry) warnings.push("Your stop is above your entry on a long — flip it or switch to short.");
  if (dir === -1 && stop <= entry) warnings.push("Your stop is below your entry on a short — flip it or switch to long.");
  if (dir * (target - entry) <= 0) warnings.push("Your target is on the losing side of your entry.");

  // Funding is charged on notional too, and only accrues while the position is
  // open. Treated as a cost on both the winning and the losing side.
  const periods = Math.max(input.hoursHeld, 0) / 8;
  const fundingPerUnit = entry * (input.fundingPct / 100) * periods;

  const feeAtEntryPerUnit = entry * feeEntry;
  const feeAtTargetPerUnit = target * feeExit;
  const feeAtStopPerUnit = stop * feeExit;

  const grossRiskPerUnit = Math.abs(entry - stop);
  const grossRewardPerUnit = dir * (target - entry);

  // Fees make the win smaller AND the loss bigger — that double hit is why net R
  // falls off so much faster than people expect on small moves.
  const netRewardPerUnit = grossRewardPerUnit - feeAtEntryPerUnit - feeAtTargetPerUnit - fundingPerUnit;
  const netRiskPerUnit = grossRiskPerUnit + feeAtEntryPerUnit + feeAtStopPerUnit + fundingPerUnit;

  const grossR = grossRewardPerUnit / grossRiskPerUnit;
  const netR = netRewardPerUnit / netRiskPerUnit;

  const grossMovePct = (Math.abs(target - entry) / entry) * 100;
  const stopDistancePct = (grossRiskPerUnit / entry) * 100;
  const roundTripFeePct = ((feeAtEntryPerUnit + feeAtTargetPerUnit) / entry) * 100;
  const totalCostPerUnit = feeAtEntryPerUnit + feeAtTargetPerUnit + fundingPerUnit;
  const feeBitePct = Math.abs(grossRewardPerUnit) > 0 ? (totalCostPerUnit / Math.abs(grossRewardPerUnit)) * 100 : 0;

  const breakEvenPrice = breakEven(entry, dir, feeEntry, feeExit, fundingPerUnit);
  const breakEvenMovePct = (Math.abs(breakEvenPrice - entry) / entry) * 100;

  // Size off the *net* loss so a stop-out costs exactly the risk budget. Sizing
  // off the raw stop distance (what most calculators do) quietly overshoots the
  // budget by the fee bill.
  const riskBudget = Math.max(input.accountSize, 0) * (Math.max(input.riskPct, 0) / 100);
  const quantity = netRiskPerUnit > 0 ? riskBudget / netRiskPerUnit : 0;
  const notional = quantity * entry;
  const margin = leverage > 0 ? notional / leverage : notional;
  const liquidationPrice = leverage > 1 ? entry * (1 - dir / leverage) : null;

  if (liquidationPrice != null && dir * (stop - liquidationPrice) <= 0) {
    warnings.push(
      `At ${formatLeverage(leverage)} your rough liquidation sits before your stop — you'd be wiped out before the stop fills.`,
    );
  }
  // A stop this tight needs a position bigger than the account can margin. The
  // risk maths is still right; you just can't actually put the trade on.
  if (input.accountSize > 0 && margin > input.accountSize) {
    warnings.push(
      `This size needs more margin than your whole account at ${formatLeverage(leverage)} — widen the stop, cut the risk %, or use more leverage.`,
    );
  }

  return {
    warnings,
    grossRiskPerUnit,
    grossRewardPerUnit,
    netRiskPerUnit,
    netRewardPerUnit,
    grossMovePct,
    stopDistancePct,
    roundTripFeePct,
    feeBitePct,
    breakEvenPrice,
    breakEvenMovePct,
    grossR,
    netR,
    grossBreakEvenWinRate: grossR > 0 ? 1 / (1 + grossR) : null,
    netBreakEvenWinRate: netR > 0 ? 1 / (1 + netR) : null,
    riskBudget,
    quantity,
    notional,
    margin,
    liquidationPrice,
    grossWin: quantity * grossRewardPerUnit,
    netWin: quantity * netRewardPerUnit,
    netLoss: quantity * netRiskPerUnit,
    entryFee: quantity * feeAtEntryPerUnit,
    exitFeeAtTarget: quantity * feeAtTargetPerUnit,
    exitFeeAtStop: quantity * feeAtStopPerUnit,
    fundingCost: quantity * fundingPerUnit,
    totalCostAtTarget: quantity * totalCostPerUnit,
    feeDrag: feeDragLadder(entry, dir, feeEntry, feeExit),
    targetsForNetR: targetLadder(entry, dir, feeEntry, feeExit, fundingPerUnit, netRiskPerUnit),
  };
}

/**
 * The price at which the position is exactly flat after entry fee, exit fee and
 * funding. Solved, not iterated: the exit fee is charged on the *exit* price, so
 * break-even is not simply entry + costs.
 */
export function breakEven(entry: number, dir: 1 | -1, feeEntry: number, feeExit: number, fundingPerUnit: number) {
  return dir === 1
    ? (entry * (1 + feeEntry) + fundingPerUnit) / (1 - feeExit)
    : (entry * (1 - feeEntry) - fundingPerUnit) / (1 + feeExit);
}

/** Target price that produces a given *net* R, given the same costs. */
function targetForNetR(
  entry: number,
  dir: 1 | -1,
  feeEntry: number,
  feeExit: number,
  fundingPerUnit: number,
  netRiskPerUnit: number,
  netR: number,
) {
  const wanted = netR * netRiskPerUnit;
  return dir === 1
    ? (wanted + entry * (1 + feeEntry) + fundingPerUnit) / (1 - feeExit)
    : (entry * (1 - feeEntry) - fundingPerUnit - wanted) / (1 + feeExit);
}

function targetLadder(
  entry: number,
  dir: 1 | -1,
  feeEntry: number,
  feeExit: number,
  fundingPerUnit: number,
  netRiskPerUnit: number,
): TargetForRRow[] {
  return NET_R_LADDER.map((netR) => {
    const price = targetForNetR(entry, dir, feeEntry, feeExit, fundingPerUnit, netRiskPerUnit, netR);
    return { netR, price, movePct: (Math.abs(price - entry) / entry) * 100 };
  });
}

/**
 * "How much of the move do fees eat?" across a ladder of move sizes — the table
 * that makes the whole problem obvious at a glance. Independent of the current
 * stop/target; it only depends on the fee rates.
 */
function feeDragLadder(entry: number, dir: 1 | -1, feeEntry: number, feeExit: number): FeeDragRow[] {
  return MOVE_LADDER.map((movePct) => {
    const target = entry * (1 + (dir * movePct) / 100);
    const move = Math.abs(target - entry);
    const cost = entry * feeEntry + target * feeExit;
    const bitePct = move > 0 ? (cost / move) * 100 : 0;
    // Net 1R means net reward == net risk. With risk distance d and reward
    // distance m: m - c_win = d + c_loss. Solving for the gross R:R m/d, using
    // the exit fee at roughly entry price for the losing side.
    const netReward = move - cost;
    const costOnLoss = entry * feeEntry + entry * feeExit;
    const grossRRForOneNetR = netReward > costOnLoss ? move / (netReward - costOnLoss) : null;
    return { movePct, bitePct, grossRRForOneNetR };
  });
}

/** Long-run outcome of repeating this exact trade at a given win rate. */
export function expectancyAt(result: CalcResult, winRate: number): Expectancy {
  const w = Math.min(Math.max(winRate, 0), 1);
  const perTradeR = w * result.netR - (1 - w);
  const perTradeMoney = w * result.netWin - (1 - w) * result.netLoss;
  return { winRate: w, perTradeR, perTradeMoney, per100Trades: perTradeMoney * 100 };
}

function formatLeverage(leverage: number) {
  return `${Number.isInteger(leverage) ? leverage : leverage.toFixed(1)}x`;
}

/** Known perp fee tiers, so the fee fields are one tap instead of a lookup. */
export const feePresets = [
  { id: "hl-taker", label: "Hyperliquid taker", entry: 0.045, exit: 0.045 },
  { id: "hl-maker", label: "Hyperliquid maker", entry: 0.015, exit: 0.015 },
  { id: "binance-taker", label: "Binance taker", entry: 0.05, exit: 0.05 },
  { id: "bybit-taker", label: "Bybit taker", entry: 0.055, exit: 0.055 },
  { id: "maker-in-taker-out", label: "Maker in / taker out", entry: 0.02, exit: 0.055 },
] as const;
