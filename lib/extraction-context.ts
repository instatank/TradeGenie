import { format } from "date-fns";
import { db } from "@/lib/data";

// The highest-value part of the pipeline: tell the model what this trader
// already has. Without it, "sol" invents a new symbol, "closed the bitcoin
// short" invents a second trade, and setup names get made up.
//
// Budget: ~300 tokens. Open trades are referenced by a SHORT HANDLE (T1, T2…)
// rather than a 36-character UUID — a UUID per trade would blow the budget on
// its own and gives the model far more to hallucinate. resolveTradeHandle()
// turns the handle back into a real id immediately after extraction, so nothing
// downstream ever sees a handle.

const MAX_OPEN_TRADES = 12;
const MAX_ASSETS = 20;
const MAX_RECENT_INSTRUMENTS = 10;
const MAX_SETUPS = 10;

export type OpenTradeRef = {
  handle: string;
  id: string;
  instrument: string;
  direction: string;
};

export type ExtractionContext = {
  text: string;
  openTrades: OpenTradeRef[];
};

export async function buildExtractionContext(): Promise<ExtractionContext> {
  const [trades, assets, setups] = await Promise.all([
    db.list("trades"),
    db.list("assets"),
    db.list("setups"),
  ]);

  const openTrades: OpenTradeRef[] = trades
    .filter((trade) => trade.status === "OPEN")
    .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime())
    .slice(0, MAX_OPEN_TRADES)
    .map((trade, index) => ({
      handle: `T${index + 1}`,
      id: trade.id,
      instrument: trade.instrument.toUpperCase(),
      direction: trade.direction,
    }));

  const openTradeLines = trades
    .filter((trade) => trade.status === "OPEN")
    .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime())
    .slice(0, MAX_OPEN_TRADES)
    .map((trade, index) =>
      `- T${index + 1} | ${trade.instrument.toUpperCase()} ${trade.direction} | entry ${trade.entryPrice ?? "n/a"} | opened ${format(trade.tradeDateTime, "d MMM")}`,
    );

  const trackedSymbols = assets
    .filter((asset) => !asset.isArchived)
    .map((asset) => asset.symbol.toUpperCase())
    .slice(0, MAX_ASSETS);

  const recentInstruments = dedupe(
    trades
      .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime())
      .map((trade) => trade.instrument.toUpperCase()),
  ).slice(0, MAX_RECENT_INSTRUMENTS);

  const setupNames = setups
    .filter((setup) => setup.isActive)
    .map((setup) => setup.name)
    .slice(0, MAX_SETUPS);

  const text = [
    "TRADER CONTEXT — the trader's existing data. Prefer matching one of these over inventing something new, but never force a match that isn't really there.",
    openTradeLines.length
      ? `Open trades (set linkTradeId to one of these handles, e.g. "T1", or null if genuinely ambiguous):\n${openTradeLines.join("\n")}`
      : "Open trades: none.",
    `Tracked assets: ${trackedSymbols.length ? trackedSymbols.join(", ") : "none yet"}`,
    `Recently traded instruments: ${recentInstruments.length ? recentInstruments.join(", ") : "none yet"}`,
    `Active setups from the playbook: ${setupNames.length ? setupNames.join(", ") : "none yet"}`,
  ].join("\n\n");

  return { text, openTrades };
}

// Turn whatever the model put in linkTradeId into a real trade id, or null.
// Accepts a handle ("T2"), a full trade id echoed back, or a bare symbol when
// exactly one open trade matches it. Anything ambiguous resolves to null so the
// review card shows the open-trade picker instead of guessing.
export function resolveTradeHandle(value: string | null, openTrades: OpenTradeRef[]): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;

  const byHandle = openTrades.find((trade) => trade.handle.toLowerCase() === text.toLowerCase());
  if (byHandle) return byHandle.id;

  const byId = openTrades.find((trade) => trade.id === text);
  if (byId) return byId.id;

  const symbol = text.toUpperCase();
  const bySymbol = openTrades.filter((trade) => trade.instrument === symbol);
  if (bySymbol.length === 1) return bySymbol[0].id;

  return null;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}
