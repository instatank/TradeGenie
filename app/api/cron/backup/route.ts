import { runBackup } from "@/lib/backup-run";

// The scheduled offsite copy. Vercel's cron hits this on the schedule in
// vercel.json; a logged-in browser can hit it too, which is how you force a
// backup without waiting for the schedule.
//
// Deliberately the thinnest possible wrapper, exactly like the exchange sync
// beside it: everything that could be wrong lives in lib/backup-github.ts where
// it is tested, and this file only decides who may call and what the answer
// looks like.
//
// Never load-bearing. A failed backup returns a description of the failure and
// changes nothing — the journal works exactly as it did before backups existed.
// This route is under /api/cron/, which is what lets middleware.ts admit it on
// the CRON_SECRET bearer token instead of a browser cookie. Without that the
// scheduled call is answered with 307 -> /login, which a cron runner records as
// a success while the backup silently never runs.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const { outcome } = await runBackup();
  // 200 even when the backup was refused or failed: this is a report, and a
  // runner retrying on a deliberate refusal (a public repo, a shrunken
  // journal) would just hammer the same answer.
  return Response.json(outcome, { status: 200, headers: { "Cache-Control": "no-store" } });
}
