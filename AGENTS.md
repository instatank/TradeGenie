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
- Do not commit secrets, service account JSON, `.env`, `.env.local`, or local data exports.
- Screenshot uploads use Firebase Storage when Firebase is configured; local disk under `public/uploads` is only a development fallback.

## Important Files

- `README.md`: setup, Firebase/Vercel notes, project overview.
- `PENDING_TASKS.md`: ongoing backlog and recommended next sequence.
- `app/actions.ts`: server actions for creates, updates, deletes, transcript processing, weekly review generation.
- `lib/types.ts`: app data model types.
- `lib/store.ts`: persistence adapter.
- `lib/data.ts`: higher-level data fetch helpers.
- `lib/metrics.ts`: P&L, R, win rate, expectancy, weekly stats, frequency helpers.
- `lib/transcript-processor.ts`: Anthropic-or-mock transcript structuring (Claude via the official SDK with structured outputs; regex mock fallback when no key).

## Product Areas

- `/`: Today — daily-ritual dashboard (check-in / quick log / evening review states, streak, week strip, coach's corner)
- `/calendar`: day/week/month activity view
- `/inbox`: Capture — hero paste box + review queue; confirm-first note cards, all other actions behind a "More" fold
- `/daily`: two-ritual page — morning check-in (chips + guardrails) and evening review (prompted micro-form)
- `/trades`: day-grouped journal rows (day P&L headers, direction/status chips, mistake badges); quick symbol/date filter row, advanced filters folded
- `/trades/new`: chip-based 30-second quick log (`components/QuickTradeForm.tsx`, shared with Today)
- `/trades/[id]`: review-first trade page — one-minute close & review panel on top, full editor collapsed below
- `/lessons`: lesson bank
- `/import`: CSV import and raw execution linking
- `/weekly-review`: generated/saved weekly reviews
- `/settings`: AI settings and prompt templates
- `/search`: global search

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
- Inbox auto-structures a note on save and shows one editable, type-aware review card; confirming writes the record (with spoken numbers) and stays on the inbox. Default view is "To review".
- Top nav is lean: primary = Today / Capture / Trades / Review; everything else sits under a "More" dropdown.
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
