import { revalidatePath } from "next/cache";

// One revalidation, not forty. Lives here rather than in app/actions.ts because
// that file is "use server" and may only export async functions — and route
// handlers (the scheduled exchange sync) need to call this too. A second copy
// for the route would be exactly the drift this function was created to end.
//
// ONE revalidation, covering every route.
//
// Next gives every page an implicit "/layout" tag (see getDerivedTags in
// next/dist/server/lib/implicit-tags: the derived list always starts with
// `/layout`), so expiring the root layout expires the whole app's route cache.
//
// This replaces ~40 hand-written revalidatePath() calls that had already
// drifted into real bugs: /analytics is a statically-prerendered route that
// reads every trade, yet no trade action revalidated it — its numbers went
// stale until an unrelated setup edit happened to clear it — and deleting a
// trade never revalidated Today either. Every page here reads overlapping
// slices of one small store, so a per-action list of paths was always going to
// rot. Same reasoning as one tag tokenizer and one search index: the moment
// there are two places that have to agree, they stop agreeing.
//
// The cost is that any save expires all cached routes rather than some. At this
// size that is close to free — a page render is single-digit milliseconds once
// the data is in hand — and it buys correctness that the old lists never had.
export function revalidateEverything() {
  revalidatePath("/", "layout");
}
