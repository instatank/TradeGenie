import Link from "next/link";
import { Lightbulb, Mic } from "lucide-react";
import { PageTitle } from "@/components/Fields";
import { QuickTradeForm } from "@/components/QuickTradeForm";
import { RunSetupBar } from "@/components/RunSetupBar";
import { db, getResurfacedLessons, getRunnableSetups, getTagVocabulary } from "@/lib/data";
import { getOptionCatalog } from "@/lib/options";

// One clean card. Symbol + direction is a complete log; the trade's own page
// holds every detail (prices, screenshots, playbook, conditions) after saving.
export default async function NewTradePage() {
  const [trades, lessons, tagVocabulary, options, runnableSetups] = await Promise.all([
    db.list("trades"), getResurfacedLessons(1), getTagVocabulary(), getOptionCatalog(), getRunnableSetups(),
  ]);
  const recentSymbols = [...new Set(trades
    .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime())
    .map((trade) => trade.instrument))].slice(0, 5);

  return (
    <main className="page-shell max-w-2xl">
      <PageTitle title="Log a trade" subtitle="Capture it before the details get fuzzy. You can add anything else later on the trade's page." />

      {lessons.length ? (
        <p className="mb-4 flex items-start gap-2 rounded-lg border-l-4 border-forge-gold bg-amber-50 px-3 py-2 text-sm">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-forge-gold" aria-hidden="true" />
          <span><span className="font-medium">Before you enter:</span> {lessons[0].lessonText}</span>
        </p>
      ) : null}

      <div className="panel">
        <QuickTradeForm
          recentSymbols={recentSymbols}
          tagVocabulary={tagVocabulary.map((entry) => entry.tag)}
          mindStateChoices={options.choices("mindState")}
          redirectTo="/trades"
          submitLabel="Log trade"
        />
        <div className="mt-3">
          <RunSetupBar setups={runnableSetups} />
        </div>
      </div>

      <Link href="/inbox" className="mt-4 flex items-start gap-2 rounded-lg border border-dashed border-forge-line bg-white p-3 text-sm text-forge-muted transition hover:border-forge-blue">
        <Mic className="mt-0.5 h-4 w-4 shrink-0 text-forge-green" aria-hidden="true" />
        <span>Prefer talking? Paste a voice-note transcript in <span className="font-medium text-forge-ink">Capture</span> — the trade, numbers and lesson get extracted for you.</span>
      </Link>
    </main>
  );
}
