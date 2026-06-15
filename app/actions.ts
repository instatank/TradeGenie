"use server";

import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { endOfDay, startOfDay } from "date-fns";
import { db, getClosedTradesInRange, getTodayJournal } from "@/lib/data";
import { calculateNetPnl, calculateOrderFields, calculateRMultiple, summarizeWeeklyStats, toNumber, toText, weekBounds } from "@/lib/metrics";
import { defaultPromptTemplates } from "@/lib/prompts";
import { saveSettings, type AppSettings } from "@/lib/settings-store";
import { newId } from "@/lib/store";
import { structureTranscript } from "@/lib/transcript-processor";
import {
  AiConfidence,
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
  type Lesson,
} from "@/lib/types";

type StructuredJson = Record<string, unknown>;

function enumValue<T extends Record<string, string>>(enumObject: T, value: FormDataEntryValue | null, fallback: T[keyof T]) {
  const text = typeof value === "string" ? value : "";
  return Object.values(enumObject).includes(text as T[keyof T]) ? (text as T[keyof T]) : fallback;
}

function optionalEnum<T extends Record<string, string>>(enumObject: T, value: FormDataEntryValue | null) {
  const text = typeof value === "string" ? value : "";
  return Object.values(enumObject).includes(text as T[keyof T]) ? (text as T[keyof T]) : null;
}

function boolFromForm(value: FormDataEntryValue | null) {
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function dateFromForm(value: FormDataEntryValue | null, fallback = new Date()) {
  if (typeof value !== "string" || !value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function aiConfidence(value: unknown) {
  const text = String(value ?? "LOW").toUpperCase();
  if (text === "HIGH") return AiConfidence.HIGH;
  if (text === "MEDIUM") return AiConfidence.MEDIUM;
  return AiConfidence.LOW;
}

function transcriptType(value: unknown) {
  const text = String(value ?? "UNKNOWN").toUpperCase();
  return Object.values(TranscriptType).includes(text as TranscriptType) ? (text as TranscriptType) : TranscriptType.UNKNOWN;
}

async function saveScreenshot(file: FormDataEntryValue | null, tradeId?: string) {
  if (!(file instanceof File) || file.size === 0 || !tradeId) return;
  const bytes = Buffer.from(await file.arrayBuffer());
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
  const fileName = `${tradeId}-${Date.now()}-${safeName}`;
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, fileName), bytes);
  await db.create("screenshots", {
    createdAt: new Date(),
    filePath: `/uploads/${fileName}`,
    caption: "Trade context",
    linkedTradeId: tradeId,
    linkedDailyJournalId: null,
    linkedTranscriptId: null,
  });
}

export async function saveTranscriptAction(formData: FormData) {
  const now = new Date();
  await db.create("transcripts", {
    createdAt: now,
    updatedAt: now,
    transcriptDateTime: dateFromForm(formData.get("transcriptDateTime")),
    sourceTool: toText(formData.get("sourceTool")),
    rawText: toText(formData.get("rawText")) ?? "",
    cleanedSummary: null,
    transcriptType: enumValue(TranscriptType, formData.get("transcriptType"), TranscriptType.UNKNOWN),
    processingStatus: ProcessingStatus.UNPROCESSED,
    linkedTradeId: null,
    linkedDailyJournalId: null,
    structuredJson: null,
    aiConfidence: null,
  });
  revalidatePath("/inbox");
}

export async function structureTranscriptAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = await db.get("transcripts", id);
  if (!transcript) return;
  const extraction = await structureTranscript(transcript.rawText, transcript.transcriptType);
  await db.update("transcripts", id, {
    transcriptType: transcriptType(extraction.transcriptType),
    structuredJson: JSON.stringify(extraction, null, 2),
    processingStatus: ProcessingStatus.STRUCTURED,
    aiConfidence: aiConfidence(extraction.confidence),
    cleanedSummary: buildTranscriptSummary(extraction),
    updatedAt: new Date(),
  });
  revalidatePath("/inbox");
}

export async function confirmTranscriptAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = await db.get("transcripts", id);
  if (!transcript) return;
  const structured = transcript.structuredJson ? JSON.parse(transcript.structuredJson) as StructuredJson : {};
  const type = transcriptType(structured.transcriptType ?? transcript.transcriptType);
  let linkedTradeId = transcript.linkedTradeId;
  let linkedDailyJournalId = transcript.linkedDailyJournalId;

  if (type === "TRADE_ENTRY_NOTE" || (structured.instrument && !linkedTradeId && type !== "EOD_REVIEW")) {
    const trade = await createTradeFromStructured(transcript.transcriptDateTime, structured);
    linkedTradeId = trade.id;
    await linkSuggestedMistakes(trade.id, structured.suggestedMistakeTags);
  }

  if (type === "TRADE_EXIT_REVIEW" && linkedTradeId) {
    await db.update("trades", linkedTradeId, {
      status: TradeStatus.CLOSED,
      exitReason: nullableString(structured.exitReason),
      followedPlan: enumFromText(FollowedPlan, structured.followedPlan, FollowedPlan.NA),
      emotionalState: enumFromText(EmotionalState, structured.emotionalState, EmotionalState.UNKNOWN),
      lesson: nullableString(structured.lesson),
      updatedAt: new Date(),
    });
    await linkSuggestedMistakes(linkedTradeId, structured.suggestedMistakeTags);
  }

  if (type === "EOD_REVIEW" || type === "DAILY_CHECKIN") {
    const day = startOfDay(transcript.transcriptDateTime);
    const existing = await getTodayJournal(day);
    const payload = {
      tradedToday: nullableBool(structured.tradedToday),
      followedMaxLoss: nullableBool(structured.followedMaxLoss),
      followedMaxTrades: nullableBool(structured.followedMaxTrades),
      bestDecision: nullableString(structured.bestDecision),
      worstDecision: nullableString(structured.worstDecision),
      mainEmotion: nullableString(structured.mainEmotion),
      mainMistake: nullableString(structured.mainMistake),
      oneThingDoneWell: nullableString(structured.oneThingDoneWell),
      oneThingToAvoidTomorrow: nullableString(structured.oneThingToAvoidTomorrow),
      disciplineScore: nullableNumber(structured.disciplineScore),
      updatedAt: new Date(),
    };
    const daily = existing
      ? await db.update("dailyJournals", existing.id, payload)
      : await db.create("dailyJournals", {
          id: newId(),
          date: day,
          createdAt: new Date(),
          tradingMode: TradingMode.PAPER,
          marketsWatched: null,
          maxLossForDay: null,
          maxTradesForDay: null,
          currentState: null,
          learningFocus: null,
          reasonNotToTrade: null,
          eodNotes: null,
          ...payload,
        });
    linkedDailyJournalId = daily.id;
  }

  await createLessonsFromStructured(structured, id, linkedTradeId ?? undefined);
  await db.update("transcripts", id, {
    linkedTradeId,
    linkedDailyJournalId,
    processingStatus: ProcessingStatus.CONFIRMED,
    updatedAt: new Date(),
  });
  revalidatePath("/inbox");
  revalidatePath("/trades");
  revalidatePath("/daily");
  revalidatePath("/lessons");
}

export async function archiveTranscriptAction(formData: FormData) {
  await db.update("transcripts", String(formData.get("id")), {
    processingStatus: ProcessingStatus.ARCHIVED,
    updatedAt: new Date(),
  });
  revalidatePath("/inbox");
}

export async function updateTranscriptAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.update("transcripts", id, {
    transcriptDateTime: dateFromForm(formData.get("transcriptDateTime")),
    sourceTool: toText(formData.get("sourceTool")),
    rawText: toText(formData.get("rawText")) ?? "",
    transcriptType: enumValue(TranscriptType, formData.get("transcriptType"), TranscriptType.UNKNOWN),
    processingStatus: ProcessingStatus.UNPROCESSED,
    cleanedSummary: null,
    structuredJson: null,
    aiConfidence: null,
    updatedAt: new Date(),
  });
  revalidatePath("/inbox");
}

export async function deleteTranscriptAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.deleteWhere("transcripts", (transcript) => transcript.id === id);
  await db.deleteWhere("screenshots", (screenshot) => screenshot.linkedTranscriptId === id);
  const lessons = await db.list("lessons");
  await Promise.all(
    lessons
      .filter((lesson) => lesson.linkedTranscriptId === id)
      .map((lesson) => db.update("lessons", lesson.id, { linkedTranscriptId: null, updatedAt: new Date() })),
  );
  revalidatePath("/inbox");
  revalidatePath("/lessons");
}

export async function linkTranscriptAction(formData: FormData) {
  await db.update("transcripts", String(formData.get("id")), {
    linkedTradeId: toText(formData.get("linkedTradeId")),
    linkedDailyJournalId: toText(formData.get("linkedDailyJournalId")),
    updatedAt: new Date(),
  });
  revalidatePath("/inbox");
}

export async function extractLessonsAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = await db.get("transcripts", id);
  if (!transcript) return;
  const structured = transcript.structuredJson ? JSON.parse(transcript.structuredJson) as StructuredJson : await structureTranscript(transcript.rawText, transcript.transcriptType);
  await createLessonsFromStructured(structured, id, transcript.linkedTradeId ?? undefined);
  revalidatePath("/lessons");
  revalidatePath("/inbox");
}

export async function saveDailyJournalAction(formData: FormData) {
  const date = startOfDay(dateFromForm(formData.get("date")));
  const existing = await getTodayJournal(date);
  const payload = {
    date,
    tradingMode: enumValue(TradingMode, formData.get("tradingMode"), TradingMode.PAPER),
    marketsWatched: toText(formData.get("marketsWatched")),
    maxLossForDay: toText(formData.get("maxLossForDay")),
    maxTradesForDay: toNumber(formData.get("maxTradesForDay")),
    currentState: optionalEnum(CurrentState, formData.get("currentState")),
    learningFocus: toText(formData.get("learningFocus")),
    reasonNotToTrade: toText(formData.get("reasonNotToTrade")),
    tradedToday: boolFromForm(formData.get("tradedToday")),
    followedMaxLoss: boolFromForm(formData.get("followedMaxLoss")),
    followedMaxTrades: boolFromForm(formData.get("followedMaxTrades")),
    bestDecision: toText(formData.get("bestDecision")),
    worstDecision: toText(formData.get("worstDecision")),
    mainEmotion: toText(formData.get("mainEmotion")),
    mainMistake: toText(formData.get("mainMistake")),
    oneThingDoneWell: toText(formData.get("oneThingDoneWell")),
    oneThingToAvoidTomorrow: toText(formData.get("oneThingToAvoidTomorrow")),
    disciplineScore: toNumber(formData.get("disciplineScore")),
    eodNotes: toText(formData.get("eodNotes")),
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update("dailyJournals", existing.id, payload);
  } else {
    await db.create("dailyJournals", { id: newId(), createdAt: new Date(), ...payload });
  }
  revalidatePath("/daily");
  revalidatePath("/");
}

export async function deleteDailyJournalAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.deleteWhere("dailyJournals", (journal) => journal.id === id);
  await db.deleteWhere("screenshots", (screenshot) => screenshot.linkedDailyJournalId === id);
  const transcripts = await db.list("transcripts");
  await Promise.all(
    transcripts
      .filter((transcript) => transcript.linkedDailyJournalId === id)
      .map((transcript) => db.update("transcripts", transcript.id, { linkedDailyJournalId: null, updatedAt: new Date() })),
  );
  revalidatePath("/daily");
  revalidatePath("/");
  revalidatePath("/inbox");
}

export async function createTradeAction(formData: FormData) {
  const numeric = objectiveNumbers(formData);
  const now = new Date();
  const trade = await db.create("trades", {
    createdAt: now,
    updatedAt: now,
    tradeDateTime: now,
    marketType: enumValue(MarketType, formData.get("marketType"), MarketType.CRYPTO_PERP),
    instrument: String(formData.get("instrument") ?? "").trim().toUpperCase(),
    direction: enumValue(Direction, formData.get("direction"), Direction.UNKNOWN),
    status: enumValue(TradeStatus, formData.get("status"), TradeStatus.IDEA),
    entryThesis: toText(formData.get("entryThesis")),
    setupName: toText(formData.get("setupName")),
    invalidation: toText(formData.get("invalidation")),
    concern: toText(formData.get("concern")),
    emotionalState: optionalEnum(EmotionalState, formData.get("emotionalState")),
    riskPosture: optionalEnum(RiskPosture, formData.get("riskPosture")),
    confidenceScore: toNumber(formData.get("confidenceScore")),
    entryGrade: enumValue(EntryGrade, formData.get("entryGrade"), EntryGrade.NA),
    exitReason: null,
    followedPlan: null,
    lesson: null,
    notes: null,
    ...numeric,
  });
  await saveScreenshot(formData.get("screenshot"), trade.id);
  revalidatePath("/trades");
  redirect(`/trades/${trade.id}`);
}

export async function updateTradeAction(formData: FormData) {
  const id = String(formData.get("id"));
  const numeric = objectiveNumbers(formData);
  await db.update("trades", id, {
    tradeDateTime: dateFromForm(formData.get("tradeDateTime")),
    marketType: enumValue(MarketType, formData.get("marketType"), MarketType.CRYPTO_PERP),
    instrument: String(formData.get("instrument") ?? "").trim().toUpperCase(),
    direction: enumValue(Direction, formData.get("direction"), Direction.UNKNOWN),
    status: enumValue(TradeStatus, formData.get("status"), TradeStatus.IDEA),
    setupName: toText(formData.get("setupName")),
    entryThesis: toText(formData.get("entryThesis")),
    invalidation: toText(formData.get("invalidation")),
    concern: toText(formData.get("concern")),
    emotionalState: optionalEnum(EmotionalState, formData.get("emotionalState")),
    riskPosture: optionalEnum(RiskPosture, formData.get("riskPosture")),
    confidenceScore: toNumber(formData.get("confidenceScore")),
    entryGrade: enumValue(EntryGrade, formData.get("entryGrade"), EntryGrade.NA),
    exitReason: toText(formData.get("exitReason")),
    followedPlan: optionalEnum(FollowedPlan, formData.get("followedPlan")),
    lesson: toText(formData.get("lesson")),
    notes: toText(formData.get("notes")),
    updatedAt: new Date(),
    ...numeric,
  });
  await db.deleteWhere("tradeMistakes", (link) => link.tradeId === id);
  for (const mistakeTagId of formData.getAll("mistakeTagId").map(String)) {
    await db.create("tradeMistakes", { tradeId: id, mistakeTagId });
  }
  await saveScreenshot(formData.get("screenshot"), id);
  revalidatePath(`/trades/${id}`);
  revalidatePath("/trades");
}

export async function deleteTradeAction(formData: FormData) {
  const id = String(formData.get("id"));
  const redirectTo = toText(formData.get("redirectTo"));
  await db.deleteWhere("trades", (trade) => trade.id === id);
  await db.deleteWhere("tradeMistakes", (link) => link.tradeId === id);
  await db.deleteWhere("screenshots", (screenshot) => screenshot.linkedTradeId === id);
  const [transcripts, lessons, rawExecutions] = await Promise.all([
    db.list("transcripts"),
    db.list("lessons"),
    db.list("rawExecutions"),
  ]);
  await Promise.all([
    ...transcripts
      .filter((transcript) => transcript.linkedTradeId === id)
      .map((transcript) => db.update("transcripts", transcript.id, { linkedTradeId: null, updatedAt: new Date() })),
    ...lessons
      .filter((lesson) => lesson.linkedTradeId === id)
      .map((lesson) => db.update("lessons", lesson.id, { linkedTradeId: null, updatedAt: new Date() })),
    ...rawExecutions
      .filter((execution) => execution.linkedTradeId === id)
      .map((execution) => db.update("rawExecutions", execution.id, { linkedTradeId: null })),
  ]);
  revalidatePath("/trades");
  revalidatePath("/inbox");
  revalidatePath("/lessons");
  revalidatePath("/import");
  if (redirectTo) redirect(redirectTo);
}

export async function createLessonFromTradeAction(formData: FormData) {
  const tradeId = String(formData.get("tradeId"));
  const lessonText = toText(formData.get("lessonText"));
  if (!lessonText) return;
  await createLesson({
    lessonText,
    category: enumValue(LessonCategory, formData.get("category"), LessonCategory.PROCESS),
    sourceType: LessonSourceType.TRADE,
    linkedTradeId: tradeId,
    linkedTranscriptId: null,
  });
  revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/lessons");
}

export async function addManualLessonAction(formData: FormData) {
  const lessonText = toText(formData.get("lessonText"));
  if (!lessonText) return;
  await createLesson({
    lessonText,
    category: enumValue(LessonCategory, formData.get("category"), LessonCategory.PROCESS),
    sourceType: LessonSourceType.MANUAL,
    linkedTradeId: null,
    linkedTranscriptId: null,
  });
  revalidatePath("/lessons");
}

export async function toggleLessonActiveAction(formData: FormData) {
  const id = String(formData.get("id"));
  const isActive = formData.get("isActive") === "true";
  await db.update("lessons", id, { isActive: !isActive, updatedAt: new Date() });
  revalidatePath("/lessons");
}

export async function updateLessonAction(formData: FormData) {
  const id = String(formData.get("id"));
  const lessonText = toText(formData.get("lessonText"));
  if (!lessonText) return;
  await db.update("lessons", id, {
    lessonText,
    category: enumValue(LessonCategory, formData.get("category"), LessonCategory.PROCESS),
    updatedAt: new Date(),
  });
  revalidatePath("/lessons");
}

export async function deleteLessonAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.deleteWhere("lessons", (lesson) => lesson.id === id);
  revalidatePath("/lessons");
  revalidatePath("/trades");
}

export async function linkRawExecutionAction(formData: FormData) {
  const rawExecutionId = String(formData.get("rawExecutionId"));
  const linkedTradeId = toText(formData.get("linkedTradeId"));
  await db.update("rawExecutions", rawExecutionId, { linkedTradeId });
  revalidatePath("/import");
  if (linkedTradeId) revalidatePath(`/trades/${linkedTradeId}`);
}

export async function updateRawExecutionAction(formData: FormData) {
  const id = String(formData.get("rawExecutionId"));
  const price = toNumber(formData.get("price"));
  const orderFields = calculateOrderFields({
    price,
    quantity: toNumber(formData.get("quantity")),
    totalOrderValue: toNumber(formData.get("totalOrderValue")),
  });
  await db.update("rawExecutions", id, {
    executionDateTime: dateFromForm(formData.get("executionDateTime")),
    exchangeBroker: toText(formData.get("exchangeBroker")),
    instrument: String(formData.get("instrument") ?? "").trim().toUpperCase(),
    side: toText(formData.get("side")),
    price,
    quantity: orderFields.quantity,
    totalOrderValue: orderFields.totalOrderValue,
    fees: toNumber(formData.get("fees")),
    funding: toNumber(formData.get("funding")),
    realizedPnl: toNumber(formData.get("realizedPnl")),
    orderId: toText(formData.get("orderId")),
  });
  revalidatePath("/import");
}

export async function deleteRawExecutionAction(formData: FormData) {
  const id = String(formData.get("rawExecutionId"));
  await db.deleteWhere("rawExecutions", (execution) => execution.id === id);
  revalidatePath("/import");
  revalidatePath("/trades");
}

export async function deleteImportBatchAction(formData: FormData) {
  const id = String(formData.get("importBatchId"));
  await db.deleteWhere("importBatches", (batch) => batch.id === id);
  await db.deleteWhere("rawExecutions", (execution) => execution.importBatchId === id);
  revalidatePath("/import");
}

export async function saveSettingsAction(formData: FormData) {
  const settings: AppSettings = {
    aiEnabled: formData.get("aiEnabled") === "on",
    defaultMarketType: String(formData.get("defaultMarketType") ?? "CRYPTO_PERP"),
    defaultSourceTool: String(formData.get("defaultSourceTool") ?? "Voice memo"),
    promptTemplates: {
      tradeEntry: String(formData.get("tradeEntry") ?? defaultPromptTemplates.tradeEntry),
      tradeExit: String(formData.get("tradeExit") ?? defaultPromptTemplates.tradeExit),
      eodReview: String(formData.get("eodReview") ?? defaultPromptTemplates.eodReview),
      lessonExtraction: String(formData.get("lessonExtraction") ?? defaultPromptTemplates.lessonExtraction),
      weeklyReview: String(formData.get("weeklyReview") ?? defaultPromptTemplates.weeklyReview),
    },
  };
  await saveSettings(settings);
  revalidatePath("/settings");
}

export async function generateWeeklyReviewAction(formData: FormData) {
  const selectedDate = dateFromForm(formData.get("weekDate"));
  const { weekStart, weekEnd } = weekBounds(selectedDate);
  const [trades, lessons] = await Promise.all([
    getClosedTradesInRange(weekStart, weekEnd),
    db.list("lessons"),
  ]);
  const weekLessons = lessons.filter((lesson) => lesson.createdAt >= weekStart && lesson.createdAt <= endOfDay(weekEnd) && lesson.isActive);
  const stats = summarizeWeeklyStats(trades, weekStart, weekEnd);
  const summaryText = [
    `Closed trades: ${stats.totalTrades}.`,
    `Net P&L: ${formatMaybe(stats.totalPnl)}.`,
    stats.totalR == null ? null : `Total R: ${stats.totalR.toFixed(2)}.`,
    stats.winRate == null ? null : `Win rate: ${(stats.winRate * 100).toFixed(0)}%.`,
    stats.ruleAdherenceRate == null ? null : `Rule adherence: ${(stats.ruleAdherenceRate * 100).toFixed(0)}%.`,
    stats.mostCommonMistake ? `Most common mistake: ${stats.mostCommonMistake}.` : null,
    stats.mostCommonEmotionalState ? `Main emotional pattern: ${stats.mostCommonEmotionalState}.` : null,
    weekLessons[0]?.lessonText ? `Best lesson: ${weekLessons[0].lessonText}` : "Best lesson: keep reviews specific and short.",
  ].filter(Boolean).join(" ");

  await db.create("weeklyReviews", {
    createdAt: new Date(),
    weekStart,
    weekEnd,
    summaryText,
    totalTrades: stats.totalTrades,
    totalPnl: stats.totalPnl,
    totalR: stats.totalR,
    winRate: stats.winRate,
    profitFactor: stats.profitFactor,
    expectancy: stats.expectancy,
    ruleAdherenceRate: stats.ruleAdherenceRate,
    mostCommonMistake: stats.mostCommonMistake,
    bestLesson: weekLessons[0]?.lessonText ?? null,
    actionItem: stats.mostCommonMistake ? `Reduce ${stats.mostCommonMistake.toLowerCase()} next week.` : "Write one clear invalidation before every trade.",
  });
  revalidatePath("/weekly-review");
  revalidatePath("/");
}

export async function updateWeeklyReviewAction(formData: FormData) {
  const id = String(formData.get("id"));
  const summaryText = toText(formData.get("summaryText"));
  if (!summaryText) return;
  await db.update("weeklyReviews", id, {
    summaryText,
    bestLesson: toText(formData.get("bestLesson")),
    actionItem: toText(formData.get("actionItem")),
  });
  revalidatePath("/weekly-review");
}

export async function deleteWeeklyReviewAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.deleteWhere("weeklyReviews", (review) => review.id === id);
  revalidatePath("/weekly-review");
}

function objectiveNumbers(formData: FormData) {
  const entryPrice = toNumber(formData.get("entryPrice"));
  const stopPrice = toNumber(formData.get("stopPrice"));
  const exitPrice = toNumber(formData.get("exitPrice"));
  const realizedPnl = toNumber(formData.get("realizedPnl"));
  const fees = toNumber(formData.get("fees"));
  const funding = toNumber(formData.get("funding"));
  const direction = String(formData.get("direction") ?? "UNKNOWN");
  const orderFields = calculateOrderFields({
    price: entryPrice,
    quantity: toNumber(formData.get("quantity")),
    totalOrderValue: toNumber(formData.get("totalOrderValue")),
  });
  return {
    entryPrice,
    stopPrice,
    targetPrice: toNumber(formData.get("targetPrice")),
    exitPrice,
    quantity: orderFields.quantity,
    totalOrderValue: orderFields.totalOrderValue,
    leverage: toNumber(formData.get("leverage")),
    realizedPnl,
    fees,
    funding,
    netPnl: calculateNetPnl(realizedPnl, fees, funding),
    rMultiple: calculateRMultiple({ entryPrice, stopPrice, exitPrice, direction }),
  };
}

async function createTradeFromStructured(tradeDateTime: Date, structured: StructuredJson) {
  return db.create("trades", {
    createdAt: new Date(),
    updatedAt: new Date(),
    tradeDateTime,
    marketType: MarketType.CRYPTO_PERP,
    instrument: String(structured.instrument ?? "UNKNOWN").toUpperCase(),
    direction: enumFromText(Direction, structured.direction, Direction.UNKNOWN),
    status: TradeStatus.IDEA,
    setupName: nullableString(structured.setupName),
    entryThesis: nullableString(structured.entryThesis),
    invalidation: nullableString(structured.invalidation),
    concern: nullableString(structured.concern),
    emotionalState: enumFromText(EmotionalState, structured.emotionalState, EmotionalState.UNKNOWN),
    riskPosture: enumFromText(RiskPosture, structured.riskPosture, RiskPosture.UNKNOWN),
    confidenceScore: nullableNumber(structured.confidenceScore),
    entryGrade: enumFromText(EntryGrade, structured.entryGrade, EntryGrade.NA),
    exitReason: null,
    followedPlan: null,
    lesson: null,
    notes: null,
    entryPrice: null,
    stopPrice: null,
    targetPrice: null,
    exitPrice: null,
    quantity: null,
    totalOrderValue: null,
    leverage: null,
    realizedPnl: null,
    fees: null,
    funding: null,
    netPnl: null,
    rMultiple: null,
  });
}

async function linkSuggestedMistakes(tradeId: string, tags: unknown) {
  if (!Array.isArray(tags) || !tags.length) return;
  const allTags = await db.list("mistakeTags");
  const existing = await db.list("tradeMistakes");
  const existingIds = new Set(existing.filter((link) => link.tradeId === tradeId).map((link) => link.mistakeTagId));
  for (const mistake of allTags.filter((tag) => tags.map(String).includes(tag.name) && !existingIds.has(tag.id))) {
    await db.create("tradeMistakes", { tradeId, mistakeTagId: mistake.id });
  }
}

async function createLessonsFromStructured(structured: StructuredJson, transcriptId: string, tradeId?: string) {
  const rawLessons = Array.isArray(structured.lessons) ? structured.lessons : structured.lesson ? [structured.lesson] : [];
  for (const raw of rawLessons) {
    const rawRecord = asRecord(raw);
    const lessonText = typeof raw === "string" ? raw : stringFromUnknown(rawRecord?.lessonText);
    if (!lessonText) continue;
    await createLesson({
      lessonText,
      category: enumFromText(LessonCategory, rawRecord?.category, LessonCategory.PROCESS),
      sourceType: LessonSourceType.TRANSCRIPT,
      linkedTranscriptId: transcriptId,
      linkedTradeId: tradeId ?? null,
    });
  }
}

async function createLesson(input: Omit<Lesson, "id" | "createdAt" | "updatedAt" | "isActive">) {
  await db.create("lessons", {
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true,
    ...input,
  });
}

function buildTranscriptSummary(structured: StructuredJson) {
  return [
    structured.instrument,
    structured.direction,
    structured.setupName,
    structured.entryThesis ?? structured.exitReason ?? structured.bestDecision,
  ].filter(Boolean).join(" | ").slice(0, 500) || null;
}

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringFromUnknown(value: unknown) {
  return typeof value === "string" ? value : null;
}

function enumFromText<T extends Record<string, string>>(enumObject: T, value: unknown, fallback: T[keyof T]) {
  const text = String(value ?? "").toUpperCase();
  return Object.values(enumObject).includes(text as T[keyof T]) ? (text as T[keyof T]) : fallback;
}

function nullableString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nullableBool(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function formatMaybe(value: number | null | undefined) {
  return value == null ? "not available" : value.toFixed(2);
}
