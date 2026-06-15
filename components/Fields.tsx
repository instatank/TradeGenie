import { humanize } from "@/lib/constants";

export function SelectField({
  label,
  name,
  options,
  defaultValue,
  includeBlank = false,
}: {
  label: string;
  name: string;
  options: readonly string[];
  defaultValue?: string | null;
  includeBlank?: boolean;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <select name={name} defaultValue={defaultValue ?? ""} className="input">
        {includeBlank ? <option value="">None</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {humanize(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

export function TextField({
  label,
  name,
  defaultValue,
  type = "text",
  required = false,
  placeholder,
  step,
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  type?: string;
  required?: boolean;
  placeholder?: string;
  step?: string;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input
        name={name}
        type={type}
        required={required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        step={step ?? (type === "number" ? "any" : undefined)}
        className="input"
      />
    </label>
  );
}

export function TextAreaField({
  label,
  name,
  defaultValue,
  required = false,
  placeholder,
  rows = 4,
}: {
  label: string;
  name: string;
  defaultValue?: string | null;
  required?: boolean;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <textarea
        name={name}
        required={required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        rows={rows}
        className="textarea"
      />
    </label>
  );
}

export function BoolSelect({ label, name, defaultValue }: { label: string; name: string; defaultValue?: boolean | null }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <select name={name} defaultValue={defaultValue == null ? "" : String(defaultValue)} className="input">
        <option value="">Not reviewed</option>
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    </label>
  );
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-semibold tracking-normal">{title}</h1>
      {subtitle ? <p className="mt-1 text-sm text-forge-muted">{subtitle}</p> : null}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-forge-line bg-white p-6 text-center">
      <h2 className="font-medium">{title}</h2>
      <p className="mt-1 text-sm text-forge-muted">{body}</p>
    </div>
  );
}
