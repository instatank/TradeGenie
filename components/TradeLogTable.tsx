"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { deleteTradeAction } from "@/app/actions";
import { FormattedText } from "@/components/FormattedText";
import { humanize } from "@/lib/constants";

export type TradeLogRow = {
  id: string;
  dateLabel: string;
  timeLabel: string;
  instrument: string;
  direction: string;
  status: string;
  marketType: string;
  setupName: string | null;
  entryThesis: string | null;
  invalidation: string | null;
  concern: string | null;
  emotionalState: string | null;
  riskPosture: string | null;
  confidenceScore: number | null;
  entryGrade: string | null;
  exitReason: string | null;
  followedPlan: string | null;
  lesson: string | null;
  notes: string | null;
  entryPrice: number | null;
  stopPrice: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
  quantity: number | null;
  totalOrderValue: number | null;
  leverage: number | null;
  pnl: number | null;
  rMultiple: number | null;
  mistakes: string[];
};

export function TradeLogTable({ trades }: { trades: TradeLogRow[] }) {
  const router = useRouter();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (!trades.length) {
    return <p className="rounded-lg border border-forge-line bg-white p-5 text-sm text-forge-muted shadow-soft">No trades match these filters.</p>;
  }

  return (
    <section className="overflow-x-auto rounded-lg border border-forge-line bg-white shadow-soft">
      <table className="min-w-full table-fixed text-sm">
        <thead className="bg-forge-panel">
          <tr>
            <th className="w-10 px-3 py-2 text-left font-medium" aria-label="Expand trade" />
            <th className="w-28 px-3 py-2 text-left font-medium">Date</th>
            <th className="w-32 px-3 py-2 text-left font-medium">Instrument</th>
            <th className="w-24 px-3 py-2 text-left font-medium">Side</th>
            <th className="w-28 px-3 py-2 text-left font-medium">Status</th>
            <th className="w-44 px-3 py-2 text-left font-medium">Setup</th>
            <th className="w-28 px-3 py-2 text-left font-medium">P&L</th>
            <th className="w-20 px-3 py-2 text-left font-medium">R</th>
            <th className="w-32 px-3 py-2 text-left font-medium">Plan</th>
            <th className="w-48 px-3 py-2 text-left font-medium">Mistakes</th>
            <th className="w-24 px-3 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((trade) => {
            const isExpanded = expandedId === trade.id;
            return (
              <Fragment key={trade.id}>
                <tr
                  className={`cursor-pointer border-t border-forge-line align-middle transition hover:bg-forge-panel/70 ${isExpanded ? "bg-forge-panel/60" : ""}`}
                  onClick={() => setExpandedId(isExpanded ? null : trade.id)}
                  onDoubleClick={() => router.push(`/trades/${trade.id}`)}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setExpandedId(isExpanded ? null : trade.id);
                    }
                  }}
                  aria-expanded={isExpanded}
                >
                  <td className="px-3 py-2 text-forge-muted">
                    {isExpanded ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div>{trade.dateLabel}</div>
                    <div className="text-xs text-forge-muted">{trade.timeLabel}</div>
                  </td>
                  <td className="px-3 py-2 font-semibold">{trade.instrument}</td>
                  <td className="px-3 py-2">{humanize(trade.direction)}</td>
                  <td className="px-3 py-2">{humanize(trade.status)}</td>
                  <td className="truncate px-3 py-2" title={trade.setupName ?? ""}>{trade.setupName ?? "NA"}</td>
                  <td className={`px-3 py-2 font-medium ${Number(trade.pnl ?? 0) >= 0 ? "text-forge-green" : "text-forge-red"}`}>{formatNumber(trade.pnl)}</td>
                  <td className="px-3 py-2">{formatNumber(trade.rMultiple)}</td>
                  <td className="px-3 py-2">{humanize(trade.followedPlan)}</td>
                  <td className="truncate px-3 py-2" title={trade.mistakes.join(", ")}>
                    {trade.mistakes.length ? trade.mistakes.join(", ") : "None"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1" onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}>
                      <Link href={`/trades/${trade.id}`} className="button-secondary min-h-8 px-2" title="Edit trade" aria-label={`Edit ${trade.instrument} trade`}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </Link>
                      <form action={deleteTradeAction}>
                        <input type="hidden" name="id" value={trade.id} />
                        <input type="hidden" name="redirectTo" value="/trades" />
                        <button className="button-danger min-h-8 px-2" type="submit" title="Delete trade" aria-label={`Delete ${trade.instrument} trade`}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
                {isExpanded ? (
                  <tr className="border-t border-forge-line bg-white align-top">
                    <td className="px-3 py-4" />
                    <td colSpan={10} className="px-3 py-4">
                      <TradeExpandedPanel trade={trade} />
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function TradeExpandedPanel({ trade }: { trade: TradeLogRow }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <DetailBlock label="Thesis" value={trade.entryThesis} />
        <div className="grid gap-3 md:grid-cols-2">
          <DetailBlock label="Invalidation" value={trade.invalidation} />
          <DetailBlock label="Concern" value={trade.concern} />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <DetailBlock label="Exit reason" value={trade.exitReason} />
          <DetailBlock label="Lesson" value={trade.lesson} />
        </div>
        <DetailBlock label="Notes" value={trade.notes} />
      </div>
      <div className="space-y-3 rounded-lg border border-forge-line bg-forge-panel p-3">
        <div className="grid grid-cols-2 gap-3">
          <MiniStat label="Market" value={humanize(trade.marketType)} />
          <MiniStat label="Entry grade" value={humanize(trade.entryGrade)} />
          <MiniStat label="Emotion" value={humanize(trade.emotionalState)} />
          <MiniStat label="Risk" value={humanize(trade.riskPosture)} />
          <MiniStat label="Confidence" value={trade.confidenceScore ?? "NA"} />
          <MiniStat label="Plan" value={humanize(trade.followedPlan)} />
          <MiniStat label="Entry" value={formatNumber(trade.entryPrice)} />
          <MiniStat label="Stop" value={formatNumber(trade.stopPrice)} />
          <MiniStat label="Target" value={formatNumber(trade.targetPrice)} />
          <MiniStat label="Exit" value={formatNumber(trade.exitPrice)} />
          <MiniStat label="Qty" value={formatLooseNumber(trade.quantity)} />
          <MiniStat label="Order value" value={formatNumber(trade.totalOrderValue)} />
          <MiniStat label="Leverage" value={formatLooseNumber(trade.leverage)} />
          <MiniStat label="R" value={formatNumber(trade.rMultiple)} />
        </div>
        <Link href={`/trades/${trade.id}`} className="button w-full">
          Open full trade
        </Link>
      </div>
    </div>
  );
}

function DetailBlock({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="rounded-lg border border-forge-line p-3">
      <div className="text-xs font-medium uppercase tracking-wide text-forge-muted">{label}</div>
      {value ? <FormattedText text={value} className="mt-1 text-sm leading-6" /> : <p className="mt-1 text-sm leading-6">NA</p>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-forge-muted">{label}</div>
      <div className="mt-1 font-medium">{value}</div>
    </div>
  );
}

function formatNumber(value: number | null | undefined) {
  return value == null ? "NA" : value.toFixed(2);
}

function formatLooseNumber(value: number | null | undefined) {
  return value == null ? "NA" : String(value);
}
