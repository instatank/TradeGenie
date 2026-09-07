import type { Asset, AssetBiasChange } from "@/lib/types";

/**
 * The asset's "Current view" is edited in place — that is the point of it, the
 * glance you open daily. The cost was that every previous read was destroyed on
 * save: the panel said "history lives in the thread" and nothing ever wrote it
 * there, so the one question worth asking of a tracked asset — *what did I
 * think three weeks ago, and was I right?* — was unanswerable by construction.
 *
 * This is the cheapest possible fix for that: diff the four fields on save and
 * record what moved. There is nothing new to fill in, because the trader
 * already performed the act; the app just stops throwing away what it knew.
 */
export const biasFields = ["htfBias", "ltfBias", "levels", "gamePlan"] as const;
export type BiasField = (typeof biasFields)[number];

export const biasFieldLabels: Record<BiasField, string> = {
  htfBias: "HTF bias",
  ltfBias: "LTF bias",
  levels: "Levels",
  gamePlan: "Game plan",
};

/**
 * A short field reads as "A → B" inline; a long one would swamp the timeline,
 * so it renders as a one-line marker with the previous text behind a fold.
 * Kept here rather than in the page so the rule has one definition.
 */
export const longBiasFields: ReadonlySet<BiasField> = new Set<BiasField>(["levels", "gamePlan"]);

type BiasValues = Pick<Asset, BiasField>;

/** "  " and null are both "nothing written" — a save that only changes
 *  whitespace is not a change of mind and must not mint a history row. */
function normalize(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length ? trimmed : null;
}

export type BiasDiff = { field: BiasField; from: string | null; to: string | null };

/**
 * What actually moved between two versions of the current view.
 *
 * Going from nothing to something IS recorded — "bias set" is a real event in
 * the story of an asset, and dropping it would leave the first read of every
 * symbol missing from its own history.
 */
export function diffBias(before: BiasValues, after: BiasValues): BiasDiff[] {
  const changes: BiasDiff[] = [];
  for (const field of biasFields) {
    const from = normalize(before[field]);
    const to = normalize(after[field]);
    if (from === to) continue;
    changes.push({ field, from, to });
  }
  return changes;
}

/** One line describing the change, in the trader's terms rather than the
 *  field name. Used by the timeline row and by anything that summarises one. */
export function describeBiasChange(change: Pick<AssetBiasChange, "field" | "from" | "to">): string {
  const label = biasFieldLabels[change.field as BiasField] ?? change.field;
  if (!change.from) return `${label} set`;
  if (!change.to) return `${label} cleared`;
  return `${label} changed`;
}

/* ------------------------------------------------------------------------- *
 * The merged timeline
 *
 * The asset page used to be two parallel columns — the current view on the
 * left, the note thread on the right — and the trades on the same symbol were a
 * third list that showed direction, status and a date and nothing else. So the
 * story of a symbol was told in three places that never met, and the sequence
 * that actually teaches you something ("here is what I wrote, here is the bias
 * flipping, here is the trade I took two days later") could not be read at all.
 *
 * One chronological column fixes that with no new data and nothing new to fill
 * in — it is a rendering decision, not a schema one.
 * ------------------------------------------------------------------------- */

/** How far back the timeline shows by default. The owner's own framing —
 *  "at least the recent ones, let's say that month" — and it matches the
 *  calendar, which already shows the recent week and folds the rest. */
export const TIMELINE_RECENT_DAYS = 30;

/** …but a quiet month must not render an empty page, so this many items are
 *  always shown even if every one of them is older than the window. */
export const TIMELINE_MIN_ITEMS = 8;

export type AssetTimelineItem<TTrade, TFreeNote, TNote, TChange> =
  | { kind: "note"; at: Date; id: string; note: TNote }
  | { kind: "bias"; at: Date; id: string; change: TChange }
  | { kind: "trade"; at: Date; id: string; trade: TTrade }
  | { kind: "freeNote"; at: Date; id: string; note: TFreeNote };

/**
 * Newest first, then split into what the page shows and what folds away.
 *
 * The split is by age with a floor rather than a flat "most recent N": a busy
 * week should show the whole week, and a symbol nobody has touched since March
 * should still show its last few entries instead of a disclosure with nothing
 * visible above it.
 */
export function splitTimeline<T extends { at: Date }>(
  items: T[],
  options: { now?: Date; recentDays?: number; minItems?: number } = {},
): { recent: T[]; earlier: T[] } {
  const { now = new Date(), recentDays = TIMELINE_RECENT_DAYS, minItems = TIMELINE_MIN_ITEMS } = options;
  const ordered = [...items].sort((a, b) => b.at.getTime() - a.at.getTime());
  const cutoff = now.getTime() - recentDays * 24 * 3600_000;
  let shown = ordered.filter((item) => item.at.getTime() >= cutoff).length;
  if (shown < minItems) shown = Math.min(minItems, ordered.length);
  return { recent: ordered.slice(0, shown), earlier: ordered.slice(shown) };
}

/**
 * Assemble every dated thing that belongs to one asset into one list.
 *
 * Generic over the record types so this stays store-free and testable: the
 * caller has already loaded (and, for trades, currency-converted) them.
 *
 * A trade is placed at `tradeDateTime`, not `createdAt` — an archived position
 * from March was written to the journal today, and filing it under today would
 * put it at the top of the story of a symbol it left months ago.
 */
export function buildAssetTimeline<
  TTrade extends { id: string; tradeDateTime: Date },
  TFreeNote extends { id: string; createdAt: Date },
  TNote extends { id: string; createdAt: Date },
  TChange extends { id: string; createdAt: Date },
>(input: {
  notes: TNote[];
  biasChanges: TChange[];
  trades: TTrade[];
  freeNotes: TFreeNote[];
}): AssetTimelineItem<TTrade, TFreeNote, TNote, TChange>[] {
  const items: AssetTimelineItem<TTrade, TFreeNote, TNote, TChange>[] = [
    ...input.notes.map((note) => ({ kind: "note" as const, at: note.createdAt, id: note.id, note })),
    ...input.biasChanges.map((change) => ({ kind: "bias" as const, at: change.createdAt, id: change.id, change })),
    ...input.trades.map((trade) => ({ kind: "trade" as const, at: trade.tradeDateTime, id: trade.id, trade })),
    ...input.freeNotes.map((note) => ({ kind: "freeNote" as const, at: note.createdAt, id: note.id, note })),
  ];
  return items.sort((a, b) => b.at.getTime() - a.at.getTime());
}
