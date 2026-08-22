import { parseQuery } from "@/lib/search";
import type { FreeNote } from "@/lib/types";

// Filtering for the quick-note stream (/notes). Two axes, both optional:
//
//   category — what the note is about, one value per note (a `noteCategory`
//              option, built-in or one the trader typed).
//   tags     — everything else, many per note, from the one tag vocabulary.
//
// The text box uses the SAME grammar as global search (lib/search.ts):
// `#tag` tokens are exact-membership, plain words are case-insensitive
// AND-substrings, and they mix. One grammar in the app, not two — the DayOS
// lesson about two tokenizers applies just as much to two query parsers.
//
// A per-request linear scan, same call as the search index: at one trader's
// scale a stored index is a second source of truth for no measurable gain.

/** The category filter value meaning "notes with no category at all". */
export const UNCATEGORIZED = "none";

export type NoteFilters = {
  /** An option value, UNCATEGORIZED, or null for "any". */
  category: string | null;
  /** Exact-membership tags — the tag chips in the filter row. */
  tags: string[];
  /** Free text, in the search grammar. */
  q: string;
};

export const emptyNoteFilters: NoteFilters = { category: null, tags: [], q: "" };

export function hasActiveNoteFilters(filters: NoteFilters) {
  return Boolean(filters.category || filters.tags.length || filters.q.trim());
}

export function filterNotes(notes: FreeNote[], filters: NoteFilters): FreeNote[] {
  const parsed = parseQuery(filters.q);
  const requiredTags = [...new Set([...filters.tags, ...parsed.tags])];
  return notes.filter((note) => {
    if (filters.category === UNCATEGORIZED && note.category) return false;
    if (filters.category && filters.category !== UNCATEGORIZED && note.category !== filters.category) return false;
    const tags = note.tags ?? [];
    if (!requiredTags.every((tag) => tags.includes(tag))) return false;
    if (!parsed.terms.length) return true;
    const haystack = [note.text, ...tags.map((tag) => `#${tag}`)].join("\n").toLowerCase();
    return parsed.terms.every((term) => haystack.includes(term));
  });
}

/** Category counts over a set of notes — what the filter chips show, so a chip
 *  never promises results it can't deliver. Uncategorised counts too. */
export function noteCategoryCounts(notes: FreeNote[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    const key = note.category || UNCATEGORIZED;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Tags in use on quick notes, most used first — the filter row's chips. */
export function noteTagCounts(notes: FreeNote[]): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>();
  for (const note of notes) {
    for (const tag of note.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
