// The feature lifecycle gate. One definition, server-side, read from the
// settings document the app already loads on every render.
//
// This is the TradeGenie half of playbook/LIFECYCLE.md (in instatank/time-tracker).
// DayOS keeps its flags in localStorage because its whole app is one client-side
// page; this app renders on the server, so there is no client state a render
// could read a flag from, and one trader on one journal has no "per device"
// concept worth having. The flags therefore live on appSettings/singleton and
// are read through getSettings(), which is already request-cached — so gating a
// feature costs a property lookup, not a round trip.
//
// WHAT A TOGGLE IS FOR, AND WHAT IT IS NOT (LIFECYCLE.md Part 4).
// This app already has two ways to make a screen smaller, and a third that
// overlaps them would be pure cost:
//   - a collapsed "advanced/optional" fold hides complexity WITHIN a feature
//     that is staying. Presentation. Cheap. Nothing to reason about later.
//   - the "More" nav hides a DESTINATION that is staying. Presentation. Cheap.
//   - a toggle governs whether a feature EXISTS AT ALL. Lifecycle. It costs a
//     permanent second code path, forever, paid by whoever next touches that
//     screen.
// Never reach for a toggle where a fold would do. The "exhaustive but lean"
// pattern in CLAUDE.md is unchanged; toggles sit above it, not instead of it.

/** Where a feature is in its life (LIFECYCLE.md §1.1). */
export type FeatureStage =
  | "S0" // sketched: written down with a kill criterion, not built
  | "S1" // trial: built, behind this toggle, OFF by default, instrumented
  | "S2" // default: toggle exists but defaults on; still one commit to delete
  | "S3"; // core: toggle deleted, one code path. Cutting it is a project.

/**
 * What it would cost to take this feature back out again (LIFECYCLE.md §R2).
 * Ranked before the thing is built, because that is the only moment the answer
 * is cheap and honest.
 */
export type ExitCost =
  /** Render-only, reads existing state, one injection site, no new field,
   *  no new collection, no enum value written onto records. Deleting is a diff. */
  | "REVERSIBLE"
  /** Adds a field to a record, or a value to an enum records now carry. The UI
   *  goes; the field stays on real data forever. Needs a migration story. */
  | "STICKY"
  /** New collection, new sync path, new backup entry, new external contract,
   *  new cron. This is never an experiment — it is an architecture change. */
  | "STRUCTURAL";

/**
 * One entry in the catalog. `key`, `label` and `desc` are what DayOS's
 * FEATURE_TOGGLES carries; `stage` and `exitCost` are the two things
 * LIFECYCLE.md §R1/§R2 add, and they are here rather than only in the ledger
 * because they are the fields a session needs in front of it at the moment it
 * is deciding whether to touch a toggled feature.
 *
 * The falsifiable kill criterion (§R1's `earns-its-place-if`) and the review
 * date deliberately stay in docs/lifecycle.md and not here: they are read once
 * a month by a census, they are prose, and duplicating them in two places is
 * how they would come to disagree.
 */
export type FeatureToggle = {
  /** Stable id. The SAME string keys the flag, the usage counter and the
   *  ledger row — that is what lets a census join the three without a mapping
   *  table. Never rename one; retire it and add a new one. */
  key: string;
  /** What it is called on the Optional features screen, in plain language. */
  label: string;
  /** One sentence: what turning it on actually does. */
  desc: string;
  stage: FeatureStage;
  exitCost: ExitCost;
};

/**
 * THE catalog. Empty on purpose — the mechanism ships before anything is put
 * behind it, so that the first thing gated is a deliberate decision with a
 * written kill criterion rather than whatever happened to be convenient while
 * the plumbing was being built.
 *
 * Cap: 4 (§R5). Every entry is a permanent second code path — two render
 * branches, two states to reason about, two things to test — and the rent is
 * paid by whoever next touches that screen. A fifth means retiring one in the
 * same commit or writing down why not.
 *
 * Adding one: write its ledger row in docs/lifecycle.md FIRST (§R1 — no birth
 * certificate, no build), then add it here at stage S1 with the flag defaulting
 * off, then instrument its point of deliberate use (§R3).
 */
export const FEATURE_TOGGLES: FeatureToggle[] = [];

/** A flag's stored value is a plain boolean, keyed by the toggle's stable id. */
export type FeatureFlags = Record<string, boolean>;

/**
 * One feature's counter. `first`/`last` are ISO strings rather than Dates: this
 * rides inside the settings document, which is written to Firestore raw (it does
 * not pass through lib/store.ts's dehydrate/hydrate pair), so a Date here would
 * come back a Firestore Timestamp on one backend and a string on the other.
 */
export type FeatureUsageEntry = { n: number; first: string; last: string };
export type FeatureUsage = Record<string, FeatureUsageEntry>;

/**
 * THE gate. Every flag check in the app goes through this and there is no
 * second definition — same reasoning as one tag tokenizer (lib/tags.ts) and one
 * search index (lib/search.ts): the moment two places decide whether a feature
 * is on, they stop agreeing.
 *
 * `settings` is passed in rather than fetched here so the gate stays sync and
 * pure, and so a server component that already awaited getSettings() does not
 * pay for it twice.
 *
 * DEFAULT OFF, and off is what an unknown key gets too. A flag that has never
 * been written, a key removed from the catalog, a settings document from before
 * this existed: all the same answer. A gate that defaulted on would mean a typo
 * in a key silently shipped a trial feature to the one person using the app.
 */
export function featureEnabled(key: string, settings: { featureFlags?: FeatureFlags | null }): boolean {
  return settings.featureFlags?.[key] === true;
}
