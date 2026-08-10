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

// --- the wire shape -------------------------------------------------------
// Every field is nullable by contract: SignalDesk returns null sections rather
// than failing, and a half-empty snapshot is worth more than none.
//
// Optional fields use .default(null), never .optional(). An absent key would
// parse to `undefined`, and lib/store.ts hands values straight to Firestore,
// which REJECTS undefined — that would throw inside db.create and take the
// whole trade save down with it. The one thing this feature must never do.

const wireCoin = z.object({
  symbol: z.string(),
  price: z.number().nullable(),
  change24h: z.number().nullable(),
  fundingRate: z.number().nullable(),
  fundingBand: z.string().nullable(),
  fundingLabel: z.string().nullable(),
  oiChange24h: z.number().nullable(),
  flowTag: z.string().nullable(),
});

const wireSchema = z.object({
  marketDate: z.string(),
  slot: z.string(),
  slotAt: z.string().nullable().default(null),
  capturedAt: z.string(),
  source: z.literal("signaldesk"),
  version: z.number(),
  instrument: z.string().nullable().default(null),
  fearGreed: z.object({ value: z.number(), classification: z.string().nullable() }).nullable().default(null),
  coin: wireCoin.nullable().default(null),
  btc: z.object({ price: z.number().nullable(), change24h: z.number().nullable() }).nullable().default(null),
  topHeadline: z
    .object({
      title: z.string().nullable(),
      source: z.string().nullable(),
      url: z.string().nullable(),
      publishedAt: z.string().nullable(),
    })
    .nullable()
    .default(null),
  briefingHeadline: z.string().nullable().default(null),
  briefingSlot: z.string().nullable().default(null),
  macroNext: z.object({ name: z.string(), date: z.string() }).nullable().default(null),
});

// --- the stored shape -----------------------------------------------------
// Timestamps are Dates, not ISO strings, because lib/store.ts hydrates any key
// ending in "At" (and the key "date") back into a Date on read. Storing
// strings there would mean the type says string and the value is a Date — a
// lie that surfaces as a crash on the trade page months later. Match the
// store's convention instead of fighting it.

export type MarketContext = {
  marketDate: string; // IST calendar day, "2026-08-10"
  slot: string; // "07" | "19" — the briefing in effect at entry
  slotAt: Date | null; // when that briefing published
  capturedAt: Date; // when this copy was taken
  source: "signaldesk";
  version: number;
  instrument: string | null;
  fearGreed: { value: number; classification: string | null } | null;
  coin: z.infer<typeof wireCoin> | null;
  btc: { price: number | null; change24h: number | null } | null;
  topHeadline: { title: string | null; source: string | null; url: string | null; publishedAt: Date | null } | null;
  briefingHeadline: string | null;
  briefingSlot: string | null; // which slot's briefing supplied the headline
  macroNext: { name: string; date: Date } | null;
};

function toDate(iso: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Explicit field-by-field construction, so no key can arrive as undefined and
// blow up the Firestore write.
function toStored(wire: z.infer<typeof wireSchema>): MarketContext | null {
  const capturedAt = toDate(wire.capturedAt);
  if (!capturedAt) return null; // a snapshot with no capture time is not evidence

  // SignalDesk answers 200 with null sections when ITS Firestore is down, so a
  // reply can be well-formed and still carry nothing. Storing that would put an
  // empty panel on the trade and, worse, mark it as "has context" — hiding it
  // from the Phase B backfill that would otherwise fill it in later.
  const hasAnything =
    wire.fearGreed || wire.coin || wire.btc || wire.topHeadline || wire.briefingHeadline || wire.macroNext;
  if (!hasAnything) return null;

  return {
    marketDate: wire.marketDate,
    slot: wire.slot,
    slotAt: toDate(wire.slotAt),
    capturedAt,
    source: wire.source,
    version: wire.version,
    instrument: wire.instrument,
    fearGreed: wire.fearGreed,
    coin: wire.coin,
    btc: wire.btc,
    topHeadline: wire.topHeadline
      ? { ...wire.topHeadline, publishedAt: toDate(wire.topHeadline.publishedAt) }
      : null,
    briefingHeadline: wire.briefingHeadline,
    briefingSlot: wire.briefingSlot,
    // A calendar day carried as a Date because the store hydrates the key
    // "date" anyway. Render it in UTC — it is a day, not a moment.
    macroNext: wire.macroNext ? { name: wire.macroNext.name, date: new Date(`${wire.macroNext.date}T00:00:00Z`) } : null,
  };
}

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

    const parsed = wireSchema.safeParse(await response.json());
    return parsed.success ? toStored(parsed.data) : null;
  } catch {
    // Timeout, DNS, TLS, bad JSON — all the same answer. The trade still saves.
    return null;
  }
}
