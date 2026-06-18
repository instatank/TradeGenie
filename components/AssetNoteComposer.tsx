"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkles, Undo2 } from "lucide-react";
import { structureAssetNoteDraftAction } from "@/app/actions";
import { assetTimeframes, humanize } from "@/lib/constants";

export function AssetNoteComposer({ assetId, addAction }: { assetId: string; addAction: (formData: FormData) => void }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pending, startTransition] = useTransition();
  const [original, setOriginal] = useState<string | null>(null);
  const [source, setSource] = useState<"ai" | "basic" | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleStructure() {
    const current = textareaRef.current?.value.trim();
    setError(null);
    if (!current) {
      setError("Write a note first, then tidy it.");
      return;
    }
    const before = textareaRef.current!.value;
    startTransition(async () => {
      try {
        const result = await structureAssetNoteDraftAction(current);
        if (result.text && textareaRef.current) {
          setOriginal(before);
          setSource(result.source);
          textareaRef.current.value = result.text;
        }
      } catch {
        setError("Couldn't tidy that just now — your note is unchanged.");
      }
    });
  }

  function handleUndo() {
    if (original != null && textareaRef.current) {
      textareaRef.current.value = original;
    }
    setOriginal(null);
    setSource(null);
  }

  return (
    <form
      action={addAction}
      onSubmit={() => {
        // React 19 resets the uncontrolled form after the action; clear our UI hints too.
        setOriginal(null);
        setSource(null);
        setError(null);
      }}
      className="panel space-y-3"
    >
      <h2 className="font-semibold">Add to the thread</h2>
      <label className="field">
        <span className="label">What are you thinking right now?</span>
        <textarea
          ref={textareaRef}
          name="text"
          required
          rows={6}
          placeholder="Dump your thought process — analysis, what changed, what you're watching for. Free-form; tidy it after."
          className="textarea"
        />
      </label>

      {source ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-forge-line bg-forge-panel px-3 py-2 text-sm">
          <span className="text-forge-muted">
            {source === "ai" ? "Tidied by AI — review and edit before saving." : "Basic tidy (AI is off) — review before saving."}
          </span>
          <button type="button" onClick={handleUndo} className="flex items-center gap-1 text-forge-blue hover:underline">
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            Restore original
          </button>
        </div>
      ) : null}
      {error ? <p className="text-sm text-forge-red">{error}</p> : null}

      <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <label className="field">
          <span className="label">Timeframe (optional)</span>
          <select name="timeframe" defaultValue="" className="input">
            <option value="">None</option>
            {assetTimeframes.map((option) => (
              <option key={option} value={option}>
                {humanize(option)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={handleStructure}
          disabled={pending}
          className="button-secondary flex items-center justify-center gap-2"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {pending ? "Tidying…" : "Structure"}
        </button>
        <button className="button" type="submit">Add note</button>
      </div>
      <input type="hidden" name="assetId" value={assetId} />
    </form>
  );
}
