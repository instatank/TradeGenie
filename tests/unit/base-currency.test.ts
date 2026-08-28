// Guards on where money gets converted, which no runtime test can express.
//
// The whole cross-currency fix rests on one structural claim: every page that
// ADDS trades up loads them through getTradesWithMistakes(), which converts to
// the base currency. That claim is invisible at runtime — a page reading
// db.list("trades") and summing it produces a plausible-looking number that is
// simply wrong, exactly as /daily did before this change. So it is asserted
// against the source instead.
//
// The same reasoning as the revalidateEverything guard in actions.test.ts: in a
// codebase where new pages arrive regularly, stopping the mistake growing back
// matters more than the one-time cleanup.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { BASE_CONVERTED_FIELDS } from "@/lib/currency";
import { currencyFromPositionKey } from "@/lib/coindcx-sync";

function pageFiles(): { file: string; body: string }[] {
  const root = fileURLToPath(new URL("../../app", import.meta.url));
  const found: { file: string; body: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (entry !== "page.tsx") continue;
      // Comments stripped: a comment SAYING "not db.list(\"trades\")" is the
      // opposite of the mistake, and must not read as one.
      const body = readFileSync(full, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      found.push({ file: path.relative(root, full), body });
    }
  };
  walk(root);
  return found;
}

describe("no page sums trades it never converted", () => {
  it("every page that uses getTradePnl reads trades through getTradesWithMistakes", () => {
    // /daily failed this before the fix: it read db.list("trades") and rendered
    // each trade's P&L, so an INR-account row and a USDT-account row sat in the
    // same list looking directly comparable when they were 100x apart.
    for (const page of pageFiles()) {
      if (!page.body.includes("getTradePnl")) continue;
      assert.ok(
        !/db\.list\("trades"\)|listRecords\("trades"\)/.test(page.body),
        `${page.file} reads raw trades and also computes P&L — use getTradesWithMistakes() so the money is on one number line`,
      );
    }
  });
});

describe("the conversion covers exactly the money fields", () => {
  it("converts the four wallet-denominated fields and nothing else", () => {
    // Prices are in the pair's QUOTE currency, quantity is units of the coin,
    // and rMultiple is a ratio. Converting any of those is the ~100x bug that
    // started this; forgetting one of these four is the skew that followed it.
    assert.deepEqual([...BASE_CONVERTED_FIELDS], ["realizedPnl", "fees", "funding", "netPnl"]);
  });

  it("Trade's money fields are all in the converted list", () => {
    // If a fifth money field is ever added to Trade, this fails and asks the
    // question rather than letting it quietly skip conversion.
    const types = readFileSync(new URL("../../lib/types.ts", import.meta.url), "utf8");
    const tradeBlock = types.split("export type Trade = {")[1]?.split("\n};")[0] ?? "";
    const moneyish = [...tradeBlock.matchAll(/^\s{2}(\w+)\??:\s*number \| null/gm)]
      .map((match) => match[1])
      .filter((name) => /pnl|fee|funding/i.test(name));
    for (const field of moneyish) {
      assert.ok(
        (BASE_CONVERTED_FIELDS as readonly string[]).includes(field),
        `Trade.${field} looks like money but is never converted to the base currency`,
      );
    }
  });
});

describe("currencyFromPositionKey", () => {
  it("recovers the wallet from a key written before Trade.currency existed", () => {
    // positionKey() is `instrument|currency|openedAt`, so this is exact
    // recovery, not a guess — which is what lets already-accepted trades be
    // read correctly with no migration.
    assert.equal(currencyFromPositionKey("SOL|INR|1767225600000"), "INR");
    assert.equal(currencyFromPositionKey("B-ZEC|USDT|1767225600000"), "USDT");
  });

  it("returns null rather than guessing at anything that is not a key", () => {
    assert.equal(currencyFromPositionKey("nonsense"), null);
    assert.equal(currencyFromPositionKey("SOL||1767225600000"), null);
  });
});
