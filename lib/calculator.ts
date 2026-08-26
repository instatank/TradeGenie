// The trade profitability math. Pure functions, no React, no store — everything
// the /calculator page shows is derived here so the numbers are testable and can
// be reused later (e.g. to grade a real trade against its planned R).
//
// The one idea the whole file is built around: **fees are charged on notional,
// not on your risk.** A 0.3% move with a 0.045% taker fee each side hands ~30% of
// the gross move to the exchange, which quietly turns a "2R" plan into well under
// 1R. So every number here comes in two flavours — gross (what the chart says)
// and net (what actually lands in the account) — and the net one is the headline.
//
// Slippage is the same shape of cost and is folded into the same place: it moves
// the price you actually get filled at, on all three legs. It's opt-in — pass
// slippagePct: 0 and every number below is exactly the fees-only answer.

export type CalcDirection = "LONG" | "SHORT";

/**
 * Everything needed to answer the first question — *how big should this be?* —
 * which deliberately does NOT include a target. You size a trade off what you
 * lose when you're wrong, so the target has no business being required here.
 */
export type SizeInput = {
  direction: CalcDirection;
  entry: number;
  stop: number;
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
  /**
   * How far the fill misses the quoted price, as a % of price, per leg. Always
   * against you: worse entry, worse target, worse stop. 0 turns it off entirely.
   */
  slippagePct: number;
};

/** Sizing, plus the target — everything the full profitability answer needs. */
export type CalcInput = SizeInput & {
  target: number;
};

export type SizeResult = {
  /** Things that make the setup nonsense (stop on the wrong side, etc.). */
  warnings: string[];
  /** riskPct % of the account — the money you've agreed to lose. */
  riskBudget: number;
  /** |entry − stop| per unit: the denominator of the textbook equation. */
  grossRiskPerUnit: number;
  /** What a stop-out actually costs per unit — slipped stop distance + fees + funding. */
  netRiskPerUnit: number;
  /** Distance entry → stop, as a % of entry. */
  stopDistancePct: number;
  /** risk budget ÷ |entry − stop|. The textbook answer, before a cent of costs. */
  naiveQuantity: number;
  /** The size to actually use: a stop-out costs exactly the risk budget, all in. */
  quantity: number;
  /** What a stop-out really costs at the naive size. Always ≥ the risk budget. */
  naiveLoss: number;
  /** naiveLoss − riskBudget: how far past your budget the textbook answer puts you. */
  overshoot: number;
  notional: number;
  margin: number;
  /** Rough isolated-margin liquidation. Excludes maintenance margin. */
  liquidationPrice: number | null;
  /** Fees + funding + slippage on a round trip that ends at the stop. */
  costAtStop: number;
  /** Whether slippage is switched on, so callers can label costs honestly. */
  slippageOn: boolean;
  entryFill: number;
  stopFill: number;
};

/** The per-unit internals `calculateTrade` reuses so sizing is defined once. */
type SizeCore = SizeResult & {
  dir: 1 | -1;
  leverage: number;
  feeEntry: number;
  feeExit: number;
  feeAtEntryPerUnit: number;
  feeAtStopPerUnit: number;
  fundingPerUnit: number;
  slip: number;
};

export type CostDragRow = {
  movePct: number;
  /** Share of the quoted move lost to costs, as a %. */
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

  // --- the move and what it costs to capture ---
  /** Distance entry → target on the chart, as a % of entry. */
  grossMovePct: number;
  /** Distance entry → stop, as a % of entry. */
  stopDistancePct: number;
  /** Entry fee + exit fee, as a % of entry notional. */
  roundTripFeePct: number;
  /** Every cost as a share of the quoted move — the "25% fee structure" number. */
  costBitePct: number;
  /** Whether slippage is switched on, so callers can label costs honestly. */
  slippageOn: boolean;
  /** Quoted price the market must print for the trade to be flat after all costs. */
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
  /** Sized so that a stop-out costs exactly the risk budget, all costs included. */
  quantity: number;
  notional: number;
  margin: number;
  /** Rough isolated-margin liquidation. Excludes maintenance margin. */
  liquidationPrice: number | null;

  // --- money ---
  grossWin: number;
  netWin: number;
  /** Positive number: what a stop-out actually costs, all costs included. */
  netLoss: number;
  entryFee: number;
  exitFeeAtTarget: number;
  exitFeeAtStop: number;
  fundingCost: number;
  /** What slippage alone costs on a winning round trip. 0 when it's switched off. */
  slippageCostAtTarget: number;
  /** Fees + funding + slippage on the way to the target. */
  totalCostAtTarget: number;

  // --- the prices you'd actually get filled at ---
  entryFill: number;
  targetFill: number;
  stopFill: number;

  // --- tables ---
  costDrag: CostDragRow[];
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

/**
 * The plain question, answered on its own: **how many units do I buy?**
 *
 * The textbook equation everyone starts with is
 * `size = (account × risk%) ÷ |entry − stop|`, and it is right about the shape
 * of the problem and wrong about the amount. It sizes off the *chart* distance
 * to the stop, but a stop-out doesn't cost you the chart distance — it costs
 * the chart distance **plus** the entry fee, **plus** the exit fee, **plus**
 * any funding, **plus** the tick the stop slips by. So the textbook size makes
 * a "1% risk" trade lose more than 1%, every time, by exactly the cost bill.
 *
 * This returns both: `naiveQuantity` (the textbook answer) and `quantity` (the
 * one to use, where a stop-out costs the risk budget and not a rupee more).
 * No target is needed or wanted — you size off being wrong.
 */
export function calculatePositionSize(input: SizeInput): SizeResult | null {
  return sizeCore(input);
}

function sizeCore(input: SizeInput): SizeCore | null {
  const { entry, stop, direction } = input;
  if (!isPositive(entry) || !isPositive(stop)) return null;
  if (entry === stop) return null;

  const dir: 1 | -1 = direction === "SHORT" ? -1 : 1;
  const feeEntry = Math.max(input.entryFeePct, 0) / 100;
  const feeExit = Math.max(input.exitFeePct, 0) / 100;
  const leverage = isPositive(input.leverage) ? input.leverage : 1;

  const warnings: string[] = [];
  if (dir === 1 && stop >= entry) warnings.push("Your stop is above your entry on a long — flip it or switch to short.");
  if (dir === -1 && stop <= entry) warnings.push("Your stop is below your entry on a short — flip it or switch to long.");

  // Funding is charged on notional too, and only accrues while the position is
  // open. Treated as a cost on both the winning and the losing side.
  const periods = Math.max(input.hoursHeld, 0) / 8;
  const fundingPerUnit = entry * (input.fundingPct / 100) * periods;

  // Slippage always works against you, on every leg: you pay up to get in, and
  // you give up a tick getting out — including out of a stop, which typically
  // fills worse than the trigger. Everything below is computed from these fill
  // prices, so slippage flows into R, break-even, sizing and expectancy at once.
  // At 0 the fills collapse back onto the quoted prices and nothing changes.
  const slip = Math.max(input.slippagePct, 0) / 100;
  const slippageOn = slip > 0;
  const entryFill = entry * (1 + dir * slip);
  const stopFill = stop * (1 - dir * slip);

  const feeAtEntryPerUnit = entryFill * feeEntry;
  const feeAtStopPerUnit = stopFill * feeExit;

  // Gross stays on the quoted prices on purpose — it's "what the chart says",
  // the thing the net numbers are being contrasted against.
  const grossRiskPerUnit = Math.abs(entry - stop);
  const filledRiskPerUnit = dir * (entryFill - stopFill);
  // Costs make the loss bigger, which is the half of the problem sizing has to
  // absorb: the exchange takes its cut whether or not the trade works.
  const netRiskPerUnit = filledRiskPerUnit + feeAtEntryPerUnit + feeAtStopPerUnit + fundingPerUnit;
  const costPerUnitAtStop = netRiskPerUnit - grossRiskPerUnit;

  // Size off the *net* loss so a stop-out costs exactly the risk budget. Sizing
  // off the raw stop distance (what most calculators do) quietly overshoots the
  // budget by the fee bill — and by the slipped stop, when slippage is on.
  const riskBudget = Math.max(input.accountSize, 0) * (Math.max(input.riskPct, 0) / 100);
  const quantity = netRiskPerUnit > 0 ? riskBudget / netRiskPerUnit : 0;
  const naiveQuantity = grossRiskPerUnit > 0 ? riskBudget / grossRiskPerUnit : 0;
  const naiveLoss = naiveQuantity * netRiskPerUnit;
  const notional = quantity * entryFill;
  const margin = leverage > 0 ? notional / leverage : notional;
  const liquidationPrice = leverage > 1 ? entryFill * (1 - dir / leverage) : null;

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
    riskBudget,
    grossRiskPerUnit,
    netRiskPerUnit,
    stopDistancePct: (grossRiskPerUnit / entry) * 100,
    naiveQuantity,
    quantity,
    naiveLoss,
    overshoot: naiveLoss - riskBudget,
    notional,
    margin,
    liquidationPrice,
    costAtStop: quantity * costPerUnitAtStop,
    slippageOn,
    entryFill,
    stopFill,
    dir,
    leverage,
    feeEntry,
    feeExit,
    feeAtEntryPerUnit,
    feeAtStopPerUnit,
    fundingPerUnit,
    slip,
  };
}

export function calculateTrade(input: CalcInput): CalcResult | null {
  const { entry, target } = input;
  if (!isPositive(target)) return null;
  const size = sizeCore(input);
  if (!size) return null;

  const { dir, feeEntry, feeExit, feeAtEntryPerUnit, fundingPerUnit, slip, entryFill, quantity } = size;
  const targetFill = target * (1 - dir * slip);
  const feeAtTargetPerUnit = targetFill * feeExit;

  const warnings = [...size.warnings];
  if (dir * (target - entry) <= 0) warnings.push("Your target is on the losing side of your entry.");

  const grossRewardPerUnit = dir * (target - entry);
  const filledRewardPerUnit = dir * (targetFill - entryFill);

  // Costs make the win smaller AND the loss bigger — that double hit is why net R
  // falls off so much faster than people expect on small moves.
  const netRewardPerUnit = filledRewardPerUnit - feeAtEntryPerUnit - feeAtTargetPerUnit - fundingPerUnit;
  const netRiskPerUnit = size.netRiskPerUnit;

  const grossR = grossRewardPerUnit / size.grossRiskPerUnit;
  const netR = netRewardPerUnit / netRiskPerUnit;

  const grossMovePct = (Math.abs(target - entry) / entry) * 100;
  const roundTripFeePct = ((feeAtEntryPerUnit + feeAtTargetPerUnit) / entry) * 100;
  const slippagePerUnit = slip * (entry + target);
  const totalCostPerUnit = feeAtEntryPerUnit + feeAtTargetPerUnit + fundingPerUnit + slippagePerUnit;
  const costBitePct = Math.abs(grossRewardPerUnit) > 0 ? (totalCostPerUnit / Math.abs(grossRewardPerUnit)) * 100 : 0;

  // Quoted price the market has to print, not the fill — the fill will slip off
  // it again, which the exit multiplier accounts for.
  const breakEvenPrice = breakEven(entryFill, dir, feeEntry, feeExit, fundingPerUnit, slip);
  const breakEvenMovePct = (Math.abs(breakEvenPrice - entry) / entry) * 100;

  return {
    warnings,
    grossRiskPerUnit: size.grossRiskPerUnit,
    grossRewardPerUnit,
    netRiskPerUnit,
    netRewardPerUnit,
    grossMovePct,
    stopDistancePct: size.stopDistancePct,
    roundTripFeePct,
    costBitePct,
    slippageOn: size.slippageOn,
    breakEvenPrice,
    breakEvenMovePct,
    grossR,
    netR,
    grossBreakEvenWinRate: grossR > 0 ? 1 / (1 + grossR) : null,
    netBreakEvenWinRate: netR > 0 ? 1 / (1 + netR) : null,
    riskBudget: size.riskBudget,
    quantity,
    notional: size.notional,
    margin: size.margin,
    liquidationPrice: size.liquidationPrice,
    grossWin: quantity * grossRewardPerUnit,
    netWin: quantity * netRewardPerUnit,
    netLoss: quantity * netRiskPerUnit,
    entryFee: quantity * feeAtEntryPerUnit,
    exitFeeAtTarget: quantity * feeAtTargetPerUnit,
    exitFeeAtStop: quantity * size.feeAtStopPerUnit,
    fundingCost: quantity * fundingPerUnit,
    slippageCostAtTarget: quantity * slippagePerUnit,
    totalCostAtTarget: quantity * totalCostPerUnit,
    entryFill,
    targetFill,
    stopFill: size.stopFill,
    costDrag: costDragLadder(entry, dir, feeEntry, feeExit, slip, fundingPerUnit),
    targetsForNetR: targetLadder(entryFill, dir, feeEntry, feeExit, fundingPerUnit, netRiskPerUnit, slip, entry),
  };
}

/**
 * The **quoted** price at which the position is exactly flat after entry fee,
 * exit fee, funding and slippage. Solved, not iterated, for two reasons: the
 * exit fee is charged on the *exit* price, and the exit itself slips off the
 * quoted price — so break-even is not simply entry + costs.
 *
 * Takes the already-slipped entry fill. `exitSlip` is the factor the quoted exit
 * gets multiplied by to become a fill: `1 - dir*slip`.
 */
export function breakEven(
  entryFill: number,
  dir: 1 | -1,
  feeEntry: number,
  feeExit: number,
  fundingPerUnit: number,
  slip = 0,
) {
  const exitSlip = 1 - dir * slip;
  return dir === 1
    ? (entryFill * (1 + feeEntry) + fundingPerUnit) / (exitSlip * (1 - feeExit))
    : (entryFill * (1 - feeEntry) - fundingPerUnit) / (exitSlip * (1 + feeExit));
}

/** Quoted target price that produces a given *net* R, given the same costs. */
function targetForNetR(
  entryFill: number,
  dir: 1 | -1,
  feeEntry: number,
  feeExit: number,
  fundingPerUnit: number,
  netRiskPerUnit: number,
  netR: number,
  slip: number,
) {
  const wanted = netR * netRiskPerUnit;
  const exitSlip = 1 - dir * slip;
  return dir === 1
    ? (wanted + entryFill * (1 + feeEntry) + fundingPerUnit) / (exitSlip * (1 - feeExit))
    : (entryFill * (1 - feeEntry) - fundingPerUnit - wanted) / (exitSlip * (1 + feeExit));
}

function targetLadder(
  entryFill: number,
  dir: 1 | -1,
  feeEntry: number,
  feeExit: number,
  fundingPerUnit: number,
  netRiskPerUnit: number,
  slip: number,
  quotedEntry: number,
): TargetForRRow[] {
  return NET_R_LADDER.map((netR) => {
    const price = targetForNetR(entryFill, dir, feeEntry, feeExit, fundingPerUnit, netRiskPerUnit, netR, slip);
    // The move is measured from the quoted entry — that's the number you'd read
    // off a chart when deciding whether the target is realistic.
    return { netR, price, movePct: (Math.abs(price - quotedEntry) / quotedEntry) * 100 };
  });
}

/**
 * "How much of the move do costs eat?" across a ladder of move sizes — the table
 * that makes the whole problem obvious at a glance. Independent of the current
 * stop and target; it depends only on the fee rates, the slippage assumption and
 * the funding already accrued.
 */
function costDragLadder(
  entry: number,
  dir: 1 | -1,
  feeEntry: number,
  feeExit: number,
  slip: number,
  fundingPerUnit: number,
): CostDragRow[] {
  const entryFill = entry * (1 + dir * slip);
  const exitSlip = 1 - dir * slip;
  return MOVE_LADDER.map((movePct) => {
    const target = entry * (1 + (dir * movePct) / 100);
    const targetFill = target * exitSlip;
    const move = Math.abs(target - entry);
    const netReward = dir * (targetFill - entryFill) - entryFill * feeEntry - targetFill * feeExit - fundingPerUnit;
    const bitePct = move > 0 ? ((move - netReward) / move) * 100 : 0;

    // Net 1R means net reward == net risk. Solved exactly for the stop distance d
    // rather than approximating the losing side's costs at the entry price: the
    // stop's own exit fee scales with the stop price, which is what the
    // exitSlip*(1 - dir*feeExit) denominator carries. Approximating it puts the
    // tight-stop rows visibly wrong — and those are the rows that matter here.
    const numerator = netReward - 2 * slip * entry - entryFill * feeEntry - entry * exitSlip * feeExit - fundingPerUnit;
    const stopDistance = numerator / (exitSlip * (1 - dir * feeExit));
    const grossRRForOneNetR = stopDistance > 0 ? move / stopDistance : null;
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
