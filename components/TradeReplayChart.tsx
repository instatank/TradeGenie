"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, RotateCcw, SkipForward } from "lucide-react";
import type { Candle } from "@/lib/candles";
import { REPLAY_START_OFFSET_BARS, REPLAY_TRAILING_BARS } from "@/lib/replay-shape";
import type { FillMarker } from "@/lib/trade-replay";

// Watching your own trade play out, one candle at a time.
//
// THE FIFTH CLIENT-JS CONTROL, after TagPicker, the calculator, the quick-note
// bar and the screenshot paste field — and for the same kind of reason as the
// calculator: a replay you have to submit is not a replay. Animation and
// scrubbing cannot be expressed as a plain <form>.
//
// It is confined to the trade page and the library is imported INSIDE the
// effect, not at module scope. That means lightweight-charts never evaluates
// during SSR (it touches `document` on construction) and never lands in the
// shared bundle, so every other page in this app stays exactly as light as it
// was before this existed.
//
// HOW THE REVEAL WORKS, and why it is not what you would guess. The obvious
// implementation re-sets the data on every tick — `setData(candles.slice(0, n))`
// — which re-uploads the whole series sixty times a second and makes the price
// axis jump on every frame. Instead the full series is set ONCE and playback
// moves the visible logical range. The chart does the work, the data never
// moves, and the result is a proper scrolling chart rather than a stuttering
// one. Candles ahead of the cursor exist but sit off-screen to the right.
//
// This is playback of a trade you already took, so hiding the future perfectly
// is not the goal — that would be practice mode, which we deliberately did not
// build (TradingView's Bar Replay already does it better).

/** Imported, never redeclared: the FETCH sizes its lead-in off the same number,
 *  and when the two drifted apart the replay opened three-quarters empty with
 *  the trade jammed against the right edge. lib/replay-shape.ts explains why
 *  they live in a module of their own rather than in lib/trade-replay.ts. */
const TRAILING_CANDLES = REPLAY_TRAILING_BARS;

/**
 * Milliseconds per candle at 1×. **One candle per second**, deliberately.
 *
 * The first cut used 220ms, which made 1× run at roughly 4-5 candles a second
 * — fast enough that a 1m chart blurred past and the only controls available
 * made it FASTER. The scale had no slow end at all. 1× now means the literal
 * thing it should: one bar, one second, countable.
 */
const BASE_STEP_MS = 1000;

/** Both directions from 1×. 0.25× is four seconds a candle — slow enough to
 *  watch a single bar form and say out loud what you were thinking. */
const SPEEDS = [0.25, 0.5, 1, 2, 4, 8] as const;

/**
 * The slice of chart to show for a given cursor.
 *
 * `from` is deliberately NOT clamped to zero. Clamping it looks obviously right
 * and is what makes the chart open zoomed to a handful of enormous candles:
 * playback starts near the beginning of the array (the lead-in is only ~45
 * bars), so `max(0, cursor - 90)` collapses the window to whatever is behind
 * the cursor and the bars stretch to fill the width. lightweight-charts accepts
 * a negative logical index and simply draws empty space there, which keeps bar
 * spacing constant from the first frame to the last — the thing that makes it
 * read as a replay rather than as a chart being resized at you.
 *
 * Pure and exported so this is pinned by a test; it was found by measuring the
 * rendered chart, not by reading the code.
 */
export function visibleRange(cursor: number, total: number): { from: number; to: number } {
  const to = Math.max(1, Math.min(cursor, total - 1));
  // A little air on the right so the newest candle isn't jammed against the
  // price axis.
  return { from: to - TRAILING_CANDLES, to: to + 3 };
}

export type TradeReplayChartProps = {
  candles: Candle[];
  markers: FillMarker[];
  entryPrice: number;
  stopPrice: number | null;
  targetPrice: number | null;
  direction: "LONG" | "SHORT";
  instrument: string;
  interval: string;
};

export function TradeReplayChart(props: TradeReplayChartProps) {
  const { candles, markers } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<{ applyRange: (cursor: number) => void; destroy: () => void } | null>(null);

  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);

  /** The candle the first fill lands on — where the interesting part starts. */
  const entryIndex = useMemo(() => {
    if (markers.length === 0) return 0;
    const found = candles.findIndex((candle) => candle.time >= markers[0].time);
    return found < 0 ? 0 : found;
  }, [candles, markers]);

  // --- build the chart once ------------------------------------------------
  useEffect(() => {
    const container = containerRef.current;
    if (!container || candles.length === 0) return;

    let disposed = false;
    let cleanup = () => {};

    (async () => {
      try {
        const { createChart, CandlestickSeries, createSeriesMarkers, ColorType } = await import("lightweight-charts");
        if (disposed || !containerRef.current) return;

        const chart = createChart(containerRef.current, {
          height: 380,
          layout: {
            background: { type: ColorType.Solid, color: "#ffffff" },
            textColor: "#5b6472",
            fontFamily: "inherit",
          },
          grid: {
            vertLines: { color: "#eef1f5" },
            horzLines: { color: "#eef1f5" },
          },
          rightPriceScale: { borderColor: "#e2e6ec" },
          timeScale: { borderColor: "#e2e6ec", timeVisible: true, secondsVisible: false },
          crosshair: { mode: 0 },
          // Pinned, not inherited. Left to the viewer's locale the library
          // formats its axes with the browser default, and a machine whose
          // locale is something like `en_US@posix` makes it throw on every
          // frame — which is exactly what the browser verification caught.
          // These are IST trades in a journal with one reader, so say so.
          localization: { locale: "en-IN" },
        });

        // v5: series are added by DEFINITION, not by a per-type method.
        // `addCandlestickSeries()` was removed — it survives only in the
        // package's own stale doc comments, which is a good way to write code
        // that fails at runtime with a green typecheck.
        const series = chart.addSeries(CandlestickSeries, {
          upColor: "#1a9c6b",
          downColor: "#d6455c",
          borderUpColor: "#1a9c6b",
          borderDownColor: "#d6455c",
          wickUpColor: "#1a9c6b",
          wickDownColor: "#d6455c",
        });

        series.setData(
          candles.map((candle) => ({
            time: candle.time as never,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
          })),
        );

        // The plan, drawn flat across the whole chart: you knew these levels
        // before the first candle, so hiding them until the entry would be a
        // less honest replay, not a more suspenseful one.
        series.createPriceLine({
          price: props.entryPrice,
          color: "#2f6df6",
          lineWidth: 1,
          lineStyle: 2,
          axisLabelVisible: true,
          title: "entry",
        });
        if (props.stopPrice != null) {
          series.createPriceLine({
            price: props.stopPrice,
            color: "#d6455c",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: "stop",
          });
        }
        if (props.targetPrice != null) {
          series.createPriceLine({
            price: props.targetPrice,
            color: "#1a9c6b",
            lineWidth: 1,
            lineStyle: 2,
            axisLabelVisible: true,
            title: "target",
          });
        }

        // v5: markers are a plugin, not a method on the series.
        createSeriesMarkers(
          series,
          markers.map((marker) => ({
            time: marker.time as never,
            position: marker.side === "BUY" ? ("belowBar" as const) : ("aboveBar" as const),
            shape: marker.side === "BUY" ? ("arrowUp" as const) : ("arrowDown" as const),
            color: marker.side === "BUY" ? "#1a9c6b" : "#d6455c",
            text: `${marker.side === "BUY" ? "BUY" : "SELL"} ${formatQty(marker.quantity)}${marker.legs > 1 ? ` ×${marker.legs}` : ""} @ ${formatPrice(marker.price)}`,
          })),
        );

        const applyRange = (position: number) => {
          const { from, to } = visibleRange(position, candles.length);
          chart.timeScale().setVisibleLogicalRange({ from, to });
        };

        const resize = () => chart.applyOptions({ width: containerRef.current?.clientWidth ?? 600 });
        resize();
        window.addEventListener("resize", resize);

        chartRef.current = {
          applyRange,
          destroy: () => {
            window.removeEventListener("resize", resize);
            chart.remove();
          },
        };
        cleanup = () => chartRef.current?.destroy();
        setReady(true);
      } catch (error) {
        // A chart library failing to load must not blank the panel: the
        // excursion numbers above it are the more useful half anyway.
        setFailed(error instanceof Error ? error.message : "The chart could not be loaded.");
      }
    })();

    return () => {
      disposed = true;
      cleanup();
      chartRef.current = null;
    };
    // Built once per trade. The chart owns its own DOM and is torn down whole.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, markers]);

  // Start parked a little before the entry, so pressing play shows the setup
  // forming rather than opening on the fill.
  useEffect(() => {
    if (ready) setCursor(Math.max(1, entryIndex - REPLAY_START_OFFSET_BARS));
  }, [ready, entryIndex]);

  useEffect(() => {
    chartRef.current?.applyRange(cursor);
  }, [cursor, ready]);

  // --- playback ------------------------------------------------------------
  useEffect(() => {
    if (!playing || !ready) return;
    const timer = window.setInterval(() => {
      setCursor((current) => {
        if (current >= candles.length - 1) {
          setPlaying(false);
          return candles.length - 1;
        }
        return current + 1;
      });
    }, BASE_STEP_MS / speed);
    return () => window.clearInterval(timer);
  }, [playing, speed, ready, candles.length]);

  const restart = useCallback(() => {
    setPlaying(false);
    setCursor(Math.max(1, entryIndex - REPLAY_START_OFFSET_BARS));
  }, [entryIndex]);

  const atEnd = cursor >= candles.length - 1;

  if (failed) return <p className="text-sm text-forge-muted">{failed}</p>;

  return (
    <div className="space-y-3">
      <div ref={containerRef} className="w-full overflow-hidden rounded-lg border border-forge-line" />

      {/* type="button" on every one of these is load-bearing: this panel sits
          outside the page's form, but a stray submit button here would still be
          the kind of thing that saves a trade when you press play. */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-secondary" onClick={restart} aria-label="Back to the start">
          <RotateCcw className="h-4 w-4" aria-hidden />
        </button>
        <button
          type="button"
          className="btn-primary min-w-24"
          onClick={() => (atEnd ? restart() : setPlaying((value) => !value))}
          disabled={!ready}
        >
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
          {playing ? "Pause" : atEnd ? "Replay" : "Play"}
        </button>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            setPlaying(false);
            setCursor(candles.length - 1);
          }}
          aria-label="Skip to the end"
        >
          <SkipForward className="h-4 w-4" aria-hidden />
        </button>

        <div className="flex items-center gap-1" role="group" aria-label="Playback speed">
          {SPEEDS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSpeed(option)}
              aria-pressed={speed === option}
              className={`min-h-10 rounded-md border px-2 text-sm ${
                speed === option ? "border-forge-ink bg-forge-ink text-white" : "border-forge-line bg-white text-forge-ink"
              }`}
            >
              {option}&times;
            </button>
          ))}
        </div>

        <span className="ml-auto text-xs tabular-nums text-forge-muted">
          {candleLabel(candles[Math.min(cursor, candles.length - 1)])}
        </span>
      </div>

      <input
        type="range"
        min={1}
        max={Math.max(1, candles.length - 1)}
        value={cursor}
        onChange={(event) => {
          setPlaying(false);
          setCursor(Number(event.target.value));
        }}
        className="w-full accent-forge-blue"
        aria-label="Scrub through the trade"
      />
    </div>
  );
}

function candleLabel(candle: Candle | undefined): string {
  if (!candle) return "";
  return new Date(candle.time * 1000).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Kolkata",
  });
}

function formatPrice(price: number): string {
  const decimals = price >= 1000 ? 1 : price >= 10 ? 3 : 5;
  return price.toLocaleString("en-US", { maximumFractionDigits: decimals });
}

function formatQty(quantity: number): string {
  if (quantity === 0) return "";
  return quantity >= 100 ? quantity.toFixed(0) : quantity.toPrecision(3).replace(/\.?0+$/, "");
}
