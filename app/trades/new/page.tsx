import Link from "next/link";
import { Lightbulb, ListChecks, Pin } from "lucide-react";
import { createTradeAction } from "@/app/actions";
import { CheckboxGroup, PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { conditionTagOptions, directions, emotionalStates, entryGrades, marketTypes, riskPostures, tradeStatuses } from "@/lib/constants";
import { getActiveSetups, getResurfacedLessons, getTodayJournal } from "@/lib/data";
import { getSettings } from "@/lib/settings-store";

const preTradeChecklist = [
  "I can state the setup and why it qualifies right now.",
  "I have written a clear invalidation (where I'm wrong).",
  "Position size matches my intended risk in R, not a gut feeling.",
  "I checked the funding rate and it doesn't quietly eat the edge.",
  "I am within today's max-trades and max-loss limits.",
  "This is not a revenge, FOMO, or boredom entry.",
];

export default async function NewTradePage() {
  const [settings, lessons, setups, todayJournal] = await Promise.all([
    getSettings(),
    getResurfacedLessons(3),
    getActiveSetups(),
    getTodayJournal(new Date()),
  ]);

  return (
    <main className="page-shell max-w-3xl">
      <PageTitle title="Quick trade note" subtitle="Only four fields are required. Capture the idea before the details get fuzzy." />

      {lessons.length ? (
        <section className="panel mb-4 border-l-4 border-forge-blue">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Lightbulb className="h-4 w-4 text-forge-blue" aria-hidden="true" />
            Your active lessons — read before you enter
          </div>
          <ul className="space-y-1 text-sm">
            {lessons.map((lesson) => (
              <li key={lesson.id} className="flex items-start gap-2">
                {lesson.isPinned ? <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forge-blue" aria-hidden="true" /> : <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-forge-muted" />}
                <span>{lesson.lessonText}</span>
              </li>
            ))}
          </ul>
          <Link href="/lessons" className="mt-2 inline-block text-xs text-forge-blue hover:underline">Manage lessons →</Link>
        </section>
      ) : null}

      {todayJournal?.maxTradesForDay != null || todayJournal?.maxLossForDay ? (
        <p className="mb-4 rounded-lg bg-forge-panel px-3 py-2 text-sm text-forge-muted">
          Today&apos;s guardrails:{" "}
          {todayJournal?.maxTradesForDay != null ? <span className="font-medium text-forge-ink">max {todayJournal.maxTradesForDay} trades</span> : null}
          {todayJournal?.maxTradesForDay != null && todayJournal?.maxLossForDay ? " · " : ""}
          {todayJournal?.maxLossForDay ? <span className="font-medium text-forge-ink">max loss {todayJournal.maxLossForDay}</span> : null}
        </p>
      ) : null}

      <details className="panel mb-4">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
          <ListChecks className="h-4 w-4 text-forge-green" aria-hidden="true" />
          Pre-trade checklist
        </summary>
        <ul className="mt-3 space-y-2 text-sm">
          {preTradeChecklist.map((item) => (
            <li key={item} className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-forge-muted">A nudge, not a gate. If you can&apos;t honestly check these, the answer is usually no trade.</p>
      </details>

      <form action={createTradeAction} className="panel space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Instrument" name="instrument" required placeholder="BTC, SOL, NIFTY" />
          <SelectField label="Direction" name="direction" options={directions} defaultValue="UNKNOWN" />
          <SelectField label="Status" name="status" options={tradeStatuses} defaultValue="IDEA" />
        </div>
        <TextAreaField label="Entry thesis" name="entryThesis" required placeholder="Why this trade, why now?" rows={4} />

        <label className="field">
          <span className="label">Pre-mortem — what is most likely to make this trade fail?</span>
          <textarea name="premortem" rows={2} placeholder="Name your most probable mistake now, while you can still avoid it." className="textarea" />
        </label>

        <details className="rounded-lg border border-forge-line p-3" open>
          <summary className="cursor-pointer text-sm font-semibold">Optional context</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <SelectField label="Market type" name="marketType" options={marketTypes} defaultValue={settings.defaultMarketType} />
            <label className="field">
              <span className="label">Playbook setup</span>
              <select name="setupId" defaultValue="" className="input">
                <option value="">None / freeform</option>
                {setups.map((setup) => (
                  <option key={setup.id} value={setup.id}>{setup.name}</option>
                ))}
              </select>
            </label>
            <TextField label="Setup name (if not in playbook)" name="setupName" />
            <TextAreaField label="Invalidation" name="invalidation" rows={3} />
            <TextAreaField label="Concern" name="concern" rows={3} />
            <SelectField label="Emotional state" name="emotionalState" options={emotionalStates} includeBlank />
            <SelectField label="Risk posture" name="riskPosture" options={riskPostures} includeBlank />
            <TextField label="Confidence score" name="confidenceScore" type="number" />
            <SelectField label="Entry grade" name="entryGrade" options={entryGrades} defaultValue="NA" />
            <label className="field sm:col-span-2">
              <span className="label">Screenshot upload</span>
              <input className="input" type="file" name="screenshot" accept="image/*" />
            </label>
          </div>
          <div className="mt-4">
            <CheckboxGroup label="Market conditions" name="conditions" options={conditionTagOptions} />
          </div>
        </details>

        <details className="rounded-lg border border-forge-line p-3">
          <summary className="cursor-pointer text-sm font-semibold">Advanced objective fields</summary>
          <div className="mt-4 grid gap-4 sm:grid-cols-3">
            <TextField label="Entry price" name="entryPrice" type="number" step="0.01" />
            <TextField label="Stop price" name="stopPrice" type="number" step="0.01" />
            <TextField label="Target price" name="targetPrice" type="number" step="0.01" />
            <TextField label="Quantity / size" name="quantity" type="number" step="any" />
            <TextField label="Total order value" name="totalOrderValue" type="number" step="0.01" />
            <TextField label="Leverage" name="leverage" type="number" />
          </div>
          <p className="mt-3 text-sm text-forge-muted">
            Enter quantity and price to calculate order value, or order value and price to calculate quantity.
          </p>
        </details>

        <button className="button" type="submit">Save trade note</button>
      </form>
    </main>
  );
}
