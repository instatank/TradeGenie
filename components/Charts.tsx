// Server-rendered SVG charts — zero client JS, consistent with the rest of the
// app. Quiet marks (2px lines, thin columns, hairline grid), selective direct
// labels, native <title> tooltips on hover. Palette: forge blue for identity,
// green/red only where polarity IS the message (P&L, R) — validated for CVD
// separation and contrast against the white panel surface.

const INK = "#1b1f23";
const MUTED = "#65717c";
const GRID = "#e7ecef";
const BASELINE = "#c3ccd3";
const BLUE = "#1f6feb";
const BLUE_TRACK = "#d8e6fb";
const GREEN = "#0d8f72";
const RED = "#c2413d";
// Gold pairs with blue for the two-series discipline chart — validated:
// CVD ΔE 31.4 (protan) / normal 34.0 against #1f6feb on white, all checks pass.
const GOLD = "#b98318";

export type SeriesPoint = { label: string; value: number };

function formatCompact(value: number) {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(0)}K`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("en-IN", { maximumFractionDigits: abs < 10 ? 1 : 0 });
}

// Clean tick values: 0 is always one of them when the range crosses it.
function niceTicks(min: number, max: number) {
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / 2;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rawStep) ?? rawStep;
  const ticks: number[] = [];
  for (let tick = Math.ceil(min / step) * step; tick <= max + 1e-9; tick += step) {
    ticks.push(Math.abs(tick) < 1e-9 ? 0 : tick);
  }
  return ticks;
}

export function EmptyChart({ text }: { text: string }) {
  return (
    <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-forge-line px-4 text-center text-sm text-forge-muted">
      {text}
    </div>
  );
}

/** Cumulative P&L line with a soft area wash, endpoint dot + value, 0-baseline. */
export function EquityCurve({ points, title, width = 560 }: { points: SeriesPoint[]; title: string; width?: number }) {
  if (points.length < 2) {
    return <EmptyChart text="Your equity curve appears after a couple of closed trades with P&L filled in." />;
  }
  // Wider panels pass a wider viewBox so label text keeps its on-screen size.
  const W = width;
  const H = 168;
  const pad = { top: 16, right: 56, bottom: 20, left: 8 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const values = points.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (index: number) => pad.left + (index / (points.length - 1)) * innerW;
  const y = (value: number) => pad.top + ((max - value) / span) * innerH;
  const linePath = points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(point.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const last = points[points.length - 1];
  const endColor = last.value >= 0 ? GREEN : RED;
  const ticks = niceTicks(min, max);

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? BASELINE : GRID} strokeWidth={1} />
            <text x={W - pad.right + 6} y={y(tick) + 3} fontSize={10} fill={MUTED}>{formatCompact(tick)}</text>
          </g>
        ))}
        <path d={areaPath} fill={BLUE} opacity={0.08} />
        <path d={linePath} fill="none" stroke={BLUE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(points.length - 1)} cy={y(last.value)} r={4.5} fill={BLUE} stroke="#ffffff" strokeWidth={2} />
        <text x={x(points.length - 1)} y={y(last.value) - 9} fontSize={11} fontWeight={600} fill={endColor} textAnchor="end">
          {last.value >= 0 ? "+" : ""}{formatCompact(last.value)}
        </text>
        <text x={pad.left} y={H - 6} fontSize={10} fill={MUTED}>{points[0].label}</text>
        <text x={W - pad.right} y={H - 6} fontSize={10} fill={MUTED} textAnchor="end">{last.label}</text>
        {points.map((point, index) => (
          <circle key={index} cx={x(index)} cy={y(point.value)} r={10} fill="transparent">
            <title>{`${point.label} · running total ${formatCompact(point.value)}`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}

export type DualPoint = { label: string; actual: number; plan: number };

/**
 * Two cumulative lines: what actually happened (solid blue) vs the plan-following
 * counterfactual (dashed gold — dashing marks it as hypothetical). Legend + direct
 * endpoint labels, so identity never rides on colour alone.
 */
export function DisciplineLines({
  points,
  title,
  actualLabel = "What you made",
  planLabel = "If you'd followed the plan",
  width = 560,
}: {
  points: DualPoint[];
  title: string;
  actualLabel?: string;
  planLabel?: string;
  width?: number;
}) {
  if (points.length < 2) {
    return <EmptyChart text="This chart appears after a couple of closed trades with P&L filled in." />;
  }
  const W = width;
  const H = 180;
  const pad = { top: 18, right: 64, bottom: 20, left: 8 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const values = points.flatMap((point) => [point.actual, point.plan]);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const span = max - min || 1;
  const x = (index: number) => pad.left + (index / (points.length - 1)) * innerW;
  const y = (value: number) => pad.top + ((max - value) / span) * innerH;
  const path = (pick: (point: DualPoint) => number) =>
    points.map((point, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(pick(point)).toFixed(1)}`).join(" ");
  const actualPath = path((point) => point.actual);
  const planPath = path((point) => point.plan);
  const areaPath = `${actualPath} L${x(points.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const last = points[points.length - 1];
  const ticks = niceTicks(min, max);
  const endX = x(points.length - 1);
  // Endpoint labels: keep them apart when the lines end close together.
  const yActual = y(last.actual);
  const yPlan = y(last.plan);
  let labelYActual = yActual - 8;
  let labelYPlan = yPlan - 8;
  if (Math.abs(yActual - yPlan) < 16) {
    if (yPlan <= yActual) {
      labelYPlan = yPlan - 8;
      labelYActual = yActual + 15;
    } else {
      labelYActual = yActual - 8;
      labelYPlan = yPlan + 15;
    }
  }

  return (
    <figure className="m-0">
      <div className="mb-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-forge-muted">
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke={BLUE} strokeWidth="2" /></svg>
          {actualLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="18" height="6" aria-hidden="true"><line x1="0" y1="3" x2="18" y2="3" stroke={GOLD} strokeWidth="2" strokeDasharray="4 3" /></svg>
          {planLabel}
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={W - pad.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? BASELINE : GRID} strokeWidth={1} />
            <text x={W - pad.right + 6} y={y(tick) + 3} fontSize={10} fill={MUTED}>{formatCompact(tick)}</text>
          </g>
        ))}
        <path d={areaPath} fill={BLUE} opacity={0.08} />
        <path d={planPath} fill="none" stroke={GOLD} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />
        <path d={actualPath} fill="none" stroke={BLUE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={endX} cy={yPlan} r={4} fill={GOLD} stroke="#ffffff" strokeWidth={2} />
        <circle cx={endX} cy={yActual} r={4.5} fill={BLUE} stroke="#ffffff" strokeWidth={2} />
        <text x={endX} y={labelYActual} fontSize={11} fontWeight={600} fill={INK} textAnchor="end">
          {last.actual >= 0 ? "+" : ""}{formatCompact(last.actual)}
        </text>
        <text x={endX} y={labelYPlan} fontSize={11} fontWeight={600} fill={MUTED} textAnchor="end">
          {last.plan >= 0 ? "+" : ""}{formatCompact(last.plan)} plan
        </text>
        <text x={pad.left} y={H - 6} fontSize={10} fill={MUTED}>{points[0].label}</text>
        <text x={W - pad.right} y={H - 6} fontSize={10} fill={MUTED} textAnchor="end">{last.label}</text>
        {points.map((point, index) => (
          <circle key={index} cx={x(index)} cy={y(point.actual)} r={10} fill="transparent">
            <title>{`${point.label} · actual ${formatCompact(point.actual)} · plan ${formatCompact(point.plan)}`}</title>
          </circle>
        ))}
      </svg>
    </figure>
  );
}

export type ColumnDatum = { label: string; value: number; tooltip: string };

// Column with a 4px-rounded data end and a square base at the zero line.
function columnPath(left: number, base: number, end: number, width: number) {
  const r = Math.min(4, width / 2, Math.abs(base - end));
  if (end < base) {
    // grows upward
    return `M${left},${base} L${left},${end + r} Q${left},${end} ${left + r},${end} L${left + width - r},${end} Q${left + width},${end} ${left + width},${end + r} L${left + width},${base} Z`;
  }
  return `M${left},${base} L${left},${end - r} Q${left},${end} ${left + r},${end} L${left + width - r},${end} Q${left + width},${end} ${left + width},${end - r} L${left + width},${base} Z`;
}

/** Per-trade outcome columns around a zero baseline — green above, red below. */
export function DivergingColumns({ items, unit, ariaLabel }: { items: ColumnDatum[]; unit: string; ariaLabel: string }) {
  if (!items.length) {
    return <EmptyChart text="Closed trades show up here as green and red bars — one per trade." />;
  }
  const H = 150;
  const pad = { top: 20, bottom: 20 };
  const gap = 3;
  const barWidth = Math.min(22, Math.max(10, Math.floor(280 / items.length) - gap));
  const W = items.length * (barWidth + gap) + gap;
  const innerH = H - pad.top - pad.bottom;
  const maxAbs = Math.max(...items.map((item) => Math.abs(item.value))) || 1;
  const positives = items.some((item) => item.value > 0);
  const negatives = items.some((item) => item.value < 0);
  const upShare = positives && negatives ? Math.max(...items.map((i) => Math.max(i.value, 0))) / maxAbs : positives ? 1 : 0;
  const downShare = positives && negatives ? Math.max(...items.map((i) => Math.max(-i.value, 0))) / maxAbs : negatives ? 1 : 0;
  const scale = innerH / (upShare + downShare || 1) / maxAbs;
  const baseY = pad.top + upShare * maxAbs * scale;
  const best = items.reduce((a, b) => (b.value > a.value ? b : a));
  const worst = items.reduce((a, b) => (b.value < a.value ? b : a));

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel} preserveAspectRatio="xMinYMid meet" style={{ maxHeight: 150 }}>
        <line x1={0} x2={W} y1={baseY} y2={baseY} stroke={BASELINE} strokeWidth={1} />
        {items.map((item, index) => {
          const left = gap + index * (barWidth + gap);
          const endY = baseY - item.value * scale;
          const isExtreme = (item === best && item.value > 0) || (item === worst && item.value < 0);
          return (
            <g key={index}>
              {Math.abs(item.value) < 1e-9 ? (
                <rect x={left} y={baseY - 1} width={barWidth} height={2} fill={BASELINE} />
              ) : (
                <path d={columnPath(left, baseY, endY, barWidth)} fill={item.value >= 0 ? GREEN : RED} />
              )}
              {isExtreme ? (
                <text
                  x={left + barWidth / 2}
                  y={item.value >= 0 ? endY - 5 : endY + 12}
                  fontSize={10}
                  fontWeight={600}
                  fill={INK}
                  textAnchor="middle"
                >
                  {item.value > 0 ? "+" : ""}{formatCompact(item.value)}{unit}
                </text>
              ) : null}
              <rect x={left - gap / 2} y={0} width={barWidth + gap} height={H} fill="transparent">
                <title>{item.tooltip}</title>
              </rect>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/** Horizontal magnitude bars (single hue) with the count at the bar tip. */
export function HBarList({ items, tone = "red" }: { items: { label: string; count: number }[]; tone?: "red" | "blue" }) {
  if (!items.length) {
    return <EmptyChart text="No mistakes tagged yet — tag them in trade reviews and patterns show up here." />;
  }
  const max = Math.max(...items.map((item) => item.count));
  const color = tone === "red" ? RED : BLUE;
  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.label} className="grid grid-cols-[110px_1fr] items-center gap-2 sm:grid-cols-[140px_1fr]" title={`${item.label}: ${item.count}`}>
          <span className="truncate text-xs text-forge-muted">{item.label}</span>
          <div className="flex items-center gap-2">
            <div
              className="h-3 rounded-r-md"
              style={{ width: `${Math.max(4, (item.count / max) * 100)}%`, backgroundColor: color, opacity: 0.85 }}
            />
            <span className="text-xs font-semibold text-forge-ink">{item.count}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export type BinDatum = { label: string; count: number; negative: boolean };

/**
 * Fixed-bin histogram (R-multiple distribution). Sign lives in the bin label
 * text; red/green reinforce it. Only the tallest bin is direct-labeled — the
 * rest read from the ticks and tooltips.
 */
export function BinColumns({ bins, ariaLabel }: { bins: BinDatum[]; ariaLabel: string }) {
  const total = bins.reduce((sum, bin) => sum + bin.count, 0);
  if (!total) {
    return <EmptyChart text="Add entry + stop + exit prices to closed trades and their R-multiples build this picture." />;
  }
  const W = 560;
  const H = 170;
  const pad = { top: 18, right: 8, bottom: 34, left: 8 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const gap = 8;
  const barWidth = Math.min(56, (innerW - gap * (bins.length - 1)) / bins.length);
  const rowWidth = barWidth + gap;
  const left0 = pad.left + (innerW - (rowWidth * bins.length - gap)) / 2;
  const maxCount = Math.max(...bins.map((bin) => bin.count));
  const baseY = H - pad.bottom;
  const yFor = (count: number) => baseY - (count / maxCount) * innerH;

  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={ariaLabel}>
        <line x1={pad.left} x2={W - pad.right} y1={baseY} y2={baseY} stroke={BASELINE} strokeWidth={1} />
        {bins.map((bin, index) => {
          const leftEdge = left0 + index * rowWidth;
          const topY = yFor(bin.count);
          const isTallest = bin.count === maxCount;
          return (
            <g key={bin.label}>
              {bin.count > 0 ? (
                <path d={columnPath(leftEdge, baseY, topY, barWidth)} fill={bin.negative ? RED : GREEN} opacity={0.9} />
              ) : (
                <rect x={leftEdge} y={baseY - 1.5} width={barWidth} height={1.5} fill={GRID} />
              )}
              {isTallest && bin.count > 0 ? (
                <text x={leftEdge + barWidth / 2} y={topY - 5} fontSize={11} fontWeight={600} fill={INK} textAnchor="middle">
                  {bin.count}
                </text>
              ) : null}
              <text x={leftEdge + barWidth / 2} y={H - 18} fontSize={9.5} fill={MUTED} textAnchor="middle">
                {bin.label}
              </text>
              <rect x={leftEdge - gap / 2} y={0} width={rowWidth} height={H} fill="transparent">
                <title>{`${bin.label}: ${bin.count} trade${bin.count === 1 ? "" : "s"}`}</title>
              </rect>
            </g>
          );
        })}
        <text x={W / 2} y={H - 4} fontSize={9.5} fill={MUTED} textAnchor="middle">← losses · wins →</text>
      </svg>
    </figure>
  );
}

export type MoneyBarDatum = { label: string; value: number; sub?: string; tooltip?: string };

/**
 * Horizontal bars diverging from a shared zero column — money (or R) per
 * category, red left / green right, value at every bar tip (the tip value IS
 * the point of a ledger).
 */
export function MoneyBars({ items, unit = "", ariaLabel }: { items: MoneyBarDatum[]; unit?: string; ariaLabel: string }) {
  if (!items.length) {
    return <EmptyChart text="Nothing to add up yet." />;
  }
  const maxAbs = Math.max(...items.map((item) => Math.abs(item.value))) || 1;
  return (
    <div className="space-y-2" role="img" aria-label={ariaLabel}>
      {items.map((item) => {
        const negative = item.value < 0;
        const share = Math.abs(item.value) / maxAbs;
        return (
          <div key={item.label} className="grid grid-cols-[minmax(90px,150px)_1fr] items-center gap-2" title={item.tooltip ?? `${item.label}: ${formatCompact(item.value)}${unit}`}>
            <span className="min-w-0">
              <span className="block truncate text-xs text-forge-ink">{item.label}</span>
              {item.sub ? <span className="block truncate text-[10px] text-forge-muted">{item.sub}</span> : null}
            </span>
            <div className="grid grid-cols-2 items-center">
              <div className="flex items-center justify-end gap-1.5 border-r border-forge-line pr-0 min-h-4">
                {negative ? (
                  <>
                    <span className="text-[11px] font-semibold text-forge-red">−{formatCompact(Math.abs(item.value))}{unit}</span>
                    <div className="h-3 rounded-l-md" style={{ width: `${Math.max(3, share * 100)}%`, backgroundColor: RED, opacity: 0.85 }} />
                  </>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5 min-h-4">
                {!negative ? (
                  <>
                    <div className="h-3 rounded-r-md" style={{ width: `${Math.max(3, share * 100)}%`, backgroundColor: GREEN, opacity: 0.85 }} />
                    <span className="text-[11px] font-semibold text-forge-green">+{formatCompact(item.value)}{unit}</span>
                  </>
                ) : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Horizontal meter for a single 0–1 ratio: blue fill on a light step of the
 * same blue ramp so the whole bar reads as one scale.
 */
export function Meter({ value, ariaLabel }: { value: number; ariaLabel: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="flex items-center gap-3" role="img" aria-label={`${ariaLabel}: ${(clamped * 100).toFixed(0)}%`}>
      <div className="h-3 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: BLUE_TRACK }}>
        <div className="h-full rounded-full" style={{ width: `${clamped * 100}%`, backgroundColor: BLUE }} />
      </div>
      <span className="text-sm font-semibold text-forge-ink">{(clamped * 100).toFixed(0)}%</span>
    </div>
  );
}
