"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Papa from "papaparse";

const targetFields = [
  "executionDateTime",
  "exchangeBroker",
  "instrument",
  "side",
  "price",
  "quantity",
  "totalOrderValue",
  "fees",
  "funding",
  "realizedPnl",
  "orderId",
] as const;

export function ImportCsvClient() {
  const router = useRouter();
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const headers = useMemo(() => Object.keys(rows[0] ?? {}), [rows]);

  function handleFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete(result) {
        const parsedRows = result.data.slice(0, 500);
        setRows(parsedRows);
        const nextMapping: Record<string, string> = {};
        for (const field of targetFields) {
          const match = Object.keys(parsedRows[0] ?? {}).find((header) => fieldAliases(field).includes(normalize(header)));
          nextMapping[field] = match ?? "";
        }
        setMapping(nextMapping);
      },
    });
  }

  async function importRows() {
    setIsImporting(true);
    setMessage("Importing...");
    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName, rows, mapping }),
      });
      const result = await response.json() as { message?: string };
      setMessage(result.message ?? "Import finished.");
      router.refresh();
    } catch {
      setMessage("Import failed. Please check the CSV and try again.");
    } finally {
      setIsImporting(false);
    }
  }

  return (
    <section className="panel space-y-4">
      <div>
        <h2 className="font-semibold">Upload CSV</h2>
        <p className="muted">Map only the columns you have. Rows without an execution time or instrument are skipped.</p>
      </div>
      <input type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0])} className="input w-full" />
      {headers.length ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {targetFields.map((field) => (
              <label key={field} className="field">
                <span className="label">{field}</span>
                <select
                  className="input"
                  value={mapping[field] ?? ""}
                  onChange={(event) => setMapping((current) => ({ ...current, [field]: event.target.value }))}
                >
                  <option value="">Not mapped</option>
                  {headers.map((header) => (
                    <option key={header} value={header}>
                      {header}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border border-forge-line">
            <table className="min-w-full text-sm">
              <thead className="bg-forge-panel">
                <tr>
                  {headers.map((header) => (
                    <th key={header} className="px-3 py-2 text-left font-medium">{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 6).map((row, index) => (
                  <tr key={index} className="border-t border-forge-line">
                    {headers.map((header) => (
                      <td key={header} className="max-w-52 truncate px-3 py-2">{row[header]}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={importRows} className="button" disabled={isImporting}>
            {isImporting ? "Importing..." : "Import mapped rows"}
          </button>
        </>
      ) : null}
      {message ? <p className="rounded-md bg-forge-panel p-3 text-sm font-medium text-forge-ink">{message}</p> : null}
    </section>
  );
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function fieldAliases(field: string) {
  const aliases: Record<string, string[]> = {
    executionDateTime: ["executiondatetime", "time", "datetime", "date", "timestamp"],
    exchangeBroker: ["exchangebroker", "exchange", "broker"],
    totalOrderValue: ["totalordervalue", "ordervalue", "notional", "value", "amount", "total"],
    realizedPnl: ["realizedpnl", "pnl", "realisedpnl", "profitloss"],
    orderId: ["orderid", "id"],
  };
  return aliases[field] ?? [normalize(field)];
}
