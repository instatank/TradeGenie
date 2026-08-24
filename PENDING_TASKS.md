# Pending Tasks

Working backlog for TradeGenie, ordered by practical benefit for daily use.
For the working contract and a log of *why* things were built the way they were, see `CLAUDE.md`;
for the file map and routes, `AGENTS.md`. This file is the owner's roadmap — an agent updates it
to match reality, and doesn't promote itself off it.

Last reconciled: 2026-08-24.

## Shipped (short list — the reasoning lives in CLAUDE.md's decisions log)
- **Durable persistence + backup** — Firestore, fail-loud on partial config, `/api/export`, storage banner.
- **Lean defaults & analytics re-scope** — trimmed vocabularies, "What's hurting me" up top, heavy tables folded.
- **Capture pipeline** — one Anthropic call per note returning an array of typed entries, per-entry
  review cards, exits that can't duplicate a trade, `npm run eval:capture` + 15 fixtures.
- **Tagging, indexing, search** — one tokenizer, stored `tags[]` everywhere, unified index, `#tag`/word grammar.
- **Tag picker + custom pill labels** — the vocabularies are the trader's, extendable by typing.
- **Daily loop, trades and capture UX** — Today ritual, day-grouped trade journal with inline review,
  one-button-saves-the-page, hero paste box.
- **Profitability calculator** — net-of-fees R, solved break-even, fee-aware sizing.
- **SignalDesk bridge (Phase A)** — frozen market snapshot stapled to a trade at entry.
- **Site password gate** — one env var, one cookie, off until configured.
- **Page-load latency** — loading skeleton, request read cache, Firestore REST, one revalidation,
  functions pinned to `bom1` beside the Delhi database.
- **Tests** — `npm run test` (unit) + `npm run smoke` (every route renders, dynamic ids included).
- **Quick notes → `/notes`** — categories, tag pickers with asset shortcuts, day-grouped filter page.
- **Setup & execution on trades** — timeframes, mechanisms, the playbook checklist as tickable steps.
- **Pre-trade gate** — `/playbook/[id]/run`: tick the model *before* the trade, log it fully tagged.
- **Small-sample honesty** — `MIN_SAMPLE`; grouped tables grey out and refuse to colour a verdict.
- **Closing the loop** — the skipped-step leak, morning "one thing to practice", saved views,
  tag retirement, `/mechanisms`.

## Needs the owner, not an agent
1. **Split the prose checklists.** *Range reclaim*, *Failed breakout* and *Momentum pullback* each hold
   their checklist as one long line, so they parse to zero steps: they can't be run as a pre-trade gate
   and contribute nothing to the skipped-step analysis. One step per line in `/playbook` fixes it.
   (The playbook now flags a line that's too long to tick.)

## Open — next up
1. **Trade lifecycle prompts** — nudge unfinished loops (CLOSED without exit review, mistake without
   lesson, transcript structured but unconfirmed).
2. **Needs-cleanup view** — missing thesis/invalidation, closed-without-P&L, unlinked execution.
3. **Quick Add** — persistent button/shortcut for voice note, quick trade, EOD, manual lesson.
4. **AI-filled mechanisms/timeframes from a voice note** — "I took the FVG on the 5-minute" is exactly
   what gets dictated. A prompt + eval change of its own; run `npm run eval:capture` before and after.
5. **Custom labels in the capture review card** — it still offers the *closed* mind-state and
   risk-posture lists, because `normalizeEntry` validates entries against the closed enum. Reconciling
   enum discipline with the extendable vocabulary is its own piece of work (known gap, see CLAUDE.md).

## Later
- **Mistake review page** — frequency over time, examples, linked trades, prevention rule.
- **Lesson bank** — lessons-linked-to-mistake/setup views (pinned + active/archived exist).
- **Execution linking** — suggest matches by instrument/date, bulk link, totals by selection.
- **Screenshot management** — thumbnails, captions, delete/replace (no AI parsing).
- **Mobile polish** — paste voice note, quick trade, daily, EOD.
- **CSV import templates** — saved column mappings per source (Binance, Bybit, broker, manual).
- **Light keyboard shortcuts** — `/` search, `n` new trade, `v` voice, `d` daily, `e` EOD.
- **Weekly review generator** — the numbers-only synthesis could use the narrative fields a
  `WEEKLY_REFLECTION` capture now provides.
- **Performance at size** — full-collection scans with no `where`/`limit` are irrelevant at 5 trades
  and not at 1000; a save is also two round trips because every action `redirect()`s.
