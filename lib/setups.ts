import { normalizeOptionValue } from "@/lib/options";
import { humanize } from "@/lib/constants";

// A playbook setup's checklist, read as steps you can tick on a trade.
//
// The steps are NOT a new field: they're the lines of the setup's existing
// "Entry checklist" text. Write the model once in the playbook —
//
//   HTF bias / trend
//   MTF + LTF market structure shift
//   Displacement
//   Liquidity taken
//   Entry (OTE, OB, FVG)
//
// — and every trade on that setup offers those five as tick chips. One place
// defines the model, so editing the checklist can never leave the trade form
// showing a different set of steps than the playbook does.
//
// A trade stores the normalized VALUE of each ticked step, not its index and
// not its wording: reordering the checklist must not move a tick from one step
// to another, and fixing a typo in a line must not lose the ticks under it.

/** Longer than this is prose, not a step — a paragraph in the checklist box
 *  still reads fine on the playbook page, it just doesn't become a chip. */
const MAX_STEP_LENGTH = 60;
const MAX_STEPS = 12;

export type SetupStep = { value: string; label: string };

export function setupSteps(checklist: string | null | undefined): SetupStep[] {
  const steps: SetupStep[] = [];
  const seen = new Set<string>();
  for (const line of String(checklist ?? "").split(/\r?\n/)) {
    // Tolerate the ways a checklist actually gets typed: "- ", "1. ", "[ ] ".
    const label = line
      .trim()
      .replace(/^[-*•]\s+/, "")
      .replace(/^\d+[.)]\s+/, "")
      .replace(/^\[\s*[xX]?\s*\]\s*/, "")
      .trim();
    if (label.length < 2 || label.length > MAX_STEP_LENGTH) continue;
    const value = normalizeOptionValue(label);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    steps.push({ value, label });
    if (steps.length >= MAX_STEPS) break;
  }
  return steps;
}

/** How much of the model a trade actually followed. `null` when the setup has
 *  no checklist to grade against — an untracked trade is not a failed one. */
export function checklistScore(
  steps: SetupStep[],
  ticked: string[] | undefined,
): { met: number; total: number; complete: boolean } | null {
  if (!steps.length) return null;
  const set = new Set(ticked ?? []);
  const met = steps.filter((step) => set.has(step.value)).length;
  return { met, total: steps.length, complete: met === steps.length };
}

/** Display label for a stored step value — falls back to the humanized value so
 *  a step deleted from the checklist still reads on the trades that ticked it. */
export function stepLabel(steps: SetupStep[], value: string) {
  return steps.find((step) => step.value === value)?.label ?? humanize(value);
}
