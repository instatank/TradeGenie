import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/data";
import { buildExtractionContext, resolveTradeHandle } from "@/lib/extraction-context";
import { normalizeExtraction, segmentedJsonSchema, type SegmentedExtraction } from "@/lib/extraction";
import { extractionSystemPrompt } from "@/lib/prompts";
import { getSettings } from "@/lib/settings-store";

// Claude Sonnet 5. Adaptive thinking is the on-mode on this model (budget_tokens
// is removed and returns a 400); effort stays LOW because extraction is a short,
// scoped, latency-sensitive task sitting inside the <20s paste/save budget.
// Adaptive still lets the model think when a note genuinely needs untangling.
// Bump ANTHROPIC_MODEL or EXTRACTION_EFFORT below if accuracy needs more room.
const DEFAULT_MODEL = "claude-sonnet-5";
const EXTRACTION_EFFORT = "low";

// No prompt caching on purpose: the prompt is ~1.2k tokens, barely over the
// cacheable minimum, so the write premium would cost more than it saves.

export type { SegmentedExtraction };

export async function structureTranscript(rawText: string): Promise<SegmentedExtraction> {
  const settings = await getSettings();
  if (settings.aiEnabled && process.env.ANTHROPIC_API_KEY) {
    try {
      return await anthropicExtraction(rawText, settings.promptTemplates.capture);
    } catch {
      return mockExtraction(rawText);
    }
  }
  return mockExtraction(rawText);
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
    model: process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL,
    max_tokens: 4096,
    thinking: { type: "adaptive" },
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    output_config: {
      effort: EXTRACTION_EFFORT,
      format: { type: "json_schema", schema: segmentedJsonSchema },
    },
  });

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");
  if (!text.trim()) throw new Error("Anthropic returned no content");

  const extraction = normalizeExtraction(JSON.parse(text));

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

// No-API-key dev fallback. It deliberately does NOT attempt segmentation or
// classification: pretending to classify produced confident-looking nonsense
// that was worse than an honest "here is your text, sort it out". One FREE_NOTE,
// LOW confidence, nothing lost.
function mockExtraction(rawText: string): SegmentedExtraction {
  const text = rawText.trim();
  if (!text) return { entries: [], missingInfo: [], overallConfidence: "LOW" };
  return {
    entries: [{ kind: "FREE_NOTE", confidence: "LOW", text }],
    missingInfo: ["AI extraction is off or unavailable — this note was saved as a plain thought."],
    overallConfidence: "LOW",
  };
}
