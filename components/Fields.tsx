"use client";

import { useId, useRef } from "react";
import { RichTextToolbar, useRichTextShortcuts } from "@/components/RichTextToolbar";
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
  const id = useId();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const handleKeyDown = useRichTextShortcuts(textareaRef);
  return (
    <div className="field">
      <label htmlFor={id} className="label">{label}</label>
      <RichTextToolbar textareaRef={textareaRef} />
      <textarea
        id={id}
        ref={textareaRef}
        name={name}
        required={required}
        defaultValue={defaultValue ?? ""}
        placeholder={placeholder}
        rows={rows}
        onKeyDown={handleKeyDown}
        className="textarea"
      />
    </div>
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

export function CheckboxGroup({
  label,
  name,
  options,
  selected = [],
}: {
  label: string;
  name: string;
  options: readonly (readonly [string, string, string?])[];
  selected?: string[];
}) {
  const selectedSet = new Set(selected);
  return (
    <fieldset className="field">
      <span className="label">{label}</span>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {options.map(([value, text, description]) => (
          <label key={value} className="flex items-start gap-2 rounded-md border border-forge-line p-2 text-sm">
            <input type="checkbox" name={name} value={value} defaultChecked={selectedSet.has(value)} className="mt-1" />
            <span>
              <span className="block font-medium">{text}</span>
              {description ? <span className="text-xs text-forge-muted">{description}</span> : null}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
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
