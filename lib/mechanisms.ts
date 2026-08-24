import { bucketStatsFor, type MetricTrade } from "@/lib/metrics";
import { normalizeTag } from "@/lib/tags";
import type { OptionChoice } from "@/lib/options";

// The mechanism reference: what each concept means, and what it has actually
// done for you. Everything here is derived from trades you already tagged —
// there is no separate "library" to maintain, which is the only reason a
// reference page like this stays true.

/** The tag a note about this concept carries, through the ONE tokenizer — so
 *  writing "#fvg" on a quick note and opening the FVG page find each other. */
export function mechanismTag(choice: OptionChoice): string | null {
  return normalizeTag(choice.label);
}

export type MechanismSummary<T extends MetricTrade = MetricTrade> = {
  value: string;
  label: string;
  hint?: string;
  trades: T[];
  closed: T[];
  /** Concepts most often ticked on the same trade — how you actually stack them. */
  pairedWith: Array<{ value: string; count: number }>;
};

export function summarizeMechanism<T extends MetricTrade>(choice: OptionChoice, trades: T[]): MechanismSummary<T> {
  const used = trades.filter((trade) => (trade.mechanisms ?? []).includes(choice.value));
  const pairs = new Map<string, number>();
  for (const trade of used) {
    for (const other of trade.mechanisms ?? []) {
      if (other !== choice.value) pairs.set(other, (pairs.get(other) ?? 0) + 1);
    }
  }
  return {
    value: choice.value,
    label: choice.label,
    hint: choice.hint,
    trades: used,
    closed: used.filter((trade) => trade.status === "CLOSED"),
    pairedWith: [...pairs.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
  };
}

export function mechanismStats(summary: MechanismSummary<MetricTrade>) {
  return bucketStatsFor(summary.value, summary.label, summary.closed);
}

/** Best and worst by R — the two trades worth actually looking at again. */
export function extremeTrades<T extends MetricTrade>(trades: T[]): { best: T | null; worst: T | null } {
  const scored = trades.filter((trade) => trade.rMultiple != null);
  if (!scored.length) return { best: null, worst: null };
  const sorted = [...scored].sort((a, b) => (b.rMultiple ?? 0) - (a.rMultiple ?? 0));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return { best, worst: worst === best ? null : worst };
}
