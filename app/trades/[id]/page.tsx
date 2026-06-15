import Image from "next/image";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import { createLessonFromTradeAction, deleteTradeAction, linkRawExecutionAction, updateTradeAction } from "@/app/actions";
import { PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import {
  directions,
  emotionalStates,
  entryGrades,
  followedPlanOptions,
  humanize,
  lessonCategories,
  marketTypes,
  riskPostures,
  tradeStatuses,
} from "@/lib/constants";
import { db, getTradeDetail } from "@/lib/data";

export default async function TradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [trade, mistakeTags, unlinkedExecutions] = await Promise.all([
    getTradeDetail(id),
    db.list("mistakeTags"),
    db.list("rawExecutions"),
  ]);
  if (!trade) throw new Error("Trade not found");
  const sortedMistakeTags = mistakeTags.sort((a, b) => a.label.localeCompare(b.label));
  const availableExecutions = unlinkedExecutions
    .filter((execution) => !execution.linkedTradeId)
    .sort((a, b) => b.executionDateTime.getTime() - a.executionDateTime.getTime())
    .slice(0, 25);
  const selectedMistakes = new Set(trade.mistakeTags.map((link) => link.mistakeTagId));

  return (
    <main className="page-shell max-w-5xl">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <PageTitle title={`${trade.instrument} trade`} subtitle="Edit the journal record, then turn the lesson into something reusable." />
        <form action={deleteTradeAction}>
          <input type="hidden" name="id" value={trade.id} />
          <input type="hidden" name="redirectTo" value="/trades" />
          <button className="button-danger" type="submit" title="Delete trade" aria-label={`Delete ${trade.instrument} trade`}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete trade
          </button>
        </form>
      </div>

      <form action={updateTradeAction} className="space-y-5" encType="multipart/form-data">
        <input type="hidden" name="id" value={trade.id} />
        <section className="panel space-y-4">
          <h2 className="font-semibold">Core idea</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Trade date/time" name="tradeDateTime" type="datetime-local" defaultValue={format(trade.tradeDateTime, "yyyy-MM-dd'T'HH:mm")} />
            <TextField label="Instrument" name="instrument" defaultValue={trade.instrument} />
            <SelectField label="Direction" name="direction" options={directions} defaultValue={trade.direction} />
            <SelectField label="Status" name="status" options={tradeStatuses} defaultValue={trade.status} />
            <SelectField label="Market type" name="marketType" options={marketTypes} defaultValue={trade.marketType} />
            <TextField label="Setup name" name="setupName" defaultValue={trade.setupName} />
          </div>
        </section>

        <section className="panel space-y-4">
          <h2 className="font-semibold">Subjective entry note</h2>
          <TextAreaField label="Entry thesis" name="entryThesis" defaultValue={trade.entryThesis} rows={4} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAreaField label="Invalidation" name="invalidation" defaultValue={trade.invalidation} rows={3} />
            <TextAreaField label="Concern" name="concern" defaultValue={trade.concern} rows={3} />
            <SelectField label="Emotional state" name="emotionalState" options={emotionalStates} includeBlank defaultValue={trade.emotionalState} />
            <SelectField label="Risk posture" name="riskPosture" options={riskPostures} includeBlank defaultValue={trade.riskPosture} />
            <TextField label="Confidence score" name="confidenceScore" type="number" defaultValue={trade.confidenceScore} />
            <SelectField label="Entry grade" name="entryGrade" options={entryGrades} defaultValue={trade.entryGrade} />
          </div>
        </section>

        <section className="panel space-y-4">
          <h2 className="font-semibold">Objective trade data</h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <TextField label="Entry price" name="entryPrice" type="number" step="0.01" defaultValue={trade.entryPrice} />
            <TextField label="Stop price" name="stopPrice" type="number" step="0.01" defaultValue={trade.stopPrice} />
            <TextField label="Target price" name="targetPrice" type="number" step="0.01" defaultValue={trade.targetPrice} />
            <TextField label="Exit price" name="exitPrice" type="number" step="0.01" defaultValue={trade.exitPrice} />
            <TextField label="Quantity / size" name="quantity" type="number" step="any" defaultValue={trade.quantity} />
            <TextField label="Total order value" name="totalOrderValue" type="number" step="0.01" defaultValue={trade.totalOrderValue} />
            <TextField label="Leverage" name="leverage" type="number" defaultValue={trade.leverage} />
            <TextField label="Realized P&L" name="realizedPnl" type="number" step="0.01" defaultValue={trade.realizedPnl} />
            <TextField label="Fees" name="fees" type="number" step="0.01" defaultValue={trade.fees} />
            <TextField label="Funding" name="funding" type="number" step="0.01" defaultValue={trade.funding} />
            <div className="rounded-lg bg-forge-panel p-3">
              <div className="text-xs text-forge-muted">Net P&L</div>
              <div className="text-lg font-semibold">{trade.netPnl?.toFixed(2) ?? "NA"}</div>
            </div>
            <div className="rounded-lg bg-forge-panel p-3">
              <div className="text-xs text-forge-muted">R multiple</div>
              <div className="text-lg font-semibold">{trade.rMultiple?.toFixed(2) ?? "NA"}</div>
            </div>
          </div>
          <p className="text-sm text-forge-muted">
            Order value is calculated from entry price x quantity when blank. If quantity is blank, it is calculated from order value / entry price.
          </p>
        </section>

        <section className="panel space-y-4">
          <h2 className="font-semibold">Exit review</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAreaField label="Exit reason" name="exitReason" defaultValue={trade.exitReason} rows={3} />
            <SelectField label="Followed plan" name="followedPlan" options={followedPlanOptions} includeBlank defaultValue={trade.followedPlan} />
            <TextAreaField label="Lesson" name="lesson" defaultValue={trade.lesson} rows={3} />
            <TextAreaField label="Notes" name="notes" defaultValue={trade.notes} rows={3} />
          </div>
        </section>

        <section className="panel space-y-4">
          <h2 className="font-semibold">Mistakes</h2>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {sortedMistakeTags.map((tag) => (
              <label key={tag.id} className="flex items-start gap-2 rounded-md border border-forge-line p-2 text-sm">
                <input type="checkbox" name="mistakeTagId" value={tag.id} defaultChecked={selectedMistakes.has(tag.id)} className="mt-1" />
                <span>
                  <span className="block font-medium">{tag.label}</span>
                  {tag.description ? <span className="text-xs text-forge-muted">{tag.description}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </section>

        <section className="panel space-y-4">
          <h2 className="font-semibold">Screenshots</h2>
          <input className="input w-full" type="file" name="screenshot" accept="image/*" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trade.screenshots.map((screenshot) => (
              <div key={screenshot.id} className="overflow-hidden rounded-lg border border-forge-line">
                <Image src={`/api/screenshots/${screenshot.id}`} alt={screenshot.caption ?? "Trade screenshot"} width={500} height={300} className="h-auto w-full object-cover" />
              </div>
            ))}
          </div>
        </section>

        <button className="button" type="submit">Save trade changes</button>
      </form>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-3">
          <h2 className="font-semibold">Lessons</h2>
          <form action={createLessonFromTradeAction} className="space-y-3">
            <input type="hidden" name="tradeId" value={trade.id} />
            <TextAreaField label="Create lesson from this trade" name="lessonText" defaultValue={trade.lesson} rows={3} />
            <SelectField label="Category" name="category" options={lessonCategories} defaultValue="PROCESS" />
            <button className="button-secondary" type="submit">Add lesson</button>
          </form>
          {trade.lessons.map((lesson) => (
            <p key={lesson.id} className="rounded-md bg-forge-panel p-3 text-sm">{lesson.lessonText}</p>
          ))}
        </div>

        <div className="panel space-y-3">
          <h2 className="font-semibold">Linked transcripts</h2>
          {trade.transcripts.map((transcript) => (
            <div key={transcript.id} className="rounded-md bg-forge-panel p-3 text-sm">
              <div className="font-medium">{humanize(transcript.transcriptType)} · {format(transcript.transcriptDateTime, "dd MMM yyyy HH:mm")}</div>
              <p className="mt-1 text-forge-muted">{transcript.cleanedSummary ?? transcript.rawText.slice(0, 180)}</p>
            </div>
          ))}
          {!trade.transcripts.length ? <p className="muted">No linked transcripts yet.</p> : null}
        </div>
      </section>

      <section className="panel mt-5 space-y-3">
        <h2 className="font-semibold">Raw executions</h2>
        <LinkedExecutions executions={trade.rawExecutions} />
        <h3 className="pt-2 text-sm font-semibold">Link an imported execution</h3>
        <div className="grid gap-2">
          {availableExecutions.map((execution) => (
            <form key={execution.id} action={linkRawExecutionAction} className="flex flex-col gap-2 rounded-md border border-forge-line p-3 sm:flex-row sm:items-center sm:justify-between">
              <input type="hidden" name="rawExecutionId" value={execution.id} />
              <input type="hidden" name="linkedTradeId" value={trade.id} />
              <span className="text-sm">
                {format(execution.executionDateTime, "dd MMM HH:mm")} · {execution.instrument} · {execution.side ?? "side NA"} · {execution.quantity ?? "qty NA"} @ {execution.price ?? "price NA"} · value {execution.totalOrderValue ?? "NA"}
              </span>
              <button className="button-secondary" type="submit">Link</button>
            </form>
          ))}
          {!availableExecutions.length ? <p className="muted">No unlinked imported executions available.</p> : null}
        </div>
      </section>
    </main>
  );
}

function LinkedExecutions({ executions }: { executions: { id: string; executionDateTime: Date; instrument: string; side: string | null; quantity: number | null; totalOrderValue?: number | null; price: number | null; realizedPnl: number | null }[] }) {
  if (!executions.length) return <p className="muted">No executions linked yet.</p>;
  return (
    <div className="overflow-x-auto rounded-lg border border-forge-line">
      <table className="min-w-full text-sm">
        <thead className="bg-forge-panel">
          <tr>
            {["Time", "Instrument", "Side", "Qty", "Price", "Order value", "P&L"].map((header) => <th key={header} className="px-3 py-2 text-left font-medium">{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {executions.map((execution) => (
            <tr key={execution.id} className="border-t border-forge-line">
              <td className="px-3 py-2">{format(execution.executionDateTime, "dd MMM HH:mm")}</td>
              <td className="px-3 py-2">{execution.instrument}</td>
              <td className="px-3 py-2">{execution.side ?? "NA"}</td>
              <td className="px-3 py-2">{execution.quantity ?? "NA"}</td>
              <td className="px-3 py-2">{execution.price ?? "NA"}</td>
              <td className="px-3 py-2">{execution.totalOrderValue ?? "NA"}</td>
              <td className="px-3 py-2">{execution.realizedPnl ?? "NA"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
