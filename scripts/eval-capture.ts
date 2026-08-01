/**
 * Capture eval harness — `npm run eval:capture`
 *
 * Runs every fixture in tests/fixtures/capture through the REAL extraction
 * pipeline (lib/transcript-processor.ts) against a deterministic fixture world,
 * and prints a per-fixture pass/fail diff: which entry kinds came back, which
 * fields survived, whether links resolved.
 *
 * The fixture world (open trades, tracked assets, setups, mistake tags) is
 * written to a throwaway store via TRADEGENIE_LOCAL_STORE so a run can never
 * touch real data. Extraction reads that world to build its context block, so
 * the link-resolution checks below exercise the real thing.
 *
 * Without ANTHROPIC_API_KEY the pipeline falls back to the offline single
 * FREE_NOTE stub — the harness says so loudly, because a green run in that mode
 * means nothing about extraction quality.
 */
import { mkdtempSync, readFileSync, readdirSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { subDays } from "date-fns";

const fixtureDir = path.join(process.cwd(), "tests", "fixtures", "capture");

// Point the store at a throwaway file BEFORE anything imports lib/store.
process.env.TRADEGENIE_LOCAL_STORE = path.join(mkdtempSync(path.join(tmpdir(), "tradegenie-eval-")), "store.json");
delete process.env.FIREBASE_PROJECT_ID;
delete process.env.FIREBASE_CLIENT_EMAIL;
delete process.env.FIREBASE_PRIVATE_KEY;

type FieldCheck = {
  kind: string;
  field: string;
  equals?: unknown;
  present?: boolean;
  in?: string[];
  match?: "any" | "all";
};

type LinkCheck = { kind: string; linkedTrade: string | null };

type Expectation = {
  name: string;
  why?: string;
  minEntries?: number;
  kinds?: string[];
  forbidKinds?: string[];
  fields?: FieldCheck[];
  links?: LinkCheck[];
  anyMistakeTagIn?: string[];
  tags?: string[];
};

async function main() {
  const { db } = await import("../lib/data");
  const { defaultMistakeTags } = await import("../lib/constants");
  const { structureTranscript } = await import("../lib/transcript-processor");
  const { extractTags } = await import("../lib/tags");
  const { EntryKind } = await import("../lib/extraction");

  const tradeIdByLabel = await seedFixtureWorld(db, defaultMistakeTags);
  const usingRealModel = Boolean(process.env.ANTHROPIC_API_KEY);

  console.log("");
  console.log("Capture extraction eval");
  console.log("=".repeat(72));
  console.log(`Backend : ${usingRealModel ? `Anthropic (${process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5"})` : "OFFLINE FALLBACK — no ANTHROPIC_API_KEY"}`);
  if (!usingRealModel) {
    console.log("          The offline fallback returns one FREE_NOTE per note by design.");
    console.log("          These results say nothing about extraction quality — set");
    console.log("          ANTHROPIC_API_KEY to measure the real pipeline.");
  }
  console.log(`Fixtures: ${fixtureDir}`);
  console.log("=".repeat(72));

  const fixtures = readdirSync(fixtureDir).filter((file) => file.endsWith(".txt")).sort();
  let passed = 0;

  for (const file of fixtures) {
    const name = file.replace(/\.txt$/, "");
    const rawText = readFileSync(path.join(fixtureDir, file), "utf8").trim();
    const expected = JSON.parse(readFileSync(path.join(fixtureDir, `${name}.expected.json`), "utf8")) as Expectation;

    let entries: Array<Record<string, unknown>> = [];
    const failures: string[] = [];
    try {
      const extraction = await structureTranscript(rawText);
      entries = extraction.entries as unknown as Array<Record<string, unknown>>;
    } catch (error) {
      failures.push(`pipeline threw: ${(error as Error).message}`);
    }

    const kinds = entries.map((entry) => String(entry.kind));

    if (expected.minEntries != null && entries.length < expected.minEntries) {
      failures.push(`expected at least ${expected.minEntries} entries, got ${entries.length}`);
    }
    for (const kind of countMissing(expected.kinds ?? [], kinds)) {
      failures.push(`missing entry kind ${kind}`);
    }
    for (const kind of expected.forbidKinds ?? []) {
      if (kinds.includes(kind)) failures.push(`produced ${kind}, which this note must never produce`);
    }
    for (const check of expected.fields ?? []) {
      const candidates = entries.filter((entry) => entry.kind === check.kind);
      if (!candidates.length) continue; // already reported as a missing kind
      const ok = candidates.some((entry) => fieldMatches(entry[check.field], check));
      if (!ok) {
        const seen = candidates.map((entry) => JSON.stringify(entry[check.field])).join(" | ");
        failures.push(`${check.kind}.${check.field}: expected ${describeCheck(check)}, got ${seen || "nothing"}`);
      }
    }
    for (const check of expected.links ?? []) {
      const candidates = entries.filter((entry) => entry.kind === check.kind);
      if (!candidates.length) continue;
      const resolved = candidates.map((entry) => labelForTradeId(entry.linkTradeId, tradeIdByLabel));
      if (!resolved.includes(check.linkedTrade)) {
        failures.push(`${check.kind}.linkTradeId: expected ${check.linkedTrade ?? "null (ambiguous)"}, got ${resolved.map((value) => value ?? "null").join(" | ")}`);
      }
    }
    if (expected.anyMistakeTagIn) {
      const suggested = entries.flatMap((entry) => (Array.isArray(entry.suggestedMistakeTags) ? entry.suggestedMistakeTags.map(String) : []));
      if (!suggested.some((tag) => expected.anyMistakeTagIn!.includes(tag))) {
        failures.push(`suggestedMistakeTags: expected one of ${expected.anyMistakeTagIn.join(", ")}, got ${suggested.join(", ") || "none"}`);
      }
    }
    if (expected.tags) {
      // Tags are derived at save time from the note text, so check the tokenizer
      // sees them — a note's #hashtags must survive into every record it writes.
      const derived = extractTags(rawText);
      for (const tag of expected.tags) {
        if (!derived.includes(tag)) failures.push(`tag #${tag} was not derived from the note text`);
      }
    }

    const ok = failures.length === 0;
    if (ok) passed += 1;
    console.log("");
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
    console.log(`      ${expected.name}`);
    console.log(`      kinds: ${kinds.length ? kinds.join(", ") : "(none)"}`);
    for (const failure of failures) console.log(`      ✗ ${failure}`);
  }

  console.log("");
  console.log("=".repeat(72));
  console.log(`${passed}/${fixtures.length} fixtures passed${usingRealModel ? "" : "  (offline fallback — not a real measurement)"}`);
  console.log("=".repeat(72));
  console.log("");
  // Kinds are referenced so a rename of the vocabulary breaks this file loudly.
  void EntryKind;
  process.exitCode = passed === fixtures.length ? 0 : 1;
}

function countMissing(expected: string[], actual: string[]) {
  const remaining = [...actual];
  const missing: string[] = [];
  for (const kind of expected) {
    const index = remaining.indexOf(kind);
    if (index === -1) missing.push(kind);
    else remaining.splice(index, 1);
  }
  return missing;
}

function fieldMatches(value: unknown, check: FieldCheck) {
  if (check.present) return value !== null && value !== undefined && String(value).trim() !== "";
  if (check.in) return typeof value === "string" && check.in.includes(value);
  if ("equals" in check) {
    if (check.equals === null) return value === null || value === undefined;
    if (typeof check.equals === "number") return typeof value === "number" && Math.abs(value - check.equals) < 1e-6;
    return String(value ?? "").toUpperCase() === String(check.equals).toUpperCase();
  }
  return true;
}

function describeCheck(check: FieldCheck) {
  if (check.present) return "any value";
  if (check.in) return `one of ${check.in.join("/")}`;
  return JSON.stringify(check.equals);
}

function labelForTradeId(value: unknown, tradeIdByLabel: Map<string, string>) {
  if (typeof value !== "string" || !value) return null;
  for (const [label, id] of tradeIdByLabel) {
    if (id === value) return label;
  }
  return `unknown-id(${value})`;
}

// A small, fixed world so link resolution and symbol matching are testable.
// Two open longs exist on purpose, so "closed one of the longs" is genuinely
// ambiguous and the model has to return null rather than guess.
async function seedFixtureWorld(
  db: typeof import("../lib/data").db,
  defaultMistakeTags: typeof import("../lib/constants").defaultMistakeTags,
) {
  const now = new Date();
  for (const [name, label, description] of defaultMistakeTags) {
    await db.create("mistakeTags", { name, label, description });
  }
  for (const [name, bias] of [["Range reclaim", "LONG"], ["Failed breakout", "SHORT"], ["Momentum pullback", "BOTH"]] as const) {
    await db.create("setups", {
      createdAt: now,
      updatedAt: now,
      name,
      directionBias: bias,
      rules: null,
      checklist: null,
      idealRiskReward: null,
      notes: null,
      isActive: true,
    });
  }
  for (const symbol of ["BTC", "SOL", "ZEC"]) {
    await db.create("assets", {
      createdAt: now,
      updatedAt: now,
      symbol,
      marketType: "CRYPTO_PERP",
      htfBias: null,
      ltfBias: null,
      levels: null,
      gamePlan: null,
      isArchived: false,
    });
  }

  const openTrades = [
    { instrument: "BTC", direction: "SHORT", entryPrice: 64200, daysAgo: 2 },
    { instrument: "SOL", direction: "LONG", entryPrice: 142.5, daysAgo: 1 },
    { instrument: "HYPE", direction: "LONG", entryPrice: 28.4, daysAgo: 3 },
  ] as const;

  const tradeIdByLabel = new Map<string, string>();
  for (const seed of openTrades) {
    const trade = await db.create("trades", {
      createdAt: now,
      updatedAt: now,
      tradeDateTime: subDays(now, seed.daysAgo),
      marketType: "CRYPTO_PERP",
      instrument: seed.instrument,
      direction: seed.direction,
      status: "OPEN",
      setupName: null,
      entryThesis: null,
      invalidation: null,
      concern: null,
      emotionalState: null,
      riskPosture: null,
      confidenceScore: null,
      entryGrade: "NA",
      exitReason: null,
      followedPlan: null,
      lesson: null,
      notes: null,
      entryPrice: seed.entryPrice,
      stopPrice: null,
      targetPrice: null,
      exitPrice: null,
      quantity: null,
      leverage: null,
      realizedPnl: null,
      fees: null,
      funding: null,
      netPnl: null,
      rMultiple: null,
    });
    tradeIdByLabel.set(`${seed.instrument} ${seed.direction}`, trade.id);
  }
  return tradeIdByLabel;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
