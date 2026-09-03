import { chipBase, toneChecked } from "@/components/Chips";
import type { OptionChoice } from "@/lib/options";

// Preset pills that aren't a closed list any more. Each control is the existing
// chip/select group plus a small "or type another…" box — the same shape as the
// symbol row on the quick trade log, which is the pattern the owner asked for.
//
// Zero client JS on purpose: the typed label rides along in the same form and
// the save action registers it (lib/options.ts), exactly like a #hashtag typed
// into a thesis becomes a tag. Nothing to click twice, nothing to save twice.
//
// Convention: a control named `x` posts its typed label in `xCustom`, and the
// typed label always wins over the tapped chip.

const customInputClass =
  "input w-44 border-dashed border-forge-blue/50 text-sm placeholder:text-forge-blue/70 focus:border-forge-blue";

function CustomBox({ name, placeholder, wide = false }: { name: string; placeholder: string; wide?: boolean }) {
  return (
    <input
      name={`${name}Custom`}
      placeholder={placeholder}
      aria-label={placeholder}
      className={`${customInputClass} ${wide ? "sm:w-64" : ""}`}
    />
  );
}

/** One-of chips + a box for a label that isn't there yet. */
export function OptionChipRadio({
  label,
  name,
  choices,
  defaultValue,
  placeholder,
  hint,
  tone = "neutral",
}: {
  label?: string;
  name: string;
  choices: OptionChoice[];
  defaultValue?: string | null;
  placeholder: string;
  hint?: string;
  tone?: keyof typeof toneChecked;
}) {
  return (
    <fieldset className="field">
      {label ? <span className="label">{label}</span> : null}
      <div className="flex flex-wrap items-center gap-2">
        {choices.map((choice) => (
          <label key={choice.value} className="inline-flex" title={choice.hint}>
            <input
              type="radio"
              name={name}
              value={choice.value}
              defaultChecked={defaultValue === choice.value}
              className="peer sr-only"
            />
            <span className={`${chipBase} ${toneChecked[tone]}`}>{choice.label}</span>
          </label>
        ))}
        <CustomBox name={name} placeholder={placeholder} />
      </div>
      {hint ? <p className="text-xs text-forge-muted">{hint}</p> : null}
    </fieldset>
  );
}

/** Tap-all-that-apply chips + a box that takes one or several new labels. */
export function OptionChipCheckbox({
  label,
  name,
  choices,
  selected = [],
  placeholder,
  hint,
}: {
  label?: string;
  name: string;
  choices: OptionChoice[];
  selected?: string[];
  placeholder: string;
  hint?: string;
}) {
  const selectedSet = new Set(selected);
  return (
    <fieldset className="field">
      {label ? <span className="label">{label}</span> : null}
      <div className="flex flex-wrap items-center gap-2">
        {choices.map((choice) => (
          <label key={choice.value} className="inline-flex" title={choice.hint}>
            <input
              type="checkbox"
              name={name}
              value={choice.value}
              defaultChecked={selectedSet.has(choice.value)}
              className="peer sr-only"
            />
            <span className={`${chipBase} ${toneChecked.neutral}`}>{choice.label}</span>
          </label>
        ))}
        <CustomBox name={name} placeholder={placeholder} wide />
      </div>
      <p className="text-xs text-forge-muted">
        {hint ?? "Separate several new ones with commas. They become chips here from next time."}
      </p>
    </fieldset>
  );
}

/** The big side-by-side buttons of `BigChoice` (Long/Short, the A/B/C execution
 *  grade) with a "type another" box on the end — for a one-of row that is a
 *  real decision worth a big target, but whose vocabulary is the trader's.
 *
 *  Auto-fit columns rather than one-per-option: a typed grade adds a button,
 *  and a fixed `repeat(n)` grid would squeeze them thinner every time. */
export function OptionBigChoice({
  label,
  name,
  choices,
  defaultValue,
  placeholder,
  hint,
  toneByValue = {},
}: {
  label?: string;
  name: string;
  choices: OptionChoice[];
  defaultValue?: string | null;
  placeholder: string;
  hint?: string;
  toneByValue?: Record<string, keyof typeof toneChecked>;
}) {
  return (
    <fieldset className="field">
      {label ? <span className="label">{label}</span> : null}
      <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(5.5rem, 1fr))" }}>
        {choices.map((choice) => (
          <label key={choice.value} className="flex" title={choice.hint}>
            <input
              type="radio"
              name={name}
              value={choice.value}
              defaultChecked={defaultValue === choice.value}
              className="peer sr-only"
            />
            <span
              className={`flex w-full cursor-pointer select-none flex-col items-center justify-center rounded-lg border border-forge-line bg-white px-3 py-2.5 text-center transition hover:border-forge-muted ${toneChecked[toneByValue[choice.value] ?? "neutral"]}`}
            >
              <span className="text-sm font-semibold">{choice.label}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <CustomBox name={name} placeholder={placeholder} />
        {hint ? <p className="text-xs text-forge-muted">{hint}</p> : null}
      </div>
    </fieldset>
  );
}

/** Dropdown version, for the folded editors that already use selects. */
export function OptionSelectField({
  label,
  name,
  choices,
  defaultValue,
  placeholder,
  includeBlank = false,
}: {
  label: string;
  name: string;
  choices: OptionChoice[];
  defaultValue?: string | null;
  placeholder: string;
  includeBlank?: boolean;
}) {
  return (
    <fieldset className="field">
      <span className="label">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <select name={name} defaultValue={defaultValue ?? ""} className="input min-w-32 flex-1">
          {includeBlank ? <option value="">None</option> : null}
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <CustomBox name={name} placeholder={placeholder} />
      </div>
    </fieldset>
  );
}
