import { format } from "date-fns";
import { humanize } from "@/lib/constants";
import { db, getTradesWithMistakes } from "@/lib/data";
import { getOptionCatalog } from "@/lib/options";
import { normalizeTag } from "@/lib/tags";

// One unified search index over every collection. Each record becomes a flat
// SearchDoc with labeled text fields, so results can show WHERE a match came
// from ("Invalidation: …") and window the snippet around the matched term.
//
// This is a per-request linear scan, not a stored index — measured fine at
// personal scale in DayOS (~15ms over 5k entries) and it can never go stale.

export type SearchKind =
  | "trade"
  | "note"
  | "lesson"
  | "asset"
  | "assetNote"
  | "journal"
  | "setup"
  | "weekly"
  | "freeNote"
  | "execution";

export type SearchField = { label: string; text: string };

export type SearchDoc = {
  kind: SearchKind;
  id: string;
  href: string;
  title: string;
  subtitle: string;
  date: Date;
  tags: string[];
  fields: SearchField[];
};

export type ParsedQuery = { tags: string[]; terms: string[] };

export type SearchResult = SearchDoc & { snippet: Snippet | null };

export type Snippet = { fieldLabel: string; before: string; match: string; after: string };

export const searchKindLabels: Record<SearchKind, string> = {
  trade: "Trades",
  note: "Captured notes",
  lesson: "Lessons",
  asset: "Assets",
  assetNote: "Asset thread notes",
  journal: "Daily journals",
  setup: "Playbook setups",
  weekly: "Weekly reviews",
  freeNote: "Thoughts",
  execution: "Imported executions",
};

export const searchKindOrder: SearchKind[] = [
  "trade",
  "note",
  "lesson",
  "asset",
  "assetNote",
  "journal",
  "setup",
  "weekly",
  "freeNote",
  "execution",
];

export async function buildSearchIndex(): Promise<SearchDoc[]> {
  const [trades, transcripts, lessons, assets, assetNotes, journals, setups, weeklyReviews, freeNotes, executions, options] =
    await Promise.all([
      getTradesWithMistakes(),
      db.list("transcripts"),
      db.list("lessons"),
      db.list("assets"),
      db.list("assetNotes"),
      db.list("dailyJournals"),
      db.list("setups"),
      db.list("weeklyReviews"),
      db.list("freeNotes"),
      db.list("rawExecutions"),
      getOptionCatalog(),
    ]);
  const assetById = new Map(assets.map((asset) => [asset.id, asset]));

  const docs: SearchDoc[] = [];

  for (const trade of trades) {
    docs.push({
      kind: "trade",
      id: trade.id,
      href: `/trades/${trade.id}`,
      title: `${trade.instrument} · ${humanize(trade.direction)} · ${humanize(trade.status)}`,
      subtitle: trade.setupName ?? "No setup",
      date: trade.tradeDateTime,
      tags: trade.tags ?? [],
      fields: fields([
        ["Instrument", trade.instrument],
        ["Setup", trade.setupName],
        ["Thesis", trade.entryThesis],
        ["Pre-mortem", trade.premortem],
        ["Invalidation", trade.invalidation],
        ["Concern", trade.concern],
        ["Exit reason", trade.exitReason],
        ["Lesson", trade.lesson],
        ["Notes", trade.notes],
        ["Mistakes", trade.mistakeTags.map((link) => link.mistakeTag.label).join(", ")],
        ["Conditions", (trade.conditions ?? []).map(options.labeler("condition")).join(", ")],
        ["Mind state", options.label("mindState", trade.emotionalState)],
      ]),
    });
  }

  for (const transcript of transcripts) {
    docs.push({
      kind: "note",
      id: transcript.id,
      href: `/inbox?view=all#note-${transcript.id}`,
      title: transcriptTitle(transcript.transcriptType),
      subtitle: humanize(transcript.processingStatus),
      date: transcript.transcriptDateTime,
      tags: transcript.tags ?? [],
      fields: fields([
        ["Summary", transcript.cleanedSummary],
        ["Raw note", transcript.rawText],
        ["Source", transcript.sourceTool],
      ]),
    });
  }

  for (const lesson of lessons) {
    docs.push({
      kind: "lesson",
      id: lesson.id,
      href: `/lessons?view=all#lesson-${lesson.id}`,
      title: lesson.lessonText.length > 90 ? `${lesson.lessonText.slice(0, 90)}…` : lesson.lessonText,
      subtitle: `${options.label("lessonCategory", lesson.category)} · ${humanize(lesson.sourceType)}${lesson.isActive ? "" : " · Inactive"}`,
      date: lesson.createdAt,
      tags: lesson.tags ?? [],
      fields: fields([["Lesson", lesson.lessonText]]),
    });
  }

  for (const asset of assets) {
    docs.push({
      kind: "asset",
      id: asset.id,
      href: `/assets/${asset.id}`,
      title: `${asset.symbol} tracker`,
      subtitle: humanize(asset.marketType),
      date: asset.updatedAt,
      tags: asset.tags ?? [],
      fields: fields([
        ["Symbol", asset.symbol],
        ["HTF bias", asset.htfBias],
        ["LTF bias", asset.ltfBias],
        ["Levels", asset.levels],
        ["Game plan", asset.gamePlan],
      ]),
    });
  }

  for (const note of assetNotes) {
    const asset = assetById.get(note.assetId);
    docs.push({
      kind: "assetNote",
      id: note.id,
      href: `/assets/${note.assetId}#note-${note.id}`,
      title: `${asset?.symbol ?? "Asset"} thread note`,
      subtitle: note.timeframe ? options.label("assetTimeframe", note.timeframe) : "",
      date: note.createdAt,
      tags: note.tags ?? [],
      fields: fields([["Note", note.text]]),
    });
  }

  for (const journal of journals) {
    docs.push({
      kind: "journal",
      id: journal.id,
      href: `/daily?date=${format(journal.date, "yyyy-MM-dd")}`,
      title: `Daily journal · ${format(journal.date, "dd MMM yyyy")}`,
      subtitle: options.label("tradingMode", journal.tradingMode),
      date: journal.date,
      tags: journal.tags ?? [],
      fields: fields([
        ["Markets watched", journal.marketsWatched],
        ["Learning focus", journal.learningFocus],
        ["Reason not to trade", journal.reasonNotToTrade],
        ["Best decision", journal.bestDecision],
        ["Worst decision", journal.worstDecision],
        ["Main emotion", journal.mainEmotion],
        ["Main mistake", journal.mainMistake],
        ["Done well", journal.oneThingDoneWell],
        ["Avoid tomorrow", journal.oneThingToAvoidTomorrow],
        ["EOD notes", journal.eodNotes],
      ]),
    });
  }

  for (const setup of setups) {
    docs.push({
      kind: "setup",
      id: setup.id,
      href: "/playbook",
      title: setup.name,
      subtitle: `${humanize(setup.directionBias)}${setup.isActive ? "" : " · Archived"}`,
      date: setup.updatedAt,
      tags: setup.tags ?? [],
      fields: fields([
        ["Name", setup.name],
        ["Rules", setup.rules],
        ["Checklist", setup.checklist],
        ["Notes", setup.notes],
      ]),
    });
  }

  for (const review of weeklyReviews) {
    docs.push({
      kind: "weekly",
      id: review.id,
      href: "/weekly-review",
      title: `Week ${format(review.weekStart, "dd MMM")} – ${format(review.weekEnd, "dd MMM yyyy")}`,
      subtitle: `${review.totalTrades} trades`,
      date: review.weekEnd,
      tags: [],
      fields: fields([
        ["Summary", review.summaryText],
        ["Best lesson", review.bestLesson],
        ["Action item", review.actionItem],
        ["Most common mistake", review.mostCommonMistake],
      ]),
    });
  }

  // Thoughts that belong to no other collection. They do have a home now — the
  // day's review lists every free note filed to that day, hand-typed or lifted
  // out of a captured note — so a result links there rather than to the inbox.
  for (const note of freeNotes) {
    docs.push({
      kind: "freeNote",
      id: note.id,
      href: `/daily?date=${format(note.createdAt, "yyyy-MM-dd")}#note-${note.id}`,
      title: note.text.length > 90 ? `${note.text.slice(0, 90)}…` : note.text,
      subtitle: [note.category ? options.label("noteCategory", note.category) : null, format(note.createdAt, "dd MMM yyyy")]
        .filter(Boolean)
        .join(" · "),
      date: note.createdAt,
      tags: note.tags ?? [],
      fields: fields([
        ["Thought", note.text],
        ["About", note.category ? options.label("noteCategory", note.category) : null],
      ]),
    });
  }

  for (const execution of executions) {
    docs.push({
      kind: "execution",
      id: execution.id,
      href: "/import",
      title: `${execution.instrument} · ${execution.side ?? "side NA"}`,
      subtitle: execution.exchangeBroker ?? "",
      date: execution.executionDateTime,
      tags: [],
      fields: fields([
        ["Instrument", execution.instrument],
        ["Side", execution.side],
        ["Broker", execution.exchangeBroker],
        ["Order ID", execution.orderId],
        ["Raw row", execution.rawJson],
      ]),
    });
  }

  return docs.sort((a, b) => b.date.getTime() - a.date.getTime());
}

// Query grammar (kept deliberately tiny, and aligned with how tag pills work):
// - a `#tag` token matches only records actually tagged with that exact tag
//   (so `#win` never surfaces `#winner` — filter pills and search agree);
// - every other word is a case-insensitive substring, all words must match
//   somewhere in the record, in any order (AND);
// - the two mix freely: `#breakout btc stop` = tagged breakout AND both words.
export function parseQuery(query: string): ParsedQuery {
  const tags: string[] = [];
  const terms: string[] = [];
  for (const token of query.trim().split(/\s+/).filter(Boolean)) {
    if (token.startsWith("#")) {
      const tag = normalizeTag(token);
      if (tag) tags.push(tag);
      continue;
    }
    terms.push(token.toLowerCase());
  }
  return { tags: [...new Set(tags)], terms: [...new Set(terms)] };
}

export function searchIndex(docs: SearchDoc[], query: string): SearchResult[] {
  const parsed = parseQuery(query);
  if (!parsed.tags.length && !parsed.terms.length) return [];
  const results: SearchResult[] = [];
  for (const doc of docs) {
    if (!parsed.tags.every((tag) => doc.tags.includes(tag))) continue;
    const haystack = docHaystack(doc);
    if (!parsed.terms.every((term) => haystack.includes(term))) continue;
    results.push({ ...doc, snippet: buildSnippet(doc, parsed) });
  }
  return results;
}

export type TagUsage = { tag: string; count: number; kinds: SearchKind[] };

// The browsable tag registry: every free-form tag in use, with counts.
export function tagUsage(docs: SearchDoc[]): TagUsage[] {
  const usage = new Map<string, { count: number; kinds: Set<SearchKind> }>();
  for (const doc of docs) {
    for (const tag of doc.tags) {
      const entry = usage.get(tag) ?? { count: 0, kinds: new Set<SearchKind>() };
      entry.count += 1;
      entry.kinds.add(doc.kind);
      usage.set(tag, entry);
    }
  }
  return [...usage.entries()]
    .map(([tag, entry]) => ({ tag, count: entry.count, kinds: [...entry.kinds] }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function docHaystack(doc: SearchDoc) {
  return [doc.title, doc.subtitle, ...doc.fields.map((field) => field.text), ...doc.tags.map((tag) => `#${tag}`)]
    .join("\n")
    .toLowerCase();
}

// Window the preview around the first matched term instead of always showing
// the head of the text (DayOS "anchored preview" pattern). Built as plain
// string parts — the page wraps `match` in <mark> as a React node, so entry
// text can never inject HTML.
const SNIPPET_RADIUS = 90;

function buildSnippet(doc: SearchDoc, parsed: ParsedQuery): Snippet | null {
  for (const term of parsed.terms) {
    for (const field of doc.fields) {
      const index = field.text.toLowerCase().indexOf(term);
      if (index === -1) continue;
      const start = Math.max(0, index - SNIPPET_RADIUS);
      const end = Math.min(field.text.length, index + term.length + SNIPPET_RADIUS);
      return {
        fieldLabel: field.label,
        before: `${start > 0 ? "…" : ""}${field.text.slice(start, index)}`,
        match: field.text.slice(index, index + term.length),
        after: `${field.text.slice(index + term.length, end)}${end < field.text.length ? "…" : ""}`,
      };
    }
  }
  // Tag-only query (or the terms only matched the title): plain head-of-text.
  const first = doc.fields.find((field) => field.text.trim());
  if (!first) return null;
  const head = first.text.slice(0, SNIPPET_RADIUS * 2);
  return { fieldLabel: first.label, before: "", match: "", after: `${head}${first.text.length > head.length ? "…" : ""}` };
}

function transcriptTitle(type: string) {
  const labels: Record<string, string> = {
    TRADE_ENTRY_NOTE: "Trade note",
    TRADE_EXIT_REVIEW: "Exit review note",
    DAILY_CHECKIN: "Check-in note",
    EOD_REVIEW: "Day review note",
    WEEKLY_REFLECTION: "Weekly note",
    PLAYBOOK_NOTE: "Playbook note",
    GENERAL_LEARNING_NOTE: "Learning note",
    MISTAKE_REFLECTION: "Mistake note",
  };
  return labels[type] ?? "Captured note";
}

function fields(pairs: Array<[string, string | null | undefined]>): SearchField[] {
  return pairs
    .filter((pair): pair is [string, string] => Boolean(pair[1] && pair[1].trim()))
    .map(([label, text]) => ({ label, text }));
}
