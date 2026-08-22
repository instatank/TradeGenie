"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { normalizeTag } from "@/lib/tags";

const VISIBLE_RECENT = 6;

// The tag picker: your own vocabulary as one-tap chips, plus a "+ New tag" box
// so you can invent a tag anywhere you can set one — the vocabulary is yours to
// grow, never a fixed list shipped with the app.
//
// Crowding is handled by recency: the tags already on this record plus your six
// most recently used ones sit out in the open, and the whole rest of the
// vocabulary hides behind "More tags". A tag you just made up is used
// immediately, so it comes back to the front row on its own next time.
//
// `groups` are shortcut rows shown above your own vocabulary — the assets you
// track, offered as one-tap chips so "a note about SOL" is one tap rather than
// remembering to type #sol. They are ordinary tags, not a second vocabulary:
// same picked state, same hidden field, same tokenizer. That is the whole point
// — a symbol chip and a typed #sol are the same tag, so search and filtering
// can never disagree about them.
//
// Submits one hidden `tags` input (comma separated) — the same field the plain
// text input used to post, parsed by the one tokenizer in lib/tags.ts.
export function TagPicker({
  selected = [],
  vocabulary = [],
  groups = [],
  name = "tags",
  label = "Tags",
  hint = "Tap to tag. #hashtags typed in the text above are picked up automatically.",
}: {
  selected?: string[];
  vocabulary?: string[];
  groups?: { label: string; tags: string[] }[];
  name?: string;
  label?: string;
  hint?: string;
}) {
  const [picked, setPicked] = useState<string[]>(() => [...new Set(selected)]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // A tag offered by a shortcut row is already on screen, so it never doubles
  // up in the vocabulary rows below.
  const grouped = useMemo(() => new Set(groups.flatMap((group) => group.tags)), [groups]);
  // Everything already on this record stays visible even if it's an old tag, so
  // the picker always shows the complete truth — that's what makes it safe for
  // a save to treat this field as the final word on the record's tags.
  const front = useMemo(() => {
    const rest = vocabulary.filter((tag) => !selected.includes(tag) && !grouped.has(tag));
    return [...new Set([...selected.filter((tag) => !grouped.has(tag)), ...rest.slice(0, VISIBLE_RECENT)])];
  }, [grouped, selected, vocabulary]);
  const overflow = useMemo(
    () => vocabulary.filter((tag) => !front.includes(tag) && !grouped.has(tag)),
    [front, grouped, vocabulary],
  );
  // Tags invented in this session live at the end until the page reloads.
  const invented = picked.filter((tag) => !front.includes(tag) && !overflow.includes(tag) && !grouped.has(tag));

  const toggle = (tag: string) =>
    setPicked((current) => (current.includes(tag) ? current.filter((entry) => entry !== tag) : [...current, tag]));

  function addDraft() {
    const tag = normalizeTag(draft);
    if (!tag) {
      setError(draft.trim() ? "Use 2–40 letters, numbers, - or _." : "Type a tag first.");
      return;
    }
    setPicked((current) => (current.includes(tag) ? current : [...current, tag]));
    setDraft("");
    setError(null);
    inputRef.current?.focus();
  }

  return (
    <fieldset className="field" data-tag-picker={name}>
      <span className="label">{label}</span>
      <input type="hidden" name={name} value={picked.join(", ")} />

      {groups
        .filter((group) => group.tags.length)
        .map((group) => (
          <div key={group.label} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-forge-muted">{group.label}</span>
            {group.tags.map((tag) => (
              <TagChip key={tag} tag={tag} active={picked.includes(tag)} onClick={() => toggle(tag)} />
            ))}
          </div>
        ))}

      <div className="flex flex-wrap items-center gap-2">
        {[...front, ...invented].map((tag) => (
          <TagChip key={tag} tag={tag} active={picked.includes(tag)} onClick={() => toggle(tag)} />
        ))}

        {overflow.length && !showAll ? (
          <button
            type="button"
            onClick={() => setShowAll(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-forge-line px-3 py-1.5 text-sm text-forge-muted transition hover:border-forge-muted hover:text-forge-ink"
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            More tags ({overflow.length})
          </button>
        ) : null}

        {!adding ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-forge-blue/50 px-3 py-1.5 text-sm font-medium text-forge-blue transition hover:border-forge-blue hover:bg-sky-50"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New tag
          </button>
        ) : null}
      </div>

      {showAll && overflow.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-forge-line bg-forge-panel/50 p-2">
          {overflow.map((tag) => (
            <TagChip key={tag} tag={tag} active={picked.includes(tag)} onClick={() => toggle(tag)} />
          ))}
          <button
            type="button"
            onClick={() => setShowAll(false)}
            className="rounded-full px-2 py-1 text-xs text-forge-muted transition hover:text-forge-ink"
          >
            Show less
          </button>
        </div>
      ) : null}

      {adding ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            // Enter adds the tag — it must never submit the page-wide form.
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addDraft();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setAdding(false);
                setDraft("");
                setError(null);
              }
            }}
            placeholder="your own tag, e.g. patience-paid"
            aria-label="New tag"
            className="input w-52"
          />
          <button type="button" onClick={addDraft} className="button-secondary min-h-9 px-3 text-sm">Add</button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
              setDraft("");
              setError(null);
            }}
            className="rounded-md p-1.5 text-forge-muted transition hover:text-forge-ink"
            aria-label="Close new tag box"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {error ? <p className="text-xs text-forge-red">{error}</p> : null}
      <span className="text-xs text-forge-muted">{hint}</span>
    </fieldset>
  );
}

function TagChip({ tag, active, onClick }: { tag: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`cursor-pointer select-none rounded-full border px-3 py-1.5 text-sm transition ${
        active
          ? "border-forge-blue bg-forge-blue text-white"
          : "border-forge-line bg-white text-forge-ink hover:border-forge-muted"
      }`}
    >
      #{tag}
    </button>
  );
}
