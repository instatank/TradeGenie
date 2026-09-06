# Feature lifecycle — TradeGenie's ledger

The register of what is on trial, what it would take to cut it, and what has already been
cut. The rules it implements live in **`playbook/LIFECYCLE.md`** (in `instatank/time-tracker`);
this file is this repo's instance of them, and is the counterpart to DayOS's
`docs/experiments.md`.

It exists so that switching a feature to always-on, or removing it, is **mechanical**: each
row names the exact symbols, files, actions, fields and collections to touch, so a future
session can grep and go instead of rediscovering the wiring.

**Read this before adding or removing any feature in this repo.**

> First file under `docs/` — every other doc in this repo sits at the root. It is here
> because `playbook/LIFECYCLE.md` names this exact path as TradeGenie's ledger, and a path
> two repos already agree on is worth more than tidiness.

---

## The mechanism, in one screen

| Thing | Where |
|---|---|
| The gate | `featureEnabled(key, settings)` in `lib/feature-flags.ts`. One definition. |
| The catalog | `FEATURE_TOGGLES` in `lib/feature-flags.ts` (`key`, `label`, `desc`, `stage`, `exitCost`) |
| Where a flag is stored | `featureFlags` on `appSettings/singleton`, read through the request-cached `getSettings()` |
| The switch | `toggleFeatureAction` in `app/actions.ts` — a POST, so `middleware.ts` already refuses it for a viewer |
| The counters | `noteUse(id)` in `lib/feature-usage.ts` → `featureUsage` on the same document |
| The screen | `/settings` → **Optional features** (`OptionalFeaturesPanel`), owner-only |
| The tests | `tests/unit/feature-lifecycle.test.mts` |

**Default off.** An unknown key, a key removed from the catalog, and a settings document
written before flags existed all read as off.

**Cap: 4 toggles** (`LIFECYCLE.md` §R5). Every entry is a permanent second code path. A fifth
means retiring one in the same commit, or writing down in that month's census why not. A test
fails the build at five.

### A toggle is not a fold, and not the "More" nav

This app already has two ways to make a screen smaller. Reaching for a third where one of
those would do is pure cost:

| | Hides | Costs | Use it when |
|---|---|---|---|
| A collapsed **advanced/optional fold** | complexity *within* a feature that is staying | nothing — presentation | the feature stays, the screen is busy |
| The **"More" nav** | a *destination* that is staying | nothing — presentation | the page stays, the header is busy |
| A **toggle** | whether a feature **exists at all** | a permanent second code path | you genuinely do not know if it should exist |

**Never use a toggle for something a fold would do.** The "exhaustive but lean" pattern in
`CLAUDE.md` is unchanged; toggles sit above it, not instead of it.

---

## Active toggles

**None.** The mechanism shipped empty on 2026-09-06, on purpose: shipping it before anything
is behind it makes the first gated feature a deliberate decision with a written criterion,
rather than whatever was convenient while the plumbing was being built.

<!-- Table kept so the first entry has a shape to fill in. -->

| Key | Stage | Label | Exit cost | Touches data? | Gate site(s) | Delete list |
|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — |

---

## Adding a toggle (the order matters)

1. **Write the birth certificate below FIRST** (§R1 — no birth certificate, no build). A
   criterion written after you have the feature is one you will bend, because by then you own
   it. `earns-its-place-if` must be falsifiable: a number and a window, not "if it's useful".
2. **Rank the exit cost** (§R2) and let it veto the build:
   - **REVERSIBLE** — render-only, reads existing state, one gate site, no new field, no new
     collection, no enum value written onto records. Deleting it is a diff.
   - **STICKY** — adds a field to a record, or a value to an enum records now carry. The UI
     goes; the field stays on real data forever. Needs a migration story written at S0.
   - **STRUCTURAL** — new collection, new backup entry, new cron, new external contract. This
     is never an experiment. If it can be built REVERSIBLE by narrowing it, build the narrow
     version first — that is the trial, and the full one is what graduation buys.
3. Add the row to `FEATURE_TOGGLES` at `stage: "S1"`. The flag defaults off by omission —
   never write `true` into `featureFlags` as a default.
4. **Instrument the act** (§R3): `await noteUse("<same key>")` inside the server action that
   represents deliberate use. Not in a render. Add the id to `USAGE_GROUPS` so it has a label.
5. Add the row to **Active toggles** above with its exact delete list.

## Making a toggle always-on (keep the feature, drop the switch)

1. Remove the row from `FEATURE_TOGGLES`.
2. Replace every `featureEnabled("<key>", settings)` site with the unconditional render.
3. Keep the counter — a feature that is now part of the app is still worth counting, and
   deleting the id would throw away the history the decision was made on.
4. Move the row to **Removed** below, saying **which argument** it graduated on.

## Deleting a feature outright — check three places (§R6)

1. **Code** — the gate sites, the components, the server actions, the helpers. **Grep every
   symbol before deleting it.** A delete list in this file is a starting point, not an
   authority: DayOS deleted a feature whose helper another feature was quietly using.
   §R9: a toggled feature must own no helper another feature uses — check at build time, not
   at delete time.
2. **Data** — the field on the record, the collection, the option-group value already stored
   on real records, `lib/backup.ts`'s snapshot, `restoreSnapshot`'s half, `/api/export`.
   State explicitly whether orphaned data is being **kept** (fine — say so) or **removed**
   (needs a migration). Cutting the screen and leaving the data orphaned is the
   characteristic failure of a contraction phase.
3. **Docs** — the Removed section below, `CLAUDE.md`'s decisions log, and `AGENTS.md` if a
   route or file went.

Then: **prove reachability before removing any entry point** (§R7). If the destination is
still reachable another way, write *where it went* in a comment at the deletion site. Merging
and orphaning look identical in a diff; the comment is what tells the next session which one
happened.

## The two arguments for cutting, and they are not interchangeable

Every removal records **which one it used**, in the Removed row, on the same line that says
where the feature went.

- **Cost** — it is in the way, it duplicates a choice its destination already presents, it
  costs a tap that buys nothing. Needs no usage data and never has. **Available today.**
- **Non-use** — you don't use it. Needs a counter **and** a fair trial (§R4): the feature was
  on by default or plainly visible for the whole window, the window was ≥30 days and ≥1
  census, and you were reminded it exists at least once (the census report counts). If any of
  those fail the verdict is *"no fair trial — promote to S2 and re-review"*, not "cut".

**Nothing in this repo can be cut for non-use before roughly 2026-10-06**, because the
counters started on 2026-09-06 and there is no 30-day window behind them yet.

---

## Birth certificates

None yet. Template — copy this block, fill it in, and write it **before** the code:

```
id:            <same string as the toggle key, the counter id and this row>
stage:         S0
built:         YYYY-MM-DD
instrumented:  YYYY-MM-DD
one-liner:     what it does, in the owner's language
earns-its-place-if:  <falsifiable — a number and a window>
exit-cost:     REVERSIBLE | STICKY | STRUCTURAL
touches-data:  no | <field / collection / option-group value it adds>
review-on:     YYYY-MM-DD  (built + 6 weeks, or built + 2 censuses)
counter:       <where noteUse is called, and why that call site is an act and not a render>
```

---

## Usage counters (shipped 2026-09-06)

`noteUse(id)` → `featureUsage` on `appSettings/singleton`. Read it on
`/settings` → Optional features → **Usage**.

**Instrumented in the first pass** — the real work done at each of the five primary nav
destinations, plus every path a thought or a trade gets into the journal, so the first census
has a baseline to compare a trial feature against rather than judging it in a vacuum:

| Group | id | Bumped in |
|---|---|---|
| Today | `note.quick` | `saveQuickNoteAction` |
| Today | `trade.quick-log` | `quickLogTradeAction` |
| Today | `setup.run` | `startTradeFromSetupAction` |
| Capture | `capture.save` | `saveTranscriptAction` |
| Capture | `capture.confirm` | `confirmTranscriptAction` |
| Capture | `capture.restructure` | `structureTranscriptAction` |
| Capture | `capture.drop-entry` | `dropTranscriptEntryAction` |
| Capture | `capture.extract-lessons` | `extractLessonsAction` |
| Trades | `trade.create` | `createTradeAction` |
| Trades | `trade.save` | `saveTradeAction` |
| Trades | `exchange.sync` | `syncExchangeAction` |
| Trades | `exchange.accept` | `acceptExchangeMatchAction` |
| Trades | `exchange.archive` | `archiveExchangePositions` — the shared helper, so one act is one count whether it archived 1 position or 80 |
| Assets | `asset.create` | `createAssetAction` |
| Assets | `asset.save` | `saveAssetWorkspaceAction`, only when something actually changed |
| Assets | `asset.structure-note` | `structureAssetNoteDraftAction` |
| Review | `review.morning` | `saveMorningCheckinAction` |
| Review | `review.evening` | `saveEveningReviewAction` |
| Review | `review.daily-journal` | `saveDailyJournalAction` |
| Review | `review.weekly` | `generateWeeklyReviewAction` |
| Review | `lesson.manual` | `addManualLessonAction` |

An id that is counted but missing from `USAGE_GROUPS` lists under **Other** on the screen
rather than disappearing — forgetting to catalogue one costs a tidy label, not a number.

**Deliberately NOT instrumented, and why:**

- **Page visits.** Counting a render would count a back button, a prefetch and a wrong turn
  as use. It would also mean writing during a React render and forcing every instrumented
  route dynamic. A navigation is not a decision.
- **Reading surfaces** — `/analytics`, `/mechanisms`, `/calendar`, `/search`, the Today
  snapshot and coach's corner. **This is the mechanism's real blind spot and the census must
  know it**: these features' entire value is being *looked at*, and looking leaves no act
  behind. A zero here means "nothing was clicked", never "nothing was read", and is **not**
  grounds for a non-use cut under §R4. The honest test for a read-only feature is switching
  it off for a week and noticing whether you miss it.
- **The calculator** (`/calculator`). Client-side, saves nothing, has no server action at all.
  Same blind spot, same rule.
- **Deletes and edits.** They are corrections, not uses of a feature.
- **`/settings` itself.** Configuring the app is not using the journal.

**Rules a counter must not break:**

1. **Acts, not renders.** Bump inside the server action, after the write and before the
   redirect (a `redirect()` throws).
2. **Never load-bearing.** Every failure is swallowed; the action proceeds. A journal that
   refuses to save a trade because a counter failed is not a journal.
3. **It never leaves this journal.** No new collection, no backup entry, no third-party
   analytics, ever.
4. **Compose the whole field.** `saveSettingsPatch({ featureUsage: { …all, [id]: next } })` —
   passing only the changed key relies on backend merge semantics that differ between
   Firestore and the local JSON store. See the bug note at the bottom of this file.

---

## Removed

Kept for traceability, so a future session does not rebuild something that was tried and
rejected, or hunt for a symbol that moved. Every row says **where it went** and **which
argument** cut it (cost / non-use).

*Nothing yet — this ledger starts empty.*

Cuts that predate this file live in `CLAUDE.md`'s decisions log rather than here. The three
largest are noted so a session searching for them lands somewhere: the **"Note type" dropdown**
on the capture form (cut on **cost** — it routed the old per-type prompts and decided nothing
afterwards; `Transcript.transcriptType` is still stored, but derived from the entries a note
produced), the **recharts `DashboardCharts` component** and its dependency (cut on **cost** —
nothing imported it after the Today rewrite), and **`TagsField`**, the old free-text tags
input (cut on **cost** — replaced by `TagPicker`; one tag control, not two).

---

## The bug this mechanism has already caused

One, and it is worth reading before touching `saveSettingsPatch`.

**A nested patch behaves differently on the two backends.** The first cut of `noteUse` wrote
`{ featureUsage: { [id]: entry } }` and relied on the store to merge it. Firestore's
`set(…, { merge: true })` deep-merges a map, so in production it would have worked. The local
JSON store shallow-spreads, so **every other counter was deleted on each bump**. Found by
counting two different things in a scratch script and reading back only the second — not by
review, and not by any test that existed at the time. Same shape as `undefined` being rejected
by Firestore and silently dropped by `JSON.stringify` (see `dehydrate()` in `lib/store.ts`).
Fixed by composing the whole field in memory, which behaves identically on both, and pinned by
*"counters must not delete each other"* in `tests/unit/feature-lifecycle.test.mts`.
