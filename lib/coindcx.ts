// Talking to CoinDCX's futures API.
//
// Right now this is only the signing core plus a discovery probe. The futures
// API is documented on docs.coindcx.com, which is JS-rendered and unreadable by
// any fetch tooling we have — two independent attempts got the endpoint names
// ("Get Trades", "Get Transactions", "List Orders") and no parameters or
// response fields. So rather than guess paths and build on the guess, we ask
// the exchange and write the adapter against what it actually returns. The API
// is the ground truth anyway; docs drift, responses don't.
//
// READ-ONLY BY CONSTRUCTION. Every callable path is in FUTURES_PROBES, all of
// them list/history endpoints, and `callFutures` refuses anything outside that
// list. Nothing here can place, edit, cancel or exit an order — and per the
// project brief, nothing here ever should.
//
// Credentials are passed in rather than read from the environment inside the
// call, so the one caller that needs a different source (the local script, which
// reads .env.local) doesn't need a second copy of the signing logic.

import { createHmac } from "node:crypto";
import type { Fill } from "@/lib/positions";

const BASE_URL = "https://api.coindcx.com";

export type CoindcxCredentials = { key: string; secret: string };

export function credentialsFromEnv(): CoindcxCredentials | null {
  const key = process.env.COINDCX_API_KEY ?? "";
  const secret = process.env.COINDCX_API_SECRET ?? "";
  return key && secret ? { key, secret } : null;
}

export type Probe = {
  /** What this endpoint is believed to be, in the exchange UI's own words. */
  label: string;
  path: string;
  /** Payload minus `timestamp`, which is added at call time. */
  payload: Record<string, unknown>;
  /**
   * For a call returning many records, a digest beats dumping the shape — the
   * question is the distribution (how far back, which currencies, is funding
   * ever populated), not the field names, which we already have.
   */
  summary?: (body: unknown) => string;
};

// ROUND 3. Rounds 1-2 settled almost everything:
//
//   /trades ................. fills. 425 of them over ~10 months, 100 per call,
//                             newest first. The whole account is 5 calls.
//   /positions/transactions . FOUND. Funding, exits and P&L, each row carrying
//                             position_id AND fill_id, so funding attributes to
//                             a position exactly rather than by time window.
//   /positions .............. useless here: 13 rows, all flat, funding never
//                             populated. Dropped.
//   margin_currency filter .. IGNORED. Asking for INR alone returns USDT rows
//                             too, so both accounts arrive together and the
//                             split has to happen client-side off each record.
//
// One unknown left, and it is the one the whole transaction parser turns on:
// what values does `stage` take? We have seen "tpsl_exit". Which value means a
// funding payment decides what becomes a FundingEvent, and guessing it would
// silently drop every funding row — the exact cost the import exists to capture.
const TRANSACTIONS_PATH = "/exchange/v1/derivatives/futures/positions/transactions";

export const FUTURES_PROBES: Probe[] = [
  {
    label: "Transactions p1 — what values does `stage` take?",
    path: TRANSACTIONS_PATH,
    payload: { page: "1", size: "100" },
    summary: summarizeTransactions,
  },
  {
    label: "Transactions p3 — same, deeper in (rarer stages surface here)",
    path: TRANSACTIONS_PATH,
    payload: { page: "3", size: "100" },
    summary: summarizeTransactions,
  },
  {
    label: "Transactions p10 — how far back does the ledger go?",
    path: TRANSACTIONS_PATH,
    payload: { page: "10", size: "100" },
    summary: summarizeTransactions,
  },
];

const ALLOWED_PATHS = new Set(FUTURES_PROBES.map((probe) => probe.path));

export type ProbeOutcome = {
  probe: Probe;
  status: number | null;
  ok: boolean;
  /** Parsed JSON when the response was JSON, the raw text otherwise. */
  body: unknown;
  /** Set only when the request never completed (DNS, egress block, timeout). */
  error?: string;
};

/**
 * One signed POST. The body is serialized ONCE and both signed and sent —
 * re-stringifying between signing and sending is the classic way to get a 401
 * that looks like a bad key and isn't.
 */
export async function callFutures(
  credentials: CoindcxCredentials,
  probe: Probe,
  timeoutMs = 15_000,
): Promise<ProbeOutcome> {
  if (!ALLOWED_PATHS.has(probe.path)) {
    throw new Error(`Refusing to call un-allowlisted path: ${probe.path}`);
  }

  const body = JSON.stringify({ ...probe.payload, timestamp: Date.now() });
  const signature = createHmac("sha256", credentials.secret).update(body).digest("hex");

  try {
    const response = await fetch(`${BASE_URL}${probe.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-APIKEY": credentials.key,
        "X-AUTH-SIGNATURE": signature,
      },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await response.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    return { probe, status: response.status, ok: response.ok, body: parsed };
  } catch (error) {
    return {
      probe,
      status: null,
      ok: false,
      body: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Space between calls, so probing a dozen endpoints can't trip a rate limit. */
const PAUSE_MS = 400;

export async function probeFuturesEndpoints(credentials: CoindcxCredentials): Promise<ProbeOutcome[]> {
  const outcomes: ProbeOutcome[] = [];
  for (const probe of FUTURES_PROBES) {
    outcomes.push(await callFutures(credentials, probe));
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }
  return outcomes;
}

/**
 * Field names, types and one example each. This is the bit worth reading and
 * pasting back — enough to write the adapter against without a second round
 * trip, and small enough to skim before sharing.
 */
export function describeShape(value: unknown, indent = "  "): string {
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}(empty array — no records in this window)`;
    return `${indent}array of ${value.length}, first record:\n${describeShape(value[0], `${indent}  `)}`;
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => {
        if (item && typeof item === "object") {
          return `${indent}${key}: ${Array.isArray(item) ? "array" : "object"}\n${describeShape(item, `${indent}  `)}`;
        }
        return `${indent}${key}: ${item === null ? "null" : typeof item} = ${JSON.stringify(item)}`;
      })
      .join("\n");
  }
  return `${indent}${JSON.stringify(value)}`;
}

// ── Turning CoinDCX's records into ours ─────────────────────────────────────
//
// Shapes below are what the live API actually returned, not what any doc says.
// A record from /derivatives/futures/trades:
//
//   { price: 107.54, quantity: 4.67, is_maker: false,
//     fee_amount: 0.296304962, pair: "B-SOL_USDT", side: "buy",
//     timestamp: 1787841686516, fill_id: "60c17b8d-…", order_id: "27394361-…",
//     settlement_currency_conversion_price: 1, margin_currency_short_name: "INR" }
//
// Note `fee_amount` arrives unrounded. The exchange's own UI shows that as
// "0.30"; keeping the real figure is the entire reason for importing rather
// than reading the screen.

/**
 * `B-SOL_USDT` → `SOL`. The journal stores the bare base symbol, which is what
 * the trader types in the quick log and what every tag and filter keys off.
 * Anything that doesn't match the exchange's pattern is passed through
 * unchanged rather than mangled — a wrong symbol is worse than an ugly one.
 */
export function normalizePair(pair: string): string {
  const match = /^B-(.+)_[A-Z]+$/.exec(pair.trim());
  return match ? match[1] : pair.trim();
}

type RawTrade = {
  fill_id?: unknown;
  pair?: unknown;
  side?: unknown;
  quantity?: unknown;
  price?: unknown;
  fee_amount?: unknown;
  timestamp?: unknown;
  order_id?: unknown;
  margin_currency_short_name?: unknown;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One API trade → one `Fill`, or null if the record can't be trusted.
 *
 * Returning null rather than throwing is deliberate: one malformed row must not
 * cost the import of a whole day. Callers count what was skipped and say so —
 * a silent drop in a journal is worse than a loud one.
 */
export function parseFill(record: unknown): Fill | null {
  if (!record || typeof record !== "object") return null;
  const raw = record as RawTrade;

  const id = typeof raw.fill_id === "string" ? raw.fill_id : null;
  const pair = typeof raw.pair === "string" ? raw.pair : null;
  const side = typeof raw.side === "string" ? raw.side.trim().toUpperCase() : null;
  const quantity = finiteNumber(raw.quantity);
  const price = finiteNumber(raw.price);
  const timestamp = finiteNumber(raw.timestamp);

  if (!id || !pair || (side !== "BUY" && side !== "SELL")) return null;
  if (quantity === null || quantity <= 0 || price === null || timestamp === null) return null;

  return {
    id,
    instrument: normalizePair(pair),
    // The trader runs separate INR and USDT margin accounts, so this is not
    // decoration: positions are grouped by instrument AND currency, and the
    // same symbol in both accounts must never fold into one position.
    currency: typeof raw.margin_currency_short_name === "string" ? raw.margin_currency_short_name : "",
    side,
    quantity,
    price,
    // A missing fee is 0, not a reason to drop the fill: the fill is the fact,
    // the fee is a cost on it.
    fee: finiteNumber(raw.fee_amount) ?? 0,
    timestamp: new Date(timestamp),
    orderId: typeof raw.order_id === "string" ? raw.order_id : null,
  };
}

export type ParsedFills = { fills: Fill[]; skipped: number };

/** Every usable fill in a trades response, plus how many rows were unusable. */
export function parseFills(body: unknown): ParsedFills {
  const records = Array.isArray(body) ? body : [];
  const fills: Fill[] = [];
  let skipped = 0;
  for (const record of records) {
    const fill = parseFill(record);
    if (fill) fills.push(fill);
    else skipped += 1;
  }
  return { fills, skipped };
}

// ── Digests for the high-volume diagnostic calls ────────────────────────────

/**
 * The transaction ledger's vocabulary. Everything the parser needs to be
 * written correctly rather than hopefully: which `stage` values exist and how
 * often, whether each carries a fill_id and a position_id, and — per margin
 * currency — one worked example of the price_in_* pair, which is how a value
 * gets converted without inventing an FX rate.
 */
function summarizeTransactions(body: unknown): string {
  const rows = (Array.isArray(body) ? body : []) as Array<Record<string, unknown>>;
  if (!rows.length) return "  (empty — the ledger stops before this page)";

  const times = rows
    .map((row) => Number(row.created_at))
    .filter((time) => Number.isFinite(time));

  const byStage = new Map<string, { count: number; withFill: number; withPosition: number; sample: number }>();
  for (const row of rows) {
    const stage = String(row.stage ?? "(none)");
    const entry = byStage.get(stage) ?? { count: 0, withFill: 0, withPosition: 0, sample: Number(row.amount) };
    entry.count += 1;
    if (typeof row.fill_id === "string" && row.fill_id) entry.withFill += 1;
    if (typeof row.position_id === "string" && row.position_id) entry.withPosition += 1;
    byStage.set(stage, entry);
  }

  const lines = [
    `  rows: ${rows.length}`,
    `  span: ${new Date(Math.min(...times)).toISOString()} → ${new Date(Math.max(...times)).toISOString()}`,
    "  stages (count, has fill_id, has position_id, one amount):",
  ];
  for (const [stage, entry] of [...byStage.entries()].sort((a, b) => b[1].count - a[1].count)) {
    lines.push(`    ${stage}: ${entry.count}, fill_id ${entry.withFill}/${entry.count}, position_id ${entry.withPosition}/${entry.count}, e.g. ${entry.sample}`);
  }

  // One example per margin currency proves what price_in_* means: for an
  // INR-margined row price_in_inr should be 1, for a USDT-margined row
  // price_in_usdt should be 1. If that holds, conversion is free and exact.
  lines.push("  conversion sample per margin currency:");
  const seen = new Set<string>();
  for (const row of rows) {
    const currency = String(row.margin_currency_short_name ?? "—");
    if (seen.has(currency)) continue;
    seen.add(currency);
    lines.push(`    ${currency}: price_in_inr=${String(row.price_in_inr)} price_in_usdt=${String(row.price_in_usdt)} amount=${String(row.amount)} fee=${String(row.fee_amount)}`);
  }
  return lines.join("\n");
}

/** The whole probe run as plain text, ready to copy. */
export function formatProbeReport(outcomes: ProbeOutcome[]): string {
  const lines: string[] = [
    "CoinDCX futures probe — read-only, no orders were placed or changed.",
    "",
  ];
  for (const outcome of outcomes) {
    lines.push("─".repeat(72));
    lines.push(outcome.probe.label);
    lines.push(`POST ${outcome.probe.path}`);
    lines.push(`payload: ${JSON.stringify(outcome.probe.payload)} (+ timestamp)`);
    if (outcome.error) {
      lines.push(`→ request failed: ${outcome.error}`);
    } else if (outcome.ok) {
      lines.push(`→ HTTP ${outcome.status}`);
      lines.push(outcome.probe.summary ? outcome.probe.summary(outcome.body) : describeShape(outcome.body));
    } else {
      // A 4xx body usually names the missing or wrong parameter, which is every
      // bit as useful as a success — so it prints in full.
      lines.push(`→ HTTP ${outcome.status}`);
      lines.push(`error body: ${typeof outcome.body === "string" ? outcome.body : JSON.stringify(outcome.body)}`);
    }
    lines.push("");
  }
  lines.push("─".repeat(72));
  lines.push("Done. Paste this back into the TradeGenie chat (read it first).");
  return lines.join("\n");
}
