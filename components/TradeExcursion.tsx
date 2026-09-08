import { AlertTriangle, Flame, MoveUpRight, Timer } from "lucide-react";
import type { ExcursionResult } from "@/lib/excursion";
import type { CandleInterval, ProviderId } from "@/lib/candles";

// "How it played out" — the path between your entry and your exit.
//
// Server-rendered, zero client JS. Everything here is a number the server
// already computed; there is nothing to interact with, so there is no reason to
// ship a kilobyte of JavaScript to show it.
//
// The panel's job is to turn four numbers into four sentences. A trader does
// not need "MAE 0.42R" defined at them — they need "you were 42% of the way to
// your stop before this worked", which is the same fact and is actionable. So
// every stat carries its plain reading, and the reading changes with the value.

export function TradeExcursion({
  excursion,
  interval,
  source,
  fromExchange,
}: {
  excursion: ExcursionResult;
  interval: CandleInterval;
  source: ProviderId;
  fromExchange: boolean;
}) {
  if (!excursion.ok) {
    // A refusal is shown, not hidden. A panel that silently disappears when the
    // data is incomplete teaches you to distrust it when it IS there.
    return (
      <p className="text-sm text-forge-muted">
        {excursion.reason} <span className="text-xs">Nothing is inferred when the candles don&rsquo;t cover the whole trade — a partial window understates the heat.</span>
      </p>
    );
  }

  const { mae, mfe, heatToStop, stopCheck, drift } = excursion;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <Stat
          icon={<Flame className="h-4 w-4 text-forge-red" aria-hidden />}
          label="Heat taken (MAE)"
          value={`${formatPrice(mae.price)}${mae.moveR !== null ? ` · ${mae.moveR.toFixed(2)}R` : ""}`}
          reading={heatReading(heatToStop, mae.movePct)}
        />
        <Stat
          icon={<MoveUpRight className="h-4 w-4 text-forge-green" aria-hidden />}
          label="Best it offered (MFE)"
          value={`${formatPrice(mfe.price)}${mfe.moveR !== null ? ` · ${mfe.moveR.toFixed(2)}R` : ""}`}
          reading={`It ran ${formatPct(mfe.movePct)} your way at best, ${timeOfDay(mfe.at)}.`}
        />
        <Stat
          icon={<AlertTriangle className="h-4 w-4 text-forge-muted" aria-hidden />}
          label="Your stop"
          value={stopLabel(stopCheck)}
          reading={stopReading(stopCheck)}
        />
        {drift ? (
          <Stat
            icon={<Timer className="h-4 w-4 text-forge-blue" aria-hidden />}
            label={`After you left (${formatWindow(drift.windowMinutes)})`}
            value={
              drift.continuationR !== null
                ? `${drift.continuationR > 0 ? "+" : ""}${drift.continuationR.toFixed(2)}R`
                : formatPct(drift.continuationPct)
            }
            reading={driftReading(drift.continuationPct, drift.bestPrice, drift.worstPrice)}
          />
        ) : (
          <Stat
            icon={<Timer className="h-4 w-4 text-forge-muted" aria-hidden />}
            label="After you left"
            value="—"
            reading="This trade is still open, so there is no aftermath yet."
          />
        )}
      </div>

      <p className="text-xs text-forge-muted">
        <strong className="font-medium text-forge-ink">MAE</strong> is the worst price this went to while you held it;{" "}
        <strong className="font-medium text-forge-ink">MFE</strong> is the best. Both are computed here from the
        candles — the boxes of the same name under &ldquo;Objective trade data&rdquo; are yours to override them with,
        and stay empty until you type in one.{" "}
        From {interval} candles on {source === "binance" ? "Binance USD-M futures" : "Bybit"} — a different venue
        from the one that filled you, so wicks can differ slightly.
        {fromExchange
          ? " Excursions include the whole entry and exit candle, so they err wide rather than understating the heat."
          : " This trade has no exchange fills linked, so the entry and exit are the prices you typed."}
      </p>
    </div>
  );
}

function Stat({ icon, label, value, reading }: { icon: React.ReactNode; label: string; value: string; reading: string }) {
  return (
    <div className="rounded-lg border border-forge-line bg-forge-panel p-3">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-forge-muted">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-forge-muted">{reading}</p>
    </div>
  );
}

/** The reading changes with the value, because "you were 95% of the way to your
 *  stop" and "this never went against you" deserve different sentences. */
function heatReading(heatToStop: number | null, movePct: number): string {
  if (heatToStop === null) return `It went ${formatPct(movePct)} against you. Record a stop to see this as a share of your risk.`;
  if (heatToStop === 0) return "It never traded against you at all.";
  if (heatToStop >= 1) return "Price reached your stop while you were in this.";
  if (heatToStop >= 0.8) return `You were ${Math.round(heatToStop * 100)}% of the way to your stop — this nearly didn't survive.`;
  if (heatToStop >= 0.5) return `You were ${Math.round(heatToStop * 100)}% of the way to your stop.`;
  return `Only ${Math.round(heatToStop * 100)}% of your risk was ever used.`;
}

function stopLabel(stopCheck: Extract<ExcursionResult, { ok: true }>["stopCheck"]): string {
  if (stopCheck.kind === "NO_STOP") return "Not recorded";
  return stopCheck.kind === "REACHED" ? "Reached" : "Never reached";
}

function stopReading(stopCheck: Extract<ExcursionResult, { ok: true }>["stopCheck"]): string {
  if (stopCheck.kind === "NO_STOP") return "No stop on this trade, so there is nothing to check it against.";
  if (stopCheck.kind === "REACHED") return `Price traded through it ${timeOfDay(stopCheck.at)}.`;
  // The interesting case: this is how a moved stop, or a venue-only wick,
  // becomes visible instead of staying a private discrepancy.
  return `Price never touched it — closest was ${formatPct(stopCheck.closestBy)} away. If this closed at the stop, either your exchange wicked where this feed didn't, or the stop moved.`;
}

function driftReading(continuationPct: number, bestPrice: number, worstPrice: number): string {
  if (continuationPct <= 0) return `It never traded better than your exit. It went to ${formatPrice(worstPrice)}.`;
  return `It ran on to ${formatPrice(bestPrice)} — ${formatPct(continuationPct)} past your exit — before turning.`;
}

function formatWindow(minutes: number): string {
  return minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
}

/** Prices span 2,400 (ETH) to 79,800 (BTC) to 87.6 (HYPE) in this journal, so a
 *  fixed decimal count is wrong for something. Scale with magnitude. */
function formatPrice(price: number): string {
  const decimals = price >= 1000 ? 1 : price >= 10 ? 3 : 5;
  return price.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function formatPct(fraction: number): string {
  return `${(Math.abs(fraction) * 100).toFixed(2)}%`;
}

function timeOfDay(date: Date): string {
  return `at ${date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" })} IST`;
}
