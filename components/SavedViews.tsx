import Link from "next/link";
import { Bookmark, X } from "lucide-react";
import { deleteSavedViewAction, saveViewAction } from "@/app/actions";
import type { SavedView } from "@/lib/types";

// A filter you built once, one tap away from then on.
//
// Views are stored as the page's own URL, so this component is the whole
// feature: chips that link to a saved query, and a box to name the one you're
// looking at. Nothing here knows what a filter is — which is exactly why a
// saved view survives a page growing new filters.
export function SavedViews({
  views,
  currentPath,
  hasFilters,
  emptyHint,
}: {
  /** Already scoped to this page by the caller. */
  views: SavedView[];
  /** The path + query being viewed right now, i.e. what "save" would store. */
  currentPath: string;
  /** Saving an unfiltered page would just bookmark the page itself. */
  hasFilters: boolean;
  emptyHint: string;
}) {
  if (!views.length && !hasFilters) return null;
  const active = views.find((view) => view.path === currentPath) ?? null;

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs text-forge-muted">
        <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
        Saved views
      </span>

      {views.map((view) => (
        <span
          key={view.id}
          className={`inline-flex items-center rounded-full border transition ${
            view.path === currentPath
              ? "border-forge-blue bg-forge-blue text-white"
              : "border-forge-line bg-white text-forge-ink hover:border-forge-muted"
          }`}
        >
          <Link href={view.path} className="py-1 pl-3 pr-1.5 text-sm">
            {view.name}
          </Link>
          {/* Its own tiny form — nothing else on the row can be lost to it. */}
          <form action={deleteSavedViewAction} className="flex">
            <input type="hidden" name="id" value={view.id} />
            <input type="hidden" name="redirectTo" value={currentPath} />
            <button
              type="submit"
              className={`rounded-full p-1 pr-2 transition ${view.path === currentPath ? "text-white/70 hover:text-white" : "text-forge-muted hover:text-forge-red"}`}
              title={`Remove the "${view.name}" view`}
              aria-label={`Remove the ${view.name} view`}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </form>
        </span>
      ))}

      {!views.length ? <span className="text-xs text-forge-muted">{emptyHint}</span> : null}

      {hasFilters && !active ? (
        <form action={saveViewAction} className="inline-flex items-center gap-1.5">
          <input type="hidden" name="path" value={currentPath} />
          <input type="hidden" name="redirectTo" value={currentPath} />
          <input
            name="name"
            placeholder="name this view…"
            aria-label="Name this view"
            className="input h-8 min-h-8 w-40 py-1 text-sm"
          />
          <button type="submit" className="button-secondary min-h-8 px-2.5 py-1 text-sm">Save view</button>
        </form>
      ) : null}
    </div>
  );
}
