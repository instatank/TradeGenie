# AGENTS.md

This is the source-of-truth operating guide for Codex and other coding agents working on TradeGenie. Keep it concise. Prefer linking to focused docs instead of duplicating long context.

## Project Identity

- Product: TradeGenie (tagline: "magic journal")
- Purpose: low-friction personal trading journal and learning system for one discretionary trader.
- Core value: help build a daily journaling habit, capture subjective reasoning, review mistakes, and turn trades/voice notes into reusable lessons.
- This app must not provide financial advice, trade recommendations, signals, broker sync, automated execution, or social/team features.

## Current Stack

- Next.js App Router, TypeScript, React 19
- Tailwind CSS
- Firebase Admin / Firestore support for deployed persistence
- Local JSON fallback when Firebase env vars are absent
- Recharts, Zod, date-fns, PapaParse, lucide-react

## Data And Persistence

- Storage abstraction lives in `lib/store.ts`.
- Current local fallback file: `data/tradeforge-store.json`.
- Firebase activates only when credentials are configured.
- Required Firebase env vars for Vercel/local Firestore:
  - `FIREBASE_PROJECT_ID`
  - `FIREBASE_CLIENT_EMAIL`
  - `FIREBASE_PRIVATE_KEY`
  - `FIREBASE_STORAGE_BUCKET`
- Optional local ADC path:
  - `GOOGLE_APPLICATION_CREDENTIALS`
- Optional SignalDesk bridge (both required, or the feature is off):
  - `SIGNALDESK_SNAPSHOT_URL`
  - `SIGNALDESK_SNAPSHOT_TOKEN`
- Optional site password gate (`lib/site-auth.ts` + `middleware.ts`), off until set:
  - `SITE_PASSWORD` — one shared password for the whole app, checked in `middleware.ts`.
    No `SITE_PASSWORD` means no gate at all, same "off until configured" rule as
    everything else here. Built because Vercel's own Deployment Protection is a
    paid Pro feature and this app has exactly one user.
- Do not commit secrets, service account JSON, `.env`, `.env.local`, or local data exports.
- Screenshot uploads use Firebase Storage when Firebase is configured; local disk under `public/uploads` is only a development fallback.

## Important Files

- `README.md`: setup, Firebase/Vercel notes, project overview.
- `PENDING_TASKS.md`: ongoing backlog and recommended next sequence.
- `app/actions.ts`: server actions for creates, updates, deletes, transcript processing, weekly review generation.
- `lib/types.ts`: app data model types.
- `lib/store.ts`: persistence adapter.
- `lib/data.ts`: higher-level data fetch helpers.
- `lib/metrics.ts`: P&L, R, win rate, expectancy, weekly stats, frequency helpers. `MIN_SAMPLE`/`isThinSample` is the shared "not enough trades to conclude anything" line every grouped table greys out against.
- `lib/calculator.ts`: pre-trade math for `/calculator` — net-of-fees R, solved break-even price, break-even win rate, fee-aware position sizing. Pure functions, no store access.
- `lib/tags.ts`: THE tag tokenizer — normalize/extract/derive for free-form `#tags`; every tag path goes through it.
- `lib/options.ts`: THE custom-option registry — the trader's own labels for the preset pills (mood, market conditions, mistakes, lesson categories, asset timeframes, risk posture, trading mode, quick-note categories, trade timeframes, setup mechanisms). One normalizer, one `customOptions` collection, one catalog. Custom mistake tags are `mistakeTags` records instead, because trades link to them by id.
- `components/OptionField.tsx`: the pill controls with an "or type another…" box (radio / checkbox / select). Server-rendered, zero client JS — a control named `x` posts its typed label in `xCustom`, and typed always beats the tapped chip.
- `lib/search.ts`: unified search index over every collection + `#tag`/word query engine + tag-usage registry.
- `components/TagPills.tsx`: tappable tag pills (route to exact-tag search) + the optional Tags form input.
- `components/QuickNoteBar.tsx`: the one-line capture bar on Today (shape copied from the time-tracker's quick-capture bar). Enter or the send button saves a `freeNotes` record; long-press (420ms) or double-click carries whatever is typed to `/daily` via `?note=`. Ships client JS for the gesture only — without it, it is still a real server form that saves.
- `components/QuickNoteBox.tsx`: the day's thoughts on `/daily` — the composer plus that day's notes, and the landing spot for a thought promoted from the Today bar. Its own small form, so a half-typed thought never rides along with an unrelated save.
- `components/QuickNoteComposer.tsx`: writing one note — textarea + Save, plus two optional taps: an "About" category row (`noteCategory`, extendable by typing) and a `TagPicker` whose first row is the assets being tracked. Shared by `/daily` and `/notes`.
- `components/FreeNoteCard.tsx`: one saved note wherever it's read — text, time, category chip, tag pills, and an Edit fold carrying the same three controls it was written with.
- `lib/setups.ts`: a playbook setup's "Entry checklist" read as tickable steps (one per line), the `n of N` score for a trade, and the label lookup. No new field — the checklist text IS the model definition. `checklistLines()` also returns the lines that read like a step but can't be tokenized, so the playbook can flag them instead of dropping them silently.
- `components/RunSetupBar.tsx`: the way into the pre-trade gate — one chip per setup that has a checklist, shown under the quick log on Today and `/trades/new`.
- `components/TradeSetupFields.tsx`: the "Setup & execution" controls — playbook setup chips, timeframes used, mechanisms in the entry, and the linked setup's checklist as tick chips. Shared by the trade page fold and the `/trades` inline review (inside that row's existing form).
- `lib/notes.ts`: the `/notes` filter — category (one per note) × tags (many) × free text in the search grammar. Pure functions over the note list, no store access.
- `lib/transcript-processor.ts`: one Claude call per captured note (official SDK; the shape is taught by the prompt and enforced by parseJsonLoose + normalizeExtraction, not by a JSON schema — see CLAUDE.md) returning an array of typed entries; single-FREE_NOTE fallback when the AI is off, unkeyed, or erroring — the reason always rides along.
- `lib/ai-status.ts`: turns a thrown Anthropic error into an actionable sentence, and backs the `/settings` "Test AI connection" check. Every AI path reads its model from `activeModel()`.
- `lib/extraction.ts`: the entry vocabulary — kinds, per-kind fields, the tolerant normalizer used on both the model response and every read of a saved draft.
- `lib/extraction-context.ts`: the ~300-token trader-context block (open trades, tracked assets, recent instruments, active setups) + open-trade handle resolution.
- `lib/market-context.ts`: the SignalDesk bridge — fetches the market snapshot for a trade's entry and returns null on any failure. Design record lives in the other repo: `signaldesk/TRADEGENIE_BRIDGE.md`.
- `scripts/eval-capture.ts` / `tests/fixtures/capture/`: `npm run eval:capture` scores the capture pipeline against 15 realistic messy notes.

## Product Areas

- `/`: Today — daily-ritual dashboard (check-in / quick log / evening review states, streak, week strip, coach's corner) + the one-line quick-note bar
- `/calendar`: day/week/month activity view
- `/inbox`: Capture — hero paste box + review queue; one note splits into typed entries, one editable/removable card each, all other actions behind a "More" fold
- `/daily`: two-ritual page — morning check-in (chips + guardrails) and evening review (prompted micro-form), plus that day's quick notes
- `/notes`: every quick note, filterable — category chips × tag chips × text box (search grammar), day-grouped, with a composer on top; filters are links, so every view is a real URL
- `/trades`: day-grouped journal rows (day P&L headers, direction/status chips, mistake badges); quick symbol/date filter row, advanced filters folded
- `/trades/new`: chip-based 30-second quick log (`components/QuickTradeForm.tsx`, shared with Today)
- `/playbook/[id]/run`: the pre-trade gate — tick the model's steps, then log the trade with the setup, steps, timeframes and mechanisms already on it. Live `n of N` is a pure-CSS counter (`.checklist-gate` in `globals.css`); it warns on a missing step but never blocks the trade.
- `/trades/[id]`: review-first trade page — one-minute close & review panel on top, then "Setup & execution" (setup / timeframes / mechanisms / model checklist), full editor collapsed below
- `/assets`, `/assets/[id]`: per-asset tracker — living thesis/levels page + running note thread (composer has an optional AI "Structure" tidy pass)
- `/lessons`: lesson bank
- `/import`: CSV import and raw execution linking
- `/weekly-review`: generated/saved weekly reviews
- `/calculator`: pre-trade profitability scratchpad — net-of-fees R, break-even price, required win rate, position size (nothing is saved)
- `/settings`: AI status + connection test, custom labels, and the single capture prompt template
- `/search`: global search — one box over every collection (words = AND substring, `#tags` = exact), type filter tabs, highlighted anchored snippets; empty state doubles as the browsable tag index

## UX Principles

- Optimize for personal daily use, not SaaS scale.
- Keep default screens compact and low-noise.
- Use collapsible advanced sections for heavy fields.
- Voice notes should remain prominent and review-before-confirm.
- Manual input is for thesis, emotion, mistakes, lessons, reflections, and playbook development.
- Objective data should come from CSV import where possible, with manual fallback.
- Prefer short workflows:
  - daily check-in under 60 seconds
  - quick trade note under 30 seconds
  - transcript paste/save under 20 seconds
  - EOD review in 2-4 minutes

## Current Interaction Patterns

- Main lists use saved views, filters/sorting drawers, pagination, and calendar ranges where relevant.
- Trades list is compact by default:
  - single-click row: expand inline detail
  - double-click row: open trade detail/edit page
  - pencil icon: open detail/edit page
  - bin icon: delete
- Inbox splits a note into typed entries on save and shows one editable card per entry (each removable before confirming); confirming writes every remaining entry — with spoken numbers — and stays on the inbox. An exit entry only ever updates an existing trade. Default view is "To review".
- Top nav is lean: primary = Today / Capture / Trades / Review; everything else sits under a "More" dropdown.
- Preset pill rows are extendable, not closed: type a label into the row's box and it is stored with the record and added to that pill vocabulary for next time (`lib/options.ts`). Review/remove them under Settings → "Your own labels". Fields the maths depends on (direction, status, grade, followed-plan, discipline) are deliberately NOT extendable.
- Lessons and Import use compact default rows with full details/actions hidden behind expandable controls.
- Trade detail starts with a compact summary and organizes editing fields into collapsible sections.
- Calendar filtering uses `period=day|week|month` and `date=yyyy-MM-dd`.

## Commands

Run from repo root:

```bash
npm run dev
npm run lint
npm run typecheck
npm run build
npm run seed
npm run test           # unit tests (node:test via tsx) — calculator, tags, search, options, store
npm run smoke          # build first, then: starts the app and asserts every route renders 200
npm run eval:capture   # capture extraction eval (needs ANTHROPIC_API_KEY to be meaningful)
```

Before saying work is done, run at least:

```bash
npm run lint
npm run typecheck
npm run build
```

For UI changes, also smoke-check the affected route on the local dev server.

## Deployment Workflow

- User intends future updates to be committed by Codex and deployed to Vercel after the Vercel project is set up.
- Expected release flow:
  1. Implement locally.
  2. Run lint, typecheck, build, and route smoke checks.
  3. Commit intentionally.
  4. Push to GitHub.
  5. Verify Vercel deployment.
- Do not deploy or push without an explicit user request for that change.

## Immediate Backlog

Use `PENDING_TASKS.md` as the backlog. Current recommended sequence:

1. Vercel production-branch permanent fix.
2. Today workspace / dashboard refinement.
3. Trade lifecycle prompts (unfinished-loop nudges).

## SignalDesk Bridge (Phase A)

- When a trade is saved, `captureMarketContext()` asks SignalDesk what the
  market looked like at that moment and freezes the answer onto the trade as
  `Trade.marketContext`. Shown read-only on `/trades/[id]`; never recomputed.
- **It is never load-bearing.** 2-second timeout, every failure returns null,
  the trade saves regardless. If a change could make a trade save fail because
  SignalDesk is down, the change is wrong.
- Off until `SIGNALDESK_SNAPSHOT_URL` + `SIGNALDESK_SNAPSHOT_TOKEN` are set —
  no network call, nothing slower.
- The context is keyed to the briefing slot in effect **at or before** the
  entry (SignalDesk publishes 07:00/19:00 IST). That comparison lives in
  SignalDesk; TradeGenie sends the trade's timestamp and never computes a slot.
- Full design + reasoning: `signaldesk/TRADEGENIE_BRIDGE.md`. Backfill and any
  analysis over the captured context are Phase B and not built.

## Known Risks / Gotchas

- Firestore is configured and confirmed durable in production (service account); local JSON is the dev-only fallback. `storageStatus()` in `lib/store.ts` is the source of truth.
- Vercel serverless filesystem is not durable, so local JSON and local upload fallback are not production-safe.
- Firebase Admin/server libraries bypass Firestore security rules; protect service account credentials and use least-privilege IAM where practical.
- No auth is planned for MVP, so production deployment should be treated as private/personal access unless auth is later added.
- Avoid exchange API sync, real-time signals, screenshot AI parsing, strategy recommendations, and automated trading features in MVP.

## Agent Working Rules

- Start by reading this file, then only the specific files needed for the task.
- Preserve the existing low-friction product philosophy.
- Prefer small, scoped changes over broad rewrites.
- Do not revert user changes or unrelated dirty work.
- Keep durable context in `AGENTS.md`, `PENDING_TASKS.md`, or README instead of relying on chat memory.
- Update this file when architecture, deployment, storage, or major interaction patterns change.
