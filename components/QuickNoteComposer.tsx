import { saveQuickNoteAction } from "@/app/actions";
import { OptionChipRadio } from "@/components/OptionField";
import { TagPicker } from "@/components/TagPicker";
import { noOptionChoice, optionGroups, type OptionChoice } from "@/lib/options";

// Writing a quick note: one textarea and one button, plus two optional taps.
//
// The taps are what turn a pile of thoughts into something you can come back
// to: what the note is **about** (one category chip) and which **tags** it
// carries (your own vocabulary, with the assets you track offered as one-tap
// chips). Both are skippable — the fastest path is still type → Save, and the
// Today bar has neither.
export function QuickNoteComposer({
  date,
  redirectTo,
  categoryChoices,
  tagVocabulary = [],
  tagGroups = [],
  defaultText = "",
  defaultCategory = null,
  defaultTags = [],
  /** Changes when the note list changes, so a save leaves the chips clean for
   *  the next thought — a server-action redirect re-renders the form without
   *  remounting it, and the picker's state would otherwise survive. */
  resetKey = "",
}: {
  /** yyyy-MM-dd. Notes are filed to this day rather than "now", so writing up
   *  yesterday from the day's review page files it to yesterday. */
  date: string;
  redirectTo: string;
  categoryChoices: OptionChoice[];
  tagVocabulary?: string[];
  /** Shortcut rows for the tag picker — the assets being tracked. */
  tagGroups?: { label: string; tags: string[] }[];
  /** A thought carried here by the Today bar's long-press, so the gesture never
   *  costs you what you had already typed. */
  defaultText?: string;
  defaultCategory?: string | null;
  /** Pre-ticked tags — the mechanism reference uses it so a note written there
   *  is filed against that concept without you remembering the hashtag. */
  defaultTags?: string[];
  resetKey?: string;
}) {
  return (
    <form action={saveQuickNoteAction} className="space-y-3">
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
        // .textarea carries no width of its own — every other use sits inside a
        // .field flex column that stretches it. This one is a bare child of the
        // form, so it has to say so itself.
        className="textarea min-h-16 w-full"
      />

      <OptionChipRadio
        key={`category-${resetKey}`}
        label="About (optional)"
        name="category"
        choices={[noOptionChoice, ...categoryChoices]}
        defaultValue={defaultCategory ?? ""}
        placeholder={optionGroups.noteCategory.placeholder}
        hint="What this thought is about — it's how you find it again later. Missing one? Type it in the box; it's a chip from next time."
      />

      <TagPicker
        key={`tags-${resetKey}`}
        selected={defaultTags}
        vocabulary={tagVocabulary}
        groups={tagGroups}
        label="Tags (optional)"
        hint="Tap an asset or a tag. #hashtags typed above are picked up automatically."
      />

      <button className="button w-full sm:w-auto" type="submit">Save note</button>
    </form>
  );
}
