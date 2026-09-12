# Trading engine roadmap — a bot for the mechanical half

*Written 12 September 2026 from the real journal backup (899 records, snapshot of 5 September), both codebases,
and four research threads run against primary sources. Every number in section 2 was computed, not recalled. Every
factual claim in section 3 carries a source or is marked as attributed or inferred. This document is the plan; no
code was written for it, and nothing in either app was changed.*

*Reading order if you have ten minutes: section 1, then the stage table in section 5, then section 9.*

---

## 1. Verdict

**What the bot will do for you.** It takes the mechanical half of your process off your screen. Twice a day, before
the London and New York windows, it produces the top-down read you currently write by hand for each coin: bias on
the weekly, daily, 4H and 1H from market structure; the current dealing range with its premium, discount and OTE
band; the unmitigated fair value gaps and order blocks on 4H, 1H and 15m; the liquidity above and below (equal
highs and lows, previous day and week highs and lows, session highs and lows); and a killzone clock in your time.
One card per coin, on Telegram and on a page where the chart is drawn with the markings. Then, during the killzones,
it watches the 5-minute chart and tells you when the sequence you trade is forming: sweep, displacement, structure
shift, an entry zone left behind — with the entry, the stop, the target, the R and the size already worked out in
your own vocabulary. Later it sizes and places the bracket order on your tap. Later still, and only if the numbers
earn it, it places the order itself under hard caps. Every trade it touches lands in the journal with the setup,
mechanisms and timeframes already filled in, which today are empty on all 74 of your trades.

**What stays yours.** The decision to take or pass. That stays human until the bot has produced at least 100
forward signals on paper and the record says its calls are at least as good as yours. Your own data supports this
split: the trades you took calmly and on plan won 65–70% of the time; the FOMO entries won 18%. The leaks are not
analytical, they are FOMO, moved stops and oversizing, which is exactly what a machine that sizes and places the
bracket does not do.

**What gets automated first, and why.** The markup. It is zero-risk, it is the time sink you named ("aimlessly and
endlessly staring at charts", 9 July), and it answers the question underneath the time sink: what am I looking for
this morning. A bot that marks the chart and says "bias bearish on the daily, liquidity resting at 63,700, watch for
a sweep and a 5-minute shift between 17:30 and 21:00" turns chart time from searching into checking.

**What is deliberately not automated, and why.**
- *Full automation before the gates.* A discretionary beginner's process automated end to end is a losing process
  running faster with leverage. Your 73 closed trades have an expectancy of about +₹203 with a 95% interval of
  −₹333 to +₹738. That record cannot distinguish "slightly profitable" from "slightly losing", and nothing here lets
  a bot trade capital on the strength of it.
- *Discretionary exits.* "The thesis changed, I closed" is judgement. The bot only ever manages bracket orders by
  rule; if you want to close early, you close early, and the journal records that you overrode it.
- *An AI reading charts.* The detectors are deterministic code over candles. A language model's only role, if any,
  is writing the explanation text under a signal. Anything else is confident-looking noise.
- *Thin coins first.* Half your fills are on HYPE, ZEC and VVV. The bot marks them up but detects only on BTC, ETH
  and SOL until the model has proven itself where data and liquidity are best.

**The biggest risk** is mistaking a bot that *looks* systematic for a system that *has* edge, and then scaling
capital on it. Research turned up the exact failure: an author's own post-mortem where a seven-month window showed a
75% win rate and a 2.4 profit factor, and the full three years showed a 1.2 profit factor and 35 months underwater.
The second risk is definition drift: the bot marks an order block differently from your eye, you stop trusting it,
and it becomes one more thing to ignore. The calibration loop in stage 1 exists for that. The third is impatience:
the gates below are measured in weeks and signal counts, not in enthusiasm.

**On your premises.** You are right that others use automation and that this is zero-sum after fees. You are wrong
about where that leaves a beginner. Retail cannot compete on speed or infrastructure; the reachable edge is
selectivity, cost control, discipline and holding-period choice, and the evidence (section 3.2) says the ICT
concepts themselves have no demonstrated standalone edge in any test with disclosed methodology. What automation
buys you is not an edge; it is the removal of the three ways you currently give one back. That is worth building. It
is also all it is.

**Done, restated precisely.** A deployed service, in its own repository, that: publishes the top-down markup for
BTC, ETH, SOL, HYPE, ZEC and VVV twice daily; detects the Mayne 5-minute sequence on BTC, ETH and SOL live inside
your killzones and alerts with a complete plan; logs every signal with its outcome and whether you took it; has been
backtested causally over at least 2024–2026 on Binance 1-minute data with fees, slippage and funding; has produced at
least 100 forward paper signals; and, only if the stage-3 gate passes, places bracket orders on the Delta Exchange
India testnet and then live at small size under caps you set in advance, with a kill switch on the page. You can
watch every step of that on one screen, and every trade it takes arrives in TradeGenie with the fields filled in.

---

## 2. Baseline — the trader today, measured

Everything in this section was computed from the real journal backup (`instatank/tradegenie-backups`,
snapshot of 5 September 2026, 899 records) and the two codebases. Nothing here is recalled or assumed.
Where a number is soft, the reason is given next to it.

### 2.1 The record

| What | Measured |
|---|---|
| Journaled trades | 74 (73 closed, 0 open), 5 June → 3 September 2026, about 13 weeks |
| Exchange fills (CoinDCX) | 441, November 2025 → September 2026, with a gap February–May (two stints: 58 fills Nov–Jan, 383 fills Jun–Sep) |
| Symbols traded | BTC 23 · ETH 14 · HYPE 12 · ZEC 11 · VVV 9 · SOL 3 · XAG 2 (by fills: VVV 122, ZEC 93, BTC 82, HYPE 63, ETH 49, SOL 28) |
| Direction | 51 long · 22 short |
| Wallets | INR-margined 242 fills · USDT-margined 199 fills |
| Median order value | ≈ ₹26,000 (15 trades carry one; the field may record margin rather than notional; 90th percentile ₹40,500) |

**Not "large caps".** Half the fills are on HYPE, ZEC and VVV. VVV is the single most-traded instrument by fills and
is a thin book. This matters for a bot: slippage and data quality on thin coins are worse, and the Binance candle
feed the journal already uses is the proxy for all of them.

### 2.2 The numbers, and how much to trust them

| Metric (73 closed trades) | Value |
|---|---|
| Win rate | 56% (41 wins, 32 losses) |
| Average win / average loss | ≈ ₹974 / ≈ −₹785 |
| Profit factor | 1.59 |
| Net P&L | ≈ +₹14,800 INR-equivalent |
| Expectancy per trade | ≈ +₹203 |
| 95% confidence interval on that expectancy | **−₹333 to +₹738** |
| Share of gross wins from the best 3 trades | 54% |
| Fees paid | ≈ ₹2,158 — 5% of gross wins, but 15% of net P&L; funding ≈ −₹60 |
| R multiple | recorded on 26 trades only; average +0.88R |

Three cautions, in order of size:

1. **The confidence interval spans zero.** With a per-trade standard deviation of ≈ ₹2,335, 73 trades cannot
   distinguish "slightly profitable" from "slightly losing". This is not a criticism of the trading. It is the
   arithmetic, and it is the reason nothing in this roadmap lets a bot trade capital on the strength of this record.
2. **54 of 73 trades carry no currency stamp** (hand-logged before the exchange import existed), and the owner's own
   audit found some INR/USDT figures entered at 1/100th of their value. The INR totals above are the journal's best
   reading, not the exchange's.
3. **Three trades are 54% of the gross wins.** Remove the single best and worst trade and the mean moves from ₹203
   to ₹269, so the edge is not one lucky trade, but it is fragile.

### 2.3 Where the edge and the leaks actually are

These are cuts of the same 73 trades. At these sample sizes each row is an observation, not a verdict (the journal's
own `MIN_SAMPLE` rule greys out anything under 5, and most of these are under 30).

| Cut | n | Win rate | Net (INR-eq) |
|---|---|---|---|
| Entered 19:00–21:00 IST (New York open) | 36 | 61% | +7,370 |
| Entered 12:00–18:00 IST (London / NY morning) | 21 | 52% | −1,052 |
| Entered 22:00–03:00 IST (late NY) | 12 | 50% | +1,442 |
| Mind state CALM | 20 | 70% | +6,151 |
| Mind state FOMO | 11 | **18%** | **−3,481** |
| Followed plan: yes | 31 | 65% | +8,931 |
| Followed plan: partial or no | 16 | 31% | −1,869 |
| Execution grade A | 22 | 64% | +1,927 |
| Execution grade B | 13 | 31% | −2,649 |

The most frequent mistakes tagged (26 trades carry at least one): overtraded 7 · FOMO entry 7 · moved stop 7 ·
cut winner early 5 · oversized 4 · step-wise take-profit 3 · no clear invalidation 2 · held loser too long 2.

Read together: **half the trades happen in one two-hour window, and the trades taken calmly on plan are the ones
that pay.** The measured leaks are not analytical. They are FOMO entries, moved stops and oversizing, which is
exactly the class of error a machine that sizes and places the bracket does not make.

### 2.4 What the journal cannot yet answer

The fields that would say whether the *model* works are empty:

| Field on a trade | Filled on |
|---|---|
| Setup (playbook link) | 2 of 74 |
| Mechanisms (FVG, sweep, MSS…) | **0 of 74** |
| Timeframes used | **0 of 74** |
| Checklist steps ticked | 2 of 74 |
| Stop price | 30 of 74 |
| Target price | 6 of 74 |
| Written invalidation | 10 of 74 |

So the question "does the Mayne 5-minute model have edge for me?" has no data behind it at all, three months in.
That is the single most useful thing a bot changes: a signal it detected arrives with the setup, the mechanisms, the
timeframes, the stop and the target already attached, and the journal fills itself.

### 2.5 The process, in the owner's own words

The playbook holds two real setups (the seed data's four are fiction):

- **Mayne 5M Model** — five steps: HTF bias/trend → dealing range & market structure → liquidity sweep →
  displacement → entry at FVG/OB. Ideal R 2.
- **ICT NY open** — HTF bias check → 15m equal highs/lows → 5m/1m market structure, entries at OB/FVG → clear
  stop, reasonable R. Ideal R 1.

The owner's own manual backtest (asset note, 29 July): "explored historic Jun–Jul 15M charts on the NY open and great
success … 1–3–5% moves that resolve within 1–3–5 days … tried the Dubai–London window, no setups, choppy." That is
the model's hypothesis, written before this roadmap: **NY open, 15m context, 5m/1m entry, on the ICT sequence.**

The daily asset notes are hand-written top-down reads — weekly/daily/4H/1H bias, dealing range, premium/discount,
OTE, unmitigated FVG/OB, liquidity above and below — one coin at a time, most days. Every one of those is a
mechanical computation over candles.

The owner's own diagnosis of the time sink (transcript, 9 July): "rather than just aimlessly and endlessly staring
at charts." Daily review, 10 July: "avoid: too much random chart watching." Daily check-ins: 11 in 13 weeks. The
morning ritual is not sticking, and the reason is plausible from the data: the ritual asks the trader to *produce*
the read every morning, by hand, for six coins.

### 2.6 The repetitive tasks, and what they cost

| Task (daily, by hand) | Mechanical? | Rough cost |
|---|---|---|
| Top-down bias per coin (W/D/4H/1H structure) | Yes, fully | 5–10 min per coin × 6 coins |
| Marking dealing range, premium/discount, OTE | Yes, fully | included above |
| Marking liquidity (equal highs/lows, PDH/PDL, session H/L) | Yes, fully | included above |
| Marking unmitigated FVGs and order blocks on 1H/15m/5m | Yes, with parameters | included above |
| Waiting through a killzone for the sequence to line up | Yes (detection) | 2–3 hours of screen time per session |
| Deciding to take or pass | **No** — judgement | seconds, but only if the above is done |
| Sizing off the stop with fees | Yes, fully (the calculator exists) | 1–2 min |
| Placing entry + stop + target | Yes, fully | 1–2 min, error-prone under pressure |
| Filling in the journal | Yes, mostly (the exchange import already does the numbers) | 2–5 min |

The time costs are inferred from the note volume and the owner's description, not measured with a clock. The
mechanical/judgement split is the important column, and it is not inferred.

---

## 3. Research findings

Four threads, run in parallel, each citing primary sources where the research container could reach them (mostly
GitHub-hosted documentation and source code) and marking the rest as attributed. Vendor websites — TradingView,
LuxAlgo, Binance, Bybit, CoinDCX, Delta, Vercel, Railway, every hosting and tax site — were all blocked from the
container. Nothing below was filled in from memory; where a number could not be verified it says so.

### 3.1 What serious retail systematic traders actually run

**The open-source bot engines, and why none of them is the answer here.**

| Engine | What it is | Why it does not fit this owner |
|---|---|---|
| [Freqtrade](https://github.com/freqtrade/freqtrade) (Python) | The most complete free option: Binance/Bybit/OKX/Hyperliquid futures, dry-run, backtesting, hyperopt, web UI, monthly releases (2026.8 on 31 Aug 2026). | An always-on Docker process needing 2 GB RAM; no CoinDCX or Delta; its strategy model is indicator columns per candle, which fits a multi-timeframe ICT *sequence* badly. Its docs' own rule is worth keeping: "Do not trade with a leverage > 1 using a strategy that hasn't shown positive results in a live run using the spot market." |
| Hummingbot (Python) | Market-making engine; perp "paper trading" means the exchange testnet. | Wrong centre of gravity for a directional 5m model. |
| Jesse (Python) | Good research tooling (Monte Carlo, rule-significance tests). | Live and paper trading are a licensed plugin. |
| NautilusTrader (Rust/Python) | The most rigorous simulator (explicit intrabar fill models). | v2 release candidate, no UI, always-on. |
| OctoBot | Mid-rewrite (3.0 beta). | Churn. |

None supports CoinDCX or Delta Exchange India. All are always-on Python processes, a poor fit for an owner whose
entire toolchain is TypeScript on Vercel driven from Claude Code sessions. **The right use of Freqtrade and Nautilus
here is as the reference for fill and cost assumptions, not as the runtime.**

**Backtesting.** In Python, `vectorbt` and `backtesting.py` are alive; `backtrader` has been frozen since April 2023.
In TypeScript nothing comparable is maintained (Grademark's last commit is October 2024). For one model on 5m/15m
candles that does not matter: a hand-written event loop (candle in → state → orders → fills at next open) is a few
hundred lines, and **what decides whether a backtest is honest is the fill assumptions, not the library**:
[Freqtrade](https://github.com/freqtrade/freqtrade/blob/develop/docs/backtesting.md) fills entries at the next open,
assumes the low happens before the high, and resolves stop-versus-target inside one candle as the *stop*;
[NautilusTrader](https://github.com/nautechsystems/nautilus_trader/blob/develop/docs/concepts/backtesting/bar-execution.md)
states plainly that bar data "does not record when each price occurred within that interval or whether the high
preceded the low" and simulates a plausible intrabar path plus a probabilistic one-tick adverse slip. This roadmap
adopts the pessimistic version: taker fee both sides, a fixed adverse slip, stop-first ordering, funding at the
venue's interval.

**Overfitting discipline.** Bailey and López de Prado's deflated Sharpe ratio and probability-of-backtest-overfitting
(CSCV) exist precisely because every parameter you tune is a trial: after 1,000 independent backtests the expected
best Sharpe is 3.26 with a true edge of zero, and with ~5 years of data "no more than 45 independent model
configurations should be tried" (attributed, [Bailey et al.](https://www.davidhbailey.com/dhbpapers/backtest-pseudo.pdf));
Harvey and Liu call the "50% haircut" rule of thumb a serious mistake. Freqtrade caps parameter precision at three
decimals because finer values "will usually result in overfitted results". The practical rule for this bot: **every
ICT threshold (killzone window, FVG size, displacement multiple, swing lookback) is a trial; keep the count in single
digits, freeze them, then walk forward on months that were never looked at.**

**Sample size, stated as arithmetic.** Standard error of a win rate is √(p(1−p)/n): ±7 points at 50 trades, ±5 at
100, ±2.9 at 300 (95% intervals are roughly double). Expectancy is worse: with a per-trade spread of ~1.5R the
standard error of mean R at 100 trades is ~0.15R, so **a +0.2R edge is barely distinguishable from zero at 100
signals**. Practitioners quote 100 as a bare minimum and 200–500 across regimes for validation (attributed). This is
why the stage gates below are decision rules, not proofs, and why the proof is scheduled to arrive during small live
trading rather than before it.

**Costs.** Binance USDT-M regular tier 0.02% maker / 0.05% taker; Bybit 0.02 / 0.055; Delta India 0.02 / 0.05 plus
18% GST; CoinDCX is quoted inconsistently (0.02/0.05 INR-margined, 0.025/0.075 USDT-margined at the regular tier).
Funding intervals differ by venue and have changed (Binance moved to 4-hourly and then conditional hourly settlement,
attributed); Freqtrade warns a wrong funding assumption makes futures backtests "inaccurate". Hummingbot's Binance
connector still ships 0.02/0.04 as its default, a reminder that hard-coded fee tables rot.

**TradingView, in 2026 prices** (attributed; the site was blocked): Essential $14.95, Plus $34.95, Premium $69.95 a
month after an April 2026 rise. Webhook alerts need Essential and 2FA; Essential allows 20 price + 20 technical
alerts that expire after two months. Deep Backtesting needs Premium. **A Pine strategy cannot drive the Paper
Trading account** ("automated strategy trading with a brokerage account is not available"); strategies emit alerts,
alerts can fire webhooks, and that is all. So TradingView stays what it is for the owner today: the manual chart and
the manual paper account. It is not the bot's execution venue and never will be.

**Free historical data.** [data.binance.vision](https://github.com/binance/binance-public-data) publishes USDT-M
futures klines from 1-second to monthly as CSV zips, daily files the next day and monthly on the first Monday, no key,
no stated rate limit; BTCUSDT 1-minute monthly files run January 2020 to August 2026. The live REST klines endpoint
returns up to 1,000 candles a call under a 2,400-weight-per-minute budget. Bybit's kline endpoint is public and
keyless; Delta's history endpoint serves up to 4,000 candles a request; CoinDCX exposes a public candles call with
undocumented limits. **Backtests run on Binance data as the proxy for every venue**, which the journal already
validated: 36 of 36 real CoinDCX fills landed inside their Binance 1-minute candle, the tightest 0.017% wide.

**Shadow mode is a log table.** Freqtrade's dry-run and Nautilus's sandbox are the same idea: real-time data,
simulated execution. NinjaTrader runs a "shadow strategy" beside every live entry and compares the two histories.
Practitioners forward-test 4–8 weeks for intraday models, 20–100 trades, and go live only when results sit within
15–20% of the backtest (attributed). For this owner the table has five columns: signal, intended fill, next-open fill,
outcome, and whether they took it. **That last column is what tells you whether your discretion adds or subtracts.**

---

### 3.2 Mechanising ICT concepts — what exists, what is precise, what is not

Access note: TradingView, LuxAlgo, YouTube and every ICT vendor site are blocked from the research container. GitHub
was reachable, so the code below was read from source; claims resting on a search snippet of a blocked page are
marked *attributed*.

**The two most-used open-source implementations, read from source.**

- **LuxAlgo "Smart Money Concepts"** (Pine, [mirror of the script](https://github.com/srinivas-yarramsetti/pinescript/blob/main/Lux_Algo_SMC.pine); canonical page unreachable). Rules as coded: swings from a
  50-bar lookback (internal structure 5 bars), a pivot confirmed only *after* the lookback elapses; BOS vs CHoCH is a
  close crossing the last swing, labelled by the prior trend; order block = the extreme candle in the leg whose range
  is under a threshold (ATR or mean range), mitigated on a *close* through its far edge; FVG = the 3-candle gap with a
  minimum size of 2× the running mean bar move; equal highs/lows within 0.1 × ATR, confirmed after 3 bars;
  premium/discount from the trailing swing extremes. **Licence CC BY-NC-SA** — anything copied from it inherits
  non-commercial share-alike terms. Write our own.
- **`smartmoneyconcepts` (Python, joshyattridge)** ([repo](https://github.com/joshyattridge/smart-money-concepts)):
  MIT, ~2,000 stars, vectorised over a whole DataFrame, not written for live use (an open issue reports order blocks
  changing as candles stream in). **Its swing detector uses a centred window, so it looks at future bars.** A user
  measured the effect on a gold M15 backtest: profit factor **1.82 causal → 7.32 with the look-ahead**, win rate
  53% → 81% ([issue #101](https://github.com/joshyattridge/smart-money-concepts/issues/101)); the fix PR was unmerged
  as of June 2026. Its liquidity tolerance is 1% of the *entire loaded dataset's* range, so the same bars give
  different equal-highs depending on how much history you load. Useful as a reference for definitions; not
  something to depend on.

**Thresholds practitioners actually code** (from repos with disclosed rules):
displacement = candle body > 1.5 × ATR and body ≥ 70% of range
([Silver Bullet repo](https://github.com/hindsight-finance/Silver-Bullet-AM-Session)); sweep = wick through the
level, body closes back inside, within 1–2 bars ([scanner](https://github.com/NadirAliOfficial/trading-scanner));
structure from n-bar pivots (50 swing / 5 internal); FVG minimum size 0.3 × ATR or 2 × mean bar move; mitigation
either wick-touch or close-through, and the two disagree often. Timeframe stacking in the written-up models: daily
bias, 15m liquidity map, 5m/1m execution.

**ICT's own definitions** (via a timestamped [lecture-derived wiki](https://github.com/SrsBlack/ict-knowledge-library);
ICT's site blocked): FVG is mechanical (low of candle 3 above high of candle 1). Order block is mechanical *given* a
displacement rule. Displacement is described as "fast, forceful, wide range, dominant body" with **no numbers** —
the thresholds above are other people's operationalisation. MSS is a CHoCH *plus* displacement *plus* an FVG.
Equal highs have "no universal numeric tolerance". OTE is 0.62–0.79 anchored to candle bodies. Premium/discount
is the midpoint of a dealing range, and *choosing the range* is the discretionary part. Killzones in New York time:
London 02:00–05:00, NY AM 08:00–11:00 (some sources say 07:00–10:00), NY PM 13:30–16:00. In IST that is
**London 11:30–14:30 and NY AM 17:30–20:30 during US daylight time, one hour later in winter** — the bot must be
pinned to `America/New_York`, never to fixed IST or UTC.

**TraderMayne's 5-minute model.** No public written rule set exists. What is public is two YouTube episodes from
July 2026 (attributed; unreachable) and a third-party "Structure + OTE" playbook summary. **The five checklist
lines in the playbook are the owner's transcription, and the bot can only ever be that transcription.**

**Evidence of edge.** The best independent test found (StatOasis, attributed: 648 backtests of OB/FVG/sweep/OTE
entries on daily SPY/QQQ/DIA/IWM) found nothing statistically significant — but daily bars are not the intraday
setting ICT teaches. The intraday backtests with disclosed methodology are single-market, short and cost-light:
a 5m inverse-FVG bot on NQ ([repo](https://github.com/prashanthaitha24/nq-strategy-b-bot)) reports 432 trades, 53.5%
win rate, profit factor 2.3 over Jan 2023–May 2026, and its author warns 5m bars overstate 1m entries and real
drawdown is "2–3× worse". **The same author's post-mortem of another bot** ([archived](https://github.com/prashanthaitha24/nq-atb-bot-archived)) is the most useful document in this thread: a 7-month window showed 74.6% win rate and
profit factor 2.38; the full three years showed 61% and 1.20, underwater for 35 months — "the whole edge is the last
6 months of the test window." Nothing peer-reviewed exists on FVG/OB entries; no crypto-perp test with fees and
funding was found; vendor "70–80% win rate" claims are marketing; one critic's rules-based SMC tests land at 38–48%
win rates (attributed).

**Verdict per mechanism in the journal's vocabulary**

| Mechanism | Definable? | What has to be chosen |
|---|---|---|
| FVG | Precisely | optional minimum size |
| Killzone | Precisely | which windows; `America/New_York` |
| OTE | Precisely, given the swing | 0.62 / 0.705 / 0.79; body or wick anchor; swing lookback |
| Premium / discount | Precisely, given the range | **which dealing range** (the discretionary part) |
| Equal highs / lows | With parameters | tolerance (e.g. 0.1 × ATR), confirmation bars |
| Market structure shift | With parameters | pivot lookback, close vs wick, displacement rule |
| Displacement | With parameters (ICT gives none) | ATR multiple (~1.5), body/range (0.6–0.7) |
| Liquidity sweep | With parameters | which levels count, wick-through + close-back, reversal window |
| Order block | With parameters | needs a displacement rule; body vs wick zone; mitigation mode |
| Breaker | With parameters | OB rule + close-through + retest |
| Retest | With parameters | touch vs close-inside; timeout |
| HTF bias | **Discretionary** | which timeframe, what counts as bias |

Three of twelve have one agreed definition. The rest need numbers ICT never gave, and every implementation picks
different ones. So "the bot marks it" always means "the bot marks *one parameterisation*", which will disagree with
the owner's eye and with LuxAlgo. That is the argument for the calibration loop in stage 1, and against ever
treating a marking as the truth.

---

### 3.3 Venue, exchange API and Indian tax

Access note: CoinDCX, Delta, Binance, Bybit, Hyperliquid, government and tax sites were all blocked from the research
container. What follows was read from official client libraries and documentation mirrors on GitHub (primary) or
from search excerpts of the vendors' pages (attributed). Nothing was filled in from memory.

**CoinDCX (where the owner is today).** Order placement *is* documented — in an official
[Futures API PDF](https://github.com/anujsainicse/coindcx-futures/blob/master/CoinDCX-Futures-API.pdf) (mirror; the
original on coindcx.com is blocked), not in the public docs source, which contains no futures endpoints at all.
It covers `orders/create`, `orders/cancel`, `positions/exit`, `positions/create_tpsl`, margin add/remove, and a
later community copy adds `stop_market` / `take_profit_market` order types (attributed). Auth is HMAC-SHA256 over
the JSON body, the same scheme the journal's read-only importer already uses. **No testnet or sandbox exists**, no
official rate-limit number is published (a community wrapper claims 2,000 order calls per minute), and **CCXT does
not list CoinDCX** ([CCXT README](https://raw.githubusercontent.com/ccxt/ccxt/master/README.md), 104 exchanges).
So the only way to test execution on CoinDCX is with real money at tiny size. Fees: INR-margined 0.02% maker /
0.05% taker; USDT-margined 0.025% / 0.075% at the regular tier; plus 18% GST on fees (attributed).

**Delta Exchange India.** FIU-IND registered (VA00041101, attributed). Its official Python client documents
production at `api.india.delta.exchange` and a **dedicated India testnet** at `cdn-ind.testnet.deltaex.org`, with
`place_order`, `cancel_order` and `place_stop_order`
([client README](https://raw.githubusercontent.com/delta-exchange/python-rest-client/master/README.md)). Testnet
keys only work on testnet and production keys only on production, so a bot graduates by changing a URL and a key.
WebSocket at `socket.india.delta.exchange`; rate limit 20,000 weight per 5-minute window; contracts USD-quoted but
margined and settled in INR; fees 0.02% / 0.05% plus GST; minimum sizes BTC 0.001 and ETH 0.01 (SOL not found)
(all attributed). **Enabling trading permission on an API key requires IP whitelisting** (attributed) — this is
the concrete reason an always-on host with a fixed IP becomes necessary at stage 4, and not before. CCXT's `delta`
adapter is hard-coded to the global host; the Delta-India pull requests were closed unmerged
([ccxt#24608](https://github.com/ccxt/ccxt/pull/24608)), so the bot writes against Delta's own REST, which is small.

**Binance and Bybit for an Indian resident.** Both are FIU-registered (Binance August 2024, Bybit February 2025,
attributed). Whether Binance *futures* are open to Indian KYC users could not be confirmed from a primary source.
Binance Futures has a separate testnet (`testnet.binancefuture.com`, confirmed in CCXT's source); Bybit's demo
trading needs a real mainnet account, and its SDK maintainers warn that Bybit *testnet* market data "is very
different" from production. Both are USDT-margined, which adds an INR↔USDT conversion leg that does attract 1% TDS.

**Hyperliquid.** Excellent API and testnet, no KYC, not FIU-registered; the testnet faucet needs a prior mainnet
deposit. Trading there from India is unregulated rather than illegal, and every P&L event is self-reported with no
withholding trail. Not for a beginner's first automated venue.

**Tax — every line here needs a chartered accountant.** The law: 30% (+ cess) on income from *transfer* of a
virtual digital asset under 115BBH with no loss set-off, and 1% TDS on transfers under 194S; Budget 2026 left both
unchanged and added reporting penalties, and the sections were renumbered from 1 April 2026 under the new
Income-tax Act (attributed). **Delta's stated position** is that futures P&L is not a VDA transfer, so no 30% and
no TDS, and it is speculative business income at slab rates with losses set off within the segment
([Delta support](https://www.delta.exchange/support/solutions/articles/80001132761-is-there-30-vda-tax-applicable-on-trading-profits-), attributed). **CoinDCX says** no TDS on futures but its own blog restates the 30%
headline. Tax firms disagree with each other: KoinX says speculative business income on ITR-3; Tax2win says 194S
does apply to perpetuals; CA blogs describe a "business-income view versus conservative 30% view" with litigation
risk and the CBDT silent. Nothing found in 2026 settles it.

**Recommendation.**
- **Paper and testnet phase: Delta Exchange India testnet.** The only Indian-regulated venue with a real testnet, the
  same request shape as production, and an official client. Fallback for more realistic fills: Binance Futures
  testnet. TradingView paper trading stays the owner's *manual* venue and is not driven by the bot.
- **Eventual small live trading: Delta Exchange India**, INR-settled, keys IP-locked, 0.02/0.05 fees, with the
  exchange itself asserting the business-income tax treatment. CoinDCX INR-margined is the runner-up: same fees, the
  journal already imports it, but no testnet and no published limits. The bot's execution adapter is an interface,
  so this choice is reversible.
- **Questions for a CA before stage 5:** (1) is perp P&L VDA income at 30% with no set-off, or speculative business
  income at slab with Section 73 set-off? (2) does 194S TDS attach anywhere in a futures-only workflow, INR- versus
  USDT-margined? (3) is ITR-3 with a speculative schedule correct, and does turnover trigger a tax audit? (4) are
  funding and fees deductible? (5) can losses be netted across two exchanges and two margin currencies?

---

### 3.4 Where the bot runs

Access note: every hosting vendor's site is blocked from the research container. Vercel facts come from Vercel's own
documentation index (primary); GitHub Actions and Cloudflare limits from the vendors' documentation source on GitHub
(primary); the rest are search-engine excerpts of the vendors' own pages (attributed, URL given).

**Vercel Pro, which the owner already pays for**

- An every-minute schedule (`* * * * *`) is a documented configuration example
  ([vercel.com/docs/project-configuration/vercel-ts](https://vercel.com/docs/project-configuration/vercel-ts)).
  Hobby is limited to daily crons fired "anywhere between 1:00 am and 1:59 am"; on Pro "cron jobs will be invoked
  within the minute specified" ([cron usage and pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing),
  attributed). So: minute cadence, minute precision, never second precision.
- 100 cron jobs per project on every plan ([changelog](https://vercel.com/changelog/cron-jobs-now-support-100-per-project-on-every-plan), attributed).
- Function duration with Fluid Compute: Pro default 300 s, maximum 800 s, 1,800 s in beta
  ([limits](https://vercel.com/docs/functions/limitations), attributed; the docs' own samples show `maxDuration: 1800`).
- WebSockets are supported but **close when the function reaches its maximum duration**
  ([docs](https://vercel.com/docs/functions/websockets)). A persistent exchange feed would reconnect every ≤ 800 s
  and be billed as a running function. Fine for polling; wrong for a live order book.
- Cost of a 1-minute cron running a ~10 s function: ~43,200 invocations a month (≈ $0.03), 1–2 s of real CPU per
  run (I/O wait is not billed) ≈ $1.5–3, memory ≈ $1.3–2.2. **≈ $3–6 a month at US rates, inside the $20 monthly
  Pro credit**; sin1/bom1 rates are higher by a factor the research could not retrieve. (Inference from the published
  rate card: Active CPU from $0.128/h, memory $0.0106/GB-h, invocations $0.60/M.)
- Binance reachability from `sin1` is already proven by SignalDesk's 15-minute ingest. From `bom1` it is
  unverified: Binance geo-blocks US IPs with HTTP 451; India is FIU-registered since August 2024 and no `bom1`
  block reports were found, but probe before relying on it.

**The always-on alternatives, one line each (all attributed)**

| Option | Cost | Notes |
|---|---|---|
| Railway Hobby | **$5/mo flat** (includes $5 usage; an idle Node process ≈ $3) | Singapore region, GitHub auto-deploy on push, no server to manage. Its cron floor is 5 min, so 1-min polling means an always-on process with an internal timer. |
| Fly.io | ≈ $2–3/mo | `sin` region; deploy needs a GitHub Actions workflow; a "region consolidation" removed regions and one user reports being unable to place machines in `bom`. |
| Render Starter | $7/mo | Free tier spins down after 15 min idle, so free is not viable. |
| Hetzner CPX11 Singapore | €7.90/mo | A real VPS; someone has to patch it. |
| DigitalOcean basic droplet | $4/mo | `blr1` and `sgp1` regions. Same caveat. |
| Oracle Always Free | $0 | Free tier halved in June 2026, idle instances reclaimed after 7 days, chronic "out of capacity". Not something to depend on. |
| GitHub Actions cron | not viable | 5-minute floor, documented delays and dropped runs under load. |
| Cloudflare Workers cron | not viable | 10 ms CPU on free, egress location not controllable (Binance 451 risk). |
| Cloud Run + Scheduler | ≈ $6+/mo after free tier | More moving parts than the problem needs. |

**Supporting limits.** Firestore free tier: 50,000 reads and 20,000 writes a day, shared with the journal; one
state write a minute is 1,440 a day, comfortably inside. Telegram Bot API: about one message a second per chat.
Binance USDT-M futures REST: 2,400 request-weight per minute per IP; a klines call with up to 99 candles costs 1,
so three symbols on four timeframes is 12–24 weight a minute, under 1% of the limit.

**Recommendation.** Stages 1–3 (polling, detection, alerting, backtests) run as every-minute and twice-daily crons
on Vercel Pro, in a **separate Vercel project pinned to `sin1`**, deployed by git push exactly like the two existing
apps. Design every run for "within the minute": act on the last *closed* candle by its open time, and make state
writes idempotent so a late or doubled invocation cannot double-alert. An always-on host (Railway, $5) becomes
necessary only when one of three things is true: a websocket feed is wanted, sub-minute reaction is wanted, or an
exchange requires a stable outbound IP for API-key whitelisting at stage 4/5. None of those is true before stage 4.

---

## 4. Architecture

### 4.1 The decision: a third app, same stack, its own repository

The bot is a **separate Next.js + TypeScript application in a new repository, deployed as its own Vercel project
pinned to `sin1`, with its own Firebase project**, exactly the shape SignalDesk already has. Not inside TradeGenie
(PROJECT_BRIEF forbids execution there, and that rule is right), not inside SignalDesk (its job is the briefing;
a bot's every-minute cadence and its exchange keys do not belong beside a public flash endpoint), and not a Python
bot framework.

Why this and not Freqtrade, the strongest alternative: Freqtrade is an always-on Docker process with no CoinDCX or
Delta support, its strategy model (indicator columns per candle) fits a multi-timeframe *sequence* badly, and every
piece of this owner's working method — git push to deploy, Claude Code sessions, zero-JS server pages, Firestore,
Telegram, the candle fetcher, the replay chart, the fee-aware calculator — is TypeScript on Vercel and already proven
twice. Freqtrade's *discipline* (dry-run before live, backtest and hyperopt kept apart, pessimistic fills) is adopted;
its runtime is not.

Why not Pine Script on TradingView: Pine cannot drive the paper account, the LuxAlgo indicator's licence is
non-commercial share-alike, and a detector written in Pine would be a second implementation of every rule the
server needs for backtesting and alerting. Two implementations of "what is an order block" is the two-tokenizer
mistake TradeGenie's own CLAUDE.md warns about. TradingView stays your manual chart.

### 4.2 Components

| Component | What it is | Notes |
|---|---|---|
| **Engine library** (`lib/engine/*`, pure functions, no I/O) | Candle types; ATR; swing pivots (n-bar fractal); structure (BOS / CHoCH per timeframe, internal and swing layers); dealing range → premium/discount/OTE; liquidity pools (equal highs/lows with tolerance, previous day/week high/low, session high/low); sweep; displacement; FVG with mitigation tracking; order block with mitigation; breaker; the **model sequencer** (a small state machine per symbol: idle → swept → displaced → shifted → armed → filled/expired); plan builder (entry, stop, target, R, size); outcome resolver (stop / target / timeout, MAE, MFE from later candles) | **Causal only.** Every function sees candles up to *now* and nothing after. This is the one non-negotiable in the engine, because the most popular Python SMC library peeks at future bars and a user measured it inflating profit factor from 1.8 to 7.3. A test feeds each detector a stream one candle at a time and asserts its output never changes retroactively. |
| **Data** | Live: Binance USDT-M `fapi/v1/klines` for 1m, aggregated in code to 5m/15m/1H/4H/1D (one fetch per symbol per minute, weight 1–2). Fallback: Bybit, as TradeGenie's `lib/candles.ts` already does. History: monthly 1-minute zips from data.binance.vision, 2020 → now. | Port `candles.ts` rather than rewrite it: it already handles pagination, the two providers and a local fixture mode for tests without egress. |
| **Runner** | Vercel cron: `* * * * *` → update state for each symbol, run the sequencer, emit events; `30 5,11 * * *` UTC (11:00 and 17:00 IST, half an hour before each window opens in US summer) → markup cards; a daily job → outcome resolution and the weekly agreement report | Idempotent by candle open time: a late or doubled invocation cannot double-alert. Each run acts on the last *closed* candle. |
| **Store** (Firestore, own project) | `state/{symbol}` (current markup), `signals` (one document per signal: plan, snapshot, outcome, owner's take/pass), `calibration` (owner verdicts per marking), `backtests` (runs and summaries), `settings` (parameters, universe, kill switch) | One state write a minute is 1,440 a day against a 20,000 free-tier limit. |
| **UI** (server-rendered, zero client JS except the chart) | Today (six cards + killzone clock + open signals); coin page (chart with the markings drawn — TradeGenie's replay component, lightweight-charts, reused); signals log; calibration queue; backtest results; settings with the kill switch | Same disclosure contract as SignalDesk's cards. Password gate copied from TradeGenie's `lib/site-auth.ts`. |
| **Notifications** | Telegram: markup cards, signal alerts, outcome notes, weekly "bot versus you" digest | A new bot token from BotFather, same chat. Signal alerts carry inline buttons for take/pass. |
| **Bridges** | TradeGenie: read the playbook checklist (the model's steps are already parsed by `lib/setups.ts`); later, link a signal to the trade the CoinDCX import creates, by symbol and time. SignalDesk: call `/api/snapshot?at=` for each signal so it carries the same frozen context a journal trade does. | Both read-only. Nothing writes into either app. |
| **Execution adapter** (stage 4+) | One interface: place bracket, amend, cancel, status. Implementations in order: **paper simulator** (fills at next candle open plus slip, stop-first inside a candle, fees and funding charged) → **Delta India testnet** → **Delta India live** (CoinDCX INR-margined as the alternative) | The interface is what makes the venue reversible. |

### 4.3 What is reused, and from where

- `lib/candles.ts` (fetcher, two providers, fixture mode) and `lib/excursion.ts` (MAE/MFE over candles) — TradeGenie.
- The replay chart component and its `en-IN` locale pin — TradeGenie.
- `lib/calculator.ts` — fee-aware sizing where a stop-out costs exactly the risk budget. The plan builder calls the
  same maths; the number on the signal card is the number the calculator page would show.
- `lib/setups.ts` — the checklist parser. The Mayne model's five lines *are* the sequencer's stage names.
- `lib/site-auth.ts` and `middleware.ts` — the password gate.
- SignalDesk's `/api/ingest` cron pattern, `sin1` pin, Telegram formatting and `/api/snapshot` — the deploy template
  and the context channel.
- The mechanism vocabulary and its hints (`lib/options.ts`) — the bot's labels are the journal's labels, so a signal
  card and a trade chip say the same words.

### 4.4 What is new

The engine library itself, the sequencer, the plan builder, the outcome resolver, the backtester, the calibration
loop and the execution adapter. Roughly: the detectors are the work of two sessions, everything around them another
five (section 6).

### 4.5 Monthly cost by stage

| Stage | Hosting | Data | Venue | Other | Total |
|---|---|---|---|---|---|
| 1–3 | Vercel Pro, already paid; +≈ $3–6 usage inside the $20 credit | Binance public, $0 | none | Firebase free tier, Telegram free | **≈ $0 extra** |
| 4 | + Railway Hobby $5 (Delta trading keys need a fixed IP) | $0 | Delta testnet, $0 | | **$5** |
| 5 | Railway $5 | $0 | Delta live: 0.02/0.05% + GST per side | a CA's fee, once | **$5 + fees** |

Optional, not required by the bot: TradingView Essential ($14.95) if you want its alerts on your phone as well.

### 4.6 The model as the bot will encode it (version 0 — every number is a trial)

The five checklist lines in the playbook become five stages, on three timeframes:

| Step (your words) | Timeframe | Detector | Default parameter |
|---|---|---|---|
| HTF bias / trend | 1D and 4H | direction of the last confirmed structure break (BOS/CHoCH) | pivot lookback 5 |
| DR, MS | 1H → 15m | dealing range = last swing high to swing low; premium/discount; OTE 0.62–0.79 body-anchored; 15m structure | pivot lookback 5; range from the last two confirmed swings |
| Liquidity sweep | 15m / 5m | wick beyond a pool (equal highs/lows within 0.1 × ATR(14) confirmed after 3 bars; PDH/PDL; session high/low), close back inside within 2 bars | tolerance 0.1 × ATR, window 2 bars |
| Displacement | 5m | a candle with body ≥ 1.5 × ATR(14) and body ≥ 70% of its range, moving away from the sweep | 1.5 × ATR, 0.70 |
| Entry — FVG / OB | 5m | the FVG or order block the displacement leaves; limit at the FVG midpoint (or OB open), valid 6 bars; stop just beyond the sweep extreme; target the opposite dealing-range extreme or nearest pool; pass if R < 2 | validity 6 bars; min R 2 (playbook's ideal R) |
| Killzone gate | clock | New York 08:00–11:30 and London 02:00–05:00, `America/New_York` | your data: 36 of 73 trades sit in 19:00–21:00 IST |

Fewer than ten parameters, on purpose: each one is a backtest trial and the literature's ceiling for five years of
data is in the tens. None of these defaults is claimed to be right. They are the published practitioner values,
chosen so that the calibration loop starts from something rather than nothing.

---

## 5. Staged roadmap

Every stage has an entry gate, something you watch while it runs, a kill criterion written down *before* it is
built (the expand-prove-cut discipline of `docs/lifecycle.md`), an exit cost, and its risk in plain English.
Changing a kill criterion after the fact requires a written reason in section 10.

| # | Stage | You get | Gate to enter | Kill criterion | Exit cost |
|---|---|---|---|---|---|
| 0 | Decide | this document | — | — | — |
| 1 | **Markup bot** | six coins marked up twice a day, a page with the chart drawn, a Telegram card, a calibration queue | none | after 4 weeks: agreement < 70% after two parameter revisions, or you open the card on < 50% of trading days | reversible |
| 2 | **Model detector** | live Mayne 5-minute sequence detection in your killzones on BTC/ETH/SOL, with a full plan per signal, take/pass buttons, outcomes computed | stage 1 agreement ≥ 70% | over 4 weeks: < 8 signals in total (starved) or > 5 per coin per session (noise), or you rate < 50% of signals "valid by my eye" | reversible |
| 3 | **Backtest + shadow** | a causal backtest over 2024–2026 with costs; a forward log of every live signal, its paper outcome and your take/pass; the "bot versus you" digest | stage 2 alive | out-of-sample expectancy ≤ 0 after two honest parameter passes → the model as written has no edge on this data; keep stage 1, drop stage 4, try the next model | reversible |
| 4 | **Paper execution** | bracket orders placed on the Delta India testnet, first on your tap, then automatically inside killzones | ≥ 100 forward signals, forward mean R after costs ≥ +0.1R, out-of-sample backtest mean R ≥ +0.1R with profit factor ≥ 1.2 over ≥ 300 events, worst 20-signal run better than −12R | execution error rate > 5% or realised costs > 2× modelled after 30 orders | reversible |
| 5 | **Live, small** | real orders on Delta India under caps, kill switch on the page | stage 4 clean for 30 orders + your explicit go + a CA's answer on tax | rolling 30-trade expectancy < 0 or drawdown > 8% → auto-disable, review before re-enable | **sticky** |
| 6 | Later | second model (ICT NY open), more coins, TradeGenie Phase B analytics over signal-linked trades | stage 5 stable for 3 months | — | — |

### Stage 1 — Markup bot (the co-pilot's eyes)

*What it does.* Every minute, for each of the six coins, it refreshes candles and recomputes: bias per timeframe,
the dealing range with premium/discount and the OTE band, unmitigated FVGs and order blocks on 4H/1H/15m,
liquidity pools above and below, and the killzone clock. At 11:00 and 17:00 IST it posts a card per coin to Telegram
and refreshes the Today page. The coin page draws all of it on the chart.

*What you watch.* Your own morning read against the bot's. Each marking on the page has two buttons: **agree** and
**wrong** (with an optional one-line reason). A weekly report shows agreement by marking type.

*Why the calibration loop is the whole point.* Three of your twelve concepts have one agreed definition. The rest
need numbers ICT never gave, and the bot's numbers will not match your eye at first. Every "wrong" is a definition
being tightened in your words, and it is also the learning system: you will find out, marking by marking, what you
actually mean by an order block.

*Kill criterion.* After four weeks, if agreement on bias, range and liquidity is below 70% after two parameter
revisions, or you opened the card on fewer than half of trading days, the bot is not replacing chart time and the
approach needs rethinking, not more features.

*Risk.* None financial. Four to six sessions of build time.

### Stage 2 — Model detector

*What it does.* Runs the sequencer from section 4.6 on BTC, ETH and SOL inside the killzones. When the sequence
completes it posts a signal: coin, direction, the five steps with what satisfied each ("swept PDL at 62,410 at
18:07; displacement 2.1 × ATR; 5m shift at 18:22; FVG 62,590–62,680"), the entry, stop, target, R and size at your
paper risk setting, and the SignalDesk snapshot for context. Two buttons: **take** and **pass**, with a reason
chip (FOMO, not convinced, thin, news, other). The outcome resolver later marks it stop, target or timeout from the
candles and computes R, MAE and MFE.

*What you watch.* The New York window, with the bot doing the watching. You still trade by hand in TradingView
paper if you take one; the bot just records that you did.

*Kill criterion.* Over four weeks, fewer than eight signals in total means the sequence as written almost never
completes and the parameters or the model are wrong; more than five per coin per session means it is noise. If you
rate fewer than half of signals "valid by my eye" the detector is not encoding your model.

*Risk.* None financial. Three sessions.

### Stage 3 — Backtest and shadow

*What it does.* Loads 1-minute history from data.binance.vision for BTC, ETH and SOL from January 2024, runs the
**same** sequencer and outcome resolver over it with costs (taker 0.05% both sides plus 18% GST, 3 basis points
adverse slip per side, funding at the venue's interval, stop-first when stop and target share a candle), and
reports by month: signal count, win rate, mean R, profit factor, drawdown in R, worst 20-signal run. Parameters are
fitted on January 2024 – June 2025 across at most nine parameter sets; July 2025 – August 2026 is not looked at
until the parameters are frozen, then run once. Forward, the shadow table fills itself from stage 2's signals, and
the weekly digest compares three lines: all signals, signals you took, signals you passed.

*What you watch.* Whether the forward numbers look like the out-of-sample backtest numbers, and whether your
take/pass filter helps or hurts.

*Gate to stage 4.* At least 100 forward signals (at three coins and two windows a day, expect four to ten weeks);
forward mean R after costs at least +0.1R; out-of-sample backtest mean R at least +0.1R with profit factor at least
1.2 over at least 300 events; worst 20-signal run better than −12R. **Say plainly: at 100 signals the standard error
of mean R is about 0.15R, so this gate cannot prove an edge. It is a decision rule for spending $5 a month and
testnet time, not a proof. The proof is scheduled to accumulate during stages 4 and 5 at tiny size.**

*Kill criterion.* If the out-of-sample expectancy is at or below zero after two honest parameter passes, the model as
you have written it has no edge on this data. That is a real result, not a failure: stage 1 keeps earning its place,
stage 4 is dropped, and the next model (ICT NY open) goes through stage 2 and 3. Do not add a tenth parameter to
rescue it.

*Risk.* None financial. Two sessions plus the calendar time for signals to accumulate.

### Stage 4 — Paper execution on the testnet

*What it does.* The execution adapter's second implementation places the bracket (entry limit, stop-market,
take-profit) on the Delta Exchange India testnet: first only when you tap **take**, then, once 30 tapped orders have
gone through cleanly, automatically for every signal inside the killzones. It measures realised slippage and fees
against the backtest's assumptions and reports the gap.

*What changes in hosting.* Delta's trading keys require IP whitelisting, so the runner moves to Railway ($5, always
on, Singapore, deploys from GitHub). Nothing else moves.

*Kill criterion.* Execution errors above 5% of orders, or realised costs more than twice what the backtest charged,
after 30 orders.

*Risk.* None financial. Two sessions plus a browser afternoon on the Delta testnet.

### Stage 5 — Live, small

*Caps, set before the first order and enforced in code:* risk per trade 0.5% of a dedicated small account; at
most two open positions; daily loss cap 1.5%, weekly 3%; the bot disables itself when a cap is hit and stays
disabled until you re-enable it on the page; a kill switch that cancels everything; a Telegram message for every
order event. **Nothing here is advice on how much to trade; the numbers are the smallest that make the exchange's
minimum order sizes work, and you set them.**

*Gate.* Stage 4 clean, your explicit go, and a chartered accountant's written answer to the questions in
section 3.3 — the tax treatment of perp P&L in India is unsettled and the two exchanges disagree with the tax firms.

*Kill criterion.* Rolling 30-trade expectancy below zero or drawdown beyond 8% of the account: auto-disable.

*Exit cost.* Sticky: real money, tax records, an exchange account with API keys.

---

## 6. Action plan — the first three stages as sessions

Each task is sized for one Claude Code session run under the autopilot protocol, with a done-check that can be
verified at runtime. Everything you do is a browser step and is listed as such. Nothing here places an order.

### Before session 1 — your browser steps (about twenty minutes)

1. **GitHub** → New repository → name `tradebot` (or whatever you prefer), private, under `instatank`. Empty is
   fine; the first session scaffolds it.
2. **Firebase console** (console.firebase.google.com) → Add project → name it `tradebot` → create a Firestore
   database in **asia-south1** (Mumbai) or **asia-southeast1** (Singapore) → Project settings → Service accounts →
   Generate new private key. Keep the JSON; you will paste it into Vercel, never into chat.
3. **Telegram** → message @BotFather → `/newbot` → note the token. Send the new bot one message from your account so
   it can reach your chat; the chat id is the same one SignalDesk uses.
4. **Vercel dashboard** → Add New → Project → import `instatank/tradebot` → Deploy once (it will fail until the
   scaffold exists; that is fine). Then Settings → Environment Variables: `FIREBASE_SERVICE_ACCOUNT`,
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `CRON_SECRET` (any long random string), `SITE_PASSWORD`,
   `SIGNALDESK_SNAPSHOT_URL` and `SIGNALDESK_SNAPSHOT_TOKEN` (the same values TradeGenie holds).
5. Tell the session the repository name. Region pinning to `sin1`, the cron schedule and everything else lives in
   `vercel.json` and is the agent's job.

### Stage 1 sessions

| # | Session | Builds | Done-check (verified at runtime, not by a green build) |
|---|---|---|---|
| 1.1 | **Scaffold + candles + deploy** | Next.js/TS app; `vercel.json` (sin1, crons); Firestore client; `lib/candles.ts` ported with its fixture mode; `/api/cron/tick` fetching 1m candles for the six coins and writing `state/{symbol}.candlesFreshAt`; a `/health` page; password gate; CLAUDE.md carrying the rules from this document (causal detectors, no execution, kill criteria) | `/health` on the production URL shows six coins with 1m candles less than two minutes old, fetched from `sin1`. The cron runs every minute (visible in Vercel → Logs). Unit and smoke gates exist and pass. |
| 1.2 | **Engine core** | pure functions: ATR, swing pivots, structure (BOS/CHoCH, internal and swing), dealing range + premium/discount + OTE, liquidity pools (EQH/EQL, PDH/PDL/PWH/PWL, session H/L), FVG with mitigation, order block with mitigation, breaker; a causality test harness that streams candles one at a time and asserts nothing changes retroactively; fixtures from a real week of BTC 1m with hand-marked expectations | All detector tests pass, including the causality suite. A CLI over the fixture prints markings for a chosen day that match a hand-marked chart (three hand-checked markings per detector minimum, written before the code). |
| 1.3 | **Runner + Today + coin page + Telegram** | every-minute state update; twice-daily markup job; Today page (six cards, killzone clock in IST with the New York rule); coin page drawing markings on the reused chart; Telegram card formatter | A markup card arrives on Telegram at 11:00 and 17:00 IST (you confirm receipt); the Today page and each coin page render in production with real markings; a doubled cron invocation does not double-post (tested by calling the route twice). |
| 1.4 | **Calibration loop** | agree/wrong per marking with reason; `calibration` collection; weekly agreement report by marking type; a settings page for the parameters in section 4.6 with the trial counter | Pressing **wrong** on a marking shows up in the report; changing a parameter bumps the trial counter; the report is posted to Telegram on Sunday evening. |

### Stage 2 sessions

| # | Session | Builds | Done-check |
|---|---|---|---|
| 2.1 | **Sequencer + plan builder** | sweep and displacement detectors; the five-stage state machine per symbol; killzone gate on `America/New_York`; plan builder using the calculator's sizing maths; fixtures from two real historical sequences chosen by hand | The fixtures produce exactly the expected signals and no others; a sequence outside the killzone produces none; the plan's size equals what the calculator page shows for the same numbers. |
| 2.2 | **Alerts + signal log + take/pass** | `signals` collection; Telegram alert with inline take/pass buttons and reason chips; the SignalDesk snapshot attached to each signal; signals page | A real signal (or a replayed one via a debug route) posts to Telegram, the button press lands on the signal document, the snapshot fields are populated. |
| 2.3 | **Outcome resolver + dashboard** | stop/target/timeout resolution from candles, R, MAE, MFE; signals dashboard with per-coin and per-window stats greyed under `MIN_SAMPLE` | Replayed signals over a known week resolve to hand-computed outcomes; the dashboard refuses colour under five signals. |

### Stage 3 sessions

| # | Session | Builds | Done-check |
|---|---|---|---|
| 3.1 | **History + backtester + costs** | data.binance.vision loader (monthly 1m zips → Firestore-free local cache on the function's disk or a storage bucket); the backtest runner over the same sequencer; cost model (fees + GST, slip, funding, stop-first); monthly report | A backtest over one known month reproduces the stage-2 fixtures' signals exactly; removing the cost model changes the result (proving it is applied); the run is recorded in `backtests` with its parameter set and trial number. |
| 3.2 | **Walk-forward + shadow digest + gate report** | in-sample/out-of-sample split with the frozen-parameter rule enforced in code (out-of-sample months cannot be run until parameters are marked frozen); shadow table; weekly "bot versus you" digest; the stage-3 gate report with every threshold from section 5 evaluated | The gate report prints pass/fail per criterion with the numbers; the out-of-sample run refuses to execute on unfrozen parameters (tested); the digest arrives on Telegram. |

Stages 4 and 5 are specified in section 5 and will be planned in the same shape once stage 3's gate report exists.
Planning their sessions now would be planning against numbers that do not exist yet.

---

## 7. The learning by-product

This is deliberately short. It is what falls out of the stages above, not a separate build.

- **Calibration is supervised disagreement.** Every marking you mark wrong tightens a definition in your own words,
  and the weekly agreement report tells you which of the twelve concepts you and the bot still see differently.
  That list *is* your curriculum.
- **Every signal explains itself in your vocabulary.** The card names the five steps and what satisfied each, using
  the same labels as the journal's mechanism chips. Reading forty of those is faster than watching forty sessions.
- **Shadow mode grades your discretion.** Three lines on the weekly digest — all signals, the ones you took, the
  ones you passed — answer the question no journal can: does your take/pass filter add or subtract. If "passed"
  outperforms "taken", your instinct is inverted and you know it in numbers.
- **The journal fills itself.** Setup, mechanisms, timeframes, stop and target arrive on the trade from the signal,
  so the analytics that were empty on 74 of 74 trades start working without a tagging pass.
- **Replay.** The coin page can scrub through a signal the way the trade page replays a trade, so a missed session
  can be watched afterwards.

## 8. Feedback on TradeGenie and SignalDesk, limited to what changes the bot's design

**TradeGenie**
- The mechanism, timeframe and checklist fields exist and are empty on every trade. The bot is the first thing that
  will fill them, via the signal → trade link (Phase B in `TRADEGENIE_BRIDGE.md`). Do not build any other way of
  filling them.
- The morning check-in asks you to type markets watched and a focus, and you have done it 11 times in 13 weeks.
  Once stage 1 exists, the bot's card *is* the morning read; the check-in should accept it rather than compete.
- `lib/candles.ts`, `lib/excursion.ts`, the replay chart and `lib/calculator.ts` are the bot's seed. Copy them
  into the new repository at first; extracting a shared package is a later refactor, not a stage-1 task.
- Nothing about execution should ever be added here. The brief says so and the bot's existence makes the rule
  easier to keep, not harder.

**SignalDesk**
- `/api/snapshot` is the right channel for context on a signal and needs no change.
- Its screener answers "which coins are strong or crowded"; the bot's markup answers "what is the structure on
  the coins I trade". Different questions; keep them apart.
- Its `/api/ingest` cron, `sin1` pin and Telegram code are the deploy template. Copy the shape.
- Later, a one-line "structure" section in the morning briefing could be fed by the bot's markup. Not before
  stage 1's agreement rate says the markup is worth quoting.

## 9. Open questions for you, ranked by how much the answer changes the plan

Each has the default that was used, so nothing above waits on an answer.

1. **Killzone windows.** Default: New York 08:00–11:30 and London 02:00–05:00, New York time, which is 17:30–21:00
   and 11:30–14:30 IST in US summer and an hour later in winter. Your trades cluster 19:00–21:00 IST. If you only
   ever trade the New York window, say so and London is dropped from detection (markup still runs).
2. **Paper risk setting.** Default: 1% of a ₹1,00,000 paper account per signal. It only affects the size printed on
   the card and the R-to-rupee conversion in the shadow table.
3. **Detection universe.** Default: BTC, ETH, SOL detect; HYPE, ZEC, VVV markup only. If you want HYPE detected
   from day one, it is one line in settings, and its signals will be reported separately because the book is thin.
4. **Telegram.** Default: a new bot from BotFather posting to the same chat SignalDesk uses. The alternative is
   reusing SignalDesk's bot token, which couples the two apps' secrets.
5. **Repository name.** Default `instatank/tradebot`.
6. **Explanations by a language model.** Default: none. The signal card is templated from the detector output. If
   you later want a paragraph of prose under each signal, that is one Anthropic call per signal (a few paise each)
   and is the only place an LLM would enter the system.
7. **Tax.** Before stage 5, a chartered accountant answers the five questions in section 3.3. Nothing before stage 5
   depends on it.

## 10. Decisions — do not silently reverse these

Each entry is a choice a later session might be tempted to undo. Reversing one requires a new entry here with
the reason.

- **D1 — A separate application.** The bot lives in its own repository, Vercel project and Firebase project.
  TradeGenie never executes (PROJECT_BRIEF non-goal, enforced in code); SignalDesk never holds exchange keys.
- **D2 — One detector library.** Live detection, backtesting and the calibration page all run the same pure
  functions. No Pine Script reimplementation; TradingView stays the manual chart. Two definitions of "order block"
  is the two-tokenizer mistake.
- **D3 — Causal only.** No detector may read a candle later than the one being evaluated. Enforced by a streaming
  test that fails if any output changes retroactively. The popular Python library's look-ahead inflated a measured
  profit factor from 1.8 to 7.3; that is the failure being prevented.
- **D4 — Co-pilot before autopilot.** Take/pass stays human until the stage-3 gate passes; auto-execution first on
  testnet, then live only under caps set in advance and enforced in code.
- **D5 — No language model in the detection path.** Detectors are deterministic code. An LLM may write explanation
  text at most, and only if asked (question 6).
- **D6 — Universe.** Detection on BTC, ETH, SOL; markup on all six SignalDesk coins; thin coins reported separately
  if ever detected.
- **D7 — Binance candles as the proxy for every venue.** Validated by the journal's own probe: 36 of 36 real CoinDCX
  fills inside their Binance 1-minute candle, tightest 0.017% wide.
- **D8 — Hosting.** Vercel Pro every-minute cron in `sin1` for stages 1–3; Railway ($5, Singapore) from stage 4
  because Delta's trading keys need a fixed IP. No always-on host before then.
- **D9 — Venue path.** Paper simulator → Delta Exchange India testnet → Delta India live, with CoinDCX INR-margined
  as the alternative, behind one execution-adapter interface.
- **D10 — Parameter budget.** At most nine parameter sets in-sample; out-of-sample months locked in code until
  parameters are frozen; every backtest run recorded with its trial number. A tenth parameter to rescue a model is a
  kill, not a fix.
- **D11 — Kill criteria are pre-registered** in section 5 and changed only with a dated reason here.
- **D12 — The markup bot earns its place on its own.** If stage 3 kills the model, stage 1 stays. Its value is
  measured by the agreement rate and by whether you open the card, not by P&L.
