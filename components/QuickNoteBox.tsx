import { format } from "date-fns";
import { NotebookPen, Pencil, Trash2 } from "lucide-react";
import { deleteFreeNoteAction, saveQuickNoteAction, updateFreeNoteAction } from "@/app/actions";
import { TagPills } from "@/components/TagPills";
import type { FreeNote } from "@/lib/types";

// A thought box, nothing more. No type, no category, no fields to fill in —
// type it, save it, it's filed under that day's review. The one capture path in
// the app with nothing to decide before you can write.
//
// Its own small form on purpose: it is the fastest thing on the page, and
// nesting it in a bigger save would mean a half-typed thought could ride along
// with (or be lost to) an unrelated save.
export function QuickNoteBox({
  notes,
  date,
  redirectTo,
  defaultText = "",
  heading = "Quick note",
  subtitle = "Any thought that doesn't belong anywhere else. It lands in today's review.",
}: {
  notes: FreeNote[];
  /** yyyy-MM-dd. Notes are filed to this day rather than "now", so writing up
   *  yesterday from the day's review page files it to yesterday. */
  date: string;
  redirectTo: string;
  /** A thought carried here by the Today bar's long-press, so the gesture never
   *  costs you what you had already typed. */
  defaultText?: string;
  heading?: string;
  subtitle?: string;
}) {
  return (
    <div id="quick-note" className="panel scroll-mt-24">
      <div className="mb-3 flex items-center gap-2">
        <NotebookPen className="h-4 w-4 text-forge-blue" aria-hidden="true" />
        <h2 className="font-semibold">{heading}</h2>
      </div>
      <p className="-mt-2 mb-3 text-xs text-forge-muted">{subtitle}</p>

      <form action={saveQuickNoteAction} className="space-y-2">
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        <label className="sr-only" htmlFor="quick-note-text">Quick note</label>
        <textarea
          id="quick-note-text"
          name="text"
          // Remounts when a carried-over thought arrives, so defaultValue takes.
          key={defaultText}
          defaultValue={defaultText}
          autoFocus={Boolean(defaultText)}
          rows={2}
          placeholder="What's on your mind? #hashtags work here too."
          // .textarea carries no width of its own — every other use sits inside
          // a .field flex column that stretches it. This one is a bare child of
          // the form, so it has to say so itself.
          className="textarea min-h-16 w-full"
        />
        <button className="button w-full sm:w-auto" type="submit">Save note</button>
      </form>

      {notes.length ? (
        <div className="mt-4 space-y-2 border-t border-forge-line pt-3">
          {notes.map((note) => (
            <article key={note.id} id={`note-${note.id}`} className="group rounded-lg bg-forge-panel p-3 scroll-mt-24">
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
                <span className="text-[11px] text-forge-muted">{format(note.createdAt, "HH:mm")}</span>
                <TagPills tags={note.tags} />
              </div>
              {/* Fixing a typo or finishing a half-typed thought shouldn't mean
                  delete-and-retype. Same one-field shape as writing the note:
                  edit the words, tags re-derive from the #hashtags in them. */}
              <details className="mt-2">
                <summary className="inline-flex cursor-pointer items-center gap-1 text-[11px] text-forge-muted transition hover:text-forge-blue">
                  <Pencil className="h-3 w-3" aria-hidden="true" />
                  Edit
                </summary>
                <form action={updateFreeNoteAction} className="mt-2 space-y-2">
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
                  <button className="button-secondary" type="submit">Save changes</button>
                </form>
              </details>
            </article>
          ))}
        </div>
      ) : null}
    </div>
  );
}
