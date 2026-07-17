// The ONE tag tokenizer. Every path that turns text into tags — inline
// #hashtags, the optional "Tags" form inputs, and search-query parsing — goes
// through normalizeTag(). DayOS shipped two tokenizers that quietly diverged
// (hyphens, non-ASCII) and the split haunted every tag feature; we refuse to
// repeat that. If you need different tag behavior, change it HERE only.
//
// A tag is: lowercase letters/digits/hyphens/underscores, 2–40 chars.
// "#Side-Project" → "side-project". "#1" → dropped (too short/noisy).

const TAG_BODY = /[a-z0-9][a-z0-9_-]*/;
// The '#' must start a word ("stop 64#200" is a price typo, not a tag).
const INLINE_TAG_PATTERN = /(?<![\w#])#([A-Za-z0-9][A-Za-z0-9_-]*)/g;

export function normalizeTag(raw: string): string | null {
  const cleaned = raw
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (cleaned.length < 2 || cleaned.length > 40) return null;
  if (!TAG_BODY.test(cleaned)) return null;
  return cleaned;
}

// Inline #hashtags typed anywhere in free text.
export function extractTags(text: string | null | undefined): string[] {
  if (!text) return [];
  const tags: string[] = [];
  for (const match of text.matchAll(INLINE_TAG_PATTERN)) {
    const tag = normalizeTag(match[1]);
    if (tag) tags.push(tag);
  }
  return dedupe(tags);
}

// The optional "Tags" input on forms: comma/space separated, '#' optional.
export function parseTagInput(input: string | null | undefined): string[] {
  if (!input) return [];
  return dedupe(
    input
      .split(/[\s,]+/)
      .map((token) => normalizeTag(token))
      .filter((tag): tag is string => Boolean(tag)),
  );
}

// The canonical save-time derivation: union of every inline #hashtag across the
// record's text fields plus whatever the trader typed in the Tags input.
// To fully remove a tag, clear it from both the text and the Tags input —
// a tag never silently disappears while its #hashtag still sits in the note.
export function deriveTags(
  texts: Array<string | null | undefined>,
  manualInput?: string | null,
): string[] {
  return dedupe([...texts.flatMap((text) => extractTags(text)), ...parseTagInput(manualInput)]);
}

// Partial-save rule (quick review panels that don't show a Tags input):
// tags only ever grow — union new text's hashtags with what's already stored,
// so a quick review never wipes tags added elsewhere. Removal happens on the
// full editor, which recomputes from everything.
export function mergeTags(existing: string[] | undefined, incoming: string[]): string[] {
  return dedupe([...(existing ?? []), ...incoming]);
}

export function formatTagsForInput(tags: string[] | undefined): string {
  return (tags ?? []).join(", ");
}

function dedupe(tags: string[]): string[] {
  return [...new Set(tags)].sort();
}
