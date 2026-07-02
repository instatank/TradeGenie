import { Fragment, type ReactNode } from "react";

const INLINE_PATTERN =
  /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|~~([^~\n]+)~~|\*([^*\n]+)\*/g;

function parseInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text))) {
    if (match.index > lastIndex) nodes.push(<Fragment key={key++}>{text.slice(lastIndex, match.index)}</Fragment>);
    const [, linkText, linkUrl, bold, underline, strike, italic] = match;
    if (linkText != null) {
      nodes.push(
        <a key={key++} href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-forge-blue hover:underline">
          {linkText}
        </a>,
      );
    } else if (bold != null) {
      nodes.push(<strong key={key++}>{bold}</strong>);
    } else if (underline != null) {
      nodes.push(<u key={key++}>{underline}</u>);
    } else if (strike != null) {
      nodes.push(<s key={key++}>{strike}</s>);
    } else if (italic != null) {
      nodes.push(<em key={key++}>{italic}</em>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(<Fragment key={key++}>{text.slice(lastIndex)}</Fragment>);
  return nodes;
}

// Renders the shared lightweight formatting syntax (see lib/richtext.ts) as
// real elements — bold/italic/underline/strike/links inline, "- "/"1. " lines
// as actual lists — while preserving one visual line per source line, same as
// the plain whitespace-pre-wrap rendering this replaces.
export function FormattedText({ text, className }: { text?: string | null; className?: string }) {
  if (!text) return null;
  const lines = text.split("\n");
  const nodes: ReactNode[] = [];
  let listBuffer: { type: "ul" | "ol"; items: string[] } | null = null;

  const flushList = () => {
    if (!listBuffer) return;
    const items = listBuffer.items;
    if (listBuffer.type === "ul") {
      nodes.push(
        <ul key={`list-${nodes.length}`} className="ml-5 list-disc space-y-0.5">
          {items.map((item, idx) => (
            <li key={idx}>{parseInline(item)}</li>
          ))}
        </ul>,
      );
    } else {
      nodes.push(
        <ol key={`list-${nodes.length}`} className="ml-5 list-decimal space-y-0.5">
          {items.map((item, idx) => (
            <li key={idx}>{parseInline(item)}</li>
          ))}
        </ol>,
      );
    }
    listBuffer = null;
  };

  for (const line of lines) {
    const bulletMatch = line.match(/^[-*]\s+(.*)$/);
    const numberedMatch = line.match(/^\d+\.\s+(.*)$/);
    if (bulletMatch) {
      if (!listBuffer || listBuffer.type !== "ul") {
        flushList();
        listBuffer = { type: "ul", items: [] };
      }
      listBuffer.items.push(bulletMatch[1]);
      continue;
    }
    if (numberedMatch) {
      if (!listBuffer || listBuffer.type !== "ol") {
        flushList();
        listBuffer = { type: "ol", items: [] };
      }
      listBuffer.items.push(numberedMatch[1]);
      continue;
    }
    flushList();
    nodes.push(<div key={`line-${nodes.length}`}>{line ? parseInline(line) : <>&nbsp;</>}</div>);
  }
  flushList();

  return <div className={className}>{nodes}</div>;
}
