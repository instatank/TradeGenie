// Opt-in extraction eval runner. Usage: `npm run eval:extraction`.
//
// Scores lib/transcript-processor's structureTranscript() against the golden set
// in tests/eval/transcripts.ts. With ANTHROPIC_API_KEY set it hits the real model
// (costs tokens); without a key it scores the offline regex mock. Run it before
// shipping a prompt or model change so extraction quality can't silently regress.
//
// Exits non-zero if the aggregate score falls below THRESHOLD, so it can also gate
// a prompt change in a pre-push hook if you ever want that.

import { structureTranscript } from "@/lib/transcript-processor";
import { evalCases, type EvalCase, type FieldCheck } from "@/tests/eval/transcripts";

const THRESHOLD = process.env.ANTHROPIC_API_KEY ? 0.85 : 0.45; // mock is expected to score lower

function get(obj: Record<string, unknown>, field: string) {
  return obj[field];
}

function runCheck(check: FieldCheck, result: Record<string, unknown>): { ok: boolean; detail: string } {
  switch (check.kind) {
    case "equals": {
      const v = String(get(result, check.field) ?? "");
      return { ok: v === check.value, detail: `${check.field}=${v} (want ${check.value})` };
    }
    case "instrument": {
      const v = String(get(result, "instrument") ?? "").toUpperCase();
      return { ok: v === check.value, detail: `instrument=${v} (want ${check.value})` };
    }
    case "number": {
      const v = get(result, check.field);
      const isNum = typeof v === "number" && Number.isFinite(v);
      return { ok: isNum === check.present, detail: `${check.field}=${String(v)} (want ${check.present ? "a number" : "null"})` };
    }
    case "numberEquals": {
      const v = get(result, check.field);
      return { ok: v === check.value, detail: `${check.field}=${String(v)} (want ${check.value})` };
    }
    case "bool": {
      const v = get(result, check.field);
      return { ok: v === check.value, detail: `${check.field}=${String(v)} (want ${check.value})` };
    }
    case "emotionIn": {
      const v = String(get(result, check.field) ?? "");
      return { ok: check.values.includes(v), detail: `${check.field}=${v} (want one of ${check.values.join("/")})` };
    }
    case "minArray": {
      const v = get(result, check.field);
      const len = Array.isArray(v) ? v.length : 0;
      return { ok: len >= check.min, detail: `${check.field}.length=${len} (want >= ${check.min})` };
    }
    case "arrayIncludes": {
      const v = get(result, check.field);
      const arr = Array.isArray(v) ? v.map(String) : [];
      return { ok: arr.includes(check.value), detail: `${check.field}=[${arr.join(",")}] (want includes ${check.value})` };
    }
  }
}

async function scoreCase(testCase: EvalCase) {
  const result = (await structureTranscript(testCase.rawText, testCase.declaredType)) as unknown as Record<string, unknown>;
  const checks = testCase.checks.map((check) => runCheck(check, result));
  const passed = checks.filter((c) => c.ok).length;
  return { passed, total: checks.length, checks };
}

async function main() {
  const mode = process.env.ANTHROPIC_API_KEY ? "AI (Claude)" : "BASIC (regex mock — no ANTHROPIC_API_KEY)";
  console.log(`\nExtraction eval — backend: ${mode}\n${"=".repeat(60)}`);

  let totalPassed = 0;
  let totalChecks = 0;
  for (const testCase of evalCases) {
    const { passed, total, checks } = await scoreCase(testCase);
    totalPassed += passed;
    totalChecks += total;
    const mark = passed === total ? "✓" : "✗";
    console.log(`${mark} ${testCase.name}  (${passed}/${total})`);
    for (const c of checks) if (!c.ok) console.log(`    ✗ ${c.detail}`);
  }

  const score = totalChecks ? totalPassed / totalChecks : 0;
  console.log("=".repeat(60));
  console.log(`Aggregate: ${totalPassed}/${totalChecks} = ${(score * 100).toFixed(1)}%  (threshold ${(THRESHOLD * 100).toFixed(0)}%)\n`);

  if (score < THRESHOLD) {
    console.error(`FAIL: extraction quality below threshold.`);
    process.exit(1);
  }
  console.log("PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
