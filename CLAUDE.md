# CLAUDE.md

Working guide for Claude Code on **TradeForge Journal**. Keep it short and current.
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
- **Never push to GitHub or deploy to Vercel without an explicit ask for that change.**
- **Leave `main` untouched.** Develop on the designated `claude/*` feature branch
  (currently `claude/nifty-meitner-mwr75f`). Create it locally if missing.
- **Don't revert the owner's changes or unrelated dirty work.**
- Small, scoped changes, one concern at a time. No broad rewrites unless asked.
- When something is a real tradeoff or changes the daily workflow, **stop and ask in plain
  English** — don't quietly decide. Default bias: if a thing doesn't earn its place for a
  solo beginner, leave it out and flag it.
- Before calling work done: `npm run typecheck` and `npm run lint` (build/route smoke-check
  for UI changes). Report failures honestly.

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

## Transcript → AI structuring
- `lib/prompts.ts`: per-type templates (field spec + enum values + null rule + JSON example).
  Correctness-critical instruction (rules, emotion mapping, **live mistake-tag list from the
  store**) lives in the code-built system prompt so stale saved templates can't break it.
- `lib/transcript-processor.ts`: routes each note to ONE prompt by declared type; UNKNOWN uses
  a classify-first general prompt. Falls back to a regex mock when no AI key.
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
- Rewrote + re-routed the extraction prompts (see above).

## Open items
- **OpenAI → Anthropic** transcript backend swap (owner runs on Anthropic). Prompt content
  carries over; the change is transport (Anthropic structured output / tool use vs OpenAI
  `response_format: json_object`). Pull current Anthropic API specifics at implementation time.
- **Vercel production branch (permanent fix)**: production is currently pinned via a manual
  "Promote to Production"; the configured Production Branch is still `main`, so a future `main`
  push would override it. Resolve by merging the durability/lean work into `main` OR flipping
  the Production Branch — owner's call.
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
