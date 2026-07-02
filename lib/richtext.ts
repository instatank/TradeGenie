// Lightweight formatting syntax shared by every free-text field in the app:
// **bold**, *italic*, __underline__, ~~strike~~, [link](url), "- " bullets,
// "1. " numbered lists. Stored as plain text (no HTML), rendered by
// components/FormattedText.tsx. Kept intentionally small — this is a trade
// journal, not a document editor.

export type WrapResult = { value: string; start: number; end: number };

// Toggle a symmetric marker (e.g. "**") around the current selection. If the
// selection is already wrapped (or the marker sits just outside it), unwrap
// instead. With no selection, inserts a placeholder so the trader can just
// start typing between the markers.
export function toggleWrap(value: string, start: number, end: number, before: string, after: string = before): WrapResult {
  const selected = value.slice(start, end);
  const outerBefore = value.slice(Math.max(0, start - before.length), start);
  const outerAfter = value.slice(end, end + after.length);
  if (outerBefore === before && outerAfter === after) {
    const newValue = value.slice(0, start - before.length) + selected + value.slice(end + after.length);
    return { value: newValue, start: start - before.length, end: end - before.length };
  }
  if (selected.length >= before.length + after.length && selected.startsWith(before) && selected.endsWith(after)) {
    const inner = selected.slice(before.length, selected.length - after.length);
    const newValue = value.slice(0, start) + inner + value.slice(end);
    return { value: newValue, start, end: start + inner.length };
  }
  const placeholder = selected || "text";
  const newValue = value.slice(0, start) + before + placeholder + after + value.slice(end);
  return { value: newValue, start: start + before.length, end: start + before.length + placeholder.length };
}

// Add/remove a bullet or numbered-list prefix on every non-blank line the
// selection touches. Toggles off if every touched line already has it.
export function toggleListPrefix(value: string, start: number, end: number, kind: "bullet" | "numbered"): WrapResult {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;
  const block = value.slice(lineStart, lineEnd);
  const lines = block.split("\n");
  const bulletRe = /^(\s*)[-*]\s+/;
  const numberedRe = /^(\s*)\d+\.\s+/;
  const matchRe = kind === "bullet" ? bulletRe : numberedRe;
  const contentLines = lines.filter((line) => line.trim() !== "");
  const allMatch = contentLines.length > 0 && contentLines.every((line) => matchRe.test(line));
  let counter = 1;
  const newLines = lines.map((line) => {
    if (line.trim() === "") return line;
    const stripped = line.replace(bulletRe, "").replace(numberedRe, "");
    if (allMatch) return stripped;
    return kind === "bullet" ? `- ${stripped}` : `${counter++}. ${stripped}`;
  });
  const newBlock = newLines.join("\n");
  const newValue = value.slice(0, lineStart) + newBlock + value.slice(lineEnd);
  return { value: newValue, start: lineStart, end: lineStart + newBlock.length };
}

export function insertLink(value: string, start: number, end: number, url: string): WrapResult {
  const selected = value.slice(start, end) || "link";
  const insertText = `[${selected}](${url})`;
  const newValue = value.slice(0, start) + insertText + value.slice(end);
  return { value: newValue, start: start + 1, end: start + 1 + selected.length };
}

// For single-line/truncated previews (search results, calendar strips, list
// summaries) where rendering real markup would look broken — strips the
// syntax back down to plain, readable text.
export function stripFormatting(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/^[-*]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\s*\n\s*/g, " ")
    .trim();
}
