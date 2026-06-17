import { PageTitle } from "@/components/Fields";
import { conditionLabel, sessionLabels } from "@/lib/constants";
import { getSetupNameMap, getTradesWithMistakes } from "@/lib/data";
import {
  averageExitEfficiency,
  averageProcessScore,
  conditionPerformance,
  expectancyBreakdown,
  fundingSummary,
  sessionPerformance,
  setupPerformance,
  type BucketStats,
} from "@/lib/metrics";

export default async function AnalyticsPage() {
  const [trades, setupNameById] = await Promise.all([getTradesWithMistakes(), getSetupNameMap()]);
  const closed = trades.filter((trade) => trade.status === "CLOSED");

  const setups = setupPerformance(trades, setupNameById);
  const sessions = sessionPerformance(trades, sessionLabels);
  const conditions = conditionPerformance(trades, conditionLabel);
  const funding = fundingSummary(trades);
  const expectancy = expectancyBreakdown(trades);
  const processAvg = averageProcessScore(closed);
  const exitAvg = averageExitEfficiency(closed);

  return (
    <main className="page-shell">
      <PageTitle title="Analytics" subtitle="The patterns that drive learning — sliced by setup, condition, session, and process. Built on closed trades." />

      {!closed.length ? (
        <div className="panel muted">No closed trades yet. Patterns appear here once you start closing trades with prices filled in.</div>
      ) : (
        <div className="space-y-5">
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Metric label="Avg process score" value={processAvg == null ? "NA" : `${processAvg.toFixed(0)}/100`} hint="Rule-following, independent of P&L" tone={processAvg == null ? undefined : processAvg >= 60 ? "good" : "bad"} />
            <Metric label="Avg exit efficiency" value={exitAvg == null ? "NA" : `${(exitAvg * 100).toFixed(0)}%`} hint="Share of the favorable move captured" />
            <Metric label="Expectancy / trade" value={expectancy.expectancyR == null ? "NA" : `${expectancy.expectancyR.toFixed(2)}R`} hint={expectancy.expectancyCurrency == null ? "" : `${expectancy.expectancyCurrency.toFixed(2)} per trade`} tone={expectancy.expectancyR == null ? undefined : expectancy.expectancyR >= 0 ? "good" : "bad"} />
            <Metric
              label="Funding drag"
              value={funding.dragPct == null ? "NA" : `${(funding.dragPct * 100).toFixed(0)}%`}
              hint="Funding paid ÷ gross profit · red >15%"
              tone={funding.dragPct == null ? undefined : funding.dragPct > 0.15 ? "bad" : funding.dragPct > 0.1 ? "warn" : "good"}
            />
          </section>

          <section className="panel">
            <h2 className="mb-1 font-semibold">Expectancy breakdown</h2>
            <p className="mb-3 text-sm text-forge-muted">Expectancy = win rate × avg win − loss rate × avg loss. The honest version of &quot;am I profitable?&quot;.</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <Metric label="Sample size" value={String(expectancy.sampleSize)} />
              <Metric label="Win rate" value={expectancy.winRate == null ? "NA" : `${(expectancy.winRate * 100).toFixed(0)}%`} />
              <Metric label="Avg win" value={expectancy.avgWin.toFixed(2)} tone="good" />
              <Metric label="Avg loss" value={expectancy.avgLoss.toFixed(2)} tone="bad" />
              <Metric label="Win/loss ratio" value={expectancy.avgLoss ? (expectancy.avgWin / expectancy.avgLoss).toFixed(2) : "NA"} />
            </div>
          </section>

          <BucketTable title="By setup" subtitle="Which playbook setups actually have an edge." rows={setups} firstColLabel="Setup" />
          <BucketTable title="By session (UTC)" subtitle="When in the 24/7 cycle your edge lives." rows={sessions} firstColLabel="Session" />
          <BucketTable title="By market condition" subtitle="Trend vs chop vs news — the context that makes or breaks you." rows={conditions} firstColLabel="Condition" />

          {funding.dragPct != null && funding.dragPct > 0.15 ? (
            <p className="rounded-lg border-l-4 border-forge-red bg-forge-panel px-3 py-2 text-sm">
              ⚠️ Funding is eating <span className="font-semibold">{(funding.dragPct * 100).toFixed(0)}%</span> of your gross profit ({funding.fundingPaid.toFixed(2)} paid). Above 15% is the documented red flag for perp traders — favor shorter holds or check funding before entry.
            </p>
          ) : null}
        </div>
      )}
    </main>
  );
}

function BucketTable({ title, subtitle, rows, firstColLabel }: { title: string; subtitle: string; rows: BucketStats[]; firstColLabel: string }) {
  return (
    <section className="panel">
      <h2 className="font-semibold">{title}</h2>
      <p className="mb-3 text-sm text-forge-muted">{subtitle}</p>
      {!rows.length ? (
        <p className="muted">Not enough tagged closed trades yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-forge-line">
          <table className="min-w-full text-sm">
            <thead className="bg-forge-panel">
              <tr>
                {[firstColLabel, "Trades", "Win rate", "Expectancy (R)", "Net P&L", "Process"].map((header) => (
                  <th key={header} className="px-3 py-2 text-left font-medium">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t border-forge-line">
                  <td className="px-3 py-2 font-medium">{row.label}</td>
                  <td className="px-3 py-2">{row.count}</td>
                  <td className="px-3 py-2">{row.winRate == null ? "NA" : `${(row.winRate * 100).toFixed(0)}%`}</td>
                  <td className={`px-3 py-2 font-medium ${row.expectancyR == null ? "" : row.expectancyR >= 0 ? "text-forge-green" : "text-forge-red"}`}>
                    {row.expectancyR == null ? "NA" : `${row.expectancyR.toFixed(2)}R`}
                  </td>
                  <td className={`px-3 py-2 ${row.netPnl >= 0 ? "text-forge-green" : "text-forge-red"}`}>{row.netPnl.toFixed(2)}</td>
                  <td className="px-3 py-2">{row.avgProcessScore == null ? "NA" : `${row.avgProcessScore.toFixed(0)}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" | "warn" }) {
  const toneClass = tone === "good" ? "text-forge-green" : tone === "bad" ? "text-forge-red" : tone === "warn" ? "text-amber-600" : "";
  return (
    <div className="metric">
      <div className="text-xs font-medium uppercase tracking-wide text-forge-muted">{label}</div>
      <div className={`mt-2 text-xl font-semibold ${toneClass}`}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-forge-muted">{hint}</div> : null}
    </div>
  );
}
