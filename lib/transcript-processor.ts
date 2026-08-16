import Anthropic from "@anthropic-ai/sdk";
import { activeModel, describeAiError } from "@/lib/ai-status";
import { db } from "@/lib/data";
import { buildExtractionContext, resolveTradeHandle } from "@/lib/extraction-context";
import { normalizeExtraction, type SegmentedExtraction } from "@/lib/extraction";
import { extractionSystemPrompt } from "@/lib/prompts";
import { getSettings } from "@/lib/settings-store";

// Claude Sonnet 5. Adaptive thinking is the on-mode on this model (budget_tokens
// is removed and returns a 400); effort stays LOW because extraction is a short,
// scoped, latency-sensitive task sitting inside the <20s paste/save budget.
// Adaptive still lets the model think when a note genuinely needs untangling.
// Bump ANTHROPIC_MODEL or EXTRACTION_EFFORT below if accuracy needs more room.
const EXTRACTION_EFFORT = "low";

// max_tokens caps thinking AND the JSON together. The entries themselves are
// ~500 tokens, but adaptive thinking draws from the same budget, so a tangled
// note used to truncate mid-JSON and land in the fallback with no explanation.
const MAX_TOKENS = 8192;

// No prompt caching on purpose: the prompt is ~1.2k tokens, barely over the
// cacheable minimum, so the write premium would cost more than it saves.

export type { SegmentedExtraction };

export async function structureTranscript(rawText: string): Promise<SegmentedExtraction> {
  const settings = await getSettings();
  if (!settings.aiEnabled) {
    return mockExtraction(rawText, "AI is switched off in Settings — this note was saved as a plain thought.");
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return mockExtraction(rawText, "No ANTHROPIC_API_KEY is set on the server — this note was saved as a plain thought.");
  }
  try {
    return await anthropicExtraction(rawText, settings.promptTemplates.capture);
  } catch (error) {
    // Never swallow this silently again: the server log gets the real error and
    // the review card gets a sentence explaining why the note wasn't split up.
    console.error("[capture] Anthropic extraction failed:", error);
    return mockExtraction(rawText, `AI extraction failed: ${describeAiError(error)}. This note was saved as a plain thought.`);
  }
}

/**
 * Pull the JSON object out of the model's reply.
 *
 * We deliberately do NOT constrain generation with `output_config.format` any
 * more. Structured outputs compile the schema into a grammar, and this schema —
 * seven entry kinds in an `anyOf`, each with up to 19 required properties, inside
 * an array — blew two separate ceilings in a row: first the 16-union parameter
 * cap, then "the compiled grammar is too large". Both rejected the request with a
 * 400 before the model ever read the note, so every single capture fell back to
 * plain text. Shrinking the vocabulary to fit an undocumented size limit would
 * have meant giving up entry kinds or fields, i.e. giving up the product.
 *
 * The guarantee moves to our side instead, where it was always enforced anyway:
 * normalizeExtraction() is tolerant by construction — it already had to survive
 * hand-edited drafts read back from the store, so it coerces types, drops unknown
 * kinds and fills defaults. The only thing the grammar bought us was well-formed
 * JSON, which this recovers: strip any markdown fence, then take the outermost
 * {...}. A reply we genuinely can't parse throws and is reported by name.
 */
export function parseJsonLoose(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Any prose the model wrapped around the object — take the widest {...}.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new Error("the model's reply contained no JSON object");
    }
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

// Pull the real mistake-tag vocabulary from the store so the model is told the
// exact identifiers that linkSuggestedMistakes() will match — no hardcoded drift.
async function mistakeTagReference(): Promise<string> {
  const tags = await db.list("mistakeTags");
  if (!tags.length) return "(no mistake tags configured)";
  return tags.map((tag) => `- ${tag.name} — ${tag.label}`).join("\n");
}

async function anthropicExtraction(rawText: string, template: string): Promise<SegmentedExtraction> {
  const [systemPrompt, context] = await Promise.all([
    mistakeTagReference().then(extractionSystemPrompt),
    buildExtractionContext(),
  ]);

  const userPrompt = [template, context.text, `Voice note:\n${rawText}`].join("\n\n---\n\n");

  const client = new Anthropic();
  const message = await client.messages.create({
    model: activeModel(),
    max_tokens: MAX_TOKENS,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    output_config: { effort: EXTRACTION_EFFORT },
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  // A truncated response is half-written JSON. Say so, rather than letting
  // JSON.parse throw an opaque SyntaxError.
  if (message.stop_reason === "max_tokens") {
    throw new Error(`the note was too long for the ${MAX_TOKENS}-token budget and the reply was cut off`);
  }
  if (message.stop_reason === "refusal") {
    throw new Error("the model declined to process this note");
  }
  if (!text.trim()) throw new Error("Anthropic returned no content");

  const extraction = normalizeExtraction(parseJsonLoose(text));

  // Turn short open-trade handles ("T2") back into real trade ids immediately,
  // so nothing downstream — review card, confirm, stored draft — sees a handle.
  return {
    ...extraction,
    entries: extraction.entries.map((entry) =>
      entry.kind === "TRADE_EXIT"
        ? { ...entry, linkTradeId: resolveTradeHandle(entry.linkTradeId, context.openTrades) }
        : entry,
    ),
  };
}

// Offline fallback. It deliberately does NOT attempt segmentation or
// classification: pretending to classify produced confident-looking nonsense
// that was worse than an honest "here is your text, sort it out". One FREE_NOTE,
// LOW confidence, nothing lost — plus the reason it happened, so a broken key or
// a wrong model name never again looks the same as "AI is off".
function mockExtraction(rawText: string, reason: string): SegmentedExtraction {
  const text = rawText.trim();
  if (!text) return { entries: [], missingInfo: [], overallConfidence: "LOW" };
  return {
    entries: [{ kind: "FREE_NOTE", confidence: "LOW", text }],
    missingInfo: [reason],
    overallConfidence: "LOW",
  };
}
