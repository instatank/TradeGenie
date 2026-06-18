# CLAUDE.md

Working guide for Claude Code on **TradeGenie** (tagline: "magic journal"). Keep it short and current.
Update it when architecture, lean defaults, the working contract, or open items change.

## Source of truth (read in this order)
1. **`PROJECT_BRIEF.md`** — the owner's vision, friction budgets, lean defaults, non-goals.
   **This wins all conflicts.** When unsure, optimize for its goals, not feature completeness.
2. **`AGENTS.md`** — stack, file map, product areas, commands, deployment workflow.
3. **`PENDING_TASKS.md`** — backlog.
4. This file — the working contract + a log of decisions made during active development.

Don't duplicate the stack/file/route lists here; they live in `AGENTS.md`.

## Who this is for (one line)
One non-technical discretionary crypto-perp trader. A personal daily-habit journal — not a
product. No multi-user, auth, payments, broker sync, signals, or financial advice, ever.

## Working contract (non-negotiable)
- **`main` is the single working branch _and_ the Vercel production branch.** Commit work
  directly to `main`; there is no separate `claude/*` feature branch anymore. (Old policy:
  develop on a feature branch and leave `main` untouched — that has been retired by the owner.)
- **A push to `main` auto-deploys to production.** So: only push when asked, and never push a
  red build. Always run `typecheck` + `lint` + `build` (build/route smoke-check for UI) and
  report failures honestly *before* pushing. If a deploy misbehaves, `git revert` + push to
  roll back fast — Vercel keeps the last good build if a new one fails to build.
- **Never push to GitHub (i.e. deploy) without an explicit ask for that change.** Local
  commits to `main` are fine; the push is the gated step.
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

## Navigation (lean header)
- Primary nav = the daily loop only: **Today · Capture · Trades · Review** (`primaryNavItems`).
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
  4-item daily loop + "More" dropdown.
- Rewrote + re-routed the extraction prompts (see above).
- Swapped the transcript backend from OpenAI to the Anthropic SDK with structured outputs
  (`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`); prompts carried over unchanged.

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
