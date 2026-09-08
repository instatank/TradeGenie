import { exchangeView } from "@/lib/coindcx-sync";
import {
  checkFills,
  fetchCandles,
  providerSymbol,
  summarizeFillChecks,
  type Attempt,
  type CandleResult,
} from "@/lib/candles";
import type { Fill } from "@/lib/positions";

// Does free third-party candle data actually describe the market you traded?
//
// Everything in the replay/excursion work rests on one assumption that cannot
// be checked from a dev container: that a Binance 1m candle contains the price
// CoinDCX filled you at. If it doesn't, a replay chart would draw your entry in
// the wrong place and every MAE/MFE number derived from it would be wrong in
// the same direction — confidently, and invisibly.
//
// So this doesn't ask "does the endpoint return 200". It takes YOUR most recent
// real positions, fetches the candles covering their fills, and reports whether
// each fill price falls inside the high/low of its own minute. That is the
// actual test, and it can only run where the journal's data lives.
//
// Same shape and same reason as /api/coindcx-probe: this app has no local
// checkout to run a script from, so a question that needs real data becomes a
// route the owner opens in a browser. Delete both once the feature they gated
// has shipped and settled.
//
// No credential of ours goes anywhere: both providers are public market-data
// endpoints, called without keys or cookies. It sits behind SITE_PASSWORD like
// every route, and stays viewer-reachable for the same reason /api/coindcx-probe
// does — it is a diagnostic that exposes nothing a viewer can't already read on
// the trades page.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** How many recent positions to verify. Enough to see a pattern, few enough to
 *  stay inside the function timeout — each one is a separate candle fetch. */
const POSITIONS_TO_CHECK = 5;

/** Context either side of a position, so the fetch covers the fills even when a
 *  position opened and closed inside one minute. */
const PADDING_MS = 30 * 60 * 1000;

export async function GET() {
  const lines: string[] = [];
  const say = (line = "") => lines.push(line);

  say("CANDLE FEED PROBE");
  say("=================");
  say();
  say("The question: can free public candle data be trusted to describe the");
  say("market your CoinDCX fills happened in? If yes, trade replay and real");
  say("MAE/MFE become possible. If no, they don't — and we need to know now.");
  say();

  const view = await exchangeView().catch(() => null);
  const fills = view?.fills ?? [];
  const positions = (view?.positions ?? [])
    .filter((position) => position.fillIds.length > 0)
    .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
    .slice(0, POSITIONS_TO_CHECK);

  // --- 1. reachability ----------------------------------------------------
  say("1. CAN WE REACH THE PROVIDERS AT ALL?");
  say("-------------------------------------");
  say();

  const probeInstrument = positions[0]?.instrument ?? fills[0]?.instrument ?? "BTC";
  const now = Date.now();
  const reach = await fetchCandles({
    instrument: probeInstrument,
    interval: "1m",
    from: new Date(now - 60 * 60 * 1000),
    to: new Date(now),
  });

  say(`Asked for the last hour of 1m candles on ${providerSymbol(probeInstrument)}:`);
  say();
  for (const attempt of reach.attempts) say(`  ${formatAttempt(attempt)}`);
  say();
  say(`  => ${reach.detail}`);
  say();

  if (reach.candles.length > 0) {
    const last = reach.candles[reach.candles.length - 1];
    say(`  Newest candle: ${new Date(last.time * 1000).toISOString()}`);
    say(`  O ${last.open}  H ${last.high}  L ${last.low}  C ${last.close}`);
    say();
  }

  // --- 2. the real test ---------------------------------------------------
  say();
  say("2. DO THOSE CANDLES CONTAIN YOUR ACTUAL FILL PRICES?");
  say("----------------------------------------------------");
  say();

  if (positions.length === 0) {
    say("  No stored exchange positions to check against.");
    say("  Run a sync on /import first, then reload this page — without real");
    say("  fills this probe can only prove the endpoint answers, which is the");
    say("  easy half and not the half that matters.");
  } else {
    const byId = new Map(fills.map((fill) => [fill.id, fill]));

    for (const position of positions) {
      const positionFills = position.fillIds
        .map((id) => byId.get(id))
        .filter((fill): fill is Fill => Boolean(fill))
        .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

      const opened = position.openedAt;
      const closed = position.closedAt ?? new Date(opened.getTime() + PADDING_MS);

      say(
        `  ${position.instrument} ${position.direction} — opened ${opened.toISOString()}` +
          `, ${positionFills.length} fill(s), settled in ${position.currency}`,
      );

      if (positionFills.length === 0) {
        say("    No fills held for this position (stored ids no longer resolve).");
        say();
        continue;
      }

      const result: CandleResult = await fetchCandles({
        instrument: position.instrument,
        interval: "1m",
        from: new Date(opened.getTime() - PADDING_MS),
        to: new Date(closed.getTime() + PADDING_MS),
      });

      if (result.candles.length === 0) {
        say(`    ${result.detail}`);
        say();
        continue;
      }

      const checks = checkFills(positionFills, result.candles, "1m");
      say(`    ${result.candles.length} candles from ${result.source}. ${summarizeFillChecks(checks)}`);

      for (const check of checks) {
        const when = check.at.toISOString().slice(11, 19);
        if (!check.candle) {
          say(`      ${when}  ${check.side.padEnd(4)} @ ${check.price}  — no candle for that minute`);
          continue;
        }
        const verdict = check.inside
          ? "inside"
          : `OUTSIDE by ${((check.deviation ?? 0) * 100).toFixed(4)}%`;
        say(
          `      ${when}  ${check.side.padEnd(4)} @ ${String(check.price).padEnd(12)}` +
            ` candle L ${check.candle.low} / H ${check.candle.high}  → ${verdict}`,
        );
      }
      say();
    }
  }

  // --- 3. what to do with the answer --------------------------------------
  say();
  say("3. HOW TO READ THIS");
  say("-------------------");
  say();
  say("  All fills inside      → the feed is a faithful proxy. Build the replay");
  say("                          and compute MAE/MFE from it with confidence.");
  say("  A few out by <0.05%   → normal venue difference. Fine for a chart and");
  say("                          for excursion stats; worth stating in the UI.");
  say("  Many out, or >0.2%    → the books genuinely disagree. Replay is still");
  say("                          honest as 'roughly what the market did', but");
  say("                          MAE/MFE would be fiction and we should not");
  say("                          compute them from this source.");
  say("  Nothing reachable     → the function region can't reach the provider.");
  say("                          Different problem, different fix.");
  say();

  return new Response(lines.join("\n"), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Never let a CDN hold a copy of someone's fill prices.
      "Cache-Control": "no-store",
    },
  });
}

function formatAttempt(attempt: Attempt): string {
  const head = `${attempt.provider.padEnd(8)} ${String(attempt.status ?? "—").padEnd(4)} ${String(attempt.ms).padStart(5)}ms`;
  return attempt.error ? `${head}  FAILED: ${attempt.error}` : `${head}  ${attempt.candles} candles`;
}
