import Image from "next/image";
import Link from "next/link";
import { format } from "date-fns";
import { ArrowLeft, ClipboardCheck, Trash2 } from "lucide-react";
import { createLessonFromTradeAction, deleteTradeAction, linkRawExecutionAction, saveTradeAction } from "@/app/actions";
import { CheckboxGroup, PageTitle, SelectField, TextAreaField, TextField } from "@/components/Fields";
import { SaveBar } from "@/components/SaveBar";
import { TagPills } from "@/components/TagPills";
import { TagPicker } from "@/components/TagPicker";
import { TradeReviewFields } from "@/components/TradeReviewFields";
import {
  conditionTagOptions,
  directions,
  humanize,
  lessonCategories,
  marketTypes,
  mindStateOptions,
  primaryMistakeTagNames,
  riskPostures,
} from "@/lib/constants";
import { db, getActiveSetups, getTagVocabulary, getTradeDetail } from "@/lib/data";
import { exitEfficiency, tradeNeedsReview, tradeProcessScore } from "@/lib/metrics";

// One trade, one form, one Save. The review ritual sits on top; every other
// detail is a fold below it — but they all belong to the same form, so a single
// press of Save captures whatever you touched, wherever you touched it.
export default async function TradeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [trade, mistakeTags, unlinkedExecutions, setups, tagVocabulary] = await Promise.all([
    getTradeDetail(id),
    db.list("mistakeTags"),
    db.list("rawExecutions"),
    getActiveSetups(),
    getTagVocabulary(),
  ]);
  if (!trade) throw new Error("Trade not found");
  const sortedMistakeTags = mistakeTags.sort((a, b) => a.label.localeCompare(b.label));
  const processScore = tradeProcessScore(trade);
  const efficiency = exitEfficiency(trade);
  const availableExecutions = unlinkedExecutions
    .filter((execution) => !execution.linkedTradeId)
    .sort((a, b) => b.executionDateTime.getTime() - a.executionDateTime.getTime())
    .slice(0, 25);
  const selectedMistakes = trade.mistakeTags.map((link) => link.mistakeTagId);
  const primaryTags = sortedMistakeTags.filter((tag) => primaryMistakeTagNames.has(tag.name));
  const otherTags = sortedMistakeTags.filter((tag) => !primaryMistakeTagNames.has(tag.name));
  const needsReview = tradeNeedsReview(trade);

  return (
    <main className="page-shell max-w-5xl pb-28">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <Link href="/trades" className="mb-2 inline-flex items-center gap-1 text-sm text-forge-muted transition hover:text-forge-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            All trades
          </Link>
          <PageTitle title={`${trade.instrument} trade`} subtitle="Review it in a minute up top; every detail is a fold below. One Save covers the lot." />
        </div>
        <form action={deleteTradeAction}>
          <input type="hidden" name="id" value={trade.id} />
          <input type="hidden" name="redirectTo" value="/trades" />
          <button className="button-danger" type="submit" title="Delete trade" aria-label={`Delete ${trade.instrument} trade`}>
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Delete trade
          </button>
        </form>
      </div>

      <section className="panel mb-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">{trade.instrument} · {humanize(trade.direction)} · {humanize(trade.status)}</h2>
            <p className="mt-1 text-sm text-forge-muted">
              {format(trade.tradeDateTime, "dd MMM yyyy HH:mm")} · {humanize(trade.marketType)} · {trade.setupName ?? "No setup"}
            </p>
            <TagPills tags={trade.tags} className="mt-2" />
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium text-forge-muted">
            {trade.mistakeTags.length ? <span className="rounded-md bg-forge-panel px-2 py-1">{trade.mistakeTags.length} mistake tag{trade.mistakeTags.length === 1 ? "" : "s"}</span> : null}
            {trade.transcripts.length ? <span className="rounded-md bg-forge-panel px-2 py-1">{trade.transcripts.length} note{trade.transcripts.length === 1 ? "" : "s"}</span> : null}
            {trade.rawExecutions.length ? <span className="rounded-md bg-forge-panel px-2 py-1">{trade.rawExecutions.length} execution{trade.rawExecutions.length === 1 ? "" : "s"}</span> : null}
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <MiniMetric label="Net P&L" value={formatMaybe(trade.netPnl)} tone={Number(trade.netPnl ?? 0) >= 0 ? "good" : "bad"} />
          <MiniMetric label="R multiple" value={formatMaybe(trade.rMultiple)} />
          <MiniMetric label="Process score" value={processScore == null ? "NA" : `${processScore}/100`} tone={processScore == null ? undefined : processScore >= 60 ? "good" : "bad"} />
          <MiniMetric label="Exit efficiency" value={efficiency == null ? "NA" : `${(efficiency * 100).toFixed(0)}%`} />
          <MiniMetric label="Plan" value={humanize(trade.followedPlan)} />
        </div>
      </section>

      <form action={saveTradeAction} className="space-y-5">
        <input type="hidden" name="id" value={trade.id} />
        {/* First submit button in the form: Enter in any field saves the page. */}
        <SaveBar label="Save trade" hint="One save covers the review and every fold below." />

        <details className={`panel ${needsReview ? "border-l-4 border-forge-blue" : ""}`} open={needsReview}>
          <summary className="flex cursor-pointer items-center gap-2 font-semibold">
            <ClipboardCheck className="h-4 w-4 text-forge-blue" aria-hidden="true" />
            {needsReview ? (trade.status === "OPEN" ? "Close & review this trade" : "Review this trade — one minute") : "Review — done (tap to edit)"}
          </summary>
          <div className="mt-4 space-y-4">
            <TradeReviewFields trade={trade} mistakeTags={primaryTags} selectedMistakes={selectedMistakes} />
          </div>
        </details>

        <h2 className="text-sm font-semibold text-forge-muted">Everything else — open only what you need</h2>

        <details className="panel space-y-4">
          <summary className="cursor-pointer font-semibold">Core idea</summary>
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField label="Trade date/time" name="tradeDateTime" type="datetime-local" defaultValue={format(trade.tradeDateTime, "yyyy-MM-dd'T'HH:mm")} />
            <TextField label="Instrument" name="instrument" defaultValue={trade.instrument} />
            <SelectField label="Direction" name="direction" options={directions} defaultValue={trade.direction} />
            <SelectField label="Market type" name="marketType" options={marketTypes} defaultValue={trade.marketType} />
            <label className="field">
              <span className="label">Playbook setup</span>
              <select name="setupId" defaultValue={trade.setupId ?? ""} className="input">
                <option value="">None / freeform</option>
                {setups.map((setup) => (
                  <option key={setup.id} value={setup.id}>{setup.name}</option>
                ))}
              </select>
            </label>
            <TextField label="Setup name (freeform)" name="setupName" defaultValue={trade.setupName} />
          </div>
          <p className="text-xs text-forge-muted">Status lives in the review panel above — one control, one place.</p>
          <TagPicker selected={trade.tags ?? []} vocabulary={tagVocabulary.map((entry) => entry.tag)} />
        </details>

        <details className="panel space-y-4">
          <summary className="cursor-pointer font-semibold">Subjective entry note</summary>
          <TextAreaField label="Entry thesis" name="entryThesis" defaultValue={trade.entryThesis} rows={4} />
          <TextAreaField label="Pre-mortem — what was most likely to make this fail?" name="premortem" defaultValue={trade.premortem} rows={2} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextAreaField label="Invalidation" name="invalidation" defaultValue={trade.invalidation} rows={3} />
            <TextAreaField label="Concern" name="concern" defaultValue={trade.concern} rows={3} />
            <SelectField label="Mind state" name="emotionalState" options={mindStateOptions} includeBlank defaultValue={trade.emotionalState} />
            <SelectField label="Risk posture" name="riskPosture" options={riskPostures} includeBlank defaultValue={trade.riskPosture} />
            <TextField label="Confidence score" name="confidenceScore" type="number" defaultValue={trade.confidenceScore} />
          </div>
          <input type="hidden" name="hasConditions" value="1" />
          <CheckboxGroup label="Market conditions" name="conditions" options={conditionTagOptions} selected={trade.conditions ?? []} />
          <TextAreaField label="Free-form notes" name="notes" defaultValue={trade.notes} rows={3} />
        </details>

        <details className="panel space-y-4">
          <summary className="cursor-pointer font-semibold">Objective trade data</summary>
          <p className="text-xs text-forge-muted">Exit price and realized P&L live in the review panel above.</p>
          <div className="grid gap-4 sm:grid-cols-4">
            <TextField label="Entry price" name="entryPrice" type="number" step="0.01" defaultValue={trade.entryPrice} />
            <TextField label="Stop price" name="stopPrice" type="number" step="0.01" defaultValue={trade.stopPrice} />
            <TextField label="Target price" name="targetPrice" type="number" step="0.01" defaultValue={trade.targetPrice} />
            <TextField label="Best price reached (MFE)" name="mfePrice" type="number" step="0.01" defaultValue={trade.mfePrice} />
            <TextField label="Worst price reached (MAE)" name="maePrice" type="number" step="0.01" defaultValue={trade.maePrice} />
            <TextField label="Quantity / size" name="quantity" type="number" step="any" defaultValue={trade.quantity} />
            <TextField label="Total order value" name="totalOrderValue" type="number" step="0.01" defaultValue={trade.totalOrderValue} />
            <TextField label="Leverage" name="leverage" type="number" defaultValue={trade.leverage} />
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
            <div className="rounded-lg bg-forge-panel p-3">
              <div className="text-xs text-forge-muted">Exit efficiency</div>
              <div className="text-lg font-semibold">{efficiency == null ? "NA" : `${(efficiency * 100).toFixed(0)}%`}</div>
            </div>
          </div>
          <p className="text-sm text-forge-muted">
            Order value is calculated from entry price x quantity when blank. If quantity is blank, it is calculated from order value / entry price.
            Exit efficiency = how much of the best favorable move (MFE) you captured at exit.
          </p>
        </details>

        {otherTags.length ? (
          <details className="panel space-y-4">
            <summary className="cursor-pointer font-semibold">More mistake tags</summary>
            <p className="text-xs text-forge-muted">The nine you tag most are chips in the review panel above; the rest live here.</p>
            <input type="hidden" name="shownMistakeTagIds" value={otherTags.map((tag) => tag.id).join(",")} />
            <MistakeTagGrid tags={otherTags} selected={new Set(selectedMistakes)} />
          </details>
        ) : null}

        <details className="panel space-y-4" open={trade.screenshots.length > 0}>
          <summary className="cursor-pointer font-semibold">Screenshots</summary>
          <input className="input w-full" type="file" name="screenshot" accept="image/*" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {trade.screenshots.map((screenshot) => (
              <div key={screenshot.id} className="overflow-hidden rounded-lg border border-forge-line">
                <Image src={`/api/screenshots/${screenshot.id}`} alt={screenshot.caption ?? "Trade screenshot"} width={500} height={300} className="h-auto w-full object-cover" />
              </div>
            ))}
          </div>
        </details>
      </form>

      <section className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="panel space-y-3">
          <h2 className="font-semibold">Lessons</h2>
          {trade.lessons.map((lesson) => (
            <p key={lesson.id} className="rounded-md bg-forge-panel p-3 text-sm">{lesson.lessonText}</p>
          ))}
          <details className="rounded-lg border border-forge-line p-3">
            <summary className="cursor-pointer text-sm font-semibold text-forge-muted">Add another lesson from this trade</summary>
            <form action={createLessonFromTradeAction} className="mt-3 space-y-3">
              <input type="hidden" name="tradeId" value={trade.id} />
              <TextAreaField label="Lesson" name="lessonText" rows={3} />
              <SelectField label="Category" name="category" options={lessonCategories} defaultValue="PROCESS" />
              <button className="button-secondary" type="submit">Add lesson</button>
            </form>
          </details>
          <p className="text-xs text-forge-muted">The lesson you write in the review panel is banked automatically.</p>
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

      <details className="panel mt-5 space-y-3" open={trade.rawExecutions.length > 0}>
        <summary className="cursor-pointer font-semibold">Raw executions</summary>
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
      </details>
    </main>
  );
}

function MistakeTagGrid({ tags, selected }: { tags: { id: string; name: string; label: string; description: string | null }[]; selected: Set<string> }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {tags.map((tag) => (
        <label key={tag.id} className="flex items-start gap-2 rounded-md border border-forge-line p-2 text-sm">
          <input type="checkbox" name="mistakeTagId" value={tag.id} defaultChecked={selected.has(tag.id)} className="mt-1" />
          <span>
            <span className="block font-medium">{tag.label}</span>
            {tag.description ? <span className="text-xs text-forge-muted">{tag.description}</span> : null}
          </span>
        </label>
      ))}
    </div>
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

function MiniMetric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg bg-forge-panel p-3">
      <div className="text-xs uppercase tracking-wide text-forge-muted">{label}</div>
      <div className={`mt-1 font-semibold ${tone === "good" ? "text-forge-green" : tone === "bad" ? "text-forge-red" : ""}`}>{value}</div>
    </div>
  );
}

function formatMaybe(value: number | null | undefined) {
  return value == null ? "NA" : value.toFixed(2);
}
