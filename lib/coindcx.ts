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
};

// The four we need are first; the variants after them cost one 404 each and
// save a round trip if a name is slightly off.
export const FUTURES_PROBES: Probe[] = [
  {
    label: "Get Trades — the Trades tab (fills). THE ONE THAT MATTERS MOST.",
    path: "/exchange/v1/derivatives/futures/trades",
    payload: { page: "1", size: "10", margin_currency_short_name: ["USDT"] },
  },
  {
    label: "Get Transactions — the Transactions tab (funding, realized P&L)",
    path: "/exchange/v1/derivatives/futures/transactions",
    payload: { page: "1", size: "10", margin_currency_short_name: ["USDT"] },
  },
  {
    label: "List Orders — the Orders tab",
    path: "/exchange/v1/derivatives/futures/orders",
    payload: { status: "filled", page: "1", size: "10", margin_currency_short_name: ["USDT"] },
  },
  {
    label: "List Positions",
    path: "/exchange/v1/derivatives/futures/positions",
    payload: { page: "1", size: "10", margin_currency_short_name: ["USDT"] },
  },
  {
    label: "Wallet Transactions (variant A)",
    path: "/exchange/v1/derivatives/futures/wallets/transactions",
    payload: { page: "1", size: "10", margin_currency_short_name: ["USDT"] },
  },
  {
    label: "Wallet Transactions (variant B)",
    path: "/exchange/v1/derivatives/futures/wallet/transactions",
    payload: { page: "1", size: "10", margin_currency_short_name: ["USDT"] },
  },
  {
    label: "Get Trades (variant: /trades/history)",
    path: "/exchange/v1/derivatives/futures/trades/history",
    payload: { page: "1", size: "10", margin_currency_short_name: ["USDT"] },
  },
  {
    label: "List Orders without a status filter (is status required?)",
    path: "/exchange/v1/derivatives/futures/orders",
    payload: { page: "1", size: "10", margin_currency_short_name: ["USDT"] },
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
      lines.push(describeShape(outcome.body));
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
