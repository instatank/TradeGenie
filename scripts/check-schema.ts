/**
 * Offline guard for the structured-output schema.
 *
 * The capture pipeline silently degraded to plain-text notes for a long time
 * because the schema had 29 union-typed parameters against Anthropic's limit of
 * 16. Nothing caught it locally: it typechecks, it lints, it builds, and the
 * request only fails at the API. Every note fell back and the error was
 * swallowed, so the app looked like it was "just not doing AI".
 *
 * This asserts the constraints the API enforces, with no network and no key, so
 * that class of bug fails here instead of in production.
 *
 *   npm run check:schema
 *
 * Also runs automatically at the start of `npm run eval:capture`.
 */

import { segmentedJsonSchema } from "../lib/extraction";

// Anthropic rejects a schema with more than this many parameters carrying a
// union (`type: [...]` or `anyOf`) — compilation cost is exponential.
const MAX_UNION_PARAMS = 16;

// Structured outputs ignore/reject these; silently dropping them means the
// constraint you thought you wrote isn't being enforced.
const UNSUPPORTED_KEYWORDS = [
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
  "minLength", "maxLength", "pattern",
  "minItems", "maxItems", "uniqueItems",
  "minProperties", "maxProperties", "patternProperties", "dependentSchemas",
];

type Problem = { path: string; message: string };

const problems: Problem[] = [];
let unionParams = 0;
let objects = 0;

function walk(node: unknown, path: string, seen: Set<unknown>): void {
  if (!node || typeof node !== "object") return;
  if (seen.has(node)) {
    problems.push({ path, message: "recursive schema — not supported by structured outputs" });
    return;
  }
  const here = new Set(seen).add(node);
  const schema = node as Record<string, unknown>;

  if (Array.isArray(schema.type) || schema.anyOf) unionParams += 1;

  for (const keyword of UNSUPPORTED_KEYWORDS) {
    if (keyword in schema) {
      problems.push({ path, message: `unsupported keyword "${keyword}" — validate in normalizeEntry instead` });
    }
  }

  if (schema.type === "object") {
    objects += 1;
    if (schema.additionalProperties !== false) {
      problems.push({ path, message: 'every object needs `additionalProperties: false`' });
    }
    const properties = (schema.properties ?? {}) as Record<string, unknown>;
    const required = new Set((Array.isArray(schema.required) ? schema.required : []) as string[]);
    for (const key of Object.keys(properties)) {
      if (!required.has(key)) {
        problems.push({ path, message: `property "${key}" is missing from \`required\` — every property must be listed` });
      }
      walk(properties[key], `${path}.${key}`, here);
    }
  }

  for (const key of ["anyOf", "allOf", "oneOf"] as const) {
    const branches = schema[key];
    if (Array.isArray(branches)) branches.forEach((branch, i) => walk(branch, `${path}.${key}[${i}]`, here));
  }
  if (schema.items) walk(schema.items, `${path}.items`, here);
}

walk(segmentedJsonSchema, "root", new Set());

if (unionParams > MAX_UNION_PARAMS) {
  problems.push({
    path: "root",
    message:
      `${unionParams} union-typed parameters, limit is ${MAX_UNION_PARAMS}. ` +
      `Every capture will 400 and fall back to a plain note. Use a plain string with "" ` +
      `for optional text (normalizeEntry turns "" into null); keep null only for numbers ` +
      `and booleans, where there is no honest empty value.`,
  });
}

const headroom = MAX_UNION_PARAMS - unionParams;
console.log("Capture schema check");
console.log("=".repeat(60));
console.log(`objects           : ${objects}`);
console.log(`union parameters  : ${unionParams} / ${MAX_UNION_PARAMS}  (${headroom} spare)`);

if (problems.length) {
  console.log("");
  for (const problem of problems) console.log(`  ✗ ${problem.path}: ${problem.message}`);
  console.log("");
  console.log(`FAILED — ${problems.length} problem(s). The API would reject this schema.`);
  process.exit(1);
}

if (headroom <= 2) {
  console.log(`\nNote: only ${headroom} union slot(s) left. Prefer text fields — they cost nothing.`);
}
console.log("\nOK — the schema satisfies Anthropic's structured-output constraints.");
