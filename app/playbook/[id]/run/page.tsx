import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ClipboardCheck } from "lucide-react";
import { startTradeFromSetupAction } from "@/app/actions";
import { BigChoice, ChipRadioGroup, chipBase, toneChecked } from "@/components/Chips";
import { PageTitle } from "@/components/Fields";
import { OptionChipCheckbox } from "@/components/OptionField";
import { db } from "@/lib/data";
import { getOptionCatalog, optionGroups } from "@/lib/options";
import { setupSteps } from "@/lib/setups";

// The checklist, BEFORE the trade.
//
// Ticking the model after the fact grades a decision you already made; this is
// the same five taps at the only moment they can change anything. You tick what
// is genuinely there, the score counts itself as you go, and if a step is
// missing the page says so before you press the button — it never blocks you,
// because a journal that refuses to record a trade you took is a journal you
// stop using.
//
// What it logs is an ordinary trade: same fields, same collection, with the
// setup, the ticked steps, the timeframes and the mechanisms already on it. So
// the trade arrives in the journal fully tagged without a second pass, which is
// the whole reason this path exists.
export default async function RunSetupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [setup, trades, options] = await Promise.all([db.get("setups", id), db.list("trades"), getOptionCatalog()]);
  if (!setup) notFound();

  const steps = setupSteps(setup.checklist);
  const recentSymbols = [...new Set(
    [...trades]
      .sort((a, b) => b.tradeDateTime.getTime() - a.tradeDateTime.getTime())
      .map((trade) => trade.instrument)
      .filter(Boolean),
  )].slice(0, 5);

  return (
    <main className="page-shell max-w-3xl">
      <Link href="/playbook" className="mb-2 inline-flex items-center gap-1 text-sm text-forge-muted transition hover:text-forge-ink">
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        Playbook
      </Link>
      <PageTitle
        title={`Before you take it — ${setup.name}`}
        subtitle="Tick what's actually on the chart right now. Nothing here blocks you; it just makes you look before you press the button."
      />

      {steps.length ? (
        <form action={startTradeFromSetupAction} className="checklist-gate space-y-5">
          <input type="hidden" name="setupId" value={setup.id} />
          <input type="hidden" name="hasChecklistSteps" value="1" />

          {/* ---- The model ---- */}
          <section className="panel space-y-3">
            <div className="flex items-center gap-2">
              <ClipboardCheck className="h-4 w-4 text-forge-blue" aria-hidden="true" />
              <h2 className="font-semibold">The model</h2>
              <span className="text-xs text-forge-muted">· {steps.length} steps</span>
            </div>

            <div className="grid gap-2">
              {steps.map((step, index) => (
                <label key={step.value} className="inline-flex cursor-pointer items-center gap-3">
                  <input type="checkbox" name="checklistSteps" value={step.value} className="peer sr-only" />
                  <span className="flex w-full items-center gap-3 rounded-lg border border-forge-line bg-white px-3 py-2.5 text-sm transition peer-checked:border-forge-green peer-checked:bg-emerald-50 peer-checked:font-medium">
                    {/* No peer-checked here: the peer variant only reaches the
                        input's siblings, and this badge is a descendant of one. */}
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-forge-line text-[11px] text-forge-muted">
                      {index + 1}
                    </span>
                    {step.label}
                  </span>
                </label>
              ))}
            </div>

            {/* Counts itself in CSS — must sit after the boxes it counts. */}
            {/* Screen readers get the ticked boxes themselves; this line is a
                CSS counter, so it is decorative for them and hidden. */}
            <p className="text-sm font-medium" aria-hidden="true">
              <span className="steps-met" /> of {steps.length} steps ticked
            </p>
            <p className="when-incomplete items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>
                Something in the model isn&apos;t there yet. Taking it anyway is allowed — it just gets recorded as what it was, so
                you can see later whether the half-model trades are the ones costing you.
              </span>
            </p>

            {setup.rules ? (
              <details className="rounded-lg border border-forge-line p-3">
                <summary className="cursor-pointer text-sm font-semibold text-forge-muted">The rules, in your words</summary>
                <p className="mt-2 whitespace-pre-wrap text-sm">{setup.rules}</p>
              </details>
            ) : null}
          </section>

          {/* ---- The trade ---- */}
          <section className="panel space-y-4">
            <h2 className="font-semibold">The trade</h2>

            <div className="field">
              <span className="label">Symbol</span>
              <div className="flex flex-wrap items-center gap-2">
                {recentSymbols.map((symbol) => (
                  <label key={symbol} className="inline-flex">
                    <input type="radio" name="instrumentChip" value={symbol} className="peer sr-only" />
                    <span className={`${chipBase} ${toneChecked.neutral}`}>{symbol}</span>
                  </label>
                ))}
                <input
                  name="instrument"
                  placeholder={recentSymbols.length ? "or type another…" : "BTC, ETH, SOL…"}
                  autoCapitalize="characters"
                  className="input w-36 uppercase placeholder:normal-case"
                />
              </div>
            </div>

            <BigChoice
              name="direction"
              options={[
                { value: "LONG", label: "Long", hint: "betting it goes up" },
                { value: "SHORT", label: "Short", hint: "betting it goes down" },
              ]}
              toneByValue={{ LONG: "green", SHORT: "red" }}
            />

            <ChipRadioGroup
              name="status"
              options={[
                { value: "OPEN", label: "I'm taking it now" },
                { value: "IDEA", label: "Watching it" },
              ]}
              defaultValue="OPEN"
            />

            <OptionChipCheckbox
              label="Timeframes used"
              name="timeframes"
              choices={options.choices("tradeTimeframe")}
              placeholder={optionGroups.tradeTimeframe.placeholder}
              hint="Bias down to entry."
            />

            <OptionChipCheckbox
              label="Mechanisms in the entry"
              name="mechanisms"
              choices={options.choices("mechanism")}
              placeholder={optionGroups.mechanism.placeholder}
              hint="What you're actually entering on. Hover a chip for what it means."
            />

            <label className="field">
              <span className="label">
                Why this one? <span className="font-normal text-forge-muted">(one line — optional, #hashtags become tags)</span>
              </span>
              <textarea name="entryThesis" rows={2} placeholder="e.g. swept Asia low, 5m displacement, entering the FVG" className="textarea min-h-16" />
            </label>

            <details className="rounded-lg border border-forge-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-forge-muted">
                Levels <span className="font-normal">(optional — entry + stop lets me work out your R)</span>
              </summary>
              <div className="mt-3 grid grid-cols-3 gap-3">
                <MiniNumber label="Entry" name="entryPrice" />
                <MiniNumber label="Stop" name="stopPrice" />
                <MiniNumber label="Target" name="targetPrice" />
              </div>
            </details>
          </section>

          <div className="flex flex-wrap items-center gap-3">
            <button className="button" type="submit">
              <span>Log this trade —</span>
              <span>
                <span className="steps-met" aria-hidden="true" />/{steps.length} steps
              </span>
            </button>
            <Link href="/playbook" className="text-sm text-forge-muted transition hover:text-forge-ink">
              Not taking it
            </Link>
          </div>
        </form>
      ) : (
        <div className="panel space-y-2">
          <p className="text-sm">
            <strong>{setup.name}</strong> has no checklist yet, so there is nothing to tick before the trade.
          </p>
          <p className="text-sm text-forge-muted">
            Write the model one step per line in this setup&apos;s <em>Entry checklist</em> — e.g. <em>HTF bias / trend</em>,{" "}
            <em>MTF + LTF market structure</em>, <em>Displacement</em>, <em>Liquidity taken</em>, <em>Entry (OTE, OB, FVG)</em> — and
            this page becomes your pre-trade gate.
          </p>
          <Link href="/playbook" className="button-secondary w-fit">Edit the setup</Link>
        </div>
      )}
    </main>
  );
}

function MiniNumber({ label, name }: { label: string; name: string }) {
  return (
    <label className="field">
      <span className="text-xs font-medium text-forge-muted">{label}</span>
      <input name={name} type="number" step="any" className="input" />
    </label>
  );
}
