import { quickLogTradeAction } from "@/app/actions";
import { BigChoice, ChipRadioGroup } from "@/components/Chips";
import { OptionChipRadio } from "@/components/OptionField";
import { TagPicker } from "@/components/TagPicker";
import { optionGroups, type OptionChoice } from "@/lib/options";

// The 30-second trade log. Symbol + direction + status is a complete entry;
// everything else is optional and stays out of the way. Chips are styled radio
// inputs, so the form still posts as a plain form — only the tag picker (which
// has to be interactive to let you invent a tag) ships any client JS.
export function QuickTradeForm({
  recentSymbols,
  tagVocabulary = [],
  mindStateChoices,
  redirectTo,
  submitLabel = "Log it",
  defaultInstrument,
  defaultDirection,
}: {
  recentSymbols: string[];
  tagVocabulary?: string[];
  mindStateChoices: OptionChoice[];
  redirectTo: string;
  submitLabel?: string;
  /** Prefilled when arriving from an exchange position that has no journal
   *  entry yet. The symbol and direction are facts the exchange already knows,
   *  so making you retype them would be friction for nothing — but everything
   *  that matters (why you took it) is still yours to write. */
  defaultInstrument?: string | null;
  defaultDirection?: string | null;
}) {
  return (
    <form action={quickLogTradeAction} className="space-y-4">
      <input type="hidden" name="redirectTo" value={redirectTo} />

      <div className="field">
        <span className="label">Symbol</span>
        <div className="flex flex-wrap items-center gap-2">
          {recentSymbols.slice(0, 5).map((symbol) => (
            <label key={symbol} className="inline-flex">
              <input type="radio" name="instrumentChip" value={symbol} className="peer sr-only" />
              <span className="cursor-pointer select-none rounded-full border border-forge-line bg-white px-3 py-1.5 text-sm font-medium transition hover:border-forge-muted peer-checked:border-forge-ink peer-checked:bg-forge-ink peer-checked:text-white">
                {symbol}
              </span>
            </label>
          ))}
          <input
            name="instrument"
            defaultValue={defaultInstrument ?? ""}
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
        defaultValue={defaultDirection}
      />

      <ChipRadioGroup
        name="status"
        options={[
          { value: "OPEN", label: "I'm in it now" },
          { value: "CLOSED", label: "Already closed" },
          { value: "IDEA", label: "Just an idea" },
        ]}
        defaultValue="OPEN"
      />

      <label className="field">
        <span className="label">
          Why this trade? <span className="font-normal text-forge-muted">(one line is plenty — optional)</span>
        </span>
        <textarea name="entryThesis" rows={2} placeholder="What did you see? e.g. bounced off support, funding reset…" className="textarea min-h-16" />
      </label>

      <TagPicker
        vocabulary={tagVocabulary}
        label="Tags (optional)"
        hint="One tap each. Hit “New tag” to invent your own — it sticks around for next time."
      />

      <details className="rounded-lg border border-forge-line p-3">
        <summary className="cursor-pointer text-sm font-semibold text-forge-muted">
          Numbers &amp; mood <span className="font-normal">(optional — entry + stop lets me work out your R for you)</span>
        </summary>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MiniNumber label="Entry" name="entryPrice" />
          <MiniNumber label="Stop" name="stopPrice" />
          <MiniNumber label="Exit" name="exitPrice" />
          <MiniNumber label="P&L" name="realizedPnl" />
        </div>
        <div className="mt-3">
          <OptionChipRadio
            label="How do you feel right now?"
            name="emotionalState"
            choices={mindStateChoices}
            placeholder={optionGroups.mindState.placeholder}
          />
        </div>
      </details>

      <button className="button w-full sm:w-auto" type="submit">{submitLabel}</button>
    </form>
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
