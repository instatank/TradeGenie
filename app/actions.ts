"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { endOfDay, format, isSameDay, startOfDay } from "date-fns";
import { checkAiConnection } from "@/lib/ai-status";
import { db, getClosedTradesInRange, getTodayJournal } from "@/lib/data";
import { defaultMistakeTagNames } from "@/lib/constants";
import {
  getOptionCatalog,
  registerCustomMistakeTags,
  removeCustomOption,
  renameCustomMistakeTag,
  renameCustomOption,
  splitCustomLabels,
  type OptionCatalog,
  type OptionGroupKey,
} from "@/lib/options";
import { calculateNetPnl, calculateOrderFields, calculateRMultiple, summarizeWeeklyStats, toNumber, toText, weekBounds } from "@/lib/metrics";
import { PROMPT_TEMPLATES_VERSION, defaultPromptTemplates } from "@/lib/prompts";
import { structureAssetNote } from "@/lib/asset-note-structurer";
import { captureMarketContext } from "@/lib/market-context";
import { saveScreenshotFile } from "@/lib/screenshot-storage";
import { getSettings, saveSettings, type AppSettings } from "@/lib/settings-store";
import { newId } from "@/lib/store";
import { deriveTags, mergeTags } from "@/lib/tags";
import {
  entryKindLabels,
  entrySummary,
  entryTexts,
  normalizeEntry,
  normalizeExtraction,
  type AssetNoteEntry,
  type ExtractedEntry,
  type JournalEntry,
  type SegmentedExtraction,
  type TradeEntryEntry,
  type WeeklyReflectionEntry,
} from "@/lib/extraction";
import { structureTranscript } from "@/lib/transcript-processor";
import {
  AiConfidence,
  AssetTimeframe,
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
  type FreeNote,
  type Lesson,
} from "@/lib/types";

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

// Same job as optionalEnum, but for a field whose vocabulary the trader can
// extend: a value counts if it is a built-in OR one of their own labels.
// Anything else (a stale param, an AI answer outside the list) becomes null.
function extendedValue(catalog: OptionCatalog, group: OptionGroupKey, value: unknown) {
  const text = typeof value === "string" ? value.trim().toUpperCase() : "";
  return catalog.allows(group, text) ? text : null;
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

// The stored transcriptType is now DERIVED from the entries a note produced —
// it is a label for the inbox/calendar/search chips, not a routing decision.
// Routing happens per entry.
function deriveTranscriptType(entries: ExtractedEntry[]): TranscriptType {
  const kinds = new Set(entries.map((entry) => entry.kind));
  if (kinds.has("TRADE_ENTRY")) return TranscriptType.TRADE_ENTRY_NOTE;
  if (kinds.has("TRADE_EXIT")) return TranscriptType.TRADE_EXIT_REVIEW;
  if (kinds.has("WEEKLY_REFLECTION")) return TranscriptType.WEEKLY_REFLECTION;
  if (kinds.has("JOURNAL")) return TranscriptType.EOD_REVIEW;
  if (kinds.has("ASSET_NOTE")) return TranscriptType.PLAYBOOK_NOTE;
  if (kinds.has("LESSON")) return TranscriptType.GENERAL_LEARNING_NOTE;
  return TranscriptType.UNKNOWN;
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
  const rawText = toText(formData.get("rawText")) ?? "";
  const created = await db.create("transcripts", {
    createdAt: now,
    updatedAt: now,
    transcriptDateTime: dateFromForm(formData.get("transcriptDateTime")),
    sourceTool: toText(formData.get("sourceTool")),
    rawText,
    cleanedSummary: null,
    transcriptType: TranscriptType.UNKNOWN,
    processingStatus: ProcessingStatus.UNPROCESSED,
    linkedTradeId: null,
    linkedDailyJournalId: null,
    structuredJson: null,
    aiConfidence: null,
    tags: deriveTags([rawText], toText(formData.get("tags"))),
  });

  // Auto-structure on save so the note lands as a reviewable draft in a single
  // step — no separate "Structure" click. structureTranscript() never throws
  // (it falls back to a single FREE_NOTE), so a failure still leaves the note
  // intact and reviewable rather than losing what was said.
  if (rawText.trim()) {
    await db.update("transcripts", created.id, await structuredPatch(rawText));
  }

  revalidatePath("/inbox");
  redirect(withFeedback("/inbox", "Saved. Review the entries below, then confirm."));
}

export async function structureTranscriptAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = await db.get("transcripts", id);
  if (!transcript) return;
  await db.update("transcripts", id, await structuredPatch(transcript.rawText));
  revalidatePath("/inbox");
  await redirectBackWithFeedback("Voice note re-read. Review the entries before confirming.", "/inbox");
}

async function structuredPatch(rawText: string) {
  const extraction = await structureTranscript(rawText);
  return {
    transcriptType: deriveTranscriptType(extraction.entries),
    structuredJson: JSON.stringify(extraction, null, 2),
    processingStatus: ProcessingStatus.STRUCTURED,
    aiConfidence: aiConfidence(extraction.overallConfidence),
    cleanedSummary: buildTranscriptSummary(extraction),
    updatedAt: new Date(),
  };
}

// Remove one entry from a note's draft before confirming. The model will
// sometimes over-split; the trader has to be able to say "that isn't a separate
// thing" without editing JSON.
export async function dropTranscriptEntryAction(formData: FormData) {
  const id = String(formData.get("id"));
  const index = Number(formData.get("entryIndex"));
  const transcript = await db.get("transcripts", id);
  if (!transcript?.structuredJson) return;
  const extraction = readExtraction(transcript.structuredJson);
  if (!Number.isInteger(index) || index < 0 || index >= extraction.entries.length) return;
  const dropped = extraction.entries[index];
  const remaining = { ...extraction, entries: extraction.entries.filter((_, position) => position !== index) };
  await db.update("transcripts", id, {
    structuredJson: JSON.stringify(remaining, null, 2),
    transcriptType: deriveTranscriptType(remaining.entries),
    cleanedSummary: buildTranscriptSummary(remaining),
    updatedAt: new Date(),
  });
  revalidatePath("/inbox");
  await redirectBackWithFeedback(`Removed the ${entryKindWord(dropped)} entry. Nothing was saved to your journal.`, "/inbox");
}

// Confirm writes EVERY remaining entry in one go. The on-screen edits win over
// the AI draft (per entry now, not per note), and an exit can only ever update
// an existing trade — never create one.
export async function confirmTranscriptAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = await db.get("transcripts", id);
  if (!transcript) return;

  const draft = readExtraction(transcript.structuredJson);
  const entries = draft.entries.map((entry, index) => applyEntryOverrides(entry, formData, index));
  const options = await getOptionCatalog();
  if (!entries.length) {
    await redirectBackWithFeedback("Nothing left to confirm on this note.", "/inbox");
    return;
  }

  // Validate before writing anything, so a note never lands half-saved. An exit
  // with no resolvable trade is the one hard stop: the old code fell through and
  // created a brand-new closed trade, leaving the real position open forever.
  const unlinkedExit = entries.find((entry) => entry.kind === "TRADE_EXIT" && !entry.linkTradeId);
  if (unlinkedExit) {
    await redirectBackWithFeedback(
      "Pick which open trade the exit belongs to before confirming — an exit only ever updates an existing trade.",
      "/inbox",
    );
    return;
  }

  let linkedTradeId = transcript.linkedTradeId;
  let linkedDailyJournalId = transcript.linkedDailyJournalId;
  const written: ExtractedEntry[] = [];

  for (const entry of entries) {
    switch (entry.kind) {
      case "TRADE_ENTRY": {
        const trade = await createTradeFromEntry(transcript.transcriptDateTime, entry, options, transcript.tags);
        await linkSuggestedMistakes(trade.id, entry.suggestedMistakeTags);
        linkedTradeId = linkedTradeId ?? trade.id;
        break;
      }
      case "TRADE_EXIT": {
        const tradeId = entry.linkTradeId!;
        const existing = await db.get("trades", tradeId);
        if (!existing) break;
        await db.update("trades", tradeId, {
          status: TradeStatus.CLOSED,
          exitReason: entry.exitReason ?? existing.exitReason,
          followedPlan: enumFromText(FollowedPlan, entry.followedPlan, FollowedPlan.NA),
          emotionalState:
            extendedValue(options, "mindState", entry.emotionalState) ?? existing.emotionalState ?? EmotionalState.UNKNOWN,
          lesson: entry.lesson ?? existing.lesson,
          // Append rather than replace: the entry note's commentary is already in
          // there, and an exit shouldn't erase what was said when the trade was put on.
          notes: appendNotes(existing.notes, entry.notes),
          // Partial save (no Tags input on a review card): tags only grow.
          tags: mergeTags(existing.tags, [...(transcript.tags ?? []), ...deriveTags(entryTexts(entry))]),
          ...(entry.exitPrice != null ? { exitPrice: entry.exitPrice } : {}),
          ...(entry.realizedPnl != null
            ? { realizedPnl: entry.realizedPnl, netPnl: calculateNetPnl(entry.realizedPnl, existing.fees, existing.funding) }
            : {}),
          ...(entry.exitPrice != null
            ? {
                rMultiple:
                  calculateRMultiple({
                    entryPrice: existing.entryPrice,
                    stopPrice: existing.stopPrice,
                    exitPrice: entry.exitPrice,
                    direction: existing.direction,
                  }) ?? existing.rMultiple,
              }
            : {}),
          updatedAt: new Date(),
        });
        await linkSuggestedMistakes(tradeId, entry.suggestedMistakeTags);
        linkedTradeId = linkedTradeId ?? tradeId;
        break;
      }
      case "ASSET_NOTE": {
        await appendAssetNote(entry, transcript.tags);
        break;
      }
      case "JOURNAL": {
        linkedDailyJournalId = await mergeJournalEntry(transcript.transcriptDateTime, entry, transcript.tags);
        break;
      }
      case "LESSON": {
        await createLesson(
          {
            lessonText: entry.lessonText,
            category: enumFromText(LessonCategory, entry.category, LessonCategory.PROCESS),
            sourceType: LessonSourceType.TRANSCRIPT,
            linkedTranscriptId: id,
            linkedTradeId: linkedTradeId ?? null,
          },
          null,
          transcript.tags,
        );
        break;
      }
      case "WEEKLY_REFLECTION": {
        await createWeeklyReviewFromEntry(transcript.transcriptDateTime, entry);
        break;
      }
      case "FREE_NOTE": {
        await db.create("freeNotes", {
          createdAt: new Date(),
          updatedAt: new Date(),
          text: entry.text,
          linkedTranscriptId: id,
          // Left uncategorised on purpose: the category vocabulary grows from
          // the trader's own typing, never from AI output — the same line we
          // drew for tags. Categorise it from /notes or the day's review.
          category: null,
          tags: mergeTags(transcript.tags, deriveTags([entry.text])),
        });
        break;
      }
    }
    written.push(entry);
  }

  const confirmed: SegmentedExtraction = { ...draft, entries };
  await db.update("transcripts", id, {
    linkedTradeId,
    linkedDailyJournalId,
    structuredJson: JSON.stringify(confirmed, null, 2),
    transcriptType: deriveTranscriptType(entries),
    cleanedSummary: buildTranscriptSummary(confirmed),
    processingStatus: ProcessingStatus.CONFIRMED,
    updatedAt: new Date(),
  });

  revalidatePath("/inbox");
  revalidatePath("/trades");
  revalidatePath("/daily");
  revalidatePath("/lessons");
  revalidatePath("/assets");
  revalidatePath("/weekly-review");
  revalidatePath("/notes");
  revalidatePath("/search");
  revalidatePath("/");
  // Stay on the inbox — the trader keeps working through the queue instead of
  // being thrown onto whichever page the last entry happened to touch.
  redirect(withFeedback("/inbox?view=confirmed", `Saved ${describeWritten(written)}.`));
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
  const rawText = toText(formData.get("rawText")) ?? "";
  await db.update("transcripts", id, {
    transcriptDateTime: dateFromForm(formData.get("transcriptDateTime")),
    sourceTool: toText(formData.get("sourceTool")),
    rawText,
    tags: deriveTags([rawText], toText(formData.get("tags"))),
    transcriptType: TranscriptType.UNKNOWN,
    processingStatus: ProcessingStatus.UNPROCESSED,
    cleanedSummary: null,
    structuredJson: null,
    aiConfidence: null,
    updatedAt: new Date(),
  });
  revalidatePath("/inbox");
  await redirectBackWithFeedback("Voice note edits saved. Re-read it to get fresh entries.", "/inbox");
}

export async function deleteTranscriptAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.deleteWhere("transcripts", (transcript) => transcript.id === id);
  await db.deleteWhere("screenshots", (screenshot) => screenshot.linkedTranscriptId === id);
  const [lessons, freeNotes] = await Promise.all([db.list("lessons"), db.list("freeNotes")]);
  await Promise.all([
    ...lessons
      .filter((lesson) => lesson.linkedTranscriptId === id)
      .map((lesson) => db.update("lessons", lesson.id, { linkedTranscriptId: null, updatedAt: new Date() })),
    ...freeNotes
      .filter((note) => note.linkedTranscriptId === id)
      .map((note) => db.update("freeNotes", note.id, { linkedTranscriptId: null, updatedAt: new Date() })),
  ]);
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

// "Save lessons only": write just the LESSON entries and leave the rest of the
// note unconfirmed, for when the trade or journal side isn't worth keeping.
export async function extractLessonsAction(formData: FormData) {
  const id = String(formData.get("id"));
  const transcript = await db.get("transcripts", id);
  if (!transcript) return;
  const extraction = transcript.structuredJson
    ? readExtraction(transcript.structuredJson)
    : await structureTranscript(transcript.rawText);
  const lessons = extraction.entries.filter((entry) => entry.kind === "LESSON");
  for (const lesson of lessons) {
    await createLesson(
      {
        lessonText: lesson.lessonText,
        category: enumFromText(LessonCategory, lesson.category, LessonCategory.PROCESS),
        sourceType: LessonSourceType.TRANSCRIPT,
        linkedTranscriptId: id,
        linkedTradeId: transcript.linkedTradeId ?? null,
      },
      null,
      transcript.tags,
    );
  }
  revalidatePath("/lessons");
  revalidatePath("/inbox");
  await redirectBackWithFeedback(
    lessons.length ? `Saved ${lessons.length} lesson${lessons.length === 1 ? "" : "s"} from this note.` : "No lessons in this note.",
    "/inbox",
  );
}

export async function saveDailyJournalAction(formData: FormData) {
  const date = startOfDay(dateFromForm(formData.get("date")));
  const [existing, options] = await Promise.all([getTodayJournal(date), getOptionCatalog()]);
  const payload = {
    date,
    tradingMode: (await options.resolve("tradingMode", formData, "tradingMode")) ?? TradingMode.PAPER,
    marketsWatched: toText(formData.get("marketsWatched")),
    maxLossForDay: toText(formData.get("maxLossForDay")),
    maxTradesForDay: toNumber(formData.get("maxTradesForDay")),
    currentState: await options.resolve("mindState", formData, "currentState"),
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
  // The full form submits every text field, so tags are recomputed cleanly —
  // deleting a #hashtag here is how you remove a tag from the day.
  const tags = deriveTags([
    payload.marketsWatched, payload.learningFocus, payload.reasonNotToTrade,
    payload.bestDecision, payload.worstDecision, payload.mainMistake,
    payload.oneThingDoneWell, payload.oneThingToAvoidTomorrow, payload.eodNotes,
  ]);
  if (existing) {
    await db.update("dailyJournals", existing.id, { ...payload, tags });
  } else {
    await db.create("dailyJournals", { id: newId(), createdAt: new Date(), ...payload, tags });
  }
  revalidatePath("/daily");
  revalidatePath("/");
  redirect(withFeedback(`/daily?date=${format(date, "yyyy-MM-dd")}`, "Daily journal saved."));
}

// The quick-note box on Today and on the day's review. On Today it is still one
// field and one button — type, Enter, saved. The bigger box on the day's review
// (and on /notes) adds two optional taps: what the note is **about** (a
// noteCategory option, extendable by typing one) and its **tags** (the same
// vocabulary as everywhere else, with tracked assets offered as chips). Both are
// what make /notes filterable; neither is ever required. #hashtags in the text
// still become tags through the same tokenizer, with no extra step at all.
export async function saveQuickNoteAction(formData: FormData) {
  const text = toText(formData.get("text"));
  const redirectTo = toText(formData.get("redirectTo")) ?? "/";
  if (!text) {
    redirect(withFeedback(redirectTo, "Type something first — an empty note isn't saved.", "error"));
  }
  // Filed to the day being viewed, not to "now", so writing up yesterday from
  // its review page files the note under yesterday. Time-of-day comes from the
  // clock, since that is what the note list shows.
  const now = new Date();
  const day = startOfDay(dateFromForm(formData.get("date"), now));
  const createdAt = isSameDay(day, now) ? now : new Date(day.getTime() + 12 * 60 * 60 * 1000);
  // Both optional, and both absent from the Today bar — which posts nothing but
  // the text, exactly as it did before categories existed. A note with neither
  // is still a saved note; the taps are for finding it again later.
  const options = await getOptionCatalog();
  const note = await db.create("freeNotes", {
    createdAt,
    updatedAt: now,
    text,
    linkedTranscriptId: null,
    category: await options.resolve("noteCategory", formData, "category"),
    tags: deriveTags([text], toText(formData.get("tags"))),
  });
  revalidatePath("/");
  revalidatePath("/daily");
  revalidatePath("/notes");
  revalidatePath("/search");
  redirect(withFeedback(`${redirectTo}#note-${note.id}`, "Note saved to today's review."));
}

// Editing a saved quick note. Same shape as writing one — text, category, tags.
// The note keeps its id and
// its `createdAt`, so it stays filed to the same day and every deep link into it
// (search results, the `#note-<id>` anchor) still lands.
export async function updateFreeNoteAction(formData: FormData) {
  const id = String(formData.get("id"));
  const text = toText(formData.get("text"));
  const redirectTo = toText(formData.get("redirectTo")) ?? "/";
  if (!text) {
    // Emptying the box is not how you delete a note — the delete button is right
    // there, and silently dropping the text would look like a save that worked.
    redirect(withFeedback(`${redirectTo}#note-${id}`, "A note can't be emptied — use delete if you want it gone.", "error"));
  }
  // Field-presence rule, same as saveTradeAction: the full card shows text,
  // category and tags, so it is the complete truth for all three. A surface that
  // renders only the text (nothing does today, but the Today bar is one edit
  // away from it) can never wipe what it didn't show.
  const options = await getOptionCatalog();
  const patch: Partial<FreeNote> = { text, updatedAt: new Date() };
  if (formData.has("category") || formData.has("categoryCustom")) {
    patch.category = await options.resolve("noteCategory", formData, "category");
  }
  patch.tags = formData.has("tags")
    ? deriveTags([text], toText(formData.get("tags")))
    : mergeTags((await db.get("freeNotes", id))?.tags, deriveTags([text]));
  await db.update("freeNotes", id, patch);
  revalidatePath("/");
  revalidatePath("/daily");
  revalidatePath("/notes");
  revalidatePath("/search");
  redirect(withFeedback(`${redirectTo}#note-${id}`, "Note updated."));
}

export async function deleteFreeNoteAction(formData: FormData) {
  const id = String(formData.get("id"));
  await db.deleteWhere("freeNotes", (note) => note.id === id);
  revalidatePath("/");
  revalidatePath("/daily");
  revalidatePath("/notes");
  revalidatePath("/search");
  await redirectBackWithFeedback("Note deleted.", toText(formData.get("redirectTo")) ?? "/");
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
  const options = await getOptionCatalog();
  const now = new Date();
  const instrument = String(formData.get("instrument") ?? "").trim().toUpperCase();
  // Started here so it overlaps the rest of the work; awaited at the write.
  // Capped at 2s and never throws — see lib/market-context.ts.
  const marketContext = captureMarketContext(instrument, now);
  const texts = {
    entryThesis: toText(formData.get("entryThesis")),
    premortem: toText(formData.get("premortem")),
    invalidation: toText(formData.get("invalidation")),
    concern: toText(formData.get("concern")),
  };
  const trade = await db.create("trades", {
    createdAt: now,
    updatedAt: now,
    tradeDateTime: now,
    marketType: enumValue(MarketType, formData.get("marketType"), MarketType.CRYPTO_PERP),
    instrument,
    marketContext: await marketContext,
    direction: enumValue(Direction, formData.get("direction"), Direction.UNKNOWN),
    status: enumValue(TradeStatus, formData.get("status"), TradeStatus.IDEA),
    ...texts,
    tags: deriveTags(Object.values(texts), toText(formData.get("tags"))),
    setupName: toText(formData.get("setupName")),
    setupId: toText(formData.get("setupId")),
    conditions: await options.resolveMany("condition", formData, "conditions"),
    emotionalState: await options.resolve("mindState", formData, "emotionalState"),
    riskPosture: await options.resolve("riskPosture", formData, "riskPosture"),
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
  const now = new Date();
  // Kicked off before the settings read so the two overlap: the quick log has
  // a 30-second budget and this must not add to it. Capped at 2s, never throws.
  const marketContext = captureMarketContext(instrument, now);
  const [settings, options] = await Promise.all([getSettings(), getOptionCatalog()]);
  const direction = enumValue(Direction, formData.get("direction"), Direction.UNKNOWN);
  const status = enumValue(TradeStatus, formData.get("status"), TradeStatus.OPEN);
  const entryPrice = toNumber(formData.get("entryPrice"));
  const stopPrice = toNumber(formData.get("stopPrice"));
  const exitPrice = toNumber(formData.get("exitPrice"));
  const realizedPnl = toNumber(formData.get("realizedPnl"));
  const trade = await db.create("trades", {
    createdAt: now,
    updatedAt: now,
    tradeDateTime: now,
    marketContext: await marketContext,
    marketType: enumValue(MarketType, settings.defaultMarketType, MarketType.CRYPTO_PERP),
    instrument,
    direction,
    status,
    setupName: null,
    setupId: null,
    entryThesis: toText(formData.get("entryThesis")),
    tags: deriveTags([toText(formData.get("entryThesis"))], toText(formData.get("tags"))),
    premortem: null,
    conditions: [],
    invalidation: null,
    concern: null,
    emotionalState: await options.resolve("mindState", formData, "emotionalState"),
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

// ONE save for a trade, wherever it is edited from: the review panel and the
// full editor on the trade page (a single form now), or the compact inline
// review in an expanded row on /trades.
//
// Rule: a field is only touched if its input was actually on screen
// (`formData.has(...)`). Everything that wasn't rendered keeps its stored value,
// so no surface can silently wipe another surface's work — and one button press
// always captures every change on the page it was pressed from.
export async function saveTradeAction(formData: FormData) {
  const id = String(formData.get("id"));
  const [trade, options] = await Promise.all([db.get("trades", id), getOptionCatalog()]);
  if (!trade) return;
  const present = (key: string) => formData.has(key);
  // An extendable field counts as "on screen" if either its chips/select or its
  // "type another" box was rendered — a surface that shows only the box must
  // still be able to set the field.
  const presentOption = (key: string) => formData.has(key) || formData.has(`${key}Custom`);
  const text = (key: string, fallback: string | null | undefined) => (present(key) ? toText(formData.get(key)) : fallback ?? null);
  const num = (key: string, fallback: number | null | undefined) => (present(key) ? toNumber(formData.get(key)) : fallback ?? null);

  const status = present("status") ? enumValue(TradeStatus, formData.get("status"), trade.status) : trade.status;
  const direction = present("direction") ? enumValue(Direction, formData.get("direction"), trade.direction) : trade.direction;
  const entryPrice = num("entryPrice", trade.entryPrice);
  const stopPrice = num("stopPrice", trade.stopPrice);
  const exitPrice = num("exitPrice", trade.exitPrice);
  const realizedPnl = num("realizedPnl", trade.realizedPnl);
  const fees = num("fees", trade.fees);
  const funding = num("funding", trade.funding);
  const order = calculateOrderFields({
    price: entryPrice,
    quantity: num("quantity", trade.quantity),
    totalOrderValue: num("totalOrderValue", trade.totalOrderValue),
  });
  const texts = {
    entryThesis: text("entryThesis", trade.entryThesis),
    premortem: text("premortem", trade.premortem),
    invalidation: text("invalidation", trade.invalidation),
    concern: text("concern", trade.concern),
    exitReason: text("exitReason", trade.exitReason),
    lesson: text("lesson", trade.lesson),
    notes: text("notes", trade.notes),
  };

  await db.update("trades", id, {
    tradeDateTime: present("tradeDateTime") ? dateFromForm(formData.get("tradeDateTime"), trade.tradeDateTime) : trade.tradeDateTime,
    marketType: present("marketType") ? enumValue(MarketType, formData.get("marketType"), trade.marketType) : trade.marketType,
    instrument: present("instrument") ? String(formData.get("instrument") ?? "").trim().toUpperCase() || trade.instrument : trade.instrument,
    direction,
    status,
    setupName: text("setupName", trade.setupName),
    setupId: text("setupId", trade.setupId),
    conditions: present("hasConditions") ? await options.resolveMany("condition", formData, "conditions") : trade.conditions,
    ...texts,
    // The full editor ships a prefilled Tags input, so it can remove a tag;
    // partial surfaces (inline review) can only grow the tag set.
    tags: present("tags")
      ? deriveTags(Object.values(texts), toText(formData.get("tags")))
      : mergeTags(trade.tags, deriveTags(Object.values(texts))),
    emotionalState: presentOption("emotionalState") ? await options.resolve("mindState", formData, "emotionalState") : trade.emotionalState,
    riskPosture: presentOption("riskPosture") ? await options.resolve("riskPosture", formData, "riskPosture") : trade.riskPosture,
    confidenceScore: num("confidenceScore", trade.confidenceScore),
    entryGrade: present("entryGrade") ? enumValue(EntryGrade, formData.get("entryGrade"), trade.entryGrade) : trade.entryGrade,
    followedPlan: present("followedPlan")
      ? optionalEnum(FollowedPlan, formData.get("followedPlan")) ?? trade.followedPlan
      : trade.followedPlan,
    entryPrice,
    stopPrice,
    targetPrice: num("targetPrice", trade.targetPrice),
    exitPrice,
    maePrice: num("maePrice", trade.maePrice),
    mfePrice: num("mfePrice", trade.mfePrice),
    quantity: order.quantity,
    totalOrderValue: order.totalOrderValue,
    leverage: num("leverage", trade.leverage),
    realizedPnl,
    fees,
    funding,
    netPnl: calculateNetPnl(realizedPnl, fees, funding),
    rMultiple: calculateRMultiple({ entryPrice, stopPrice, exitPrice, direction }),
    updatedAt: new Date(),
  });

  // Only the mistake tags that were actually on screen get replaced, so tags
  // picked from the full list elsewhere survive a quick inline review.
  const shownTagIds = formData.getAll("shownMistakeTagIds").flatMap((value) => String(value).split(",")).filter(Boolean);
  if (shownTagIds.length) {
    const shown = new Set(shownTagIds);
    const picked = formData.getAll("mistakeTagId").map(String).filter((tagId) => shown.has(tagId));
    await db.deleteWhere("tradeMistakes", (link) => link.tradeId === id && shown.has(link.mistakeTagId));
    for (const mistakeTagId of picked) {
      await db.create("tradeMistakes", { tradeId: id, mistakeTagId });
    }
  }

  // A mistake typed into the review's "add your own" box becomes a real mistake
  // tag — a chip from now on, and countable in analytics like any other. Linked
  // after the replace above so it can't be wiped by the same save.
  const invented = await registerCustomMistakeTags(splitCustomLabels(formData.get("mistakeTagIdCustom")));
  if (invented.length) {
    const links = await db.list("tradeMistakes");
    const linked = new Set(links.filter((link) => link.tradeId === id).map((link) => link.mistakeTagId));
    for (const tag of invented) {
      if (linked.has(tag.id)) continue;
      await db.create("tradeMistakes", { tradeId: id, mistakeTagId: tag.id });
      linked.add(tag.id);
    }
  }

  await saveScreenshot(formData.get("screenshot"), id);

  // Turn the reflection into a reusable lesson with zero extra clicks.
  const lessonText = texts.lesson;
  if (lessonText) {
    const lessons = await db.list("lessons");
    const duplicate = lessons.some((entry) => entry.linkedTradeId === id && entry.lessonText.trim() === lessonText.trim());
    if (!duplicate) {
      await createLesson({
        lessonText,
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
  const reviewed = status === TradeStatus.CLOSED && (formData.get("followedPlan") ?? "NA") !== "NA";
  redirect(withFeedback(
    toText(formData.get("redirectTo")) ?? `/trades/${id}`,
    reviewed ? "Saved — trade reviewed and closed." : "Saved.",
  ));
}

// Morning and evening save only their own fields (merged over the existing
// journal), so finishing the evening never wipes the morning and vice versa.
export async function saveMorningCheckinAction(formData: FormData) {
  const date = startOfDay(dateFromForm(formData.get("date")));
  const [existing, options] = await Promise.all([getTodayJournal(date), getOptionCatalog()]);
  const payload = {
    tradingMode: (await options.resolve("tradingMode", formData, "tradingMode")) ?? existing?.tradingMode ?? TradingMode.PAPER,
    currentState: (await options.resolve("mindState", formData, "currentState")) ?? existing?.currentState ?? null,
    maxLossForDay: toText(formData.get("maxLossForDay")),
    maxTradesForDay: toNumber(formData.get("maxTradesForDay")),
    learningFocus: toText(formData.get("learningFocus")),
    marketsWatched: formData.has("marketsWatched") ? toText(formData.get("marketsWatched")) : existing?.marketsWatched ?? null,
    reasonNotToTrade: formData.has("reasonNotToTrade") ? toText(formData.get("reasonNotToTrade")) : existing?.reasonNotToTrade ?? null,
    updatedAt: new Date(),
  };
  // The tag picker shows every tag already on the day, so when it's on screen
  // its selection is the final word (unticking a chip removes the tag). Without
  // it, a partial save can only grow the tag set.
  const morningDerived = deriveTags(
    [payload.maxLossForDay, payload.learningFocus, payload.marketsWatched, payload.reasonNotToTrade],
    toText(formData.get("tags")),
  );
  const morningTags = formData.has("tags") ? morningDerived : mergeTags(existing?.tags, morningDerived);
  if (existing) {
    await db.update("dailyJournals", existing.id, { ...payload, tags: morningTags });
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
      tags: morningTags,
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
  const eveningDerived = deriveTags(
    [
      payload.oneThingDoneWell, payload.oneThingToAvoidTomorrow, payload.bestDecision,
      payload.worstDecision, payload.mainMistake, payload.eodNotes,
    ],
    toText(formData.get("tags")),
  );
  const eveningTags = formData.has("tags") ? eveningDerived : mergeTags(existing?.tags, eveningDerived);
  if (existing) {
    await db.update("dailyJournals", existing.id, { ...payload, tags: eveningTags });
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
      tags: eveningTags,
    });
  }
  revalidatePath("/daily");
  revalidatePath("/");
  redirect(withFeedback(toText(formData.get("redirectTo")) ?? `/daily?date=${format(date, "yyyy-MM-dd")}`, "Day reviewed. That's the habit that compounds."));
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
  const options = await getOptionCatalog();
  await createLesson({
    lessonText,
    category: (await options.resolve("lessonCategory", formData, "category")) ?? LessonCategory.PROCESS,
    sourceType: LessonSourceType.TRADE,
    linkedTradeId: tradeId,
    linkedTranscriptId: null,
  }, toText(formData.get("tags")));
  revalidatePath(`/trades/${tradeId}`);
  revalidatePath("/lessons");
  redirect(withFeedback(`/trades/${tradeId}`, "Lesson added from trade."));
}

export async function addManualLessonAction(formData: FormData) {
  const lessonText = toText(formData.get("lessonText"));
  if (!lessonText) return;
  const options = await getOptionCatalog();
  await createLesson({
    lessonText,
    category: (await options.resolve("lessonCategory", formData, "category")) ?? LessonCategory.PROCESS,
    sourceType: LessonSourceType.MANUAL,
    linkedTradeId: null,
    linkedTranscriptId: null,
  }, toText(formData.get("tags")));
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
  const options = await getOptionCatalog();
  await db.update("lessons", id, {
    lessonText,
    category: (await options.resolve("lessonCategory", formData, "category")) ?? LessonCategory.PROCESS,
    tags: deriveTags([lessonText], toText(formData.get("tags"))),
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

// Housekeeping for the labels the trader invented. Removing one takes it out of
// the pickers only — records that already carry the value keep it and fall back
// to the humanized form, so nothing in the journal is rewritten behind them.
// Renaming is the edit half of the same housekeeping: a label typed in a hurry
// ("chased bo") should be fixable without retiring it and re-tagging everything.
// Only what's shown changes — see renameCustomOption for why the stored value
// stays put.
export async function renameCustomOptionAction(formData: FormData) {
  const id = String(formData.get("id"));
  const label = toText(formData.get("label"));
  if (!label) {
    redirect(withFeedback("/settings", "A label needs some text — nothing was renamed.", "error"));
  }
  const renamed = await renameCustomOption(id, label);
  revalidatePath("/settings");
  await redirectBackWithFeedback(
    renamed ? `Renamed to “${renamed.label}”. Entries already using it now read the new way.` : "That label is gone already.",
    "/settings",
  );
}

export async function renameCustomMistakeTagAction(formData: FormData) {
  const id = String(formData.get("id"));
  const label = toText(formData.get("label"));
  if (!label) {
    redirect(withFeedback("/settings", "A label needs some text — nothing was renamed.", "error"));
  }
  const tag = await db.get("mistakeTags", id);
  if (tag && defaultMistakeTagNames.has(tag.name)) return;
  const renamed = await renameCustomMistakeTag(id, label);
  revalidatePath("/settings");
  revalidatePath("/trades");
  revalidatePath("/analytics");
  await redirectBackWithFeedback(
    renamed ? `Renamed to “${renamed.label}”. Trades tagged with it now read the new way.` : "That tag is gone already.",
    "/settings",
  );
}

export async function removeCustomOptionAction(formData: FormData) {
  const id = String(formData.get("id"));
  const option = (await db.list("customOptions")).find((entry) => entry.id === id);
  if (!option) return;
  await removeCustomOption(id);
  revalidatePath("/settings");
  await redirectBackWithFeedback(`Removed “${option.label}” from the pickers. Entries already using it are untouched.`, "/settings");
}

// A custom mistake tag is a real record that trades link to by id, so removing
// it does have to unlink those trades — say how many, rather than leaving a
// dangling reference the analytics quietly drop. Built-in tags can't be removed.
export async function removeCustomMistakeTagAction(formData: FormData) {
  const id = String(formData.get("id"));
  const tag = await db.get("mistakeTags", id);
  if (!tag || defaultMistakeTagNames.has(tag.name)) return;
  const links = (await db.list("tradeMistakes")).filter((link) => link.mistakeTagId === id);
  await db.deleteWhere("tradeMistakes", (link) => link.mistakeTagId === id);
  await db.deleteWhere("mistakeTags", (entry) => entry.id === id);
  revalidatePath("/settings");
  revalidatePath("/trades");
  revalidatePath("/analytics");
  await redirectBackWithFeedback(
    links.length
      ? `Removed “${tag.label}” and un-tagged ${links.length} trade${links.length === 1 ? "" : "s"}.`
      : `Removed “${tag.label}”.`,
    "/settings",
  );
}

export async function saveSettingsAction(formData: FormData) {
  const settings: AppSettings = {
    aiEnabled: formData.get("aiEnabled") === "on",
    defaultMarketType: String(formData.get("defaultMarketType") ?? "CRYPTO_PERP"),
    defaultSourceTool: String(formData.get("defaultSourceTool") ?? "Voice memo"),
    promptTemplatesVersion: PROMPT_TEMPLATES_VERSION,
    promptTemplates: {
      capture: String(formData.get("capture") ?? defaultPromptTemplates.capture),
    },
  };
  await saveSettings(settings);
  revalidatePath("/settings");
  redirect(withFeedback("/settings", "Settings saved."));
}

// Makes one tiny real call to Anthropic and reports exactly what came back.
// This is the answer to "is the AI actually working?" without reading logs.
export async function testAiConnectionAction() {
  const result = await checkAiConnection();
  const target = new URL("/settings", "http://tradeforge.local");
  target.searchParams.set("aiCheck", result.ok ? "ok" : "fail");
  target.searchParams.set("aiCheckDetail", result.detail);
  target.searchParams.set("aiCheckModel", result.model);
  revalidatePath("/settings");
  redirect(`${target.pathname}${target.search}`);
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

function sameTags(a: string[], b: string[] | undefined) {
  const other = b ?? [];
  return a.length === other.length && a.every((tag, index) => tag === other[index]);
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

// The whole asset page is one form, so one press of Save captures everything on
// screen at once: the current view, a new thread note, and any edits made to
// existing notes. Nothing typed can be lost by pressing "the other button" —
// there is no other button.
async function applyAssetWorkspace(formData: FormData, skipNoteId?: string) {
  const assetId = String(formData.get("assetId"));
  const [asset, options] = await Promise.all([db.get("assets", assetId), getOptionCatalog()]);
  if (!asset) return { assetId, viewSaved: false, noteAdded: false, notesEdited: 0 };
  const now = new Date();
  let viewSaved = false;
  let notesEdited = 0;

  // 1. Current view — only when its panel was actually on screen.
  if (["htfBias", "ltfBias", "levels", "gamePlan"].some((key) => formData.has(key))) {
    const texts = {
      htfBias: toText(formData.get("htfBias")),
      ltfBias: toText(formData.get("ltfBias")),
      levels: toText(formData.get("levels")),
      gamePlan: toText(formData.get("gamePlan")),
    };
    await db.update("assets", assetId, {
      ...texts,
      tags: deriveTags(Object.values(texts), toText(formData.get("tags"))),
      marketType: enumValue(MarketType, formData.get("marketType"), asset.marketType),
      updatedAt: now,
    });
    viewSaved = true;
  }

  // 2. In-place edits to notes already in the thread.
  const notes = (await db.list("assetNotes")).filter((note) => note.assetId === assetId);
  for (const note of notes) {
    if (note.id === skipNoteId) continue;
    const key = `noteText-${note.id}`;
    if (!formData.has(key)) continue;
    const text = toText(formData.get(key));
    if (!text) continue;
    const timeframe = await options.resolve("assetTimeframe", formData, `noteTimeframe-${note.id}`);
    const tags = deriveTags([text], toText(formData.get(`noteTags-${note.id}`)));
    if (text === note.text && timeframe === (note.timeframe ?? null) && sameTags(tags, note.tags)) continue;
    await db.update("assetNotes", note.id, { text, timeframe, tags, updatedAt: now });
    notesEdited += 1;
  }

  // 3. A new note in the composer — appended, never silently dropped.
  const newNote = toText(formData.get("noteText"));
  if (newNote) {
    await db.create("assetNotes", {
      createdAt: now,
      updatedAt: now,
      assetId,
      timeframe: await options.resolve("assetTimeframe", formData, "noteTimeframe"),
      text: newNote,
      tags: deriveTags([newNote], toText(formData.get("noteTags"))),
    });
  }

  // Touch the asset so it bubbles to the top of the index on any activity.
  if (!viewSaved && (newNote || notesEdited)) await db.update("assets", assetId, { updatedAt: now });
  revalidatePath(`/assets/${assetId}`);
  revalidatePath("/assets");
  revalidatePath("/");
  return { assetId, viewSaved, noteAdded: Boolean(newNote), notesEdited };
}

export async function saveAssetWorkspaceAction(formData: FormData) {
  const result = await applyAssetWorkspace(formData);
  const parts = [
    result.noteAdded ? "note added to the thread" : null,
    result.notesEdited ? `${result.notesEdited} note${result.notesEdited === 1 ? "" : "s"} updated` : null,
    result.viewSaved ? "current view saved" : null,
  ].filter(Boolean);
  redirect(withFeedback(`/assets/${result.assetId}`, parts.length ? `Saved — ${parts.join(" · ")}.` : "Nothing to save yet."));
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

// Deleting one note still saves everything else on the page first, so a delete
// never costs you the edits sitting next to it.
export async function deleteAssetNoteAction(noteId: string, formData: FormData) {
  const result = await applyAssetWorkspace(formData, noteId);
  await db.deleteWhere("assetNotes", (note) => note.id === noteId);
  revalidatePath(`/assets/${result.assetId}`);
  redirect(withFeedback(`/assets/${result.assetId}`, "Note deleted — your other changes were saved."));
}

export async function createSetupAction(formData: FormData) {
  const name = toText(formData.get("name"));
  if (!name) return;
  const now = new Date();
  const texts = {
    rules: toText(formData.get("rules")),
    checklist: toText(formData.get("checklist")),
    notes: toText(formData.get("notes")),
  };
  await db.create("setups", {
    createdAt: now,
    updatedAt: now,
    name,
    directionBias: enumValue(SetupDirectionBias, formData.get("directionBias"), SetupDirectionBias.BOTH),
    ...texts,
    tags: deriveTags(Object.values(texts), toText(formData.get("tags"))),
    idealRiskReward: toNumber(formData.get("idealRiskReward")),
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
  const texts = {
    rules: toText(formData.get("rules")),
    checklist: toText(formData.get("checklist")),
    notes: toText(formData.get("notes")),
  };
  await db.update("setups", id, {
    name,
    directionBias: enumValue(SetupDirectionBias, formData.get("directionBias"), SetupDirectionBias.BOTH),
    ...texts,
    tags: deriveTags(Object.values(texts), toText(formData.get("tags"))),
    idealRiskReward: toNumber(formData.get("idealRiskReward")),
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

// A TRADE_ENTRY becomes a trade. Spoken numbers carry through so nothing has to
// be re-typed on the trade page; derived fields are computed here. Status comes
// from the model: OPEN when they actually entered, IDEA when they're watching.
async function createTradeFromEntry(
  tradeDateTime: Date,
  entry: TradeEntryEntry,
  options: OptionCatalog,
  sourceTags?: string[],
) {
  const direction = enumFromText(Direction, entry.direction, Direction.UNKNOWN);
  const order = calculateOrderFields({ price: entry.entryPrice, quantity: entry.quantity, totalOrderValue: null });
  const instrument = (entry.instrument ?? "UNKNOWN").toUpperCase();
  // Keyed to the note's own time, not to when it was confirmed: a voice note
  // spoken at 06:00 and confirmed at 10:00 gets the 06:00 context.
  const marketContext = await captureMarketContext(instrument, tradeDateTime);
  return db.create("trades", {
    createdAt: new Date(),
    updatedAt: new Date(),
    tradeDateTime,
    marketType: MarketType.CRYPTO_PERP,
    instrument,
    marketContext,
    direction,
    status: enumFromText(TradeStatus, entry.status, TradeStatus.IDEA),
    setupName: entry.setupName,
    entryThesis: entry.entryThesis,
    invalidation: entry.invalidation,
    concern: entry.concern,
    // #hashtags in the original voice note follow the note into the trade.
    tags: mergeTags(sourceTags, deriveTags(entryTexts(entry))),
    // extendedValue (not enumFromText) so a mind state / risk posture the trader
    // added themselves survives the capture path, same as everywhere else.
    emotionalState: extendedValue(options, "mindState", entry.emotionalState) ?? EmotionalState.UNKNOWN,
    riskPosture: extendedValue(options, "riskPosture", entry.riskPosture) ?? RiskPosture.UNKNOWN,
    confidenceScore: entry.confidenceScore,
    entryGrade: EntryGrade.NA,
    exitReason: null,
    followedPlan: null,
    lesson: null,
    // The spoken commentary that isn't a field — chart timeframe, expected
    // duration, market read. Lands in the trade's own "Free-form notes".
    notes: entry.notes,
    entryPrice: entry.entryPrice,
    stopPrice: entry.stopPrice,
    targetPrice: entry.targetPrice,
    exitPrice: null,
    quantity: order.quantity,
    totalOrderValue: order.totalOrderValue,
    leverage: entry.leverage,
    realizedPnl: null,
    fees: null,
    funding: null,
    netPnl: null,
    rMultiple: null,
  });
}

// An ASSET_NOTE appends to the symbol's running thread, creating the asset the
// first time it's mentioned. This is the route from capture to the per-asset
// tracker that simply did not exist before.
async function appendAssetNote(entry: AssetNoteEntry, sourceTags?: string[]) {
  const symbol = entry.assetSymbol.trim().toUpperCase();
  if (!symbol || !entry.text.trim()) return;
  const now = new Date();
  const assets = await db.list("assets");
  const existing = assets.find((asset) => asset.symbol.toUpperCase() === symbol);
  const asset =
    existing ??
    (await db.create("assets", {
      createdAt: now,
      updatedAt: now,
      symbol,
      marketType: MarketType.CRYPTO_PERP,
      htfBias: null,
      ltfBias: null,
      levels: null,
      gamePlan: null,
      isArchived: false,
      tags: [],
    }));
  await db.create("assetNotes", {
    createdAt: now,
    updatedAt: now,
    assetId: asset.id,
    timeframe: enumFromText(AssetTimeframe, entry.timeframe, AssetTimeframe.GENERAL),
    text: entry.text,
    tags: mergeTags(sourceTags, deriveTags([entry.text])),
  });
  // Touch the asset so it bubbles to the top of the index on new activity.
  await db.update("assets", asset.id, { updatedAt: now });
}

// A JOURNAL entry merges into the day's journal without wiping the fields the
// morning/evening rituals already wrote.
async function mergeJournalEntry(date: Date, entry: JournalEntry, sourceTags?: string[]) {
  const day = startOfDay(date);
  const existing = await getTodayJournal(day);
  const mainEmotion = entry.mainEmotion === "UNKNOWN" ? null : entry.mainEmotion;
  const payload = {
    tradedToday: entry.tradedToday ?? existing?.tradedToday ?? null,
    followedMaxLoss: entry.followedMaxLoss ?? existing?.followedMaxLoss ?? null,
    followedMaxTrades: entry.followedMaxTrades ?? existing?.followedMaxTrades ?? null,
    bestDecision: entry.bestDecision ?? existing?.bestDecision ?? null,
    worstDecision: entry.worstDecision ?? existing?.worstDecision ?? null,
    mainEmotion: mainEmotion ?? existing?.mainEmotion ?? null,
    mainMistake: entry.mainMistake ?? existing?.mainMistake ?? null,
    oneThingDoneWell: entry.oneThingDoneWell ?? existing?.oneThingDoneWell ?? null,
    oneThingToAvoidTomorrow: entry.oneThingToAvoidTomorrow ?? existing?.oneThingToAvoidTomorrow ?? null,
    disciplineScore: entry.disciplineScore ?? existing?.disciplineScore ?? null,
    // Partial save: tags only grow (spoken #hashtags + the note's own tags).
    tags: mergeTags(existing?.tags, [...(sourceTags ?? []), ...deriveTags(entryTexts(entry))]),
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
  return daily.id;
}

// A WEEKLY_REFLECTION becomes a real weekly review: the trader's own words for
// the narrative, the log for the numbers. The weekly-only fields the old
// extraction schema stripped (whatImproved / whatDeteriorated) are kept in the
// summary rather than being silently dropped.
async function createWeeklyReviewFromEntry(date: Date, entry: WeeklyReflectionEntry) {
  const { weekStart, weekEnd } = weekBounds(date);
  const trades = await getClosedTradesInRange(weekStart, weekEnd);
  const stats = summarizeWeeklyStats(trades, weekStart, weekEnd);
  const summaryText = [
    entry.summaryText,
    entry.whatImproved ? `What improved: ${entry.whatImproved}` : null,
    entry.whatDeteriorated ? `What got worse: ${entry.whatDeteriorated}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
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
    bestLesson: entry.keyLesson,
    actionItem: entry.whatDeteriorated,
  });
}

// Pull the trader's on-screen edits for ONE entry back over the AI draft. Only
// keys that were actually rendered for that entry's kind are submitted, so a
// card can surface just its own fields without wiping the rest.
function applyEntryOverrides(entry: ExtractedEntry, formData: FormData, index: number): ExtractedEntry {
  const prefix = `e${index}_`;
  const patch: Record<string, unknown> = {};
  const text = (key: string) => {
    if (formData.has(prefix + key)) patch[key] = toText(formData.get(prefix + key));
  };
  const number = (key: string) => {
    if (formData.has(prefix + key)) patch[key] = toNumber(formData.get(prefix + key));
  };
  const bool = (key: string) => {
    if (formData.has(prefix + key)) patch[key] = boolFromForm(formData.get(prefix + key));
  };

  switch (entry.kind) {
    case "TRADE_ENTRY":
      ["instrument", "direction", "status", "setupName", "entryThesis", "invalidation", "concern", "notes", "emotionalState", "riskPosture"].forEach(text);
      ["confidenceScore", "entryPrice", "stopPrice", "targetPrice", "quantity", "leverage"].forEach(number);
      break;
    case "TRADE_EXIT":
      ["linkTradeId", "instrument", "exitReason", "followedPlan", "emotionalState", "lesson", "notes"].forEach(text);
      ["exitPrice", "realizedPnl"].forEach(number);
      break;
    case "ASSET_NOTE":
      ["assetSymbol", "timeframe", "text"].forEach(text);
      break;
    case "JOURNAL":
      ["mainEmotion", "bestDecision", "worstDecision", "mainMistake", "oneThingDoneWell", "oneThingToAvoidTomorrow"].forEach(text);
      ["disciplineScore"].forEach(number);
      ["tradedToday", "followedMaxLoss", "followedMaxTrades"].forEach(bool);
      break;
    case "LESSON":
      ["lessonText", "category"].forEach(text);
      break;
    case "WEEKLY_REFLECTION":
      ["summaryText", "whatImproved", "whatDeteriorated", "keyLesson"].forEach(text);
      break;
    case "FREE_NOTE":
      ["text"].forEach(text);
      break;
  }

  // normalizeEntry re-applies the enum/number discipline to whatever was typed,
  // so a hand-edited field can never smuggle a bad value into a record.
  return normalizeEntry({ ...entry, ...patch }) ?? entry;
}

// An exit's commentary is added to whatever the entry note already said, never
// over it. Skips the append when the same text is already present, so
// re-confirming a note can't stack duplicates.
function appendNotes(existing: string | null | undefined, addition: string | null): string | null {
  const previous = (existing ?? "").trim();
  const next = (addition ?? "").trim();
  if (!next) return previous || null;
  if (!previous) return next;
  if (previous.includes(next)) return previous;
  return `${previous}\n\n${next}`;
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

async function createLesson(
  input: Omit<Lesson, "id" | "createdAt" | "updatedAt" | "isActive">,
  tagInput?: string | null,
  inheritedTags?: string[],
) {
  await db.create("lessons", {
    createdAt: new Date(),
    updatedAt: new Date(),
    isActive: true,
    ...input,
    tags: mergeTags(inheritedTags, deriveTags([input.lessonText], tagInput)),
  });
}

// Read a saved draft back through the same tolerant normalizer the model's
// response goes through, so hand-edited or older JSON can never crash a save.
function readExtraction(structuredJson: string | null): SegmentedExtraction {
  if (!structuredJson) return { entries: [], missingInfo: [], overallConfidence: "LOW" };
  try {
    return normalizeExtraction(JSON.parse(structuredJson));
  } catch {
    return { entries: [], missingInfo: [], overallConfidence: "LOW" };
  }
}

// The one-line preview on the collapsed inbox card and in search results.
function buildTranscriptSummary(extraction: SegmentedExtraction) {
  return extraction.entries
    .map((entry) => `${entryKindLabels[entry.kind]}: ${entrySummary(entry)}`)
    .join(" · ")
    .slice(0, 500) || null;
}

function entryKindWord(entry: ExtractedEntry) {
  return entryKindLabels[entry.kind].toLowerCase();
}

// "a trade and a lesson", "2 trades, an asset note and a journal entry".
function describeWritten(entries: ExtractedEntry[]) {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    const word = entryKindWord(entry);
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const parts = [...counts.entries()].map(([word, count]) => (count === 1 ? `1 ${word}` : `${count} ${word}s`));
  if (parts.length <= 1) return parts[0] ?? "nothing";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function enumFromText<T extends Record<string, string>>(enumObject: T, value: unknown, fallback: T[keyof T]) {
  const text = String(value ?? "").toUpperCase();
  return Object.values(enumObject).includes(text as T[keyof T]) ? (text as T[keyof T]) : fallback;
}

function formatMaybe(value: number | null | undefined) {
  return value == null ? "not available" : value.toFixed(2);
}
