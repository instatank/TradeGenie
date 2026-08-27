import { credentialsFromEnv } from "@/lib/coindcx";
import { syncExchange } from "@/lib/coindcx-sync";
import { revalidateEverything } from "@/lib/revalidate";

// The scheduled pull. Vercel's cron hits this; a logged-in browser can hit it
// too, which is how you force a sync without waiting for the schedule.
//
// It is deliberately the thinnest possible wrapper: everything that could be
// wrong lives in lib/coindcx-sync.ts where it is testable, and this file only
// decides who may call and what the answer looks like.
//
// Never load-bearing. A failed sync returns a description of the failure and
// changes nothing; the journal works exactly as it did before the exchange was
// ever connected.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET() {
  const credentials = credentialsFromEnv();
  if (!credentials) {
    return Response.json(
      { ok: false, detail: "No COINDCX_API_KEY / COINDCX_API_SECRET set on the server." },
      { status: 200, headers: { "Cache-Control": "no-store" } },
    );
  }

  const report = await syncExchange(credentials);
  if (report.fillsStored || report.ledgerStored) {
    // New rows change what every page derives, so expire the whole route cache.
    revalidateEverything();
  }

  // 200 even on a failed sync: this is a report, and a cron runner treating a
  // reachable-but-unhappy exchange as an outage would just add noise.
  return Response.json(report, { status: 200, headers: { "Cache-Control": "no-store" } });
}
