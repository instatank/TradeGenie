// Shown while any page's server render is in flight.
//
// Without this boundary the App Router keeps the *previous* page fully on
// screen, frozen, until the whole render arrives — and with 13 of our 18
// routes dynamic, each one a Firestore round trip from a container that is
// almost always cold, that was several seconds where a click looked like it
// had done nothing at all.
//
// It also earns its keep on the prefetch side: for a dynamic route Next can
// only prefetch as far as the nearest loading boundary, so before this file
// existed every <Link> prefetch on, say, the trades list did a full server
// render and cached nothing usable. Now the skeleton is what gets prefetched,
// and it paints the instant you tap.
//
// One file at the root covers every route; a page wanting a closer likeness of
// itself can drop its own loading.tsx beside its page.tsx.
export default function Loading() {
  return (
    <main className="page-shell" role="status" aria-label="Loading">
      <span className="sr-only">Loading…</span>
      <div className="animate-pulse space-y-5">
        <div className="space-y-2">
          <div className="h-7 w-56 rounded-md bg-forge-line/70" />
          <div className="h-4 w-80 max-w-full rounded bg-forge-line/50" />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="metric space-y-2">
              <div className="h-3 w-20 rounded bg-forge-line/50" />
              <div className="h-6 w-16 rounded bg-forge-line/70" />
            </div>
          ))}
        </div>

        <div className="panel space-y-3">
          <div className="h-4 w-40 rounded bg-forge-line/70" />
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="flex items-center gap-3">
              <div className="h-4 w-4 shrink-0 rounded bg-forge-line/50" />
              <div className="h-4 flex-1 rounded bg-forge-line/40" />
              <div className="h-4 w-16 shrink-0 rounded bg-forge-line/50" />
            </div>
          ))}
        </div>

        <div className="panel space-y-3">
          <div className="h-4 w-32 rounded bg-forge-line/70" />
          <div className="h-4 w-full rounded bg-forge-line/40" />
          <div className="h-4 w-5/6 rounded bg-forge-line/40" />
          <div className="h-4 w-2/3 rounded bg-forge-line/40" />
        </div>
      </div>
    </main>
  );
}
