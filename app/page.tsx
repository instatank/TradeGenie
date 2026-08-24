import Link from "next/link";
import { addDays, format, isSameDay, startOfDay, startOfWeek, subDays } from "date-fns";
import { ArrowRight, CheckCircle2, Circle, Flame, GraduationCap, Lightbulb, Mic, Sunrise, Sunset } from "lucide-react";
import { DisciplineLines, DivergingColumns, EquityCurve, HBarList, MoneyBars } from "@/components/Charts";
import { QuickNoteBar } from "@/components/QuickNoteBar";
import { QuickTradeForm } from "@/components/QuickTradeForm";
import { RunSetupBar } from "@/components/RunSetupBar";
import { eveningDone, journalStreak, morningDone, streakMilestone, tipOfTheDay } from "@/lib/coach";
import { humanize } from "@/lib/constants";
import { db, getFreeNotesForDay, getResurfacedLessons, getRunnableSetups, getSetupNameMap, getTagVocabulary, getTodayJournal, getTradesWithMistakes } from "@/lib/data";
import { getOptionCatalog } from "@/lib/options";
import { stepResolver } from "@/lib/setups";
import {
  analyticsLeaks,
  checklistGaps,
  calculateRuleAdherenceRate,
  calculateTotalR,
  conditionPerformance,
  disciplineCurve,
  expectancyBreakdown,
  getTradePnl,
  mistakeCostLedger,
  mistakeFrequency,
  setupPerformance,
  tradeNeedsReview,
} from "@/lib/metrics";

// Today: the one screen of the daily habit. Morning check-in → log trades as
// they happen → evening review. Everything else in the app supports this loop.
export default async function TodayPage() {
  const now = new Date();
  const today = startOfDay(now);
  const [trades, journals, transcripts, assetNotes, lessons, setupNames, todayJournal, tagVocabulary, options, freeNotes, runnableSetups, playbook] = await Promise.all([
    getTradesWithMistakes(),
    db.list("dailyJournals"),
    db.list("transcripts"),
    db.list("assetNotes"),
    getResurfacedLessons(1),
    getSetupNameMap(),
    getTodayJournal(now),
    getTagVocabulary(),
    getOptionCatalog(),
    getFreeNotesForDay(now),
    getRunnableSetups(),
    db.list("setups"),
  ]);

  // Streak counts showing up in any form — never profitability.
  const streak = journalStreak([
    ...journals.map((journal) => journal.date),
    ...trades.map((trade) => trade.createdAt),
    ...transcripts.map((transcript) => transcript.createdAt),
    ...assetNotes.map((note) => note.createdAt),
  ]);
  const milestone = streakMilestone(streak);

  const tradesToday = trades.filter((trade) => isSameDay(trade.tradeDateTime, today));
  const morning = morningDone(todayJournal);
  const evening = eveningDone(todayJournal);

  // This week, Monday-first. On-plan % leads: process is the beginner's real KPI.
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekTrades = trades.filter((trade) => trade.tradeDateTime >= weekStart);
  const weekClosed = weekTrades.filter((trade) => trade.status === "CLOSED");
  const onPlan = calculateRuleAdherenceRate(weekClosed);
  const weekPnl = weekClosed.reduce((sum, trade) => sum + (getTradePnl(trade) ?? 0), 0);
  const weekStats = expectancyBreakdown(weekTrades);
  const weekR = calculateTotalR(weekClosed);
  const journaledDays = new Set(journals.map((journal) => format(startOfDay(journal.date), "yyyy-MM-dd")));

  const weekDays = Array.from({ length: 7 }, (_, index) => {
    const day = addDays(weekStart, index);
    const dayTrades = trades.filter((trade) => trade.status === "CLOSED" && isSameDay(trade.tradeDateTime, day));
    const pnl = dayTrades.length ? dayTrades.reduce((sum, trade) => sum + (getTradePnl(trade) ?? 0), 0) : null;
    return {
      key: format(day, "yyyy-MM-dd"),
      label: format(day, "EEEEE"),
      dayOfMonth: format(day, "d"),
      isToday: isSameDay(day, today),
      isFuture: day > today,
      journaled: journaledDays.has(format(day, "yyyy-MM-dd")),
      pnl,
      tradeCount: dayTrades.length,
    };
  });

  // Trades waiting on a one-minute review (closed but not reflected on), plus open positions.
  const needsReview = trades
    .filter(tradeNeedsReview)
    .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime())
    .slice(0, 4);
  const openTrades = trades
    .filter((trade) => trade.status === "OPEN")
    .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime())
    .slice(0, 4);

  // Snapshot data: last 30 days, falling back to all-time while history is thin.
  const thirtyDaysAgo = subDays(today, 29);
  const closedWithPnl = trades
    .filter((trade) => trade.status === "CLOSED" && getTradePnl(trade) != null)
    .sort((a, b) => a.tradeDateTime.getTime() - b.tradeDateTime.getTime());
  let curveTrades = closedWithPnl.filter((trade) => trade.tradeDateTime >= thirtyDaysAgo);
  let curveRange = "last 30 days";
  if (curveTrades.length < 2) {
    curveTrades = closedWithPnl;
    curveRange = "all time";
  }
  const dailyTotals = new Map<string, number>();
  for (const trade of curveTrades) {
    const key = format(trade.tradeDateTime, "d MMM");
    dailyTotals.set(key, (dailyTotals.get(key) ?? 0) + (getTradePnl(trade) ?? 0));
  }
  let running = 0;
  const equityPoints = [...dailyTotals.entries()].map(([label, pnl]) => {
    running += pnl;
    return { label, value: Number(running.toFixed(2)) };
  });
  const withR = closedWithPnl.filter((trade) => trade.rMultiple != null);
  const useR = withR.length >= 3;
  const recentOutcomes = (useR ? withR : closedWithPnl).slice(-12).map((trade) => ({
    label: trade.instrument,
    value: useR ? (trade.rMultiple ?? 0) : (getTradePnl(trade) ?? 0),
    tooltip: `${trade.instrument} ${humanize(trade.direction).toLowerCase()} · ${format(trade.tradeDateTime, "d MMM")} · ${
      useR ? `${(trade.rMultiple ?? 0).toFixed(2)}R` : `P&L ${(getTradePnl(trade) ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`
    }`,
  }));
  let snapshotMistakes = mistakeFrequency(trades.filter((trade) => trade.tradeDateTime >= thirtyDaysAgo)).slice(0, 5);
  if (!snapshotMistakes.length) snapshotMistakes = mistakeFrequency(trades).slice(0, 5);

  // Discipline overlay: only when a plan-breaking adjustment exists — otherwise
  // the plain equity curve carries the panel without a redundant second line.
  const discipline = disciplineCurve(curveTrades);
  const showDiscipline = discipline.points.length >= 2 && discipline.skippedCount + discipline.cappedCount > 0;
  // Mistakes as money (falls back to counts when trades carry no P&L yet).
  let mistakeCosts = mistakeCostLedger(trades.filter((trade) => trade.tradeDateTime >= thirtyDaysAgo)).slice(0, 5);
  if (!mistakeCosts.length) mistakeCosts = mistakeCostLedger(trades).slice(0, 5);

  // The step you skip most is a leak like any other — it rides into the coach's
  // corner through the same ranked list, so it competes with funding drag and
  // repeated mistakes rather than needing its own panel.
  const gaps = checklistGaps(trades, stepResolver(playbook));
  const insight = analyticsLeaks(
    trades,
    setupPerformance(trades, setupNames),
    conditionPerformance(trades, options.labeler("condition")),
    gaps,
  )[0];
  const tip = tipOfTheDay(now);
  const recentSymbols = [...new Set(trades
    .slice()
    .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime())
    .map((trade) => trade.instrument))].slice(0, 5);

  return (
    <main className="page-shell">
      <div className="mb-5 rounded-2xl border border-forge-line bg-gradient-to-r from-emerald-50 via-white to-sky-50 p-5 shadow-soft">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{format(now, "EEEE, d MMMM")}</h1>
            <p className="mt-1 text-sm text-forge-muted">Show up, follow the plan, write it down. That&apos;s the whole job today.</p>
          </div>
          <div className={`flex items-center gap-2 self-start rounded-full border px-3 py-1.5 text-sm font-medium shadow-soft sm:self-auto ${streak > 0 ? "border-forge-gold/50 bg-amber-50" : "border-forge-line bg-white"}`}>
            <Flame className={`h-4 w-4 ${streak > 0 ? "text-forge-gold" : "text-forge-muted"}`} aria-hidden="true" />
            {streak > 0 ? `${streak}-day journaling streak` : "Start your streak today"}
          </div>
        </div>
        {milestone ? <p className="mt-3 text-sm text-forge-ink">🏅 {milestone}</p> : null}
      </div>

      {/* The daily ritual: three steps, in order, with live done-states. */}
      <section className="mb-5 grid gap-3 sm:grid-cols-3">
        <RitualStep
          done={morning}
          icon={<Sunrise className="h-4 w-4" aria-hidden="true" />}
          title="Morning check-in"
          detail={morning ? summarizeMorning(options.label("mindState", todayJournal?.currentState), todayJournal?.maxTradesForDay, todayJournal?.maxLossForDay) : "Mood + guardrails. Under a minute."}
          href="/daily"
          cta={morning ? "Edit" : "Check in"}
        />
        <RitualStep
          done={tradesToday.length > 0}
          neutral={tradesToday.length === 0}
          icon={<Circle className="h-4 w-4" aria-hidden="true" />}
          title="Log as you go"
          detail={
            tradesToday.length
              ? `${tradesToday.length} trade${tradesToday.length === 1 ? "" : "s"} logged today.`
              : "Nothing yet — and a planned no-trade day counts as a win."
          }
          href="#quick-log"
          cta="Quick log"
        />
        <RitualStep
          done={evening}
          icon={<Sunset className="h-4 w-4" aria-hidden="true" />}
          title="Evening review"
          detail={evening ? "Done for today. See you tomorrow." : "Three taps and two lines. 2–4 minutes."}
          href="/daily#evening"
          cta={evening ? "Edit" : "Review the day"}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          {/* One line, nothing to decide. Hold it (or double-click) to carry the
              thought into the day's review, where the full box lives. */}
          <QuickNoteBar
            key={freeNotes.length}
            date={format(now, "yyyy-MM-dd")}
            redirectTo="/"
            homeHref={`/daily?date=${format(now, "yyyy-MM-dd")}`}
            noteCount={freeNotes.length}
          />

          <div id="quick-log" className="panel">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold">Log a trade</h2>
              <span className="text-xs text-forge-muted">~30 seconds · symbol + direction is enough</span>
            </div>
            <QuickTradeForm
              recentSymbols={recentSymbols}
              tagVocabulary={tagVocabulary.map((entry) => entry.tag)}
              mindStateChoices={options.choices("mindState")}
              redirectTo="/"
            />
            {/* The deliberate path, next to the fast one. */}
            <div className="mt-3">
              <RunSetupBar setups={runnableSetups} />
            </div>
          </div>

          <div className="panel">
            <h2 className="mb-3 font-semibold">This week</h2>
            <div className="grid grid-cols-7 gap-1.5">
              {weekDays.map((day) => (
                <Link
                  key={day.key}
                  href={`/daily?date=${day.key}`}
                  className={`rounded-lg border p-2 text-center transition hover:border-forge-muted ${
                    day.isToday ? "border-forge-blue ring-1 ring-forge-blue/30" : "border-forge-line"
                  } ${day.pnl == null ? "bg-white" : day.pnl >= 0 ? "bg-emerald-50" : "bg-red-50"} ${day.isFuture ? "opacity-40" : ""}`}
                >
                  <div className="text-[11px] font-medium uppercase text-forge-muted">{day.label}</div>
                  <div className="text-sm font-semibold">{day.dayOfMonth}</div>
                  <div className={`mt-0.5 truncate text-[11px] font-medium ${day.pnl == null ? "text-forge-muted" : day.pnl >= 0 ? "text-forge-green" : "text-forge-red"}`}>
                    {day.pnl == null ? (day.journaled ? "·" : " ") : formatMoney(day.pnl)}
                  </div>
                </Link>
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="On-plan trades"
                value={onPlan == null ? "—" : `${(onPlan * 100).toFixed(0)}%`}
                sub="Your real score. P&L follows this."
                tone={onPlan == null ? undefined : onPlan >= 0.7 ? "good" : "bad"}
              />
              <Stat label="Net P&L" value={weekClosed.length ? formatMoney(weekPnl) : "—"} tone={!weekClosed.length ? undefined : weekPnl >= 0 ? "good" : "bad"} />
              <Stat
                label="Win rate"
                value={weekStats.winRate == null ? "—" : `${(weekStats.winRate * 100).toFixed(0)}%`}
                sub={weekStats.winRate == null ? undefined : `avg win ${formatMoney(weekStats.avgWin)} · avg loss ${formatMoney(weekStats.avgLoss)}`}
              />
              <Stat label="Total R" value={weekR == null ? "—" : weekR.toFixed(1)} sub={`${weekClosed.length} closed trade${weekClosed.length === 1 ? "" : "s"}`} />
            </div>
            <p className="mt-3 text-xs text-forge-muted">
              Deeper numbers live in <Link href="/analytics" className="text-forge-blue hover:underline">Analytics</Link> and the full{" "}
              <Link href="/calendar" className="text-forge-blue hover:underline">Calendar</Link> whenever you want them.
            </p>
          </div>

          <div className="panel">
            <div className="mb-3 flex items-baseline justify-between gap-2">
              <h2 className="font-semibold">Snapshot</h2>
              <span className="text-xs text-forge-muted">the shape of your trading, at a glance</span>
            </div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-forge-muted">Equity curve · {curveRange}</p>
            {showDiscipline ? (
              <>
                <DisciplineLines points={discipline.points} title={`Actual vs plan-following P&L, ${curveRange}`} />
                {discipline.delta > 0 ? (
                  <p className="mt-1 text-[11px] text-forge-muted">
                    The dashed line is your history minus tagged impulse trades, with runaway losses cut at planned risk — following
                    the plan was worth <span className="font-semibold text-forge-green">+{discipline.delta.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>.{" "}
                    <Link href="/analytics" className="text-forge-blue hover:underline">Full story →</Link>
                  </p>
                ) : null}
              </>
            ) : (
              <EquityCurve points={equityPoints} title={`Cumulative P&L, ${curveRange}`} />
            )}
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-forge-muted">
                  Recent closed trades{useR ? " · in R" : " · P&L"}
                </p>
                <DivergingColumns items={recentOutcomes} unit={useR ? "R" : ""} ariaLabel="Outcome of recent closed trades" />
                <p className="mt-1 text-[11px] text-forge-muted">One bar per trade — hover for the story. {useR ? "R = profit measured in units of what you risked." : "Add entry + stop prices and this switches to R."}</p>
              </div>
              <div>
                {mistakeCosts.length ? (
                  <>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-forge-muted">What mistakes cost you</p>
                    <MoneyBars
                      ariaLabel="Net P&L of trades carrying each mistake tag"
                      items={mistakeCosts.map((entry) => ({
                        label: entry.label,
                        value: entry.totalPnl,
                        sub: `${entry.count} trade${entry.count === 1 ? "" : "s"}`,
                      }))}
                    />
                    <p className="mt-2 text-[11px] text-forge-muted">Net P&L of trades carrying each tag — the top bar is the habit worth the most money.</p>
                  </>
                ) : (
                  <>
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-forge-muted">Most-tagged mistakes</p>
                    <HBarList items={snapshotMistakes} />
                    <p className="mt-2 text-[11px] text-forge-muted">The top bar is your highest-leverage habit to break.</p>
                  </>
                )}
              </div>
            </div>
          </div>

          {needsReview.length || openTrades.length ? (
            <div className="panel">
              <h2 className="mb-3 font-semibold">Waiting on you</h2>
              <div className="space-y-2">
                {needsReview.map((trade) => (
                  <TradeRow key={trade.id} id={trade.id} title={`${trade.instrument} · ${humanize(trade.direction)}`} note="Closed — needs your 1-minute review" cta="Review" />
                ))}
                {openTrades.map((trade) => (
                  <TradeRow key={trade.id} id={trade.id} title={`${trade.instrument} · ${humanize(trade.direction)}`} note={`Open since ${format(trade.tradeDateTime, "d MMM HH:mm")}`} cta="Close & review" />
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="h-fit space-y-4">
          <div className="panel border-l-4 border-forge-blue">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
              <GraduationCap className="h-4 w-4 text-forge-blue" aria-hidden="true" />
              Coach&apos;s corner
            </div>
            <p className="text-sm font-medium">{tip.title}</p>
            <p className="mt-1 text-sm text-forge-muted">{tip.body}</p>
            {insight ? (
              <div className={`mt-3 rounded-lg p-3 text-sm ${insight.severity === "high" ? "bg-red-50" : insight.severity === "medium" ? "bg-amber-50" : "bg-emerald-50"}`}>
                <p className="font-medium">{insight.title}</p>
                <p className="mt-0.5 text-forge-muted">{insight.detail}</p>
              </div>
            ) : null}
          </div>

          {lessons.length ? (
            <div className="panel">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <Lightbulb className="h-4 w-4 text-forge-gold" aria-hidden="true" />
                Your lesson on repeat
              </div>
              <p className="text-sm">{lessons[0].lessonText}</p>
              <Link href="/lessons" className="mt-2 inline-block text-xs text-forge-blue hover:underline">All lessons →</Link>
            </div>
          ) : null}

          <Link href="/inbox" className="panel block transition hover:border-forge-blue">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Mic className="h-4 w-4 text-forge-green" aria-hidden="true" />
              Prefer talking?
            </div>
            <p className="mt-1 text-sm text-forge-muted">
              Paste a voice-note transcript in Capture — I&apos;ll pull out the trade, numbers, and lessons for you to confirm.
            </p>
          </Link>
        </div>
      </section>
    </main>
  );
}

function RitualStep({
  done,
  neutral = false,
  icon,
  title,
  detail,
  href,
  cta,
}: {
  done: boolean;
  neutral?: boolean;
  icon: React.ReactNode;
  title: string;
  detail: string;
  href: string;
  cta: string;
}) {
  return (
    <div className={`panel flex flex-col gap-2 ${done ? "border-forge-green/40" : ""}`}>
      <div className="flex items-center gap-2 text-sm font-semibold">
        {done ? <CheckCircle2 className="h-4 w-4 text-forge-green" aria-hidden="true" /> : icon}
        {title}
      </div>
      <p className="flex-1 text-sm text-forge-muted">{detail}</p>
      <Link href={href} className={`inline-flex items-center gap-1 text-sm font-medium ${done || neutral ? "text-forge-muted hover:text-forge-ink" : "text-forge-blue hover:underline"}`}>
        {cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

function TradeRow({ id, title, note, cta }: { id: string; title: string; note: string; cta: string }) {
  return (
    <Link href={`/trades/${id}`} className="flex items-center justify-between gap-3 rounded-lg border border-forge-line p-3 transition hover:border-forge-blue">
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block text-xs text-forge-muted">{note}</span>
      </span>
      <span className="shrink-0 text-sm font-medium text-forge-blue">{cta} →</span>
    </Link>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg bg-forge-panel p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-forge-muted">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${tone === "good" ? "text-forge-green" : tone === "bad" ? "text-forge-red" : ""}`}>{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] leading-snug text-forge-muted">{sub}</div> : null}
    </div>
  );
}

function summarizeMorning(stateLabel: string, maxTrades?: number | null, maxLoss?: string | null) {
  const parts = [
    stateLabel === "None" ? null : `Feeling ${stateLabel.toLowerCase()}`,
    maxTrades != null ? `max ${maxTrades} trades` : null,
    maxLoss ? `max loss ${maxLoss}` : null,
  ].filter(Boolean);
  return parts.length ? `${parts.join(" · ")}.` : "Checked in.";
}

function formatMoney(value: number) {
  return value.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}
