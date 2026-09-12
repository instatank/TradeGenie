# Build sessions — prompts to hand to a fresh agent

One session per row. Copy the whole block into a **new Claude Code cloud session** and send it.
Run them in order; each one's done-check is the next one's foundation. Do not run two at once
against the same repo.

The plan they all serve is `TRADING_ENGINE_ROADMAP.md` in this repo. Nothing here overrides it —
if a prompt and the roadmap disagree, the roadmap wins and the session should say so.

**Setup status:** the repository, the Firebase project and the Telegram bot are done
(12 Sep 2026). Vercel is connected at the end of session 1.1, not before.

---

## The shared header

Every prompt below already contains this. It is repeated here so you can see what each session is
told, and so you can paste it in front of an ad-hoc request later.

> You are building **TradeBot**, a separate trading-support app for one non-technical beginner
> trader of large-cap crypto perpetuals (BTC, ETH, SOL, plus HYPE, ZEC and VVV watched only).
> The full plan is `TRADING_ENGINE_ROADMAP.md` on `main` in `instatank/tradegenie`.
> **Read it before doing anything** —
> sections 1, 4, 5, 6 and 10 at minimum. Section 10 lists decisions you must not reverse; if you
> think one is wrong, say so and stop rather than quietly changing it.
>
> Repos: build in `instatank/tradebot` on `main`; read `instatank/tradegenie` for the roadmap and
> for code to port. Attach whichever is missing with `add_repo`.
>
> The owner has no local machine and no terminal — they work only in Claude Code cloud sessions.
> Every step they perform is a **browser step**: name the site, the menu and the button. Secrets
> live in Vercel environment variables and are never pasted into chat. Container egress is
> allow-listed, so an external host may fail as blocked rather than down — say which.
>
> Rules that hold in every session: **the bot never places a real order** (stages 1–3 place
> nothing at all); **detectors are causal only** — no function may read a candle later than the one
> being evaluated; **no language model in the detection path**; one concern per commit with the
> reasoning in the message; run the repo's own checks and never push a red build.

---

## Stage 1 — the markup bot

### Session 1.1 — Scaffold, candles, and a page that proves it works

```
You are building TradeBot, a separate trading-support app for one non-technical beginner trader
of large-cap crypto perpetuals (BTC, ETH, SOL, plus HYPE, ZEC and VVV watched only). The full
plan is TRADING_ENGINE_ROADMAP.md on main in instatank/tradegenie. Read it before doing
anything — sections 1, 4, 5, 6 and 10 at minimum. Section 10 lists decisions you must not reverse; if you
think one is wrong, say so and stop rather than quietly changing it.

Repos: build in instatank/tradebot on main; read instatank/tradegenie for the roadmap and for
code to port. Attach whichever is missing with add_repo.

The owner has no local machine and no terminal — they work only in Claude Code cloud sessions.
Every step they perform is a browser step: name the site, the menu and the button. Secrets live
in Vercel environment variables and are never pasted into chat.

Rules that hold in every session: the bot never places a real order (stages 1-3 place nothing at
all); detectors are causal only; no language model in the detection path; one concern per commit
with the reasoning in the message; never push a red build.

THIS SESSION: scaffold the app and prove it can see the market from production.

Build:
- A Next.js + TypeScript app in instatank/tradebot, server-rendered, minimal dependencies. Follow
  the shape of instatank/signaldesk (zero client JS, plain fetch, no SDKs) rather than inventing
  a new one. Do not add a charting library, CCXT, or any bot framework.
- vercel.json pinning the region to sin1 (Binance is reachable from Singapore and this is
  already proven by SignalDesk) with a cron on /api/cron/tick every minute and a markup cron at
  "30 5,11 * * *" UTC.
- A Firestore client reading FIREBASE_SERVICE_ACCOUNT, with the same fail-loud behaviour as
  TradeGenie's lib/store.ts: a partial config throws rather than silently falling back.
- Port lib/candles.ts from TradeGenie, including its Bybit fallback and its fixture mode
  (TRADEGENIE_CANDLE_FIXTURE, renamed for this app). Add aggregation from 1m candles to
  5m/15m/1h/4h/1d — write it as a pure function with its own tests, because every later stage
  depends on it being right.
- /api/cron/tick: fetch recent 1m candles for the six symbols, write per-symbol freshness state
  to Firestore. Idempotent by candle open time — a doubled or late invocation must not double-write.
- A /health page: per symbol, the newest candle's time and age, the provider that served it, and
  the Vercel region the function ran in (VERCEL_REGION).
- The password gate ported from TradeGenie (lib/site-auth.ts + middleware.ts), off when
  SITE_PASSWORD is unset, with /api/cron/* exempt via CRON_SECRET.
- A CLAUDE.md for the new repo carrying the rules above, the roadmap's section 10 decisions, and
  the commands you add.
- npm scripts: typecheck, lint, build, test, and a smoke check that asserts the routes render.

Then give the owner the browser steps to import the repo into Vercel and set the environment
variables it needs, and wait for them to confirm before claiming anything about production.

Done when: on the production URL, /health shows all six symbols with 1-minute candles less than
two minutes old and names the region as sin1; the every-minute cron is visible running in Vercel's
logs; and typecheck, lint, build and test are all green. Report the actual candle ages you saw,
not that it "should work".
```

### Session 1.2 — The detectors, causal and tested

```
[shared header — same as 1.1]

THIS SESSION: build the pure detection library. No UI, no network, no Firestore — only functions
over candle arrays, and tests. This is the foundation every later stage runs on, live and in
backtests, so correctness here matters more than speed of delivery.

Read roadmap section 4.6 for the parameter defaults and section 3.2 for what is precisely
definable and what is not. Use the mechanism vocabulary and hints from TradeGenie's lib/options.ts
so a signal card and a journal chip say the same words.

Build, as pure functions with no I/O:
- ATR, and n-bar swing pivots (a pivot is only confirmed n bars after it prints).
- Market structure per timeframe: break of structure vs change of character, on closes.
- Dealing range from the last confirmed swings; equilibrium, premium and discount; the OTE band
  at 0.62-0.79 anchored to candle bodies.
- Liquidity pools: equal highs and lows (tolerance as a multiple of ATR, confirmed after n bars),
  previous day and week high and low, session high and low.
- Sweep: a wick through a pool, with the body closing back inside within a small window.
- Displacement: body >= 1.5x ATR and body >= 70% of the candle's range.
- Fair value gap (the 3-candle rule) and order block, both with mitigation tracking.
- Breaker.
- Killzone windows, computed in America/New_York so daylight saving is handled — never hard-code
  IST or UTC hours.
- One parameters module holding every threshold in one place, because each one is a backtest trial
  and the budget is single digits.

Non-negotiable: CAUSALITY. Write a test harness that streams a fixture one candle at a time and
asserts no detector's output for an earlier bar ever changes as later bars arrive. The most-used
open-source library for these concepts uses a centred window that peeks at future bars, and a user
measured that inflating a backtest's profit factor from 1.8 to 7.3. Do not copy LuxAlgo's Pine
script either — its licence is non-commercial.

Fixtures: hand-build small candle sets where you know the answer by construction, and write the
expected markings down BEFORE writing the detector. At least three hand-checked cases per detector.

Done when: every test passes including the causality suite; a small CLI prints the markings for a
fixture and they match the expectations written first; and you can name, for each of the twelve
mechanisms, which parameter decides it. Report the parameter table you ended up with.
```

### Session 1.3 — The runner, the pages, and the morning card

```
[shared header — same as 1.1]

THIS SESSION: turn the detectors into something the owner reads twice a day.

Build:
- The every-minute runner: refresh candles, recompute per-symbol markup state, store it.
- The markup job at 11:00 and 17:00 IST: build one card per symbol and send it to Telegram
  (plain fetch, no SDK; TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID). Idempotent — a repeated
  invocation must not post twice.
- A Today page: the six symbols as cards, each showing bias per timeframe, where price sits in the
  dealing range, the nearest liquidity above and below, unmitigated gaps and blocks, and a
  killzone clock in IST that is correct across US daylight-saving changes.
- A per-symbol page drawing the markings on a candle chart. Reuse TradeGenie's replay chart
  component and its en-IN locale pin (an inherited locale makes that library throw on every frame).
  Import the chart library inside the effect so it never evaluates during server rendering.
- Everything else server-rendered with no client JS, following SignalDesk's card and disclosure
  contract.

The card's job is to answer "what am I looking for today" in ten seconds. Lead with the read, not
with data. If a symbol has nothing interesting, the card should say so plainly rather than listing
every level it found.

Done when: a real card arrives on the owner's Telegram at 11:00 and 17:00 IST and they confirm it;
the Today page and every symbol page render in production with real markings; calling the markup
route twice does not post twice; and the shared client bundle has not grown for pages that do not
show a chart. Report the bundle sizes.
```

### Session 1.4 — The calibration loop

```
[shared header — same as 1.1]

THIS SESSION: build the loop that makes the bot's markings agree with the owner's eye. This is the
whole point of stage 1 — only three of the twelve concepts have one agreed definition, so version
one WILL disagree, and this is how it gets corrected.

Build:
- On each marking on the symbol page, two controls: agree, and wrong with an optional one-line
  reason. Store each verdict against the marking's type, symbol, timeframe and the parameters in
  force at the time.
- A weekly agreement report by marking type — bias, range, liquidity, gap, block, sweep — sent to
  Telegram on Sunday evening and readable as a page.
- A settings page exposing the parameters from session 1.2, with a visible counter of how many
  distinct parameter sets have been tried. The roadmap's budget is at most nine before the
  out-of-sample months are opened; the counter is what keeps that honest.
- Record the parameter set with every verdict, so a later session can tell whether a revision
  actually improved agreement or just moved the disagreement somewhere else.

Do NOT auto-tune the parameters from the verdicts. A human reads the report and decides. An
optimiser over a few dozen subjective verdicts is exactly the overfitting the roadmap warns about.

Done when: pressing wrong on a marking appears in the report; changing a parameter increments the
trial counter; the Sunday report arrives on Telegram; and you have written down what the current
agreement rate is, per marking type, over whatever verdicts exist.

STAGE 1 KILL CRITERION, from the roadmap: after four weeks, if agreement on bias, range and
liquidity is below 70% after two parameter revisions, or the owner has opened the card on fewer
than half of trading days, stop and rethink rather than adding features.
```

---

## Stage 2 — the model detector

Do not start stage 2 until stage 1's agreement rate on bias, range and liquidity is at or above 70%.

### Session 2.1 — The sequencer and the plan

```
[shared header — same as 1.1]

THIS SESSION: detect the owner's model. Read roadmap section 4.6 — the five stages there are the
five lines of their own playbook checklist, and that checklist is the only written spec that
exists. There is no published rule set for this model anywhere; you are encoding their
transcription of it, not a canonical strategy.

Build:
- A state machine per symbol: idle -> swept -> displaced -> shifted -> armed -> filled or expired,
  gated to the killzone windows, running on 5-minute candles with 1H and 15m context.
- A plan builder: entry at the gap midpoint or block open, stop just beyond the sweep extreme,
  target the opposite range extreme or the nearest pool, R computed after fees, and position size
  from TradeGenie's lib/calculator.ts sizing maths — call the same function, do not reimplement it.
  Reject a setup offering less than 2R.
- Detection on BTC, ETH and SOL only. The other three are marked up but not detected: their books
  are thin and the roadmap says signals there would be reported separately if ever enabled.

Fixtures: pick two real historical sequences by hand, before writing the sequencer, and write down
what it should produce. Then make it produce exactly that and nothing else.

Done when: the fixtures produce the expected signals and no extras; a sequence outside a killzone
produces nothing; and the plan's size equals what TradeGenie's calculator page shows for the same
numbers. Report both, with the numbers.
```

### Session 2.2 — Alerts, the signal log, and take-or-pass

```
[shared header — same as 1.1]

THIS SESSION: get signals in front of the owner and record what they did about them.

Build:
- A signals collection: one document per signal holding the plan, the five steps with what
  satisfied each in the owner's own vocabulary, and the market snapshot.
- A Telegram alert per signal with inline take and pass buttons, and a reason chip on pass
  (FOMO, not convinced, thin, news, other).
- The market snapshot from SignalDesk's /api/snapshot?at=, using SIGNALDESK_SNAPSHOT_URL and
  SIGNALDESK_SNAPSHOT_TOKEN — the same values TradeGenie already holds. Never load-bearing: a
  timeout or failure must leave the signal intact, exactly as TradeGenie's market-context capture
  behaves.
- A signals page listing them newest first.

The owner still trades by hand in TradingView paper if they take one. The bot records the decision;
it does not place anything.

Done when: a real signal (or a replayed one through a debug route) posts to Telegram, the button
press lands on the signal document, and the snapshot fields are populated. Show the stored document.
```

### Session 2.3 — Outcomes and the dashboard

```
[shared header — same as 1.1]

THIS SESSION: close the loop on every signal, so the record can eventually answer whether the
model works.

Build:
- An outcome resolver: from candles after the signal, mark it target, stop or timeout, and compute
  R, maximum adverse excursion and maximum favourable excursion. Reuse the rules in TradeGenie's
  lib/excursion.ts — incomplete candles produce null, entry and exit candles are included whole so
  excursions err wide rather than narrow, and a disagreement with the venue is reported rather
  than resolved.
- When stop and target both sit inside one candle, count the STOP. That is the pessimistic
  ordering the established backtesters use, and it is the one that keeps you honest.
- A dashboard: signals by symbol and by killzone window, with win rate, mean R and profit factor.
  Grey out and refuse to colour any row under five signals — TradeGenie's MIN_SAMPLE rule. A
  mechanism with three trades and a 100% win rate is one lucky week and must not read as an edge.

Done when: replayed signals over a known week resolve to outcomes you computed by hand first, and
the dashboard refuses to colour a thin row. Report the hand-computed cases.
```

---

## Stage 3 — backtest and shadow

### Session 3.1 — History, the backtester, and real costs

```
[shared header — same as 1.1]

THIS SESSION: run the same sequencer over history, with costs that do not flatter it.

Build:
- A loader for the monthly 1-minute futures zips from data.binance.vision (free, no key, back to
  2020) for BTC, ETH and SOL from January 2024. Candles are disposable data — they must never
  reach a backup or a stored signal.
- A backtest runner over the SAME sequencer and outcome resolver the live path uses. If you find
  yourself writing a second copy of a detector for the backtest, stop: that is the drift the
  roadmap's decision 2 exists to prevent.
- A cost model: taker fee both sides plus 18% GST, three basis points of adverse slippage per
  side, funding at the venue's interval, and stop-first when stop and target share a candle.
- A monthly report: signal count, win rate, mean R, profit factor, drawdown in R, worst
  20-signal run.
- Record every run with its parameter set and its trial number.

Done when: a backtest over one month reproduces session 2.1's fixture signals exactly; switching
the cost model off visibly changes the result, proving it is applied; and the run is recorded with
its trial number. Report the monthly table.
```

### Session 3.2 — Walk-forward, shadow mode, and the gate

```
[shared header — same as 1.1]

THIS SESSION: produce the report that decides whether stage 4 happens.

Build:
- The in-sample / out-of-sample split: fit on January 2024 to June 2025 across at most nine
  parameter sets; July 2025 to August 2026 stays unopened until the parameters are marked frozen.
  Enforce that in code — the out-of-sample run must refuse to execute on unfrozen parameters.
- The shadow table, filled from stage 2's live signals: signal, intended fill, next-candle-open
  fill, outcome, and whether the owner took it.
- A weekly digest comparing three lines: all signals, the ones taken, the ones passed. That last
  comparison is the one that tells the owner whether their own filter adds or subtracts.
- The gate report, printing every threshold from roadmap section 5 with its measured value and a
  pass or fail: at least 100 forward signals, forward mean R after costs at least +0.1R,
  out-of-sample mean R at least +0.1R with profit factor at least 1.2 over at least 300 events,
  worst 20-signal run better than -12R.

Say plainly in the report what the roadmap says: at 100 signals the standard error of mean R is
about 0.15R, so this gate is a decision rule for spending five dollars a month and testnet time,
not a proof of edge.

If out-of-sample expectancy is at or below zero after two honest parameter passes, that is the
kill criterion: the model as written has no edge on this data. Say so. Do not add a tenth
parameter to rescue it. Stage 1 keeps its place regardless.

Done when: the gate report prints pass or fail per criterion with real numbers; the out-of-sample
run refuses to execute on unfrozen parameters (prove it by trying); and the digest arrives on
Telegram.
```

---

## The owner's setup steps

Four things, in this order. Only the first blocks the first session.

**1. GitHub — the repository — DONE**
`instatank/tradebot` exists, private, empty, default branch `main`. For reference: go to github.com, click **+** at the top right, then **New repository**. Owner `instatank`, name
**`tradebot`**, tick **Private**, and leave **"Add a README file" unchecked**. Click
**Create repository**.

**2. Firebase — the database — DONE**
For reference: go to console.firebase.google.com → **Add project** → name it `tradebot` → turn Google Analytics
**off** → **Create project**. Then in the left menu, **Build → Firestore Database → Create
database** → choose **Production mode** → set the location to **asia-south1 (Mumbai)** → **Enable**.
Then the **gear icon → Project settings → Service accounts → Generate new private key**, which
downloads a JSON file. Keep that file; you will paste its contents into Vercel in step 4.

**3. Telegram — the bot — DONE**
For reference: open Telegram, search for **@BotFather**, send `/newbot`, give it any name and a username ending
in `bot`. It replies with a token. Keep it. You already have the chat id — it is the
`TELEGRAM_CHAT_ID` value in your SignalDesk project on Vercel, under **Settings → Environment
Variables**.

**4. Vercel — the deployment (after session 1.1 has pushed code)**
Go to vercel.com → **Add New → Project** → import `instatank/tradebot` → **Deploy**. Then
**Settings → Environment Variables** and add:

| Name | Value |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | the entire contents of the JSON file from step 2 |
| `TELEGRAM_BOT_TOKEN` | the token from step 3 |
| `TELEGRAM_CHAT_ID` | copied from your SignalDesk project's environment variables |
| `CRON_SECRET` | any long random string you invent |
| `SITE_PASSWORD` | a password for the site, your choice |

Two more are needed only from stage 2, and you can copy both from your TradeGenie project's
environment variables when the time comes: `SIGNALDESK_SNAPSHOT_URL` and
`SIGNALDESK_SNAPSHOT_TOKEN`.

After adding them, go to **Deployments** and redeploy the latest one so it picks them up.
