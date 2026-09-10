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
// TWO CURRENCIES, and they are not the same one. `B-SOL_USDT` is PRICED in
// USDT — price and fee_amount on a fill both arrive in USDT — while
// margin_currency_short_name says which WALLET settles it, which for this
// trader is sometimes INR. Treating the wallet as the money unit made an
// INR-margined position's P&L come out ~100x too small wearing an INR label,
// and it was invisible because it is correct whenever the two happen to match
// (i.e. on every USDT-margined trade). quoteCurrencyOf() is the split.
//
// Known limitation: the ledger is finite and stops at a fixed point (measured
// 08 Jan 2026) while fills reach back to Nov 2025, so the oldest positions
// import with exact fees but no funding. The sync reports that coverage rather
// than implying a completeness it doesn't have.
//
// The probes below stay as the connection test — they are how a future change
// checks the shapes still hold rather than trusting this comment.

// THE allowlist. Every path this module may ever call, all of them read-only
// list/history endpoints. Both the probe and the sync validate against it, so
// there is exactly one place that decides what this app can ask the exchange —
// and nothing in it can place, edit, cancel or exit an order.
export const TRADES_PATH = "/exchange/v1/derivatives/futures/trades";
export const TRANSACTIONS_PATH = "/exchange/v1/derivatives/futures/positions/transactions";
export const ORDERS_PATH = "/exchange/v1/derivatives/futures/orders";
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

  // ── /orders: DISCOVERY IN PROGRESS ──────────────────────────────────────
  //
  // This path has been on the allowlist since the importer was written and has
  // never been called once, so unlike the two above, NOTHING below is known —
  // not the payload it accepts, not one field name.
  //
  // Why it matters: the exchange reports where you were FILLED and never what
  // you ASKED for, which is why measuring slippage currently depends on the
  // trader having typed a stop into the journal. An order carries its own
  // limit/trigger price. If these rows do, slippage becomes measurable from the
  // exchange alone, against the price the bracket was actually set to rather
  // than the one that got written down.
  //
  // FOUR VARIANTS, because the payload is a guess. Both known endpoints take
  // `{page, size}`, so that is variant 1; the others probe whether a status
  // filter is required or merely accepted. A 4xx here is as useful as a 200 —
  // CoinDCX's error body names the parameter it wanted, and formatProbeReport
  // prints error bodies in full for exactly this reason.
  {
    label: "Orders v1 — does it take {page,size} like the other two?",
    path: ORDERS_PATH,
    payload: { page: "1", size: "10" },
    summary: summarizeOrders,
  },
  {
    label: "Orders v2 — is a `status` filter required?",
    path: ORDERS_PATH,
    payload: { status: "filled", page: "1", size: "10" },
    summary: summarizeOrders,
  },
  {
    label: "Orders v3 — same, asking for open orders instead",
    path: ORDERS_PATH,
    payload: { status: "open", page: "1", size: "10" },
    summary: summarizeOrders,
  },
  {
    // The ledger turned out to be FINITE, stopping at a fixed date while fills
    // reached ten months further back — which is why the sync stores rows
    // rather than querying live. Whether orders have the same horizon decides
    // whether this is a backfill or only ever works going forward, so it is
    // asked now rather than discovered after the adapter is written.
    //
    // Round 1 answered this ambiguously: page 8 came back EMPTY, which only
    // proves there are fewer than 701 orders and says nothing about the date.
    // These walk backwards to find the real edge.
    label: "Orders p3 — walking back to find the oldest order",
    path: ORDERS_PATH,
    payload: { page: "3", size: "100" },
    summary: summarizeOrders,
  },
  {
    label: "Orders p5 — walking back to find the oldest order",
    path: ORDERS_PATH,
    payload: { page: "5", size: "100" },
    summary: summarizeOrders,
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

export async function probeFuturesEndpoints(
  credentials: CoindcxCredentials,
  /** Case-insensitive substring of the probe label. Omit to run them all. */
  only?: string | null,
): Promise<ProbeOutcome[]> {
  const needle = only?.trim().toLowerCase();
  const selected = needle ? FUTURES_PROBES.filter((probe) => probe.label.toLowerCase().includes(needle)) : FUTURES_PROBES;

  const outcomes: ProbeOutcome[] = [];
  for (const probe of selected) {
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

/**
 * `B-SOL_USDT` → `USDT`: what the pair is PRICED in.
 *
 * Not the same thing as margin_currency_short_name, which is the wallet the
 * money settles in. An INR-margined SOL trade is still quoted in USDT, and
 * conflating the two made an INR position's P&L come out ~100x too small.
 */
export function quoteCurrencyOf(pair: string): string {
  const match = /_([A-Z]+)$/.exec(pair.trim());
  return match ? match[1] : "";
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
    quoteCurrency: quoteCurrencyOf(pair),
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

/**
 * The order rows, summarised around the ONE question they exist to answer:
 * does an order carry the price it was set at, and can it be joined to a fill?
 *
 * Deliberately prints the full shape of one row as well as the digest. The
 * digest answers "is this usable"; the shape is what the adapter gets written
 * against, and a second round trip to ask for field names would cost the owner
 * another browser trip for nothing.
 *
 * PRICE FIELDS ARE PROBED BY NAME rather than dumped blind, because the whole
 * point is to find out which of them exists and — more importantly — which is
 * actually POPULATED. A field that is present and always null is worse than an
 * absent one: it looks like a working reference price right up until every
 * reading comes out empty.
 */
function summarizeOrders(body: unknown): string {
  // Objects only. A null or a bare string inside the array throws on the first
  // property read, and this runs in a deployed route the dev container cannot
  // reach — so an exception here is a 500 in the owner's browser and a wasted
  // round trip, not a stack trace anyone gets to see. A test pins each case.
  const rows = (Array.isArray(body) ? body : []).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row),
  );
  if (!rows.length) {
    // Not necessarily a failure: an empty array is the honest answer to "any
    // open orders?" and is also what a page past the end returns.
    return "  (empty array — no orders in this window, or this payload filtered them all out)";
  }

  const lines = [`  rows: ${rows.length}`];

  const times = rows
    .map((row) => Number(row.created_at ?? row.timestamp ?? row.updated_at))
    .filter((time) => Number.isFinite(time) && time > 0);
  if (times.length) {
    lines.push(`  span: ${new Date(Math.min(...times)).toISOString()} → ${new Date(Math.max(...times)).toISOString()}`);
  }

  const tally = (key: string) => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = row[key];
      if (value === undefined) continue;
      const label = value === null ? "(null)" : String(value);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    if (!counts.size) return null;
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ");
  };

  for (const key of ["order_type", "status", "side", "margin_currency_short_name"]) {
    const summary = tally(key);
    if (summary) lines.push(`  ${key}: ${summary}`);
  }

  // Every plausible name for "the price you asked for". Reported with how many
  // rows actually carry a non-null value, which is the number that decides
  // whether Phase 2 is possible at all.
  const priceKeys = [
    "price", "limit_price", "stop_price", "trigger_price", "stop_trigger_price",
    "avg_price", "average_price", "take_profit_trigger", "stop_loss_trigger",
    "take_profit_price", "stop_loss_price", "activation_price",
  ];
  const found = priceKeys
    .map((key) => {
      const present = rows.filter((row) => key in row);
      if (!present.length) return null;
      const populated = present.filter((row) => row[key] !== null && row[key] !== undefined && row[key] !== 0 && row[key] !== "0");
      const sample = populated[0]?.[key] ?? present[0]?.[key];
      return `    ${key}: present ${present.length}/${rows.length}, non-empty ${populated.length}, e.g. ${JSON.stringify(sample)}`;
    })
    .filter(Boolean);
  lines.push(found.length ? "  price fields:" : "  price fields: NONE of the expected names are present — read the full shape below");
  lines.push(...(found as string[]));

  // The join. A ledger row links to a fill through parent_id → order_id, so the
  // question here is which key on an ORDER carries that same id. Without it
  // there is no way to say which order produced which fill, and a price with no
  // join is unusable.
  for (const key of ["id", "order_id", "client_order_id", "position_id"]) {
    const present = rows.filter((row) => typeof row[key] === "string" && row[key]);
    if (present.length) lines.push(`  join candidate ${key}: ${present.length}/${rows.length}, e.g. ${JSON.stringify(present[0][key])}`);
  }

  lines.push("  full shape of row 0 (this is what the adapter gets written against):");
  lines.push(describeShape(rows[0], "    "));
  return lines.join("\n");
}

/**
 * ROUND 2. Round 1 established that an order carries BOTH sides of a slippage
 * measurement in one row — `order_type` says whether it was a stop or a target
 * (no geometry needed), `stop_price` is the trigger the trader set, and
 * `avg_price` is what they actually got. Two things it could not establish, and
 * the adapter cannot be written honestly without either:
 *
 *   1. THE JOIN. An order's own key is `id`, and a fill carries `order_id`.
 *      Both are v4 UUIDs and it is overwhelmingly likely they are the same
 *      value — but "overwhelmingly likely" is exactly what `fill_id` looked
 *      like before it turned out to be the transaction's OWN id and matched
 *      nothing. So this MEASURES the overlap instead of assuming it.
 *   2. THE HORIZON. Page 8 at size 100 came back empty, which only proves there
 *      are fewer than 701 orders — it says nothing about how far back they
 *      reach. The ledger turned out to be finite, and if orders are too then
 *      this can only ever work going forward and the sync must store rows
 *      rather than query live.
 *
 * Two calls, cross-referenced. Returns text, like the rest of the probe.
 */
export async function probeOrderFillJoin(credentials: CoindcxCredentials): Promise<string> {
  const lines: string[] = ["Order → fill join, measured rather than assumed.", ""];

  const orders = await callFutures(credentials, {
    label: "orders",
    path: ORDERS_PATH,
    payload: { status: "filled", page: "1", size: "100" },
  });
  await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  const trades = await callFutures(credentials, {
    label: "fills",
    path: TRADES_PATH,
    payload: { page: "1", size: "100" },
  });

  const orderRows = (Array.isArray(orders.body) ? orders.body : []).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
  );
  const fillRows = (Array.isArray(trades.body) ? trades.body : []).filter(
    (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
  );

  if (!orderRows.length || !fillRows.length) {
    return `${lines.join("\n")}\n  Could not fetch both sides (orders ${orderRows.length}, fills ${fillRows.length}). Orders HTTP ${orders.status}, fills HTTP ${trades.status}.`;
  }

  const fillOrderIds = new Set(
    fillRows.map((row) => row.order_id).filter((id): id is string => typeof id === "string" && Boolean(id)),
  );
  const matched = orderRows.filter((row) => typeof row.id === "string" && fillOrderIds.has(row.id));

  lines.push(`  orders (filled, newest 100): ${orderRows.length}`);
  lines.push(`  fills   (newest 100):        ${fillRows.length}`);
  lines.push(`  distinct order_id on those fills: ${fillOrderIds.size}`);
  lines.push(`  ORDERS WHOSE \`id\` APPEARS AS A FILL'S \`order_id\`: ${matched.length}`);
  lines.push("");
  lines.push("  (The two windows only partly overlap in time, so this will never be 100%.");
  lines.push("   What matters is whether it is comfortably ABOVE ZERO — zero would mean the");
  lines.push("   join is wrong, exactly the way joining on fill_id was.)");
  lines.push("");

  // For the ones that DID match, is the order's avg_price the same number the
  // fills give? If it is, the exit price needs no join at all and the order row
  // alone carries the whole measurement.
  lines.push("  avg_price on the order vs the fills it produced:");
  let shown = 0;
  for (const order of matched) {
    if (shown >= 5) break;
    const own = fillRows.filter((row) => row.order_id === order.id);
    const qty = own.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
    const notional = own.reduce((sum, row) => sum + (Number(row.quantity) || 0) * (Number(row.price) || 0), 0);
    const vwap = qty > 0 ? notional / qty : null;
    lines.push(
      `    ${String(order.pair)} ${String(order.order_type)} — order.avg_price=${String(order.avg_price)}, fills VWAP=${vwap === null ? "n/a" : vwap.toFixed(6)} over ${own.length} leg(s), order.stop_price=${String(order.stop_price)}`,
    );
    shown += 1;
  }
  if (!shown) lines.push("    (none matched — see the count above)");

  lines.push("");
  lines.push("  horizon — oldest order in this page of 100:");
  const times = orderRows.map((row) => Number(row.created_at)).filter((time) => Number.isFinite(time) && time > 0);
  if (times.length) {
    lines.push(`    ${new Date(Math.min(...times)).toISOString()} → ${new Date(Math.max(...times)).toISOString()}`);
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
