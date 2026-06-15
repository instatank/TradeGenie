import { addDays, startOfDay, subDays } from "date-fns";
import { defaultMistakeTags } from "../lib/constants";
import { db } from "../lib/data";
import { calculateNetPnl, calculateOrderFields, calculateRMultiple } from "../lib/metrics";
import {
  CurrentState,
  Direction,
  EmotionalState,
  EntryGrade,
  FollowedPlan,
  LessonCategory,
  LessonSourceType,
  MarketType,
  ProcessingStatus,
  RiskPosture,
  TradeStatus,
  TranscriptType,
  TradingMode,
  type Trade,
} from "../lib/types";

async function main() {
  const existingTags = await db.list("mistakeTags");
  for (const [name, label, description] of defaultMistakeTags) {
    const existing = existingTags.find((tag) => tag.name === name);
    if (existing) {
      await db.update("mistakeTags", existing.id, { label, description });
    } else {
      await db.create("mistakeTags", { name, label, description });
    }
  }

  if (!(await db.list("trades")).length) {
    const tags = await db.list("mistakeTags");
    const tradeInputs = [
      {
        dateOffset: -6,
        instrument: "BTC",
        direction: Direction.LONG,
        status: TradeStatus.CLOSED,
        setupName: "Range reclaim",
        entryThesis: "BTC reclaimed the prior range high after liquidations and held VWAP on the retest.",
        invalidation: "Acceptance back inside the range.",
        emotionalState: EmotionalState.CALM,
        riskPosture: RiskPosture.NORMAL,
        entryGrade: EntryGrade.B,
        entryPrice: 104200,
        stopPrice: 103450,
        exitPrice: 105850,
        quantity: 0.25,
        realizedPnl: 420,
        fees: 18,
        funding: -4,
        followedPlan: FollowedPlan.YES,
        lesson: "The best entries this week came after waiting for the retest, not the first breakout candle.",
        mistakes: [],
      },
      {
        dateOffset: -5,
        instrument: "SOL",
        direction: Direction.SHORT,
        status: TradeStatus.CLOSED,
        setupName: "Failed breakout",
        entryThesis: "SOL failed above resistance while BTC was losing momentum.",
        invalidation: "Clean reclaim above the failed breakout level.",
        emotionalState: EmotionalState.SHARP,
        riskPosture: RiskPosture.NORMAL,
        entryGrade: EntryGrade.A,
        entryPrice: 158,
        stopPrice: 161,
        exitPrice: 151,
        quantity: 50,
        realizedPnl: 360,
        fees: 12,
        funding: 0,
        followedPlan: FollowedPlan.YES,
        lesson: "Failed breakouts are cleaner when the broader market is also heavy.",
        mistakes: [],
      },
      {
        dateOffset: -4,
        instrument: "ETH",
        direction: Direction.LONG,
        status: TradeStatus.CLOSED,
        setupName: "Momentum pullback",
        entryThesis: "ETH pulled into support after a strong impulse.",
        invalidation: "Loss of the pullback low.",
        emotionalState: EmotionalState.FOMO,
        riskPosture: RiskPosture.AGGRESSIVE,
        entryGrade: EntryGrade.C,
        entryPrice: 3720,
        stopPrice: 3680,
        exitPrice: 3695,
        quantity: 8,
        realizedPnl: -210,
        fees: 15,
        funding: -2,
        followedPlan: FollowedPlan.PARTIAL,
        lesson: "Do not increase size just because the first entry was missed.",
        mistakes: ["FOMO_ENTRY", "OVERSIZED", "ENTERED_LATE"],
      },
      {
        dateOffset: -2,
        instrument: "NIFTY",
        direction: Direction.LONG,
        status: TradeStatus.OPEN,
        setupName: "Opening drive",
        entryThesis: "Index held pre-market support and large-cap banks showed relative strength.",
        invalidation: "First 15-minute low breaks with breadth turning negative.",
        emotionalState: EmotionalState.CALM,
        riskPosture: RiskPosture.REDUCED,
        entryGrade: EntryGrade.B,
        entryPrice: 23480,
        stopPrice: 23410,
        quantity: 1,
        followedPlan: FollowedPlan.NA,
        lesson: null,
        mistakes: [],
      },
      {
        dateOffset: -1,
        instrument: "ZEC",
        direction: Direction.LONG,
        status: TradeStatus.CANCELLED,
        setupName: "News impulse",
        entryThesis: "Wanted continuation after a news spike, but spread and volatility were poor.",
        invalidation: "No clean invalidation available.",
        emotionalState: EmotionalState.ANXIOUS,
        riskPosture: RiskPosture.REDUCED,
        entryGrade: EntryGrade.NA,
        entryPrice: null,
        stopPrice: null,
        quantity: null,
        followedPlan: FollowedPlan.YES,
        lesson: "Cancelling unclear ideas counts as discipline.",
        mistakes: ["NO_CLEAR_INVALIDATION"],
      },
    ];

    for (const input of tradeInputs) {
      const now = new Date();
      const orderFields = calculateOrderFields({
        price: input.entryPrice ?? null,
        quantity: input.quantity ?? null,
        totalOrderValue: null,
      });
      const trade = await db.create("trades", {
        createdAt: now,
        updatedAt: now,
        tradeDateTime: addDays(new Date(), input.dateOffset),
        marketType: input.instrument === "NIFTY" ? MarketType.INDIAN_INDEX : MarketType.CRYPTO_PERP,
        instrument: input.instrument,
        direction: input.direction,
        status: input.status,
        setupName: input.setupName,
        entryThesis: input.entryThesis,
        invalidation: input.invalidation,
        concern: null,
        emotionalState: input.emotionalState,
        riskPosture: input.riskPosture,
        confidenceScore: null,
        entryGrade: input.entryGrade,
        exitReason: null,
        followedPlan: input.followedPlan,
        lesson: input.lesson,
        notes: null,
        entryPrice: input.entryPrice ?? null,
        stopPrice: input.stopPrice ?? null,
        targetPrice: null,
        exitPrice: input.exitPrice ?? null,
        quantity: orderFields.quantity,
        totalOrderValue: orderFields.totalOrderValue,
        leverage: null,
        realizedPnl: input.realizedPnl ?? null,
        fees: input.fees ?? null,
        funding: input.funding ?? null,
        netPnl: calculateNetPnl(input.realizedPnl, input.fees, input.funding),
        rMultiple: calculateRMultiple(input),
      } satisfies Omit<Trade, "id">);

      const mistakeNames = input.mistakes as string[];
      for (const mistake of tags.filter((tag) => mistakeNames.includes(tag.name))) {
        await db.create("tradeMistakes", { tradeId: trade.id, mistakeTagId: mistake.id });
      }
    }
  }

  if (!(await db.list("transcripts")).length) {
    const now = new Date();
    await db.create("transcripts", {
      createdAt: now,
      updatedAt: now,
      transcriptDateTime: subDays(new Date(), 1),
      sourceTool: "Voice memo",
      rawText: "Quick note on BTC. I wanted to long the reclaim but felt a bit of FOMO after missing the first candle. The thesis was continuation if it held above the range. Stop would be back inside the range. Lesson: wait for retest.",
      cleanedSummary: null,
      transcriptType: TranscriptType.TRADE_ENTRY_NOTE,
      processingStatus: ProcessingStatus.UNPROCESSED,
      linkedTradeId: null,
      linkedDailyJournalId: null,
      structuredJson: null,
      aiConfidence: null,
    });
    await db.create("transcripts", {
      createdAt: now,
      updatedAt: now,
      transcriptDateTime: subDays(new Date(), 2),
      sourceTool: "Voice memo",
      rawText: "End of day review. I traded today and followed max loss. Best decision was cancelling the ZEC idea because invalidation was unclear. Worst decision was watching too many coins. Discipline score 7.",
      cleanedSummary: null,
      transcriptType: TranscriptType.EOD_REVIEW,
      processingStatus: ProcessingStatus.UNPROCESSED,
      linkedTradeId: null,
      linkedDailyJournalId: null,
      structuredJson: null,
      aiConfidence: null,
    });
    await db.create("transcripts", {
      createdAt: now,
      updatedAt: now,
      transcriptDateTime: subDays(new Date(), 4),
      sourceTool: "Dictation",
      rawText: "ETH exit review. I did not follow the plan fully because I entered late and oversized. Future rule is no size increase after missing the first entry.",
      cleanedSummary: null,
      transcriptType: TranscriptType.TRADE_EXIT_REVIEW,
      processingStatus: ProcessingStatus.UNPROCESSED,
      linkedTradeId: null,
      linkedDailyJournalId: null,
      structuredJson: null,
      aiConfidence: null,
    });
  }

  if (!(await db.list("lessons")).length) {
    const now = new Date();
    await db.create("lessons", {
      createdAt: now,
      updatedAt: now,
      lessonText: "Write invalidation before entry; unclear invalidation means no trade.",
      sourceType: LessonSourceType.MANUAL,
      category: LessonCategory.RISK_MANAGEMENT,
      linkedTradeId: null,
      linkedTranscriptId: null,
      isActive: true,
    });
    await db.create("lessons", {
      createdAt: now,
      updatedAt: now,
      lessonText: "The retest is usually lower stress than the breakout candle.",
      sourceType: LessonSourceType.TRADE,
      category: LessonCategory.ENTRY_DISCIPLINE,
      linkedTradeId: null,
      linkedTranscriptId: null,
      isActive: true,
    });
    await db.create("lessons", {
      createdAt: now,
      updatedAt: now,
      lessonText: "Poor state is a position-sizing input, not just a journal note.",
      sourceType: LessonSourceType.DAILY_REVIEW,
      category: LessonCategory.PSYCHOLOGY,
      linkedTradeId: null,
      linkedTranscriptId: null,
      isActive: true,
    });
  }

  if (!(await db.list("dailyJournals")).length) {
    const now = new Date();
    await db.create("dailyJournals", {
      createdAt: now,
      updatedAt: now,
      date: startOfDay(subDays(new Date(), 1)),
      tradingMode: TradingMode.PAPER,
      marketsWatched: "BTC, ETH, SOL",
      maxLossForDay: "-2R",
      maxTradesForDay: 3,
      currentState: CurrentState.CALM,
      learningFocus: "Wait for retests.",
      reasonNotToTrade: null,
      tradedToday: true,
      followedMaxLoss: true,
      followedMaxTrades: true,
      bestDecision: "Cancelled unclear ZEC idea.",
      worstDecision: "Watched too many instruments.",
      mainEmotion: "Impatient",
      mainMistake: "FOMO",
      oneThingDoneWell: "Kept size reduced.",
      oneThingToAvoidTomorrow: "Chasing first candles.",
      disciplineScore: 7,
      eodNotes: "Good process day overall.",
    });
    await db.create("dailyJournals", {
      createdAt: now,
      updatedAt: now,
      date: startOfDay(subDays(new Date(), 2)),
      tradingMode: TradingMode.OBSERVE_ONLY,
      marketsWatched: "NIFTY, BANKNIFTY",
      maxLossForDay: "No trading",
      maxTradesForDay: 0,
      currentState: CurrentState.TIRED,
      learningFocus: "Observe opening range behavior.",
      reasonNotToTrade: "Sleep was poor.",
      tradedToday: false,
      followedMaxLoss: null,
      followedMaxTrades: null,
      bestDecision: null,
      worstDecision: null,
      mainEmotion: null,
      mainMistake: null,
      oneThingDoneWell: null,
      oneThingToAvoidTomorrow: null,
      disciplineScore: 8,
      eodNotes: "Standing aside was the right call.",
    });
  }

  console.log("Seed complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
