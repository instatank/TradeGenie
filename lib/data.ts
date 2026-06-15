import { endOfDay, startOfDay } from "date-fns";
import {
  createRecord,
  deleteWhere,
  getRecord,
  listRecords,
  updateRecord,
  upsertBy,
  type StoreShape,
} from "@/lib/store";
import type {
  DailyJournal,
  Lesson,
  RawExecution,
  Screenshot,
  Trade,
  TradeMistakeWithTag,
  TradeWithMistakes,
  Transcript,
} from "@/lib/types";

export const db = {
  list: listRecords,
  get: getRecord,
  create: createRecord,
  update: updateRecord,
  deleteWhere,
  upsertBy,
};

export async function getTradesWithMistakes(): Promise<TradeWithMistakes[]> {
  const [trades, links, tags] = await Promise.all([
    listRecords("trades"),
    listRecords("tradeMistakes"),
    listRecords("mistakeTags"),
  ]);
  return trades.map((trade) => ({
    ...trade,
    mistakeTags: links
      .filter((link) => link.tradeId === trade.id)
      .map((link) => ({ ...link, mistakeTag: tags.find((tag) => tag.id === link.mistakeTagId)! }))
      .filter((link): link is TradeMistakeWithTag => Boolean(link.mistakeTag)),
  }));
}

export async function getTradeDetail(id: string) {
  const [trade, links, tags, lessons, transcripts, rawExecutions, screenshots] = await Promise.all([
    getRecord("trades", id),
    listRecords("tradeMistakes"),
    listRecords("mistakeTags"),
    listRecords("lessons"),
    listRecords("transcripts"),
    listRecords("rawExecutions"),
    listRecords("screenshots"),
  ]);
  if (!trade) return null;
  return {
    ...trade,
    mistakeTags: links
      .filter((link) => link.tradeId === id)
      .map((link) => ({ ...link, mistakeTag: tags.find((tag) => tag.id === link.mistakeTagId)! }))
      .filter((link): link is TradeMistakeWithTag => Boolean(link.mistakeTag)),
    lessons: lessons.filter((lesson) => lesson.linkedTradeId === id).sort(descCreated),
    transcripts: transcripts.filter((transcript) => transcript.linkedTradeId === id).sort(descCreated),
    rawExecutions: rawExecutions.filter((execution) => execution.linkedTradeId === id).sort(descExecution),
    screenshots: screenshots.filter((screenshot) => screenshot.linkedTradeId === id).sort(descCreated),
  };
}

export async function getTranscriptsWithLinks() {
  const [transcripts, trades, journals] = await Promise.all([
    listRecords("transcripts"),
    listRecords("trades"),
    listRecords("dailyJournals"),
  ]);
  return transcripts
    .sort(descCreated)
    .map((transcript) => ({
      ...transcript,
      linkedTrade: trades.find((trade) => trade.id === transcript.linkedTradeId) ?? null,
      linkedDailyJournal: journals.find((journal) => journal.id === transcript.linkedDailyJournalId) ?? null,
    }));
}

export async function getLatestLesson() {
  const lessons = await listRecords("lessons");
  return lessons.filter((lesson) => lesson.isActive).sort(descCreated)[0] ?? null;
}

export async function getTodayJournal(date: Date) {
  const day = startOfDay(date).getTime();
  const journals = await listRecords("dailyJournals");
  return journals.find((journal) => startOfDay(journal.date).getTime() === day) ?? null;
}

export async function getClosedTradesInRange(start: Date, end: Date): Promise<TradeWithMistakes[]> {
  const trades = await getTradesWithMistakes();
  return trades.filter((trade) => trade.status === "CLOSED" && trade.tradeDateTime >= start && trade.tradeDateTime <= endOfDay(end));
}

export function createBase<T extends keyof StoreShape>(input: Omit<StoreShape[T][number], "id" | "createdAt" | "updatedAt">) {
  const now = new Date();
  return { ...input, createdAt: now, updatedAt: now };
}

export function touch<T extends { updatedAt?: Date }>(input: T) {
  return { ...input, updatedAt: new Date() };
}

function descCreated(a: { createdAt: Date }, b: { createdAt: Date }) {
  return b.createdAt.getTime() - a.createdAt.getTime();
}

function descExecution(a: RawExecution, b: RawExecution) {
  return b.executionDateTime.getTime() - a.executionDateTime.getTime();
}

export type TradeDetail = NonNullable<Awaited<ReturnType<typeof getTradeDetail>>>;
export type TranscriptWithLinks = Awaited<ReturnType<typeof getTranscriptsWithLinks>>[number];
export type { DailyJournal, Lesson, Screenshot, Trade, Transcript };
