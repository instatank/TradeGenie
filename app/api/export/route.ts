import { NextResponse } from "next/server";
import { buildSnapshot, snapshotFileName } from "@/lib/backup";

// The manual download. Everything about WHAT a backup contains now lives in
// lib/backup.ts, shared with the "Back up now" button and the nightly cron —
// this route only decides that the answer arrives as a file.
//
// It used to build the payload itself, which is how assets and asset notes went
// missing from every backup for a while. One definition, three callers.

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await buildSnapshot();
  return new NextResponse(JSON.stringify(snapshot, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${snapshotFileName()}"`,
      "Cache-Control": "no-store",
    },
  });
}
