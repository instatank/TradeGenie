import Link from "next/link";
import { format, isSameDay, startOfDay } from "date-fns";
import { Sunrise, Sunset, Trash2 } from "lucide-react";
import { deleteDailyJournalAction, saveEveningReviewAction, saveMorningCheckinAction } from "@/app/actions";
import { ChipRadioGroup, ScaleChips, YesNoChips } from "@/components/Chips";
import { PageTitle } from "@/components/Fields";
import { humanize, mindStateLabel, mindStateOptions } from "@/lib/constants";
import { db, getTodayJournal } from "@/lib/data";
import { getTradePnl } from "@/lib/metrics";

const modeOptions = [
  { value: "LIVE", label: "Live" },
  { value: "PAPER", label: "Paper" },
  { value: "OBSERVE_ONLY", label: "Just watching" },
  { value: "NO_TRADING", label: "Day off" },
];

// Two rituals, two small cards. Morning: mood + guardrails, under a minute.
// Evening: three taps and two lines, 2–4 minutes. Everything else is optional.
export default async function DailyPage({ searchParams }: { searchParams?: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const selectedDate = params?.date ? startOfDay(new Date(params.date)) : startOfDay(new Date());
  const dateParam = format(selectedDate, "yyyy-MM-dd");
  const [journal, allTrades] = await Promise.all([getTodayJournal(selectedDate), db.list("trades")]);
  const dayTrades = allTrades
    .filter((trade) => isSameDay(trade.tradeDateTime, selectedDate))
    .sort((a, b) => a.tradeDateTime.getTime() - b.tradeDateTime.getTime());

  return (
    <main className="page-shell max-w-3xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageTitle title={format(selectedDate, "EEEE, d MMMM")} subtitle="Check in before the session, review after it. Small and honest beats long and perfect." />
        <form className="flex items-center gap-2">
          <input type="date" name="date" defaultValue={dateParam} className="input" />
          <button className="button-secondary" type="submit">Go</button>
        </form>
      </div>

      {/* ---- Morning ---- */}
      <form action={saveMorningCheckinAction} className="panel space-y-4">
        <input type="hidden" name="date" value={dateParam} />
        <div className="flex items-center gap-2">
          <Sunrise className="h-4 w-4 text-forge-gold" aria-hidden="true" />
          <h2 className="font-semibold">Morning check-in</h2>
          <span className="text-xs text-forge-muted">· under a minute</span>
        </div>

        <ChipRadioGroup
          label="How are you arriving today?"
          name="currentState"
          options={mindStateOptions.map((state) => ({ value: state, label: mindStateLabel(state) }))}
          defaultValue={journal?.currentState}
          hint="Tilted, tired or FOMO? That's useful to know before the first trade, not after the last one."
        />

        <ChipRadioGroup label="Today I'm trading" name="tradingMode" options={modeOptions} defaultValue={journal?.tradingMode ?? "PAPER"} />

        <div className="grid gap-4 sm:grid-cols-3">
          <label className="field">
            <span className="label">Max trades today</span>
            <input name="maxTradesForDay" type="number" min="0" defaultValue={journal?.maxTradesForDay ?? ""} placeholder="e.g. 2" className="input" />
          </label>
          <label className="field">
            <span className="label">Max loss today</span>
            <input name="maxLossForDay" defaultValue={journal?.maxLossForDay ?? ""} placeholder="e.g. -2R or -₹5,000" className="input" />
          </label>
          <label className="field">
            <span className="label">One thing to practice</span>
            <input name="learningFocus" defaultValue={journal?.learningFocus ?? ""} placeholder="e.g. wait for the retest" className="input" />
          </label>
        </div>

        <details className="rounded-lg border border-forge-line p-3">
          <summary className="cursor-pointer text-sm font-semibold text-forge-muted">More (optional)</summary>
          <div className="mt-3 grid gap-4">
            <label className="field">
              <span className="label">Markets I&apos;m watching</span>
              <input name="marketsWatched" defaultValue={journal?.marketsWatched ?? ""} placeholder="BTC, ETH, SOL…" className="input" />
            </label>
            <label className="field">
              <span className="label">Reasons I might not trade today</span>
              <textarea name="reasonNotToTrade" rows={2} defaultValue={journal?.reasonNotToTrade ?? ""} className="textarea min-h-16" />
            </label>
          </div>
        </details>

        <button className="button" type="submit">Check in</button>
      </form>

      {/* ---- Evening ---- */}
      <form id="evening" action={saveEveningReviewAction} className="panel mt-5 space-y-4">
        <input type="hidden" name="date" value={dateParam} />
        <div className="flex items-center gap-2">
          <Sunset className="h-4 w-4 text-forge-blue" aria-hidden="true" />
          <h2 className="font-semibold">Evening review</h2>
          <span className="text-xs text-forge-muted">· 2–4 minutes</span>
        </div>

        {dayTrades.length ? (
          <div className="rounded-lg border border-forge-line p-3">
            <p className="mb-2 text-sm font-semibold">Today&apos;s trades</p>
            <div className="space-y-1.5">
              {dayTrades.map((trade) => {
                const pnl = getTradePnl(trade);
                return (
                  <Link key={trade.id} href={`/trades/${trade.id}`} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 text-sm transition hover:bg-forge-panel">
                    <span>
                      <span className="font-medium">{trade.instrument}</span>
                      <span className="text-forge-muted"> · {humanize(trade.direction)} · {humanize(trade.status)}</span>
                    </span>
                    <span className={`shrink-0 font-medium ${pnl == null ? "text-forge-muted" : pnl >= 0 ? "text-forge-green" : "text-forge-red"}`}>
                      {pnl == null ? "review →" : pnl.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
                    </span>
                  </Link>
                );
              })}
            </div>
            <p className="mt-2 text-xs text-forge-muted">Tap a trade to review it — that&apos;s where plan-followed, grade and mistakes live.</p>
          </div>
        ) : (
          <p className="rounded-lg bg-forge-panel px-3 py-2 text-sm text-forge-muted">
            No trades logged today. If that was the plan, say so below — a disciplined no-trade day is a win.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <YesNoChips label="Did you trade today?" name="tradedToday" defaultValue={journal?.tradedToday} />
          <YesNoChips label="Stayed inside max loss?" name="followedMaxLoss" defaultValue={journal?.followedMaxLoss} />
          <YesNoChips label="Stayed inside max trades?" name="followedMaxTrades" defaultValue={journal?.followedMaxTrades} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="field">
            <span className="label">One thing you did well</span>
            <input name="oneThingDoneWell" defaultValue={journal?.oneThingDoneWell ?? ""} placeholder="e.g. skipped a FOMO entry" className="input" />
          </label>
          <label className="field">
            <span className="label">One thing to avoid tomorrow</span>
            <input name="oneThingToAvoidTomorrow" defaultValue={journal?.oneThingToAvoidTomorrow ?? ""} placeholder="e.g. adding to losers" className="input" />
          </label>
        </div>

        <ScaleChips
          label="Discipline today, 1–10"
          name="disciplineScore"
          defaultValue={journal?.disciplineScore}
          hint="How well you followed your own rules — nothing to do with P&L."
        />

        <details className="rounded-lg border border-forge-line p-3">
          <summary className="cursor-pointer text-sm font-semibold text-forge-muted">More (optional)</summary>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <label className="field">
              <span className="label">Best decision</span>
              <textarea name="bestDecision" rows={2} defaultValue={journal?.bestDecision ?? ""} className="textarea min-h-16" />
            </label>
            <label className="field">
              <span className="label">Worst decision</span>
              <textarea name="worstDecision" rows={2} defaultValue={journal?.worstDecision ?? ""} className="textarea min-h-16" />
            </label>
            <label className="field">
              <span className="label">Main emotion</span>
              <input name="mainEmotion" defaultValue={journal?.mainEmotion ?? ""} className="input" />
            </label>
            <label className="field">
              <span className="label">Main mistake</span>
              <input name="mainMistake" defaultValue={journal?.mainMistake ?? ""} className="input" />
            </label>
            <label className="field sm:col-span-2">
              <span className="label">Notes</span>
              <textarea name="eodNotes" rows={3} defaultValue={journal?.eodNotes ?? ""} className="textarea min-h-20" />
            </label>
          </div>
        </details>

        <button className="button" type="submit">Finish the day</button>
      </form>

      {journal ? (
        <form action={deleteDailyJournalAction} className="mt-5 flex justify-end">
          <input type="hidden" name="id" value={journal.id} />
          <button className="button-danger" type="submit" title="Delete this day's journal">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete this day
          </button>
        </form>
      ) : null}
    </main>
  );
}
