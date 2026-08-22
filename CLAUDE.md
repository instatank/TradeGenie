# CLAUDE.md

Working guide for Claude Code on **TradeGenie** (tagline: "magic journal"). Keep it short and current.
Update it when architecture, lean defaults, the working contract, or open items change.

## Source of truth (read in this order)
1. **`PROJECT_BRIEF.md`** — the owner's vision, friction budgets, lean defaults, non-goals.
   **This wins all conflicts.** When unsure, optimize for its goals, not feature completeness.
2. **`DayOS_cheatsheet.md`** — taste, UX patterns, trimming/minimalism principles, AI patterns
   carried over from the owner's previous journaling app (DayOS). The **founder** and
   **working principles** sections are hard rules for collaboration; the UX/trimming sections
   are strong defaults; the AI section is directional, not prescriptive. Don't port DayOS code
   or architecture — this is about taste and scar tissue, not implementation.
3. **`AGENTS.md`** — stack, file map, product areas, commands, deployment workflow.
4. **`PENDING_TASKS.md`** — backlog.
5. This file — the working contract + a log of decisions made during active development.

Don't duplicate the stack/file/route lists here; they live in `AGENTS.md`.

## Who this is for (one line)
One non-technical discretionary crypto-perp trader. A personal daily-habit journal — not a
product. No multi-user, auth, payments, broker sync, signals, or financial advice, ever.

## Working contract (non-negotiable)
- **`main` is the single working branch _and_ the Vercel production branch.** Commit work
  directly to `main`; there is no separate `claude/*` feature branch anymore. (Old policy:
  develop on a feature branch and leave `main` untouched — that has been retired by the owner.)
- **A push to `main` auto-deploys to production.** The owner has standing authorization to
  push/deploy by default — push when the work is ready *without* asking first. The only hard
  gate is build health: always run `typecheck` + `lint` + `build` (build/route smoke-check for
  UI) and **never push a red build**; report failures honestly instead. The owner will say so
  explicitly when they want to hold off on a push/deploy. If a deploy misbehaves, `git revert`
  + push to roll back fast — Vercel keeps the last good build if a new one fails to build.
- **Don't revert the owner's changes or unrelated dirty work.**
- Small, scoped changes, one concern at a time. No broad rewrites unless asked.
- When something is a real tradeoff or changes the daily workflow, **stop and ask in plain
  English** — don't quietly decide. Default bias: if a thing doesn't earn its place for a
  solo beginner, leave it out and flag it.

## Friction budgets (hard requirements)
Daily check-in < 60s · quick trade note < 30s · transcript paste/save < 20s · EOD review 2–4 min.
Anything that doesn't fit gets cut, deferred, or hidden behind an advanced/optional toggle.

## "Exhaustive but lean" pattern
Keep the full feature set built, but lean by default. Real panels/fields that get "removed"
should move behind a collapsed **advanced/optional** section, not be deleted — one click away.
Exception: single dropdowns. Trimming a `<select>`'s option vocabulary is a deliberate
simplification (you can't nest an "advanced" toggle in a select without a confusing duplicate
field). Old stored values still render via `humanize()`; we just stop offering redundant ones.

## Current lean defaults (the values we actually chose)
- **Mind state** (one field, replaces the old 11-value EmotionalState + 9-value CurrentState):
  `CALM · TIRED · ANXIOUS · TILTED · FOMO · OVERCONFIDENT` (+ UNKNOWN). See `mindStateOptions`.
- **Mistake tags**: 9 shown by default, other 9 under a "More tags" toggle — nothing deleted.
  Primary set in `primaryMistakeTagNames` (`lib/constants.ts`).
- **Lesson categories**: 5 for new entries — `ENTRY_DISCIPLINE · RISK_MANAGEMENT · PSYCHOLOGY
  · PROCESS · OTHER` (`coreLessonCategories`). Old categories still display on existing lessons.
- Quick-trade form: only instrument/direction/status/thesis are surfaced; everything else
  (context, market conditions, prices) is in collapsed sections.
- **Trade execution vocabulary**: `tradeTimeframe` (1m · 5m · 15m · 1H · 4H · 1D) and
  `mechanism` (12 ICT/SMC concepts, hints on the chips). Both multi-select and extendable;
  the model checklist comes from the playbook setup, not from a fixed list.

## Data durability (top priority, resolved)
- Storage adapter: `lib/store.ts`. `storageStatus()` is the single source of truth:
  `firestore` (durable) | `local` (dev only, ephemeral on Vercel) | `invalid` (partial config).
- `usesFirebase()` **throws** on a partial Firebase config rather than silently falling back.
- Settings persist to Firestore (`appSettings/singleton`) when Firebase is on — not local disk.
- `/settings` shows a colored storage banner; `/api/export` dumps everything as one JSON backup —
  it iterates `collectionNames` (derived from `StoreShape`), so a new collection can never be
  left out of a backup again. The old hardcoded list had already dropped assets + asset notes.
- Required env: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
  (+ `FIREBASE_STORAGE_BUCKET`). Production is confirmed durable (Firestore service account).

## Capture flow (one screen — one note, many entries)
- `/inbox` is **paste → review → confirm**, all on one screen. Saving a note
  (`saveTranscriptAction`) **auto-structures it immediately** (no separate "Structure" click).
- **One note becomes MANY entries.** Real dictation contains several things at once — a trade,
  a thought about an asset, a mood note, a lesson. Extraction returns an **array of typed
  entries** and the review draft is a **list of per-entry cards** (`EntryCard` in
  `app/inbox/page.tsx`): kind chip, where confirming sends it, its own editable fields, and a
  **Remove** button for when the model over-splits. (The remove buttons submit sibling forms
  via the HTML `form=` attribute — forms can't nest.)
- `confirmTranscriptAction` writes **every remaining entry in one action**. On-screen edits
  override the AI draft **per entry** (`applyEntryOverrides`, field names prefixed `e{i}_`),
  and every edit is re-run through `normalizeEntry` so a hand-typed value can't smuggle a bad
  enum into a record. Confirm **stays on `/inbox`** so you keep working the queue.
- **Entry kinds** (`lib/extraction.ts`) and where each one lands:
  `TRADE_ENTRY` → a trade · `TRADE_EXIT` → **updates an existing trade, never creates one** ·
  `ASSET_NOTE` → that asset's thread (creating the asset if new) · `JOURNAL` → the day's
  journal · `LESSON` → the lesson bank · `WEEKLY_REFLECTION` → a weekly review ·
  `FREE_NOTE` → a plain searchable thought.
- **`FREE_NOTE` is first class.** A thought that fits nothing else is kept as-is rather than
  forced into another kind or dropped. Stored in the `freeNotes` collection — the same one the
  hand-typed quick notes use — and indexed by `lib/search.ts` (results link back to the note
  they came from). Written with `category: null`: the note category is the trader's tap, not
  the model's guess.
- **Exits can never duplicate a trade.** A `TRADE_EXIT` must carry a `linkTradeId`; if the
  model can't resolve one confidently it returns null and the card shows an **open-trade
  picker**. Confirm refuses to write *anything* until it's picked — validation runs before the
  first write so a note never lands half-saved. (The old code fell through to the create
  branch and wrote a second, closed trade while the real position stayed open forever.)
- **OPEN vs IDEA**: an entry note where the trader says they entered creates the trade as
  `OPEN`; `IDEA` is for "I'm watching this".
- Spoken **numbers are captured**: entry/stop/target price, quantity, leverage, exit price and
  realized P&L flow through extraction → editable card → trade. Strict "only if actually
  stated, never invent" rule, in the code-built system prompt.
- **Fields vs notes — a note is half data, half thinking out loud.** Fields take only the hard
  data (symbol, direction, prices, size, setup). Everything else said *about that same trade* —
  the chart timeframe, how long they expect it to run, their market read, pattern names, their
  own shorthand — goes to `notes` on the `TRADE_ENTRY`/`TRADE_EXIT` entry, in their words, and
  lands in the trade's existing "Free-form notes". It is explicitly **not** spun off into a
  separate `FREE_NOTE`: that kind is only for a thought belonging to no entry at all. An exit's
  notes **append** (`appendNotes`) so closing a trade never erases what was said opening it.
  `entryThesis` stays the short why-this-why-now; the rest of the reasoning is notes.
  Fixture `16-facts-and-commentary` is the owner's real note and guards this.
- **No structured outputs — the shape is ours to enforce.** Constraining generation with
  `output_config.format` hit two Anthropic ceilings back to back: first the **16 union-typed
  parameter** cap (seven entry variants put us at 29), then, after fixing that, *"the compiled
  grammar is too large"*. Both 400'd before the model ever read the note, so **every** capture
  fell back to plain text — that was the "AI isn't doing anything" bug, start to finish.
  Shrinking to fit an undocumented grammar-size limit would have meant deleting entry kinds or
  fields, i.e. deleting the product, so the schema is no longer sent at all.
  - The prompt teaches the shape (two full worked examples + an explicit raw-JSON contract) and
    `parseJsonLoose()` + `normalizeExtraction()` enforce it. That normalizer was **always** the
    real guarantee: it had to survive hand-edited drafts read back from the store, so it already
    coerces types, drops unknown kinds and fills defaults. The grammar only ever bought us
    well-formed JSON, which `parseJsonLoose` recovers (strips ``` fences, takes the outermost
    `{...}`).
  - `lib/extraction.ts` keeps `optionalText` (`""` for "not stated") over nullable strings —
    fewer ways for the model to express "nothing", and `textOrNull` turns `""` into null anyway.
  - The new risk is prompt/normalizer **drift**, since nothing external validates the shape.
    `npm run check:capture` guards exactly that (and runs as the eval's pre-flight): it pulls the
    worked examples out of the prompt the model actually receives, runs them through the real
    parse + normalize path, and fails if an entry is dropped or the prompt promises a field the
    normalizer discards. Both failure modes are covered by negative tests.
- **Eval harness**: `npm run eval:capture` runs `tests/fixtures/capture/*.txt` through the real
  pipeline against a throwaway seeded world and prints a per-fixture diff (kinds produced,
  fields extracted, links resolved). Add a fixture + `.expected.json` sidecar before changing
  prompts. Needs `ANTHROPIC_API_KEY`; without one it scores the offline fallback and says so.

## Tagging & search (one tokenizer, one index)
- **`lib/tags.ts` is THE tag tokenizer.** Every path that turns text into tags — inline
  `#hashtags`, the optional Tags inputs, search-query parsing — calls `normalizeTag()`.
  DayOS's worst tag bug was two tokenizers quietly diverging; never add a second one.
  Tag charset: lowercase `a-z0-9_-`, 2–40 chars; `#` must start a word (`64#200` is not a tag).
- **Tags are stored** as `tags?: string[]` on trades, transcripts, lessons, daily journals,
  assets, asset notes, free notes (which also carry a one-of `category`), and setups — derived at save time (`deriveTags`) from inline
  `#hashtags` across the record's text fields plus the tag picker's selection. Zero friction:
  typing `#fomo` in any thesis/note/lesson is enough. No migration; undefined = [].
- **`components/TagPicker.tsx` is the one way to set tags in the UI** — recent chips + a
  "New tag" box, overflow behind "More tags". See the decisions log entry for the rules.
- **Save rules**: full editors *recompute* tags (their Tags input is prefilled, so deleting
  there + removing the hashtag from text removes a tag). Quick/partial saves (review panel,
  morning/evening check-ins) only *grow* tags (`mergeTags`) so they never wipe tags added
  elsewhere. Confirming a voice note carries the note's tags onto the created
  trade/journal/lessons.
- **`lib/search.ts` is the unified index**: every collection (trades incl. mistake/condition
  labels, captured notes, lessons, assets + threads, daily journals, setups, weekly reviews,
  free notes, imported executions) flattened to labeled fields per doc. Per-request linear scan — DayOS
  measured ~15ms over 5k entries; don't build a stored index at personal scale.
- **Query grammar** (DayOS-proven, improved): `#tag` tokens are exact-membership (`#win`
  never matches #winner — pills and search always agree), plain words are case-insensitive
  order-independent AND-substrings, and the two mix freely (`#fomo btc stop`).
- **/search UX**: header search box on every page → grouped results with type-filter tabs,
  anchored `<mark>` snippets labeled with the matching field, tappable tag pills everywhere
  (inbox cards, trade header + list preview, lessons, asset notes, daily header) that run an
  exact-tag search; active `#tag` tokens show as dismissible chips. The **empty search page
  is the tag index**: every tag with usage counts, plus a plain-English syntax explainer.
  Result links deep-link to real records (`/inbox?view=all#note-<id>`, `/lessons?view=all#lesson-<id>`,
  `/assets/<id>#note-<id>` — cards carry matching `id=` anchors + `scroll-mt-24`).

## Navigation (lean header)
- Primary nav = the daily loop + the asset tracker: **Today · Capture · Trades · Assets ·
  Review** (`primaryNavItems`).
  Everything else (Calendar, Notes, Playbook, Analytics, Calculator, Lessons, Import, Weekly
  Review, Settings) is under a **"More"** `<details>` dropdown (`moreNavItems`). Nothing removed.

## Transcript → AI structuring (segmented, one call)
- **`lib/extraction.ts` owns the vocabulary**: entry kinds, their per-kind fields, the raw JSON
  Schema for structured outputs, and `normalizeExtraction`/`normalizeEntry`. The schema is an
  **`anyOf` discriminated on a `const` kind**, so each entry carries only its own fields
  instead of the union of all of them — that's what keeps output near ~500 tokens even when a
  note splits four ways. Normalizing runs on *both* sides (model response **and** every read of
  a saved draft), so hand-edited JSON can never crash a page or a save.
- **`lib/extraction-context.ts` gives the model the trader's actual data** (~300 tokens, in the
  user message on every call): open trades, tracked asset symbols, ~10 recent instruments,
  active setup names — plus the live mistake-tag list already in the system prompt. This is
  what resolves "sol" to the existing SOL asset and "the bitcoin short" to a specific open
  trade, and what stops invented setup names. Open trades use **short handles (`T1`, `T2`)**,
  not UUIDs — a UUID each would eat the whole budget; `resolveTradeHandle()` turns them back
  into real ids immediately after extraction, so nothing downstream ever sees a handle.
- `lib/prompts.ts`: **one** editable template (`capture`) describing the entry vocabulary.
  Everything correctness-critical — segmentation rules, "never invent", enum discipline,
  OPEN-vs-IDEA, exit linking, emotion mapping, the **live mistake-tag list from the store** —
  lives in the code-built system prompt so a stale saved template can't break it.
- `lib/transcript-processor.ts`: **ONE** Anthropic call per note (no classify-then-extract
  pass — that doubles latency and cost for no accuracy gain at this scale). Official
  `@anthropic-ai/sdk`, **structured outputs**, model `ANTHROPIC_MODEL` (default
  **`claude-sonnet-5`**) with **adaptive thinking at `low` effort** — adaptive is the on-mode
  on Sonnet 5 (`budget_tokens` is rejected), and low effort keeps the call inside the <20s
  paste/save budget while still letting it think on a genuinely tangled note.
  **No prompt caching on purpose**: at ~1.2k tokens the write premium costs more than it saves.
- **No-API-key fallback** returns a single `FREE_NOTE` at LOW confidence. It deliberately does
  not attempt segmentation or classification — the old regex heuristics produced
  confident-looking nonsense that was worse than "here's your text, sort it out".
- Prompt-template **version gate** (`PROMPT_TEMPLATES_VERSION`, now 4): new defaults override
  previously-saved prompts; a trader's own edits survive (saving stamps the version).
- AI output is always shown for review on `/inbox` before it writes to any record.

## Decisions log (this engagement)
- Hardened durability: fail-loud config, durable settings, `/api/export`, storage banner.
- Trimmed lists to the lean defaults above using the exhaustive-but-lean pattern.
- Analytics (`/analytics`): lean **"What's hurting me"** summary up top (`analyticsLeaks`);
  expectancy + setup/session/condition tables moved behind an "Advanced analytics" toggle.
- Voice-note confirmation: single "Review this draft before saving" card with the confirm CTA
  in its footer; missing-info and link-required surfaced as callouts; color-coded confidence.
- **Friction overhaul** (see "Capture flow" + "Navigation" above): collapsed the
  save→structure→confirm→re-fill pipeline into one editable review card with auto-structure on
  save; taught extraction to capture spoken prices/size/P&L; trimmed the 11-item nav to a
  lean daily-loop header + "More" dropdown (Assets joined the primary nav later).
- Rewrote + re-routed the extraction prompts (see above).
- Swapped the transcript backend from OpenAI to the Anthropic SDK with structured outputs
  (`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`); prompts carried over unchanged.
- **Per-asset tracker** (`/assets`, `/assets/[id]`): one living page per instrument —
  current thesis + key levels edited in place, with a running note thread underneath. The
  note composer offers an optional **"Structure" tidy pass**
  (`structureAssetNoteDraftAction`): AI cleans up a raw thought-dump and shows the result
  for in-place review; nothing is saved by the tidy step itself. Assets sits in the
  primary nav.
- Calendar shows the recent week by default; older days fold behind a disclosure. "More"
  nav dropdown closes on outside click / Escape and no longer gets clipped by the nav's
  `overflow-x-auto`.
- **Daily-loop UX overhaul** (owner: the assets page is the model — make the daily loop that
  simple). Informed by research on TradeZella/Edgewonk/Stonk Journal patterns:
  - **Tap-first inputs**: `components/Chips.tsx` — radio/checkbox chips, big Long/Short
    buttons, Yes/No pairs, 1–10 scale. Zero client JS; plain server-rendered forms.
  - **Today (`/`)** is a guided ritual: morning check-in → log as you go → evening review
    with live done-states (`lib/coach.ts`); journaling **streak** (rewards showing up,
    never P&L; milestones at 7/30/100); Mon–Sun P&L week strip; week stats with
    **on-plan % first** and win rate always next to avg win/loss; "Waiting on you"
    (open + unreviewed trades); coach's corner = mentor tip of the day + top
    `analyticsLeaks` insight + resurfaced lesson.
  - **Quick log** (`components/QuickTradeForm.tsx`, on Today + `/trades/new`): recent-symbol
    chips, Long/Short, status, optional one-line why, numbers/mood behind one fold. Only
    the symbol is required (`quickLogTradeAction`).
  - **Trade page is review-first**: "Close & review" panel (exit numbers → followed-plan →
    A/B/C grade → 9 primary mistake chips → one lesson, auto-saved to the lesson bank);
    the full editor stays below, collapsed. Only the mistake tags shown as chips are
    replaced on save, so "More tags" picked elsewhere survive. (Now saved by the single
    page-wide save — see "One button saves the page" below.)
  - **`/daily` is two rituals**: morning (mind-state chips, mode, 3 guardrail inputs) and
    evening (today's trades listed, 3 Yes/No taps, two one-liners, discipline 1–10).
    `saveMorningCheckinAction` / `saveEveningReviewAction` merge into the day's journal
    without wiping each other's fields; long-form fields sit under "More (optional)".
- **Visual snapshot + design polish** (owner is a visual thinker; wants gauges, not grids):
  - `components/Charts.tsx` — server-rendered SVG chart kit, zero client JS: equity curve
    (area wash + endpoint label), per-trade diverging R/P&L columns (green/red), mistake
    frequency bars. Palette (forge green/red/blue on white) validated for CVD separation
    and contrast. Native `<title>` tooltips.
  - Today gets a **"Snapshot"** panel (equity curve last 30 days with all-time fallback,
    recent closed trades in R, most-tagged mistakes); `/analytics` gets **"The picture"**
    (same kit, all time, wider viewBox via the `width` prop so text keeps its size).
  - Design: sticky glass header (backdrop-blur), active-page nav highlight
    (`components/NavLinks.tsx`, client), gradient hero on Today, soft body background
    wash, `rounded-xl` panels.
  - Removed the orphaned recharts `DashboardCharts` component and the `recharts` dep
    (nothing imported it after the Today rewrite).
- **Trades + Capture rework** (same treatment as the daily loop):
  - `/trades` is a **day-grouped journal**, not a spreadsheet: one section per day with the
    day's P&L in the header; one row per trade showing **objective data only** (time,
    symbol, Long/Short chip, status chip, entry→exit/stop/leverage, plan ✓/~/✗ badge,
    A/B/C grade badge, mistake count, P&L + R or a "Review →" nudge). Tapping a row
    expands an **in-place preview** (numbers grid + thesis/invalidation/exit/lesson +
    mistake chips); the arrow icon or "Open full trade" goes to the full page. Summary
    line (count · net P&L · win rate · total R) reflects the active filters. Quick filter
    row = symbol + from/to; everything else under "More filters & sorting". View tabs
    trimmed to All / Open / Needs review / Closed (mistakes + this-week still work via
    params). Calendar deep-links (`?period=&date=`) still filter; active range shows as a
    dismissible chip. Replaced the client `TradeLogTable` (deleted) with server-rendered
    rows — trade delete now lives only on the trade page.
  - `/inbox` (Capture) leads with a **hero paste box** (one textarea + Save & review;
    time/source/type folded under "Details (optional)"); queue tabs trimmed to
    To review / Confirmed / Archived / All with a "N waiting for review" badge. Note cards
    are **confirm-first**: type chip + summary + status/confidence up front, the editable
    review draft opens first, raw note and all secondary actions (links, re-structure,
    lessons-only, archive, delete, raw JSON) sit behind folds. No sorting panel (newest
    first, always).

- **Tagging + indexing + search system** (see "Tagging & search" above): one tokenizer
  (`lib/tags.ts`), stored `tags[]` derived on every save path in `app/actions.ts`, unified
  cross-collection search index + mixed `#tag`/word query engine (`lib/search.ts`), rebuilt
  `/search` (type tabs, highlighted anchored snippets, dismissible tag chips, tag-index
  empty state), tappable `TagPills` across inbox/trades/lessons/assets/daily, optional
  `TagsField` on full editors only (quick flows stay tap-only — friction budgets intact).
  Deliberately NOT done: AI-proposed tags (the tag vocabulary stays the trader's own;
  extraction already maps mistakes to structured tags), and no stored/inverted index.

- **Tag picker — the vocabulary is the trader's, and it stays uncrowded**
  (`components/TagPicker.tsx`). Every place you can set tags now shows your own tags as
  one-tap chips plus a **"New tag"** pill that opens an inline box, so a tag can be invented
  anywhere without leaving the form. Crowding is handled by **recency**: the record's current
  tags plus your **6 most recently used** sit in the front row, the whole rest of the
  vocabulary folds behind **"More tags (n)"**. A tag you just invented is by definition the
  most recent, so it's in the front row next time.
  - `getTagVocabulary()` (`lib/data.ts`) ranks every tag by last-used across trades, notes,
    lessons, assets, asset notes, journals and setups. Recency beats frequency on purpose.
  - The picker posts the same single `tags` field the old text input did — `lib/tags.ts` is
    still the one tokenizer, and `normalizeTag()` validates a custom tag as you add it.
  - Because the picker always renders the record's existing tags as selected chips, its
    selection is the **complete** truth for that record: unticking a chip removes the tag.
    Surfaces without a picker still only grow tags (`mergeTags`), unchanged.
  - Live on: quick trade log (Today + `/trades/new`), trade page, `/inbox` capture + note
    edit, `/lessons` add + edit, `/assets/[id]` (asset, new note, each note edit),
    `/playbook` add + edit, and the `/daily` evening review. **Deliberately not** on the
    `/daily` morning form — morning and evening are two separate forms, so a second tags
    field there would be a fresh way to lose a tag by saving the other ritual.
  - It was the first form control in the app to ship client JS (the calculator and the
    Today quick-note bar are the other two); inventing a tag can't be done
    with a plain `<form>`. Enter inside the box adds the tag and never submits the page.
  - `TagsField` (the old free-text tags input) is gone — one tag control, not two.
  - **`groups` (later)**: optional labelled shortcut rows above the vocabulary, sharing the
    same picked state and the same hidden field. The quick-note forms pass one — the assets
    being tracked — so "a note about SOL" is a tap, not a remembered `#sol`. Shortcut chips
    are ordinary tags; nothing about them is a separate vocabulary.

- **One button saves the page** (owner: "if I hit ONE button it should capture everything on
  that page — I was losing notes"). The old failure was two independent `<form>`s per page:
  typing a note and pressing "Save current view" (or filling the review and pressing "Save
  trade changes") silently threw the other one away.
  - **A page is now one form with one Save.** `components/SaveBar.tsx` is that button: fixed
    to the bottom of the screen, always reachable, says "Unsaved changes" the moment you type,
    saves on Cmd/Ctrl+S, and asks before you leave a dirty page (both tab-close and in-app
    `<Link>` clicks — `beforeunload` alone doesn't catch client-side navigation). It renders
    first inside its form so Enter in any field triggers Save, never a delete button.
  - **`/assets/[id]`** = current view + new thread note + edits to existing notes, all in one
    form (`saveAssetWorkspaceAction`). Note fields are `noteText-<id>` / `noteTimeframe-<id>`;
    "Delete note" uses `formAction={deleteAssetNoteAction.bind(null, id)}` and still saves
    everything else first. (React forbids `name` on a button with a function `formAction` —
    bind the id, don't encode it in name/value.)
  - **`/trades/[id]`** = review panel + every fold, one form (`saveTradeAction`, which replaced
    `reviewTradeAction` + `updateTradeAction`). Duplicated controls were removed rather than
    left to fight: status lives only in the review chips, exit price / realized P&L / plan /
    grade / lesson / exit reason only in the review panel, the 9 primary mistake chips in the
    review and the rest under "More mistake tags".
  - **`saveTradeAction` is field-presence-based**: a field is only written if its input was on
    screen (`formData.has(...)`), so a partial surface can never wipe fields it didn't render.
    `shownMistakeTagIds` is read with `getAll()` so several groups of chips can coexist.
  - **Review without leaving the list**: the expanded row on `/trades` carries the same
    `TradeReviewFields` (`components/TradeReviewFields.tsx`) posting to the same action;
    saving returns to the same filtered list with that row still open (`?open=<id>#trade-<id>`).
  - **One definition of "reviewed"**: `tradeNeedsReview()` in `lib/metrics.ts`, used by Today,
    `/trades` and the trade page. It keys off `followedPlan` only — requiring a lesson too left
    reviewed trades nagging "Review →" forever while the trade page said "done".
  - Deliberately NOT done: timer-based autosave. Every save is a server action + redirect, so
    autosaving mid-sentence would fight the cursor and duplicate thread notes; the dirty
    warning + always-visible Save gets the same "never lose work" guarantee without that.

- **SignalDesk bridge — Phase A** (design record: `signaldesk/TRADEGENIE_BRIDGE.md`,
  which spans both repos — read it before touching anything here). Saving a trade
  now staples a frozen snapshot of the market onto it: `Trade.marketContext`,
  captured by `lib/market-context.ts` at all three `db.create("trades", …)` sites,
  shown as a read-only "Market context at entry" fold on `/trades/[id]`.
  - **Never load-bearing.** 2s timeout, every failure path returns `null`, the
    trade saves regardless. If a change could make a trade save fail because the
    market-data app is down, the change is wrong. Same rule as "AI is optional".
  - **Off until configured.** No `SIGNALDESK_SNAPSHOT_URL` +
    `SIGNALDESK_SNAPSHOT_TOKEN` means no network call at all — zero cost to the
    30-second quick-log budget while the owner decides.
  - **Entry only, copied not linked, never recomputed.** The decision being
    graded is the entry. The snapshot is a permanent part of the journal and must
    stay readable with SignalDesk switched off.
  - **The slot rule lives in SignalDesk, not here.** We send the trade's
    timestamp; it resolves the briefing at or before that instant (a 06:00 IST
    trade gets the previous evening's). Never reimplement that comparison here —
    two implementations would drift, the same way two tag tokenizers did in DayOS.
  - **Two `lib/store.ts` traps the stored type works around**: `dehydrate()` hands
    values straight to Firestore, which rejects `undefined` (so the zod schema uses
    `.default(null)`, never `.optional()`), and `hydrate()` turns any key ending in
    `At` — and the key `date` — back into a `Date` on read (so those fields are
    typed `Date`, matching the store's convention instead of fighting it).
  - Deliberately NOT done: backfilling old trades, and any analytics over the
    captured context. That's Phase B, and the analysis needs ~30 context-carrying
    trades before it says anything true rather than noise that looks like signal.

- **Profitability calculator** (`/calculator`, under "More"). A scratchpad — nothing is saved —
  that answers one question before a trade: *once fees are paid, is this worth taking?*
  - **`lib/calculator.ts` is the math**, pure and store-free. The idea it's built around:
    **fees are charged on notional, not on your risk**, so they shrink the win *and* grow the
    loss. Net R = `(reward − fees) / (risk + fees)`. On the owner's own example — a 0.3% move
    planned at 2R, 0.045% taker each side — that's **0.87R real, needing a 53% win rate**
    instead of 33%. That gap is the whole reason the page exists.
  - Break-even price is **solved, not approximated**: the exit fee is charged on the *exit*
    price, so break-even is not `entry + costs`. Long: `(E(1+fe) + funding) / (1 − fx)`.
  - **Slippage is opt-in and off by default** (a checkbox, `slippagePct: 0` = exact fees-only
    answer). When on it moves the *fill* price against you on all three legs — pay up to get
    in, give a tick back on the target and on the stop — and everything reprices off those
    fills. Break-even and the target ladder carry an extra `exitSlip = 1 − dir·slip` factor,
    since the exit slips off the quoted price as well as paying a fee on it. On the owner's
    0.3% example, 0.02%/leg takes 0.87R → **0.61R** and the required win rate 53% → 62%.
  - The cost-drag ladder solves the stop distance **exactly** (`exitSlip·(1 − dir·fx)`
    denominator) and includes funding. Approximating the loss-side cost at the entry price
    put the tight-stop rows visibly wrong — and those are the rows the table exists to warn
    about.
  - Position size is off the **net** loss, so a stop-out costs exactly the risk budget with
    fees included rather than the budget plus the fee bill.
  - Outputs: net vs gross R, break-even win rate (net vs gross), fee bite as a share of the
    move, break-even price/move, sizing + notional + margin + rough liquidation, expectancy
    per trade / per 100 at a chosen win rate — **defaulted to the journal's real win rate**
    once there are ≥5 closed trades, which is the bit a generic web calculator can't do.
    Behind one fold: fee drag across move sizes, and the target you'd need for a true 1/2/3R.
  - Warnings (not silent nonsense) for a stop on the wrong side, a stop past the rough
    liquidation, and a size needing more margin than the account holds.
  - **It ships client JS on purpose** — the second exception after `TagPicker`, with the
    Today quick-note bar the third. A calculator
    you have to submit isn't a calculator; you'd never scrub the stop around to find where
    fees stop eating the trade. Fee tier / account / risk / leverage persist in
    `localStorage` (convenience only, never load-bearing); prices don't.
  - Deliberately NOT done: saving scenarios, prefilling from an existing trade, and writing a
    planned-R back onto a trade. All three turn a scratchpad into a record with a migration.

- **Custom pill labels — the preset vocabularies are the trader's too**
  (`lib/options.ts` + `components/OptionField.tsx`). Every preset-pill row that
  used to be a closed list now carries an **"or type another…" box**, the same
  shape as the symbol row on the quick trade log. Typing a label saves it with the
  record *and* keeps it: it's a chip/dropdown entry from then on. Zero client JS —
  the typed value rides along in the same form, exactly like a `#hashtag` typed
  into a thesis becomes a tag.
  - **`lib/options.ts` is THE registry**: one normalizer (`normalizeOptionValue`,
    "Cut winner early!" → `CUT_WINNER_EARLY`), one storage collection
    (`customOptions`), one catalog (`getOptionCatalog()` → `choices` / `label` /
    `labeler` / `allows` / `resolve` / `resolveMany`). Same reasoning as the one
    tag tokenizer: normalizing in one place is what stops "Chased breakout",
    "chased breakout" and "Chased  Breakout" becoming three pills. The typed
    **label is stored verbatim** and shown; `humanize()` is only the fallback.
  - **Groups**: mind state / mood, market conditions, lesson categories, asset-note
    timeframes, risk posture, trading mode — plus **mistake tags**, which are the
    one exception: they stay `mistakeTags` records (a trade links to one by id),
    registered by `registerCustomMistakeTags()`. A mistake you invent is *primary*
    by definition (`isPrimaryMistakeTag`), so it sits with the review chips rather
    than under "More mistake tags".
  - **Deliberately NOT extendable**: direction, trade status, A/B/C grade,
    followed-plan, discipline 1–10, note type, market type. Those aren't
    preferences — P&L, R, win rate and the review nudges key off them, so a custom
    value there would quietly break the maths rather than personalize anything.
  - **Rules that hold everywhere**: typed always beats the tapped chip (the
    `instrument`/`instrumentChip` rule); a control named `x` posts its typed label
    in `xCustom`; re-typing an existing label in any casing selects it instead of
    duplicating it; junk (`" !! "`) registers nothing. `saveTradeAction`'s
    field-presence rule counts `x` **or** `xCustom` as "was on screen".
  - **The vocabulary only grows from the trader's own typing** — never from AI
    output. The inbox review card resolves mind state / risk posture from the form
    box; an out-of-vocabulary value in an AI draft still falls back to `UNKNOWN`.
    (Same line we drew for tags: no AI-proposed vocabulary.)
  - **/settings → "Your own labels"** lists everything added; tapping a label opens
    **rename** and **remove** together. Rename moves the **display label only** —
    the stored `value` (and a mistake tag's `name`) is frozen, because records
    carry the value and analytics group by it, so re-normalizing would orphan
    every entry already using it. Rename is for fixing how a label reads, not for
    changing what it means; for that, add a new label and retire the old one.
    Removing takes a label out of the pickers only; records already carrying the
    value keep it and fall back to the humanized form. The exception is a mistake
    tag, which trades link to by id — removing one un-tags those trades and says
    how many, rather than leaving a dangling link the analytics silently drop.
  - Fixed along the way: `/api/export` was missing `assets`, `assetNotes` (and now
    `customOptions`) — the "one JSON backup" wasn't backing up the asset tracker.
- **Segmented capture pipeline** (see "Capture flow" + "Transcript → AI structuring" above):
  replaced the single flat 36-field extraction with one call returning an array of typed
  entries; added the trader-context block; fixed the exit-creates-a-duplicate-trade bug; new
  routes from capture to the asset thread, to weekly reviews and to a `freeNotes` collection;
  per-entry review cards with a Remove button; `npm run eval:capture` + 15 fixtures.
  Trimmed with it: the **"Note type" dropdown is gone** from the capture form and the raw-note
  editor — it routed the old per-type prompts and now decides nothing. `Transcript.transcriptType`
  is still stored, but **derived** from the entries a note produced, purely as a label for the
  inbox/calendar/search chips. `lib/prompts.ts` went from five per-type templates to one.
  Deliberately NOT done: a classify-then-extract two-pass (double latency and cost for no
  accuracy gain at this scale), and prompt caching (prompt is too small to pay for itself).

- **AI failures now say why** (`lib/ai-status.ts`). The capture pipeline swallowed every
  Anthropic error with a bare `catch {}` and fell back to the offline path, so a rejected key,
  a wrong `ANTHROPIC_MODEL`, a truncated reply and "no key configured" were indistinguishable:
  the note came back as plain text with no explanation. That is why capture looked finished but
  did no AI work. Now the reason rides onto the review card and into the server log, `/settings`
  has an **AI status** panel plus a **"Test AI connection"** button that makes one real call, and
  `max_tokens` went 4096 → 8192 because adaptive thinking draws from the same budget as the
  entries. `asset-note-structurer.ts` had also drifted onto a different model — both AI paths
  now read `activeModel()`.

- **The segmented capture pipeline was merged into `main` late**, long after it was written, so
  it landed alongside 15 commits of newer work (calculator, SignalDesk bridge, tag picker,
  custom options, analytics redesign). Conflicts were resolved keeping **both** sides:
  `createTradeFromEntry` gained `captureMarketContext` + the `OptionCatalog` so custom mind
  states/risk postures survive the capture path, `/inbox` kept the new `TagPicker`, `/settings`
  kept the custom-labels panel, and `collectionNames` (not a hardcoded list) drives `/api/export`
  so `customOptions` and `freeNotes` are both backed up.
  - **Known gap, deliberate:** the capture review card still offers the *closed* mind-state and
    risk-posture lists, not the custom-label picker, because `normalizeEntry` validates entries
    against the closed enum — that guard is what stops a hand-typed value smuggling a bad enum
    into a record. Reconciling "enum discipline" with the extendable vocabulary is its own piece
    of work; custom labels still work everywhere else.

- **Quick note — the box with nothing to decide** (`components/QuickNoteBar.tsx` on
  Today, `components/QuickNoteBox.tsx` on `/daily`, both writing `freeNotes`). A
  thought that isn't a trade, a lesson or a check-in has a home now.
  - **Today is one line and nothing else** — a slim pill copied in shape from the
    time-tracker's quick-capture bar: borderless input, a send button that stays
    muted until there's text (dictation and paste need a save path that isn't the
    Enter key), and a `N notes today →` link. No heading, no textarea, no Save
    button. Type → Enter → saved.
  - **Long-press (420ms, the time-tracker's `LONG_PRESS_MS`) or double-click**
    promotes the thought to its home page, `/daily`, where the full box and Save
    button live. Whatever was typed rides along in `?note=` and prefills the big
    box, so the gesture never costs you a thought — and it saves nothing by
    itself, it just moves you.
  - **The bar is the third client-JS control** (after `TagPicker` and the
    calculator), for the same reason: a press-and-hold gesture can't be expressed
    as a plain form. It degrades cleanly — with JS off it is still a real server
    form, so Enter and the send button save exactly as before; only the shortcut
    gesture is lost.
  - **Stored as `freeNotes`** — the same collection the segmented capture pipeline
    already writes for the leftover parts of a voice note, not a parallel one. The
    box was built against that exact `FreeNote` shape while the pipeline was still
    on an unmerged branch, so the two landed on `main` days apart and converged
    with no migration. Hand-typed notes carry `linkedTranscriptId: null`.
  - **The day's review lists both kinds**, hand-typed and capture-derived, since
    both are filed by `createdAt`. Free notes previously had nowhere to link to;
    search now points them at `/daily?date=…#note-<id>` instead of the inbox.
  - **Filed by `createdAt` to the day being viewed**, not to "now": writing on
    `/daily?date=<older day>` files the note to that day, so a day can be written
    up late. Same-day notes keep the real clock time (the list shows HH:mm).
  - **Its own small form on purpose.** The page-wide "one button saves the page"
    rule exists to stop two forms fighting; here the opposite applies — the note
    box must not ride along with (or be lost to) an unrelated save. Regression-
    tested: saving the evening review leaves the day's notes untouched.
  - Tags come from inline `#hashtags` via `deriveTags` — nothing extra to fill in.
    Indexed in `lib/search.ts` as its own **"Quick notes"** kind, deep-linking to
    `/daily?date=...#note-<id>`. Added to `/api/export`.
  - **Edit came later** (`updateFreeNoteAction`): "delete + retype" was fine for a
    one-liner and wrong for a paragraph, so each note in the day's list carries an
    **"Edit"** fold — same one-field shape as writing it, tags re-derived from the
    text. `id` and `createdAt` are untouched, so the note stays filed to its day
    and every `#note-<id>` deep link (search results, the post-save anchor) still
    lands. Emptying the box is refused, not treated as a delete — the delete
    button is right there, and a silent drop would look like a save that worked.
  - Deliberately NOT done: a separate calendar entry (the owner chose the
    day-review home over a parallel calendar item).

- **Notes got two axes and a home** (`/notes`, `lib/notes.ts`, `components/QuickNoteComposer.tsx`,
  `components/FreeNoteCard.tsx`). The quick note became the app's universal capture — which
  meant a growing pile with no way back into it. It now carries two things, both optional,
  and has a page that filters on them.
  - **The two axes are deliberately different shapes**: **category** is *one* value per note
    ("what is this about") and **tags** are *many* ("what does it touch"). One-of and
    many-of answer different questions, and collapsing them into one list is what makes a
    tag vocabulary turn to mush.
  - **Category = a `noteCategory` option group** (`lib/options.ts`), so it extends by typing
    exactly like every other pill row in the app: `Trade · Asset · Mindset · Market · Lesson
    · Review`, mirroring the parts of the journal a loose thought usually belongs to, plus a
    **No category** chip. That chip's empty value is in no group's vocabulary, so `resolve()`
    stores null for it — radios can't be unticked, and a category you can set but never clear
    is a trap. Custom ones show up in `/settings → Your own labels` for rename/remove, free.
  - **The asset picker is tags, not a second vocabulary.** `TagPicker` gained a `groups` prop:
    labelled shortcut rows above your own vocabulary, sharing the same picked state and the
    same hidden `tags` field. `/notes` and `/daily` pass one — **Assets**, from
    `getSymbolTagSuggestions()` (tracked assets, then recently traded instruments, through
    `normalizeTag`). Tapping **BTC** and typing **#btc** produce the identical tag, so search,
    pills and the note filter can never disagree about what a coin is called. A separate
    `symbols[]` field would have been exactly the DayOS two-tokenizer mistake in new clothes.
  - **Today's bar is untouched** — one line, Enter, saved, no chips. It posts neither field,
    which is why both had to be optional: the fastest capture path can't grow a decision.
    Uncategorised notes are first-class and filterable as such.
  - **`/notes` is the filter surface** (under "More"): a composer on top, then category chips ×
    tag chips × a text box, then the matches grouped by day. **Filters are links, not client
    state** — every view is a real URL you can bookmark or come back to, and the chip counts
    are computed over *all* notes so a chip never vanishes as you narrow. The text box reuses
    `parseQuery` from `lib/search.ts`: `#tag` exact, words AND-substring, mixable. One query
    grammar in the app, not two.
  - **`saveQuickNoteAction` / `updateFreeNoteAction` follow the field-presence rule**
    (`saveTradeAction`'s): a field is written only if its control was on screen, so the Today
    bar can never wipe a category or tags set elsewhere. The full card *is* the complete truth
    for text + category + tags, which is why its Edit fold shows all three — an edit fold with
    only the text would make "fix a typo" silently drop the tags.
  - **AI-created notes stay uncategorised.** The capture pipeline's `FREE_NOTE` writes
    `category: null` on purpose — the vocabulary grows from the trader's own typing, never
    from model output. Same line already drawn for tags.
  - `getTagVocabulary()` now counts `freeNotes` too. It didn't, so a tag invented on a note
    was missing from every picker in the app — a real bug the moment notes got a tag picker.
  - Deliberately NOT done: AI-suggested categories, a second date-range control on `/notes`
    (the day grouping plus `/daily?date=` covers it), and pinning/archiving notes.

- **How the trade was taken — "Setup & execution"** (`components/TradeSetupFields.tsx`,
  `lib/setups.ts`, two new option groups). P&L tells you *that* something worked; nothing in
  the journal said *what*. Three tap-only rows and one checklist now do, and they're the input
  to every strategy question the analytics can answer.
  - **Its own fold on the trade page, first under the review**, not buried in "objective" or
    "subjective" data — the owner barely used those, and this is neither: it's the execution.
    Collapsed, it still shows a one-line summary (`TradeSetupSummary`): `15m · 5m · FVG ·
    OTE · 5/5 steps`. It opens by default on a trade that has none of it recorded.
  - **Timeframes used** (`tradeTimeframe`: 1m/5m/15m/1H/4H/1D) and **mechanisms in the entry**
    (`mechanism`: HTF bias, market structure shift, displacement, liquidity sweep, FVG, order
    block, breaker, OTE, premium/discount, equal highs/lows, killzone, retest) are multi-select
    chips through the existing `OptionChipCheckbox` — so both extend by typing, exactly like
    every other pill row. Mechanism chips carry **hints** (shown on hover) because the owner is
    learning the vocabulary. Deliberately the *concepts*, not the strategies: which system you
    were running is the playbook setup.
  - **The model checklist is the playbook setup's checklist, read as steps** (`lib/setups.ts`).
    No new field: write the model one step per line in the setup's *Entry checklist* — TraderMayne's
    5M model is exactly five lines — and every trade on that setup offers those lines as tick
    chips with an `n of N` score. One definition of the model, in one place; editing the
    checklist can never leave the trade form offering a different set of steps than the
    playbook shows. Lines are tolerant of `-`, `1.` and `[ ]` prefixes; a line over 60 chars is
    prose, not a step, and still reads on the playbook page without becoming a chip.
  - **A tick stores the step's normalized value, never its index** — reordering the checklist
    must not move a tick from one step to another, and fixing a typo in a line must not lose
    the ticks under it. Same "value frozen, label moves" rule as custom option labels.
  - **The same fold sits inside the `/trades` inline review**, in that row's *existing* form —
    a second `<form>` in a row is exactly how you lose half of what you just filled in. One
    "Save trade" covers the review and the execution tags, so the daily review pass can tag
    mechanisms without a page load.
  - **Filter and analyse**: `/trades` gains Setup / Timeframe / Mechanism filters; `/analytics`
    (advanced) gains **By timeframe**, **By mechanism**, and **Model followed, or not** —
    closed trades on a setup with a checklist, split by whether every step was actually there.
    That last table is the whole point of the checklist: if the two rows look the same, the
    model isn't earning its place yet. Multi-value tables deliberately sum to more than the
    trade count (`multiValuePerformance` — one trade lands in every bucket it carries).
  - Fixed on the way: re-typing a built-in label whose value isn't its label normalized
    ("Just watching" → `OBSERVE_ONLY`) minted a duplicate chip. `register()` now matches on the
    normalized label too and returns the value already stored.
  - Deliberately NOT done: mechanisms on the 30-second quick log (it would grow the one path
    that must stay fast — they're one tap away in the row preview), AI-filled mechanisms from a
    voice note (a prompt + eval change of its own), and per-step notes.

- **Site password gate** (`lib/site-auth.ts`, `middleware.ts`, `app/login/`). The app was
  fully open at its Vercel URL — anyone with the link had read *and write* access. Vercel's
  own Deployment Protection (password or SSO) is a paid Pro feature; for one trader that
  cost buys nothing a five-line middleware check doesn't already do.
  - **One password, one cookie, no accounts.** `SITE_PASSWORD` is a single env var checked
    against the login form; the cookie is a SHA-256 digest of the password (`lib/site-auth.ts`),
    not the password itself, computed with Web Crypto so the same code runs in the Edge
    `middleware.ts` runtime and the Node server-action runtime. Rotating `SITE_PASSWORD`
    invalidates every existing cookie for free, with no session store.
  - **Off until configured** — same rule as the SignalDesk bridge and the AI path. No
    `SITE_PASSWORD` means `middleware.ts` no-ops entirely; a fresh clone or an unconfigured
    preview deploy behaves exactly as before this existed, so this can never lock anyone out
    by accident.
  - **Stateless on purpose, with the tradeoff that implies**: there is no server-side session
    list, so "log out" (`/settings` → Log out) only clears the browser's cookie — a copied
    cookie value stays valid until the password is rotated. Acceptable for keeping a personal
    URL private; not a defense against a captured cookie.
  - `middleware.ts` matcher excludes only `/login` and Next's own static/image assets, so it
    covers every page, every server action, and `/api/export` (the full-backup dump) alike.

## Open items
- **Vercel production branch — RESOLVED**: all feature/durability/lean work has been merged
  into `main`, and `main` is the configured Vercel Production Branch. `main` is now both the
  single working branch and the production branch, so every pushed commit auto-deploys. (The
  old two-agent `claude/*` branches are fully contained in `main` and can be deleted anytime.)
- **Weekly review limitation — RESOLVED**: `WEEKLY_REFLECTION` is now an entry kind carrying
  `summaryText` / `whatImproved` / `whatDeteriorated` / `keyLesson`. Confirming one writes a real
  weekly review — the trader's words for the narrative, the trade log for the numbers. The
  separate weekly-review generator still exists for a numbers-only synthesis.
- **Eval harness needs a key**: `npm run eval:capture` can only measure the real pipeline when
  `ANTHROPIC_API_KEY` is set. Run it before/after any prompt or schema change to the capture
  path and keep the pass rate in the commit message.

## Commands
```bash
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # next build
npm run seed       # seed sample data
npm run eval:capture   # score capture extraction against tests/fixtures/capture
npm run check:capture  # offline: do the prompt's examples survive parse + normalize?
```
