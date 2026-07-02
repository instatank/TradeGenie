// Tap-first form controls. Plain radio/checkbox inputs styled as chips, so every
// form stays a zero-JS server-rendered <form> — one tap instead of opening a
// dropdown. This is the core input style of the simplified daily loop.

export type ChipOption = {
  value: string;
  label: string;
  hint?: string;
};

const toneChecked: Record<string, string> = {
  neutral: "peer-checked:border-forge-ink peer-checked:bg-forge-ink peer-checked:text-white",
  green: "peer-checked:border-forge-green peer-checked:bg-forge-green peer-checked:text-white",
  red: "peer-checked:border-forge-red peer-checked:bg-forge-red peer-checked:text-white",
  blue: "peer-checked:border-forge-blue peer-checked:bg-forge-blue peer-checked:text-white",
  gold: "peer-checked:border-forge-gold peer-checked:bg-forge-gold peer-checked:text-white",
};

const chipBase =
  "cursor-pointer select-none rounded-full border border-forge-line bg-white px-3 py-1.5 text-sm text-forge-ink transition hover:border-forge-muted";

export function ChipRadioGroup({
  label,
  name,
  options,
  defaultValue,
  tone = "neutral",
  toneByValue,
  hint,
}: {
  label?: string;
  name: string;
  options: readonly ChipOption[];
  defaultValue?: string | null;
  tone?: keyof typeof toneChecked;
  /** Per-option tone override, e.g. LONG → green, SHORT → red. */
  toneByValue?: Record<string, keyof typeof toneChecked>;
  hint?: string;
}) {
  return (
    <fieldset className="field">
      {label ? <span className="label">{label}</span> : null}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="inline-flex">
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={defaultValue === option.value}
              className="peer sr-only"
            />
            <span className={`${chipBase} ${toneChecked[toneByValue?.[option.value] ?? tone]}`}>
              {option.label}
            </span>
          </label>
        ))}
      </div>
      {hint ? <p className="text-xs text-forge-muted">{hint}</p> : null}
    </fieldset>
  );
}

export function ChipCheckboxGroup({
  label,
  name,
  options,
  selected = [],
  hint,
}: {
  label?: string;
  name: string;
  options: readonly ChipOption[];
  selected?: string[];
  hint?: string;
}) {
  const selectedSet = new Set(selected);
  return (
    <fieldset className="field">
      {label ? <span className="label">{label}</span> : null}
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.value} className="inline-flex" title={option.hint}>
            <input
              type="checkbox"
              name={name}
              value={option.value}
              defaultChecked={selectedSet.has(option.value)}
              className="peer sr-only"
            />
            <span className={`${chipBase} ${toneChecked.neutral}`}>{option.label}</span>
          </label>
        ))}
      </div>
      {hint ? <p className="text-xs text-forge-muted">{hint}</p> : null}
    </fieldset>
  );
}

/** Two or three big side-by-side buttons (e.g. Long / Short). */
export function BigChoice({
  label,
  name,
  options,
  defaultValue,
  toneByValue = {},
}: {
  label?: string;
  name: string;
  options: readonly ChipOption[];
  defaultValue?: string | null;
  toneByValue?: Record<string, keyof typeof toneChecked>;
}) {
  return (
    <fieldset className="field">
      {label ? <span className="label">{label}</span> : null}
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((option) => (
          <label key={option.value} className="flex">
            <input
              type="radio"
              name={name}
              value={option.value}
              defaultChecked={defaultValue === option.value}
              className="peer sr-only"
            />
            <span
              className={`flex w-full cursor-pointer select-none flex-col items-center justify-center rounded-lg border border-forge-line bg-white px-3 py-2.5 text-center transition hover:border-forge-muted ${toneChecked[toneByValue[option.value] ?? "neutral"]}`}
            >
              <span className="text-sm font-semibold">{option.label}</span>
              {option.hint ? <span className="text-xs opacity-80">{option.hint}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Yes / No pair on one line with the question as the label. */
export function YesNoChips({
  label,
  name,
  defaultValue,
}: {
  label: string;
  name: string;
  defaultValue?: boolean | null;
}) {
  return (
    <ChipRadioGroup
      label={label}
      name={name}
      options={[
        { value: "true", label: "Yes" },
        { value: "false", label: "No" },
      ]}
      defaultValue={defaultValue == null ? undefined : String(defaultValue)}
      toneByValue={{ true: "green", false: "red" }}
    />
  );
}

/** 1–10 scale as number chips. */
export function ScaleChips({
  label,
  name,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  defaultValue?: number | null;
  hint?: string;
}) {
  const options = Array.from({ length: 10 }, (_, index) => ({
    value: String(index + 1),
    label: String(index + 1),
  }));
  return (
    <ChipRadioGroup
      label={label}
      name={name}
      options={options}
      defaultValue={defaultValue == null ? undefined : String(defaultValue)}
      hint={hint}
    />
  );
}
