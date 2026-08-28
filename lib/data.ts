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
import { currencyFromPositionKey } from "@/lib/coindcx-sync";
import { toBaseCurrency, type Currency, type InBaseCurrency } from "@/lib/currency";
import { getSettings } from "@/lib/settings-store";
import { setupSteps } from "@/lib/setups";
import { normalizeTag } from "@/lib/tags";
import type {
  DailyJournal,
  FreeNote,
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

export type TagVocabularyEntry = { tag: string; count: number; lastUsed: Date; kinds: string[]; hidden: boolean };

// Human names for where a tag is in use, shown in the settings tidy-up panel so
// you can see what retiring one would take out of the pickers.
const TAG_SOURCE_LABELS = {
  trades: "Trades",
  transcripts: "Captured notes",
  lessons: "Lessons",
  assets: "Assets",
  assetNotes: "Asset notes",
  dailyJournals: "Daily journals",
  setups: "Playbook",
  freeNotes: "Quick notes",
} as const;

// Your own tag vocabulary, most recently used first. Tag pickers show the top
// handful as one-tap chips and fold the rest away, so the vocabulary can grow
// without the forms ever getting crowded. Recency beats frequency here: the
// tags you're using this week are the ones you want under your thumb.
export async function getTagVocabulary(
  { includeHidden = false }: { includeHidden?: boolean } = {},
): Promise<TagVocabularyEntry[]> {
  const [trades, transcripts, lessons, assets, assetNotes, journals, setups, freeNotes, settings] = await Promise.all([
    listRecords("trades"),
    listRecords("transcripts"),
    listRecords("lessons"),
    listRecords("assets"),
    listRecords("assetNotes"),
    listRecords("dailyJournals"),
    listRecords("setups"),
    listRecords("freeNotes"),
    getSettings(),
  ]);
  const hidden = new Set(settings.hiddenTags ?? []);
  const usage = new Map<string, { count: number; lastUsed: Date; kinds: Set<string> }>();
  const record = (tags: string[] | undefined, date: Date, kind: keyof typeof TAG_SOURCE_LABELS) => {
    for (const tag of tags ?? []) {
      const entry = usage.get(tag);
      if (!entry) usage.set(tag, { count: 1, lastUsed: date, kinds: new Set([TAG_SOURCE_LABELS[kind]]) });
      else {
        entry.count += 1;
        entry.kinds.add(TAG_SOURCE_LABELS[kind]);
        if (date > entry.lastUsed) entry.lastUsed = date;
      }
    }
  };
  for (const trade of trades) record(trade.tags, trade.updatedAt ?? trade.tradeDateTime, "trades");
  for (const transcript of transcripts) record(transcript.tags, transcript.updatedAt ?? transcript.createdAt, "transcripts");
  for (const lesson of lessons) record(lesson.tags, lesson.updatedAt ?? lesson.createdAt, "lessons");
  for (const asset of assets) record(asset.tags, asset.updatedAt ?? asset.createdAt, "assets");
  for (const note of assetNotes) record(note.tags, note.updatedAt ?? note.createdAt, "assetNotes");
  for (const journal of journals) record(journal.tags, journal.updatedAt ?? journal.date, "dailyJournals");
  for (const setup of setups) record(setup.tags, setup.updatedAt ?? setup.createdAt, "setups");
  // Quick notes tag as freely as anything else — and now that they carry a tag
  // picker, they're often where a tag is invented. Leaving them out kept a tag
  // used only on notes out of every picker in the app.
  for (const note of freeNotes) record(note.tags, note.updatedAt ?? note.createdAt, "freeNotes");
  return [...usage.entries()]
    .map(([tag, entry]) => ({ tag, count: entry.count, lastUsed: entry.lastUsed, kinds: [...entry.kinds].sort(), hidden: hidden.has(tag) }))
    .filter((entry) => includeHidden || !entry.hidden)
    .sort((a, b) => b.lastUsed.getTime() - a.lastUsed.getTime() || b.count - a.count || a.tag.localeCompare(b.tag));
}

/**
 * Every trade, with its mistake tags, and with its money on ONE number line.
 *
 * This is the conversion boundary for the whole app. Two margin accounts mean a
 * stored P&L is only meaningful next to the currency it settled in, and every
 * page that adds trades up — Today, /trades, /analytics, /calendar,
 * /mechanisms, search, the weekly review — loads them through here. Converting
 * once, at this one function, is what makes lib/metrics.ts able to stay pure and
 * currency-blind: by the time a number reaches it, it is already comparable.
 *
 * Deliberately NOT done on the way in from the exchange: a stored number stays
 * exactly what CoinDCX said, in the wallet it said it in, so a trade can always
 * be checked against its statement line. That reconcilability is what caught a
 * ~100x bug once already.
 *
 * getTradeDetail() is the deliberate exception — one trade shown on its own page
 * stays in its native currency, because that page IS the reconcile view.
 */
export type TradeInBaseCurrency = InBaseCurrency<TradeWithMistakes>;

/** What every total in the app is denominated in. Cheap — getSettings is
 *  request-cached, so a page asking for this and for trades reads one document. */
export async function getBaseCurrency(): Promise<Currency> {
  return (await getSettings()).displayCurrency;
}

export async function getTradesWithMistakes(): Promise<TradeInBaseCurrency[]> {
  const [trades, links, tags, settings] = await Promise.all([
    listRecords("trades"),
    listRecords("tradeMistakes"),
    listRecords("mistakeTags"),
    getSettings(),
  ]);
  const base = settings.displayCurrency;
  return trades.map((trade) => ({
    ...toBaseCurrency(withNativeCurrency(trade), base),
    mistakeTags: links
      .filter((link) => link.tradeId === trade.id)
      .map((link) => ({ ...link, mistakeTag: tags.find((tag) => tag.id === link.mistakeTagId)! }))
      .filter((link): link is TradeMistakeWithTag => Boolean(link.mistakeTag)),
  }));
}

/**
 * Recover the wallet for a trade reconciled before `Trade.currency` existed.
 *
 * The exchange key already encodes it exactly, so this is a read-time repair
 * rather than a migration — and without it, the handful of trades accepted
 * before this change would have their USDT numbers read as if they were already
 * rupees, which is precisely the skew being fixed.
 */
function withNativeCurrency(trade: Trade): Trade {
  if (trade.currency || !trade.exchangeKey) return trade;
  const currency = currencyFromPositionKey(trade.exchangeKey);
  return currency ? { ...trade, currency } : trade;
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
      // Newest thought comes along for the ride so the index can be skimmed
      // without opening every asset.
      const lastNote = assetNotes.sort(descCreated)[0] ?? null;
      return { ...asset, noteCount: assetNotes.length, lastActivity, lastNote };
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

// The day's loose thoughts, newest last so the list reads like a running log.
// Filed by createdAt — a free note has no other date of its own.
/** Active setups whose checklist actually parses into steps — the ones you can
 *  "run" as a pre-trade gate (/playbook/[id]/run). A setup without a checklist
 *  has nothing to tick, so offering it there would be a dead end. */
export async function getRunnableSetups(): Promise<Array<{ id: string; name: string; stepCount: number }>> {
  const setups = await listRecords("setups");
  return setups
    .filter((setup) => setup.isActive)
    .map((setup) => ({ id: setup.id, name: setup.name, stepCount: setupSteps(setup.checklist).length }))
    .filter((setup) => setup.stepCount > 0)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function getFreeNotesForDay(date: Date) {
  const notes = await listRecords("freeNotes");
  const day = startOfDay(date).getTime();
  return notes
    .filter((note) => startOfDay(note.createdAt).getTime() === day)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/** Every quick note, newest first — what /notes filters over. Personal scale:
 *  a linear scan of a few thousand notes is nothing, and a stored index would
 *  be one more thing to keep true (same call as lib/search.ts). */
export async function getFreeNotes(): Promise<FreeNote[]> {
  const notes = await listRecords("freeNotes");
  return [...notes].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/** The symbols worth offering as one-tap tag chips on a note: the assets being
 *  tracked, then whatever has been traded recently. Tags, not a new vocabulary —
 *  they go through normalizeTag() like everything else, so tapping "BTC" and
 *  typing "#btc" produce the very same tag. */
export async function getSymbolTagSuggestions(limit = 8): Promise<string[]> {
  const [assets, trades] = await Promise.all([listRecords("assets"), listRecords("trades")]);
  const symbols = [
    ...assets.filter((asset) => !asset.isArchived).map((asset) => asset.symbol),
    ...[...trades]
      .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime())
      .map((trade) => trade.instrument),
  ];
  const tags: string[] = [];
  for (const symbol of symbols) {
    const tag = normalizeTag(symbol ?? "");
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= limit) break;
  }
  return tags;
}

export async function getClosedTradesInRange(start: Date, end: Date): Promise<TradeInBaseCurrency[]> {
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
