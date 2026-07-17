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

## Data durability (top priority, resolved)
- Storage adapter: `lib/store.ts`. `storageStatus()` is the single source of truth:
  `firestore` (durable) | `local` (dev only, ephemeral on Vercel) | `invalid` (partial config).
- `usesFirebase()` **throws** on a partial Firebase config rather than silently falling back.
- Settings persist to Firestore (`appSettings/singleton`) when Firebase is on — not local disk.
- `/settings` shows a colored storage banner; `/api/export` dumps everything as one JSON backup.
- Required env: `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
  (+ `FIREBASE_STORAGE_BUCKET`). Production is confirmed durable (Firestore service account).

## Capture flow (one screen — the daily loop)
- `/inbox` is **paste → review → confirm**, all on one screen. Saving a note
  (`saveTranscriptAction`) **auto-structures it immediately** (no separate "Structure" click).
- The review card is **editable in place** (`ReviewFields` in `app/inbox/page.tsx`), type-aware
  for trade / daily / general notes. `confirmTranscriptAction` merges the on-screen edits
  (`readReviewOverrides`) over the AI draft before writing the record.
- Confirm writes the final record and **stays on `/inbox`** (no forced second confirmation on
  the trade page); the confirmed note still links to the saved trade. Default inbox view is
  **"To review"** (unprocessed + structured).
- Spoken **numbers are captured**: entry/stop/target/exit price, quantity, leverage, realized
  P&L flow through extraction → editable card → trade (`createTradeFromStructured` derives
  netPnl + R-multiple). Strict "only if actually stated, never invent" rule in the prompts.

## Tagging & search (one tokenizer, one index)
- **`lib/tags.ts` is THE tag tokenizer.** Every path that turns text into tags — inline
  `#hashtags`, the optional Tags inputs, search-query parsing — calls `normalizeTag()`.
  DayOS's worst tag bug was two tokenizers quietly diverging; never add a second one.
  Tag charset: lowercase `a-z0-9_-`, 2–40 chars; `#` must start a word (`64#200` is not a tag).
- **Tags are stored** as `tags?: string[]` on trades, transcripts, lessons, daily journals,
  assets, asset notes, and setups — derived at save time (`deriveTags`) from inline
  `#hashtags` across the record's text fields plus the optional Tags input. Zero friction:
  typing `#fomo` in any thesis/note/lesson is enough. No migration; undefined = [].
- **Save rules**: full editors *recompute* tags (their Tags input is prefilled, so deleting
  there + removing the hashtag from text removes a tag). Quick/partial saves (review panel,
  morning/evening check-ins) only *grow* tags (`mergeTags`) so they never wipe tags added
  elsewhere. Confirming a voice note carries the note's tags onto the created
  trade/journal/lessons.
- **`lib/search.ts` is the unified index**: every collection (trades incl. mistake/condition
  labels, captured notes, lessons, assets + threads, daily journals, setups, weekly reviews,
  imported executions) flattened to labeled fields per doc. Per-request linear scan — DayOS
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
  Everything else (Calendar, Playbook, Analytics, Lessons, Import, Weekly Review, Settings) is
  under a **"More"** `<details>` dropdown (`moreNavItems`). Nothing removed.

## Transcript → AI structuring
- `lib/prompts.ts`: per-type templates (field spec + enum values + null rule + JSON example).
  Correctness-critical instruction (rules, emotion mapping, **live mistake-tag list from the
  store**) lives in the code-built system prompt so stale saved templates can't break it.
- `lib/transcript-processor.ts`: routes each note to ONE prompt by declared type; UNKNOWN uses
  a classify-first general prompt. Calls **Claude** via the official `@anthropic-ai/sdk` with
  **structured outputs** (raw JSON Schema → schema-valid JSON), thinking disabled. Model is
  `ANTHROPIC_MODEL` (default `claude-sonnet-4-6`). Falls back to a regex mock when no key.
- Prompt-template **version gate** (`PROMPT_TEMPLATES_VERSION`): new defaults override
  previously-saved thin prompts; a trader's own edits survive (saving stamps the version).
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
    A/B/C grade → 9 primary mistake chips → one lesson, auto-saved to the lesson bank) via
    `reviewTradeAction`; the full editor stays below, collapsed. Only the mistake tags
    shown as chips are replaced on save, so "More tags" picked elsewhere survive.
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

## Open items
- **Vercel production branch — RESOLVED**: all feature/durability/lean work has been merged
  into `main`, and `main` is the configured Vercel Production Branch. `main` is now both the
  single working branch and the production branch, so every pushed commit auto-deploys. (The
  old two-agent `claude/*` branches are fully contained in `main` and can be deleted anytime.)
- **Weekly review limitation**: the extraction schema strips weekly-only fields
  (`summaryText`, `whatImproved`, …), so weekly voice notes mainly yield lessons on the inbox
  path. Richer weekly synthesis lives in the separate weekly-review generator.

## Commands
```bash
npm run dev        # local dev server
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run build      # next build
npm run seed       # seed sample data
```
