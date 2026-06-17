import { NextResponse } from "next/server";
import { format } from "date-fns";
import { db } from "@/lib/data";
import { getSettings } from "@/lib/settings-store";
import { storageStatus, type CollectionName } from "@/lib/store";

const COLLECTIONS: CollectionName[] = [
  "transcripts",
  "dailyJournals",
  "trades",
  "setups",
  "mistakeTags",
  "tradeMistakes",
  "lessons",
  "rawExecutions",
  "importBatches",
  "screenshots",
  "weeklyReviews",
];

export const dynamic = "force-dynamic";

export async function GET() {
  const data: Record<string, unknown[]> = {};
  for (const collection of COLLECTIONS) {
    data[collection] = (await db.list(collection)) as unknown[];
  }
  const settings = await getSettings();
  const status = storageStatus();
  const payload = {
    exportedAt: new Date().toISOString(),
    storageMode: status.mode,
    durable: status.durable,
    settings,
    data,
  };
  const fileName = `tradeforge-backup-${format(new Date(), "yyyy-MM-dd-HHmm")}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
