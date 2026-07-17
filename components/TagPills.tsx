import Link from "next/link";

// Tappable #tag pills. Every pill routes through global search as an exact-tag
// query, so tapping a pill and typing `#tag` in the search box always agree.
export function TagPills({ tags, className = "" }: { tags?: string[]; className?: string }) {
  if (!tags?.length) return null;
  return (
    <span className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {tags.map((tag) => (
        <Link
          key={tag}
          href={`/search?q=${encodeURIComponent(`#${tag}`)}`}
          className="rounded-full border border-forge-blue/30 bg-sky-50 px-2 py-0.5 text-xs font-medium text-forge-blue transition hover:border-forge-blue hover:bg-sky-100"
        >
          #{tag}
        </Link>
      ))}
    </span>
  );
}

// The optional "Tags" input for forms. Inline #hashtags in the note text work
// without this — it exists for tags you don't want cluttering the prose.
export function TagsField({ defaultValue, label = "Tags" }: { defaultValue?: string; label?: string }) {
  return (
    <label className="field">
      <span className="label">{label}</span>
      <input
        name="tags"
        defaultValue={defaultValue ?? ""}
        placeholder="e.g. breakout, funding — or just type #hashtags in the note itself"
        className="input"
      />
      <span className="text-xs text-forge-muted">Optional. Comma or space separated; #hashtags typed in the text are picked up automatically.</span>
    </label>
  );
}
