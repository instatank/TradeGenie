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
  | "noteCategory"
  | "tradeTimeframe"
  | "mechanism"
  | "setupGrade";

export type OptionChoice = { value: string; label: string; hint?: string; isCustom?: boolean };

type OptionGroupDef = {
  /** Shown on the settings page where custom labels are reviewed. */
  title: string;
  /** Placeholder inside the "type another" box. */
  placeholder: string;
  builtin: OptionChoice[];
  /** How a typed label becomes a stored value. "label" (the default) is the
   *  ordinary prose normalizer; "grade" keeps + and - and allows a single
   *  character, because in a grade vocabulary those ARE the meaning. */
  shape?: OptionShape;
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
  tradeTimeframe: {
    title: "Chart timeframes (trades)",
    placeholder: "or type another, e.g. 3m…",
    builtin: [
      { value: "1M", label: "1m" },
      { value: "5M", label: "5m" },
      { value: "15M", label: "15m" },
      { value: "1H", label: "1H" },
      { value: "4H", label: "4H" },
      { value: "1D", label: "1D" },
    ],
  },
  mechanism: {
    title: "Setup mechanisms",
    placeholder: "add your own mechanism…",
    // Deliberately the concepts, not the strategies. WHICH system you were
    // running is the playbook setup on the trade; these are the pieces the
    // entry was actually built out of, and a real entry stacks two or three.
    // Hints are here because the owner is learning this vocabulary — they show
    // as tooltips on the chip.
    builtin: [
      { value: "HTF_BIAS", label: "HTF bias", hint: "Higher-timeframe direction the trade agreed with" },
      { value: "MARKET_STRUCTURE_SHIFT", label: "Market structure shift", hint: "MSS / BOS / CHoCH — structure broke in your direction" },
      { value: "DISPLACEMENT", label: "Displacement", hint: "An aggressive, one-sided move away from a level" },
      { value: "LIQUIDITY_SWEEP", label: "Liquidity sweep", hint: "Stops taken above highs / below lows before the real move" },
      { value: "FVG", label: "FVG", hint: "Fair value gap — the imbalance displacement leaves behind" },
      { value: "ORDER_BLOCK", label: "Order block", hint: "The last opposing candle before displacement" },
      { value: "BREAKER", label: "Breaker", hint: "A failed order block that price reclaims and respects" },
      { value: "OTE", label: "OTE", hint: "Optimal trade entry — the 0.62–0.79 retracement pocket" },
      { value: "PREMIUM_DISCOUNT", label: "Premium / discount", hint: "Entered on the right side of the range's midpoint" },
      { value: "EQUAL_HIGHS_LOWS", label: "Equal highs / lows", hint: "The obvious resting liquidity the move was drawn to" },
      { value: "KILLZONE_SESSION", label: "Killzone / session", hint: "The entry sat inside a session window you trade" },
      { value: "RETEST", label: "Retest", hint: "Entered on the return to a broken level, not on the break" },
    ],
  },
  setupGrade: {
    title: "Setup grades",
    placeholder: "or type another, e.g. C…",
    // How good the SETUP was, which is a different question from how well it
    // was executed (that's entryGrade, and it stays a closed A/B/C enum because
    // the process score keys off it). Three built-ins, because a beginner
    // grading setups needs "the best one I take", "a normal one" and "a
    // stretch" — not a ten-point scale. Extendable like every other pill row:
    // an A- or an F is one typed label away.
    shape: "grade",
    builtin: [
      { value: "A_PLUS", label: "A+", hint: "Everything lined up — the trade I'm trying to repeat" },
      { value: "A", label: "A", hint: "A clean setup, one thing short of perfect" },
      { value: "B", label: "B", hint: "Playable, but I was reaching for it" },
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

/** How a group's typed labels normalize. Still ONE function below — a group
 *  declares the shape of its vocabulary, it does not bring its own tokenizer. */
export type OptionShape = "label" | "grade";

/** The one normalizer. "Cut winner early!" → "CUT_WINNER_EARLY". Returns null
 *  if there is nothing usable left, so a stray space can never become an option.
 *
 *  The "grade" shape is the one variation, and it exists because the default
 *  rules are actively wrong for a grade: "A+" and "A-" both strip to "A", so
 *  three different grades would collapse into one stored value, and the
 *  two-character minimum rejects "A" outright. So a grade spells its modifier
 *  out (A+ → A_PLUS) and one character is a whole label. Everything else —
 *  casing, spacing, the charset, the length cap — is identical, because the
 *  point of one normalizer is that re-typing a label selects it instead of
 *  minting a near-duplicate. */
export function normalizeOptionValue(input: string | null | undefined, shape: OptionShape = "label"): string | null {
  const raw = String(input ?? "").trim().toUpperCase();
  const source = shape === "grade" ? raw.replace(/\+/g, "_PLUS_").replace(/-/g, "_MINUS_") : raw;
  const value = source.replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const min = shape === "grade" ? 1 : MIN_LENGTH;
  if (value.length < min || value.length > MAX_LENGTH) return null;
  return value;
}

/** normalizeOptionValue with the group's own shape applied. Every registration
 *  path goes through this, so a group can never be normalized two ways. */
export function normalizeForGroup(group: OptionGroupKey, input: string | null | undefined): string | null {
  return normalizeOptionValue(input, optionGroups[group].shape ?? "label");
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
    const value = normalizeForGroup(group, label);
    if (!value) return null;
    // Match on the normalized VALUE or on the normalized existing LABEL, and
    // return the value that is already stored. A couple of built-ins carry a
    // value that isn't their label normalized ("Just watching" → OBSERVE_ONLY);
    // without the label check, typing one of those would quietly mint a second
    // chip reading exactly the same thing.
    const existing = choicesFor(group).find(
      (choice) => choice.value === value || normalizeForGroup(group, choice.label) === value,
    );
    if (existing) return existing.value;
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
