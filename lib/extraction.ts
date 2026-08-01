// Segmented extraction: ONE captured note becomes MANY typed entries.
//
// The old pipeline returned a single flat 36-field record, so a rambling voice
// note produced exactly one trade OR one journal OR some lessons and everything
// else was silently discarded. Here the model returns an ARRAY of small, typed
// entries and the trader confirms them one card at a time.
//
// This file owns the vocabulary (entry kinds + their fields), the raw JSON
// Schema handed to Anthropic structured outputs, and a tolerant normalizer.
// normalizeExtraction() is used on BOTH sides — once on the model's response and
// again whenever a saved draft is read back — so hand-edited JSON can never
// crash a page or a save.

import {
  assetTimeframes,
  coreLessonCategories,
  directions,
  followedPlanOptions,
  mindStateOptions,
  riskPostures,
} from "@/lib/constants";

export const EntryKind = {
  TRADE_ENTRY: "TRADE_ENTRY",
  TRADE_EXIT: "TRADE_EXIT",
  ASSET_NOTE: "ASSET_NOTE",
  JOURNAL: "JOURNAL",
  LESSON: "LESSON",
  WEEKLY_REFLECTION: "WEEKLY_REFLECTION",
  FREE_NOTE: "FREE_NOTE",
} as const;

export type EntryKind = (typeof EntryKind)[keyof typeof EntryKind];

export const entryKinds = Object.values(EntryKind) as EntryKind[];

export const entryKindLabels: Record<EntryKind, string> = {
  TRADE_ENTRY: "Trade",
  TRADE_EXIT: "Exit review",
  ASSET_NOTE: "Asset note",
  JOURNAL: "Daily journal",
  LESSON: "Lesson",
  WEEKLY_REFLECTION: "Weekly",
  FREE_NOTE: "Thought",
};

// Where confirming each kind actually writes. Shown on the review card so the
// trader always knows what a confirm is about to do.
export const entryKindDestinations: Record<EntryKind, string> = {
  TRADE_ENTRY: "Creates a trade in your log.",
  TRADE_EXIT: "Updates the linked trade — never creates a new one.",
  ASSET_NOTE: "Appends to that asset's thread (creates the asset if it's new).",
  JOURNAL: "Merges into that day's journal.",
  LESSON: "Saves to your lesson bank.",
  WEEKLY_REFLECTION: "Saves a weekly review.",
  FREE_NOTE: "Saves as a plain note you can search.",
};

const mindStateValues = [...mindStateOptions, "UNKNOWN"] as const;

export type Confidence = "LOW" | "MEDIUM" | "HIGH";

type BaseEntry = { kind: EntryKind; confidence: Confidence };

export type TradeEntryEntry = BaseEntry & {
  kind: "TRADE_ENTRY";
  instrument: string | null;
  direction: string;
  status: string;
  setupName: string | null;
  entryThesis: string | null;
  invalidation: string | null;
  concern: string | null;
  emotionalState: string;
  riskPosture: string;
  confidenceScore: number | null;
  entryPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  quantity: number | null;
  leverage: number | null;
  suggestedMistakeTags: string[];
};

export type TradeExitEntry = BaseEntry & {
  kind: "TRADE_EXIT";
  linkTradeId: string | null;
  instrument: string | null;
  exitPrice: number | null;
  realizedPnl: number | null;
  exitReason: string | null;
  followedPlan: string;
  emotionalState: string;
  lesson: string | null;
  suggestedMistakeTags: string[];
};

export type AssetNoteEntry = BaseEntry & {
  kind: "ASSET_NOTE";
  assetSymbol: string;
  timeframe: string;
  text: string;
};

export type JournalEntry = BaseEntry & {
  kind: "JOURNAL";
  mainEmotion: string;
  tradedToday: boolean | null;
  followedMaxLoss: boolean | null;
  followedMaxTrades: boolean | null;
  bestDecision: string | null;
  worstDecision: string | null;
  mainMistake: string | null;
  oneThingDoneWell: string | null;
  oneThingToAvoidTomorrow: string | null;
  disciplineScore: number | null;
};

export type LessonEntry = BaseEntry & {
  kind: "LESSON";
  lessonText: string;
  category: string;
};

export type WeeklyReflectionEntry = BaseEntry & {
  kind: "WEEKLY_REFLECTION";
  summaryText: string;
  whatImproved: string | null;
  whatDeteriorated: string | null;
  keyLesson: string | null;
};

export type FreeNoteEntry = BaseEntry & {
  kind: "FREE_NOTE";
  text: string;
};

export type ExtractedEntry =
  | TradeEntryEntry
  | TradeExitEntry
  | AssetNoteEntry
  | JournalEntry
  | LessonEntry
  | WeeklyReflectionEntry
  | FreeNoteEntry;

export type SegmentedExtraction = {
  entries: ExtractedEntry[];
  missingInfo: string[];
  overallConfidence: Confidence;
};

/* ------------------------------------------------------------------ *
 * JSON Schema for Anthropic structured outputs
 * ------------------------------------------------------------------ *
 * An `anyOf` of per-kind objects, discriminated on a `const` kind. Each entry
 * therefore carries ONLY its own fields instead of the union of all of them —
 * that is what keeps output near ~500 tokens even when a note splits four ways.
 * Structured outputs need every property listed in `required`, so optional
 * fields are nullable rather than absent.
 */

const nullableString = { type: ["string", "null"] } as const;
const nullableNumber = { type: ["number", "null"] } as const;
const nullableBool = { type: ["boolean", "null"] } as const;
const confidenceField = { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] } as const;

function entrySchema(kind: EntryKind, properties: Record<string, unknown>) {
  const all = { kind: { const: kind }, confidence: confidenceField, ...properties };
  return {
    type: "object",
    additionalProperties: false,
    properties: all,
    required: Object.keys(all),
  };
}

const entryVariants = [
  entrySchema(EntryKind.TRADE_ENTRY, {
    instrument: nullableString,
    direction: { type: "string", enum: [...directions] },
    status: { type: "string", enum: ["OPEN", "IDEA"] },
    setupName: nullableString,
    entryThesis: nullableString,
    invalidation: nullableString,
    concern: nullableString,
    emotionalState: { type: "string", enum: [...mindStateValues] },
    riskPosture: { type: "string", enum: [...riskPostures] },
    confidenceScore: nullableNumber,
    entryPrice: nullableNumber,
    stopPrice: nullableNumber,
    targetPrice: nullableNumber,
    quantity: nullableNumber,
    leverage: nullableNumber,
    suggestedMistakeTags: { type: "array", items: { type: "string" } },
  }),
  entrySchema(EntryKind.TRADE_EXIT, {
    linkTradeId: nullableString,
    instrument: nullableString,
    exitPrice: nullableNumber,
    realizedPnl: nullableNumber,
    exitReason: nullableString,
    followedPlan: { type: "string", enum: [...followedPlanOptions] },
    emotionalState: { type: "string", enum: [...mindStateValues] },
    lesson: nullableString,
    suggestedMistakeTags: { type: "array", items: { type: "string" } },
  }),
  entrySchema(EntryKind.ASSET_NOTE, {
    assetSymbol: { type: "string" },
    timeframe: { type: "string", enum: [...assetTimeframes] },
    text: { type: "string" },
  }),
  entrySchema(EntryKind.JOURNAL, {
    mainEmotion: { type: "string", enum: [...mindStateValues] },
    tradedToday: nullableBool,
    followedMaxLoss: nullableBool,
    followedMaxTrades: nullableBool,
    bestDecision: nullableString,
    worstDecision: nullableString,
    mainMistake: nullableString,
    oneThingDoneWell: nullableString,
    oneThingToAvoidTomorrow: nullableString,
    disciplineScore: nullableNumber,
  }),
  entrySchema(EntryKind.LESSON, {
    lessonText: { type: "string" },
    category: { type: "string", enum: [...coreLessonCategories] },
  }),
  entrySchema(EntryKind.WEEKLY_REFLECTION, {
    summaryText: { type: "string" },
    whatImproved: nullableString,
    whatDeteriorated: nullableString,
    keyLesson: nullableString,
  }),
  entrySchema(EntryKind.FREE_NOTE, {
    text: { type: "string" },
  }),
];

export const segmentedJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    entries: { type: "array", items: { anyOf: entryVariants } },
    missingInfo: { type: "array", items: { type: "string" } },
    overallConfidence: confidenceField,
  },
  required: ["entries", "missingInfo", "overallConfidence"],
} as const;

/* ------------------------------------------------------------------ *
 * Tolerant normalizer
 * ------------------------------------------------------------------ */

export function normalizeExtraction(value: unknown): SegmentedExtraction {
  const record = asRecord(value);
  const rawEntries = Array.isArray(record?.entries) ? record.entries : [];
  const entries = rawEntries
    .map((entry) => normalizeEntry(entry))
    .filter((entry): entry is ExtractedEntry => Boolean(entry));
  return {
    entries,
    missingInfo: stringList(record?.missingInfo),
    overallConfidence: confidence(record?.overallConfidence),
  };
}

export function normalizeEntry(value: unknown): ExtractedEntry | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const kind = entryKinds.find((candidate) => candidate === String(raw.kind ?? "").toUpperCase());
  if (!kind) return null;
  const base = { kind, confidence: confidence(raw.confidence) };

  switch (kind) {
    case "TRADE_ENTRY":
      return {
        ...base,
        kind,
        instrument: upperOrNull(raw.instrument),
        direction: oneOf(raw.direction, directions, "UNKNOWN"),
        status: oneOf(raw.status, ["OPEN", "IDEA"], "IDEA"),
        setupName: textOrNull(raw.setupName),
        entryThesis: textOrNull(raw.entryThesis),
        invalidation: textOrNull(raw.invalidation),
        concern: textOrNull(raw.concern),
        emotionalState: oneOf(raw.emotionalState, mindStateValues, "UNKNOWN"),
        riskPosture: oneOf(raw.riskPosture, riskPostures, "UNKNOWN"),
        confidenceScore: numberOrNull(raw.confidenceScore),
        entryPrice: numberOrNull(raw.entryPrice),
        stopPrice: numberOrNull(raw.stopPrice),
        targetPrice: numberOrNull(raw.targetPrice),
        quantity: numberOrNull(raw.quantity),
        leverage: numberOrNull(raw.leverage),
        suggestedMistakeTags: stringList(raw.suggestedMistakeTags),
      };
    case "TRADE_EXIT":
      return {
        ...base,
        kind,
        linkTradeId: textOrNull(raw.linkTradeId),
        instrument: upperOrNull(raw.instrument),
        exitPrice: numberOrNull(raw.exitPrice),
        realizedPnl: numberOrNull(raw.realizedPnl),
        exitReason: textOrNull(raw.exitReason),
        followedPlan: oneOf(raw.followedPlan, followedPlanOptions, "NA"),
        emotionalState: oneOf(raw.emotionalState, mindStateValues, "UNKNOWN"),
        lesson: textOrNull(raw.lesson),
        suggestedMistakeTags: stringList(raw.suggestedMistakeTags),
      };
    case "ASSET_NOTE": {
      const assetSymbol = upperOrNull(raw.assetSymbol);
      const text = textOrNull(raw.text);
      if (!assetSymbol && !text) return null;
      return { ...base, kind, assetSymbol: assetSymbol ?? "", timeframe: oneOf(raw.timeframe, assetTimeframes, "GENERAL"), text: text ?? "" };
    }
    case "JOURNAL":
      return {
        ...base,
        kind,
        mainEmotion: oneOf(raw.mainEmotion, mindStateValues, "UNKNOWN"),
        tradedToday: boolOrNull(raw.tradedToday),
        followedMaxLoss: boolOrNull(raw.followedMaxLoss),
        followedMaxTrades: boolOrNull(raw.followedMaxTrades),
        bestDecision: textOrNull(raw.bestDecision),
        worstDecision: textOrNull(raw.worstDecision),
        mainMistake: textOrNull(raw.mainMistake),
        oneThingDoneWell: textOrNull(raw.oneThingDoneWell),
        oneThingToAvoidTomorrow: textOrNull(raw.oneThingToAvoidTomorrow),
        disciplineScore: numberOrNull(raw.disciplineScore),
      };
    case "LESSON": {
      const lessonText = textOrNull(raw.lessonText);
      if (!lessonText) return null;
      return { ...base, kind, lessonText, category: oneOf(raw.category, coreLessonCategories, "PROCESS") };
    }
    case "WEEKLY_REFLECTION": {
      const summaryText = textOrNull(raw.summaryText);
      if (!summaryText) return null;
      return {
        ...base,
        kind,
        summaryText,
        whatImproved: textOrNull(raw.whatImproved),
        whatDeteriorated: textOrNull(raw.whatDeteriorated),
        keyLesson: textOrNull(raw.keyLesson),
      };
    }
    case "FREE_NOTE": {
      const text = textOrNull(raw.text);
      if (!text) return null;
      return { ...base, kind, text };
    }
  }
}

// Every text field an entry carries, for tag derivation (lib/tags.ts) and for
// the one-line summary on the collapsed review card.
export function entryTexts(entry: ExtractedEntry): Array<string | null> {
  switch (entry.kind) {
    case "TRADE_ENTRY":
      return [entry.entryThesis, entry.invalidation, entry.concern, entry.setupName];
    case "TRADE_EXIT":
      return [entry.exitReason, entry.lesson];
    case "ASSET_NOTE":
      return [entry.text];
    case "JOURNAL":
      return [entry.bestDecision, entry.worstDecision, entry.mainMistake, entry.oneThingDoneWell, entry.oneThingToAvoidTomorrow];
    case "LESSON":
      return [entry.lessonText];
    case "WEEKLY_REFLECTION":
      return [entry.summaryText, entry.whatImproved, entry.whatDeteriorated, entry.keyLesson];
    case "FREE_NOTE":
      return [entry.text];
  }
}

export function entrySummary(entry: ExtractedEntry): string {
  switch (entry.kind) {
    case "TRADE_ENTRY":
      return [entry.instrument ?? "Unknown symbol", entry.direction === "UNKNOWN" ? null : entry.direction.toLowerCase(), entry.entryThesis]
        .filter(Boolean)
        .join(" · ");
    case "TRADE_EXIT":
      return [entry.instrument ?? "Exit", entry.exitPrice == null ? null : `out at ${entry.exitPrice}`, entry.exitReason]
        .filter(Boolean)
        .join(" · ");
    case "ASSET_NOTE":
      return [entry.assetSymbol, entry.text].filter(Boolean).join(" · ");
    case "JOURNAL":
      return [entry.mainEmotion === "UNKNOWN" ? null : entry.mainEmotion, entry.oneThingDoneWell ?? entry.mainMistake ?? entry.bestDecision]
        .filter(Boolean)
        .join(" · ") || "Journal entry";
    case "LESSON":
      return entry.lessonText;
    case "WEEKLY_REFLECTION":
      return entry.summaryText;
    case "FREE_NOTE":
      return entry.text;
  }
}

/* ------------------------------ coercion ------------------------------ */

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function upperOrNull(value: unknown): string | null {
  const text = textOrNull(value);
  return text ? text.toUpperCase() : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolOrNull(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function oneOf(value: unknown, allowed: readonly string[], fallback: string): string {
  const text = String(value ?? "").toUpperCase();
  return allowed.includes(text) ? text : fallback;
}

function confidence(value: unknown): Confidence {
  const text = String(value ?? "").toUpperCase();
  return text === "HIGH" ? "HIGH" : text === "MEDIUM" ? "MEDIUM" : "LOW";
}
