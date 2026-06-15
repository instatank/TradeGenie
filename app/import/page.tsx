import Link from "next/link";
import { format } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { deleteImportBatchAction, deleteRawExecutionAction, linkRawExecutionAction, updateRawExecutionAction } from "@/app/actions";
import { CalendarRangeControls } from "@/components/CalendarRangeControls";
import { ImportCsvClient } from "@/components/ImportCsvClient";
import { PageTitle, TextField } from "@/components/Fields";
import { PaginationControls, ViewTabs, normalizePage, normalizePageSize, paginate } from "@/components/ListControls";
import { getCalendarRange, isWithinCalendarRange } from "@/lib/calendar";
import { humanize } from "@/lib/constants";
import { db } from "@/lib/data";
import type { RawExecution } from "@/lib/types";

const executionViews = [
  { label: "All", value: "all" },
  { label: "Unlinked", value: "unlinked" },
  { label: "Linked", value: "linked" },
  { label: "With P&L", value: "with-pnl" },
  { label: "No P&L", value: "no-pnl" },
];

export default async function ImportPage({ searchParams }: { searchParams?: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams ?? {};
  const view = params.view ?? "all";
  const sort = params.sort ?? "date-desc";
  const page = normalizePage(params.page);
  const pageSize = normalizePageSize(params.pageSize, [10, 25, 50], 25);
  const calendarRange = getCalendarRange(params);
  const [batches, executions, trades] = await Promise.all([
    db.list("importBatches"),
    db.list("rawExecutions"),
    db.list("trades"),
  ]);
  const recentBatches = batches.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 12);
  const filteredExecutions = executions
    .filter((execution) => applyExecutionView(execution, view))
    .filter((execution) => isWithinCalendarRange(execution.executionDateTime, calendarRange))
    .filter((execution) => !params.instrument || execution.instrument.includes(params.instrument.toUpperCase()))
    .filter((execution) => !params.side || String(execution.side ?? "").toLowerCase().includes(params.side.toLowerCase()))
    .sort((a, b) => compareExecutions(a, b, sort));
  const pagedExecutions = paginate(filteredExecutions, page, pageSize);
  const recentTrades = trades.sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime()).slice(0, 80);

  return (
    <main className="page-shell">
      <PageTitle title="Import" subtitle="Bring in objective execution rows. Grouping into journal trades stays manual for MVP." />
      <ViewTabs basePath="/import" current={view} params={params} tabs={executionViews} />
      <CalendarRangeControls basePath="/import" params={params} range={calendarRange} total={filteredExecutions.length} />
      <section className="grid gap-5 lg:grid-cols-[420px_1fr]">
        <div className="space-y-4">
          <ImportCsvClient />
          <section className="panel">
            <h2 className="mb-3 font-semibold">Recent batches</h2>
            <div className="space-y-2">
              {recentBatches.map((batch) => (
                <div key={batch.id} className="flex items-start justify-between gap-3 rounded-md bg-forge-panel p-3 text-sm">
                  <div>
                    <div className="font-medium">{batch.fileName ?? "CSV import"}</div>
                    <div className="text-forge-muted">{format(batch.createdAt, "dd MMM HH:mm")} · {batch.importedCount}/{batch.rowCount} imported · {batch.skippedCount} skipped</div>
                  </div>
                  <form action={deleteImportBatchAction}>
                    <input type="hidden" name="importBatchId" value={batch.id} />
                    <button className="button-danger min-h-8 px-2" type="submit" title="Delete batch and rows" aria-label="Delete import batch">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </form>
                </div>
              ))}
              {!recentBatches.length ? <p className="muted">No imports yet.</p> : null}
            </div>
          </section>
        </div>

        <section className="panel">
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="font-semibold">Raw executions</h2>
              <p className="text-sm text-forge-muted">{filteredExecutions.length} imported row{filteredExecutions.length === 1 ? "" : "s"}</p>
            </div>
          </div>
          <details className="mb-4 rounded-lg border border-forge-line p-3" open={hasActiveExecutionControls(params)}>
            <summary className="cursor-pointer text-sm font-semibold">Filters & sorting</summary>
            <form className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="view" value={view} />
              <TextField label="Instrument" name="instrument" defaultValue={params.instrument} />
              <TextField label="Side" name="side" defaultValue={params.side} />
              <label className="field">
                <span className="label">Sort</span>
                <select name="sort" defaultValue={sort} className="input">
                  <option value="date-desc">Newest first</option>
                  <option value="date-asc">Oldest first</option>
                  <option value="instrument-asc">Instrument A-Z</option>
                  <option value="value-desc">Order value high-low</option>
                  <option value="pnl-desc">P&L high-low</option>
                  <option value="pnl-asc">P&L low-high</option>
                </select>
              </label>
              <label className="field">
                <span className="label">Rows</span>
                <select name="pageSize" defaultValue={String(pageSize)} className="input">
                  <option value="10">10</option>
                  <option value="25">25</option>
                  <option value="50">50</option>
                </select>
              </label>
              <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-4">
                <button className="button" type="submit">Apply</button>
                <Link href="/import" className="button-secondary">Clear</Link>
              </div>
            </form>
          </details>
          <div className="overflow-x-auto rounded-lg border border-forge-line">
            <table className="min-w-full text-sm">
              <thead className="bg-forge-panel">
                <tr>
                  {["Time", "Instrument", "Side", "Qty", "Price", "Order value", "P&L", "Linked trade", ""].map((header) => (
                    <th key={header} className="px-3 py-2 text-left font-medium">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pagedExecutions.map((execution) => (
                  <tr key={execution.id} className="border-t border-forge-line">
                    <td className="whitespace-nowrap px-3 py-2">{format(execution.executionDateTime, "dd MMM HH:mm")}</td>
                    <td className="px-3 py-2">{execution.instrument}</td>
                    <td className="px-3 py-2">{execution.side ?? "NA"}</td>
                    <td className="px-3 py-2">{execution.quantity ?? "NA"}</td>
                    <td className="px-3 py-2">{execution.price ?? "NA"}</td>
                    <td className="px-3 py-2">{execution.totalOrderValue ?? "NA"}</td>
                    <td className="px-3 py-2">{execution.realizedPnl ?? "NA"}</td>
                    <td className="px-3 py-2">
                      <form action={linkRawExecutionAction} className="flex min-w-72 gap-2">
                        <input type="hidden" name="rawExecutionId" value={execution.id} />
                        <select name="linkedTradeId" defaultValue={execution.linkedTradeId ?? ""} className="input flex-1">
                          <option value="">Unlinked</option>
                          {recentTrades.map((trade) => (
                            <option key={trade.id} value={trade.id}>
                              {format(trade.tradeDateTime, "dd MMM")} · {trade.instrument} · {humanize(trade.direction)}
                            </option>
                          ))}
                        </select>
                        <button className="button-secondary" type="submit">Save</button>
                      </form>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <details className="relative">
                          <summary className="button-secondary min-h-8 cursor-pointer list-none px-2" title="Edit execution" aria-label="Edit execution">
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </summary>
                          <div className="absolute right-0 z-10 mt-2 w-[min(720px,calc(100vw-2rem))] rounded-lg border border-forge-line bg-white p-4 shadow-lg">
                            <form action={updateRawExecutionAction} className="grid gap-3 sm:grid-cols-3">
                              <input type="hidden" name="rawExecutionId" value={execution.id} />
                              <TextField label="Execution time" name="executionDateTime" type="datetime-local" defaultValue={format(execution.executionDateTime, "yyyy-MM-dd'T'HH:mm")} />
                              <TextField label="Instrument" name="instrument" defaultValue={execution.instrument} />
                              <TextField label="Side" name="side" defaultValue={execution.side} />
                              <TextField label="Price" name="price" type="number" step="0.01" defaultValue={execution.price} />
                              <TextField label="Quantity / size" name="quantity" type="number" step="any" defaultValue={execution.quantity} />
                              <TextField label="Total order value" name="totalOrderValue" type="number" step="0.01" defaultValue={execution.totalOrderValue} />
                              <TextField label="Realized P&L" name="realizedPnl" type="number" step="0.01" defaultValue={execution.realizedPnl} />
                              <TextField label="Fees" name="fees" type="number" step="0.01" defaultValue={execution.fees} />
                              <TextField label="Funding" name="funding" type="number" step="0.01" defaultValue={execution.funding} />
                              <TextField label="Broker" name="exchangeBroker" defaultValue={execution.exchangeBroker} />
                              <TextField label="Order ID" name="orderId" defaultValue={execution.orderId} />
                              <div className="flex items-end">
                                <button className="button-secondary w-full" type="submit">Save row</button>
                              </div>
                            </form>
                          </div>
                        </details>
                        <form action={deleteRawExecutionAction}>
                          <input type="hidden" name="rawExecutionId" value={execution.id} />
                          <button className="button-danger min-h-8 px-2" type="submit" title="Delete execution" aria-label="Delete execution">
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!filteredExecutions.length ? <p className="p-5 text-sm text-forge-muted">No raw executions match this view.</p> : null}
          </div>
          <PaginationControls basePath="/import" params={params} page={page} pageSize={pageSize} total={filteredExecutions.length} />
        </section>
      </section>
    </main>
  );
}

function applyExecutionView(execution: RawExecution, view: string) {
  if (view === "unlinked") return !execution.linkedTradeId;
  if (view === "linked") return Boolean(execution.linkedTradeId);
  if (view === "with-pnl") return execution.realizedPnl != null;
  if (view === "no-pnl") return execution.realizedPnl == null;
  return true;
}

function compareExecutions(a: RawExecution, b: RawExecution, sort: string) {
  if (sort === "date-asc") return a.executionDateTime.getTime() - b.executionDateTime.getTime();
  if (sort === "instrument-asc") return a.instrument.localeCompare(b.instrument) || b.executionDateTime.getTime() - a.executionDateTime.getTime();
  if (sort === "value-desc") return (b.totalOrderValue ?? Number.NEGATIVE_INFINITY) - (a.totalOrderValue ?? Number.NEGATIVE_INFINITY);
  if (sort === "pnl-desc") return (b.realizedPnl ?? Number.NEGATIVE_INFINITY) - (a.realizedPnl ?? Number.NEGATIVE_INFINITY);
  if (sort === "pnl-asc") return (a.realizedPnl ?? Number.POSITIVE_INFINITY) - (b.realizedPnl ?? Number.POSITIVE_INFINITY);
  return b.executionDateTime.getTime() - a.executionDateTime.getTime();
}

function hasActiveExecutionControls(params: Record<string, string | undefined>) {
  const passiveKeys = new Set(["view", "page", "period", "date"]);
  return Object.entries(params).some(([key, value]) => Boolean(value) && !passiveKeys.has(key));
}
