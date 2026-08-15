"use client";

import { useRef, useState, useTransition } from "react";
import { Sparkles, Undo2 } from "lucide-react";
import { structureAssetNoteDraftAction } from "@/app/actions";
import { TagPicker } from "@/components/TagPicker";
import type { OptionChoice } from "@/lib/options";

// The thread composer. It is NOT its own form any more — it lives inside the
// asset page's single form, so whatever is typed here is captured by the same
// Save that stores the current view and any note edits. A half-written note can
// no longer be lost by pressing the "other" button.
export function AssetNoteComposer({
  resetKey,
  tagVocabulary = [],
  timeframeChoices,
  timeframePlaceholder,
}: {
  resetKey: string | number;
  tagVocabulary?: string[];
  // Passed in rather than imported: lib/options reaches the Firestore adapter,
  // so this client component may only take the option *type* from it.
  timeframeChoices: OptionChoice[];
  timeframePlaceholder: string;
}) {
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
    <div className="panel space-y-3">
      <h2 className="font-semibold">Add to the thread</h2>
      <label className="field">
        <span className="label">What are you thinking right now?</span>
        <textarea
          // Remounts once the note is saved, clearing the box for the next thought.
          key={resetKey}
          ref={textareaRef}
          name="noteText"
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

      <div className="grid gap-3 sm:grid-cols-[200px_1fr] sm:items-end">
        <div className="field">
          <span className="label">Timeframe (optional)</span>
          <div className="flex flex-wrap items-center gap-2">
            <select name="noteTimeframe" defaultValue="" className="input min-w-28 flex-1">
              <option value="">None</option>
              {timeframeChoices.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
            {/* Your own timeframes (4H, Daily, weekly-close…) — typed once, a
                dropdown entry from then on. */}
            <input
              name="noteTimeframeCustom"
              placeholder={timeframePlaceholder}
              aria-label="Add your own timeframe"
              className="input w-36 border-dashed border-forge-blue/50 text-sm placeholder:text-forge-blue/70 focus:border-forge-blue"
            />
          </div>
        </div>
        <button
          type="button"
          onClick={handleStructure}
          disabled={pending}
          className="button-secondary flex items-center justify-center gap-2"
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {pending ? "Tidying…" : "Tidy this note with AI"}
        </button>
      </div>
      <TagPicker
        key={resetKey}
        name="noteTags"
        vocabulary={tagVocabulary}
        label="Tags for this note (optional)"
        hint="Tap the ones that fit, or make a new one. #hashtags in the note text are picked up too."
      />

      <p className="text-xs text-forge-muted">Saved by the Save button at the bottom — along with everything else on this page.</p>
    </div>
  );
}
