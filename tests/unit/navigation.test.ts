// Why there is no loading.tsx in this app.
//
// A Suspense boundary above a page — which is exactly what `loading.tsx`
// creates — makes every same-route, different-searchParams client navigation
// hang forever in Next 15.5 (reproduced on 15.5.19 and 15.5.24): the router
// fetches the new RSC payload, gets a 200, aborts it and never commits. On
// /trades that killed the view tabs, the pagination, the saved views, the
// "Clear" link, the ?open= row links and the free-text search box; app-wide it
// also stopped ActionFeedback from clearing ?feedback= out of the URL. Removing
// the boundary fixes all of them; a route-level loading.tsx, and a hand-rolled
// <Suspense> around {children} in the layout, both reproduce the bug.
//
// The feedback the skeleton used to give lives in components/LinkPending.tsx
// instead, which needs no boundary. So: adding a loading.tsx back would
// silently re-break every filter in the app, and this test is the tripwire.
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

function loadingFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) loadingFiles(full, found);
    else if (/^loading\.(tsx|ts|jsx|js)$/.test(entry)) found.push(full);
  }
  return found;
}

describe("no loading boundary above a page", () => {
  it("has no loading.tsx anywhere under app/", () => {
    const root = fileURLToPath(new URL("../../app", import.meta.url));
    assert.deepEqual(
      loadingFiles(root).map((file) => path.relative(root, file)),
      [],
      "a loading.tsx re-breaks every same-route filter link — read the header of this file",
    );
  });
});
