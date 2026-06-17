import { format, startOfDay } from "date-fns";
import { Trash2 } from "lucide-react";
import { deleteDailyJournalAction, saveDailyJournalAction } from "@/app/actions";
import { BoolSelect, PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { mindStateOptions, tradingModes } from "@/lib/constants";
import { getTodayJournal } from "@/lib/data";

export default async function DailyPage({ searchParams }: { searchParams?: Promise<{ date?: string }> }) {
  const params = await searchParams;
  const selectedDate = params?.date ? startOfDay(new Date(params.date)) : startOfDay(new Date());
  const journal = await getTodayJournal(selectedDate);

  return (
    <main className="page-shell max-w-4xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageTitle
          title="Daily"
          subtitle="Beginner mode: set guardrails first, then write the shortest useful review at the end."
        />
        {journal ? (
          <form action={deleteDailyJournalAction}>
            <input type="hidden" name="id" value={journal.id} />
            <button className="button-danger" type="submit" title="Delete daily journal" aria-label="Delete daily journal">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Delete day
            </button>
          </form>
        ) : null}
      </div>

      <form action={saveDailyJournalAction} className="space-y-5">
        <section className="panel space-y-4">
          <div>
            <h2 className="font-semibold">Daily check-in</h2>
            <p className="muted">This should take less than a minute.</p>
          </div>
          <TextField label="Date" name="date" type="date" defaultValue={format(selectedDate, "yyyy-MM-dd")} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Trading mode" name="tradingMode" options={tradingModes} defaultValue={journal?.tradingMode ?? "PAPER"} />
            <SelectField label="Mind state" name="currentState" options={mindStateOptions} includeBlank defaultValue={journal?.currentState} />
            <TextField label="Markets watched" name="marketsWatched" defaultValue={journal?.marketsWatched} placeholder="BTC, ETH, NIFTY..." />
            <TextField label="Max loss for day" name="maxLossForDay" defaultValue={journal?.maxLossForDay} placeholder="Example: -2R or -₹5,000" />
            <TextField label="Max trades for day" name="maxTradesForDay" type="number" defaultValue={journal?.maxTradesForDay} />
            <TextField label="Learning focus" name="learningFocus" defaultValue={journal?.learningFocus} placeholder="Example: wait for pullback entries" />
          </div>
          <TextAreaField label="Reason not to trade" name="reasonNotToTrade" defaultValue={journal?.reasonNotToTrade} rows={3} />
        </section>

        <section id="eod" className="panel space-y-4">
          <div>
            <h2 className="font-semibold">End-of-day review</h2>
            <p className="muted">Keep it specific. The goal is pattern recognition, not a perfect essay.</p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <BoolSelect label="Did I trade today?" name="tradedToday" defaultValue={journal?.tradedToday} />
            <BoolSelect label="Followed max loss?" name="followedMaxLoss" defaultValue={journal?.followedMaxLoss} />
            <BoolSelect label="Followed max trades?" name="followedMaxTrades" defaultValue={journal?.followedMaxTrades} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAreaField label="Best decision" name="bestDecision" defaultValue={journal?.bestDecision} rows={3} />
            <TextAreaField label="Worst decision" name="worstDecision" defaultValue={journal?.worstDecision} rows={3} />
            <TextField label="Main emotion" name="mainEmotion" defaultValue={journal?.mainEmotion} />
            <TextField label="Main mistake" name="mainMistake" defaultValue={journal?.mainMistake} />
            <TextAreaField label="One thing done well" name="oneThingDoneWell" defaultValue={journal?.oneThingDoneWell} rows={3} />
            <TextAreaField label="One thing to avoid tomorrow" name="oneThingToAvoidTomorrow" defaultValue={journal?.oneThingToAvoidTomorrow} rows={3} />
            <TextField label="Discipline score 1-10" name="disciplineScore" type="number" defaultValue={journal?.disciplineScore} />
          </div>
          <TextAreaField label="Notes" name="eodNotes" defaultValue={journal?.eodNotes} rows={4} />
        </section>

        <button className="button" type="submit">Save daily journal</button>
      </form>
    </main>
  );
}
