import Link from "next/link";
import { format, startOfMonth, startOfYear, subDays } from "date-fns";
import { BinColumns, DisciplineLines, DivergingColumns, EmptyChart, Meter, MoneyBars } from "@/components/Charts";
import { PageTitle } from "@/components/Fields";
import {
  directions,
  entryGrades,
  followedPlanOptions,
  humanize,
  marketTypes,
  sessionLabels,
  tradeStatuses,
} from "@/lib/constants";
import { formatMoney as sharedFormatMoney, type Currency } from "@/lib/currency";
import { AnalyticsFilters, ActiveFilterChips, analyticsHref, type FilterChoice, type FilterSelect } from "@/components/AnalyticsFilters";
import { SavedViews } from "@/components/SavedViews";
import { db, getBaseCurrency, getSetupNameMap, getTradesWithMistakes } from "@/lib/data";
import { applyTradeFilters, hasActiveFilters, parseTradeFilters, MISTAKE_ANY, MISTAKE_NONE } from "@/lib/trade-filters";
import { getOptionCatalog } from "@/lib/options";
import { setupSteps, stepResolver } from "@/lib/setups";
import {
  analyticsLeaks,
  averageProcessScore,
  checklistGaps,
  checklistPerformance,
  conditionPerformance,
  disciplineCurve,
  exitEfficiency,
  expectancyBreakdown,
  fundingSummary,
  getTradePnl,
  isBucketSort,
  isThinSample,
  mechanismPerformance,
  MIN_SAMPLE,
  mistakeCostLedger,
  rHistogram,
  sessionPerformance,
  setupPerformance,
  tiltAnalysis,
  setupGradePerformance,
  sortBuckets,
  timeframePerformance,
  type BucketSort,
  type BucketStats,
  type SortDirection,
  type LeakInsight,
  type TiltStats,
} from "@/lib/metrics";

// Analytics in two tiers. The default view answers "how am I doing, and what is
// the one thing hurting me" in plain language. Everything deeper — distributions,
// tilt, sessions, exit quality, the full tables — sits one tap away.
//
// Every stat, table and chart below is a pure function of ONE array, so the
// drill-down is one filter at one boundary rather than a parameter threaded
// through twenty helpers: narrow `trades` and the whole page follows, with no
// section able to forget. Same shape as converting money on read in
// getTradesWithMistakes, and the reason that array is built here and nowhere
// else on this page.
export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams ?? {};
  const [allTrades, setupNameById, options, playbook, savedViews, base] = await Promise.all([
    getTradesWithMistakes(),
    getSetupNameMap(),
    getOptionCatalog(),
    db.list("setups"),
    db.list("savedViews"),
    // Label only — the trades arrive already converted, which is what makes
    // adding an INR-account trade to a USDT-account one give the right answer.
    getBaseCurrency(),
  ]);
  const mistakeTags = await db.list("mistakeTags");

  // THE boundary. Everything from here down reads `trades`, never `allTrades`.
  const filters = parseTradeFilters(params);
  const filtered = hasActiveFilters(filters);
  const trades = applyTradeFilters(allTrades, filters, options, params);
  const sort: BucketSort = isBucketSort(params.sort) ? params.sort : "natural";
  const direction: SortDirection = params.dir === "asc" ? "asc" : "desc";
  const order = (rows: BucketStats[]) => sortBuckets(rows, sort, direction);
  // Clicking the active column flips direction; clicking it a third time drops
  // back to each table's natural order, so there is always a way back to the
  // page as designed without hunting for a reset.
  const sortHref = (column: BucketSort) => {
    // Names read A→Z first; every number reads best-first. Both are what you
    // expect from a first click on that particular column.
    if (sort !== column) return analyticsHref(params, { sort: column, dir: column === "label" ? "asc" : "desc" });
    if (direction === "desc") return analyticsHref(params, { sort: column, dir: "asc" });
    return analyticsHref(params, { sort: null, dir: null });
  };
  const scopeLabel = filtered ? "filtered" : "all time";

  const closed = trades.filter((trade) => trade.status === "CLOSED");
  const closedWithPnl = closed
    .filter((trade) => getTradePnl(trade) != null)
    .sort((a, b) => a.tradeDateTime.getTime() - b.tradeDateTime.getTime());

  const netTotal = closedWithPnl.reduce((sum, trade) => sum + (getTradePnl(trade) ?? 0), 0);
  const expectancy = expectancyBreakdown(trades);
  const discipline = disciplineCurve(trades);
  const ledger = mistakeCostLedger(trades);
  const worstMistake = ledger.find((entry) => entry.totalPnl < 0) ?? null;

  const setups = setupPerformance(trades, setupNameById);
  const sessions = sessionPerformance(trades, sessionLabels);
  const conditions = conditionPerformance(trades, options.labeler("condition"));
  const timeframes = timeframePerformance(trades, options.labeler("tradeTimeframe"));
  const mechanisms = mechanismPerformance(trades, options.labeler("mechanism"));
  // Ordered by the vocabulary itself (A+ before A before B), not by volume.
  const setupGrades = setupGradePerformance(
    trades,
    options.labeler("setupGrade"),
    options.choices("setupGrade").map((choice) => choice.value),
  );
  // How many steps each setup's checklist has, so a trade can be graded against
  // the model it was actually taken on.
  const stepTotals = new Map(playbook.map((setup) => [setup.id, setupSteps(setup.checklist).length]));
  const checklist = checklistPerformance(trades, (trade) => (trade.setupId ? stepTotals.get(trade.setupId) ?? 0 : 0));
  const leaks = analyticsLeaks(trades, setups, conditions, checklistGaps(trades, stepResolver(playbook)));

  const histogram = rHistogram(trades);
  const tilt = tiltAnalysis(trades);
  const funding = fundingSummary(trades);
  const processAvg = averageProcessScore(closed);
  const exitValues = closed.map(exitEfficiency).filter((value): value is number => value != null);
  const exitAvg = exitValues.length ? exitValues.reduce((sum, value) => sum + value, 0) / exitValues.length : null;

  const withR = closedWithPnl.filter((trade) => trade.rMultiple != null);
  const useR = withR.length >= 3;
  const recentOutcomes = (useR ? withR : closedWithPnl).slice(-20).map((trade) => ({
    label: trade.instrument,
    value: useR ? (trade.rMultiple ?? 0) : (getTradePnl(trade) ?? 0),
    tooltip: `${trade.instrument} ${humanize(trade.direction).toLowerCase()} · ${format(trade.tradeDateTime, "d MMM")} · ${
      useR ? `${(trade.rMultiple ?? 0).toFixed(2)}R` : `P&L ${formatMoney(getTradePnl(trade) ?? 0, base)}`
    }`,
  }));

  const smallSample = closedWithPnl.length < 5;

  // The drill-down controls. Every dropdown offers the vocabulary actually in
  // use — the option catalog plus the trader's own labels — so a filter can
  // never list a value no trade could carry, and never miss one it could.
  const selects: FilterSelect[] = [
    { name: "direction", label: "Direction", choices: choices(directions) },
    { name: "status", label: "Status", choices: choices(tradeStatuses) },
    { name: "marketType", label: "Market type", choices: choices(marketTypes) },
    {
      name: "setupId",
      label: "Setup",
      anyLabel: "Any setup",
      choices: [...playbook].sort((a, b) => a.name.localeCompare(b.name)).map((setup) => ({ value: setup.id, label: setup.name })),
    },
    { name: "timeframe", label: "Timeframe", choices: optionChoices(options.choices("tradeTimeframe")) },
    { name: "mechanism", label: "Mechanism", choices: optionChoices(options.choices("mechanism")) },
    { name: "condition", label: "Market condition", choices: optionChoices(options.choices("condition")) },
    { name: "emotionalState", label: "Mind state", choices: optionChoices(options.choices("mindState")) },
    { name: "riskPosture", label: "Risk posture", choices: optionChoices(options.choices("riskPosture")) },
    { name: "setupGrade", label: "Setup grade", choices: optionChoices(options.choices("setupGrade")) },
    { name: "entryGrade", label: "Execution grade", choices: choices(entryGrades) },
    { name: "followedPlan", label: "Followed plan", choices: choices(followedPlanOptions) },
  ];
  const mistakeChoices: FilterChoice[] = [...mistakeTags]
    .sort((a, b) => a.label.localeCompare(b.label))
    .map((tag) => ({ value: tag.id, label: tag.label }));
  const chips = activeChips(params, selects, mistakeChoices);
  const datePresets = buildDatePresets(params);
  const analyticsViews = savedViews.filter((view) => view.path.startsWith("/analytics"));
  const currentPath = analyticsHref(params, {});
  // A sort is furniture, not a filter: a view worth saving has narrowed something.
  const savable = chips.length > 0;

  return (
    <main className="page-shell">
      <PageTitle title="Analytics" subtitle="How you're actually doing, and the one thing to fix. The deep end is one tap away." />

      <SavedViews
        views={analyticsViews}
        currentPath={currentPath}
        hasFilters={savable}
        emptyHint="Narrow the numbers, then name it to keep that view one tap away."
      />
      <ActiveFilterChips params={params} chips={chips} />
      <AnalyticsFilters
        params={params}
        selects={selects}
        mistakeChoices={mistakeChoices}
        datePresets={datePresets}
        open={chips.length > 0}
      />

      {filtered ? (
        <p className="mb-4 rounded-lg border border-forge-blue/30 bg-sky-50 px-3 py-2 text-sm">
          Showing <span className="font-semibold">{trades.length}</span> of {allTrades.length} trades
          {closed.length !== trades.length ? <> · {closed.length} closed</> : null}. Every number, table and chart below
          describes only these — not your whole journal.
        </p>
      ) : null}

      {!closed.length ? (
        <div className="panel muted">
          {filtered ? (
            <>
              No closed trades match these filters. <Link href={analyticsHref({}, {})} className="text-forge-blue hover:underline">Clear them</Link> to
              see the whole journal.
            </>
          ) : (
            <>No closed trades yet. Patterns appear here once you start closing trades with prices filled in.</>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {/* ——— Basic view: readable with zero jargon ——— */}
          <section className="panel bg-gradient-to-r from-white via-white to-sky-50/60">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-forge-muted">Where you stand · {scopeLabel}</p>
                <p className={`mt-1 text-4xl font-semibold tracking-tight ${netTotal >= 0 ? "text-forge-green" : "text-forge-red"}`}>
                  {signedMoney(netTotal, base)}
                </p>
                <p className="mt-1 text-sm text-forge-muted">
                  across {closedWithPnl.length} closed trade{closedWithPnl.length === 1 ? "" : "s"} with P&L recorded
                </p>
              </div>
              <div className="space-y-1 text-sm">
                {expectancy.expectancyCurrency != null ? (
                  <p>
                    A typical trade {expectancy.expectancyCurrency >= 0 ? "makes" : "costs"} you{" "}
                    <span className={`font-semibold ${expectancy.expectancyCurrency >= 0 ? "text-forge-green" : "text-forge-red"}`}>
                      {formatMoney(Math.abs(expectancy.expectancyCurrency), base)}
                    </span>
                    .
                  </p>
                ) : null}
                {expectancy.winRate != null ? (
                  <p>
                    You win <span className="font-semibold">{(expectancy.winRate * 100).toFixed(0)}%</span> of the time
                    {expectancy.avgLoss ? (
                      <> · wins average {formatMoney(expectancy.avgWin, base)}, losses {formatMoney(expectancy.avgLoss, base)}</>
                    ) : null}
                    .
                  </p>
                ) : null}
              </div>
            </div>
            {smallSample ? (
              <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Only {closedWithPnl.length} trade{closedWithPnl.length === 1 ? "" : "s"} so far — everything on this page is a sketch,
                not a verdict. It sharpens as you log more.
              </p>
            ) : null}
          </section>

          <section className="space-y-3">
            <h2 className="font-semibold">What&apos;s hurting me right now</h2>
            <div className="grid gap-3">
              {leaks.slice(0, 2).map((leak) => (
                <LeakCard key={leak.title} leak={leak} />
              ))}
            </div>
          </section>

          <section className="panel">
            <div className="mb-1 flex items-baseline justify-between gap-2">
              <h2 className="font-semibold">Discipline, in money</h2>
              <span className="text-xs text-forge-muted">{scopeLabel}</span>
            </div>
            {discipline.skippedCount + discipline.cappedCount > 0 && discipline.delta > 0 ? (
              <p className="mb-2 text-sm">
                Following your own plan on every trade would have left you{" "}
                <span className="font-semibold text-forge-green">{signedMoney(discipline.delta, base)}</span> better off.
              </p>
            ) : discipline.sample >= 2 ? (
              <p className="mb-2 text-sm text-forge-muted">
                No measurable cost from plan-breaking yet — the two lines sit close together. That&apos;s the goal; keep it that way.
              </p>
            ) : null}
            <DisciplineLines points={discipline.points} title="Actual running P&L vs the plan-following counterfactual" width={1080} />
            <p className="mt-2 text-xs text-forge-muted">
              The gold dashed line replays your history with two rules: trades tagged as impulse entries (FOMO, revenge, no plan,
              boredom, traded a no-trade day) are skipped entirely — even the ones that won — and losses where you moved the stop,
              held past invalidation, or broke the plan are cut at your planned risk. It never adds profit you didn&apos;t actually make.
            </p>
            {discipline.sample >= 2 ? (
              <p className="mt-1 text-xs text-forge-muted">
                Based on {discipline.sample} closed trades · {discipline.skippedCount} skipped as impulse ·{" "}
                {discipline.cappedCount} runaway loss{discipline.cappedCount === 1 ? "" : "es"} capped at planned risk.
              </p>
            ) : null}
          </section>

          <section className="panel">
            <h2 className="mb-1 font-semibold">What each mistake cost you</h2>
            <p className="mb-3 text-sm text-forge-muted">
              {worstMistake ? (
                <>
                  &quot;{worstMistake.label}&quot; is your most expensive habit:{" "}
                  <span className="font-semibold text-forge-red">{signedMoney(worstMistake.totalPnl, base)}</span> across{" "}
                  {worstMistake.count} trade{worstMistake.count === 1 ? "" : "s"}.
                </>
              ) : ledger.length ? (
                <>Trades carrying your tagged mistakes are still net positive — luck, not a license.</>
              ) : (
                <>Tag mistakes when you review trades and each one becomes a number here.</>
              )}
            </p>
            {ledger.length ? (
              <>
                <MoneyBars
                  ariaLabel="Net P&L of trades carrying each mistake tag"
                  items={ledger.slice(0, 6).map((entry) => ({
                    label: entry.label,
                    value: entry.totalPnl,
                    sub: `${entry.count} trade${entry.count === 1 ? "" : "s"}`,
                    tooltip: `${entry.label}: ${signedMoney(entry.totalPnl, base)} across ${entry.count} trade${entry.count === 1 ? "" : "s"}`,
                  }))}
                />
                <p className="mt-2 text-[11px] text-forge-muted">
                  Each bar is the total P&L of trades you tagged with that mistake. A trade with several tags counts fully under each.
                </p>
              </>
            ) : (
              <EmptyChart text="No mistakes tagged on closed trades yet." />
            )}
          </section>

          {/* ——— Advanced view: one tap, as deep as the data supports ——— */}
          <details className="panel">
            <summary className="cursor-pointer font-semibold">Go deeper — distributions, tilt, sessions, full tables</summary>
            <div className="mt-4 space-y-6">
              <section>
                <h3 className="mb-1 font-semibold">Your R-multiples, as a shape</h3>
                <p className="mb-3 text-sm text-forge-muted">
                  R measures each result in units of what you planned to risk: a disciplined loss is −1R or better. Healthy trading
                  stacks losses in the &quot;−1 to 0&quot; bucket and lets winners reach the right side.
                </p>
                {histogram.sample >= 5 ? (
                  <>
                    <BinColumns bins={histogram.bins} ariaLabel="Distribution of R-multiples across closed trades" />
                    <div className="mt-2 space-y-1 text-xs text-forge-muted">
                      <p>Based on {histogram.sample} closed trades with entry, stop and exit prices.</p>
                      {histogram.beyondPlannedLoss > 0 ? (
                        <p className="font-medium text-forge-red">
                          {histogram.beyondPlannedLoss} loss{histogram.beyondPlannedLoss === 1 ? "" : "es"} ended bigger than the risk
                          you planned — that is exactly the money the stop was supposed to protect.
                        </p>
                      ) : (
                        <p className="font-medium text-forge-green">No loss has exceeded your planned risk. That is real discipline.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <EmptyChart text={`Needs at least 5 closed trades with entry + stop + exit prices (you have ${histogram.sample}).`} />
                )}
              </section>

              <section>
                <h3 className="mb-1 font-semibold">Right after a loss</h3>
                <p className="mb-3 text-sm text-forge-muted">
                  Trades opened within {tilt.windowHours} hours of a losing trade, against everything else. This is where tilt shows
                  up as a number. (Timing uses entry times — the journal doesn&apos;t record exact exit times.)
                </p>
                {tilt.afterLoss.count >= 4 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <TiltCard title={`Soon after a loss (${tilt.afterLoss.count} trades)`} stats={tilt.afterLoss} currency={base} highlight />
                    <TiltCard title={`Everything else (${tilt.baseline.count} trades)`} stats={tilt.baseline} currency={base} />
                  </div>
                ) : (
                  <EmptyChart
                    text={`Needs at least 4 closed trades opened within ${tilt.windowHours}h of a loss (you have ${tilt.afterLoss.count}). No news is good news here.`}
                  />
                )}
              </section>

              <section>
                <h3 className="mb-1 font-semibold">When you trade, by session</h3>
                <p className="mb-3 text-sm text-forge-muted">Crypto never closes, but you have hours where you&apos;re sharp and hours where you donate.</p>
                {sessions.length ? (
                  <>
                    <MoneyBars
                      ariaLabel="Net P&L by trading session"
                      items={sessions.map((session) => ({
                        label: session.label,
                        value: session.netPnl,
                        sub: `${session.count} trade${session.count === 1 ? "" : "s"}${session.winRate != null ? ` · wins ${(session.winRate * 100).toFixed(0)}%` : ""}`,
                        tooltip: `${session.label}: ${signedMoney(session.netPnl, base)} over ${session.count} trades`,
                      }))}
                    />
                    {sessions.some((session) => session.count < 5) ? (
                      <p className="mt-2 text-[11px] text-forge-muted">Sessions with under 5 trades are noise, not signal — read them lightly.</p>
                    ) : null}
                  </>
                ) : (
                  <EmptyChart text="Closed trades will bucket themselves into sessions here." />
                )}
              </section>

              <section>
                <h3 className="mb-1 font-semibold">How much of the move you actually keep</h3>
                <p className="mb-3 text-sm text-forge-muted">
                  Of the best price each trade reached in your favor, the share you banked before exiting. Low numbers mean winners
                  are being cut early. Needs the &quot;best price reached&quot; field filled in on the trade.
                </p>
                {exitAvg != null && exitValues.length >= 3 ? (
                  <>
                    <Meter value={exitAvg} ariaLabel="Average share of the favorable move captured" />
                    <p className="mt-2 text-xs text-forge-muted">Average across {exitValues.length} trades with that field logged.</p>
                  </>
                ) : (
                  <EmptyChart text={`Needs at least 3 closed trades with the best-price-reached (MFE) field (you have ${exitValues.length}).`} />
                )}
              </section>

              <section>
                <h3 className="mb-1 font-semibold">Last {recentOutcomes.length} closed trades{useR ? " · in R" : " · P&L"}</h3>
                <DivergingColumns items={recentOutcomes} unit={useR ? "R" : ""} ariaLabel="Outcome of recent closed trades" />
              </section>

              <section>
                <h3 className="mb-1 font-semibold">Expectancy breakdown</h3>
                <p className="mb-3 text-sm text-forge-muted">Expectancy = win rate × avg win − loss rate × avg loss. The honest version of &quot;am I profitable?&quot;.</p>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <Metric label="Sample size" value={String(expectancy.sampleSize)} />
                  <Metric label="Win rate" value={expectancy.winRate == null ? "NA" : `${(expectancy.winRate * 100).toFixed(0)}%`} />
                  <Metric label="Avg win" value={expectancy.avgWin.toFixed(2)} tone="good" />
                  <Metric label="Avg loss" value={expectancy.avgLoss.toFixed(2)} tone="bad" />
                  <Metric label="Win/loss ratio" value={expectancy.avgLoss ? (expectancy.avgWin / expectancy.avgLoss).toFixed(2) : "NA"} />
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Metric label="Avg process score" value={processAvg == null ? "NA" : `${processAvg.toFixed(0)}/100`} hint="Rule-following, independent of P&L" tone={processAvg == null ? undefined : processAvg >= 60 ? "good" : "bad"} />
                  <Metric label="Expectancy / trade" value={expectancy.expectancyR == null ? "NA" : `${expectancy.expectancyR.toFixed(2)}R`} hint={expectancy.expectancyCurrency == null ? "" : `${expectancy.expectancyCurrency.toFixed(2)} per trade`} tone={expectancy.expectancyR == null ? undefined : expectancy.expectancyR >= 0 ? "good" : "bad"} />
                  <Metric
                    label="Funding drag"
                    value={funding.dragPct == null ? "NA" : `${(funding.dragPct * 100).toFixed(0)}%`}
                    hint="Funding paid ÷ gross profit · red >15%"
                    tone={funding.dragPct == null ? undefined : funding.dragPct > 0.15 ? "bad" : funding.dragPct > 0.1 ? "warn" : "good"}
                  />
                </div>
              </section>

              {leaks.length > 2 ? (
                <section>
                  <h3 className="mb-2 font-semibold">Other leaks</h3>
                  <div className="grid gap-3">
                    {leaks.slice(2).map((leak) => (
                      <LeakCard key={leak.title} leak={leak} />
                    ))}
                  </div>
                </section>
              ) : null}

              <p className="text-xs text-forge-muted">
                {sort === "natural"
                  ? "Tap any column heading to re-order every table below. Tap it again to reverse, once more to go back to this order."
                  : `Every table is sorted by ${sortLabel(sort)}, ${direction === "asc" ? "lowest" : "highest"} first. Tap that heading again to ${direction === "asc" ? "go back to each table's own order" : "reverse it"}.`}
              </p>
              <BucketTable title="By setup" subtitle="Which playbook setups actually have an edge." rows={order(setups)} firstColLabel="Setup" currency={base} sort={sort} direction={direction} sortHref={sortHref} />
              <BucketTable title="By session (UTC)" subtitle="When in the 24/7 cycle your edge lives." rows={order(sessions)} firstColLabel="Session" currency={base} sort={sort} direction={direction} sortHref={sortHref} />
              <BucketTable title="By market condition" subtitle="Trend vs chop vs news — the context that makes or breaks you." rows={order(conditions)} firstColLabel="Condition" currency={base} sort={sort} direction={direction} sortHref={sortHref} />
              <BucketTable
                title="By timeframe"
                subtitle="Which charts you actually make money on. A trade counts in every timeframe it used, so these add up to more than your trade count."
                rows={order(timeframes)}
                firstColLabel="Timeframe"
                currency={base}
                sort={sort}
                direction={direction}
                sortHref={sortHref}
              />
              <BucketTable
                title="By setup grade"
                subtitle="Your own read on the opportunity, scored against what it paid. If your A+ setups don't out-earn your Bs, the grading isn't measuring what you think it is — and if they do, taking fewer Bs is the cheapest edge you have."
                rows={order(setupGrades)}
                firstColLabel="Setup grade"
                currency={base}
                sort={sort}
                direction={direction}
                sortHref={sortHref}
              />
              <BucketTable
                title="By mechanism"
                subtitle="What the entry was built out of — FVG, order block, sweep. The one table that tells you which part of the model is carrying you."
                rows={order(mechanisms)}
                firstColLabel="Mechanism"
                currency={base}
                hrefFor={(row) => `/mechanisms/${row.key}`}
                sort={sort}
                direction={direction}
                sortHref={sortHref}
              />
              {checklist.length ? (
                <BucketTable
                  title="Model followed, or not"
                  subtitle="Closed trades on a setup with a checklist, split by whether every step was actually there. If these two rows look the same, the checklist isn't earning its place yet."
                  rows={order(checklist)}
                  firstColLabel="Checklist"
                  currency={base}
                  sort={sort}
                  direction={direction}
                  sortHref={sortHref}
                />
              ) : null}
            </div>
          </details>
        </div>
      )}
    </main>
  );
}

/** A closed enum as filter choices, read the way the app reads it everywhere. */
function choices(values: readonly string[]): FilterChoice[] {
  return values.map((value) => ({ value, label: humanize(value) }));
}

/** An extendable vocabulary as filter choices — built-ins plus the trader's own
 *  labels, so a grade or mechanism they invented is filterable the day they
 *  invent it. */
function optionChoices(values: { value: string; label: string }[]): FilterChoice[] {
  return values.map((choice) => ({ value: choice.value, label: choice.label }));
}

/**
 * The active filters, read back as English. Each chip names the dimension and
 * the LABEL, never the stored value — "Setup grade: A+", not "setupGrade=A_PLUS" —
 * because a chip the trader can't read is a filter they can't undo.
 */
function activeChips(
  params: Record<string, string | undefined>,
  selects: FilterSelect[],
  mistakeChoices: FilterChoice[],
): { param: string; label: string }[] {
  const chips: { param: string; label: string }[] = [];
  for (const select of selects) {
    const value = params[select.name];
    if (!value) continue;
    const choice = select.choices.find((entry) => entry.value === value);
    chips.push({ param: select.name, label: `${select.label}: ${choice?.label ?? humanize(value)}` });
  }
  if (params.q?.trim()) chips.push({ param: "q", label: `Matching: ${params.q.trim()}` });
  if (params.instrument) chips.push({ param: "instrument", label: `Symbol: ${params.instrument.toUpperCase()}` });
  if (params.from) chips.push({ param: "from", label: `From ${params.from}` });
  if (params.to) chips.push({ param: "to", label: `To ${params.to}` });
  if (params.outcome) chips.push({ param: "outcome", label: params.outcome === "wins" ? "Winners only" : "Losers only" });
  if (params.journaled) {
    chips.push({ param: "journaled", label: params.journaled === "archive" ? "Archive trades only" : "Journaled trades only" });
  }
  if (params.mistakeTagId) {
    const value = params.mistakeTagId;
    const label =
      value === MISTAKE_ANY ? "Any mistake tagged"
      : value === MISTAKE_NONE ? "No mistakes tagged"
      : `Mistake: ${mistakeChoices.find((choice) => choice.value === value)?.label ?? "unknown tag"}`;
    chips.push({ param: "mistakeTagId", label });
  }
  if (params.period || params.date) {
    chips.push({ param: "period", label: `Calendar range: ${params.date ?? params.period}` });
  }
  return chips;
}

/**
 * Quick ranges, as links rather than a preset param. Resolving a preset to real
 * from/to dates at click time means the URL says exactly which days it covers —
 * so a saved "last 30 days" view stays the 30 days it was saved for instead of
 * quietly sliding, and the date boxes show what is actually being measured.
 */
function buildDatePresets(params: Record<string, string | undefined>) {
  const today = new Date();
  const iso = (date: Date) => format(date, "yyyy-MM-dd");
  const ranges: { label: string; from: string | null; to: string | null }[] = [
    { label: "Last 30 days", from: iso(subDays(today, 29)), to: iso(today) },
    { label: "Last 90 days", from: iso(subDays(today, 89)), to: iso(today) },
    { label: "This month", from: iso(startOfMonth(today)), to: iso(today) },
    { label: "This year", from: iso(startOfYear(today)), to: iso(today) },
    { label: "All time", from: null, to: null },
  ];
  return ranges.map((range) => ({
    label: range.label,
    href: analyticsHref(params, { from: range.from, to: range.to }),
    active: (params.from ?? null) === range.from && (params.to ?? null) === range.to,
  }));
}

function sortLabel(sort: BucketSort) {
  const labels: Record<BucketSort, string> = {
    natural: "each table's own order",
    label: "name",
    count: "number of trades",
    winRate: "win rate",
    expectancyR: "expectancy",
    netPnl: "net P&L",
    avgProcessScore: "process score",
  };
  return labels[sort];
}

function LeakCard({ leak }: { leak: LeakInsight }) {
  const border = leak.severity === "high" ? "border-forge-red" : leak.severity === "medium" ? "border-amber-500" : "border-forge-green";
  const titleColor = leak.severity === "high" ? "text-forge-red" : leak.severity === "medium" ? "text-amber-700" : "text-forge-green";
  return (
    <div className={`rounded-lg border-l-4 ${border} bg-forge-panel p-3`}>
      <div className={`text-sm font-semibold ${titleColor}`}>{leak.title}</div>
      <div className="mt-1 text-sm text-forge-muted">{leak.detail}</div>
    </div>
  );
}

function TiltCard({ title, stats, currency, highlight = false }: { title: string; stats: TiltStats; currency: Currency; highlight?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? "border-forge-red/40 bg-red-50/40" : "border-forge-line bg-forge-panel"}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-forge-muted">{title}</p>
      <div className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div>
          <p className="text-[11px] text-forge-muted">Avg R</p>
          <p className={`font-semibold ${stats.avgR == null ? "" : stats.avgR >= 0 ? "text-forge-green" : "text-forge-red"}`}>
            {stats.avgR == null ? "—" : `${stats.avgR >= 0 ? "+" : ""}${stats.avgR.toFixed(2)}R`}
          </p>
        </div>
        <div>
          <p className="text-[11px] text-forge-muted">Win rate</p>
          <p className="font-semibold">{stats.winRate == null ? "—" : `${(stats.winRate * 100).toFixed(0)}%`}</p>
        </div>
        <div>
          <p className="text-[11px] text-forge-muted">Net P&L</p>
          <p className={`font-semibold ${stats.netPnl >= 0 ? "text-forge-green" : "text-forge-red"}`}>{signedMoney(stats.netPnl, currency)}</p>
        </div>
      </div>
    </div>
  );
}

// Which column each header sorts by. `label` is the first column, whatever that
// table calls it — one map, so a renamed header can never sort by the wrong
// field.
const SORTABLE_COLUMNS: { header: string; sort: BucketSort }[] = [
  { header: "Trades", sort: "count" },
  { header: "Win rate", sort: "winRate" },
  { header: "Expectancy (R)", sort: "expectancyR" },
  { header: "Net P&L", sort: "netPnl" },
  { header: "Process", sort: "avgProcessScore" },
];

function BucketTable({
  title,
  subtitle,
  rows,
  firstColLabel,
  currency,
  hrefFor,
  sort,
  direction,
  sortHref,
}: {
  title: string;
  subtitle: string;
  rows: BucketStats[];
  firstColLabel: string;
  /** What the Net P&L column is in. Every row is already converted to it. */
  currency: Currency;
  /** Optional: makes the first column a link (mechanisms have their own page). */
  hrefFor?: (row: BucketStats) => string;
  /** The active sort, shared by every table on the page — see sortHref below. */
  sort: BucketSort;
  direction: SortDirection;
  /** Clicking a header re-sorts EVERY table, because a sort here is a way of
   *  reading the page ("show me my worst buckets"), not a property of one
   *  table. One control, one URL, one answer to "how is this ordered". */
  sortHref: (sort: BucketSort) => string;
}) {
  const thin = rows.filter((row) => isThinSample(row.count)).length;
  return (
    <section>
      <h3 className="font-semibold">{title}</h3>
      <p className="mb-3 text-sm text-forge-muted">{subtitle}</p>
      {!rows.length ? (
        <p className="muted">Not enough tagged closed trades yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-forge-line">
            <table className="min-w-full text-sm">
              <thead className="bg-forge-panel">
                <tr>
                  {[{ header: firstColLabel, sort: "label" as BucketSort }, ...SORTABLE_COLUMNS].map((column) => {
                    const active = sort === column.sort;
                    return (
                      <th key={column.header} className="px-3 py-2 text-left font-medium">
                        <Link
                          href={sortHref(column.sort)}
                          className={`inline-flex items-center gap-1 transition hover:text-forge-blue ${active ? "text-forge-blue" : ""}`}
                          title={`Sort every table by ${column.header.toLowerCase()}`}
                        >
                          {column.header}
                          {active ? <span aria-hidden="true">{direction === "asc" ? "↑" : "↓"}</span> : null}
                          {active ? <span className="sr-only">sorted {direction === "asc" ? "ascending" : "descending"}</span> : null}
                        </Link>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  // A thin row keeps its numbers but loses the colour and the
                  // weight: green/red is what makes a number read as a verdict,
                  // and three trades don't earn a verdict.
                  const light = isThinSample(row.count);
                  const tone = (positive: boolean) =>
                    light ? "text-forge-muted" : positive ? "text-forge-green" : "text-forge-red";
                  return (
                    <tr key={row.key} className={`border-t border-forge-line ${light ? "bg-forge-panel/30" : ""}`}>
                      <td className={`px-3 py-2 font-medium ${light ? "text-forge-muted" : ""}`}>
                        {hrefFor ? (
                          <Link href={hrefFor(row)} className="transition hover:text-forge-blue hover:underline">
                            {row.label}
                          </Link>
                        ) : (
                          row.label
                        )}
                        {light ? (
                          <span className="ml-2 rounded-full bg-white px-2 py-0.5 text-[11px] font-normal text-forge-muted ring-1 ring-forge-line">
                            {MIN_SAMPLE - row.count} more to read this
                          </span>
                        ) : null}
                      </td>
                      <td className={`px-3 py-2 ${light ? "text-forge-muted" : ""}`}>{row.count}</td>
                      <td className={`px-3 py-2 ${light ? "text-forge-muted" : ""}`}>{row.winRate == null ? "NA" : `${(row.winRate * 100).toFixed(0)}%`}</td>
                      <td className={`px-3 py-2 font-medium ${row.expectancyR == null ? (light ? "text-forge-muted" : "") : tone(row.expectancyR >= 0)}`}>
                        {row.expectancyR == null ? "NA" : `${row.expectancyR.toFixed(2)}R`}
                      </td>
                      <td className={`px-3 py-2 ${tone(row.netPnl >= 0)}`}>{formatMoney(row.netPnl, currency)}</td>
                      <td className={`px-3 py-2 ${light ? "text-forge-muted" : ""}`}>{row.avgProcessScore == null ? "NA" : `${row.avgProcessScore.toFixed(0)}`}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {thin ? (
            <p className="mt-2 text-[11px] text-forge-muted">
              {thin === rows.length ? "Every row here is" : `${thin} row${thin === 1 ? " here is" : "s here are"}`} under {MIN_SAMPLE} closed
              trades — greyed out because that isn&apos;t enough to conclude anything yet. Keep logging; they colour in on their own.
            </p>
          ) : null}
        </>
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

// The app's one money formatter, with the currency required at every call
// site: two margin accounts make an unlabelled total impossible to check.
function formatMoney(value: number, currency: Currency) {
  return sharedFormatMoney(value, currency, { absolute: true });
}

function signedMoney(value: number, currency: Currency) {
  return sharedFormatMoney(value, currency, { signed: true });
}
