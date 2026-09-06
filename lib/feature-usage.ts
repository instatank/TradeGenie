import { getSettings, saveSettingsPatch } from "@/lib/settings-store";
import type { FeatureUsageEntry } from "@/lib/feature-flags";

// Counting what actually gets used, so the monthly census (LIFECYCLE.md Part 3)
// decides what graduates and what gets cut from numbers rather than from recall.
//
// Recall is a biased instrument: it over-weights whatever was used yesterday and
// whatever is annoying, and it has no record at all of the feature you forgot
// exists. This is the cheap fix.
//
// THREE RULES, AND THEY ARE THE WHOLE DESIGN.
//
// 1. COUNT ACTS, NOT RENDERS. A page render is a navigation — a wrong turn, a
//    back button, a prefetch, a link someone tapped to see what was there. A
//    server action is a decision: the trader filled something in and pressed
//    the button. Only the second is evidence. Counting renders would make the
//    census read noise and would flatter exactly the features that sit on a
//    page you pass through on the way to somewhere else.
//
//    This is also why there is nothing here to call from a page: bumping a
//    counter during a render would write from a React render pass, force every
//    instrumented route dynamic, and still miss every cached hit.
//
// 2. NEVER LOAD-BEARING. Every failure is swallowed and the action proceeds. If
//    Firestore is unreachable or the settings document is malformed, the count
//    is lost and the trade still saves. A journal that refuses to record what
//    you did because a counter failed is not a journal.
//
// 3. IT NEVER LEAVES THIS JOURNAL. The counters ride on appSettings/singleton —
//    the document the app already reads on every render — so they need no new
//    collection, no new backup entry, and no sync checklist item. No
//    third-party analytics, ever.
//
// Cost: one extra settings write per instrumented act, patched by path so it
// touches one counter and nothing else. Measured against the friction budgets
// in PROJECT_BRIEF.md that is noise — a quick trade note is budgeted at 30
// seconds and this is a single merge write on a document already in hand.

/**
 * Record one deliberate use of `id`.
 *
 * Call it in the server action, AFTER the write it is counting has succeeded
 * and BEFORE the redirect (a redirect() throws, so anything after it never
 * runs). Awaiting it is fine — it is one small write and it can never throw.
 *
 * The increment is read-then-write rather than an atomic counter, because an
 * atomic one exists on Firestore and not on the local JSON store, and a second
 * code path is a worse price than a count occasionally lost to two writes
 * landing at the same instant. There is one trader and requests are sequential;
 * a dropped count is noise at census resolution.
 */
export async function noteUse(id: string): Promise<void> {
  try {
    const settings = await getSettings();
    const previous: FeatureUsageEntry | undefined = settings.featureUsage?.[id];
    const now = new Date().toISOString();
    const next: FeatureUsageEntry = {
      n: (previous?.n ?? 0) + 1,
      // `first` is what makes a rate readable later: 40 uses means something
      // different over three days than over three months.
      first: previous?.first ?? now,
      last: now,
    };
    // The WHOLE map, composed here. A patch of just this one key would rely on
    // the backend to merge it into the stored map — which Firestore does and
    // the local JSON store does not, so on the local store every other counter
    // would be silently deleted. See saveSettingsPatch's header.
    await saveSettingsPatch({ featureUsage: { ...(settings.featureUsage ?? {}), [id]: next } });
  } catch {
    // Rule 2. A counter must never be the reason an action failed.
  }
}

/**
 * What the Usage list on /settings shows, and in what order.
 *
 * An id that is counted but missing from here is NOT dropped — it lists under
 * "Other", so instrumenting something and forgetting to catalogue it costs a
 * tidy label rather than a silently invisible number.
 *
 * A toggle's id belongs in the group its feature sits in, and must be the same
 * string as its FEATURE_TOGGLES key.
 */
export type UsageGroup = { label: string; note?: string; ids: { id: string; label: string }[] };

export const USAGE_GROUPS: UsageGroup[] = [
  {
    label: "Today",
    note: "The fast paths off the home page — the ones with a friction budget.",
    ids: [
      { id: "note.quick", label: "Quick note written" },
      { id: "trade.quick-log", label: "Trade quick-logged" },
      { id: "setup.run", label: "Setup run from its checklist before a trade" },
    ],
  },
  {
    label: "Capture",
    note: "The voice/paste pipeline, from the paste box through to the journal.",
    ids: [
      { id: "capture.save", label: "Note pasted and saved" },
      { id: "capture.confirm", label: "Draft confirmed into the journal" },
      { id: "capture.restructure", label: "Note re-read by the AI" },
      { id: "capture.drop-entry", label: "Entry removed from a draft" },
      { id: "capture.extract-lessons", label: "Lessons pulled out of a note" },
    ],
  },
  {
    label: "Trades",
    ids: [
      { id: "trade.create", label: "Trade logged on the full form" },
      { id: "trade.save", label: "Trade saved or reviewed" },
      { id: "exchange.sync", label: "Exchange synced" },
      { id: "exchange.accept", label: "Exchange numbers accepted onto a trade" },
      { id: "exchange.archive", label: "Old position logged as an archive trade" },
    ],
  },
  {
    label: "Assets",
    ids: [
      { id: "asset.create", label: "Asset started" },
      { id: "asset.save", label: "Asset view or thread note saved" },
      { id: "asset.structure-note", label: "Thread note tidied by the AI" },
    ],
  },
  {
    label: "Review",
    note: "The two rituals, and the write-ups that come out of them.",
    ids: [
      { id: "review.morning", label: "Morning check-in" },
      { id: "review.evening", label: "Evening review" },
      { id: "review.daily-journal", label: "Day's journal saved in full" },
      { id: "review.weekly", label: "Weekly review generated" },
      { id: "lesson.manual", label: "Lesson written by hand" },
    ],
  },
];

/** Every id this app knows how to label. Used by the Usage screen and by tests. */
export function catalogedUsageIds(): string[] {
  return USAGE_GROUPS.flatMap((group) => group.ids.map((entry) => entry.id));
}
