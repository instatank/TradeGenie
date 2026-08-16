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
export const FollowedPlan = { YES: "YES", NO: "NO", PARTIAL: "PARTIAL", NA: "NA" } as const;
export const LessonSourceType = { TRADE: "TRADE", DAILY_REVIEW: "DAILY_REVIEW", WEEKLY_REVIEW: "WEEKLY_REVIEW", TRANSCRIPT: "TRANSCRIPT", MANUAL: "MANUAL" } as const;
export const LessonCategory = { ENTRY_DISCIPLINE: "ENTRY_DISCIPLINE", EXIT_DISCIPLINE: "EXIT_DISCIPLINE", RISK_MANAGEMENT: "RISK_MANAGEMENT", PSYCHOLOGY: "PSYCHOLOGY", MARKET_CONDITION: "MARKET_CONDITION", SETUP_SPECIFIC: "SETUP_SPECIFIC", PROCESS: "PROCESS", OTHER: "OTHER" } as const;
export const SetupDirectionBias = { LONG: "LONG", SHORT: "SHORT", BOTH: "BOTH" } as const;
export const AssetTimeframe = { HTF: "HTF", MTF: "MTF", LTF: "LTF", GENERAL: "GENERAL" } as const;

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
export type FollowedPlan = ValueOf<typeof FollowedPlan>;
export type LessonSourceType = ValueOf<typeof LessonSourceType>;
export type LessonCategory = ValueOf<typeof LessonCategory>;
export type SetupDirectionBias = ValueOf<typeof SetupDirectionBias>;
export type AssetTimeframe = ValueOf<typeof AssetTimeframe>;

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
  emotionalState: Extendable<EmotionalState> | null;
  riskPosture: Extendable<RiskPosture> | null;
  confidenceScore: number | null;
  entryGrade: EntryGrade;
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
  rMultiple: number | null;
  tags?: string[];
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
  tags?: string[];
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
