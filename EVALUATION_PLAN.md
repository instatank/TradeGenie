# TradeGenie — Evaluation & Foundation Plan

Author: Claude Code (evaluation pass). Status: proposal for owner review.
Source-of-truth precedence still applies: `PROJECT_BRIEF.md` wins all conflicts. Nothing here
overrides the friction budgets or the "subtraction beats addition" rule — every suggestion below
is filtered through "does this earn its place for a solo beginner?"

This document has two halves, matching the two asks:
- **Part A — Make it a strong foundation**: honest evaluation, a testing strategy, the concrete
  bugs/risks found, and a phased roadmap to get there.
- **Part B — Make it maximally useful**: product/UX/feature suggestions for a sustainable,
  low-friction learning + trading + review loop, each with the minimalism trade-off called out.

---

## Part A — Foundation: evaluation, testing & fixes

### A0. Current health (measured, not assumed)
Ran the full gate on this branch:

| Check | Result |
|---|---|
| `tsc --noEmit` (typecheck) | ✅ clean |
| `eslint .` (lint) | ✅ clean |
| `next build` | ✅ clean, 18/18 routes build |
| Automated tests | ❌ **none exist; no test framework installed** |
| CI | ❌ none (no GitHub Actions) |

**Verdict.** The code is in good shape for something an agent built: the architecture is clean,
the storage abstraction is sound, `lib/metrics.ts` is genuinely well-written pure logic, and the
build is green. The foundation gap is **not** code quality — it's that **nothing proves the
numbers are right or stays right as the app changes.** For a journal whose whole promise is
"capture both numeric and subjective data and trust it," untested P&L/R math and an untested
AI-extraction path are the real risk. That's where the foundation work goes.

### A1. Architecture map (what evaluation has to cover)
Four layers, in rising order of risk:

1. **Pure calculation** — `lib/metrics.ts` (P&L, R-multiple, win rate, expectancy, process
   score, exit efficiency, funding drag, leak detection), `lib/calendar.ts`. No I/O, fully
   deterministic. **Easiest to test, highest value-per-test.** This is where correctness lives.
2. **Data transformation** — `lib/transcript-processor.ts` (the regex `mockExtraction`),
   `lib/asset-note-structurer.ts`, the `createTradeFromStructured` / `readReviewOverrides` /
   `linkSuggestedMistakes` helpers in `app/actions.ts`. Pure-ish, deterministic, **high risk
   because this is where a voice note becomes a trade record.**
3. **Persistence** — `lib/store.ts` (Firestore | local-JSON adapter), `lib/data.ts`,
   `lib/settings-store.ts`. Side-effectful; the durability guarantees live here.
4. **AI extraction** — the Anthropic call in `transcript-processor.ts`. Non-deterministic,
   external, costs money, and **can silently regress when a prompt changes.** Needs an *eval*
   harness, not a pass/fail unit test.

Plus the UI/server-action surface (`app/**`), which is best covered by a thin end-to-end smoke
test of the daily loop rather than exhaustive component tests.

### A2. Testing strategy by layer (the recommendation)

**Tooling:** add **Vitest** (fast, TS-native, zero-config with this stack) for unit/integration,
and **Playwright** for one end-to-end smoke of the daily loop. Keep it lean — this is a personal
app; the goal is confidence, not coverage theater. No component-snapshot sprawl.

#### Tier 1 — Unit tests for pure logic (do first; highest ROI)
Target `lib/metrics.ts` exhaustively. These are the numbers you'll make decisions on.
Concrete cases that must be locked down:
- `calculateRMultiple`: LONG win, LONG loss, SHORT win, SHORT loss, zero-risk (stop == entry →
  null), UNKNOWN direction → null, missing prices → null.
- `calculateNetPnl`: fees subtract, funding adds, all-null → null, partial nulls.
- `getTradePnl`: prefers stored `netPnl`, falls back to computed.
- `calculateWinRate` / `expectancy` / `profitFactor`: empty set → null, all-wins (no losses →
  profit factor handling), all-losses, mixed; only CLOSED with P&L counts.
- `tradeProcessScore`: the beginner's real KPI — verify the 40/20/20/20 weighting, that an
  A-grade losing trade can outscore a winning trade with mistakes, NA/un-reviewed → null.
- `exitEfficiency`: capped/uncapped, SHORT vs LONG, favorable<=0 → null.
- `fundingSummary` / `analyticsLeaks`: the 15%/10% funding thresholds, the "most repeated
  mistake" 40%-share trigger, the worst-setup/worst-condition selection, and the "nothing is
  hurting you" empty state. These strings are coaching the owner — they must fire on the right
  data and not lie.
- `sessionForDate`: UTC bucket boundaries (07:59 ASIA, 08:00 EU, etc.).

#### Tier 2 — Integration tests for the capture→record pipeline (do second; highest *risk*)
Drive the real server actions against the **local-JSON store with a temp data dir** (the store
already supports this with no Firebase env). This tests the actual write path end-to-end without
mocks. Golden flows:
- Voice trade-entry note → `saveTranscriptAction` → `confirmTranscriptAction` → assert a Trade
  row exists with the right instrument/direction/prices and the mistake-tag links are created.
- Trade-exit review on a linked trade → status CLOSED, exit price/P&L written, `netPnl` and
  `rMultiple` recomputed from the *existing* entry/stop.
- EOD review → upserts exactly one `dailyJournal` for the day (run twice, assert no duplicate).
- `readReviewOverrides`: on-screen edits win over the AI draft (the core trust promise — "AI is
  always shown for review before it's saved").
- Spoken-numbers path: `mockExtraction.extractNumbers` captures entry/stop/target/exit/PnL/
  leverage from realistic sentences; "only if actually stated, never invent" holds (no number in
  text → null, not a hallucinated 0).

#### Tier 3 — AI extraction *eval* harness (do third; unique to this app)
Unit tests can't assert on a live LLM, but **regressions in extraction quality are exactly what
will quietly erode trust.** Build a small golden-set evaluator, runnable on demand (not in the
fast test loop, since it costs tokens):
- A folder of ~15–25 real-style transcripts (entry notes, exit reviews, EOD, weekly, messy
  rambling, multi-trade, "I didn't trade today") paired with expected key fields.
- A runner (`npm run eval:extraction`) that calls `structureTranscript` and scores: did it pick
  the right `transcriptType`, the right instrument/direction, capture stated numbers, NOT invent
  unstated ones, and map emotion to the lean-6 vocabulary. Report a score + diffs.
- This becomes the safety net for every prompt edit and every model bump (e.g. sonnet-4-6 →
  newer). Run it before changing `lib/prompts.ts` or `ANTHROPIC_MODEL`.
- Bonus: assert the **mock fallback and the real model agree on type/instrument/direction** for
  the simple cases, so the no-API-key dev experience doesn't diverge from production.

#### Tier 4 — One end-to-end smoke (do fourth; cheap insurance)
A single Playwright script over the **daily loop** against `next dev` + local store: open Capture
→ paste a note → see the review card → confirm → see it in Trades → open Today and see it
reflected. This catches the "whole thing is broken" class of failure that unit tests miss. Keep
it to **one happy-path flow**, not a suite.

#### Tier 5 — Durability tests (do alongside Tier 2)
`lib/store.ts` is the data-safety contract; test it directly:
- `storageStatus()` returns `firestore` for full creds, `local` for none, **`invalid` for a
  partial set** (the fail-loud guarantee — the most important one).
- `usesFirebase()` throws on partial config.
- Round-trip `dehydrate`/`hydrate`: Dates survive a write→read cycle as Dates (the `shouldBeDate`
  key heuristic), nested arrays/objects preserved.
- `/api/export` returns every collection (the backup promise).

### A3. Concrete issues found during this pass
Ordered by impact. None are "the build is broken"; they're the things that bite a single user
over time.

1. **No tests / no CI (foundation gap).** Covered above. Add Vitest + a GitHub Action that runs
   `typecheck + lint + build + test` on push. Even solo, CI is the thing that stops a bad deploy
   to your production journal.
2. **Exit-review can spawn a phantom trade.** In `confirmTranscriptAction`, the create-trade
   branch fires when `structured.instrument && !linkedTradeId && type !== "EOD_REVIEW"`. A
   `TRADE_EXIT_REVIEW` that was never linked to an entry (common when you journal the exit but
   skipped the entry note) will **create a brand-new trade instead of being treated as an exit.**
   Worth a guard + a test. *(Verify against your real usage before "fixing" — it may be
   intentional fallback, but today it's silent.)*
3. **AI failure is silent.** `structureTranscript` catches any Anthropic error and falls back to
   the regex mock with no signal. You could get a visibly worse extraction and not know the API
   key expired / model call failed. Surface a small "structured offline (basic mode)" badge on
   the review card so trust stays honest.
4. **No backup cadence.** `/api/export` exists but is manual. A single Firestore project with no
   scheduled backup is one fat-finger from data loss. Recommend a weekly export — and you have a
   **Google Drive integration available**, so this can be automated to drop a dated JSON into a
   Drive folder. (See Part B.)
5. **No access control on a personal journal.** `PROJECT_BRIEF` defers auth, and that's fine —
   but a deployed URL with your trading psychology on it is public if discovered. Lowest-friction
   fix: **Vercel password protection** (one env-level setting, no code). Flagging, not
   prescribing.
6. **Read-amplification as data grows.** `getTradeDetail` issues 7 full-collection reads;
   most data helpers `listRecords` an entire collection and filter in memory. Fine at hundreds of
   trades, not free forever on Firestore (latency + cost). Already in your backlog ("avoid
   loading every collection everywhere") — keep it there; it's a *later* item, not urgent.
7. **Dead/duplicated enum vocab.** `lib/types.ts` still exports the full 11-value `EmotionalState`
   / 9-value `CurrentState` while the UI uses `mindStateOptions` (6). That's intentional per the
   "exhaustive but lean" pattern (old values still `humanize()`), so **not a bug** — but a test
   should assert old stored values still render, so a future cleanup can't silently break history.

### A4. Phased roadmap (foundation)
Sequenced so each phase is independently shippable and green.

- **Phase 0 — Harness (½ day).** Add Vitest + scripts (`test`, `test:watch`), a `tests/` dir, and
  a GitHub Action running the full gate. No behavior change. *Ship.*
- **Phase 1 — Lock the math (1 day).** Tier 1 unit tests for `lib/metrics.ts`. This is the
  highest-confidence-per-hour work. Any bug found here is a number you were about to trust.
- **Phase 2 — Lock the pipeline (1–2 days).** Tier 2 + Tier 5: capture→record integration tests
  on the local store, plus durability tests. Fix issue #2 (phantom trade) with a regression test.
- **Phase 3 — AI safety net (1 day).** Tier 3 extraction eval harness + golden set. Add the
  "basic mode" badge (issue #3).
- **Phase 4 — One E2E + backup automation (1 day).** Tier 4 Playwright daily-loop smoke; wire the
  weekly export-to-Drive backup (issue #4).

After Phase 0–1 you already have a *strong* foundation; 2–4 make it durable and trustworthy.

---

## Part B — Usefulness: product, UX & features

Framing: your stated goal is **a sustainable habit that compounds learning**, not a complete
database. So the lens for every idea below is: *does it make the daily loop more likely to happen,
or make the review more likely to change behavior?* If it does neither, it's cut or deferred.
I've tagged each block with a verdict: **DO NOW / SOON / LATER / SKIP**, and called out the
minimalism trade-off explicitly.

### B1. The core insight: you already have the right metric — surface it harder
The app already computes `tradeProcessScore` and `averageProcessScore` — "did I follow my own
rules, independent of P&L." **For a beginner, this is *the* number**, and it's currently buried in
analytics. P&L is noise at your stage; process is signal.

- **DO NOW:** Put **process score (this week) front-and-center on `/` (Today)** as the hero
  number, with P&L secondary and visually smaller. This quietly retrains you to optimize the
  thing you control. Trade-off: none — it's reordering, not adding.
- **SOON:** On every confirmed trade, show its process score with the one missing component
  ("A-grade entry but no invalidation written" → +20 available). Turns scoring into a nudge.

### B2. Close the loops (the highest-value feature you don't have yet)
A journal's learning only compounds if loops *close*: entry → exit → lesson. Right now nothing
chases an open loop. This is already backlog item #3 and I'd rank it the **single most valuable
product addition.**

- **DO NOW — "Needs attention" strip on Today.** A small, dismissible list of open loops:
  - OPEN trades with no exit review (the position you forgot to journal closing).
  - CLOSED trades with no P&L (the number you'll want at weekly review).
  - Trades with a mistake tagged but no lesson written (the learning you almost captured).
  - Transcripts structured but never confirmed (drafts rotting in the inbox).
  Each is one tap to resolve. **This is the difference between a journal you trust and one with
  silent holes.** Trade-off: it adds a panel — but it *removes* future friction (you stop
  discovering gaps weeks later), so it earns its place. Keep it collapsed when empty.

### B3. Make the habit sustainable (the real risk is abandonment, not missing features)
Your own brief says "a journal I actually open daily beats a complete one I abandon." Protect the
habit directly:

- **DO NOW — gentle continuity, not gamification.** On Today, show "logged 4 of the last 7 days"
  and last-entry time. A quiet streak/consistency read, *not* badges/confetti. Trade-off:
  gamification can feel gimmicky and patronizing for a serious tool — so keep it to one honest
  line, no rewards, no nags. (If it ever feels like a Duolingo owl, cut it.)
- **SOON — capture must be mobile-first and instant.** Talking is your lowest-friction input
  (brief: "voice/transcript stays prominent"). Make `/inbox` paste-and-go perfect on a phone,
  large paste target, big confirm button. Consider a PWA "Add to Home Screen" so Capture is one
  tap from the lock screen. Trade-off: PWA polish is real work; do it only once the loop is
  proven, but it's the biggest sustainability lever after loop-closing.

### B4. Make review the moment learning compounds
EOD (2–4 min) and weekly are where a beginner actually improves. Strengthen the *output* of
review, not the input fields.

- **DO NOW — resurface lessons at decision time, not just in a bank.** You already have
  `getResurfacedLessons` (pinned + recent). Show 1–3 of them **on Capture and on Today**, where
  you're about to act — a lesson you can't see when deciding is dead weight (your own code comment
  says this). Trade-off: a little screen space for a lot of behavior change. Worth it.
- **SOON — weekly review that says one thing.** The generated weekly review should end with a
  single **"this week's one rule"** derived from your top recurring mistake/leak (the
  `analyticsLeaks` output is already perfect input). One rule you can hold beats a dashboard you
  skim. This directly uses logic you've already built.
- **LATER — mistake-over-time view** (backlog): frequency trend + the actual trades + the
  prevention rule you wrote. Only valuable once you have a few weeks of sample size.

### B5. Reduce capture friction further (you're close, tighten it)
- **SOON — Quick Add everywhere** (backlog #4): one persistent button → voice note / quick trade
  / EOD / lesson. The fewer taps to start, the more days you log. Trade-off: one floating button
  is low-noise; resist turning it into a menu of 8.
- **SOON — pre-trade checklist from your playbook, optional and one-tap.** Before logging an
  entry, an *optional* 3-item check ("is this my setup? is risk defined? am I calm?") that writes
  straight into the trade's invalidation/mind-state fields. This is process-building, not a form.
  Trade-off: mandatory checklists kill friction budgets — so it must be skippable and remembered
  as skipped, never blocking. Default off; offer it.
- **LATER — light keyboard shortcuts** (backlog): `n` new trade, `v` voice, `d` daily, `/` search.
  Desktop nicety; doesn't move the needle on the phone where the habit lives.

### B6. Quantitative analysis: keep it honest and lean
The analytics are already well-scoped ("What's hurting me" up top, heavy tables behind a toggle).
Don't gold-plate. Two targeted adds only:

- **SOON — expectancy in R with sample-size honesty.** You compute `expectancyR` and
  `sampleSize`; always show the n next to any stat and **grey out / caveat stats under ~20
  trades** ("too few trades to trust yet"). A beginner over-reading a 5-trade win rate is a real
  failure mode; the app should actively prevent it. Trade-off: none — it's a label, and it builds
  exactly the statistical humility a beginner needs.
- **LATER — equity/process curve over time** (one small chart): process score and cumulative R by
  week. One chart, not a dashboard. Only after there's data to plot.
- **SKIP (per brief, and I agree):** full charting, backtesting, broker sync, signals, screenshot
  parsing. These break the friction budget and the non-goals. Don't.

### B7. Qualitative analysis: this is your edge — lean into the words
The subjective data (thesis, emotion, mistakes, lessons) is what makes this *your* journal and not
a spreadsheet. The AI is already extracting it; make it *reflect back*.

- **SOON — pattern callouts in plain language.** Extend `analyticsLeaks`-style insights to the
  qualitative side: "Your tilted trades lose 80% of the time" / "You only write invalidations on
  A-grade setups." You have `emotionalStateFrequency` and the data to do this. One honest sentence
  beats a heatmap. Trade-off: must be true and well-gated by sample size, or it erodes trust.
- **LATER — semantic search over your own history.** "What did I say last time BTC was at a major
  level?" You already store rich text per asset (`AssetNote`) and per trade. A simple search over
  it (the `/search` page exists) closes the "learn from my own history" goal. Keep it text search
  first; embeddings only if plain search proves insufficient.

### B8. Data trust = product feature (not just engineering)
Durability is in your brief as the top technical concern, and the storage banner already
communicates it. Make trust *visible and effortless*:
- **DO NOW — one-tap "Back up now" on Settings** that triggers `/api/export` and, if you want,
  drops it to Google Drive automatically (integration is available). Seeing a recent dated backup
  is what makes a journal feel safe enough to depend on. Trade-off: tiny build cost, large
  peace-of-mind return — and it's the thing your brief explicitly flagged as non-negotiable.

### B9. The trade-off summary (features vs. minimalism)
Your instinct — subtraction beats addition — is correct and I'm not going to fight it. The
discipline I'd hold: **the app should grow in *intelligence* (better nudges, better reflection,
loop-closing), not in *surface area* (more fields, more pages, more options).** Concretely:
- Almost everything in Part B is *reordering existing data* or *one small panel*, not new
  data-entry burden. That's deliberate.
- The two genuinely new behaviors I'd fight for: **loop-closing nudges (B2)** and **lessons
  resurfaced at decision time (B4)**. Those change outcomes.
- Everything tagged LATER stays in `PENDING_TASKS.md` until the daily loop is proven sticky.
- Everything tagged SKIP stays skipped. The non-goals list is a feature, not a limitation.

### B10. Suggested product sequence (after the foundation phases)
1. Process score as Today's hero + sample-size honesty (B1, B6) — pure reorder, high impact.
2. "Needs attention" loop-closing strip (B2) — the highest-value new behavior.
3. Lessons resurfaced on Capture/Today + "one rule" weekly review (B4) — compounding learning.
4. One-tap backup to Drive + "basic mode" AI badge (B8, A3#3) — trust made visible.
5. Quick Add + mobile/PWA capture polish (B5, B3) — sustainability.
6. Optional pre-trade checklist, qualitative pattern callouts (B5, B7) — process depth.

---

## How I'd start (concrete next step)
With your go-ahead I'll execute **Foundation Phase 0 + 1** in one pass: add Vitest + a CI workflow,
write the `lib/metrics.ts` unit suite, and report anything the tests turn up — all on the feature
branch, nothing deployed. That alone converts "looks fine" into "provably correct on the numbers
you trade on." Then we pick the first Part B item together.
