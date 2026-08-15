// Why the AI did or didn't run — in plain English.
//
// The capture pipeline used to swallow every Anthropic failure with a bare
// `catch {}` and fall back to the offline single-FREE_NOTE path. A rejected API
// key, a wrong ANTHROPIC_MODEL, a 400 on the schema and "no key configured" all
// looked identical from the outside: your note came back as plain text with no
// explanation. This module is the one place that turns a thrown error into
// something a human can act on, so every caller reports the same way.

import Anthropic from "@anthropic-ai/sdk";

// Both AI paths (capture extraction + asset-note tidy) read the same override,
// so they can never drift onto different models again.
export const DEFAULT_MODEL = "claude-sonnet-5";

export function activeModel(): string {
  return process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
}

/** Turn a thrown Anthropic error into a short, actionable sentence. */
export function describeAiError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) {
    return "the API key was rejected (401) — check ANTHROPIC_API_KEY";
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return "the API key doesn't have access (403) — check the key's workspace and billing";
  }
  if (error instanceof Anthropic.NotFoundError) {
    return `model "${activeModel()}" was not found (404) — check ANTHROPIC_MODEL`;
  }
  if (error instanceof Anthropic.RateLimitError) {
    return "rate limited (429) — wait a moment and re-structure the note";
  }
  if (error instanceof Anthropic.BadRequestError) {
    return `the request was rejected (400): ${error.message}`;
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return "couldn't reach the Anthropic API — network or outage";
  }
  if (error instanceof Anthropic.APIError) {
    return `Anthropic API error ${error.status}: ${error.message}`;
  }
  if (error instanceof SyntaxError) {
    return "the model returned malformed JSON";
  }
  return error instanceof Error ? error.message : String(error);
}

export type AiCheck =
  | { ok: true; model: string; detail: string }
  | { ok: false; model: string; detail: string };

/**
 * Make the smallest possible real call to Anthropic and report what happened.
 * This is what /settings runs so a failure is diagnosable in one click instead
 * of by reading Vercel logs.
 */
export async function checkAiConnection(): Promise<AiCheck> {
  const model = activeModel();
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, model, detail: "No ANTHROPIC_API_KEY is set on the server." };
  }
  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model,
      max_tokens: 16,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    });
    const text = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("")
      .trim();
    if (!text) {
      return { ok: false, model, detail: "The API answered but returned no text." };
    }
    return { ok: true, model, detail: `Reached the API and it replied "${text}".` };
  } catch (error) {
    console.error("[ai-status] connection check failed:", error);
    return { ok: false, model, detail: capitalise(describeAiError(error)) };
  }
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
