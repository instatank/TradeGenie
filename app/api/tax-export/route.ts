import Papa from "papaparse";
import { credentialsFromEnv } from "@/lib/coindcx";
import { liveExchangeView, positionKey } from "@/lib/coindcx-sync";
import { closedBefore, fillsTable, istMidnight, positionsTable } from "@/lib/tax-export";

// The line-item export: every futures trade before a cutoff, as a CSV a CA can
// open and compute turnover from.
//
// Same source and same fold as /api/tax-summary — `liveExchangeView` off the
// CoinDCX API, nothing read from the journal and nothing written anywhere. The
// summary is the headline, this is the evidence behind it, and they cannot
// disagree because they share both the fetch and lib/tax-export's window rule.
//
// Two shapes, because "trade" means two things to two readers:
//   rows=positions (default) — one row per POSITION closed before the cutoff.
//     The turnover basis.
//   rows=fills — one row per individual EXECUTION before the cutoff. The raw
//     audit trail, carrying the exchange's own fill and order ids.
//
// Read-only, behind the SITE_PASSWORD gate like every other route.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function problem(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(request: Request) {
  const credentials = credentialsFromEnv();
  if (!credentials) {
    return problem(
      "No CoinDCX credentials on the server. Set COINDCX_API_KEY and COINDCX_API_SECRET in " +
        "Vercel → trade-genie → Settings → Environment Variables, then redeploy.",
      400,
    );
  }

  const url = new URL(request.url);
  const beforeParam = url.searchParams.get("before") ?? "2026-04-01";
  const rows = url.searchParams.get("rows") === "fills" ? "fills" : "positions";

  const cutoff = istMidnight(beforeParam);
  if (Number.isNaN(cutoff.getTime())) {
    return problem(`Bad "before" date: ${beforeParam}. Use YYYY-MM-DD.`, 400);
  }

  const view = await liveExchangeView(credentials);

  // A truncated history would hand the CA a CSV quietly missing trades, and a
  // spreadsheet carries no warning banner the way the summary page does.
  // Refusing is the only safe answer: a short file is indistinguishable from a
  // complete one once it is open in Excel, and it would be summed and filed.
  if (view.incomplete) {
    return problem(
      [
        "REFUSING TO EXPORT — the exchange did not return the full history.",
        "",
        `Reason: ${view.incomplete}`,
        "",
        "A CSV missing trades looks exactly like a complete one once it is in a",
        "spreadsheet, so this will not write a partial file. Try again in a moment;",
        "if it keeps happening, say so and it can be looked at properly.",
      ].join("\n"),
      503,
    );
  }

  const table =
    rows === "fills"
      ? fillsTable(
          view.fills
            .filter((fill) => fill.timestamp.getTime() < cutoff.getTime())
            .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
        )
      : positionsTable(
          view.positions
            .filter((position) => closedBefore(position, cutoff))
            .sort((a, b) => a.closedAt!.getTime() - b.closedAt!.getTime()),
          (position) => new Set(view.positionsMissingFunding.map(positionKey)).has(positionKey(position)),
        );

  const name = `coindcx-futures-${rows === "fills" ? "fills" : "trades"}-before-${beforeParam}.csv`;

  // Papa.unparse rather than hand-rolled joining: the quoting rules for embedded
  // commas, quotes and newlines look right until one row has a comma in it.
  // Already a dependency, used for CSV import on the other side.
  const csv = Papa.unparse(table, { newline: "\r\n" });

  // The BOM is what makes Excel read this as UTF-8 rather than mojibake.
  return new Response(`﻿${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
