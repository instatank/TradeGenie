/**
 * Offline contract check for the capture pipeline. No network, no API key.
 *
 * Generation is no longer constrained by a JSON schema — the compiled grammar
 * exceeded Anthropic's size limit, so the shape is now taught by the prompt and
 * enforced on our side by parseJsonLoose() + normalizeExtraction(). That moves
 * the risk from "the API rejects the schema" to "the prompt and the normalizer
 * quietly drift apart", which nothing would otherwise catch until a real note
 * came back wrong.
 *
 * So: take the worked examples out of the prompt the model actually receives,
 * push them through the real parse + normalize path, and assert they survive.
 * If someone edits an example, renames a field, or adds an entry kind to one
 * side only, this fails here instead of in production.
 *
 *   npm run check:capture     (also runs as the eval's pre-flight)
 */

import { defaultPromptTemplates } from "../lib/prompts";
import { normalizeExtraction } from "../lib/extraction";
import { parseJsonLoose } from "../lib/transcript-processor";

type Problem = string;
const problems: Problem[] = [];

// The examples are the JSON objects embedded in the template, each starting at a
// line that opens with {"entries":.
const template = defaultPromptTemplates.capture;
const examples: string[] = [];
for (let i = template.indexOf('{"entries":'); i !== -1; i = template.indexOf('{"entries":', i + 1)) {
  // Walk braces so a nested object can't end the example early.
  let depth = 0;
  let end = i;
  for (let j = i; j < template.length; j += 1) {
    if (template[j] === "{") depth += 1;
    else if (template[j] === "}") {
      depth -= 1;
      if (depth === 0) { end = j; break; }
    }
  }
  examples.push(template.slice(i, end + 1));
}

console.log("Capture contract check");
console.log("=".repeat(60));

if (examples.length < 2) {
  problems.push(`found ${examples.length} worked example(s) in the prompt — expected at least 2`);
}

examples.forEach((example, index) => {
  const label = `example ${index + 1}`;
  let parsed: unknown;
  try {
    parsed = parseJsonLoose(example);
  } catch (error) {
    problems.push(`${label}: the prompt's own example is not parseable — ${(error as Error).message}`);
    return;
  }

  const raw = (parsed as { entries?: unknown[] }).entries ?? [];
  const normalized = normalizeExtraction(parsed);

  if (normalized.entries.length !== raw.length) {
    problems.push(
      `${label}: ${raw.length} entries in, ${normalized.entries.length} out — normalizeEntry dropped one. ` +
        `Usually a "kind" the normalizer doesn't know, or a required text field left empty.`,
    );
  }

  normalized.entries.forEach((entry, entryIndex) => {
    const source = raw[entryIndex] as Record<string, unknown> | undefined;
    if (!source) return;
    if (source.kind !== entry.kind) {
      problems.push(`${label} entry ${entryIndex + 1}: kind "${String(source.kind)}" became "${entry.kind}"`);
    }
    // Every key the prompt promises must be one the normalizer actually reads;
    // a typo on either side silently discards the trader's words.
    for (const key of Object.keys(source)) {
      if (!(key in entry)) {
        problems.push(
          `${label} entry ${entryIndex + 1} (${entry.kind}): the prompt emits "${key}" but normalizeEntry drops it — ` +
            `add it to the entry type + normalizer, or remove it from the prompt.`,
        );
      }
    }
  });

  console.log(`  ${label}: ${normalized.entries.length} entries — ${normalized.entries.map((e) => e.kind).join(", ")}`);
});

// The parser has to cope with what a model actually emits when nothing constrains it.
const wrapped = '```json\n{"entries":[{"kind":"FREE_NOTE","confidence":"LOW","text":"hi"}],"missingInfo":[],"overallConfidence":"LOW"}\n```';
const chatty = 'Here you go:\n{"entries":[{"kind":"FREE_NOTE","confidence":"LOW","text":"hi"}],"missingInfo":[],"overallConfidence":"LOW"}\nHope that helps!';
for (const [name, payload] of [["fenced", wrapped], ["prose-wrapped", chatty]] as const) {
  try {
    if (normalizeExtraction(parseJsonLoose(payload)).entries.length !== 1) {
      problems.push(`parseJsonLoose did not recover the entry from ${name} output`);
    } else {
      console.log(`  recovers ${name} output: yes`);
    }
  } catch (error) {
    problems.push(`parseJsonLoose threw on ${name} output — ${(error as Error).message}`);
  }
}

if (problems.length) {
  console.log("");
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log(`\nFAILED — ${problems.length} problem(s).`);
  process.exit(1);
}
console.log("\nOK — the prompt's examples round-trip through the real parse + normalize path.");
