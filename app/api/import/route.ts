import { NextResponse } from "next/server";
import { db } from "@/lib/data";
import { calculateOrderFields } from "@/lib/metrics";

type ImportPayload = {
  fileName?: string;
  rows?: Record<string, string>[];
  mapping?: Record<string, string>;
};

export async function POST(request: Request) {
  const payload = await request.json() as ImportPayload;
  const rows = payload.rows ?? [];
  const mapping = payload.mapping ?? {};
  let importedCount = 0;
  let skippedCount = 0;

  const batch = await db.create("importBatches", {
    createdAt: new Date(),
    fileName: payload.fileName ?? null,
    sourceName: "CSV",
    rowCount: rows.length,
    importedCount: 0,
    skippedCount: 0,
    notes: null,
  });

  for (const row of rows) {
    const executionDateTime = parseDate(readMapped(row, mapping.executionDateTime));
    const instrument = readMapped(row, mapping.instrument)?.trim();
    if (!executionDateTime || !instrument) {
      skippedCount += 1;
      continue;
    }

    const price = parseNumber(readMapped(row, mapping.price));
    const orderFields = calculateOrderFields({
      price,
      quantity: parseNumber(readMapped(row, mapping.quantity)),
      totalOrderValue: parseNumber(readMapped(row, mapping.totalOrderValue)),
    });

    await db.create("rawExecutions", {
      createdAt: new Date(),
      importBatchId: batch.id,
      executionDateTime,
      exchangeBroker: readMapped(row, mapping.exchangeBroker),
      instrument: instrument.toUpperCase(),
      side: readMapped(row, mapping.side),
      price,
      quantity: orderFields.quantity,
      totalOrderValue: orderFields.totalOrderValue,
      fees: parseNumber(readMapped(row, mapping.fees)),
      funding: parseNumber(readMapped(row, mapping.funding)),
      realizedPnl: parseNumber(readMapped(row, mapping.realizedPnl)),
      orderId: readMapped(row, mapping.orderId),
      rawJson: JSON.stringify(row),
      linkedTradeId: null,
    });
    importedCount += 1;
  }

  await db.update("importBatches", batch.id, { importedCount, skippedCount });

  return NextResponse.json({
    message: `Imported ${importedCount} rows. Skipped ${skippedCount}.`,
    batchId: batch.id,
  });
}

function readMapped(row: Record<string, string>, header?: string) {
  if (!header) return null;
  const value = row[header];
  return value == null || value === "" ? null : String(value);
}

function parseDate(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseNumber(value: string | null) {
  if (!value) return null;
  const cleaned = value.replace(/,/g, "");
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
