// Ask CoinDCX what its futures history endpoints actually look like.
//
// Why this exists: the futures API is documented only on docs.coindcx.com,
// which is JS-rendered and not readable by any of the fetch tooling we have.
// Rather than transcribe it by hand — or guess paths and build on top of the
// guess — this asks the exchange directly and prints what came back. The API is
// the ground truth anyway; docs drift, responses don't.
//
// It is READ-ONLY BY CONSTRUCTION. Every path it will call is in the allowlist
// below, all of them list/history endpoints. It cannot place, edit, cancel or
// exit anything, and there is no code path that takes a URL from anywhere else.
//
// It never prints your key or secret. What it prints is meant to be pasted back
// into the TradeGenie chat: HTTP status, record count, and the field names and
// types of the first record, with one example value each so the shape is
// unambiguous. Example values come from your own trade history — nothing
// sensitive, but read the output before you paste it, as you would any log.
//
//   COINDCX_API_KEY=... COINDCX_API_SECRET=... npx tsx scripts/coindcx-probe.ts
//
// Generate the key with READ-ONLY permission and bind it to your IP. This
// script does not need, and must not be given, trade or withdrawal permission.

import { createHmac } from "node:crypto";

const BASE_URL = "https://api.coindcx.com";
const KEY = process.env.COINDCX_API_KEY ?? "";
const SECRET = process.env.COINDCX_API_SECRET ?? "";

/** Space between calls, so a probe of a dozen endpoints can't trip a rate limit. */
const PAUSE_MS = 400;

type Probe = {
  /** What this endpoint is believed to be, in the exchange UI's own words. */
  label: string;
  path: string;
  /** Payload minus `timestamp`, which is added at call time. */
  payload: Record<string, unknown>;
};

// The candidates. The four we actually need are the first four; the variants
// after them cost one 404 each and save a round trip if a name is off. Order
// matters only for readability of the output.
const PROBES: Probe[] = [
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

const ALLOWED_PATHS = new Set(PROBES.map((probe) => probe.path));

async function call(probe: Probe) {
  if (!ALLOWED_PATHS.has(probe.path)) throw new Error(`Refusing to call un-allowlisted path: ${probe.path}`);

  // The signature covers the exact bytes sent, so the body must be serialized
  // once and reused. Re-stringifying to sign is the classic way to get a 401.
  const body = JSON.stringify({ ...probe.payload, timestamp: Date.now() });
  const signature = createHmac("sha256", SECRET).update(body).digest("hex");

  const response = await fetch(`${BASE_URL}${probe.path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-AUTH-APIKEY": KEY,
      "X-AUTH-SIGNATURE": signature,
    },
    body,
  });

  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, ok: response.ok, parsed, sentPayload: probe.payload };
}

/** Field names, types and one example each — the thing worth pasting back. */
function describeShape(value: unknown, indent = "  "): string {
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

async function main() {
  if (!KEY || !SECRET) {
    console.error("Set COINDCX_API_KEY and COINDCX_API_SECRET, e.g.\n");
    console.error("  COINDCX_API_KEY=xxx COINDCX_API_SECRET=yyy npx tsx scripts/coindcx-probe.ts\n");
    console.error("Use a READ-ONLY key. This script never needs trade permission.");
    process.exit(1);
  }

  console.log("CoinDCX futures probe — read-only, no orders are placed or changed.");
  console.log(`Base: ${BASE_URL}\n`);

  for (const probe of PROBES) {
    console.log("─".repeat(72));
    console.log(probe.label);
    console.log(`POST ${probe.path}`);
    console.log(`payload: ${JSON.stringify(probe.payload)} (+ timestamp)`);
    try {
      const { status, ok, parsed } = await call(probe);
      console.log(`→ HTTP ${status}`);
      if (ok) {
        console.log(describeShape(parsed));
      } else {
        // A 4xx body usually names the missing or wrong parameter, which is
        // every bit as useful as a success — that is why this prints in full.
        console.log(`error body: ${typeof parsed === "string" ? parsed : JSON.stringify(parsed)}`);
      }
    } catch (error) {
      console.log(`→ request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    console.log("");
    await new Promise((resolve) => setTimeout(resolve, PAUSE_MS));
  }

  console.log("─".repeat(72));
  console.log("Done. Paste the output back into the TradeGenie chat (read it first).");
}

void main();
