// Historical price candles — the one thing the journal has never had.
//
// Every number in this app until now has been YOUR data: your fills, your
// words, your review. Nothing knew what the market did between your entry and
// your exit. That gap is why the journal can tell you a trade lost money and
// not whether the stop was too tight, how much heat you took before it worked,
// or where price went the minute after you bailed.
//
// This module fetches that missing half. Three rules govern it:
//
// 1. **NEVER LOAD-BEARING.** Same rule as the SignalDesk bridge and the AI
//    path. Nothing here is on a save path, every failure returns a reason
//    instead of throwing, and a page that uses candles must render fine with
//    `candles: []` and a sentence saying why. If the feed being down could ever
//    stop a trade being logged or a page being read, the change is wrong.
//
// 2. **CANDLES ARE NOT JOURNAL DATA.** They are public facts we can re-fetch
//    forever, which makes them the one thing in this app that is genuinely
//    disposable. Measured: a 1m candle is ~70 bytes of JSON, so one 4-hour
//    trade with context is ~30KB and 500 trades would be ~15MB — against a
//    journal that is currently single-digit MB and gets committed whole to a
//    git repo every week. So candles must NEVER enter `buildSnapshot()`, never
//    be stored on a Trade, and never appear in a backup. Fetch on view, cache
//    if it drags, and treat the cache as throwaway.
//
// 3. **STORE-FREE, LIKE lib/positions.ts.** This file knows the wire format of
//    a candle provider and nothing about Firestore, trades or settings. That is
//    what lets the probe route, the replay page and a future excursion
//    calculator all share it without dragging the store into each other.
//
// WHY A THIRD-PARTY FEED AT ALL. CoinDCX's futures book is where the fills
// happened, but its candle API for futures pairs is undocumented (docs.coindcx
// .com is JS-rendered and unreadable by tooling — the same wall the exchange
// import hit). Binance USD-M futures is free, keyless, and reaches back years
// at 1m. It is a *proxy*: the same asset on a deeper book, so the shape is the
// shape you were reading, but individual wicks can differ. `checkFills()` below
// exists to measure exactly how much they differ against real fills rather than
// letting us assume.

/** One candle. `time` is epoch SECONDS at the open — seconds because that is
 *  what TradingView's lightweight-charts takes, and converting once here beats
 *  converting at every call site. */
export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

/** The chart timeframes the journal already speaks (`tradeTimeframe` options). */
export type CandleInterval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export const CANDLE_INTERVALS: CandleInterval[] = ["1m", "5m", "15m", "1h", "4h", "1d"];

export const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

/** Generous compared to the 2s the save-path SignalDesk call gets: this is on a
 *  view path where a slow chart is an annoyance, not a lost trade. */
const REQUEST_TIMEOUT_MS = 8_000;

/** Hard stop on paging, for the same reason lib/coindcx-sync.ts has one: a bug
 *  in a stop condition must not be able to spin against someone else's API
 *  forever. 20 pages of 1500 is 30,000 candles — 20 days of 1m data. */
const MAX_PAGES = 20;

/** Between pages, so a long backfill can't trip a rate limit. */
const PAGE_PAUSE_MS = 120;

// --- providers ------------------------------------------------------------
// Two, deliberately. Binance is the primary because it is the deepest book and
// the longest history; Bybit exists so that a single provider having a bad day
// (or geo-blocking the function region) degrades to a second opinion rather
// than to nothing. Both are public market-data endpoints: no key, no account,
// no credential of ours ever leaves the server for either.

export type ProviderId = "binance" | "bybit";

type Provider = {
  id: ProviderId;
  label: string;
  /** Journal symbol (`SOL`) → the provider's symbol (`SOLUSDT`). */
  symbolFor: (instrument: string) => string;
  /** null when the provider cannot serve this interval. */
  intervalFor: (interval: CandleInterval) => string | null;
  maxPerRequest: number;
  url: (symbol: string, interval: string, startMs: number, endMs: number, limit: number) => string;
  parse: (body: unknown) => Candle[];
};

/**
 * `B-SOL_USDT` is already normalized to `SOL` by lib/coindcx.ts before it
 * reaches the journal, so what arrives here is a bare base symbol. Both
 * providers name their USDT perpetuals `<BASE>USDT`.
 *
 * Uppercased and stripped of anything a hand-typed instrument might carry (a
 * `/`, a `-PERP` suffix, whitespace) because the quick log lets you type a
 * symbol freehand — `sol` and `SOL/USDT` must not become two different lookups.
 */
export function providerSymbol(instrument: string): string {
  const bare = instrument
    .trim()
    .toUpperCase()
    .replace(/^B-/, "")
    .replace(/[\s/_-]/g, "")
    .replace(/PERP$/, "")
    .replace(/USDT$/, "");
  return bare ? `${bare}USDT` : "";
}

const binance: Provider = {
  id: "binance",
  label: "Binance USD-M futures",
  symbolFor: providerSymbol,
  intervalFor: (interval) => interval,
  maxPerRequest: 1500,
  url: (symbol, interval, startMs, endMs, limit) =>
    `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}` +
    `&startTime=${startMs}&endTime=${endMs}&limit=${limit}`,
  // [openTime, open, high, low, close, volume, closeTime, ...] — positional,
  // which is why this is pinned by a fixture test rather than trusted.
  parse: (body) => {
    if (!Array.isArray(body)) return [];
    return body.flatMap((row) => {
      if (!Array.isArray(row) || row.length < 6) return [];
      const candle = toCandle(row[0], row[1], row[2], row[3], row[4], row[5]);
      return candle ? [candle] : [];
    });
  },
};

const bybit: Provider = {
  id: "bybit",
  label: "Bybit linear perpetuals",
  symbolFor: providerSymbol,
  intervalFor: (interval) =>
    ({ "1m": "1", "5m": "5", "15m": "15", "1h": "60", "4h": "240", "1d": "D" })[interval] ?? null,
  maxPerRequest: 1000,
  url: (symbol, interval, startMs, endMs, limit) =>
    `https://api.bybit.com/v5/market/kline?category=linear&symbol=${symbol}` +
    `&interval=${interval}&start=${startMs}&end=${endMs}&limit=${limit}`,
  // result.list = [[startMs, open, high, low, close, volume, turnover], …],
  // NEWEST FIRST — the opposite of Binance. sortCandles() below is what stops
  // that difference reaching any caller.
  parse: (body) => {
    const list = (body as { result?: { list?: unknown } } | null)?.result?.list;
    if (!Array.isArray(list)) return [];
    return list.flatMap((row) => {
      if (!Array.isArray(row) || row.length < 6) return [];
      const candle = toCandle(row[0], row[1], row[2], row[3], row[4], row[5]);
      return candle ? [candle] : [];
    });
  },
};

export const PROVIDERS: Provider[] = [binance, bybit];

/**
 * Both providers hand back numbers as strings, and a malformed row must drop
 * out rather than poison a chart with NaN. Returns null for anything that
 * isn't a complete, finite candle.
 */
function toCandle(t: unknown, o: unknown, h: unknown, l: unknown, c: unknown, v: unknown): Candle | null {
  const ms = Number(t);
  const open = Number(o);
  const high = Number(h);
  const low = Number(l);
  const close = Number(c);
  const volume = Number(v);
  if (![ms, open, high, low, close].every(Number.isFinite)) return null;
  return {
    time: Math.floor(ms / 1000),
    open,
    high,
    low,
    close,
    volume: Number.isFinite(volume) ? volume : 0,
  };
}

/** Oldest first, duplicates dropped. Paging overlaps at the boundary and Bybit
 *  returns newest-first, so both need fixing before a caller sees them.
 *  Exported only so a test can pin that invariant without a network call. */
export function sortCandles(candles: Candle[]): Candle[] {
  const byTime = new Map<number, Candle>();
  for (const candle of candles) byTime.set(candle.time, candle);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

// --- fetching -------------------------------------------------------------

export type CandleRequest = {
  /** Journal instrument, e.g. "SOL". */
  instrument: string;
  interval: CandleInterval;
  from: Date;
  to: Date;
  /** Try this one first; the other is still used as a fallback. */
  prefer?: ProviderId;
};

export type CandleResult = {
  candles: Candle[];
  /** Which provider actually served them; null when none did. */
  source: ProviderId | null;
  /** Plain English, always set when candles is empty. Shown to the trader — a
   *  chart that is blank for an unstated reason reads as a broken page. */
  detail: string;
  /** What each provider was asked and what came back. The probe renders this;
   *  a normal page ignores it. */
  attempts: Attempt[];
};

export type Attempt = {
  provider: ProviderId;
  label: string;
  url: string;
  status: number | null;
  candles: number;
  ms: number;
  error?: string;
};

/**
 * Candles for a window, from whichever provider answers first.
 *
 * Never throws. An unreachable host, a rate limit, a symbol that doesn't exist
 * on that exchange and a garbage body all come back the same way: empty
 * candles and a reason.
 */
export async function fetchCandles(request: CandleRequest): Promise<CandleResult> {
  const attempts: Attempt[] = [];
  const symbol = providerSymbol(request.instrument);

  if (!symbol) {
    return { candles: [], source: null, detail: `No usable symbol from "${request.instrument}".`, attempts };
  }

  const ordered = request.prefer
    ? [...PROVIDERS].sort((a, b) => (a.id === request.prefer ? -1 : b.id === request.prefer ? 1 : 0))
    : PROVIDERS;

  for (const provider of ordered) {
    const providerInterval = provider.intervalFor(request.interval);
    if (!providerInterval) continue;

    const { candles, providerAttempts } = await fetchFromProvider(provider, symbol, providerInterval, request);
    attempts.push(...providerAttempts);

    if (candles.length > 0) {
      return {
        candles,
        source: provider.id,
        detail: `${candles.length} ${request.interval} candles for ${symbol} from ${provider.label}.`,
        attempts,
      };
    }
  }

  const reason = attempts.find((attempt) => attempt.error)?.error;
  return {
    candles: [],
    source: null,
    detail: reason
      ? `No candles for ${symbol}: ${reason}`
      : `No candles for ${symbol} — every provider answered, none had data for that window.`,
    attempts,
  };
}

async function fetchFromProvider(
  provider: Provider,
  symbol: string,
  providerInterval: string,
  request: CandleRequest,
): Promise<{ candles: Candle[]; providerAttempts: Attempt[] }> {
  const providerAttempts: Attempt[] = [];
  const step = INTERVAL_MS[request.interval];
  const endMs = request.to.getTime();
  let cursor = request.from.getTime();
  let collected: Candle[] = [];

  for (let page = 0; page < MAX_PAGES && cursor < endMs; page += 1) {
    const wanted = Math.min(provider.maxPerRequest, Math.ceil((endMs - cursor) / step) + 1);
    const url = provider.url(symbol, providerInterval, cursor, endMs, wanted);
    const attempt = await callProvider(provider, url);
    providerAttempts.push(attempt.record);

    if (attempt.candles.length === 0) break;

    collected = collected.concat(attempt.candles);
    const newest = Math.max(...attempt.candles.map((candle) => candle.time)) * 1000;

    // The next page must start strictly after the newest candle we hold, or a
    // provider that clamps to its own limit would return the same page forever.
    const next = newest + step;
    if (next <= cursor) break;
    cursor = next;

    if (attempt.candles.length < wanted) break;
    if (cursor < endMs) await pause(PAGE_PAUSE_MS);
  }

  return { candles: sortCandles(collected), providerAttempts };
}

async function callProvider(provider: Provider, url: string): Promise<{ candles: Candle[]; record: Attempt }> {
  const started = Date.now();
  const base: Attempt = { provider: provider.id, label: provider.label, url, status: null, candles: 0, ms: 0 };

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Public market data. Explicitly no credentials, no cookies, nothing of
      // ours on the wire — this is the one place the app talks to a host it
      // has no relationship with.
      headers: { accept: "application/json" },
      cache: "no-store",
    });

    const ms = Date.now() - started;
    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 200);
      return {
        candles: [],
        record: { ...base, status: response.status, ms, error: `HTTP ${response.status}${body ? ` — ${body}` : ""}` },
      };
    }

    const parsed = provider.parse(await response.json());
    return { candles: parsed, record: { ...base, status: response.status, ms, candles: parsed.length } };
  } catch (error) {
    return {
      candles: [],
      record: { ...base, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) },
    };
  }
}

function pause(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- verification ---------------------------------------------------------

/**
 * Does a third-party candle actually contain the price you were filled at?
 *
 * THIS IS THE QUESTION THE WHOLE FEATURE RESTS ON. Binance candles are a proxy
 * for CoinDCX's book — a different venue, a different order flow — and if your
 * fill at 104.80 sits outside that minute's high/low, then a replay drawing
 * your entry on that chart is drawing a lie, and every excursion number derived
 * from it (MAE, MFE, "was the stop really hit") is wrong in the same direction.
 *
 * So rather than assuming the two agree, this measures it against real fills.
 * A fill inside the candle's range is exact agreement. Outside it, the
 * deviation is reported as a fraction of the fill price, because "0.02% out" is
 * a judgement a trader can make and "0.021 out" is not.
 */
export type FillCheck = {
  at: Date;
  price: number;
  side: string;
  /** The candle covering that instant, if the feed had one. */
  candle: Candle | null;
  inside: boolean;
  /** How far outside the candle's range the fill sat, as a fraction of the fill
   *  price. 0 when inside, null when there was no candle to compare against. */
  deviation: number | null;
};

export function checkFills(
  fills: Array<{ timestamp: Date; price: number; side: string }>,
  candles: Candle[],
  interval: CandleInterval,
): FillCheck[] {
  const step = INTERVAL_MS[interval] / 1000;
  const byTime = new Map(candles.map((candle) => [candle.time, candle]));

  return fills.map((fill) => {
    // Floor to the candle's own open, which is how every provider buckets them.
    const bucket = Math.floor(fill.timestamp.getTime() / 1000 / step) * step;
    const candle = byTime.get(bucket) ?? null;

    const base = { at: fill.timestamp, price: fill.price, side: fill.side };

    if (!candle) return { ...base, candle: null, inside: false, deviation: null };

    const inside = fill.price >= candle.low && fill.price <= candle.high;
    const outBy = inside ? 0 : fill.price > candle.high ? fill.price - candle.high : candle.low - fill.price;

    return { ...base, candle, inside, deviation: fill.price === 0 ? null : outBy / fill.price };
  });
}

/** One line a human can act on, rather than a table they have to read. */
export function summarizeFillChecks(checks: FillCheck[]): string {
  const compared = checks.filter((check) => check.candle !== null);
  if (compared.length === 0) return "No fills could be compared — no candles covered those minutes.";

  const inside = compared.filter((check) => check.inside).length;
  const deviations = compared
    .filter((check) => !check.inside && check.deviation !== null)
    .map((check) => check.deviation as number);
  const worst = deviations.length > 0 ? Math.max(...deviations) : 0;

  return (
    `${inside}/${compared.length} fills fell inside the candle for their minute. ` +
    (deviations.length === 0
      ? "Every fill matched the feed exactly."
      : `Worst miss: ${(worst * 100).toFixed(3)}% off the candle's range.`)
  );
}
