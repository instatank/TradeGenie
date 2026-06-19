import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMistakeTags } from "@/lib/constants";
import type { StoreShape } from "@/lib/store";

// --- In-memory store boundary -------------------------------------------------
// Phase 2 exercises the real conversion pipeline (server actions + lib/data +
// lib/metrics + the regex extraction fallback) against an in-memory store, so we
// test the actual "voice note becomes a trade record" logic without a filesystem
// or Firebase. The store's own JSON/durability layer is covered in store.test.ts.
const { store } = vi.hoisted(() => {
  const empty = (): StoreShape => ({
    transcripts: [], dailyJournals: [], trades: [], setups: [], mistakeTags: [],
    tradeMistakes: [], lessons: [], rawExecutions: [], importBatches: [],
    screenshots: [], weeklyReviews: [], assets: [], assetNotes: [],
  });
  return { store: { data: empty(), reset() { this.data = empty(); } } };
});

let idCounter = 0;

vi.mock("@/lib/store", () => {
  const newId = () => `id-${++idCounter}`;
  type Coll = keyof StoreShape;
  const list = <K extends Coll>(c: K) => store.data[c] as StoreShape[K][number][];
  return {
    newId,
    usesFirebase: () => false,
    storageStatus: () => ({ mode: "local", durable: false }),
    getFirestoreDb: () => { throw new Error("no firestore in tests"); },
    firebaseStorageBucket: () => { throw new Error("no storage in tests"); },
    async listRecords(c: Coll) { return list(c); },
    async getRecord(c: Coll, id: string) { return list(c).find((r) => r.id === id) ?? null; },
    async createRecord(c: Coll, input: { id?: string }) {
      const rec = { ...input, id: input.id ?? newId() };
      list(c).push(rec as never);
      return rec;
    },
    async updateRecord(c: Coll, id: string, patch: object) {
      const arr = list(c);
      const i = arr.findIndex((r) => r.id === id);
      if (i < 0) throw new Error(`Missing ${c} ${id}`);
      arr[i] = { ...arr[i], ...patch };
      return arr[i];
    },
    async deleteWhere(c: Coll, pred: (r: { id: string }) => boolean) {
      store.data[c] = list(c).filter((r) => !pred(r as { id: string })) as never;
    },
    async upsertBy(c: Coll, pred: (r: unknown) => boolean, createInput: object, updateInput: object) {
      const arr = list(c);
      const ex = arr.find((r) => pred(r));
      if (ex) { Object.assign(ex, updateInput); return ex; }
      const rec = { ...createInput, id: newId() };
      arr.push(rec as never);
      return rec;
    },
  };
});

// Next.js server-action plumbing — no-op cache, fake headers, and a redirect that
// throws a catchable sentinel so a test can assert the post-confirm destination.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Map<string, string>() }));
class RedirectError extends Error {
  constructor(public url: string) { super("REDIRECT"); }
}
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new RedirectError(url); },
}));

// Import AFTER the mocks are registered so the actions bind to the in-memory store.
const actions = await import("@/app/actions");
const { structureTranscript, structureTranscriptWithMode } = await import("@/lib/transcript-processor");

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// Run an action that ends in redirect(); swallow the sentinel and return the URL.
async function runRedirecting(fn: () => Promise<void>): Promise<string | null> {
  try { await fn(); return null; }
  catch (e) { if (e instanceof RedirectError) return e.url; throw e; }
}

function seedTranscript(overrides: Partial<StoreShape["transcripts"][number]>) {
  const now = new Date("2026-06-15T12:00:00Z");
  const base = {
    id: `t-${++idCounter}`, createdAt: now, updatedAt: now, transcriptDateTime: now,
    sourceTool: null, rawText: "", cleanedSummary: null, transcriptType: "UNKNOWN",
    processingStatus: "STRUCTURED", linkedTradeId: null, linkedDailyJournalId: null,
    structuredJson: null, aiConfidence: null,
  };
  const rec = { ...base, ...overrides } as StoreShape["transcripts"][number];
  store.data.transcripts.push(rec);
  return rec;
}

beforeEach(() => {
  store.reset();
  // Seed the mistake-tag vocabulary so linkSuggestedMistakes can resolve names.
  store.data.mistakeTags = defaultMistakeTags.map(([name, label, description]) => ({
    id: `tag-${name}`, name, label, description,
  }));
});

describe("save → confirm: a spoken entry note becomes a trade", () => {
  it("carries instrument, direction and spoken prices through to the trade", async () => {
    delete process.env.ANTHROPIC_API_KEY; // force the deterministic regex extraction

    await runRedirecting(() => actions.saveTranscriptAction(form({
      transcriptType: "TRADE_ENTRY_NOTE",
      rawText: "I'm entering BTC long at 50000, stop 48000, target 55000 because macro is risk-on.",
    })));

    const transcript = store.data.transcripts.at(-1)!;
    expect(transcript.processingStatus).toBe("STRUCTURED");
    expect(transcript.structuredJson).toBeTruthy();

    await runRedirecting(() => actions.confirmTranscriptAction(form({ id: transcript.id })));

    expect(store.data.trades).toHaveLength(1);
    const trade = store.data.trades[0];
    expect(trade.instrument).toBe("BTC");
    expect(trade.direction).toBe("LONG");
    expect(trade.entryPrice).toBe(50000);
    expect(trade.stopPrice).toBe(48000);
    expect(trade.targetPrice).toBe(55000);
    expect(trade.status).toBe("IDEA"); // no exit yet
    expect(trade.rMultiple).toBeNull(); // no exit price
  });
});

describe("confirm: exit review on a linked trade closes it and recomputes R/PnL", () => {
  it("writes exit data and derives netPnl + rMultiple from the existing entry/stop", async () => {
    store.data.trades.push({
      id: "trade-1", instrument: "BTC", direction: "LONG", status: "OPEN",
      entryPrice: 50000, stopPrice: 48000, exitPrice: null, fees: null, funding: null,
      realizedPnl: null, netPnl: null, rMultiple: null,
    } as never);

    const transcript = seedTranscript({
      transcriptType: "TRADE_EXIT_REVIEW",
      linkedTradeId: "trade-1",
      structuredJson: JSON.stringify({
        transcriptType: "TRADE_EXIT_REVIEW", exitPrice: 55000, realizedPnl: 500,
        followedPlan: "YES", exitReason: "target hit",
      }),
    });

    await runRedirecting(() => actions.confirmTranscriptAction(form({ id: transcript.id })));

    const trade = store.data.trades[0];
    expect(store.data.trades).toHaveLength(1); // updated, not duplicated
    expect(trade.status).toBe("CLOSED");
    expect(trade.exitPrice).toBe(55000);
    expect(trade.netPnl).toBe(500); // realized 500, no fees/funding
    expect(trade.rMultiple).toBe(2.5); // (55000-50000)/(50000-48000)
  });
});

describe("confirm: exit review with NO linked trade does not spawn a phantom trade", () => {
  it("captures lessons but creates no duplicate/phantom trade (regression for A3#2)", async () => {
    const transcript = seedTranscript({
      transcriptType: "TRADE_EXIT_REVIEW",
      linkedTradeId: null,
      structuredJson: JSON.stringify({
        transcriptType: "TRADE_EXIT_REVIEW", instrument: "BTC", exitPrice: 55000,
        realizedPnl: 500, lesson: "Wait for the planned exit zone.",
      }),
    });

    await runRedirecting(() => actions.confirmTranscriptAction(form({ id: transcript.id })));

    expect(store.data.trades).toHaveLength(0); // <-- the fix: no phantom trade
    expect(store.data.lessons).toHaveLength(1); // the lesson is still captured
  });
});

describe("confirm: EOD review upserts a single daily journal", () => {
  it("does not create a duplicate journal for the same day", async () => {
    const structuredJson = JSON.stringify({
      transcriptType: "EOD_REVIEW", tradedToday: true, disciplineScore: 7,
      oneThingToAvoidTomorrow: "Stop revenge trading.",
    });
    const a = seedTranscript({ transcriptType: "EOD_REVIEW", structuredJson });
    const b = seedTranscript({ transcriptType: "EOD_REVIEW", structuredJson });

    await runRedirecting(() => actions.confirmTranscriptAction(form({ id: a.id })));
    await runRedirecting(() => actions.confirmTranscriptAction(form({ id: b.id })));

    expect(store.data.dailyJournals).toHaveLength(1);
    expect(store.data.dailyJournals[0].disciplineScore).toBe(7);
    expect(store.data.trades).toHaveLength(0); // an EOD review is not a trade
  });
});

describe("confirm: on-screen edits win over the AI draft", () => {
  it("uses the trader's corrected fields, not the extracted ones (the trust promise)", async () => {
    const transcript = seedTranscript({
      transcriptType: "TRADE_ENTRY_NOTE",
      structuredJson: JSON.stringify({ instrument: "BTC", direction: "LONG", entryThesis: "AI guess" }),
    });

    await runRedirecting(() => actions.confirmTranscriptAction(form({
      id: transcript.id,
      instrument: "ETH",
      entryThesis: "My corrected thesis",
    })));

    const trade = store.data.trades[0];
    expect(trade.instrument).toBe("ETH");
    expect(trade.entryThesis).toBe("My corrected thesis");
    expect(trade.direction).toBe("LONG"); // untouched fields keep the AI value
  });
});

describe("extraction mode signalling (the 'basic mode' badge)", () => {
  it("reports 'basic' when there is no API key, and the saved draft records it", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { mode } = await structureTranscriptWithMode("Long BTC. Entry 50000.", "TRADE_ENTRY_NOTE");
    expect(mode).toBe("basic");

    await runRedirecting(() => actions.saveTranscriptAction(form({
      transcriptType: "TRADE_ENTRY_NOTE",
      rawText: "Long BTC. Entry 50000.",
    })));
    const transcript = store.data.transcripts.at(-1)!;
    const draft = JSON.parse(transcript.structuredJson!) as { _extractionMode?: string };
    expect(draft._extractionMode).toBe("basic");
  });
});

describe("extraction never invents numbers it wasn't told", () => {
  it("returns null prices when none were stated", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const result = await structureTranscript("Thinking about going long BTC, feeling calm today.", "TRADE_ENTRY_NOTE");
    expect(result.entryPrice).toBeNull();
    expect(result.stopPrice).toBeNull();
    expect(result.targetPrice).toBeNull();
    expect(result.instrument).toBe("BTC");
    expect(result.direction).toBe("LONG");
  });

  it("captures the prices that were stated (regex fallback)", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    // The dev-only regex mock keys off "entry/stop" adjacency; the production
    // Claude path is more flexible. We assert the fallback still grabs the
    // obvious cases so a no-API-key dev never silently loses every number.
    const result = await structureTranscript("Long BTC. Entry 50000, stop 48000.", "TRADE_ENTRY_NOTE");
    expect(result.entryPrice).toBe(50000);
    expect(result.stopPrice).toBe(48000);
  });
});
