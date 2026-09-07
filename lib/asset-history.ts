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
