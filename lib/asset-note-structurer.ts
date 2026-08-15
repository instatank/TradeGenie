import Anthropic from "@anthropic-ai/sdk";
import { activeModel, describeAiError } from "@/lib/ai-status";
import { getSettings } from "@/lib/settings-store";

export type StructuredNote = {
  text: string;
  source: "ai" | "basic";
};

// Tidy a raw thought-dump about an asset into a clean, skimmable note.
// Deliberately simple for v1: no field extraction, no schema — just take the
// trader's stream-of-consciousness and return organised text. The caller always
// shows the result for review before anything is saved.
export async function structureAssetNote(rawText: string): Promise<StructuredNote> {
  const trimmed = rawText.trim();
  if (!trimmed) return { text: "", source: "basic" };

  const settings = await getSettings();
  if (settings.aiEnabled && process.env.ANTHROPIC_API_KEY) {
    try {
      const text = await anthropicStructure(trimmed);
      if (text) return { text, source: "ai" };
    } catch (error) {
      // Fall through to the local tidy, but leave a trail — this used to fail
      // completely silently and look identical to "no key configured".
      console.error("[asset-note] Anthropic tidy failed:", describeAiError(error), error);
    }
  }
  return { text: basicStructure(trimmed), source: "basic" };
}

const SYSTEM_PROMPT = [
  "You tidy a discretionary crypto trader's raw, stream-of-consciousness notes about a single asset.",
  "Turn the note into a clean, skimmable version the trader can re-read quickly tomorrow.",
  "",
  "Rules:",
  "- Preserve ALL substantive content and the trader's original meaning. Do not add ideas, opinions, or analysis of your own.",
  "- Keep every price, level, number, ticker and timeframe EXACTLY as written. Never invent or round them.",
  "- Organise into short bullet points. Group related thoughts (e.g. bias, levels, plan, risks) together.",
  "- Fix obvious grammar, spelling and filler; make it concise. Keep the trader's voice.",
  "- If the note already states a clear thesis/plan, keep it as a short line.",
  "- Do NOT give trading advice, recommendations, or predictions.",
  "- Return ONLY the tidied note text. No preamble, no headings like 'Here is', no markdown fences.",
].join("\n");

async function anthropicStructure(rawText: string): Promise<string> {
  const client = new Anthropic();
  const message = await client.messages.create({
    model: activeModel(),
    max_tokens: 1024,
    thinking: { type: "disabled" },
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `Tidy this note:\n\n${rawText}` }],
  });
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

// No-API-key fallback: a light, deterministic tidy. Splits the dump into lines /
// sentences, trims noise, and turns them into bullets. Never changes wording.
function basicStructure(rawText: string): string {
  const fragments = rawText
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  if (!fragments.length) return rawText.trim();
  return fragments
    .map((fragment) => {
      const cleaned = fragment.replace(/^[-*•]\s*/, "");
      const capped = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      return `- ${capped}`;
    })
    .join("\n");
}
