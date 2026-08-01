import { NextResponse } from "next/server";
import { format } from "date-fns";
import { db } from "@/lib/data";
import { getSettings } from "@/lib/settings-store";
import { collectionNames, storageStatus } from "@/lib/store";

// Every collection in the store shape, always. A hardcoded list here had already
// gone stale — assets and asset notes were missing from every backup.
const COLLECTIONS = collectionNames;

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
  const fileName = `tradegenie-backup-${format(new Date(), "yyyy-MM-dd-HHmm")}.json`;
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
