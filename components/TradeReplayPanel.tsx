import { TradeExcursion } from "@/components/TradeExcursion";
import { TradeReplayChart } from "@/components/TradeReplayChart";
import { getTradeReplay } from "@/lib/trade-replay";
import type { Trade } from "@/lib/types";

// The whole "how it played out" section: the numbers, then the chart.
//
// An async server component on purpose, rendered inside its own <Suspense> on
// the trade page — the same shape as the "Where this runs" panel on /settings.
// Building a replay means a live call to a candle provider (~150-500ms
// measured), and the trade page's job is to show you your trade. It must paint
// immediately and let this arrive when it arrives.
//
// NOTE FOR ANYONE MOVING THIS: it must stay OUTSIDE the page's <form>. The
// trade page is one big form with one Save (see "One button saves the page"),
// and the replay controls are real <button>s — inside the form, pressing Play
// would submit and save the trade. They carry type="button" as well, but the
// placement is the actual guarantee.
export async function TradeReplayPanel({ trade }: { trade: Trade }) {
  const replay = await getTradeReplay(trade);

  if (!replay.ok) {
    return (
      <section className="panel">
        <h2 className="font-semibold">How it played out</h2>
        <p className="mt-2 text-sm text-forge-muted">{replay.reason}</p>
      </section>
    );
  }

  return (
    <section className="panel space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">How it played out</h2>
        <span className="text-xs text-forge-muted">
          {replay.instrument} · {replay.interval} · {replay.candles.length} candles
          {replay.fromExchange ? ` · ${replay.markers.length} mark${replay.markers.length === 1 ? "" : "s"} from your fills` : " · from the prices you typed"}
        </span>
      </div>

      <TradeExcursion
        excursion={replay.excursion}
        interval={replay.interval}
        source={replay.source}
        fromExchange={replay.fromExchange}
      />

      <TradeReplayChart
        candles={replay.candles}
        markers={replay.markers}
        entryPrice={replay.entryPrice}
        stopPrice={replay.stopPrice}
        targetPrice={replay.targetPrice}
        direction={replay.direction}
        instrument={replay.instrument}
        interval={replay.interval}
      />
    </section>
  );
}

/** Shown while the candles are in flight. Sized like the real thing so the page
 *  doesn't jump when it arrives. */
export function TradeReplayPanelSkeleton() {
  return (
    <section className="panel">
      <h2 className="font-semibold">How it played out</h2>
      <p className="mt-2 text-sm text-forge-muted">Fetching the candles for this trade&hellip;</p>
      <div className="mt-4 h-[380px] animate-pulse rounded-lg bg-forge-panel" />
    </section>
  );
}
