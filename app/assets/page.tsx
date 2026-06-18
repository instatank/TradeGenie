import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { LineChart } from "lucide-react";
import { createAssetAction } from "@/app/actions";
import { PageTitle, SelectField } from "@/components/Fields";
import { marketTypes, humanize } from "@/lib/constants";
import { getAssetsIndex } from "@/lib/data";

export default async function AssetsPage() {
  const assets = await getAssetsIndex();
  const active = assets.filter((asset) => !asset.isArchived);

  return (
    <main className="page-shell">
      <PageTitle
        title="Assets"
        subtitle="A living page per symbol — your running thesis, levels, and day-to-day thoughts in one place."
      />
      <section className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <form action={createAssetAction} className="panel space-y-4 self-start">
          <h2 className="font-semibold">Track a new asset</h2>
          <label className="field">
            <span className="label">Symbol</span>
            <input
              name="symbol"
              required
              placeholder="BTC, HYPE, SOL…"
              autoCapitalize="characters"
              className="input uppercase"
            />
          </label>
          <SelectField label="Market" name="marketType" options={marketTypes} defaultValue="CRYPTO_PERP" />
          <button className="button" type="submit">Start tracking</button>
        </form>

        <div className="space-y-3">
          {active.map((asset) => (
            <Link
              key={asset.id}
              href={`/assets/${asset.id}`}
              className="panel block transition hover:border-forge-blue"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <LineChart className="h-5 w-5 shrink-0 text-forge-green" aria-hidden="true" />
                  <span className="truncate text-lg font-semibold">{asset.symbol}</span>
                  <span className="shrink-0 rounded-md bg-forge-panel px-2 py-0.5 text-xs text-forge-muted">
                    {humanize(asset.marketType)}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-forge-muted">
                  {formatDistanceToNow(asset.lastActivity, { addSuffix: true })}
                </span>
              </div>
              {asset.htfBias || asset.ltfBias ? (
                <p className="mt-2 line-clamp-2 text-sm text-forge-ink">
                  {[asset.htfBias && `HTF: ${asset.htfBias}`, asset.ltfBias && `LTF: ${asset.ltfBias}`]
                    .filter(Boolean)
                    .join("  ·  ")}
                </p>
              ) : (
                <p className="mt-2 text-sm text-forge-muted">No bias noted yet.</p>
              )}
              <p className="mt-2 text-xs text-forge-muted">
                {asset.noteCount} note{asset.noteCount === 1 ? "" : "s"} in the thread
              </p>
            </Link>
          ))}
          {!active.length ? (
            <div className="panel muted">
              No assets tracked yet. Add one on the left — e.g. start a BTC or HYPE page and jot your thesis and levels.
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
