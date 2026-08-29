import { getTradesWithMistakes } from "@/lib/data";
import { formatMoney } from "@/lib/currency";
import { getTradePnl } from "@/lib/metrics";
import { MarketType, TradeStatus } from "@/lib/types";

// One-off tax-reporting query: every CRYPTO_PERP (futures) trade dated before
// a given cutoff, count + net P&L, so the owner can pull FY-boundary numbers
// without a local checkout. Read-only, no writes. Sits behind the
// SITE_PASSWORD gate like every other route (middleware.ts excludes only
// /login and static assets). Delete once the owner is done with tax season.
//
// Usage: /api/tax-summary?before=2026-04-01
// `before` defaults to 2026-04-01 (start of India FY 2026-27) and is
// exclusive — a trade dated exactly on the cutoff is NOT included.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before") ?? "2026-04-01";
  const cutoff = new Date(`${beforeParam}T00:00:00.000Z`);
  if (Number.isNaN(cutoff.getTime())) {
    return new Response(`Bad "before" date: ${beforeParam}. Use YYYY-MM-DD.`, {
      status: 400,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const allTrades = await getTradesWithMistakes();
  const futures = allTrades.filter((t) => t.marketType === MarketType.CRYPTO_PERP);
  const inPeriod = futures.filter((t) => t.tradeDateTime.getTime() < cutoff.getTime());

  const byStatus = new Map<string, number>();
  for (const t of inPeriod) byStatus.set(t.status, (byStatus.get(t.status) ?? 0) + 1);

  const closed = inPeriod.filter((t) => t.status === TradeStatus.CLOSED);
  const baseCurrency = closed[0]?.baseCurrency ?? "INR";
  let baseTotal = 0;
  let baseInexactCount = 0;
  const nativeTotals = new Map<string, number>();
  for (const t of closed) {
    const pnl = getTradePnl(t);
    if (pnl == null) continue;
    baseTotal += pnl;
    if (!t.baseExact) baseInexactCount += 1;
    const native = t.nativeCurrency ?? t.baseCurrency;
    nativeTotals.set(native, (nativeTotals.get(native) ?? 0) + pnl);
  }
  const missingPnl = closed.filter((t) => getTradePnl(t) == null).length;

  const dates = inPeriod.map((t) => t.tradeDateTime.getTime());
  const earliest = dates.length ? new Date(Math.min(...dates)) : null;
  const latest = dates.length ? new Date(Math.max(...dates)) : null;
  const fyStart = new Date("2025-04-01T00:00:00.000Z");
  const spansEarlierFY = earliest != null && earliest.getTime() < fyStart.getTime();

  const lines: string[] = [];
  lines.push(`TradeGenie — futures activity before ${beforeParam} (exclusive)`);
  lines.push("=".repeat(60));
  lines.push("");
  lines.push(`Total CRYPTO_PERP trades in period: ${inPeriod.length}`);
  for (const [status, count] of byStatus) lines.push(`  ${status}: ${count}`);
  lines.push("");
  if (earliest && latest) {
    lines.push(`Date range in this set: ${earliest.toISOString().slice(0, 10)} → ${latest.toISOString().slice(0, 10)}`);
    if (spansEarlierFY) {
      lines.push(
        `NOTE: this set includes trades before ${fyStart.toISOString().slice(0, 10)} (FY 2025-26 start) —`,
      );
      lines.push(`it is NOT limited to a single financial year. Re-run with ?before= to narrow it.`);
    }
  }
  lines.push("");
  lines.push(`Closed trades: ${closed.length}${missingPnl ? ` (${missingPnl} missing a net P&L value)` : ""}`);
  lines.push(`Net P&L (${baseCurrency}): ${formatMoney(baseTotal, baseCurrency, { signed: true })}`);
  if (baseInexactCount > 0) {
    lines.push(`  NOTE: ${baseInexactCount} trade(s) used an approximate FX rate — this total is not exact.`);
  }
  if (nativeTotals.size > 1 || (nativeTotals.size === 1 && !nativeTotals.has(baseCurrency))) {
    lines.push("");
    lines.push("Native-currency breakdown (before conversion):");
    for (const [currency, total] of nativeTotals) {
      lines.push(`  ${currency}: ${formatMoney(total, currency, { signed: true })}`);
    }
  }
  lines.push("");
  lines.push("This covers futures (CRYPTO_PERP) trades only — spot/index/stock excluded.");
  lines.push("This is your own journal data, not an exchange statement — cross-check against");
  lines.push("your CoinDCX statement before filing.");

  return new Response(lines.join("\n"), {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
