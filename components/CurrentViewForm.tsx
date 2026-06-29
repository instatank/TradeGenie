"use client";

import { SelectField, TextAreaField, TextField } from "@/components/Fields";
import { marketTypes } from "@/lib/constants";

type AssetView = {
  id: string;
  htfBias: string | null;
  ltfBias: string | null;
  levels: string | null;
  gamePlan: string | null;
  marketType: string;
};

// The "Current view" snapshot form. On save it also sweeps up any unsent draft
// in the asset-note composer so a single "Save current view" click persists both
// the view edits and a note-in-progress (no separate "Add note" click needed).
export function CurrentViewForm({ asset, action }: { asset: AssetView; action: (formData: FormData) => void }) {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const form = event.currentTarget;
    const draft = document.getElementById("asset-note-draft") as HTMLTextAreaElement | null;
    const text = draft?.value.trim();
    if (!text) return;

    // The composer's textarea is `required`; submitting this form natively won't
    // touch it, so carry its draft over as hidden fields and clear it after.
    const timeframe = (document.getElementById("asset-note-draft-timeframe") as HTMLSelectElement | null)?.value ?? "";
    appendHidden(form, "noteText", text);
    appendHidden(form, "noteTimeframe", timeframe);
    if (draft) draft.value = "";
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="panel space-y-4">
      <h2 className="font-semibold">Current view</h2>
      <p className="-mt-2 text-xs text-forge-muted">Your live snapshot. Edit it as the picture changes — history lives in the thread.</p>
      <TextField label="HTF bias" name="htfBias" defaultValue={asset.htfBias} placeholder="e.g. Accumulation, higher lows intact" />
      <TextField label="LTF bias" name="ltfBias" defaultValue={asset.ltfBias} placeholder="e.g. Pullback to support, watching reaction" />
      <TextAreaField
        label="Levels I'm watching"
        name="levels"
        defaultValue={asset.levels}
        rows={4}
        placeholder={"e.g.\nSupport 38.2 — tracking for hold\nIf breaks → next target 35.0\nSFP off 41.4"}
      />
      <TextAreaField
        label="Current thesis & game plan"
        name="gamePlan"
        defaultValue={asset.gamePlan}
        rows={6}
        placeholder="What you want to do and why — the plan you'd want to re-read tomorrow."
      />
      <SelectField label="Market" name="marketType" options={marketTypes} defaultValue={asset.marketType} />
      <input type="hidden" name="id" value={asset.id} />
      <button className="button" type="submit">Save current view</button>
    </form>
  );
}

function appendHidden(form: HTMLFormElement, name: string, value: string) {
  let input = form.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
  if (!input) {
    input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    form.appendChild(input);
  }
  input.value = value;
}
