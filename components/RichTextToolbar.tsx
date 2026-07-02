"use client";

import { useCallback, type ReactNode } from "react";
import { Bold, Italic, Link2, List, ListOrdered, Strikethrough, Underline } from "lucide-react";
import { insertLink, toggleListPrefix, toggleWrap, type WrapResult } from "@/lib/richtext";

type TextareaRef = React.RefObject<HTMLTextAreaElement | null>;

function applyTransform(ref: TextareaRef, transform: (value: string, start: number, end: number) => WrapResult) {
  const el = ref.current;
  if (!el) return;
  const result = transform(el.value, el.selectionStart, el.selectionEnd);
  el.value = result.value;
  el.focus();
  el.setSelectionRange(result.start, result.end);
}

function promptForLink(ref: TextareaRef) {
  const url = window.prompt("Link URL (https://…)");
  if (url) applyTransform(ref, (value, start, end) => insertLink(value, start, end, url));
}

// Ctrl/Cmd+B/I/U, Ctrl/Cmd+Shift+X for strike, Ctrl/Cmd+K for link — the same
// shortcuts traders already know from Slack/Notion/Docs.
export function useRichTextShortcuts(ref: TextareaRef) {
  return useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        applyTransform(ref, (value, start, end) => toggleWrap(value, start, end, "**"));
      } else if (key === "i") {
        event.preventDefault();
        applyTransform(ref, (value, start, end) => toggleWrap(value, start, end, "*"));
      } else if (key === "u") {
        event.preventDefault();
        applyTransform(ref, (value, start, end) => toggleWrap(value, start, end, "__"));
      } else if (event.shiftKey && key === "x") {
        event.preventDefault();
        applyTransform(ref, (value, start, end) => toggleWrap(value, start, end, "~~"));
      } else if (key === "k") {
        event.preventDefault();
        promptForLink(ref);
      }
    },
    [ref],
  );
}

export function RichTextToolbar({ textareaRef }: { textareaRef: TextareaRef }) {
  const buttons: { label: string; title: string; icon: ReactNode; onClick: () => void }[] = [
    { label: "Bold", title: "Bold (Ctrl/Cmd+B)", icon: <Bold className="h-3.5 w-3.5" aria-hidden="true" />, onClick: () => applyTransform(textareaRef, (v, s, e) => toggleWrap(v, s, e, "**")) },
    { label: "Italic", title: "Italic (Ctrl/Cmd+I)", icon: <Italic className="h-3.5 w-3.5" aria-hidden="true" />, onClick: () => applyTransform(textareaRef, (v, s, e) => toggleWrap(v, s, e, "*")) },
    { label: "Underline", title: "Underline (Ctrl/Cmd+U)", icon: <Underline className="h-3.5 w-3.5" aria-hidden="true" />, onClick: () => applyTransform(textareaRef, (v, s, e) => toggleWrap(v, s, e, "__")) },
    { label: "Strikethrough", title: "Strikethrough (Ctrl/Cmd+Shift+X)", icon: <Strikethrough className="h-3.5 w-3.5" aria-hidden="true" />, onClick: () => applyTransform(textareaRef, (v, s, e) => toggleWrap(v, s, e, "~~")) },
    { label: "Bullet list", title: "Bullet list", icon: <List className="h-3.5 w-3.5" aria-hidden="true" />, onClick: () => applyTransform(textareaRef, (v, s, e) => toggleListPrefix(v, s, e, "bullet")) },
    { label: "Numbered list", title: "Numbered list", icon: <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />, onClick: () => applyTransform(textareaRef, (v, s, e) => toggleListPrefix(v, s, e, "numbered")) },
    { label: "Link", title: "Link (Ctrl/Cmd+K)", icon: <Link2 className="h-3.5 w-3.5" aria-hidden="true" />, onClick: () => promptForLink(textareaRef) },
  ];
  return (
    <div className="mb-1 flex flex-wrap items-center gap-0.5">
      {buttons.map((button) => (
        <button
          key={button.label}
          type="button"
          title={button.title}
          aria-label={button.label}
          onClick={button.onClick}
          className="flex h-7 w-7 items-center justify-center rounded text-forge-muted transition hover:bg-forge-panel hover:text-forge-ink"
        >
          {button.icon}
        </button>
      ))}
    </div>
  );
}
