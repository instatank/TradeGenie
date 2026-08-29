import { credentialsFromEnv } from "@/lib/coindcx";
import { liveExchangeView } from "@/lib/coindcx-sync";
import { formatMoney, sumInCurrency, type Amount, type Currency } from "@/lib/currency";
import type { ReconstructedPosition } from "@/lib/positions";

// Futures activity for a tax year, read STRAIGHT FROM THE EXCHANGE.
//
// Deliberately not sourced from the journal. The journal holds what the trader
// wrote down — trades they logged, reconciled when they got round to it — and
// for tax the question is what the exchange says happened, whether or not it was
// ever journaled. So this calls the CoinDCX API live, folds fills into
// positions with lib/coindcx-sync's `foldExchange` (the same fold /import uses,
// so the two can never disagree), and stores nothing.
//
// It exists as a route because there is no local checkout to run a script from
// and api.coindcx.com is not reachable from the dev container — the deployment
// is the only machine that can both reach the exchange and hold the credentials.
// Same reasoning as app/api/coindcx-probe/route.ts.
//
// Read-only by construction: `callFutures` refuses any path outside the
// list/history allowlist, and nothing here writes to the store.
//
// Behind the SITE_PASSWORD gate like every other route (middleware.ts excludes
// only /login and static assets).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The Indian financial year runs 1 April → 31 March in IST, so the boundary is
 * 18:30 UTC the day before. This is not pedantry: a trade closed at 02:00 IST on
 * 1 April is 20:30 UTC on 31 March, and a UTC-midnight cutoff would file it in
 * the wrong year.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istMidnight(iso: string): Date {
  return new Date(new Date(`${iso}T00:00:00.000Z`).getTime() - IST_OFFSET_MS);
}

function istDate(date: Date): string {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().replace("T", " ").slice(0, 16);
}

/** A closed position is realized on its CLOSE — that is the taxable event. */
function closedInWindow(position: ReconstructedPosition, from: Date | null, to: Date): boolean {
  if (position.status !== "CLOSED" || !position.closedAt) return false;
  const at = position.closedAt.getTime();
  return at < to.getTime() && (from === null || at >= from.getTime());
}

function totals(positions: ReconstructedPosition[], target: Currency) {
  const pick = (field: "grossPnl" | "fees" | "funding" | "netPnl"): Amount[] =>
    positions.map((position) => ({
      value: position[field],
      currency: position.currency,
      rate: position.moneyRate,
    }));
  return {
    gross: sumInCurrency(pick("grossPnl"), target),
    fees: sumInCurrency(pick("fees"), target),
    funding: sumInCurrency(pick("funding"), target),
    net: sumInCurrency(pick("netPnl"), target),
  };
}

function byWallet(positions: ReconstructedPosition[]): Map<string, ReconstructedPosition[]> {
  const groups = new Map<string, ReconstructedPosition[]>();
  for (const position of positions) {
    const wallet = position.currency || "(unknown)";
    groups.set(wallet, [...(groups.get(wallet) ?? []), position]);
  }
  return groups;
}

function summarize(
  label: string,
  positions: ReconstructedPosition[],
  base: Currency,
  lines: string[],
) {
  lines.push(label);
  lines.push("-".repeat(label.length));
  if (!positions.length) {
    lines.push("  (no closed positions in this window)");
    lines.push("");
    return;
  }

  const wins = positions.filter((position) => position.netPnl > 0).length;
  const losses = positions.filter((position) => position.netPnl < 0).length;
  lines.push(`  Trades (closed positions): ${positions.length}   —   ${wins} up, ${losses} down`);

  const closes = positions.map((position) => position.closedAt!.getTime());
  lines.push(`  Closed between: ${istDate(new Date(Math.min(...closes)))} and ${istDate(new Date(Math.max(...closes)))} IST`);
  lines.push("");

  // Per wallet, in that wallet's own currency — nothing converted, so each line
  // can be checked straight against the CoinDCX statement for that account.
  lines.push("  Per margin account, in its own currency (directly checkable against CoinDCX):");
  for (const [wallet, group] of byWallet(positions)) {
    const gross = group.reduce((sum, position) => sum + position.grossPnl, 0);
    const fees = group.reduce((sum, position) => sum + position.fees, 0);
    const funding = group.reduce((sum, position) => sum + position.funding, 0);
    const net = group.reduce((sum, position) => sum + position.netPnl, 0);
    lines.push(`    ${wallet} account — ${group.length} trade${group.length === 1 ? "" : "s"}`);
    lines.push(`      Gross P&L : ${formatMoney(gross, wallet, { signed: true })}`);
    lines.push(`      Fees      : ${formatMoney(-fees, wallet, { signed: true })}`);
    lines.push(`      Funding   : ${formatMoney(funding, wallet, { signed: true })}`);
    lines.push(`      NET P&L   : ${formatMoney(net, wallet, { signed: true })}`);
  }
  lines.push("");

  // And combined, at the rate the exchange itself stamped on each trade.
  const combined = totals(positions, base);
  lines.push(`  Combined, converted to ${base} at the exchange's own recorded rates:`);
  lines.push(`      Gross P&L : ${formatMoney(combined.gross.value, base, { signed: true })}`);
  lines.push(`      Fees      : ${formatMoney(-combined.fees.value, base, { signed: true })}`);
  lines.push(`      Funding   : ${formatMoney(combined.funding.value, base, { signed: true })}`);
  lines.push(`      NET P&L   : ${formatMoney(combined.net.value, base, { signed: true })}`);
  if (!combined.net.exact) {
    lines.push(`      NOTE: at least one trade had no recorded FX rate, so a flat 100:1 stood in.`);
    lines.push(`            This combined figure is approximate; the per-account figures above are not.`);
  }
  if (combined.net.dropped > 0) {
    lines.push(`      WARNING: ${combined.net.dropped} trade(s) could not be converted at all and are MISSING from the combined figure.`);
  }
  lines.push("");
}

export async function GET(request: Request) {
  const credentials = credentialsFromEnv();
  if (!credentials) {
    return text(
      [
        "No CoinDCX credentials on the server.",
        "",
        "Set both of these in Vercel → trade-genie → Settings → Environment Variables,",
        "then redeploy:",
        "",
        "  COINDCX_API_KEY",
        "  COINDCX_API_SECRET",
        "",
        "Use a READ-ONLY key. This never needs trade or withdrawal permission.",
      ].join("\n"),
      400,
    );
  }

  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before") ?? "2026-04-01";
  const base = (url.searchParams.get("base") ?? "INR").toUpperCase() === "USDT" ? "USDT" : "INR";
  const wantDetail = url.searchParams.get("detail") === "1";

  const cutoff = istMidnight(beforeParam);
  if (Number.isNaN(cutoff.getTime())) {
    return text(`Bad "before" date: ${beforeParam}. Use YYYY-MM-DD.`, 400);
  }
  // The financial year immediately before the cutoff, on the Indian Apr–Mar year.
  const fyStart = istMidnight(`${Number(beforeParam.slice(0, 4)) - 1}-04-01`);

  const view = await liveExchangeView(credentials);

  const lines: string[] = [];
  lines.push("FUTURES TRADING SUMMARY — pulled live from the CoinDCX API");
  lines.push("=".repeat(70));
  lines.push(`Generated : ${istDate(new Date())} IST`);
  lines.push(`Cutoff    : everything CLOSED before ${beforeParam} 00:00 IST`);
  lines.push(`Source    : CoinDCX futures /trades + /positions/transactions (read-only)`);
  lines.push(`Fetched   : ${view.fillsSeen} fills, ${view.ledgerSeen} ledger rows`);
  lines.push("");

  // Anything that makes the numbers below untrustworthy goes FIRST, not in a
  // footnote. A tax figure that is quietly a floor is worse than no figure.
  if (view.incomplete) {
    lines.push("!! INCOMPLETE HISTORY — DO NOT FILE THESE NUMBERS !!");
    lines.push(`   ${view.incomplete}`);
    lines.push("   The exchange did not return the full history, so every total below is a");
    lines.push("   floor rather than an answer. Re-run; if it persists, say so and I'll dig in.");
    lines.push("");
  }
  if (view.unusable > 0) {
    lines.push(`!! ${view.unusable} row(s) from the exchange could not be parsed and are excluded.`);
    lines.push("");
  }
  if (view.unknownStages.length) {
    lines.push(`!! Unrecognised ledger stage(s): ${view.unknownStages.join(", ")}.`);
    lines.push("   These were not counted as funding or as realized P&L. Worth a look.");
    lines.push("");
  }

  const closedBeforeCutoff = view.positions.filter((position) => closedInWindow(position, null, cutoff));
  const closedInFy = view.positions.filter((position) => closedInWindow(position, fyStart, cutoff));

  // The two readings of "prior to April 1", answered together rather than
  // guessed at: everything before the cutoff, and the Apr–Mar year before it.
  summarize(`ALL futures activity closed before ${beforeParam} (IST)`, closedBeforeCutoff, base, lines);
  summarize(
    `Of which — financial year ${fyStart.getUTCFullYear()}-${String(Number(beforeParam.slice(0, 4))).slice(2)} (1 Apr ${fyStart.getUTCFullYear()} → 31 Mar ${beforeParam.slice(0, 4)}, IST)`,
    closedInFy,
    base,
    lines,
  );

  if (closedBeforeCutoff.length === closedInFy.length && closedBeforeCutoff.length > 0) {
    lines.push("(The two sets above are identical — there is no closed activity before");
    lines.push(` 1 Apr ${fyStart.getUTCFullYear()}, so \"everything prior to April 1\" and \"the previous FY\" are the same set.)`);
    lines.push("");
  }

  // Things that are NOT in the totals, named rather than left invisible.
  lines.push("WHAT IS NOT IN THE ABOVE");
  lines.push("-".repeat(24));

  const straddlers = view.positions.filter(
    (position) =>
      position.openedAt.getTime() < cutoff.getTime() &&
      (position.closedAt === null || position.closedAt.getTime() >= cutoff.getTime()),
  );
  if (straddlers.length) {
    lines.push(`  ${straddlers.length} position(s) opened before the cutoff but closed on or after it`);
    lines.push("  (or still open). Realization happens on the close, so these belong to the");
    lines.push("  NEXT financial year, not this one:");
    for (const position of straddlers) {
      const closed = position.closedAt ? `closed ${istDate(position.closedAt)}` : "STILL OPEN";
      lines.push(`    ${position.instrument} ${position.direction} (${position.currency}) — opened ${istDate(position.openedAt)}, ${closed}`);
    }
  } else {
    lines.push("  No positions straddle the cutoff — nothing opened before it is still unrealized.");
  }
  lines.push("");

  // The one known, unfixable gap in the data, stated plainly.
  if (view.ledgerFrom) {
    const affected = view.positionsMissingFunding.filter((position) => closedInWindow(position, null, cutoff));
    lines.push(`  CoinDCX's transaction ledger only reaches back to ${istDate(view.ledgerFrom)} IST,`);
    lines.push("  while fills reach back further. Funding charged before that is not retrievable");
    lines.push("  from the exchange at all.");
    if (affected.length) {
      lines.push(`  ${affected.length} of the ${closedBeforeCutoff.length} trades in the main total sit in that window,`);
      lines.push("  so their fees are exact but their funding reads as zero — meaning the NET");
      lines.push("  figure above very slightly UNDERSTATES costs (i.e. overstates profit).");
    } else {
      lines.push("  No trade in the totals above falls in that window, so funding is complete.");
    }
  }
  if (view.unattributedFunding.length) {
    lines.push(`  ${view.unattributedFunding.length} funding payment(s) matched no open position and are excluded.`);
  }
  lines.push("");

  if (wantDetail) {
    lines.push("EVERY CLOSED TRADE BEFORE THE CUTOFF");
    lines.push("-".repeat(36));
    lines.push("  opened (IST)      closed (IST)      symbol  dir    qty          entry → exit        net");
    for (const position of [...closedBeforeCutoff].sort((a, b) => a.closedAt!.getTime() - b.closedAt!.getTime())) {
      lines.push(
        `  ${istDate(position.openedAt)}  ${istDate(position.closedAt!)}  ` +
          `${position.instrument.padEnd(6)}  ${position.direction.padEnd(5)}  ` +
          `${String(position.quantity).padEnd(11)}  ` +
          `${position.entryPrice.toFixed(4)} → ${(position.exitPrice ?? 0).toFixed(4)}  ` +
          `${formatMoney(position.netPnl, position.currency, { signed: true })}`,
      );
    }
    lines.push("");
  } else {
    lines.push("Add ?detail=1 to this URL for the itemised trade-by-trade list.");
    lines.push("Add &base=USDT to see combined totals in USDT instead of INR.");
    lines.push("");
  }

  lines.push("=".repeat(70));
  lines.push("These are the exchange's own numbers, folded into positions — not the");
  lines.push("journal's records. A 'trade' here is one position: from first unit opened to");
  lines.push("last unit closed, with every scale-in, fee and funding payment folded in.");
  lines.push("Cross-check against your CoinDCX statement before filing.");

  return text(lines.join("\n"));
}

function text(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Trade history must never sit in a CDN cache.
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
