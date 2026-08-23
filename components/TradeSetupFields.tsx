import Link from "next/link";
import { ChipCheckboxGroup, ChipRadioGroup } from "@/components/Chips";
import { TextField } from "@/components/Fields";
import { OptionChipCheckbox } from "@/components/OptionField";
import { optionGroups, type OptionChoice } from "@/lib/options";
import { checklistScore, type SetupStep } from "@/lib/setups";
import type { Setup, Trade } from "@/lib/types";

// "How did I take this one?" — the system, the timeframes, the mechanisms, and
// how much of the model was actually there. All taps, no typing required.
//
// This is the half of a trade that makes filtered analysis possible later:
// P&L tells you *that* something worked, this tells you *what* worked. It sits
// in its own fold rather than inside "objective" or "subjective" data because
// it is neither — it's the execution, and burying it in a 20-field grid is how
// the old detail sections ended up unused.
export function TradeSetupFields({
  trade,
  setups,
  steps,
  timeframeChoices,
  mechanismChoices,
}: {
  trade: Pick<Trade, "setupId" | "setupName" | "timeframes" | "mechanisms" | "checklistSteps">;
  /** Active setups, plus this trade's own setup even if it's been archived. */
  setups: Pick<Setup, "id" | "name">[];
  /** The linked setup's checklist, parsed into tickable steps. */
  steps: SetupStep[];
  timeframeChoices: OptionChoice[];
  mechanismChoices: OptionChoice[];
}) {
  const score = checklistScore(steps, trade.checklistSteps);

  return (
    <div className="space-y-4">
      <ChipRadioGroup
        label="Playbook setup"
        name="setupId"
        options={[{ value: "", label: "None / freeform" }, ...setups.map((setup) => ({ value: setup.id, label: setup.name }))]}
        defaultValue={trade.setupId ?? ""}
        hint="Which system you were running. Its checklist becomes the steps below."
      />
      <TextField label="Setup name (freeform)" name="setupName" defaultValue={trade.setupName} />

      <OptionChipCheckbox
        label="Timeframes used"
        name="timeframes"
        choices={timeframeChoices}
        selected={trade.timeframes ?? []}
        placeholder={optionGroups.tradeTimeframe.placeholder}
        hint="Every chart you actually used — bias down to entry. Missing one? Type it in the box; it's a chip from next time."
      />

      <OptionChipCheckbox
        label="Mechanisms in the entry"
        name="mechanisms"
        choices={mechanismChoices}
        selected={trade.mechanisms ?? []}
        placeholder={optionGroups.mechanism.placeholder}
        hint="What the entry was built out of — usually two or three stacked. Hover a chip for what it means."
      />

      {steps.length ? (
        <div className="rounded-lg border border-forge-line bg-forge-panel/40 p-3">
          {/* Plain checkboxes: an all-unticked checklist posts nothing, so the
              marker is what tells the save "shown, none ticked" apart from
              "not shown". */}
          <input type="hidden" name="hasChecklistSteps" value="1" />
          <ChipCheckboxGroup
            label={`Model checklist — ${score ? `${score.met} of ${score.total}` : "0"} steps`}
            name="checklistSteps"
            options={steps.map((step) => ({ value: step.value, label: step.label }))}
            selected={trade.checklistSteps ?? []}
            hint={
              score?.complete
                ? "Every step was there. That's the trade you're trying to repeat."
                : "Tick only what was genuinely there. A half-met model is the most useful thing this journal can show you."
            }
          />
        </div>
      ) : (
        <p className="text-xs text-forge-muted">
          Want a tickable checklist here? Write the model one step per line in the{" "}
          <Link href="/playbook" className="text-forge-blue underline">
            playbook
          </Link>{" "}
          setup&apos;s <em>Entry checklist</em> — e.g. <em>HTF bias / trend</em>, <em>MTF + LTF market structure</em>,{" "}
          <em>Displacement</em>, <em>Liquidity taken</em>, <em>Entry (OTE, OB, FVG)</em> — then pick that setup above.
        </p>
      )}
    </div>
  );
}

/** The one-line version for a collapsed fold or a list row: what was used,
 *  without opening anything. */
export function TradeSetupSummary({
  trade,
  timeframeLabel,
  mechanismLabel,
  score,
  className = "",
}: {
  trade: Pick<Trade, "timeframes" | "mechanisms">;
  timeframeLabel: (value: string) => string;
  mechanismLabel: (value: string) => string;
  score: { met: number; total: number } | null;
  className?: string;
}) {
  const parts = [
    (trade.timeframes ?? []).map(timeframeLabel).join(" · "),
    (trade.mechanisms ?? []).map(mechanismLabel).join(" · "),
    score ? `${score.met}/${score.total} steps` : "",
  ].filter(Boolean);
  if (!parts.length) return null;
  return <span className={`text-xs font-normal text-forge-muted ${className}`}>{parts.join("  ·  ")}</span>;
}
