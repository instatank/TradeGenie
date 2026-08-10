import { z } from "zod";

// The SignalDesk bridge. When a trade is saved, we ask the other app what the
// market looked like at that moment and freeze the answer onto the trade — so
// a year of trades carries a year of weather reports, and questions like "do I
// lose money buying into greed?" become answerable later.
//
// Two rules govern everything in this file:
//
// 1. IT IS NEVER LOAD-BEARING. If SignalDesk is slow, down, misconfigured or
//    returns junk, the trade saves with marketContext: null. Same principle as
//    "AI is optional" — the journal must never fail because the market-data app
//    had a bad day. 2-second timeout, catch everything, move on.
//
// 2. THE CONTEXT IS THE BRIEFING IN EFFECT AT ENTRY. SignalDesk publishes at
//    07:00 and 19:00 IST, and resolves the slot AT OR BEFORE the trade time —
//    a 06:00 IST trade gets the previous evening's briefing, never the 07:00
//    one published an hour later. That comparison lives in SignalDesk (one
//    tested implementation); we just send the trade's timestamp.
//
// Because the key is a day + slot rather than a moment, a failed capture is
// recoverable — the same endpoint can serve that slot again later. So never
// trade save speed for capture certainty.

const TIMEOUT_MS = 2000;

// Every field is nullable by contract: SignalDesk returns null sections rather
// than failing, and a half-empty snapshot is worth more than none. .catch()
// on the outer parse is not enough — we want a malformed payload to become
// null rather than corrupt journal data, so the shape is validated strictly
// and any parse failure is treated as "no context".
const coinSchema = z.object({
  symbol: z.string(),
  price: z.number().nullable(),
  change24h: z.number().nullable(),
  fundingRate: z.number().nullable(),
  fundingBand: z.string().nullable(),
  fundingLabel: z.string().nullable(),
  oiChange24h: z.number().nullable(),
  flowTag: z.string().nullable(),
});

const marketContextSchema = z.object({
  marketDate: z.string(),
  slot: z.string(),
  slotAt: z.string().nullable().optional(),
  capturedAt: z.string(),
  source: z.literal("signaldesk"),
  version: z.number(),
  instrument: z.string().nullable(),
  fearGreed: z.object({ value: z.number(), classification: z.string().nullable() }).nullable(),
  coin: coinSchema.nullable(),
  btc: z.object({ price: z.number().nullable(), change24h: z.number().nullable() }).nullable(),
  topHeadline: z
    .object({
      title: z.string().nullable(),
      source: z.string().nullable(),
      url: z.string().nullable(),
      publishedAt: z.string().nullable(),
    })
    .nullable(),
  briefingHeadline: z.string().nullable(),
  briefingSlot: z.string().nullable().optional(),
  macroNext: z.object({ name: z.string(), date: z.string() }).nullable(),
});

export type MarketContext = z.infer<typeof marketContextSchema>;

// True when both env vars are set. Until then the bridge is off and nothing
// breaks — no network call, no delay, no error.
export function marketContextEnabled(): boolean {
  return Boolean(process.env.SIGNALDESK_SNAPSHOT_URL && process.env.SIGNALDESK_SNAPSHOT_TOKEN);
}

// Fetch the market context for one trade. Returns null on ANY failure —
// unset config, timeout, non-200, malformed JSON, schema mismatch. Callers
// never need a try/catch of their own.
export async function captureMarketContext(
  instrument: string,
  at: Date = new Date(),
): Promise<MarketContext | null> {
  const base = process.env.SIGNALDESK_SNAPSHOT_URL;
  const token = process.env.SIGNALDESK_SNAPSHOT_TOKEN;
  if (!base || !token) return null;

  try {
    const url = new URL(base);
    // `at` is the trade's entry time; SignalDesk resolves the slot at or
    // before it. Sending the timestamp rather than a pre-computed slot keeps
    // the no-lookahead rule in exactly one place.
    url.searchParams.set("at", at.toISOString());
    if (instrument) url.searchParams.set("instrument", instrument);

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    if (!response.ok) return null;

    const parsed = marketContextSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    // Timeout, DNS, TLS, bad JSON — all the same answer. The trade still saves.
    return null;
  }
}
