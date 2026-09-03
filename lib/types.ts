import type { MoneyRate } from "@/lib/currency";
import type { MarketContext } from "@/lib/market-context";

export const TranscriptType = {
  UNKNOWN: "UNKNOWN",
  DAILY_CHECKIN: "DAILY_CHECKIN",
  TRADE_ENTRY_NOTE: "TRADE_ENTRY_NOTE",
  TRADE_EXIT_REVIEW: "TRADE_EXIT_REVIEW",
  EOD_REVIEW: "EOD_REVIEW",
  WEEKLY_REFLECTION: "WEEKLY_REFLECTION",
  PLAYBOOK_NOTE: "PLAYBOOK_NOTE",
  GENERAL_LEARNING_NOTE: "GENERAL_LEARNING_NOTE",
  MISTAKE_REFLECTION: "MISTAKE_REFLECTION",
} as const;

export const ProcessingStatus = {
  UNPROCESSED: "UNPROCESSED",
  STRUCTURED: "STRUCTURED",
  CONFIRMED: "CONFIRMED",
  ARCHIVED: "ARCHIVED",
} as const;

export const AiConfidence = { LOW: "LOW", MEDIUM: "MEDIUM", HIGH: "HIGH" } as const;
export const TradingMode = { LIVE: "LIVE", PAPER: "PAPER", OBSERVE_ONLY: "OBSERVE_ONLY", NO_TRADING: "NO_TRADING" } as const;
export const CurrentState = { CALM: "CALM", SHARP: "SHARP", TIRED: "TIRED", DISTRACTED: "DISTRACTED", ANXIOUS: "ANXIOUS", TILTED: "TILTED", BORED: "BORED", OVERCONFIDENT: "OVERCONFIDENT", FOMO: "FOMO", UNKNOWN: "UNKNOWN" } as const;
export const MarketType = { CRYPTO_PERP: "CRYPTO_PERP", CRYPTO_SPOT: "CRYPTO_SPOT", INDIAN_INDEX: "INDIAN_INDEX", INDIAN_STOCK: "INDIAN_STOCK", OTHER: "OTHER" } as const;
export const Direction = { LONG: "LONG", SHORT: "SHORT", UNKNOWN: "UNKNOWN" } as const;
export const TradeStatus = { IDEA: "IDEA", OPEN: "OPEN", CLOSED: "CLOSED", CANCELLED: "CANCELLED" } as const;
export const EmotionalState = { CALM: "CALM", SHARP: "SHARP", TIRED: "TIRED", DISTRACTED: "DISTRACTED", ANXIOUS: "ANXIOUS", TILTED: "TILTED", BORED: "BORED", OVERCONFIDENT: "OVERCONFIDENT", FOMO: "FOMO", REVENGE: "REVENGE", UNKNOWN: "UNKNOWN" } as const;
export const RiskPosture = { REDUCED: "REDUCED", NORMAL: "NORMAL", AGGRESSIVE: "AGGRESSIVE", UNKNOWN: "UNKNOWN" } as const;
export const EntryGrade = { A: "A", B: "B", C: "C", NA: "NA" } as const;
// How good the SETUP was — a different question from how well it was executed
// (EntryGrade). Extendable by typing, so these three are the starting
// vocabulary, not the whole of it; see the setupGrade group in lib/options.ts.
export const SetupGrade = { A_PLUS: "A_PLUS", A: "A", B: "B" } as const;
export const FollowedPlan = { YES: "YES", NO: "NO", PARTIAL: "PARTIAL", NA: "NA" } as const;
export const LessonSourceType = { TRADE: "TRADE", DAILY_REVIEW: "DAILY_REVIEW", WEEKLY_REVIEW: "WEEKLY_REVIEW", TRANSCRIPT: "TRANSCRIPT", MANUAL: "MANUAL" } as const;
export const LessonCategory = { ENTRY_DISCIPLINE: "ENTRY_DISCIPLINE", EXIT_DISCIPLINE: "EXIT_DISCIPLINE", RISK_MANAGEMENT: "RISK_MANAGEMENT", PSYCHOLOGY: "PSYCHOLOGY", MARKET_CONDITION: "MARKET_CONDITION", SETUP_SPECIFIC: "SETUP_SPECIFIC", PROCESS: "PROCESS", OTHER: "OTHER" } as const;
export const SetupDirectionBias = { LONG: "LONG", SHORT: "SHORT", BOTH: "BOTH" } as const;
export const AssetTimeframe = { HTF: "HTF", MTF: "MTF", LTF: "LTF", GENERAL: "GENERAL" } as const;
// What a quick note is about. Six built-ins mirroring the parts of the journal
// a loose thought usually belongs to; the trader can type their own (lib/options.ts).
export const NoteCategory = { TRADE: "TRADE", ASSET: "ASSET", MINDSET: "MINDSET", MARKET: "MARKET", LESSON: "LESSON", REVIEW: "REVIEW" } as const;

export type TranscriptType = ValueOf<typeof TranscriptType>;
export type ProcessingStatus = ValueOf<typeof ProcessingStatus>;
export type AiConfidence = ValueOf<typeof AiConfidence>;
export type TradingMode = ValueOf<typeof TradingMode>;
export type CurrentState = ValueOf<typeof CurrentState>;
export type MarketType = ValueOf<typeof MarketType>;
export type Direction = ValueOf<typeof Direction>;
export type TradeStatus = ValueOf<typeof TradeStatus>;
export type EmotionalState = ValueOf<typeof EmotionalState>;
export type RiskPosture = ValueOf<typeof RiskPosture>;
export type EntryGrade = ValueOf<typeof EntryGrade>;
export type SetupGrade = ValueOf<typeof SetupGrade>;
export type FollowedPlan = ValueOf<typeof FollowedPlan>;
export type LessonSourceType = ValueOf<typeof LessonSourceType>;
export type LessonCategory = ValueOf<typeof LessonCategory>;
export type SetupDirectionBias = ValueOf<typeof SetupDirectionBias>;
export type AssetTimeframe = ValueOf<typeof AssetTimeframe>;
export type NoteCategory = ValueOf<typeof NoteCategory>;

type ValueOf<T> = T[keyof T];

// A field whose pill vocabulary the trader can extend from any picker that
// shows it (see lib/options.ts). The built-in values still autocomplete and
// still compare as literals; a custom value is just another string. Used
// instead of the bare enum on every field that has an "or type another…" box.
export type Extendable<T extends string> = T | (string & {});

// One label the trader invented for a preset-pill field — the same idea as a
// custom tag, but for the closed-vocabulary chips (mind state, market
// conditions, lesson categories, …). `value` is the stored, normalized form;
// `label` is exactly what was typed, so pills read the way they were written.
// Custom mistake tags are NOT stored here: they are real `mistakeTags` records,
// because trades link to a mistake tag by id.
export type CustomOption = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  group: string;
  value: string;
  label: string;
  description: string | null;
};

// Free-form tags (lowercase, normalized by lib/tags.ts) live directly on each
// record as `tags?: string[]` — derived at save time from inline #hashtags in
// the record's text plus the optional Tags input. Optional so old records need
// no migration; treat undefined as [].
export type Transcript = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  transcriptDateTime: Date;
  sourceTool: string | null;
  rawText: string;
  cleanedSummary: string | null;
  transcriptType: TranscriptType;
  processingStatus: ProcessingStatus;
  linkedTradeId: string | null;
  linkedDailyJournalId: string | null;
  structuredJson: string | null;
  aiConfidence: AiConfidence | null;
  tags?: string[];
};

export type DailyJournal = {
  id: string;
  date: Date;
  createdAt: Date;
  updatedAt: Date;
  tradingMode: Extendable<TradingMode>;
  marketsWatched: string | null;
  maxLossForDay: string | null;
  maxTradesForDay: number | null;
  currentState: Extendable<CurrentState> | null;
  learningFocus: string | null;
  reasonNotToTrade: string | null;
  tradedToday: boolean | null;
  followedMaxLoss: boolean | null;
  followedMaxTrades: boolean | null;
  bestDecision: string | null;
  worstDecision: string | null;
  mainEmotion: string | null;
  mainMistake: string | null;
  oneThingDoneWell: string | null;
  oneThingToAvoidTomorrow: string | null;
  disciplineScore: number | null;
  eodNotes: string | null;
  tags?: string[];
};

export type Trade = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  tradeDateTime: Date;
  marketType: MarketType;
  instrument: string;
  direction: Direction;
  status: TradeStatus;
  setupName: string | null;
  setupId?: string | null;
  entryThesis: string | null;
  invalidation: string | null;
  concern: string | null;
  premortem?: string | null;
  conditions?: string[];
  /** Chart timeframes this trade was actually worked on — `tradeTimeframe`
   *  option values (1m / 5m / 15m / 1H / …, or ones the trader typed). */
  timeframes?: string[];
  /** The mechanisms/concepts the entry was built on — `mechanism` option values
   *  (FVG, order block, liquidity sweep, displacement, …). Many per trade:
   *  a real entry usually stacks two or three. */
  mechanisms?: string[];
  /** Which steps of the linked playbook setup's checklist were actually met.
   *  Stored as normalized step values (`normalizeOptionValue` over the
   *  checklist line), not indexes: reordering the checklist must not silently
   *  move a tick from one step to another. */
  checklistSteps?: string[];
  emotionalState: Extendable<EmotionalState> | null;
  riskPosture: Extendable<RiskPosture> | null;
  confidenceScore: number | null;
  entryGrade: EntryGrade;
  /** How good the setup itself was, graded at entry: A+ / A / B out of the box,
   *  plus anything the trader types. Deliberately NOT an enum — unlike
   *  entryGrade, nothing in the app's maths keys off it, so it is a preference
   *  and the vocabulary is the trader's (lib/options.ts, group "setupGrade").
   *  Absent on every trade logged before this existed; null means ungraded. */
  setupGrade?: Extendable<SetupGrade> | null;
  exitReason: string | null;
  followedPlan: FollowedPlan | null;
  lesson: string | null;
  notes: string | null;
  entryPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
  maePrice?: number | null;
  mfePrice?: number | null;
  quantity: number | null;
  totalOrderValue?: number | null;
  leverage: number | null;
  realizedPnl: number | null;
  fees: number | null;
  funding: number | null;
  netPnl: number | null;
  /** The margin wallet the four money fields above are denominated in ("INR",
   *  "USDT"). Stamped when an exchange match is accepted; absent on a
   *  hand-logged trade, which is read as "already in the base currency" —
   *  whatever the trader was thinking in when they typed it. Prices, quantity
   *  and rMultiple are NOT in this currency: a price is in the pair's quote
   *  currency and a quantity is in units of the coin. */
  currency?: string | null;
  /** What one unit of `currency` was worth in each currency at the time,
   *  copied from the exchange's own ledger row. Frozen with the trade, like
   *  marketContext: a total over last year's trades must use last year's rate,
   *  and re-deriving it later would silently rewrite history. */
  moneyRate?: MoneyRate | null;
  rMultiple: number | null;
  tags?: string[];
  /** The exchange position this trade has been reconciled against. Set once a
   *  match is accepted, and thereafter authoritative: an established link is
   *  never re-guessed by the proximity matcher. Absent on every hand-logged
   *  trade that has not been reconciled, which is the normal state. */
  exchangeKey?: string | null;
  /**
   * This trade was never journaled. It was rebuilt from exchange fills after
   * the fact, so it carries the objective numbers and no words at all — no
   * thesis, no plan, no grade, no lesson, because none were ever written.
   *
   * The flag exists because "closed with no followedPlan" normally means
   * "review me", and for these it means "there was nothing to review". Without
   * it, an archive backfill would nag on Today forever and score 20/100 on a
   * process metric measuring a process that was never recorded. See
   * `tradeNeedsReview` and `tradeProcessScore` in lib/metrics.ts.
   *
   * It is provenance, so it never clears: reviewing one of these later fills in
   * the words, but it stays true that nothing was written at the time.
   */
  reconstructed?: boolean;
  // What the market looked like when this trade was entered, copied once from
  // SignalDesk and frozen. Never recomputed — the point is what it looked like
  // THEN. Absent on every trade logged before the bridge existed, and null
  // whenever SignalDesk was unreachable; both render as nothing.
  marketContext?: MarketContext | null;
};

export type Setup = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  directionBias: SetupDirectionBias;
  rules: string | null;
  checklist: string | null;
  idealRiskReward: number | null;
  notes: string | null;
  isActive: boolean;
  tags?: string[];
};

export type MistakeTag = { id: string; name: string; label: string; description: string | null };
export type TradeMistake = { id: string; tradeId: string; mistakeTagId: string };
export type TradeMistakeWithTag = TradeMistake & { mistakeTag: MistakeTag };
export type TradeWithMistakes = Trade & { mistakeTags: TradeMistakeWithTag[] };

export type Lesson = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  lessonText: string;
  sourceType: LessonSourceType;
  category: Extendable<LessonCategory>;
  linkedTradeId: string | null;
  linkedTranscriptId: string | null;
  isActive: boolean;
  isPinned?: boolean;
  tags?: string[];
};

// A tracked asset is a living page per symbol (e.g. BTC, HYPE). The header fields
// below are the always-current "glance" view that the owner edits in place; the
// running history of dated thoughts lives in AssetNote (append-only thread).
export type Asset = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  symbol: string;
  marketType: MarketType;
  htfBias: string | null;
  ltfBias: string | null;
  levels: string | null;
  gamePlan: string | null;
  isArchived: boolean;
  tags?: string[];
};

// A thought that belongs to no other collection: typed into the quick-note box
// on Today or on a day's review, or left over when a captured note segments into
// typed entries. Either way it lands here rather than being forced into a lesson
// or a journal field, or silently dropped.
//
// Filed to a day by `createdAt` — that is the only date it has. A hand-typed note
// carries `linkedTranscriptId: null`; one lifted out of a captured note points
// back at the transcript it came from.
export type FreeNote = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  text: string;
  linkedTranscriptId: string | null;
  /** Which part of the journal this thought is about — a `noteCategory` option
   *  value (TRADE / ASSET / MINDSET / …, or one the trader typed themselves).
   *  null = uncategorised, which is what every note written before this existed
   *  (and every note lifted out of a captured voice note) still is. Stored as
   *  null rather than left undefined: Firestore rejects undefined on write. */
  category: Extendable<NoteCategory> | null;
  tags?: string[];
};

// A filter you built once and want back with one tap: the exact URL of a
// /trades or /notes view. Stored as a path + query rather than as structured
// filters on purpose — the filters ARE the URL on those pages, so there is
// nothing to keep in sync, and a view keeps working when a page grows a new
// filter it has never heard of.
export type SavedView = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  /** Root-relative, e.g. "/trades?mechanism=FVG&timeframe=5M". */
  path: string;
};

// One dated entry in an asset's running thread — a free-form thought dump.
export type AssetNote = {
  id: string;
  createdAt: Date;
  updatedAt: Date;
  assetId: string;
  timeframe: Extendable<AssetTimeframe> | null;
  text: string;
  tags?: string[];
};

export type RawExecution = {
  id: string;
  createdAt: Date;
  importBatchId: string;
  executionDateTime: Date;
  exchangeBroker: string | null;
  instrument: string;
  side: string | null;
  price: number | null;
  quantity: number | null;
  totalOrderValue?: number | null;
  fees: number | null;
  funding: number | null;
  realizedPnl: number | null;
  orderId: string | null;
  rawJson: string;
  linkedTradeId: string | null;
};

export type ImportBatch = {
  id: string;
  createdAt: Date;
  sourceName: string | null;
  fileName: string | null;
  rowCount: number;
  importedCount: number;
  skippedCount: number;
  notes: string | null;
};

export type Screenshot = {
  id: string;
  createdAt: Date;
  filePath: string;
  caption: string | null;
  linkedTradeId: string | null;
  linkedDailyJournalId: string | null;
  linkedTranscriptId: string | null;
};

export type WeeklyReview = {
  id: string;
  createdAt: Date;
  weekStart: Date;
  weekEnd: Date;
  summaryText: string;
  totalTrades: number;
  totalPnl: number | null;
  totalR: number | null;
  winRate: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  ruleAdherenceRate: number | null;
  mostCommonMistake: string | null;
  bestLesson: string | null;
  actionItem: string | null;
};

// ── Exchange import ─────────────────────────────────────────────────────────
//
// Two raw collections, and NO stored positions. Positions are derived at read
// time by reconstructPositions(), which is a pure tested function — so there is
// one source of truth, the fold can be improved without a migration, and no
// sync state can drift out of agreement with the records it came from.
//
// Capturing the raw rows is also what defeats the exchange's own limits: the
// CoinDCX ledger only reaches back ~3 weeks, so a funding charge we do not
// store now is gone for good. Once it is here it is ours.

/** One execution, exactly as the exchange reported it. `id` is the exchange's
 *  own fill id, which makes re-importing a day idempotent by construction. */
export type ExchangeFill = {
  id: string;
  createdAt: Date;
  source: string;
  instrument: string;
  /** Margin account this settled in — "USDT" or "INR". */
  currency: string;
  side: "BUY" | "SELL";
  quantity: number;
  price: number;
  fee: number;
  executedAt: Date;
  orderId: string | null;
  /** What price and fee are denominated in — the pair's quote currency. NOT
   *  the same as `currency`, which is the wallet it settled in. */
  quoteCurrency: string;
};

/** One row of the exchange's transaction ledger: funding, an exit, or P&L. */
export type ExchangeLedgerEntry = {
  id: string;
  createdAt: Date;
  source: string;
  instrument: string;
  currency: string;
  /** The exchange's own word for the row type ("funding", "tpsl_exit", …). */
  stage: string;
  kind: "FUNDING" | "EXIT" | "OTHER";
  amount: number;
  fee: number;
  positionId: string | null;
  orderId: string | null;
  /** What one unit of `currency` was worth at the time, as the exchange
   *  recorded it. This is why no FX feed is needed to combine accounts. */
  rateInr: number | null;
  rateUsdt: number | null;
  occurredAt: Date;
};
