import { PageTitle } from "@/components/Fields";
import { TradeCalculator } from "@/components/TradeCalculator";
import { getTradesWithMistakes } from "@/lib/data";
import { calculateWinRate, getTradePnl } from "@/lib/metrics";

// A scratchpad, not a record. Nothing here is saved. It answers two questions,
// in the order you actually ask them: **how big should this be?** (entry, stop,
// account, risk % — no target needed) and then **is it worth taking once fees
// are paid?** The journal's own win rate is handed in so the long-run answer is
// about you, not a made-up 50%.
export default async function CalculatorPage() {
  const trades = await getTradesWithMistakes();
  const closedWithPnl = trades.filter((trade) => trade.status === "CLOSED" && getTradePnl(trade) != null);
  const winRate = calculateWinRate(trades);

  return (
    <main className="page-shell space-y-4">
      <PageTitle
        title="Position size & profitability"
        subtitle="How many units should this trade be? Then: where does it break even, what R are you really getting after fees, and what win rate does it need?"
      />
      <TradeCalculator
        journalWinRate={closedWithPnl.length >= 5 ? winRate : null}
        journalTradeCount={closedWithPnl.length}
      />
    </main>
  );
}
