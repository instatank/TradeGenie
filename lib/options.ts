import {
  assetTimeframes,
  conditionTagOptions,
  coreLessonCategories,
  humanize,
  mindStateLabel,
  mindStateOptions,
  riskPostures,
} from "@/lib/constants";
import { createRecord, deleteWhere, listRecords, updateRecord } from "@/lib/store";
import type { CustomOption, MistakeTag } from "@/lib/types";

// THE custom-option registry. Every preset-pill field whose vocabulary the
// trader is allowed to extend goes through this file — one normalizer, one
// storage collection, one catalog. It is the same bargain as lib/tags.ts: type
// your own label once, it's there next time, nothing is ever deleted from the
// built-in set.
//
// Why not just let any string through? Because a value is stored on the record
// and compared later (analytics group by it, filters match on it). Normalizing
// once, here, is what stops "Chased breakout", "chased breakout" and
// "Chased  Breakout" from becoming three different pills — exactly the way
// normalizeTag() stops that for tags.
//
// Custom MISTAKE tags are the one exception: they live in the `mistakeTags`
// collection, because a trade links to a mistake by id. registerCustomMistakeTags()
// below handles those; everything else is a CustomOption record.

/** Fields that accept "or type another…". Deliberately excludes anything the
 *  app's own maths depends on — direction, trade status, A/B/C grade,
 *  followed-plan, discipline 1–10, note type. Those aren't preferences; a
 *  custom value there would quietly break P&L, R and the review nudges. */
export type OptionGroupKey =
  | "mindState"
  | "condition"
  | "lessonCategory"
  | "assetTimeframe"
  | "riskPosture"
  | "tradingMode"
  | "noteCategory";

export type OptionChoice = { value: string; label: string; hint?: string; isCustom?: boolean };

type OptionGroupDef = {
  /** Shown on the settings page where custom labels are reviewed. */
  title: string;
  /** Placeholder inside the "type another" box. */
  placeholder: string;
  builtin: OptionChoice[];
};

export const optionGroups: Record<OptionGroupKey, OptionGroupDef> = {
  mindState: {
    title: "Mind state / mood",
    placeholder: "or type another mood…",
    builtin: mindStateOptions.map((state) => ({ value: state, label: mindStateLabel(state) })),
  },
  condition: {
    title: "Market conditions",
    placeholder: "add your own condition…",
    builtin: conditionTagOptions.map(([value, label, hint]) => ({ value, label, hint })),
  },
  lessonCategory: {
    title: "Lesson categories",
    placeholder: "or type another category…",
    builtin: coreLessonCategories.map((value) => ({ value, label: humanize(value) })),
  },
  assetTimeframe: {
    title: "Asset note timeframes",
    placeholder: "or type another, e.g. 4H…",
    builtin: assetTimeframes.map((value) => ({ value, label: value === "GENERAL" ? "General" : value })),
  },
  riskPosture: {
    title: "Risk posture",
    placeholder: "or type another…",
    builtin: riskPostures.map((value) => ({ value, label: humanize(value) })),
  },
  noteCategory: {
    title: "Quick note categories",
    placeholder: "or type another…",
    builtin: [
      { value: "TRADE", label: "Trade", hint: "About a position — one you're in, took or passed on" },
      { value: "ASSET", label: "Asset", hint: "A read on a coin: levels, bias, what you're waiting for" },
      { value: "MINDSET", label: "Mindset", hint: "How you're feeling and what it's doing to your trading" },
      { value: "MARKET", label: "Market", hint: "Conditions, news, the wider tape" },
      { value: "LESSON", label: "Lesson", hint: "Something you want to remember next time" },
      { value: "REVIEW", label: "Review", hint: "Looking back at the day, the week or a run of trades" },
    ],
  },
  tradingMode: {
    title: "Trading mode (morning check-in)",
    placeholder: "or type another…",
    builtin: [
      { value: "LIVE", label: "Live" },
      { value: "PAPER", label: "Paper" },
      { value: "OBSERVE_ONLY", label: "Just watching" },
      { value: "NO_TRADING", label: "Day off" },
    ],
  },
};

export const optionGroupKeys = Object.keys(optionGroups) as OptionGroupKey[];

/** The opt-out chip for a one-of row that is genuinely optional (a quick note
 *  doesn't have to be about anything). Its empty value is in no group's
 *  vocabulary, so resolve() stores null for it — radios can't be unticked, and
 *  a category you can set but never clear is a trap. */
export const noOptionChoice: OptionChoice = { value: "", label: "No category" };

const MIN_LENGTH = 2;
const MAX_LENGTH = 40;

/** The one normalizer. "Cut winner early!" → "CUT_WINNER_EARLY". Returns null
 *  if there is nothing usable left, so a stray space can never become an option. */
export function normalizeOptionValue(input: string | null | undefined): string | null {
  const value = String(input ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (value.length < MIN_LENGTH || value.length > MAX_LENGTH) return null;
  return value;
}

/** What gets shown on the pill: exactly what was typed, tidied only of stray whitespace. */
export function cleanOptionLabel(input: string | null | undefined) {
  return String(input ?? "").trim().replace(/\s+/g, " ").slice(0, MAX_LENGTH);
}

/** One box can hold more than one new label — commas and newlines separate them. */
export function splitCustomLabels(input: FormDataEntryValue | null | undefined): string[] {
  return String(input ?? "")
    .split(/[,\n]/)
    .map((part) => cleanOptionLabel(part))
    .filter(Boolean);
}

export type OptionCatalog = {
  /** Built-in choices first, then the trader's own — the order pills render in. */
  choices(group: OptionGroupKey): OptionChoice[];
  /** The label to display for a stored value, custom labels included. Falls back
   *  to humanize() so a value whose custom label was removed still reads fine. */
  label(group: OptionGroupKey, value: string | null | undefined): string;
  /** Bound labeller, for the metrics helpers that take a label function. */
  labeler(group: OptionGroupKey): (value: string) => string;
  allows(group: OptionGroupKey, value: string | null | undefined): boolean;
  /** Chip/select value + whatever was typed in the "type another" box → the value
   *  to store. Typed always wins (same rule as the symbol box on the quick log),
   *  and a new label is registered as a side effect so it's a pill next time. */
  resolve(group: OptionGroupKey, formData: FormData, name: string): Promise<string | null>;
  /** Checkbox version: every ticked chip plus every typed label. */
  resolveMany(group: OptionGroupKey, formData: FormData, name: string): Promise<string[]>;
  custom(group: OptionGroupKey): CustomOption[];
  allCustom(): CustomOption[];
};

/** Read the trader's custom labels once and hand back everything the render and
 *  the save need. Actions should build this once per request and reuse it. */
export async function getOptionCatalog(): Promise<OptionCatalog> {
  const stored = await listRecords("customOptions");
  const custom = new Map<OptionGroupKey, CustomOption[]>();
  for (const key of optionGroupKeys) {
    custom.set(
      key,
      stored
        .filter((option) => option.group === key)
        .sort((a, b) => a.label.localeCompare(b.label)),
    );
  }

  const choicesFor = (group: OptionGroupKey): OptionChoice[] => [
    ...optionGroups[group].builtin,
    ...(custom.get(group) ?? []).map((option) => ({
      value: option.value,
      label: option.label,
      hint: option.description ?? undefined,
      isCustom: true,
    })),
  ];

  const labelFor = (group: OptionGroupKey, value: string | null | undefined) => {
    if (!value) return "None";
    return choicesFor(group).find((choice) => choice.value === value)?.label ?? humanize(value);
  };

  // Registers a typed label if it is genuinely new, and returns its stored value.
  // Typing a label that already exists (in any casing) just selects the existing
  // one — that's what keeps the vocabulary from growing near-duplicates.
  const register = async (group: OptionGroupKey, rawLabel: string): Promise<string | null> => {
    const label = cleanOptionLabel(rawLabel);
    const value = normalizeOptionValue(label);
    if (!value) return null;
    if (choicesFor(group).some((choice) => choice.value === value)) return value;
    const now = new Date();
    const created = await createRecord("customOptions", {
      createdAt: now,
      updatedAt: now,
      group,
      value,
      label,
      description: null,
    });
    custom.set(group, [...(custom.get(group) ?? []), created].sort((a, b) => a.label.localeCompare(b.label)));
    return value;
  };

  return {
    choices: choicesFor,
    label: labelFor,
    labeler: (group) => (value: string) => labelFor(group, value),
    allows: (group, value) => Boolean(value) && choicesFor(group).some((choice) => choice.value === value),
    custom: (group) => custom.get(group) ?? [],
    allCustom: () => stored,
    async resolve(group, formData, name) {
      for (const typed of splitCustomLabels(formData.get(`${name}Custom`))) {
        const value = await register(group, typed);
        if (value) return value;
      }
      const picked = String(formData.get(name) ?? "");
      return choicesFor(group).some((choice) => choice.value === picked) ? picked : null;
    },
    async resolveMany(group, formData, name) {
      const picked = formData.getAll(name).map(String);
      const known = new Set(choicesFor(group).map((choice) => choice.value));
      const values = picked.filter((value) => known.has(value));
      for (const typed of splitCustomLabels(formData.get(`${name}Custom`))) {
        const value = await register(group, typed);
        if (value && !values.includes(value)) values.push(value);
      }
      return values;
    },
  };
}

/** Rename one of the trader's own labels — the DISPLAY label only.
 *
 *  The stored `value` is deliberately frozen. Records carry the value, not the
 *  label (analytics group by it, filters match on it), so re-normalizing on a
 *  rename would orphan every entry already using it: they'd fall back to the
 *  humanized old value while the picker showed the new one. Renaming is for
 *  fixing how a label reads, not for changing what it means — for that, add a
 *  new label and retire the old one. */
export async function renameCustomOption(id: string, label: string) {
  const clean = cleanOptionLabel(label);
  if (!clean) return null;
  const option = (await listRecords("customOptions")).find((entry) => entry.id === id);
  if (!option) return null;
  return updateRecord("customOptions", id, { label: clean, updatedAt: new Date() });
}

/** Remove one of the trader's own labels. The built-in set can't be touched, and
 *  records already carrying the value keep it — they just fall back to the
 *  humanized form. Nothing in the journal is rewritten. */
export async function removeCustomOption(id: string) {
  await deleteWhere("customOptions", (option) => option.id === id);
}

// ---- Mistake tags -------------------------------------------------------
// Stored as real mistakeTags records (a trade links to one by id), so they get
// their own registration path — but the same rules: normalize once, never
// duplicate an existing tag, keep the typed label for display.

/** Same rule as renameCustomOption: the display label moves, the `name` does
 *  not. Trades link to a mistake tag by id so the name is not load-bearing for
 *  them, but the built-in/primary sets are keyed by name — re-normalizing on a
 *  rename could quietly collide with one of those. */
export async function renameCustomMistakeTag(id: string, label: string) {
  const clean = cleanOptionLabel(label);
  if (!clean) return null;
  const tag = (await listRecords("mistakeTags")).find((entry) => entry.id === id);
  if (!tag) return null;
  return updateRecord("mistakeTags", id, { label: clean });
}

export async function registerCustomMistakeTags(labels: string[]): Promise<MistakeTag[]> {
  const cleaned = labels.map(cleanOptionLabel).filter(Boolean);
  if (!cleaned.length) return [];
  const existing = await listRecords("mistakeTags");
  const byName = new Map(existing.map((tag) => [tag.name, tag]));
  const created: MistakeTag[] = [];
  for (const label of cleaned) {
    const name = normalizeOptionValue(label);
    if (!name) continue;
    const already = byName.get(name);
    if (already) {
      created.push(already);
      continue;
    }
    const tag = await createRecord("mistakeTags", { name, label, description: null });
    byName.set(name, tag);
    created.push(tag);
  }
  return created;
}
