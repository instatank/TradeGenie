import Link from "next/link";
import { format, startOfWeek } from "date-fns";
import { ArrowRight, Mic, NotebookPen, Plus, Sunset } from "lucide-react";
import { DashboardCharts } from "@/components/DashboardCharts";
import { PageTitle } from "@/components/Fields";
import { db, getLatestLesson, getTradesWithMistakes } from "@/lib/data";
import {
  calculateTotalR,
  calculateWinRate,
  emotionalStateFrequency,
  getTradePnl,
  mistakeFrequency,
} from "@/lib/metrics";

export default async function DashboardPage() {
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const [trades, journals, latestLesson] = await Promise.all([
    getTradesWithMistakes(),
    db.list("dailyJournals"),
    getLatestLesson(),
  ]);

  const weeklyTrades = trades.filter((trade) => trade.tradeDateTime >= weekStart);
  const closedTrades = trades.filter((trade) => trade.status === "CLOSED");
  const netPnl = closedTrades.reduce((sum, trade) => sum + (getTradePnl(trade) ?? 0), 0);
  const totalR = calculateTotalR(closedTrades);
  const winRate = calculateWinRate(closedTrades);
  const mistakeData = mistakeFrequency(trades);
  const emotionData = emotionalStateFrequency(trades);
  const scoredJournals = journals.filter((journal) => journal.disciplineScore != null).sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 20);
  const disciplineAverage = scoredJournals.length
    ? scoredJournals.reduce((sum, journal) => sum + (journal.disciplineScore ?? 0), 0) / scoredJournals.length
    : null;

  const pnlData = closedTrades.map((trade) => ({
    date: format(trade.tradeDateTime, "MMM d"),
    pnl: Number((getTradePnl(trade) ?? 0).toFixed(2)),
  }));

  return (
    <main className="page-shell">
      <PageTitle title="Dashboard" subtitle="A quick read on trading behavior, not a command center." />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Trades this week" value={weeklyTrades.length} />
        <Metric label="Closed trades" value={closedTrades.length} />
        <Metric label="Net P&L" value={formatMoney(netPnl)} tone={netPnl >= 0 ? "good" : "bad"} />
        <Metric label="Total R" value={totalR == null ? "NA" : totalR.toFixed(2)} />
        <Metric label="Win rate" value={winRate == null ? "NA" : `${(winRate * 100).toFixed(0)}%`} />
        <Metric label="Discipline average" value={disciplineAverage == null ? "NA" : disciplineAverage.toFixed(1)} />
        <Metric label="Most common mistake" value={mistakeData[0]?.label ?? "None yet"} />
        <Metric label="Latest lesson" value={latestLesson?.lessonText ?? "No lesson yet"} />
      </section>

      <section className="mt-5 grid gap-4 lg:grid-cols-[1fr_320px]">
        <DashboardCharts pnlData={pnlData} mistakeData={mistakeData} emotionData={emotionData} />
        <div className="panel h-fit">
          <h2 className="mb-3 font-semibold">Today&apos;s actions</h2>
          <div className="grid gap-2">
            <Action href="/daily" label="Start daily check-in" icon={<NotebookPen className="h-4 w-4" />} />
            <Action href="/inbox" label="Add voice transcript" icon={<Mic className="h-4 w-4" />} />
            <Action href="/trades/new" label="Add quick trade note" icon={<Plus className="h-4 w-4" />} />
            <Action href="/daily#eod" label="Add EOD review" icon={<Sunset className="h-4 w-4" />} />
          </div>
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "bad" }) {
  return (
    <div className="metric">
      <div className="text-xs font-medium uppercase tracking-wide text-forge-muted">{label}</div>
      <div className={`mt-2 line-clamp-2 text-xl font-semibold ${tone === "good" ? "text-forge-green" : tone === "bad" ? "text-forge-red" : ""}`}>
        {value}
      </div>
    </div>
  );
}

function Action({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link href={href} className="button-secondary justify-between">
      <span className="flex items-center gap-2">{icon}{label}</span>
      <ArrowRight className="h-4 w-4" />
    </Link>
  );
}

function formatMoney(value: number) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
