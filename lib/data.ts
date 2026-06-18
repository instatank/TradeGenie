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
  Setup,
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

// Lessons you can't see at decision time are dead weight. Pinned first, then recent.
export async function getResurfacedLessons(limit = 3) {
  const lessons = await listRecords("lessons");
  return lessons
    .filter((lesson) => lesson.isActive)
    .sort((a, b) => Number(Boolean(b.isPinned)) - Number(Boolean(a.isPinned)) || descCreated(a, b))
    .slice(0, limit);
}

// Index view: every tracked asset with its note count and freshest activity first.
export async function getAssetsIndex() {
  const [assets, notes] = await Promise.all([listRecords("assets"), listRecords("assetNotes")]);
  return assets
    .map((asset) => {
      const assetNotes = notes.filter((note) => note.assetId === asset.id);
      const lastNoteAt = assetNotes.reduce<Date | null>(
        (latest, note) => (!latest || note.createdAt > latest ? note.createdAt : latest),
        null,
      );
      const lastActivity = lastNoteAt && lastNoteAt > asset.updatedAt ? lastNoteAt : asset.updatedAt;
      return { ...asset, noteCount: assetNotes.length, lastActivity };
    })
    .sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());
}

// Full tracker workspace: the asset header, its append-only thread (newest first),
// and any trades logged on the same symbol so the page ties back to real trades.
export async function getAssetWorkspace(id: string) {
  const [asset, notes, trades] = await Promise.all([
    getRecord("assets", id),
    listRecords("assetNotes"),
    listRecords("trades"),
  ]);
  if (!asset) return null;
  const symbol = asset.symbol.toUpperCase();
  return {
    ...asset,
    notes: notes.filter((note) => note.assetId === id).sort(descCreated),
    relatedTrades: trades
      .filter((trade) => trade.instrument.toUpperCase().includes(symbol))
      .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime()),
  };
}

export async function getActiveSetups() {
  const setups = await listRecords("setups");
  return setups.filter((setup) => setup.isActive).sort((a, b) => a.name.localeCompare(b.name));
}

export async function getSetupNameMap() {
  const setups = await listRecords("setups");
  return new Map(setups.map((setup) => [setup.id, setup.name]));
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

export type AssetIndexRow = Awaited<ReturnType<typeof getAssetsIndex>>[number];
export type AssetWorkspace = NonNullable<Awaited<ReturnType<typeof getAssetWorkspace>>>;
export type TradeDetail = NonNullable<Awaited<ReturnType<typeof getTradeDetail>>>;
export type TranscriptWithLinks = Awaited<ReturnType<typeof getTranscriptsWithLinks>>[number];
export type { DailyJournal, Lesson, Screenshot, Setup, Trade, Transcript };
