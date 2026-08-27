// Talking to CoinDCX's futures API: signing, the endpoint allowlist, and
// turning its records into ours. The paging and storage live in
// lib/coindcx-sync.ts; this file knows the wire format and nothing else.
//
// The futures API is documented only on docs.coindcx.com, which is JS-rendered
// and unreadable by any fetch tooling available here — two independent attempts
// got endpoint names and no fields. So every shape below was learned by asking
// the live API and is pinned by fixtures in tests/unit/coindcx.test.ts. Those
// fixtures ARE the schema; there is no published one to check them against.
//
// READ-ONLY BY CONSTRUCTION. `callFutures` refuses any path outside
// ALLOWED_PATHS, all of which are list/history endpoints. Nothing here can
// place, edit, cancel or exit an order — and per the project brief, nothing
// here ever should.
//
// Credentials are passed in rather than read from the environment inside the
// call, so the one caller that needs a different source (the local script, which
// reads .env.local) doesn't need a second copy of the signing logic.

import { createHmac } from "node:crypto";
import type { Fill, FundingEvent } from "@/lib/positions";
import type { MoneyRate } from "@/lib/currency";

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

// DISCOVERY COMPLETE. What three rounds against the live API established:
//
//   /trades ................. fills. ~425 over 10 months, 100 per call, newest
//                             first. The whole account is 5 calls.
//   /positions/transactions . the ledger: funding, exits and realized P&L.
//                             `stage` is the UI's Transaction Type column —
//                             measured: funding 47, default 40, tpsl_exit 12,
//                             exit 1. Carries price_in_inr / price_in_usdt, so
//                             currency conversion needs no FX feed.
//   /positions .............. useless here: 13 rows, all flat, funding never
//                             populated. Not used.
//   margin_currency filter .. IGNORED. Asking for INR alone returns USDT rows
//                             too, so both accounts arrive together and the
//                             split happens client-side off each record.
//
// Known limitation, deliberately not worked around: the ledger only reaches
// back ~3 weeks while fills reach back 10 months, so older positions import
// with exact fees but no funding. The sync reports that coverage rather than
// implying a completeness it doesn't have.
//
// The probes below stay as the connection test — they are how a future change
// checks the shapes still hold rather than trusting this comment.

// THE allowlist. Every path this module may ever call, all of them read-only
// list/history endpoints. Both the probe and the sync validate against it, so
// there is exactly one place that decides what this app can ask the exchange —
// and nothing in it can place, edit, cancel or exit an order.
export const TRADES_PATH = "/exchange/v1/derivatives/futures/trades";
export const TRANSACTIONS_PATH = "/exchange/v1/derivatives/futures/positions/transactions";
const ORDERS_PATH = "/exchange/v1/derivatives/futures/orders";
const POSITIONS_PATH = "/exchange/v1/derivatives/futures/positions";

const ALLOWED_PATHS = new Set([TRADES_PATH, TRANSACTIONS_PATH, ORDERS_PATH, POSITIONS_PATH]);

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

// A record from /derivatives/futures/positions/transactions:
//
//   { pair: "B-SOL_USDT", stage: "tpsl_exit", amount: -1305.1716,
//     fee_amount: 30.223106124, price_in_inr: 1, price_in_usdt: 0.010019036,
//     source: "user", parent_type: "Derivatives::Futures::Order",
//     parent_id: "27394361-…", fill_id: "622229f6-…",
//     position_id: "29a90352-…", margin_currency_short_name: "INR",
//     created_at: 1787841686907 }
//
// TRAP, learned the hard way: this `fill_id` is the transaction's OWN id (a
// time-based v1 UUID), NOT the trades endpoint's `fill_id` (a v4). Joining the
// two on that field would look plausible and match nothing. The real link to a
// trade is `parent_id` → the trade's `order_id`.
//
// `stage` is the UI's "Transaction Type" column. Measured over a real ledger:
// funding 47, default 40, tpsl_exit 12, exit 1.

/** The stages that are a funding payment rather than a realized-P&L event. */
const FUNDING_STAGES = new Set(["funding"]);

/** The stages that close (or partly close) a position and realize P&L. */
const EXIT_STAGES = new Set(["default", "exit", "tpsl_exit"]);

export type CoindcxTransaction = {
  id: string;
  instrument: string;
  currency: string;
  stage: string;
  kind: "FUNDING" | "EXIT" | "OTHER";
  amount: number;
  fee: number;
  /** The exchange's own position id — a stronger key than any of ours. */
  positionId: string | null;
  /** The ORDER this row belongs to. The join to a fill goes through this. */
  orderId: string | null;
  /** What one unit of `currency` was worth, in each currency, at the time. */
  rate: MoneyRate;
  timestamp: Date;
};

/**
 * Was this exit a stop-out or a take-profit? The journal has never known this
 * without being told; `tpsl_exit` says the exchange's own bracket closed the
 * position rather than the trader.
 */
export function exitWasAutomatic(transaction: CoindcxTransaction): boolean {
  return transaction.stage === "tpsl_exit";
}

export function parseTransaction(record: unknown): CoindcxTransaction | null {
  if (!record || typeof record !== "object") return null;
  const raw = record as Record<string, unknown>;

  const id = typeof raw.fill_id === "string" ? raw.fill_id : null;
  const pair = typeof raw.pair === "string" ? raw.pair : null;
  const amount = finiteNumber(raw.amount);
  const createdAt = finiteNumber(raw.created_at);
  if (!id || !pair || amount === null || createdAt === null) return null;

  const stage = typeof raw.stage === "string" ? raw.stage : "";
  return {
    id,
    instrument: normalizePair(pair),
    currency: typeof raw.margin_currency_short_name === "string" ? raw.margin_currency_short_name : "",
    stage,
    kind: FUNDING_STAGES.has(stage) ? "FUNDING" : EXIT_STAGES.has(stage) ? "EXIT" : "OTHER",
    amount,
    fee: finiteNumber(raw.fee_amount) ?? 0,
    positionId: typeof raw.position_id === "string" ? raw.position_id : null,
    orderId: typeof raw.parent_id === "string" ? raw.parent_id : null,
    rate: { inr: finiteNumber(raw.price_in_inr), usdt: finiteNumber(raw.price_in_usdt) },
    timestamp: new Date(createdAt),
  };
}

export type ParsedTransactions = {
  transactions: CoindcxTransaction[];
  skipped: number;
  /** Every stage seen, so a value CoinDCX adds later shows up instead of
   *  being silently bucketed as OTHER and quietly dropped from the maths. */
  unknownStages: string[];
};

export function parseTransactions(body: unknown): ParsedTransactions {
  const records = Array.isArray(body) ? body : [];
  const transactions: CoindcxTransaction[] = [];
  const unknown = new Set<string>();
  let skipped = 0;

  for (const record of records) {
    const transaction = parseTransaction(record);
    if (!transaction) {
      skipped += 1;
      continue;
    }
    if (transaction.kind === "OTHER") unknown.add(transaction.stage);
    transactions.push(transaction);
  }

  return { transactions, skipped, unknownStages: [...unknown].sort() };
}

/**
 * The funding rows, as the reconstructor wants them.
 *
 * Attribution is by instrument + currency + time window rather than by
 * position_id: funding only ever accrues while a position is open, so the
 * window is exact in every case except closing and reopening the same symbol
 * inside one funding period. position_id is carried on the transaction for the
 * day that stops being good enough.
 */
export function fundingEventsFrom(transactions: CoindcxTransaction[]): FundingEvent[] {
  return transactions
    .filter((transaction) => transaction.kind === "FUNDING")
    .map((transaction) => ({
      id: transaction.id,
      instrument: transaction.instrument,
      currency: transaction.currency,
      amount: transaction.amount,
      timestamp: transaction.timestamp,
    }));
}

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
