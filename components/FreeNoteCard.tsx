import Link from "next/link";
import { format, isSameDay } from "date-fns";
import { Pencil, Trash2 } from "lucide-react";
import { deleteFreeNoteAction, updateFreeNoteAction } from "@/app/actions";
import { OptionChipRadio } from "@/components/OptionField";
import { TagPicker } from "@/components/TagPicker";
import { TagPills } from "@/components/TagPills";
import { noOptionChoice, type OptionChoice } from "@/lib/options";
import type { FreeNote } from "@/lib/types";

// One saved thought, wherever it's being read: the day's review lists them,
// /notes lists them across days. Same card either way, so a note looks and
// edits identically in both places rather than drifting into two components.
//
// The edit fold carries the same three controls the note was written with —
// text, category, tags — because the save treats every one of them as the
// record's complete truth. A fold that showed only the text would make
// "fix a typo" quietly wipe the tags.
export function FreeNoteCard({
  note,
  redirectTo,
  categoryChoices,
  categoryLabel,
  categoryPlaceholder,
  tagVocabulary = [],
  tagGroups = [],
  showDate = false,
}: {
  note: FreeNote;
  redirectTo: string;
  categoryChoices: OptionChoice[];
  /** Display label for the note's stored category, custom labels included. */
  categoryLabel: string | null;
  categoryPlaceholder: string;
  tagVocabulary?: string[];
  tagGroups?: { label: string; tags: string[] }[];
  /** /notes spans days, so the stamp there says which day; the day's own review
   *  already knows, and only needs the clock time. */
  showDate?: boolean;
}) {
  const stamp = showDate
    ? format(note.createdAt, isSameDay(note.createdAt, new Date()) ? "'Today' HH:mm" : "d MMM · HH:mm")
    : format(note.createdAt, "HH:mm");

  return (
    <article id={`note-${note.id}`} className="group rounded-lg bg-forge-panel p-3 scroll-mt-24">
      <div className="flex items-start justify-between gap-2">
        <p className="whitespace-pre-wrap text-sm">{note.text}</p>
        <form action={deleteFreeNoteAction} className="shrink-0">
          <input type="hidden" name="id" value={note.id} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <button
            type="submit"
            className="rounded-md p-1 text-forge-muted transition hover:bg-red-50 hover:text-forge-red"
            title="Delete this note"
            aria-label="Delete this note"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </form>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <span className="text-[11px] text-forge-muted">{stamp}</span>
        {note.category && categoryLabel ? (
          // Tapping the category filters every note of that kind, the same way
          // tapping a tag pill runs an exact-tag search.
          <Link
            href={`/notes?category=${encodeURIComponent(note.category)}`}
            className="rounded-full border border-forge-line bg-white px-2 py-0.5 text-[11px] font-medium text-forge-ink transition hover:border-forge-blue hover:text-forge-blue"
          >
            {categoryLabel}
          </Link>
        ) : null}
        <TagPills tags={note.tags} />
      </div>

      {/* Fixing a typo or finishing a half-typed thought shouldn't mean
          delete-and-retype. Same shape as writing the note. */}
      <details className="mt-2">
        <summary className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-forge-muted transition hover:text-forge-blue">
          <Pencil className="h-3 w-3" aria-hidden="true" />
          Edit
        </summary>
        <form action={updateFreeNoteAction} className="mt-2 space-y-3">
          <input type="hidden" name="id" value={note.id} />
          <input type="hidden" name="redirectTo" value={redirectTo} />
          <label className="sr-only" htmlFor={`edit-note-${note.id}`}>Edit note</label>
          <textarea
            id={`edit-note-${note.id}`}
            name="text"
            defaultValue={note.text}
            rows={3}
            className="textarea min-h-16 w-full"
          />
          <OptionChipRadio
            label="About"
            name="category"
            choices={[noOptionChoice, ...categoryChoices]}
            defaultValue={note.category ?? ""}
            placeholder={categoryPlaceholder}
          />
          <TagPicker
            name="tags"
            selected={note.tags ?? []}
            vocabulary={tagVocabulary}
            groups={tagGroups}
            hint="Tapped tags plus any #hashtags in the text above."
          />
          <button className="button-secondary" type="submit">Save changes</button>
        </form>
      </details>
    </article>
  );
}
