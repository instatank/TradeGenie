import { credentialsFromEnv, formatProbeReport, probeFuturesEndpoints } from "@/lib/coindcx";

// A one-time discovery endpoint: open it in the browser, copy the text, and the
// adapter gets written against real field names instead of guessed ones. It
// exists because this app has no local checkout to run a script from — the
// deployment IS the machine that holds the credentials.
//
// Read-only: lib/coindcx.ts refuses any path outside its list/history
// allowlist, so this cannot place, edit, cancel or exit an order.
//
// It sits behind the SITE_PASSWORD gate like every other route (middleware.ts
// excludes only /login and static assets). Delete this route once the real
// adapter and its Settings panel land.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET() {
  const credentials = credentialsFromEnv();
  if (!credentials) {
    return new Response(
      [
        "No CoinDCX credentials on the server.",
        "",
        "Set both of these in Vercel → your project → Settings → Environment Variables,",
        "then redeploy:",
        "",
        "  COINDCX_API_KEY",
        "  COINDCX_API_SECRET",
        "",
        "Use a READ-ONLY key. This never needs trade or withdrawal permission.",
      ].join("\n"),
      { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const outcomes = await probeFuturesEndpoints(credentials);
  return new Response(formatProbeReport(outcomes), {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Never let a CDN hold a copy of someone's trade history.
      "Cache-Control": "no-store",
    },
  });
}
