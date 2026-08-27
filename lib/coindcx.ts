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

// ROUND 2. Round 1 confirmed /trades, /orders and /positions and ruled out
// three names for the transactions endpoint, so those variants are gone and
// the remaining unknowns get the space instead:
//
//   1. Where does funding live? The Transactions tab exists in the UI, so an
//      endpoint exists; we have only ruled out three spellings of it.
//   2. How much history can one call carry, and does paging reach back far
//      enough to import a whole account?
//   3. Round 1's SOL fill said margin_currency_short_name "INR" while the
//      request asked for USDT and the price was plainly in USDT. Either the
//      filter is ignored or that field means something other than what it
//      looks like. P&L currency depends on the answer, so it is not cosmetic.
const FUNDING_CANDIDATES = [
  "/exchange/v1/derivatives/futures/positions/transactions",
  "/exchange/v1/derivatives/futures/transactions/list",
  "/exchange/v1/derivatives/futures/transactions/history",
  "/exchange/v1/derivatives/futures/wallet_transactions",
  "/exchange/v1/derivatives/futures/wallets",
  "/exchange/v1/derivatives/futures/funding",
  "/exchange/v1/derivatives/futures/funding_history",
  "/exchange/v1/derivatives/futures/account/transactions",
  "/exchange/v1/derivatives/futures/ledger",
  "/exchange/v1/derivatives/futures/data/transactions",
  "/exchange/v1/wallets/transactions",
];

// Both margin accounts, always. 80%+ of the trading is USDT, but an INR trade
// that silently never imports is worse than one that imports slowly.
const BOTH_ACCOUNTS = ["USDT", "INR"];

export const FUTURES_PROBES: Probe[] = [
  ...FUNDING_CANDIDATES.map((path) => ({
    label: `Funding hunt: ${path.split("/").slice(-2).join("/")}`,
    path,
    payload: { page: "1", size: "10", margin_currency_short_name: BOTH_ACCOUNTS },
  })),
  {
    label: "Trades, page 1 at size 100 — how much does one call carry?",
    path: "/exchange/v1/derivatives/futures/trades",
    payload: { page: "1", size: "100", margin_currency_short_name: BOTH_ACCOUNTS },
    summary: summarizeTrades,
  },
  {
    label: "Trades, page 5 at size 100 — does paging reach back, and how far?",
    path: "/exchange/v1/derivatives/futures/trades",
    payload: { page: "5", size: "100", margin_currency_short_name: BOTH_ACCOUNTS },
    summary: summarizeTrades,
  },
  {
    label: "Positions at size 50 — is cumulative_funding_fee ever populated?",
    path: "/exchange/v1/derivatives/futures/positions",
    payload: { page: "1", size: "50", margin_currency_short_name: BOTH_ACCOUNTS },
    summary: summarizePositions,
  },
  {
    // If the filter is honoured, this returns only INR fills and settles what
    // margin_currency_short_name actually means. If it comes back with USDT
    // rows in it, the filter is being ignored and we must split client-side.
    label: "Trades, INR account only — is the currency filter honoured?",
    path: "/exchange/v1/derivatives/futures/trades",
    payload: { page: "1", size: "50", margin_currency_short_name: ["INR"] },
    summary: summarizeTrades,
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

function distinct(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/** How many, how far back, in what, and does anything fail to parse. */
function summarizeTrades(body: unknown): string {
  const records = Array.isArray(body) ? body : [];
  if (!records.length) return "  (empty — no trades on this page, so paging stops before here)";

  const { fills, skipped } = parseFills(body);
  const times = fills.map((fill) => fill.timestamp.getTime());
  const currencies = distinct(
    records.map((record) => String((record as { margin_currency_short_name?: unknown }).margin_currency_short_name ?? "—")),
  );

  return [
    `  records: ${records.length} (parsed ${fills.length}, unusable ${skipped})`,
    `  oldest:  ${new Date(Math.min(...times)).toISOString()}`,
    `  newest:  ${new Date(Math.max(...times)).toISOString()}`,
    `  symbols: ${distinct(fills.map((fill) => fill.instrument)).join(", ")}`,
    `  margin_currency_short_name values: ${currencies.join(", ")}`,
  ].join("\n");
}

/** Whether positions carry usable funding, and whether closed ones show up. */
function summarizePositions(body: unknown): string {
  const records = Array.isArray(body) ? body : [];
  if (!records.length) return "  (empty)";

  const rows = records as Array<Record<string, unknown>>;
  const withFunding = rows.filter((row) => typeof row.cumulative_funding_fee === "number");
  const active = rows.filter((row) => Number(row.active_pos ?? 0) !== 0);

  const lines = [
    `  positions: ${rows.length} (${active.length} with a live size, ${rows.length - active.length} flat)`,
    `  cumulative_funding_fee populated on: ${withFunding.length} of ${rows.length}`,
  ];
  for (const row of withFunding.slice(0, 5)) {
    lines.push(
      `    ${String(row.pair)} funding=${String(row.cumulative_funding_fee)} avg_price=${String(row.avg_price)} active_pos=${String(row.active_pos)}`,
    );
  }
  if (!withFunding.length) {
    lines.push("    → funding is not available here; it has to come from the transactions endpoint");
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
