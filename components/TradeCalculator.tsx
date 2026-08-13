"use client";

import { useEffect, useState } from "react";
import {
  calculateTrade,
  expectancyAt,
  feePresets,
  type CalcDirection,
  type CalcResult,
} from "@/lib/calculator";

// The one page in the app that recomputes as you type. Everything else is a
// server-rendered form on purpose, but a calculator you have to submit is not a
// calculator — you'd never scrub a stop around to see where the fees stop
// eating the trade. No data is saved; this is a scratchpad.

type Fields = {
  direction: CalcDirection;
  entry: string;
  stop: string;
  target: string;
  entryFeePct: string;
  exitFeePct: string;
  accountSize: string;
  riskPct: string;
  leverage: string;
  fundingPct: string;
  hoursHeld: string;
  winRatePct: string;
};

// A 0.3% move planned at 2R — the exact shape of trade that looks fine on the
// chart and dies to fees. Entry 100 so every price reads as a percentage.
const baseDefaults: Fields = {
  direction: "LONG",
  entry: "100",
  stop: "99.85",
  target: "100.30",
  entryFeePct: "0.045",
  exitFeePct: "0.045",
  accountSize: "10000",
  riskPct: "1",
  leverage: "10",
  fundingPct: "0",
  hoursHeld: "0",
  winRatePct: "50",
};

// Only the settings-shaped fields are remembered — your fee tier and account
// size don't change between sessions, prices do.
const STORAGE_KEY = "tradegenie.calculator.defaults";
const remembered = ["entryFeePct", "exitFeePct", "accountSize", "riskPct", "leverage", "winRatePct"] as const;

export function TradeCalculator({ journalWinRate, journalTradeCount }: { journalWinRate: number | null; journalTradeCount: number }) {
  const [fields, setFields] = useState<Fields>(() => ({
    ...baseDefaults,
    winRatePct: journalWinRate != null ? String(Math.round(journalWinRate * 100)) : baseDefaults.winRatePct,
  }));

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Fields>;
      setFields((current) => {
        const next = { ...current };
        for (const key of remembered) {
          const value = saved[key];
          if (typeof value === "string" && value !== "") next[key] = value;
        }
        return next;
      });
    } catch {
      // A corrupt or blocked localStorage just means you get the defaults.
    }
  }, []);

  useEffect(() => {
    try {
      const payload = Object.fromEntries(remembered.map((key) => [key, fields[key]]));
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Ignore — remembering the fee tier is a convenience, never load-bearing.
    }
  }, [fields]);

  const set = (key: keyof Fields) => (value: string) => setFields((current) => ({ ...current, [key]: value }));

  const result = calculateTrade({
    direction: fields.direction,
    entry: num(fields.entry),
    stop: num(fields.stop),
    target: num(fields.target),
    entryFeePct: num(fields.entryFeePct),
    exitFeePct: num(fields.exitFeePct),
    accountSize: num(fields.accountSize),
    riskPct: num(fields.riskPct),
    leverage: num(fields.leverage),
    fundingPct: num(fields.fundingPct),
    hoursHeld: num(fields.hoursHeld),
  });

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
      <div className="panel space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-forge-muted">The trade</h2>

        <div className="grid grid-cols-2 gap-2">
          {(["LONG", "SHORT"] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFields((current) => ({ ...current, direction: option }))}
              className={`min-h-10 rounded-lg border px-3 py-2 text-sm font-semibold transition ${
                fields.direction === option
                  ? option === "LONG"
                    ? "border-forge-green bg-forge-green text-white"
                    : "border-forge-red bg-forge-red text-white"
                  : "border-forge-line bg-white text-forge-ink hover:border-forge-muted"
              }`}
            >
              {option === "LONG" ? "Long" : "Short"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Num label="Entry" value={fields.entry} onChange={set("entry")} />
          <Num label="Stop" value={fields.stop} onChange={set("stop")} />
          <Num label="Target" value={fields.target} onChange={set("target")} />
        </div>
        <p className="text-xs text-forge-muted">
          Any prices work. Leave entry at 100 and the other two read straight off as percentages.
        </p>

        <div className="space-y-2 border-t border-forge-line pt-4">
          <span className="label">Fees (% of position size, per side)</span>
          <div className="flex flex-wrap gap-1.5">
            {feePresets.map((preset) => {
              const active = fields.entryFeePct === String(preset.entry) && fields.exitFeePct === String(preset.exit);
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() =>
                    setFields((current) => ({
                      ...current,
                      entryFeePct: String(preset.entry),
                      exitFeePct: String(preset.exit),
                    }))
                  }
                  className={`rounded-full border px-2.5 py-1 text-xs transition ${
                    active
                      ? "border-forge-ink bg-forge-ink text-white"
                      : "border-forge-line bg-white text-forge-muted hover:border-forge-muted"
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Num label="Entry fee %" value={fields.entryFeePct} onChange={set("entryFeePct")} />
            <Num label="Exit fee %" value={fields.exitFeePct} onChange={set("exitFeePct")} />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 border-t border-forge-line pt-4">
          <Num label="Account" value={fields.accountSize} onChange={set("accountSize")} />
          <Num label="Risk %" value={fields.riskPct} onChange={set("riskPct")} />
          <Num label="Leverage" value={fields.leverage} onChange={set("leverage")} />
        </div>

        <details className="rounded-lg border border-forge-line p-3">
          <summary className="cursor-pointer text-sm font-semibold text-forge-muted">
            Funding <span className="font-normal">(only matters if you hold)</span>
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Num label="Funding % / 8h" value={fields.fundingPct} onChange={set("fundingPct")} />
            <Num label="Hours held" value={fields.hoursHeld} onChange={set("hoursHeld")} />
          </div>
          <p className="mt-2 text-xs text-forge-muted">Positive means you pay it. Negative means you collect it.</p>
        </details>
      </div>

      <div className="space-y-4">
        {result ? (
          <Results
            result={result}
            winRatePct={fields.winRatePct}
            onWinRateChange={set("winRatePct")}
            journalWinRate={journalWinRate}
            journalTradeCount={journalTradeCount}
          />
        ) : (
          <div className="panel text-sm text-forge-muted">Put in an entry, a stop and a target to see the numbers.</div>
        )}
      </div>
    </div>
  );
}

function Results({
  result,
  winRatePct,
  onWinRateChange,
  journalWinRate,
  journalTradeCount,
}: {
  result: CalcResult;
  winRatePct: string;
  onWinRateChange: (value: string) => void;
  journalWinRate: number | null;
  journalTradeCount: number;
}) {
  const winRate = clamp(num(winRatePct) / 100, 0, 1);
  const expectancy = expectancyAt(result, winRate);
  const beats = result.netBreakEvenWinRate != null && winRate >= result.netBreakEvenWinRate;

  return (
    <>
      {result.warnings.length ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-forge-red">
          <ul className="list-inside list-disc space-y-1">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Tile
          label="Real R after fees"
          value={`${result.netR.toFixed(2)}R`}
          sub={`${result.grossR.toFixed(2)}R on the chart`}
          tone={result.netR >= 1 ? "green" : result.netR > 0 ? "gold" : "red"}
        />
        <Tile
          label="Win rate to break even"
          value={result.netBreakEvenWinRate != null ? pct(result.netBreakEvenWinRate * 100, 1) : "impossible"}
          sub={
            result.grossBreakEvenWinRate != null
              ? `${pct(result.grossBreakEvenWinRate * 100, 1)} if fees were free`
              : "target is on the wrong side"
          }
          tone={result.netBreakEvenWinRate == null ? "red" : result.netBreakEvenWinRate > 0.55 ? "gold" : "green"}
        />
        <Tile
          label="Fees eat"
          value={pct(result.feeBitePct, 0)}
          sub={`of your ${pct(result.grossMovePct, 2)} move`}
          tone={result.feeBitePct >= 25 ? "red" : result.feeBitePct >= 12 ? "gold" : "green"}
        />
      </div>

      <div className="panel space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-forge-muted">Break-even &amp; costs</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="Break-even price" value={price(result.breakEvenPrice)} />
          <Stat label="Move to break even" value={pct(result.breakEvenMovePct, 3)} hint="before you make a cent" />
          <Stat label="Round-trip fee" value={pct(result.roundTripFeePct, 3)} hint="of position size" />
          <Stat label="Total cost at target" value={money(result.totalCostAtTarget)} hint="fees + funding" />
        </dl>
      </div>

      <div className="panel space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-forge-muted">Position size</h2>
        <p className="text-sm text-forge-muted">
          Sized so a stop-out costs exactly your {money(result.riskBudget)} risk budget — fees included, not on top.
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="Size" value={qty(result.quantity)} hint="units" />
          <Stat label="Position value" value={money(result.notional)} />
          <Stat label="Margin needed" value={money(result.margin)} />
          <Stat
            label="Rough liquidation"
            value={result.liquidationPrice != null ? price(result.liquidationPrice) : "—"}
            hint="excludes maintenance margin"
          />
          <Stat label="Win nets you" value={money(result.netWin)} tone="green" hint={`${money(result.grossWin)} before fees`} />
          <Stat label="Loss costs you" value={money(result.netLoss)} tone="red" hint="stop-out, all in" />
          <Stat label="Stop distance" value={pct(result.stopDistancePct, 3)} />
          <Stat
            label="Costs vs your risk"
            value={result.riskBudget > 0 ? pct((result.totalCostAtTarget / result.riskBudget) * 100, 0) : "—"}
            hint={`${money(result.totalCostAtTarget)} of costs to risk ${money(result.riskBudget)}`}
            tone={result.riskBudget > 0 && result.totalCostAtTarget / result.riskBudget >= 0.25 ? "red" : undefined}
          />
        </dl>
      </div>

      <div className="panel space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-forge-muted">Does it make money long run?</h2>
        <div className="flex flex-wrap items-end gap-3">
          <label className="field w-32">
            <span className="text-xs font-medium text-forge-muted">If I win…</span>
            <div className="flex items-center gap-1">
              <input
                type="number"
                inputMode="decimal"
                step="any"
                value={winRatePct}
                onChange={(event) => onWinRateChange(event.target.value)}
                className="input w-full"
              />
              <span className="text-sm text-forge-muted">%</span>
            </div>
          </label>
          {journalWinRate != null ? (
            <button
              type="button"
              onClick={() => onWinRateChange(String(Math.round(journalWinRate * 100)))}
              className="button-secondary"
            >
              Use my {pct(journalWinRate * 100, 0)} ({journalTradeCount} closed trades)
            </button>
          ) : null}
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
          <Stat label="Expectancy" value={`${signed(expectancy.perTradeR, 2)}R`} tone={expectancy.perTradeR >= 0 ? "green" : "red"} hint="per trade" />
          <Stat label="Per trade" value={signedMoney(expectancy.perTradeMoney)} tone={expectancy.perTradeMoney >= 0 ? "green" : "red"} />
          <Stat label="Over 100 trades" value={signedMoney(expectancy.per100Trades)} tone={expectancy.per100Trades >= 0 ? "green" : "red"} />
        </dl>
        <p className={`text-sm font-medium ${beats ? "text-forge-green" : "text-forge-red"}`}>
          {result.netBreakEvenWinRate == null
            ? "This one can't be profitable at any win rate — the target doesn't clear the costs."
            : beats
              ? `Profitable: you need ${pct(result.netBreakEvenWinRate * 100, 1)} and you're assuming ${pct(winRate * 100, 0)}.`
              : `Losing setup: you need ${pct(result.netBreakEvenWinRate * 100, 1)} to break even but you're assuming ${pct(winRate * 100, 0)}.`}
        </p>
      </div>

      <details className="panel">
        <summary className="cursor-pointer text-sm font-semibold text-forge-muted">
          Why small moves hurt <span className="font-normal">(fee drag by move size, and the targets you&rsquo;d actually need)</span>
        </summary>

        <div className="mt-4 space-y-5">
          <div>
            <h3 className="text-sm font-semibold">At your fee tier, every move loses this much to fees</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="border-b border-forge-line text-left text-xs uppercase tracking-wide text-forge-muted">
                    <th className="py-2 pr-3 font-medium">Move</th>
                    <th className="py-2 pr-3 font-medium">Fees eat</th>
                    <th className="py-2 font-medium">Gross R:R needed to net 1R</th>
                  </tr>
                </thead>
                <tbody>
                  {result.feeDrag.map((row) => (
                    <tr key={row.movePct} className="border-b border-forge-line/60 last:border-0">
                      <td className="py-2 pr-3 tabular-nums">{row.movePct}%</td>
                      <td className={`py-2 pr-3 tabular-nums ${row.bitePct >= 25 ? "text-forge-red" : row.bitePct >= 12 ? "text-forge-gold" : "text-forge-green"}`}>
                        {pct(row.bitePct, 0)}
                      </td>
                      <td className="py-2 tabular-nums">
                        {row.grossRRForOneNetR != null ? `${row.grossRRForOneNetR.toFixed(1)} : 1` : "not possible"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-forge-muted">
              This is the whole problem in one table: fees are a flat cut of position size, so the smaller the move you&rsquo;re
              chasing, the bigger the share they take. Nothing about the setup changes it — only a wider move or a cheaper fee.
            </p>
          </div>

          <div>
            <h3 className="text-sm font-semibold">From this entry, to actually keep…</h3>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[26rem] text-sm">
                <thead>
                  <tr className="border-b border-forge-line text-left text-xs uppercase tracking-wide text-forge-muted">
                    <th className="py-2 pr-3 font-medium">Net R</th>
                    <th className="py-2 pr-3 font-medium">Target price</th>
                    <th className="py-2 font-medium">Move</th>
                  </tr>
                </thead>
                <tbody>
                  {result.targetsForNetR.map((row) => (
                    <tr key={row.netR} className="border-b border-forge-line/60 last:border-0">
                      <td className="py-2 pr-3 tabular-nums">{row.netR}R</td>
                      <td className="py-2 pr-3 tabular-nums">{price(row.price)}</td>
                      <td className="py-2 tabular-nums">{pct(row.movePct, 3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-forge-muted">Same stop, same fees — just the target moved out far enough to be worth it.</p>
          </div>
        </div>
      </details>
    </>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: "green" | "gold" | "red" }) {
  const toneClass = tone === "green" ? "text-forge-green" : tone === "red" ? "text-forge-red" : "text-forge-gold";
  return (
    <div className="metric">
      <p className="text-xs font-medium uppercase tracking-wide text-forge-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
      <p className="text-xs text-forge-muted">{sub}</p>
    </div>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "green" | "red" }) {
  const toneClass = tone === "green" ? "text-forge-green" : tone === "red" ? "text-forge-red" : "text-forge-ink";
  return (
    <div>
      <dt className="text-xs font-medium text-forge-muted">{label}</dt>
      <dd className={`text-base font-semibold tabular-nums ${toneClass}`}>{value}</dd>
      {hint ? <p className="text-xs text-forge-muted">{hint}</p> : null}
    </div>
  );
}

function Num({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="text-xs font-medium text-forge-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input w-full"
      />
    </label>
  );
}

function num(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function price(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 10 ? 2 : abs >= 1 ? 4 : 6;
  return value.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function money(value: number) {
  return Math.abs(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function signedMoney(value: number) {
  return `${value < 0 ? "−" : "+"}${money(value)}`;
}

function signed(value: number, decimals: number) {
  return `${value < 0 ? "−" : "+"}${Math.abs(value).toFixed(decimals)}`;
}

function pct(value: number, decimals: number) {
  return `${value.toFixed(decimals)}%`;
}

function qty(value: number) {
  const abs = Math.abs(value);
  const decimals = abs >= 100 ? 2 : abs >= 1 ? 3 : 6;
  return value.toLocaleString("en-IN", { maximumFractionDigits: decimals });
}
