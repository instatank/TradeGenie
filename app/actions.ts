"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { endOfDay, format, startOfDay } from "date-fns";
import { conditionTagValues } from "@/lib/constants";
import { db, getClosedTradesInRange, getTodayJournal } from "@/lib/data";
import { calculateNetPnl, calculateOrderFields, calculateRMultiple, summarizeWeeklyStats, toNumber, toText, weekBounds } from "@/lib/metrics";
import { PROMPT_TEMPLATES_VERSION, defaultPromptTemplates } from "@/lib/prompts";
import { structureAssetNote } from "@/lib/asset-note-structurer";
import { saveScreenshotFile } from "@/lib/screenshot-storage";
import { getSettings, saveSettings, type AppSettings } from "@/lib/settings-store";
import { newId } from "@/lib/store";
import { structureTranscript } from "@/lib/transcript-processor";
import {
  AiConfidence,
  AssetTimeframe,
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
  SetupDirectionBias,
  TradeStatus,
  TranscriptType,
  TradingMode,
  type Lesson,
} from "@/lib/types";

type StructuredJson = Record<string, unknown>;

function withFeedback(target: string, message: string, type = "success") {
  const url = new URL(target, "http://tradeforge.local");
  url.searchParams.set("feedback", message);
  url.searchParams.set("feedbackType", type);
  return `${url.pathname}${url.search}${url.hash}`;
}

async function currentPathFallback(fallback: string) {
  const headerList = await headers();
  const referer = headerList.get("referer");
  if (!referer) return fallback;
  try {
    const url = new URL(referer);
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

async function redirectBackWithFeedback(message: string, fallback: string) {
  redirect(withFeedback(await currentPathFallback(fallback), message));
}

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
  const filePath = await saveScreenshotFile(file, tradeId);
  await db.create("screenshots", {
    createdAt: new Date(),
    filePath,
    caption: "Trade context",
    linkedTradeId: tradeId,
    linkedDailyJournalId: null,
    linkedTranscriptId: null,
  });
}

export async function saveTranscriptAction(formData: FormData) {
  const now = new Date();
  const declaredType = enumValue(TranscriptType, formData.get("transcriptType"), TranscriptType.UNKNOWN);
  const rawText = toText(formData.get("rawText")) ?? "";
  const created = await db.create("transcripts", {
    createdAt: now,
    updatedAt: now,
    transcriptDateTime: dateFromForm(formData.get("transcriptDateTime")),
    sourceTool: toText(formData.get("sourceTool")),
    rawText,
    cleanedSummary: null,
    transcriptType: declaredType,
    processingStatus: ProcessingStatus.UNPROCESSED,
    linkedTradeId: null,
    linkedDailyJournalId: null,
    structuredJson: null,
    aiConfidence: null,
  });

  // Auto-structure on save so the note lands as a reviewable draft in a single
  // step — no separate "Structure" click. structureTranscript() never throws
  // (it falls back to a regex mock), so a failure still leaves a usable note.
  if (rawText.trim()) {
    const extraction = await structureTranscript(rawText, declaredType);
    await db.update("transcripts", created.id, {
      transcriptType: transcriptType(extraction.transcriptType),
      structuredJson: JSON.stringify(extraction, null, 2),
      processingStatus: ProcessingStatus.STRUCTURED,
      aiConfidence: aiConfidence(extraction.confidence),
      cleanedSummary: buildTranscriptSummary(extraction),
      updatedAt: new Date(),
    });
  }

  revalidatePath("/inbox");
  redirect(withFeedback("/inbox", "Saved and structured. Review the draft below, then confirm."));
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
  await redirectBackWithFeedback("Voice note structured. Review the draft before confirming.", "/inbox");
}

export async function confirmTranscriptAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = await db.get("transcripts", id);
  if (!transcript) return;
  // Merge any edits the trader made on the review card over the AI draft, so the
  // confirmed record reflects what they actually see and corrected on screen.
  const draft = transcript.structuredJson ? JSON.parse(transcript.structuredJson) as StructuredJson : {};
  const structured: StructuredJson = { ...draft, ...readReviewOverrides(formData) };
  const type = transcriptType(structured.transcriptType ?? transcript.transcriptType);
  let linkedTradeId = transcript.linkedTradeId;
  let linkedDailyJournalId = transcript.linkedDailyJournalId;

  if (type === "TRADE_ENTRY_NOTE" || (structured.instrument && !linkedTradeId && type !== "EOD_REVIEW")) {
    const trade = await createTradeFromStructured(transcript.transcriptDateTime, structured);
    linkedTradeId = trade.id;
    await linkSuggestedMistakes(trade.id, structured.suggestedMistakeTags);
  }

  if (type === "TRADE_EXIT_REVIEW" && linkedTradeId) {
    const existingTrade = await db.get("trades", linkedTradeId);
    const exitPrice = nullableNumber(structured.exitPrice);
    const realizedPnl = nullableNumber(structured.realizedPnl);
    await db.update("trades", linkedTradeId, {
      status: TradeStatus.CLOSED,
      exitReason: nullableString(structured.exitReason),
      followedPlan: enumFromText(FollowedPlan, structured.followedPlan, FollowedPlan.NA),
      emotionalState: enumFromText(EmotionalState, structured.emotionalState, EmotionalState.UNKNOWN),
      lesson: nullableString(structured.lesson),
      ...(exitPrice != null ? { exitPrice } : {}),
      ...(realizedPnl != null ? { realizedPnl, netPnl: calculateNetPnl(realizedPnl, existingTrade?.fees, existingTrade?.funding) } : {}),
      ...(exitPrice != null && existingTrade
        ? { rMultiple: calculateRMultiple({ entryPrice: existingTrade.entryPrice, stopPrice: existingTrade.stopPrice, exitPrice, direction: existingTrade.direction }) }
        : {}),
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
  if (linkedTradeId && (type === "TRADE_ENTRY_NOTE" || type === "TRADE_EXIT_REVIEW")) {
    // Stay on the inbox instead of forcing a second confirmation on the trade
    // page. The confirmed note links straight to the saved trade if needed.
    redirect(withFeedback("/inbox?view=confirmed", type === "TRADE_ENTRY_NOTE" ? "Trade saved to your log." : "Exit review saved to the linked trade."));
  }
  if (linkedDailyJournalId && (type === "EOD_REVIEW" || type === "DAILY_CHECKIN")) {
    redirect(withFeedback(`/daily?date=${format(transcript.transcriptDateTime, "yyyy-MM-dd")}`, type === "EOD_REVIEW" ? "EOD review saved." : "Daily check-in saved."));
  }
  redirect(withFeedback("/lessons", "Transcript confirmed and lessons saved."));
}

export async function archiveTranscriptAction(formData: FormData) {
  await db.update("transcripts", String(formData.get("id")), {
    processingStatus: ProcessingStatus.ARCHIVED,
    updatedAt: new Date(),
  });
  revalidatePath("/inbox");
  await redirectBackWithFeedback("Voice note archived.", "/inbox");
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
  await redirectBackWithFeedback("Voice note edits saved.", "/inbox");
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
  await redirectBackWithFeedback("Voice note deleted.", "/inbox");
}

export async function linkTranscriptAction(formData: FormData) {
  await db.update("transcripts", String(formData.get("id")), {
    linkedTradeId: toText(formData.get("linkedTradeId")),
    linkedDailyJournalId: toText(formData.get("linkedDailyJournalId")),
    updatedAt: new Date(),
  });
  revalidatePath("/inbox");
  await redirectBackWithFeedback("Voice note links saved.", "/inbox");
}

export async function extractLessonsAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = await db.get("transcripts", id);
  if (!transcript) return;
  const structured = transcript.structuredJson ? JSON.parse(transcript.structuredJson) as StructuredJson : await structureTranscript(transcript.rawText, transcript.transcriptType);
  await createLessonsFromStructured(structured, id, transcript.linkedTradeId ?? undefined);
  revalidatePath("/lessons");
  revalidatePath("/inbox");
  await redirectBackWithFeedback("Lessons saved from voice note.", "/inbox");
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
  redirect(withFeedback(`/daily?date=${format(date, "yyyy-MM-dd")}`, "Daily journal saved."));
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
  redirect(withFeedback("/daily", "Daily journal deleted."));
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
    setupId: toText(formData.get("setupId")),
    premortem: toText(formData.get("premortem")),
    conditions: cleanConditions(formData.getAll("conditions")),
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
  redirect(withFeedback(`/trades/${trade.id}`, "Trade note saved."));
}

// The simplified daily-loop quick log: symbol + direction + status, everything
// else optional. Never requires free text; numbers are captured only if typed.
export async function quickLogTradeAction(formData: FormData) {
  const redirectTo = toText(formData.get("redirectTo")) ?? "/";
  // Typed symbol wins; otherwise the one-tap recent-symbol chip.
  const instrument = (String(formData.get("instrument") ?? "").trim() || String(formData.get("instrumentChip") ?? "").trim()).toUpperCase();
  if (!instrument) {
    redirect(withFeedback(redirectTo, "Type a symbol (like BTC) to log the trade.", "error"));
  }
  const settings = await getSettings();
  const direction = enumValue(Direction, formData.get("direction"), Direction.UNKNOWN);
  const status = enumValue(TradeStatus, formData.get("status"), TradeStatus.OPEN);
  const entryPrice = toNumber(formData.get("entryPrice"));
  const stopPrice = toNumber(formData.get("stopPrice"));
  const exitPrice = toNumber(formData.get("exitPrice"));
  const realizedPnl = toNumber(formData.get("realizedPnl"));
  const now = new Date();
  const trade = await db.create("trades", {
    createdAt: now,
    updatedAt: now,
    tradeDateTime: now,
    marketType: enumValue(MarketType, settings.defaultMarketType, MarketType.CRYPTO_PERP),
    instrument,
    direction,
    status,
    setupName: null,
    setupId: null,
    entryThesis: toText(formData.get("entryThesis")),
    premortem: null,
    conditions: [],
    invalidation: null,
    concern: null,
    emotionalState: optionalEnum(EmotionalState, formData.get("emotionalState")),
    riskPosture: null,
    confidenceScore: null,
    entryGrade: EntryGrade.NA,
    exitReason: null,
    followedPlan: null,
    lesson: null,
    notes: null,
    entryPrice,
    stopPrice,
    targetPrice: null,
    exitPrice,
    maePrice: null,
    mfePrice: null,
    quantity: null,
    totalOrderValue: null,
    leverage: null,
    realizedPnl,
    fees: null,
    funding: null,
    netPnl: calculateNetPnl(realizedPnl, null, null),
    rMultiple: calculateRMultiple({ entryPrice, stopPrice, exitPrice, direction }),
  });
  revalidatePath("/trades");
  revalidatePath("/");
  const label = `${instrument}${direction === "UNKNOWN" ? "" : ` ${direction.toLowerCase()}`}`;
  if (status === TradeStatus.CLOSED) {
    redirect(withFeedback(`/trades/${trade.id}`, `${label} logged. Take one minute to review it below.`));
  }
  redirect(withFeedback(redirectTo, `${label} logged. Review it when you close it.`));
}

// One-screen "close & review" ritual on the trade page: outcome numbers,
// followed-plan, execution grade, mistake chips, one lesson. Only the mistake
// tags that were shown as chips are replaced, so tags picked from the full
// list elsewhere are never silently dropped.
export async function reviewTradeAction(formData: FormData) {
  const id = String(formData.get("id"));
  const trade = await db.get("trades", id);
  if (!trade) return;
  const exitPrice = toNumber(formData.get("exitPrice")) ?? trade.exitPrice;
  const realizedPnl = toNumber(formData.get("realizedPnl")) ?? trade.realizedPnl;
  const stillOpen = formData.get("outcome") === "OPEN";
  const lesson = toText(formData.get("lesson"));
  await db.update("trades", id, {
    status: stillOpen ? TradeStatus.OPEN : TradeStatus.CLOSED,
    exitPrice: stillOpen ? trade.exitPrice : exitPrice,
    realizedPnl: stillOpen ? trade.realizedPnl : realizedPnl,
    netPnl: stillOpen ? trade.netPnl : calculateNetPnl(realizedPnl, trade.fees, trade.funding),
    rMultiple: stillOpen
      ? trade.rMultiple
      : calculateRMultiple({ entryPrice: trade.entryPrice, stopPrice: trade.stopPrice, exitPrice, direction: trade.direction }) ?? trade.rMultiple,
    exitReason: toText(formData.get("exitReason")) ?? trade.exitReason,
    followedPlan: optionalEnum(FollowedPlan, formData.get("followedPlan")) ?? trade.followedPlan,
    entryGrade: enumValue(EntryGrade, formData.get("entryGrade"), trade.entryGrade),
    lesson: lesson ?? trade.lesson,
    updatedAt: new Date(),
  });

  const shownTagIds = String(formData.get("shownMistakeTagIds") ?? "").split(",").filter(Boolean);
  if (shownTagIds.length) {
    const shown = new Set(shownTagIds);
    const picked = formData.getAll("mistakeTagId").map(String).filter((tagId) => shown.has(tagId));
    await db.deleteWhere("tradeMistakes", (link) => link.tradeId === id && shown.has(link.mistakeTagId));
    for (const mistakeTagId of picked) {
      await db.create("tradeMistakes", { tradeId: id, mistakeTagId });
    }
  }

  // Turn the reflection into a reusable lesson with zero extra clicks.
  if (lesson) {
    const lessons = await db.list("lessons");
    const duplicate = lessons.some((entry) => entry.linkedTradeId === id && entry.lessonText.trim() === lesson.trim());
    if (!duplicate) {
      await createLesson({
        lessonText: lesson,
        category: LessonCategory.PROCESS,
        sourceType: LessonSourceType.TRADE,
        linkedTradeId: id,
        linkedTranscriptId: null,
      });
    }
  }

  revalidatePath(`/trades/${id}`);
  revalidatePath("/trades");
  revalidatePath("/");
  revalidatePath("/lessons");
  redirect(withFeedback(`/trades/${id}`, stillOpen ? "Review saved — trade stays open." : "Trade reviewed and closed. Good work showing up."));
}

// Morning and evening save only their own fields (merged over the existing
// journal), so finishing the evening never wipes the morning and vice versa.
export async function saveMorningCheckinAction(formData: FormData) {
  const date = startOfDay(dateFromForm(formData.get("date")));
  const existing = await getTodayJournal(date);
  const payload = {
    tradingMode: enumValue(TradingMode, formData.get("tradingMode"), existing?.tradingMode ?? TradingMode.PAPER),
    currentState: optionalEnum(CurrentState, formData.get("currentState")) ?? existing?.currentState ?? null,
    maxLossForDay: toText(formData.get("maxLossForDay")),
    maxTradesForDay: toNumber(formData.get("maxTradesForDay")),
    learningFocus: toText(formData.get("learningFocus")),
    marketsWatched: formData.has("marketsWatched") ? toText(formData.get("marketsWatched")) : existing?.marketsWatched ?? null,
    reasonNotToTrade: formData.has("reasonNotToTrade") ? toText(formData.get("reasonNotToTrade")) : existing?.reasonNotToTrade ?? null,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update("dailyJournals", existing.id, payload);
  } else {
    await db.create("dailyJournals", {
      id: newId(),
      date,
      createdAt: new Date(),
      tradedToday: null,
      followedMaxLoss: null,
      followedMaxTrades: null,
      bestDecision: null,
      worstDecision: null,
      mainEmotion: null,
      mainMistake: null,
      oneThingDoneWell: null,
      oneThingToAvoidTomorrow: null,
      disciplineScore: null,
      eodNotes: null,
      ...payload,
    });
  }
  revalidatePath("/daily");
  revalidatePath("/");
  redirect(withFeedback(toText(formData.get("redirectTo")) ?? `/daily?date=${format(date, "yyyy-MM-dd")}`, "Checked in. Have a disciplined day."));
}

export async function saveEveningReviewAction(formData: FormData) {
  const date = startOfDay(dateFromForm(formData.get("date")));
  const existing = await getTodayJournal(date);
  const payload = {
    tradedToday: boolFromForm(formData.get("tradedToday")),
    followedMaxLoss: boolFromForm(formData.get("followedMaxLoss")),
    followedMaxTrades: boolFromForm(formData.get("followedMaxTrades")),
    oneThingDoneWell: toText(formData.get("oneThingDoneWell")),
    oneThingToAvoidTomorrow: toText(formData.get("oneThingToAvoidTomorrow")),
    disciplineScore: toNumber(formData.get("disciplineScore")),
    bestDecision: formData.has("bestDecision") ? toText(formData.get("bestDecision")) : existing?.bestDecision ?? null,
    worstDecision: formData.has("worstDecision") ? toText(formData.get("worstDecision")) : existing?.worstDecision ?? null,
    mainEmotion: formData.has("mainEmotion") ? toText(formData.get("mainEmotion")) : existing?.mainEmotion ?? null,
    mainMistake: formData.has("mainMistake") ? toText(formData.get("mainMistake")) : existing?.mainMistake ?? null,
    eodNotes: formData.has("eodNotes") ? toText(formData.get("eodNotes")) : existing?.eodNotes ?? null,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update("dailyJournals", existing.id, payload);
  } else {
    await db.create("dailyJournals", {
      id: newId(),
      date,
      createdAt: new Date(),
      tradingMode: TradingMode.PAPER,
      marketsWatched: null,
      maxLossForDay: null,
      maxTradesForDay: null,
      currentState: null,
      learningFocus: null,
      reasonNotToTrade: null,
      ...payload,
    });
  }
  revalidatePath("/daily");
  revalidatePath("/");
  redirect(withFeedback(toText(formData.get("redirectTo")) ?? `/daily?date=${format(date, "yyyy-MM-dd")}`, "Day reviewed. That's the habit that compounds."));
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
    setupId: toText(formData.get("setupId")),
    premortem: toText(formData.get("premortem")),
    conditions: cleanConditions(formData.getAll("conditions")),
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
  redirect(withFeedback(`/trades/${id}`, "Trade changes saved."));
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
  if (redirectTo) redirect(withFeedback(redirectTo, "Trade deleted."));
  await redirectBackWithFeedback("Trade deleted.", "/trades");
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
  redirect(withFeedback(`/trades/${tradeId}`, "Lesson added from trade."));
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
  await redirectBackWithFeedback("Lesson added.", "/lessons");
}

export async function toggleLessonActiveAction(formData: FormData) {
  const id = String(formData.get("id"));
  const isActive = formData.get("isActive") === "true";
  await db.update("lessons", id, { isActive: !isActive, updatedAt: new Date() });
  revalidatePath("/lessons");
  await redirectBackWithFeedback(isActive ? "Lesson marked inactive." : "Lesson reactivated.", "/lessons");
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
  await redirectBackWithFeedback("Lesson changes saved.", "/lessons");
}

export async function deleteLessonAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.deleteWhere("lessons", (lesson) => lesson.id === id);
  revalidatePath("/lessons");
  revalidatePath("/trades");
  await redirectBackWithFeedback("Lesson deleted.", "/lessons");
}

export async function linkRawExecutionAction(formData: FormData) {
  const rawExecutionId = String(formData.get("rawExecutionId"));
  const linkedTradeId = toText(formData.get("linkedTradeId"));
  await db.update("rawExecutions", rawExecutionId, { linkedTradeId });
  revalidatePath("/import");
  if (linkedTradeId) revalidatePath(`/trades/${linkedTradeId}`);
  await redirectBackWithFeedback(linkedTradeId ? "Execution linked to trade." : "Execution unlinked.", "/import");
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
  await redirectBackWithFeedback("Execution row saved.", "/import");
}

export async function deleteRawExecutionAction(formData: FormData) {
  const id = String(formData.get("rawExecutionId"));
  await db.deleteWhere("rawExecutions", (execution) => execution.id === id);
  revalidatePath("/import");
  revalidatePath("/trades");
  await redirectBackWithFeedback("Execution row deleted.", "/import");
}

export async function deleteImportBatchAction(formData: FormData) {
  const id = String(formData.get("importBatchId"));
  await db.deleteWhere("importBatches", (batch) => batch.id === id);
  await db.deleteWhere("rawExecutions", (execution) => execution.importBatchId === id);
  revalidatePath("/import");
  await redirectBackWithFeedback("Import batch deleted.", "/import");
}

export async function saveSettingsAction(formData: FormData) {
  const settings: AppSettings = {
    aiEnabled: formData.get("aiEnabled") === "on",
    defaultMarketType: String(formData.get("defaultMarketType") ?? "CRYPTO_PERP"),
    defaultSourceTool: String(formData.get("defaultSourceTool") ?? "Voice memo"),
    promptTemplatesVersion: PROMPT_TEMPLATES_VERSION,
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
  redirect(withFeedback("/settings", "Settings saved."));
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
  redirect(withFeedback("/weekly-review", "Weekly review generated and saved."));
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
  await redirectBackWithFeedback("Weekly review saved.", "/weekly-review");
}

export async function deleteWeeklyReviewAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.deleteWhere("weeklyReviews", (review) => review.id === id);
  revalidatePath("/weekly-review");
  await redirectBackWithFeedback("Weekly review deleted.", "/weekly-review");
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
    maePrice: toNumber(formData.get("maePrice")),
    mfePrice: toNumber(formData.get("mfePrice")),
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

function cleanConditions(values: FormDataEntryValue[]) {
  const allowed = new Set(conditionTagValues);
  return values.map(String).filter((value) => allowed.has(value));
}

export async function createAssetAction(formData: FormData) {
  const symbol = String(formData.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) {
    redirect(withFeedback(await currentPathFallback("/assets"), "Add a symbol to start tracking an asset.", "error"));
  }
  const existing = (await db.list("assets")).find((asset) => asset.symbol.toUpperCase() === symbol);
  if (existing) {
    redirect(withFeedback(`/assets/${existing.id}`, `Already tracking ${symbol}.`));
  }
  const now = new Date();
  const asset = await db.create("assets", {
    createdAt: now,
    updatedAt: now,
    symbol,
    marketType: enumValue(MarketType, formData.get("marketType"), MarketType.CRYPTO_PERP),
    htfBias: null,
    ltfBias: null,
    levels: null,
    gamePlan: null,
    isArchived: false,
  });
  revalidatePath("/assets");
  redirect(withFeedback(`/assets/${asset.id}`, `Now tracking ${symbol}.`));
}

export async function updateAssetAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.update("assets", id, {
    htfBias: toText(formData.get("htfBias")),
    ltfBias: toText(formData.get("ltfBias")),
    levels: toText(formData.get("levels")),
    gamePlan: toText(formData.get("gamePlan")),
    marketType: enumValue(MarketType, formData.get("marketType"), MarketType.CRYPTO_PERP),
    updatedAt: new Date(),
  });
  revalidatePath(`/assets/${id}`);
  revalidatePath("/assets");
  await redirectBackWithFeedback("Asset view updated.", `/assets/${id}`);
}

export async function deleteAssetAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.deleteWhere("assetNotes", (note) => note.assetId === id);
  await db.deleteWhere("assets", (asset) => asset.id === id);
  revalidatePath("/assets");
  redirect(withFeedback("/assets", "Asset removed."));
}

// Called from the asset-note composer (client) to tidy a raw thought-dump.
// Returns the structured text for in-place review; nothing is saved here.
export async function structureAssetNoteDraftAction(rawText: string) {
  return structureAssetNote(typeof rawText === "string" ? rawText : "");
}

export async function addAssetNoteAction(formData: FormData) {
  const assetId = String(formData.get("assetId"));
  const text = toText(formData.get("text"));
  if (!text) {
    redirect(withFeedback(await currentPathFallback(`/assets/${assetId}`), "Write something before saving the note.", "error"));
  }
  const now = new Date();
  await db.create("assetNotes", {
    createdAt: now,
    updatedAt: now,
    assetId,
    timeframe: optionalEnum(AssetTimeframe, formData.get("timeframe")),
    text,
  });
  // Touch the asset so it bubbles to the top of the index on new activity.
  await db.update("assets", assetId, { updatedAt: now });
  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/assets");
  await redirectBackWithFeedback("Note added to the thread.", `/assets/${assetId}`);
}

export async function updateAssetNoteAction(formData: FormData) {
  const id = String(formData.get("id"));
  const assetId = String(formData.get("assetId"));
  const text = toText(formData.get("text"));
  if (!text) return;
  await db.update("assetNotes", id, {
    text,
    timeframe: optionalEnum(AssetTimeframe, formData.get("timeframe")),
    updatedAt: new Date(),
  });
  revalidatePath(`/assets/${assetId}`);
  await redirectBackWithFeedback("Note updated.", `/assets/${assetId}`);
}

export async function deleteAssetNoteAction(formData: FormData) {
  const id = String(formData.get("id"));
  const assetId = String(formData.get("assetId"));
  await db.deleteWhere("assetNotes", (note) => note.id === id);
  revalidatePath(`/assets/${assetId}`);
  await redirectBackWithFeedback("Note deleted.", `/assets/${assetId}`);
}

export async function createSetupAction(formData: FormData) {
  const name = toText(formData.get("name"));
  if (!name) return;
  const now = new Date();
  await db.create("setups", {
    createdAt: now,
    updatedAt: now,
    name,
    directionBias: enumValue(SetupDirectionBias, formData.get("directionBias"), SetupDirectionBias.BOTH),
    rules: toText(formData.get("rules")),
    checklist: toText(formData.get("checklist")),
    idealRiskReward: toNumber(formData.get("idealRiskReward")),
    notes: toText(formData.get("notes")),
    isActive: true,
  });
  revalidatePath("/playbook");
  revalidatePath("/trades/new");
  await redirectBackWithFeedback("Setup added to playbook.", "/playbook");
}

export async function updateSetupAction(formData: FormData) {
  const id = String(formData.get("id"));
  const name = toText(formData.get("name"));
  if (!name) return;
  await db.update("setups", id, {
    name,
    directionBias: enumValue(SetupDirectionBias, formData.get("directionBias"), SetupDirectionBias.BOTH),
    rules: toText(formData.get("rules")),
    checklist: toText(formData.get("checklist")),
    idealRiskReward: toNumber(formData.get("idealRiskReward")),
    notes: toText(formData.get("notes")),
    updatedAt: new Date(),
  });
  revalidatePath("/playbook");
  revalidatePath("/trades/new");
  await redirectBackWithFeedback("Setup updated.", "/playbook");
}

export async function toggleSetupActiveAction(formData: FormData) {
  const id = String(formData.get("id"));
  const isActive = formData.get("isActive") === "true";
  await db.update("setups", id, { isActive: !isActive, updatedAt: new Date() });
  revalidatePath("/playbook");
  await redirectBackWithFeedback(isActive ? "Setup archived." : "Setup reactivated.", "/playbook");
}

export async function deleteSetupAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.deleteWhere("setups", (setup) => setup.id === id);
  const trades = await db.list("trades");
  await Promise.all(
    trades
      .filter((trade) => trade.setupId === id)
      .map((trade) => db.update("trades", trade.id, { setupId: null, updatedAt: new Date() })),
  );
  revalidatePath("/playbook");
  revalidatePath("/trades");
  await redirectBackWithFeedback("Setup deleted.", "/playbook");
}

export async function toggleLessonPinAction(formData: FormData) {
  const id = String(formData.get("id"));
  const isPinned = formData.get("isPinned") === "true";
  await db.update("lessons", id, { isPinned: !isPinned, updatedAt: new Date() });
  revalidatePath("/lessons");
  revalidatePath("/trades/new");
  await redirectBackWithFeedback(isPinned ? "Lesson unpinned." : "Lesson pinned.", "/lessons");
}

async function createTradeFromStructured(tradeDateTime: Date, structured: StructuredJson) {
  // Carry the spoken numbers through to the trade so the trader doesn't have to
  // re-type prices/size on the trade page. Derived fields are computed here.
  const direction = enumFromText(Direction, structured.direction, Direction.UNKNOWN);
  const entryPrice = nullableNumber(structured.entryPrice);
  const stopPrice = nullableNumber(structured.stopPrice);
  const exitPrice = nullableNumber(structured.exitPrice);
  const realizedPnl = nullableNumber(structured.realizedPnl);
  const order = calculateOrderFields({ price: entryPrice, quantity: nullableNumber(structured.quantity), totalOrderValue: null });
  const hasExit = exitPrice != null || realizedPnl != null;
  return db.create("trades", {
    createdAt: new Date(),
    updatedAt: new Date(),
    tradeDateTime,
    marketType: MarketType.CRYPTO_PERP,
    instrument: String(structured.instrument ?? "UNKNOWN").toUpperCase(),
    direction,
    status: hasExit ? TradeStatus.CLOSED : TradeStatus.IDEA,
    setupName: nullableString(structured.setupName),
    entryThesis: nullableString(structured.entryThesis),
    invalidation: nullableString(structured.invalidation),
    concern: nullableString(structured.concern),
    emotionalState: enumFromText(EmotionalState, structured.emotionalState, EmotionalState.UNKNOWN),
    riskPosture: enumFromText(RiskPosture, structured.riskPosture, RiskPosture.UNKNOWN),
    confidenceScore: nullableNumber(structured.confidenceScore),
    entryGrade: enumFromText(EntryGrade, structured.entryGrade, EntryGrade.NA),
    exitReason: hasExit ? nullableString(structured.exitReason) : null,
    followedPlan: null,
    lesson: null,
    notes: null,
    entryPrice,
    stopPrice,
    targetPrice: nullableNumber(structured.targetPrice),
    exitPrice,
    quantity: order.quantity,
    totalOrderValue: order.totalOrderValue,
    leverage: nullableNumber(structured.leverage),
    realizedPnl,
    fees: null,
    funding: null,
    netPnl: calculateNetPnl(realizedPnl, null, null),
    rMultiple: calculateRMultiple({ entryPrice, stopPrice, exitPrice, direction }),
  });
}

// Pull the trader's on-screen edits from the review-card form. Only keys that
// were actually submitted override the AI draft, so each note type's card can
// surface just its relevant fields without wiping the others.
function readReviewOverrides(formData: FormData): StructuredJson {
  const overrides: StructuredJson = {};
  const textKeys = [
    "transcriptType", "instrument", "direction", "setupName", "entryThesis", "invalidation",
    "concern", "emotionalState", "riskPosture", "exitReason", "followedPlan", "bestDecision",
    "worstDecision", "mainEmotion", "mainMistake", "oneThingDoneWell", "oneThingToAvoidTomorrow",
  ];
  for (const key of textKeys) {
    if (formData.has(key)) overrides[key] = toText(formData.get(key));
  }
  const numberKeys = ["entryPrice", "stopPrice", "targetPrice", "exitPrice", "quantity", "leverage", "realizedPnl", "confidenceScore", "disciplineScore"];
  for (const key of numberKeys) {
    if (formData.has(key)) overrides[key] = toNumber(formData.get(key));
  }
  const boolKeys = ["tradedToday", "followedMaxLoss", "followedMaxTrades"];
  for (const key of boolKeys) {
    if (formData.has(key)) overrides[key] = boolFromForm(formData.get(key));
  }
  if (formData.has("lessonsText")) {
    overrides.lessons = String(formData.get("lessonsText") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }
  return overrides;
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
