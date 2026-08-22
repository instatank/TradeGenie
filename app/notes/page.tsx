import Link from "next/link";
import { format, isToday, isYesterday } from "date-fns";
import { NotebookPen, Search, X } from "lucide-react";
import { PageTitle } from "@/components/Fields";
import { FreeNoteCard } from "@/components/FreeNoteCard";
import { QuickNoteComposer } from "@/components/QuickNoteComposer";
import { getFreeNotes, getSymbolTagSuggestions, getTagVocabulary } from "@/lib/data";
import {
  UNCATEGORIZED,
  filterNotes,
  hasActiveNoteFilters,
  noteCategoryCounts,
  noteTagCounts,
  type NoteFilters,
} from "@/lib/notes";
import { getOptionCatalog, optionGroups } from "@/lib/options";
import { normalizeTag } from "@/lib/tags";
import type { FreeNote } from "@/lib/types";

const VISIBLE_TAGS = 14;

// Every quick note in one place, filterable. The day's review answers "what did
// I write on Tuesday"; this answers the other question — "everything I've ever
// thought about SOL", "every time I noted I was tilted" — by narrowing on the
// two axes a note carries: its category (one) and its tags (many).
//
// Filters are links, not a client form: every view is a real URL you can go
// back to, share with yourself, or bookmark. The text box is the same grammar
// as global search, so `#btc stop` means the same thing in both boxes.
export default async function NotesPage({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string; tag?: string | string[]; q?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const filters: NoteFilters = {
    category: params.category?.trim() || null,
    tags: [params.tag ?? []]
      .flat()
      .map((tag) => normalizeTag(tag))
      .filter((tag): tag is string => Boolean(tag)),
    q: params.q ?? "",
  };

  const [notes, options, tagVocabulary, symbolTags] = await Promise.all([
    getFreeNotes(),
    getOptionCatalog(),
    getTagVocabulary(),
    getSymbolTagSuggestions(),
  ]);

  const visible = filterNotes(notes, filters);
  // Counts come off ALL notes, not the filtered set: a chip that reads "asset
  // 12" and then shows nothing because another filter is on would be a lie, but
  // a chip that disappears as you narrow is worse — you'd never find your way
  // back. Counts are the size of that slice of the journal, full stop.
  const categoryCounts = noteCategoryCounts(notes);
  const tagCounts = noteTagCounts(notes);
  const categoryChoices = options.choices("noteCategory");
  const active = hasActiveNoteFilters(filters);

  const href = (next: Partial<NoteFilters>) => notesHref({ ...filters, ...next });
  const selfHref = href({});
  const days = groupByDay(visible);

  return (
    <main className="page-shell max-w-4xl">
      <PageTitle
        title="Notes"
        subtitle="Every loose thought you've captured. Narrow by what it was about, by tag, or by the words in it."
      />

      {/* ---- Write one ---- */}
      <div id="quick-note" className="panel mb-5 scroll-mt-24">
        <div className="mb-3 flex items-center gap-2">
          <NotebookPen className="h-4 w-4 text-forge-blue" aria-hidden="true" />
          <h2 className="font-semibold">New note</h2>
          <span className="text-xs text-forge-muted">· lands in today&apos;s review too</span>
        </div>
        <QuickNoteComposer
          date={format(new Date(), "yyyy-MM-dd")}
          redirectTo={selfHref}
          categoryChoices={categoryChoices}
          tagVocabulary={tagVocabulary.map((entry) => entry.tag)}
          tagGroups={symbolTags.length ? [{ label: "Assets", tags: symbolTags }] : []}
          resetKey={`${notes.length}:${notes[0]?.id ?? ""}`}
        />
      </div>

      {/* ---- Narrow it down ---- */}
      <div className="panel mb-5 space-y-3">
        <form action="/notes" className="flex flex-col gap-2 sm:flex-row">
          {filters.category ? <input type="hidden" name="category" value={filters.category} /> : null}
          {filters.tags.map((tag) => (
            <input key={tag} type="hidden" name="tag" value={tag} />
          ))}
          <div className="flex flex-1 items-center gap-2 rounded-lg border border-forge-line bg-white px-3">
            <Search className="h-4 w-4 shrink-0 text-forge-muted" aria-hidden="true" />
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Words in the note, or #tag"
              aria-label="Search notes"
              className="min-w-0 flex-1 border-0 bg-transparent py-2 text-base text-forge-ink outline-none placeholder:text-sm placeholder:text-forge-muted"
            />
          </div>
          <button className="button" type="submit">Search</button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-forge-muted">About</span>
          <FilterChip label="Anything" count={notes.length} active={!filters.category} href={href({ category: null })} />
          {categoryChoices.map((choice) => (
            <FilterChip
              key={choice.value}
              label={choice.label}
              count={categoryCounts.get(choice.value) ?? 0}
              active={filters.category === choice.value}
              href={href({ category: filters.category === choice.value ? null : choice.value })}
            />
          ))}
          <FilterChip
            label="No category"
            count={categoryCounts.get(UNCATEGORIZED) ?? 0}
            active={filters.category === UNCATEGORIZED}
            href={href({ category: filters.category === UNCATEGORIZED ? null : UNCATEGORIZED })}
          />
        </div>

        {tagCounts.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-forge-muted">Tagged</span>
            {/* Active tags always show, however far down the usage list they are,
                so a filter you turned on is never off-screen. */}
            {dedupe([...filters.tags, ...tagCounts.slice(0, VISIBLE_TAGS).map((entry) => entry.tag)]).map((tag) => {
              const on = filters.tags.includes(tag);
              return (
                <FilterChip
                  key={tag}
                  label={`#${tag}`}
                  count={tagCounts.find((entry) => entry.tag === tag)?.count ?? 0}
                  active={on}
                  href={href({ tags: on ? filters.tags.filter((entry) => entry !== tag) : [...filters.tags, tag] })}
                />
              );
            })}
            {tagCounts.length > VISIBLE_TAGS ? (
              <Link href="/search" className="text-xs text-forge-muted transition hover:text-forge-blue">
                all tags →
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-forge-line pt-2">
          <p className="text-xs text-forge-muted">
            {visible.length} note{visible.length === 1 ? "" : "s"}
            {active ? ` of ${notes.length}` : ""}
          </p>
          {active ? (
            <Link
              href="/notes"
              className="inline-flex items-center gap-1 text-xs text-forge-muted transition hover:text-forge-blue"
            >
              <X className="h-3 w-3" aria-hidden="true" />
              Clear filters
            </Link>
          ) : null}
        </div>
      </div>

      {/* ---- The stream ---- */}
      {days.length ? (
        <div className="space-y-5">
          {days.map(([key, dayNotes]) => (
            <section key={key}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <h2 className="text-sm font-semibold">{dayLabel(dayNotes[0].createdAt)}</h2>
                <Link
                  href={`/daily?date=${key}`}
                  className="text-xs text-forge-muted transition hover:text-forge-blue"
                >
                  that day&apos;s review →
                </Link>
              </div>
              <div className="space-y-2">
                {dayNotes.map((note) => (
                  <FreeNoteCard
                    key={note.id}
                    note={note}
                    redirectTo={selfHref}
                    categoryChoices={categoryChoices}
                    categoryLabel={note.category ? options.label("noteCategory", note.category) : null}
                    categoryPlaceholder={optionGroups.noteCategory.placeholder}
                    tagVocabulary={tagVocabulary.map((entry) => entry.tag)}
                    tagGroups={symbolTags.length ? [{ label: "Assets", tags: symbolTags }] : []}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <p className="panel text-sm text-forge-muted">
          {notes.length
            ? "Nothing matches those filters. Clear one and try again."
            : "No notes yet. Capture a thought on Today — one line, Enter, done."}
        </p>
      )}
    </main>
  );
}

function FilterChip({ label, count, active, href }: { label: string; count: number; active: boolean; href: string }) {
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-sm transition ${
        active
          ? "border-forge-blue bg-forge-blue text-white"
          : "border-forge-line bg-white text-forge-ink hover:border-forge-muted"
      }`}
    >
      {label}
      <span className={`ml-1 text-xs ${active ? "text-white/70" : "text-forge-muted"}`}>{count}</span>
    </Link>
  );
}

/** Newest day first; notes within a day read in the order they were written. */
function groupByDay(notes: FreeNote[]): Array<[string, FreeNote[]]> {
  const days = new Map<string, FreeNote[]>();
  for (const note of notes) {
    const key = format(note.createdAt, "yyyy-MM-dd");
    days.set(key, [...(days.get(key) ?? []), note]);
  }
  return [...days.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, dayNotes]) => [
      key,
      [...dayNotes].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    ]);
}

function dayLabel(date: Date) {
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE, d MMM yyyy");
}

function notesHref(filters: NoteFilters) {
  const params = new URLSearchParams();
  if (filters.category) params.set("category", filters.category);
  for (const tag of filters.tags) params.append("tag", tag);
  if (filters.q.trim()) params.set("q", filters.q.trim());
  const query = params.toString();
  return query ? `/notes?${query}` : "/notes";
}

function dedupe(tags: string[]) {
  return [...new Set(tags)];
}
