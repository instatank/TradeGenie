import Link from "next/link";
import { NotebookPen } from "lucide-react";
import { FreeNoteCard } from "@/components/FreeNoteCard";
import { QuickNoteComposer } from "@/components/QuickNoteComposer";
import { optionGroups, type OptionChoice } from "@/lib/options";
import type { FreeNote } from "@/lib/types";

// A day's loose thoughts: the box to write one, and the ones already written.
//
// Its own small form on purpose: it is the fastest thing on the page, and
// nesting it in a bigger save would mean a half-typed thought could ride along
// with (or be lost to) an unrelated save.
export function QuickNoteBox({
  notes,
  date,
  redirectTo,
  categoryChoices,
  categoryLabeler,
  tagVocabulary = [],
  tagGroups = [],
  defaultText = "",
  heading = "Quick note",
  subtitle = "Any thought that doesn't belong anywhere else. It lands in today's review.",
}: {
  notes: FreeNote[];
  /** yyyy-MM-dd — the day these notes are filed under. */
  date: string;
  redirectTo: string;
  categoryChoices: OptionChoice[];
  /** Stored category value → the label to show, custom labels included. */
  categoryLabeler: (value: string) => string;
  tagVocabulary?: string[];
  tagGroups?: { label: string; tags: string[] }[];
  defaultText?: string;
  heading?: string;
  subtitle?: string;
}) {
  return (
    <div id="quick-note" className="panel scroll-mt-24">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-forge-blue" aria-hidden="true" />
          <h2 className="font-semibold">{heading}</h2>
        </div>
        <Link href="/notes" className="shrink-0 text-xs text-forge-muted transition hover:text-forge-blue">
          All notes →
        </Link>
      </div>
      <p className="-mt-2 mb-3 text-xs text-forge-muted">{subtitle}</p>

      <QuickNoteComposer
        date={date}
        redirectTo={redirectTo}
        categoryChoices={categoryChoices}
        tagVocabulary={tagVocabulary}
        tagGroups={tagGroups}
        defaultText={defaultText}
        resetKey={`${notes.length}:${notes[notes.length - 1]?.id ?? ""}`}
      />

      {notes.length ? (
        <div className="mt-4 space-y-2 border-t border-forge-line pt-3">
          {notes.map((note) => (
            <FreeNoteCard
              key={note.id}
              note={note}
              redirectTo={redirectTo}
              categoryChoices={categoryChoices}
              categoryLabel={note.category ? categoryLabeler(note.category) : null}
              categoryPlaceholder={optionGroups.noteCategory.placeholder}
              tagVocabulary={tagVocabulary}
              tagGroups={tagGroups}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
