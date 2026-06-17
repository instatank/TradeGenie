# Pending Tasks

Working backlog for TradeForge Journal, ordered by practical benefit for daily use.
For the working contract and a log of what changed, see `CLAUDE.md`.

## Recently completed
- **Durable persistence** — Firestore wired for dev + Vercel; fail-loud on partial config.
- **Backup/export** — one-click full JSON export at `/api/export`; storage banner on `/settings`.
- **Compact expandable rows** — Inbox, Lessons, Import.
- **Trade detail cleanup** — compact summary + collapsible sections.
- **Voice-note confirmation flow** — single "Review this draft before saving" card with
  destination, fields, missing-info/link callouts, color-coded confidence, inline confirm.
- **Lean defaults** — mind state (6), mistake tags (9 + "More"), lesson categories (5),
  quick-trade form trimmed; "exhaustive but lean" advanced-panel pattern.
- **Analytics re-scope** — "What's hurting me" summary up top; heavy tables behind an
  "Advanced analytics" toggle.
- **Transcript prompts** — per-type routing, enum-constrained templates, system-injected
  live mistake-tag list, prompt-template version gate.
- **Anthropic transcript backend** — swapped from OpenAI to the Anthropic SDK with structured
  outputs (`ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL`, default `claude-sonnet-4-6`).

## In progress / next up
1. **Vercel production branch** permanent fix (currently pinned via manual "Promote"; configured
   branch is still `main`).
2. **Today workspace** — focused Today panel (check-in status, open trades, notes, EOD status).
3. **Trade lifecycle prompts** — nudge unfinished loops (CLOSED without exit review, mistake
   without lesson, transcript structured but unconfirmed, etc.).
4. **Quick Add** — persistent button/shortcut for voice note, quick trade, EOD, manual lesson.

## Later
- **Weekly review**: extraction schema strips weekly-only fields on the inbox path — enrich
  schema + confirm flow if weekly voice notes should capture them; upgrade the generated review.
- **Mistake review page** — frequency over time, examples, linked trades, prevention rule.
- **Execution linking** — suggest matches by instrument/date, bulk link, totals by selection.
- **Lesson bank** — lessons-linked-to-mistake/setup views (pinned + active/archived exist).
- **Screenshot management** — thumbnails, captions, delete/replace (no AI parsing).
- **Mobile polish** — paste voice note, quick trade, daily, EOD.
- **CSV import templates** — saved column mappings per source (Binance, Bybit, broker, manual).
- **Needs-cleanup view** — missing thesis/invalidation, closed-without-P&L, unlinked execution.
- **Performance** — avoid loading every collection everywhere as data grows.
- **Light keyboard shortcuts** — `/` search, `n` new trade, `v` voice, `d` daily, `e` EOD.
