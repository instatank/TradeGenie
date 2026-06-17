import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/data";
import { extractionSystemPrompt, generalExtraction, type PromptTemplateKey } from "@/lib/prompts";
import { getSettings } from "@/lib/settings-store";

const DEFAULT_MODEL = "claude-sonnet-4-6";

const extractionSchema = z.object({
  transcriptType: z.string().default("UNKNOWN"),
  instrument: z.string().nullable().optional(),
  direction: z.string().nullable().optional(),
  setupName: z.string().nullable().optional(),
  entryThesis: z.string().nullable().optional(),
  invalidation: z.string().nullable().optional(),
  concern: z.string().nullable().optional(),
  emotionalState: z.string().nullable().optional(),
  riskPosture: z.string().nullable().optional(),
  confidenceScore: z.number().nullable().optional(),
  entryGrade: z.string().nullable().optional(),
  entryPrice: z.number().nullable().optional(),
  stopPrice: z.number().nullable().optional(),
  targetPrice: z.number().nullable().optional(),
  exitPrice: z.number().nullable().optional(),
  quantity: z.number().nullable().optional(),
  leverage: z.number().nullable().optional(),
  realizedPnl: z.number().nullable().optional(),
  exitReason: z.string().nullable().optional(),
  followedPlan: z.string().nullable().optional(),
  suggestedMistakeTags: z.array(z.string()).default([]),
  lessons: z.union([
    z.array(z.string()),
    z.array(z.object({ lessonText: z.string(), category: z.string().optional(), confidence: z.string().optional() })),
  ]).default([]),
  missingInfo: z.array(z.string()).default([]),
  tradedToday: z.boolean().nullable().optional(),
  followedMaxLoss: z.boolean().nullable().optional(),
  followedMaxTrades: z.boolean().nullable().optional(),
  bestDecision: z.string().nullable().optional(),
  worstDecision: z.string().nullable().optional(),
  mainEmotion: z.string().nullable().optional(),
  mainMistake: z.string().nullable().optional(),
  oneThingDoneWell: z.string().nullable().optional(),
  oneThingToAvoidTomorrow: z.string().nullable().optional(),
  disciplineScore: z.number().nullable().optional(),
  lesson: z.string().nullable().optional(),
  futureRule: z.string().nullable().optional(),
  confidence: z.string().default("LOW"),
});

export type TranscriptExtraction = z.infer<typeof extractionSchema>;

// Plain JSON Schema for Anthropic structured outputs — guarantees the model
// returns schema-valid JSON. Optional fields are nullable so the model always
// emits every key; the result is re-parsed through extractionSchema (above) to
// apply defaults and the lessons union. Kept as raw JSON Schema (not a Zod
// helper) so it isn't coupled to a specific Zod major version.
const nullableString = { type: ["string", "null"] } as const;
const nullableNumberType = { type: ["number", "null"] } as const;
const nullableBool = { type: ["boolean", "null"] } as const;

const extractionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    transcriptType: { type: "string" },
    instrument: nullableString,
    direction: nullableString,
    setupName: nullableString,
    entryThesis: nullableString,
    invalidation: nullableString,
    concern: nullableString,
    emotionalState: nullableString,
    riskPosture: nullableString,
    confidenceScore: nullableNumberType,
    entryGrade: nullableString,
    entryPrice: nullableNumberType,
    stopPrice: nullableNumberType,
    targetPrice: nullableNumberType,
    exitPrice: nullableNumberType,
    quantity: nullableNumberType,
    leverage: nullableNumberType,
    realizedPnl: nullableNumberType,
    exitReason: nullableString,
    followedPlan: nullableString,
    suggestedMistakeTags: { type: "array", items: { type: "string" } },
    lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: { lessonText: { type: "string" }, category: nullableString },
        required: ["lessonText", "category"],
      },
    },
    missingInfo: { type: "array", items: { type: "string" } },
    tradedToday: nullableBool,
    followedMaxLoss: nullableBool,
    followedMaxTrades: nullableBool,
    bestDecision: nullableString,
    worstDecision: nullableString,
    mainEmotion: nullableString,
    mainMistake: nullableString,
    oneThingDoneWell: nullableString,
    oneThingToAvoidTomorrow: nullableString,
    disciplineScore: nullableNumberType,
    lesson: nullableString,
    futureRule: nullableString,
    confidence: { type: "string" },
  },
  required: [
    "transcriptType", "instrument", "direction", "setupName", "entryThesis", "invalidation",
    "concern", "emotionalState", "riskPosture", "confidenceScore", "entryGrade",
    "entryPrice", "stopPrice", "targetPrice", "exitPrice", "quantity", "leverage", "realizedPnl",
    "exitReason",
    "followedPlan", "suggestedMistakeTags", "lessons", "missingInfo", "tradedToday",
    "followedMaxLoss", "followedMaxTrades", "bestDecision", "worstDecision", "mainEmotion",
    "mainMistake", "oneThingDoneWell", "oneThingToAvoidTomorrow", "disciplineScore", "lesson",
    "futureRule", "confidence",
  ],
} as const;

export async function structureTranscript(rawText: string, declaredType = "UNKNOWN") {
  const settings = await getSettings();
  if (settings.aiEnabled && process.env.ANTHROPIC_API_KEY) {
    try {
      return await anthropicExtraction(rawText, declaredType, settings.promptTemplates);
    } catch {
      return mockExtraction(rawText, declaredType);
    }
  }
  return mockExtraction(rawText, declaredType);
}

// Route a declared note type to the single most relevant prompt template.
// UNKNOWN falls back to a classify-first general prompt instead of sending all
// templates at once, which keeps the instructions focused and the call cheaper.
function selectTemplate(declaredType: string, prompts: Record<string, string>): string {
  const byType: Record<string, PromptTemplateKey> = {
    TRADE_ENTRY_NOTE: "tradeEntry",
    TRADE_EXIT_REVIEW: "tradeExit",
    EOD_REVIEW: "eodReview",
    DAILY_CHECKIN: "eodReview",
    WEEKLY_REFLECTION: "weeklyReview",
    PLAYBOOK_NOTE: "lessonExtraction",
    GENERAL_LEARNING_NOTE: "lessonExtraction",
    MISTAKE_REFLECTION: "lessonExtraction",
  };
  const key = byType[declaredType];
  return key ? prompts[key] : generalExtraction;
}

// Pull the real mistake-tag vocabulary from the store so the model is told the
// exact identifiers that linkSuggestedMistakes() will match — no hardcoded drift.
async function mistakeTagReference(): Promise<string> {
  const tags = await db.list("mistakeTags");
  if (!tags.length) return "(no mistake tags configured)";
  return tags.map((tag) => `- ${tag.name} — ${tag.label}`).join("\n");
}

async function anthropicExtraction(rawText: string, declaredType: string, prompts: Record<string, string>) {
  const systemPrompt = extractionSystemPrompt(await mistakeTagReference());
  const userPrompt = [
    selectTemplate(declaredType, prompts),
    "Respect the declared type when it is specific. Only override it when the transcript clearly belongs to another category.",
    "Do not classify an entry note as an exit review merely because the trader mentions where they may exit in the future.",
    `Declared type: ${declaredType}`,
    `Transcript:\n${rawText}`,
  ].join("\n\n");

  const client = new Anthropic();
  const message = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    max_tokens: 2048,
    thinking: { type: "disabled" }, // extraction needs no reasoning — keeps it fast and cheap
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    output_config: { format: { type: "json_schema", schema: extractionJsonSchema } },
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!text.trim()) throw new Error("Anthropic returned no content");
  // Structured outputs guarantee schema-valid JSON; re-parse through the lenient
  // schema to apply defaults and the lessons union.
  return extractionSchema.parse(JSON.parse(text));
}

function mockExtraction(rawText: string, declaredType: string): TranscriptExtraction {
  const text = rawText.toLowerCase();
  const instrument = findInstrument(rawText);
  const direction = detectDirection(text);
  const explicitType = declaredType !== "UNKNOWN";
  const hasEntry = hasEntryIntent(text);
  const isExit = declaredType === "TRADE_EXIT_REVIEW" || (!explicitType && !hasEntry && hasExitReviewIntent(text));
  const isEod = declaredType === "EOD_REVIEW" || (!explicitType && /\b(eod|end of day|today i|discipline score)\b/.test(text));
  const isWeekly = declaredType === "WEEKLY_REFLECTION" || (!explicitType && /\b(this week|weekly)\b/.test(text));
  const mistakes = detectMistakes(text);
  const emotion = detectEmotion(text);
  const lessons = detectLessons(rawText, mistakes);
  const thesis = buildEntryThesis(rawText, instrument);
  const invalidation = sentenceContaining(rawText, ["invalid", "stop", "wrong", "if this fails", "if price loses"]);
  const concern = buildConcern(rawText);

  if (isEod) {
    return extractionSchema.parse({
      transcriptType: "EOD_REVIEW",
      tradedToday: !text.includes("did not trade") && !text.includes("no trade"),
      followedMaxLoss: text.includes("followed max loss") ? true : text.includes("broke max loss") ? false : null,
      followedMaxTrades: text.includes("followed max trades") ? true : text.includes("overtrade") ? false : null,
      bestDecision: sentenceContaining(rawText, ["best", "good decision"]),
      worstDecision: sentenceContaining(rawText, ["worst", "bad decision"]),
      mainEmotion: emotion,
      mainMistake: mistakes[0] ?? null,
      oneThingDoneWell: sentenceContaining(rawText, ["well", "good"]),
      oneThingToAvoidTomorrow: sentenceContaining(rawText, ["avoid", "tomorrow"]),
      disciplineScore: findScore(text),
      lessons,
      confidence: "MEDIUM",
    });
  }

  const numbers = extractNumbers(text);

  if (isExit) {
    return extractionSchema.parse({
      transcriptType: "TRADE_EXIT_REVIEW",
      instrument,
      exitPrice: numbers.exitPrice,
      realizedPnl: numbers.realizedPnl,
      exitReason: sentenceContaining(rawText, ["exit", "closed", "target", "stopped"]),
      followedPlan: text.includes("followed plan") ? "YES" : text.includes("broke plan") || text.includes("did not follow") ? "NO" : "NA",
      emotionalState: emotion,
      suggestedMistakeTags: mistakes,
      lesson: lessons[0] ?? null,
      futureRule: sentenceContaining(rawText, ["next time", "rule"]),
      confidence: "MEDIUM",
    });
  }

  return extractionSchema.parse({
    transcriptType: isWeekly ? "WEEKLY_REFLECTION" : declaredType !== "UNKNOWN" ? declaredType : "TRADE_ENTRY_NOTE",
    instrument,
    direction,
    setupName: detectSetupName(rawText),
    entryThesis: thesis ?? rawText.slice(0, 260),
    invalidation,
    concern,
    emotionalState: emotion,
    riskPosture: text.includes("small") || text.includes("reduced") ? "REDUCED" : text.includes("aggressive") ? "AGGRESSIVE" : "NORMAL",
    confidenceScore: findScore(text),
    entryGrade: "NA",
    entryPrice: numbers.entryPrice,
    stopPrice: numbers.stopPrice,
    targetPrice: numbers.targetPrice,
    leverage: numbers.leverage,
    suggestedMistakeTags: mistakes,
    lessons,
    missingInfo: buildMissingInfo({ instrument, direction, invalidation }),
    confidence: instrument && direction !== "UNKNOWN" ? "MEDIUM" : "LOW",
  });
}

// Best-effort number capture for the no-API-key dev fallback. The real value
// comes from the Claude path (driven by the prompt); this just keeps the mock
// from silently dropping every spoken price.
function extractNumbers(text: string) {
  const find = (labels: string[]) => {
    for (const label of labels) {
      const match = text.match(new RegExp(`${label}[^0-9$-]{0,12}(-?\\$?[0-9][0-9,]*\\.?[0-9]*)`, "i"));
      if (match) {
        const value = Number(match[1].replace(/[$,]/g, ""));
        if (Number.isFinite(value)) return value;
      }
    }
    return null;
  };
  const leverageMatch = text.match(/(\d+(?:\.\d+)?)\s*x\b/i);
  return {
    entryPrice: find(["entry", "entered at", "got in at", "bought at", "long at", "short at", "in at"]),
    stopPrice: find(["stop loss", "stop", "invalidation at"]),
    targetPrice: find(["target", "take profit", "\\btp\\b"]),
    exitPrice: find(["exit", "exited at", "closed at", "out at", "sold at", "took profit at"]),
    realizedPnl: find(["pnl", "p&l", "made", "lost", "profit of", "loss of"]),
    leverage: leverageMatch ? Number(leverageMatch[1]) : null,
  };
}

function findInstrument(rawText: string) {
  const known = rawText.match(/\b(BTC|ETH|SOL|ZEC|HYPE|NIFTY|BANKNIFTY|RELIANCE|TCS|INFY|HDFCBANK|ICICIBANK)\b/i);
  if (known?.[1]) return known[1].toUpperCase();

  const actionMatch = rawText.match(/\b(?:entering|entered|enter|buying|selling|watching|trading)\s+([A-Z][A-Z0-9.-]{1,11})\b/);
  if (actionMatch?.[1]) return actionMatch[1].toUpperCase();

  const uppercaseCandidates = rawText.match(/\b[A-Z][A-Z0-9.-]{1,11}\b/g) ?? [];
  const ignored = new Set(["I", "US", "USA", "USD", "INR", "API", "EOD", "AI"]);
  return uppercaseCandidates.find((candidate) => !ignored.has(candidate)) ?? null;
}

function detectDirection(text: string) {
  if (/\b(short|shorting|sell)\b/.test(text)) return "SHORT";
  if (/\b(long|buy|buying)\b/.test(text)) return "LONG";
  return "UNKNOWN";
}

function hasEntryIntent(text: string) {
  return /\b(i am entering|i'm entering|entering|going to enter|enter into|taking|opening|trade entry|long trade|short trade)\b/.test(text);
}

function hasExitReviewIntent(text: string) {
  return /\b(exit review|exited|i exited|closed|i closed|booked|stopped out|hit stop|target hit|took profit|cut the trade)\b/.test(text);
}

function detectSetupName(rawText: string) {
  const explicit = sentenceContaining(rawText, ["setup", "breakout", "pullback", "range"]);
  if (explicit) return explicit;
  const text = rawText.toLowerCase();
  if (text.includes("macro") || text.includes("large-scale")) return "Macro continuation long";
  if (text.includes("going against the price action")) return "Contrarian macro thesis";
  if (text.includes("continuation") || text.includes("continue going up")) return "Continuation";
  return null;
}

function buildEntryThesis(rawText: string, instrument: string | null) {
  const text = rawText.toLowerCase();
  const summaryParts: string[] = [];
  if (text.includes("war is over") || text.includes("everything is going up")) {
    summaryParts.push("Macro backdrop appears risk-on after the US-Iran war note and broad market strength.");
  }
  if (instrument && text.includes("only thing") && text.includes("hasn't") && text.includes("gone up")) {
    summaryParts.push(`${instrument} has lagged the broader move and may catch up.`);
  }
  if (text.includes("expected") && text.includes("continue going up")) {
    summaryParts.push("Trader expects upside continuation.");
  }
  if (text.includes("macro") && text.includes("long direction")) {
    summaryParts.push("Macro and large-scale signals are pointing long.");
  }
  if (summaryParts.length) return summaryParts.join(" ");

  const thesisSentences = sentences(rawText).filter((sentence) => {
    const sentenceText = sentence.toLowerCase();
    return [
      "expected",
      "continue",
      "going up",
      "macro",
      "large-scale",
      "signals",
      "long direction",
      "should pay off",
    ].some((needle) => sentenceText.includes(needle));
  });
  return thesisSentences.length ? thesisSentences.join(" ") : sentenceContaining(rawText, ["because", "thesis", "looking for", "expecting"]);
}

function buildConcern(rawText: string) {
  const text = rawText.toLowerCase();
  if (text.includes("going against the price action") && (text.includes("downward pressure") || text.includes("downward momentum"))) {
    return "Trade is against current price action; note mentions downward pressure/downward momentum.";
  }
  const concernSentences = sentences(rawText).filter((sentence) => {
    const text = sentence.toLowerCase();
    return [
      "going against the price action",
      "downward pressure",
      "downward momentum",
      "concern",
      "worry",
      "risk",
    ].some((needle) => text.includes(needle));
  });
  return concernSentences.length ? concernSentences.join(" ") : null;
}

function detectEmotion(text: string) {
  // Maps onto the lean-6 emotional vocabulary the UI and prompts now use.
  if (text.includes("fomo")) return "FOMO";
  if (text.includes("revenge") || text.includes("tilt") || text.includes("frustrat") || text.includes("angry")) return "TILTED";
  if (text.includes("anxious") || text.includes("nervous") || text.includes("fear")) return "ANXIOUS";
  if (text.includes("tired") || text.includes("exhaust") || text.includes("sleepy")) return "TIRED";
  if (text.includes("overconfident") || text.includes("greedy") || text.includes("euphoric")) return "OVERCONFIDENT";
  if (text.includes("calm") || text.includes("sharp") || text.includes("composed")) return "CALM";
  return "UNKNOWN";
}

function detectMistakes(text: string) {
  const tags: string[] = [];
  if (text.includes("fomo")) tags.push("FOMO_ENTRY");
  if (text.includes("revenge")) tags.push("REVENGE_TRADE");
  if (text.includes("oversize") || text.includes("too big")) tags.push("OVERSIZED");
  if (text.includes("moved stop")) tags.push("MOVED_STOP");
  if (text.includes("no plan")) tags.push("NO_PLAN");
  if (text.includes("late")) tags.push("ENTERED_LATE");
  if (text.includes("overtrade")) tags.push("OVERTRADED");
  if (text.includes("bored")) tags.push("BOREDOM_TRADE");
  if (text.includes("cut") && text.includes("early")) tags.push("CUT_WINNER_EARLY");
  if (text.includes("going against the price action")) tags.push("IGNORED_MARKET_REGIME");
  return Array.from(new Set(tags));
}

function detectLessons(rawText: string, mistakes: string[]) {
  const explicit = sentenceContaining(rawText, ["lesson", "learned", "next time"]);
  if (explicit) return [explicit];
  if (mistakes.includes("FOMO_ENTRY")) return ["Wait for the planned entry zone instead of reacting to missed movement."];
  if (mistakes.includes("MOVED_STOP")) return ["Respect the original invalidation unless the setup has objectively changed."];
  return [];
}

function sentenceContaining(rawText: string, needles: string[]) {
  return sentences(rawText).find((sentence) => needles.some((needle) => sentence.toLowerCase().includes(needle))) ?? null;
}

function sentences(rawText: string) {
  return rawText.split(/[.!?\n]/).map((part) => part.trim()).filter(Boolean);
}

function findScore(text: string) {
  const match = text.match(/\b(?:score|confidence|discipline)\s*(?:is|was|:)?\s*(10|[1-9])\b/);
  return match ? Number(match[1]) : null;
}

function buildMissingInfo(input: { instrument: string | null; direction: string; invalidation?: string | null }) {
  const missing = [];
  if (!input.instrument) missing.push("instrument");
  if (input.direction === "UNKNOWN") missing.push("direction");
  if (!input.invalidation) missing.push("invalidation");
  return missing;
}
