# Mayne 5M Model — the specification the detectors will encode

The written record of TraderMayne's 5-minute model, assembled from a NotebookLM extraction of his
own videos (13 September 2026). It replaces the placeholder table in `TRADING_ENGINE_ROADMAP.md`
section 4.6 and is the spec sessions 1.2 and 2.1 build against.

> **The extraction is detailed about sequence and thin to empty about numbers.** It answers what
> has to happen, in what order, and when to stand aside, at length and with direct quotes. It
> answers **NOT STATED** to every question about a threshold — pivot width, displacement size,
> sweep window, FVG minimum, order-block anchor, entry point inside a gap, session times. So the
> shape of this model is his and **every number the detector actually runs on is ours.**

---

## How to read this file

**Evidence, not truth.** This is one model's summary of another person's videos. Where a claim is
quoted verbatim it is treated as his; where it is paraphrased it is treated as probably his;
where it reads more precise than a man talking over a chart plausibly would be, it is flagged in
place rather than encoded.

**There are no timestamps. Not one.** Every answer opens with *"Timestamps: NOT STATED (No
timestamp metadata exists in the provided transcript text)"*. The bracketed numbers the extraction
carries — `[37–38]`, `[104–105]`, `[1–135]` — are NotebookLM **source-chunk indices**, not clock
positions in a video. They are reproduced here as a way back into the source material, never as
citations that can be checked against a video. This is the single largest weakness in the
provenance of this document: the brief for this work said *"where it carries a timestamp and a
quote, trust it"*, and no claim below carries a timestamp. Quotes are all we have.

**The SOURCE column is exactly one of three values.**

| SOURCE | Means |
|---|---|
| **STATED** | He says it. A quote is given where the extraction supplies one. |
| **SHOWN** | Not said, but visible in a chart walkthrough. The inference is written out. |
| **OURS** | He never says it and we picked a number. Every one is listed again in the last section. |

**Citations** are to the extraction prompt (`Q1`–`Q9`) and, where the extraction names one, to the
video (`V12`, `V13`, `V15`, `V22`).

---

## 1. Two frameworks, not one

The extraction makes a structural point that the roadmap's section 4.6 does not currently carry, and
it changes how the detector should be laid out.

- **The top-down analysis is four steps** (V12): *1. Weekly/Daily bias → 2. H4 context → 3. H1
  setup → 4. M5 execution.*
- **The 5-minute model is five steps** (V13), and it is **step 4 of the top-down**, not a parallel
  thing: *"I'm going to break this down into a super easy to understand process by breaking it up
  into five steps okay so there's five steps for the five-minute model"* (Q1, V13).

So "the Mayne 5M model" is a **low-timeframe entry trigger that only runs once a higher-timeframe
process has already chosen a zone and a direction.** The bot's stage-1 markup is the first three
top-down steps; the stage-2 sequencer is the five-step trigger. Conflating the two is what the
owner's own checklist does (section 10 below).

One quoted line is attached in the extraction to 5M-model step 1 but almost certainly belongs to
the top-down frame: *"you do not go to the five-minute chart until you have steps one through three
completed"* (Q1). Under the 5M model, steps 1–3 are *zone tag → MSS → displacement*, and going to
the 5-minute chart is how you observe steps 2 and 3 in the first place. Read as the top-down's
steps 1–3 it is coherent. **Treated here as an extraction artefact, not as a rule.**

---

## 2. The sequence, in his step order

His words for the steps, and what each one requires. The gating quote for the whole sequence:
*"all of them have to happen and they have to happen in order"* (Q1, V13).

### Step 1 — Price reaches the high-timeframe zone

Price must **trade into** the HTF zone, *"not close to it it has to trade into it"* (Q1). No tag,
no setup: *"if it does not come into the zone there is simply no trade"* (Q1), and *"no tag of the
zone there's no setup"* (Q4).

The zone comes from the top-down steps: an order block, a fair value gap, OTE, an SFP, a liquidity
sweep, or equal highs/lows, on **Weekly, Daily, H4 or H1** (Q1).

**Not a step: the liquidity sweep.** A sweep is one of several things that can *make* a zone. It is
not a required stage of the five. This is the single biggest disagreement with the owner's
transcribed checklist, and with roadmap 4.6 as written — see section 10.

### Step 2 — Market structure break on the 5-minute chart

Once price is inside the zone, the 5-minute chart must break structure **in the direction of the
trade**. Bullish: *"you're looking for the most recent lower high on the five-minute chart to get
broken"*. Bearish: *"you're going to wait for that last 5minute higher low to get broken"* (Q1).

Its job is confirmation that the HTF level is holding (Q3, chunks 104–105).

**Whether "broken" means a body close beyond the level or a wick through it is NOT STATED** (Q2).
He uses "broken" and "taken out" throughout and never draws the distinction. He also uses **MSB and
MSS interchangeably**, which standard ICT does not (Q8).

### Step 3 — Displacement

The structure break must come with a displacement candle: a *"strong, aggressive expansion candle
(or series of candles)"* that **creates a fair value gap**, confirms the break is not a fakeout, and
signals *"institutional sponsorship with the big money behind you"* (Q1, Q2).

Three things matter for the detector:

- **The FVG requirement is stated, not inferred.** Displacement that leaves no gap is not
  displacement in his usage. That is a real, testable conjunction and it is his.
- **Displacement may span more than one candle**: *"displacement can be one candle it can be
  multiple candles"* (Q2). Our detector defines it per-candle. That is a narrowing, and it is ours.
- **No number of any kind.** *"ATR Multiples, Percentage Sizes, or Ratios Attached: NOT STATED"* (Q2).
- **He contradicts himself on whether it is mandatory** — see section 9.

### Step 4 — Pull back to the fair value gap, and enter

*"don't chase use patience your entry is on a pullback at the fair value gap"* (Q1).

How you execute once price is there is **explicitly left to preference** (Q3): at market on the
tag, a resting limit in the gap, or wait for a reaction on a lower timeframe first. **Where in the
gap — near edge, midpoint, far side — is NOT STATED** (Q3).

An FVG alone is enough; it does not need to be stacked with an order block or breaker (Q8).

### Step 5 — Stop and target

- **Stop:** *"your stop loss is going to go above or below the fiveminute level"* — the 5-minute
  swing high or low that existed before the break (Q1). Optionally wider, beyond the HTF zone, which
  he calls safer for reversals (Q3, chunks 41–42).
- **Target:** *"your target are going to be based on the high time frame"* (Q1) — HTF equal
  highs/lows, dealing-range extremes, liquidity pools.
- **Minimum 2:1.** *"if it's not a 2:1 setup based on where you're entering that's not a trade
  that I'm going to be interested in taking"* (Q3).

---

## 3. Every parameter a detector needs

One row per parameter, with where the value comes from. `ATR` throughout means Wilder ATR over
`atrPeriod` bars.

### Bias and structure

| Parameter | Value | SOURCE | Citation |
|---|---|---|---|
| Bias timeframes | Weekly + Daily (default). Interchangeable pairs: Monthly+Weekly, or Daily+H4, as long as the top-down hierarchy holds | STATED | Q2 |
| What makes bias bullish | Structure broken to the upside / a higher high on the HTF chart | STATED | Q2 |
| What makes bias bearish | Structure broken to the downside / a lower low | STATED | Q2 |
| Ranging HTF | No bias — stand aside, do not trade either side | STATED | Q2, Q4 disqualifier 1 |
| Daily-close decile rule | A daily close in the **upper or lower 10%** of its own range sets the next day's bias | STATED | Q2 — see note D below |
| Decile follow-through (long side) | Next daily takes the high: **86% BTC / 91% ETH / 89% SOL** | STATED | Q2 |
| Decile follow-through (short side) | Next daily takes the low: **~90%** | STATED | Q2 |
| Mid-range daily close | No bias. 40–45% either side, **25%** chance of an inside day | STATED | Q2, Q4 |
| Prior-period liquidity takeout | Daily ~80% (4 of 5), Weekly ~84% (5 of 6), Monthly ~86% | STATED | Q2 |
| Execution timeframe | 5-minute | STATED | Q1, V13 |
| Execution timeframe (variant) | 15-minute, with an H1 breaker and no drop to M5 | SHOWN | Q6/Q9, V22 — a whole worked trade is executed this way |
| `swingLookback` — bars either side before a pivot counts | **5** | **OURS** | Q2: *"NOT STATED … never states a specific candle count rule"* |
| Structure break confirmation — close beyond vs wick through | **close** | **OURS** | Q2: NOT STATED |
| `atrPeriod` | **14** | **OURS** | never mentions ATR at all |

> **Note D — the decile rule is new, and it lands on the one mechanism the roadmap called
> discretionary.** Roadmap 3.2's table marks HTF bias **Discretionary**, "which timeframe, what
> counts as bias". The extraction supplies a fully mechanical alternative: take yesterday's daily
> candle, compute where it closed within its own high-low range, and if that is inside the top or
> bottom decile you have a directional expectation with a stated hit rate. That is precisely the
> case roadmap 3.2 said to flag rather than quietly settle. It is **not encoded in version 0** —
> it is a second, independent bias source whose interaction with "direction of the last confirmed
> structure break" is unspecified, and reconciling two bias rules is a design decision, not a
> parameter. Recommended for session 1.4's calibration page as a displayed fact next to the
> structural bias, so the owner can see how often they disagree before either is trusted.

### Dealing range, premium and discount

| Parameter | Value | SOURCE | Citation |
|---|---|---|---|
| Range anchors | The most recent **significant** swing high and swing low | STATED | Q2, Q8 |
| What "significant" means | — | **NOT STATED — the largest hole in the model** | Q2; see section 12 |
| Range lookback (bars or days) | **last two confirmed swings** | **OURS** | Q2: *"No specific lookback period … is stated; it is determined visually"* |
| Equilibrium | **50%** of the range | STATED | Q2, Q8 |
| Premium / discount | Above 50% is premium (expensive), below is discount (cheap) | STATED | Q8 |
| Premium ≠ short, discount ≠ long | He explicitly cautions against reading them as direction signals | STATED | Q8 — flagged as a difference from common ICT usage |
| Discount long win rate | ~45% vs ~37% in premium | STATED | Q2 |
| "2.5× more likely in a discount" | **Do not encode — internally inconsistent** | STATED but suspect | Q2; 45/37 is 1.22×, not 2.5×. Two different measurements have probably been merged by the extractor. |
| `oteLow` / `oteHigh` | **0.62 / 0.79** | **OURS** | Q8 defines OTE only as *"a deep retracement zone located below the 50% equilibrium"* — no numbers anywhere |
| OTE anchor — body or wick | **body** | **OURS** | never addressed |

### Liquidity

| Parameter | Value | SOURCE | Citation |
|---|---|---|---|
| Which levels are pools | Prior **daily, weekly and monthly** highs/lows; **equal highs/lows** (double or triple); dealing-range extremes (external range liquidity); points of interest, order blocks and FVGs inside the range (internal range liquidity) | STATED | Q2, Q8 |
| Session high / low as a pool | **not used** | **OURS if kept** | he never mentions sessions at all — see section 11. Recommended **off**. |
| A pool is consumed when tagged | Pools are marked *spent or unspent* once tagged | STATED (loosely) | Q3 |
| `equalToleranceAtr` | **0.1 × ATR** | **OURS** | Q2: NOT STATED |
| Pool confirmation bars | **3** | **OURS** | Q2: NOT STATED |
| Sweep — must price close back inside? | **yes** | **OURS** | Q2: *"never states a required candle count or a strict rule demanding a close back inside"* |
| `sweepCloseBackBars` | **2** | **OURS** | Q2: NOT STATED |
| Sweep of a weekly level → 50% retrace of that weekly range within 5 days | ~50% | STATED | Q2 |
| … → full reversal to the opposite weekly extreme | 1 in 6 (16.7%) | STATED | Q2 |
| … average pullback depth | 3–4% BTC/ETH, ~6% SOL | STATED | Q2 |
| Prior-day-low sweep **early** in the day → green daily close | 37% | STATED | Q2 |
| Prior-day-low sweep **late** in the day → green daily close | 17% | STATED | Q2 |
| Sweeps both prior-day low then high, same day | 1 in 5 (20%) | STATED | Q2 |

### Displacement

| Parameter | Value | SOURCE | Citation |
|---|---|---|---|
| Must create a fair value gap | **yes** | STATED | Q1, Q2 |
| Must accompany the structure break | **yes** (but see section 9 — he relaxes this later in the same video) | STATED | Q1 |
| May span multiple candles | **yes** | STATED | Q2: *"displacement can be one candle it can be multiple candles"* |
| Detector span | **one candle** | **OURS** (a deliberate narrowing of his rule) | — |
| `displacementAtrMultiple` | **1.5** | **OURS** | Q2: NOT STATED |
| `displacementBodyRatio` | **0.70** | **OURS** | Q2: NOT STATED |

### The entry zone

| Parameter | Value | SOURCE | Citation |
|---|---|---|---|
| FVG 3-candle definition | candle 3's low above candle 1's high (bull), and the mirror | **OURS** | Q3: *"does not detail the 3-candle structural definition in these transcripts"* — the rule is ICT's, not his |
| `fvgMinAtr` | **0 (off)** | **OURS** | Q3: NOT STATED |
| Entry point within the gap | **midpoint** | **OURS** | Q3: NOT STATED; and Q3 records that execution style at the gap is *"personal preference"* — so this is a choice he declines to make, not one he made differently |
| Entry order type | resting limit | **OURS** | Q3: he offers market-on-tag, resting limit, or wait-for-LTF-reaction as equally valid |
| `entryValidityBars` | **until the setup is invalidated** (price closes beyond the stop level), **not a bar count** | **OURS** | see note E |
| Order block — which candle | the candle whose move caused the structure break | STATED (qualitatively) | Q8; the exact candle-selection rule is NOT STATED (Q3) |
| `orderBlockZone` — body or whole candle | **wick** | **OURS** | Q3: NOT STATED |
| Order-block mitigation / when it is spent | **wick touch** | **OURS** | Q3: *"does not state a specific invalidation or consumption rule"* |
| `orderBlockLookbackBars` | **10** | **OURS** | never addressed |
| Breaker | a failed order block or level that swept liquidity and now acts as a point of interest on return | STATED | Q8 |

> **Note E — the 6-bar validity window in the old roadmap table is contradicted by his own worked
> example.** In the BTC short (section 7, trade 1) the 5-minute FVG formed and price came back to
> tag it *"at 14:00 (nearly 12 hours later)"* (Q6). Twelve hours on a 5-minute chart is roughly
> **144 bars**. A 6-bar expiry would have discarded the only entry whose timing he actually shows.
> So validity is redefined structurally: the gap stays armed until the setup is invalidated (a
> close beyond where the stop would sit) or the target is reached. This costs no parameter trial,
> and it survives his example. It is still ours — he never says it.

### Stop, target, risk

| Parameter | Value | SOURCE | Citation |
|---|---|---|---|
| Stop anchor (default) | above/below the **5-minute swing high/low that preceded the break** | STATED | Q1, Q3; and SHOWN in all four chart walkthroughs |
| Stop anchor (alternative) | beyond the **HTF zone** — he calls this safer for reversals | STATED | Q3, chunks 41–42. V12 states it as the rule; V13 and every walkthrough use the 5-minute level — see section 9 |
| Stop buffer beyond the level | **0** | **OURS** | Q3: *"No fixed point/pip distance or specific 'sweep wick' stop distance rule is given"* |
| Target | HTF liquidity: equal highs/lows, dealing-range extremes, HTF points of interest | STATED | Q1, Q3 |
| Fixed R target | **no** — targets are structural levels | STATED | Q3 |
| Minimum reward-to-risk | **2:1** | STATED | Q3, Q4 disqualifier 3 — and it matches the owner's own `idealRiskReward: 2` |
| Partial exits | allowed, at internal range liquidity (5-minute or 4-hour swings, equal highs/lows) | STATED | Q3, Q5 |

### Time

| Parameter | Value | SOURCE | Citation |
|---|---|---|---|
| Session windows / killzones | **NOT USED — he never uses the word and never gives a session time** | — | Q8: *"NOT USED"*; Q3: *"Session Times in NY Time: NOT STATED"* |
| Killzone gate windows | London 02:00–05:00, New York 08:00–11:30, `America/New_York` | **OURS, entirely** | see section 11 |
| Day-of-week filter | none | STATED (as absent) | Q4: *"does not state any day-of-week disqualifiers"* |
| Time-based exit | none | STATED (as absent) | Q5: *"does not state any rule for closing a trade based on time"* |
| Time-of-day does matter, as a phase not a window | a prior-day-low sweep **early** in the day behaves differently from one **late** (37% vs 17% green close) | STATED | Q2 |

---

## 4. Entry, stop, target and minimum R — the plan the sequencer builds

| Field | Rule | SOURCE |
|---|---|---|
| Direction | The HTF bias. Counter-trend only at a major HTF zone with an LTF shift and displacement | STATED (Q4) |
| Trigger | 5-minute MSB in the bias direction, inside the tagged HTF zone, with displacement that leaves an FVG | STATED |
| Entry | Pullback into that 5-minute FVG. **Midpoint** of the gap, resting limit | OURS (he leaves the style open) |
| Stop | Beyond the 5-minute swing extreme that preceded the break, **zero buffer** | STATED anchor / OURS buffer |
| Target | Nearest HTF pool in the bias direction, or the opposite dealing-range extreme | STATED |
| Minimum R | **2.0**, computed to the first target. Below 2R the setup is rejected outright | STATED |
| Costs | R is computed **after fees**, using TradeGenie's `lib/calculator.ts` sizing maths | OURS — he never mentions fees or funding |
| Partials | Optional, at internal range liquidity between entry and the HTF target | STATED |

Note the stop rule in roadmap 4.6 before this revision read *"stop just beyond the sweep extreme"*.
**That is not what he says.** He anchors the stop to the 5-minute structural swing that preceded
the break. Where the sweep created that swing the two coincide; where the zone was tagged without a
sweep — which his model explicitly permits — they do not. Corrected in the new 4.6.

---

## 5. No-trade conditions

Seven are named as a numbered list of disqualifiers (Q4, V15); four more are scattered through the
other videos. Any one of them means no trade.

**The seven disqualifiers**

1. **No HTF bias.** *"If you cannot almost immediately tell whether the weekly daily or whatever
   you're using for the high time frame is bullish or bearish you have no trade."* Ranging counts:
   *"longs can work shorts can work but it's kind of more like a coin flip It's not high
   probability … So you have no trade."*
2. **Price in the wrong half of the range.** *"If you're bullish price isn't in the discount no
   trade If you're bearish price isn't in the premium no trade."*
3. **No clear liquidity target, or the maths fails.** *"If there's no clear liquidity there is no
   trade … If the math doesn't work it doesn't give you at least a 2:1 reward to risk You have no
   trade."*
4. **The model did not fully trigger.** *"The model has to play out fully before you consider
   taking a trade So if it doesn't fully trigger if you're skipping one of these steps that is a
   disqualifier."*
5. **Chasing.** *"We do business where we want to do business We don't chase price."* Missing the
   fill at the gap is not a reason to enter late.
6. **Major news.** CPI, FOMC, Non-Farm Payroll, earnings. *"So we don't trade the news I almost
   never trade any sort of news events … I just wait I let it happen I see what price is doing how
   the market's absorbing that news Then I step in."*
7. **Emotional state.** Anger, greed, fear, FOMO, tilt, revenge trading after losses, fatigue.

**Four more, from elsewhere**

8. **No tag of the HTF zone.** An LTF setup that forms without price trading into the zone is not a
   setup (Q1, Q4).
9. **Mid-range daily close.** *"when price closes in the middle of the range … that's a no bias day
   … you're coin flipping on direction and there's a 25% chance that we take out neither … easy day
   to sit out of the market."* (Q4)
10. **Conflicting timeframes.** Weekly bullish with the daily pulling back means stand aside from
    both sides: *"We're not going to rush into shorts and we're not going to rush into longs …
    We're going to wait for that daily pullback to complete."* (Q4)
11. **A structure break without displacement.** *"If there's no displacement it's a lot less likely
    to work."* (Q4) — but see section 9; he softens this.

**Explicitly absent:** day-of-week rules, any low-volatility or ATR floor, any session filter (Q4).

Six of the eleven are mechanisable from data the bot already has (1, 2, 3, 4, 8, 9, 11). Two are
mechanisable with a calendar the bot does not have (6 — news; SignalDesk already holds a
macro-event calendar, `config/macro-events.json`, which is the obvious source). Two are about the
trader, not the market (5, 7). One (10) needs a rule for what "the daily is pulling back" means
that he does not give.

---

## 6. Trade management after entry

| Question | Answer | SOURCE |
|---|---|---|
| Move the stop? | Yes — after partials you *"maybe adjust your stop or you trail it or you bring it to break even all that stuff comes later"* | STATED (Q5) |
| When exactly, and to where? | — | NOT STATED |
| Partials? | Yes, at internal range liquidity — *"internal range liquidity can be used for partials"*; 4-hour levels *"maybe that's where you take your first partial then you take more"* | STATED (Q5) |
| What fraction? | — | NOT STATED |
| Time-based exit? | No such rule | STATED as absent (Q5) |
| Re-enter after a stop-out? | **Yes, while the HTF zone is still valid.** *"this one could fail right you get smoked you get stopped out and then it does an MSB again gives you the setup the second time and this one works The trade idea is not wrong here It's wrong below that H4 fair value gap"* | STATED (Q5) |
| How many re-entries? | *"it might take multiple kicks at the can"* — no cap given | STATED / cap NOT STATED |
| More than one position on one idea? | **Yes.** *"yes you can absolutely compound and find multiple entries"* — the BTC walkthrough shows two 5-minute models inside one H4 zone | STATED + SHOWN (Q5, Q6) |

**Consequence for the sequencer.** The state machine in session 2.1 as drafted runs
`idle → swept → displaced → shifted → armed → filled or expired` — one pass, one position. His model
wants a zone-scoped machine that can arm repeatedly while the zone holds, and can hold concurrent
positions from it. The invalidation is the **HTF zone**, not the individual 5-minute stop. This is
noted in the revised session 2.1 prompt.

---

## 7. The worked examples

Five complete or partial walkthroughs. Prompts Q6 and Q7 were the same question asked twice and
returned the same five trades; they are not ten.

**These cannot become numeric test fixtures.** Not one entry price, stop price, target price or
result in R appears anywhere. What they can pin is **shape**: which timeframes stacked, which zone
types actually got used, what satisfied each step, and — in the BTC case — the one timing fact in
the whole extraction.

### Trade 1 & 2 — Bitcoin, short, with a compounded second entry

| | |
|---|---|
| **Instrument** | BTC |
| **Date** | *"the 11th"* shown on the 5-minute chart; entry tag at **14:00**. Month and year NOT STATED |
| **Timeframes** | W, D, H4, H1, M5 |
| **Step 1 — HTF bias** | Weekly broke structure down into a **weekly bearish FVG**, in premium (above 50% EQ). Daily bearish, also in premium |
| **Step 2 — H4 context** | A **4-hour bearish order block** that had itself caused a downside structure break; equal lows mapped below as the target |
| **Step 3 — H1** | Price trades up into that H4 OB zone |
| **Step 4 — M5** | Inside the zone: low → high → **lower low (MSB)** with displacement leaving **two** 5-minute FVGs. Price returns and tags the first FVG **at 14:00, nearly 12 hours later** |
| **Second entry** | A second M5 MSB + FVG at a lower high, still inside the same H4 zone |
| **Entry** | The first 5-minute FVG; then the second |
| **Stop** | Above the 5-minute swing high |
| **Target** | H4 equal lows, then weekly range lows |
| **Outcome** | Reached the H4 equal lows and continued to the weekly range lows |

The 12-hour gap between displacement and fill is the single most load-bearing number in this
document — it is what kills the 6-bar entry-validity window. See note E.

### Trade 3 — USD/CAD, long

| | |
|---|---|
| **Instrument** | USD/CAD |
| **Date** | NOT STATED |
| **Timeframes** | W, D, H4, H1. The M5 execution was not walked through |
| **Step 1** | Weekly flipped downtrend → uptrend on a weekly MSB, leaving a weekly bullish OB. Daily bullish, pulling back into a **daily OB nested inside the weekly OB** |
| **Step 2** | H4 dealing range puts an **H4 order block in the discount, at the OTE**; equal highs and the daily range high above as targets |
| **Step 3** | An **hourly breaker** producing an **SFP** directly inside the H4 order block |
| **Entry / Stop / Outcome** | NOT STATED |
| **Target** | Equal highs / daily range high |

### Trade 4 — Russell 2000, long

| | |
|---|---|
| **Instrument** | Russell 2000 (US2000) |
| **Date** | NOT STATED |
| **Timeframes** | W, D, H4, H1, M5 |
| **Step 1** | Weekly bullish. Daily bullish dealing range with a **daily OB in the discount at the OTE** |
| **Step 2** | Equal highs / range highs above as buy-side external liquidity; an **H4 OB nested inside the daily OB** |
| **Step 3** | Price trades down into the H4 zone on H1 and forms an **SFP** |
| **Step 4** | M5 downtrend into the zone → **higher high (MSB)** with a strong displacement candle leaving a clear FVG → pullback retests it |
| **Entry** | Retest of the 5-minute FVG |
| **Stop** | Below the 5-minute swing low |
| **Target** | H4 equal highs, daily range high liquidity |
| **Outcome** | Caught the *"pico low"* of the pullback and ran to the range highs and beyond |

### Trade 5 — a journaled crypto long

| | |
|---|---|
| **Instrument** | NOT STATED (from his own journal, shown during the crypto-statistics section) |
| **Date** | NOT STATED |
| **Timeframes** | W, D, H1, **M15** — no drop to M5 |
| **Step 1** | Weekly structure bullish, in a weekly bullish discount; a **weekly SFP inside a weekly FVG**. Draw on liquidity is external, above |
| **Step 2** | Prior daily candle closed in the **bottom 10% of its range** in a bullish discount; an **early-in-the-day sweep of the prior daily low** |
| **Step 3** | H1 breaker forms (sweep low → MSB → retest of the breaker); the **15-minute** entry model triggers (sweep below the low → MSB → displacement FVG) |
| **Entry** | Retest of the H1 breaker / M15 FVG |
| **Stop** | Below the sweep low |
| **Target** | External range liquidity / the weekly draw higher |
| **Outcome** | Swept the prior daily low early, reversed completely, expanded toward the weekly draw |

**What the set tells the detector.** Every one of the four fully-worked examples stacks the same
way: HTF bias → a **nested** zone (H4 OB inside a daily OB, or an H1 breaker inside an H4 OB) → LTF
trigger. Nesting is not in his five steps and is in every example. Three of the four zones were
order blocks; the fourth was a breaker. Two of the four had an **SFP or sweep inside the zone**
before the LTF trigger — which is how the sweep really functions in this model: as a quality signal
on the zone, not as a step of its own.

---

## 8. His vocabulary

One-sentence definitions in his usage, and where it diverges from standard ICT.

| Term | His usage | Divergence |
|---|---|---|
| **Bias** | Whether weekly and daily say price is more likely to go up or down, which governs everything lower | Standard, but he adds the statistical daily-close-decile rule |
| **Dealing range** | The most recent significant swing high to swing low, dividing into equilibrium, premium and discount | Standard |
| **Market structure shift** | Price breaking the most recent swing lower high (bullish) or higher low (bearish) | **Diverges:** he treats MSB and MSS as interchangeable. Standard ICT often reserves MSS for a counter-trend low-timeframe shift and MSB for continuation |
| **Displacement** | A strong aggressive expansion accompanying a structure break, which creates an FVG and signals institutional sponsorship | Standard |
| **Liquidity sweep** | Price trading past a prior high or low to purge resting liquidity before reversing | Standard |
| **Fair value gap** | An inefficiency left by a displacement candle, which is where you enter on the pullback | Standard, but he holds that an FVG alone is a sufficient entry — no confluence with an OB or breaker needed |
| **Order block** | The supply or demand zone that caused a market structure break, retested later | Standard |
| **Breaker** | A failed order block or level that swept liquidity and now acts as a point of interest on return | Standard |
| **Optimal trade entry** | A deep retracement below 50% in a discount, or above it in a premium | Standard **but numberless** — no 0.62/0.705/0.79 anywhere |
| **Premium / discount** | Above and below 50% of the dealing range: expensive and cheap | **Diverges:** he explicitly warns that premium does not mean short and discount does not mean long |
| **Equal highs / lows** | Double or triple swing extremes marking concentrated buy-side or sell-side liquidity | Standard |
| **Killzone** | **NOT USED — the word does not appear** | See section 11 |

---

## 9. Where the videos contradict each other

Both sides kept, per the brief. Each is a real fork for the detector.

**Displacement: mandatory, then ideal.** V13 step 3 makes it a required stage — *"all of them have
to happen and they have to happen in order"*. Later in the **same video** he says *"there will be
occasions where you get an MSB and there's not a lot of displacement and the model still works but
ideally we want to see displacement"* (Q9). *Encoded as mandatory.* A soft displacement rule cannot
be tested; and the FVG the displacement leaves is the entry, so without it there is nothing to
enter on.

**Stop placement: HTF zone (V12) vs 5-minute level (V13 and every walkthrough).** V12 states the
stop belongs below the H4 point of interest because that is the true invalidation. V13 and all four
chart walkthroughs place it at the 5-minute swing (Q9). *Encoded as the 5-minute level*, because it
is what the examples do and because the HTF-zone stop is usually too wide to clear the 2R bar. His
own re-entry rule (section 6) shows the two are not really in conflict: the 5-minute stop ends a
*position*, the HTF zone ends the *idea*.

**Entry timing: wait for the pullback, except when he didn't.** The rule is unambiguous — entering
before the gap is filled is "chasing", disqualifier 5. In the BTC walkthrough he notes that entering
on the displacement candle itself would have worked there (Q9). *Encoded as the pullback.* An
acknowledged discretionary exception is not a rule.

**Counter-trend, against his own disqualifier 1.** In V15 he admits taking a counter-trend long in
a downtrend, says his own checklist forbade it, and attributes the exception to ten years of
discretion while telling beginners to *"stay robotic"* (Q9). *Encoded as forbidden.*

**Execution timeframe: 5-minute, except in V22.** The journaled crypto trade runs on an H1 breaker
and a 15-minute entry model with no M5 involvement (Q9). *Encoded as 5-minute*, with the 15-minute
variant recorded here as an open extension. Note this is the only crypto example in the set and it
is the one that does not use the 5-minute chart.

---

## 10. The owner's own checklist, against the videos

From the journal backup (`instatank/tradegenie-backups`, `tradegenie-backup.json`, collection
`setups`, record **"Mayne 5M Model"**), field `checklist`, verbatim:

```
HTF bias/trend
DR, MS
Liquidity Sweep
Displacement
Entry - FVG/OB...
```

The record also carries `idealRiskReward: 2`, `directionBias: BOTH`, tag `mayne-m5`, no rules and no
notes. This checklist is live: it drives the pre-trade gate on `/playbook/[id]/run`, and every trade
taken through that gate scores *n of 5*.

**Four disagreements, in order of how much they matter.**

**1. The checklist is a merge of two different frameworks.** Lines 1–2 are the *top-down* process
(bias, then dealing range and market structure — V12 steps 1–3). Lines 3–5 are the *5-minute entry
model* (V13). The video sequence that lines 3–5 approximate actually begins with a step the
checklist has no line for at all — **price must trade into the HTF zone** — and that step is the one
he is most emphatic about: *"if it does not come into the zone there is simply no trade"*.

**2. "Liquidity Sweep" is a required step in the checklist and is not a step in the model.** In the
videos the sweep is one of several things that can create or validate the HTF zone; the five steps
are zone tag → MSS → displacement → FVG entry → stop/target. Two of the four worked examples have a
sweep or SFP in the zone; the BTC short — the most completely walked-through trade in the set —
has none. **A gate that requires a sweep would have rejected his own flagship example.**

**3. The order differs.** The checklist runs `MS → sweep → displacement`. The videos run
`zone tag (sweep sometimes here) → MSS → displacement`. So where the checklist puts market
structure *before* the sweep, the videos put any sweep *before* the structure break, as part of
arriving at the zone. Under the checklist's ordering a trader would look for an M5 structure break
first and then wait for a sweep that has, in the video model, already happened or will not happen at
all.

**4. Line 5 conflates a high-timeframe zone type with the low-timeframe entry.** "Entry - FVG/OB"
reads as though either an FVG or an order block can be the 5-minute entry. In the videos the entry
is specifically **the fair value gap that the displacement candle just created**; the order block is
what the *higher* timeframe zone usually is (three of four examples). The trailing `...` suggests the
line was cut short when it was typed, so this may be transcription loss rather than a
misunderstanding.

**What the checklist gets right:** the 2:1 minimum, stored separately as `idealRiskReward: 2`,
matches his stated floor exactly. And no step of the checklist contradicts a rule of his — the
problems are a missing step, a promoted optional one, and an ordering.

**Recommendation, for the owner, not for a session to act on unilaterally.** Rewrite the checklist
to his five, which would make the journal's pre-trade gate and the bot's sequencer count the same
five things:

```
Price traded INTO the HTF zone
5m market structure break in my direction
Displacement that left a fair value gap
Entered on the pullback into that gap
Stop past the 5m level, target HTF liquidity, at least 2R
```

This is an edit to a live journal record that changes what past trades' *n of 5* scores mean, so it
is the owner's to make. The bot encodes the video sequence either way.

---

## 11. Killzones — there is nothing to convert

The brief asked for session windows converted to New York time and a note on which zone he states
them in. **He gives none.** The extraction is explicit twice: *"Session Times in NY Time: NOT
STATED"* (Q3) and, for the term itself, *"NOT USED (Trader Mayne does not use or define the term
'killzone' anywhere in these video transcripts)"* (Q8). The nearest he comes is a passing mention of
*"session AMD forming"* and a list of news events he avoids.

So the killzone gate in roadmap 4.6 is **entirely ours**. Its actual provenance is two places, and
neither is him: ICT's published windows (roadmap 3.2) and the owner's own trade distribution — 36 of
73 trades in 19:00–21:00 IST.

He does have a time-of-day effect, but it is a **phase**, not a window: a prior-day-low sweep *early*
in the day gives a 37% chance of a green daily close and *late* in the day 17% (Q2). That is a
statement about where you are between one daily open and the next, not about a three-hour block.

**Recommendation for session 2.1: record the killzone, do not gate on it.** Gating rejects setups
the model as specified would take, on the authority of a rule its author never gave — and stage 2's
kill criterion is partly *"< 8 signals in total (starved)"*, so an unjustified filter can kill the
model by starving it. Tag every signal with its New York session instead and let stage 3's backtest
answer whether the windows earn their place. It also costs zero parameter trials, which matters
given section 14.

The storage rule in roadmap 4.6 stands regardless and is unchanged: windows are computed in
`America/New_York`, never IST and never a fixed UTC offset.

---

## 12. Against roadmap section 3.2

Section 3.2 sorts the twelve mechanisms into *precisely definable*, *definable with parameters*, and
*discretionary*, and says to flag anything where the extraction supplies a number for something it
called discretionary.

| 3.2's verdict | What the videos add |
|---|---|
| FVG — **precise**, optional minimum size | He never gives the 3-candle rule at all, and no minimum. The mechanical definition we use is ICT's, via 3.2, not his |
| Killzone — **precise**, choose the windows | **He has no killzones.** Section 11 |
| OTE — **precise given the swing** | He uses OTE by name and gives **no numbers**. 0.62/0.79 remains ours |
| Premium/discount — precise given the range; **choosing the range is the discretionary part** | Unresolved. *"Most recent significant swing high and low"* moves the discretion into the word "significant" |
| Equal highs/lows — needs tolerance + confirmation bars | Neither given |
| Market structure shift — needs pivot lookback, close-vs-wick, displacement rule | Level identified precisely (most recent lower high / higher low); **close vs wick NOT STATED** |
| Displacement — needs ATR multiple and body ratio (**ICT gives none**) | He gives none either, and adds that it may span several candles |
| Liquidity sweep — needs which levels, close-back rule, window | **Levels: answered in full** (prior D/W/M extremes, EQH/EQL, range extremes, internal POIs — and notably *not* session extremes). Close-back rule and window: not given |
| Order block — needs displacement rule, body-vs-wick, mitigation | Only the qualitative "the zone that caused the break" |
| Breaker — OB rule + close-through + retest | Qualitative definition only |
| Retest — touch vs close-inside, timeout | Not addressed; but note E replaces the timeout with a structural invalidation |
| **HTF bias — Discretionary** | **Flagged: a mechanical rule with numbers now exists** — the daily-close decile rule with per-asset hit rates. See note D. Not encoded in version 0; it is a second bias source, not a parameter |

**Net effect on 3.2's headline finding.** It said three of twelve mechanisms have one agreed
definition and the rest need numbers nobody gave. The videos change that count by **zero**. What
they do change is the *sweep*, which moves from "which levels count?" to an answered question, and
*HTF bias*, which moves from discretionary to arguably mechanical by a route 3.2 did not anticipate.

---

## 13. What the videos still do not tell us — the one that matters most

**What makes a swing high or low "significant".**

It is not a near-miss among many gaps. Every other hole can be filled with a defensible convention
and calibrated later. This one sits *underneath* six of the twelve mechanisms at once: HTF bias is
the direction of the last structure break **between swings**; the dealing range is **swing** high to
**swing** low; premium, discount and OTE are measured across that range; the market structure shift
is a break of the most recent **swing** lower high; and the stop is placed beyond a 5-minute
**swing** extreme. Change `swingLookback` from 3 to 7 and every one of those answers moves — the
bias can flip, the range can double, the premium/discount verdict can invert, and the stop distance
changes, which changes R, which changes whether the setup passes the 2:1 gate at all.

He identifies swings visually, on charts, every time, and never states a rule (Q2). So the most
consequential number in the model is one he has never given, and it is the first thing session
1.4's calibration loop should put in front of the owner's eye.

---

## 14. What is ours, not his

Every OURS row in one place. This is the list to read first.

**All nine of the detector library's trial dials are ours.** Not one number in
`lib/detect/params.ts` comes from these videos. Nine of nine.

| # | Parameter | Our value | Why this value |
|---|---|---|---|
| 1 | `atrPeriod` | 14 | The conventional period. It is a denominator for the other dials rather than an edge parameter — proposed as **fixed by fiat**, never fitted |
| 2 | `swingLookback` | 5 | Roadmap 3.2's practitioner value for internal structure. **The most consequential choice in the model** (section 13) and the first thing to calibrate |
| 3 | `poolLookback` (equal-high/low confirmation) | 3 | LuxAlgo's confirmation count, read from source in 3.2 |
| 4 | `equalToleranceAtr` | 0.1 × ATR | Same source. He says equal highs are "double or triple" extremes, which is a picture, not a tolerance |
| 5 | `sweepCloseBackBars` | 2 | The practitioner range is 1–2 bars; 2 is the looser end. He never says price must close back in at all |
| 6 | `displacementAtrMultiple` | 1.5 | Published operationalisation of a word ICT and Mayne both leave unquantified |
| 7 | `displacementBodyRatio` | 0.70 | Same |
| 8 | `oteLow` / `oteHigh` (one dial) | 0.62 / 0.79 | ICT's published band. He names OTE and gives no numbers |
| 9 | `fvgMinAtr` | 0 — off | Off means the mechanical 3-candle rule, unfiltered. Costs no trial until someone spends one |

**Structural choices — definitions, not dials.** Changing one produces a different detector and
needs a dated entry in roadmap section 10, not a sweep.

| Choice | Ours | Why |
|---|---|---|
| Structure break = **close** beyond the level | close | He says "broken" and never distinguishes. A close is the standard, and a wick rule makes every level break twice |
| OTE anchored to **bodies** | body | ICT's own anchor per 3.2 |
| Order-block zone = **whole candle including wicks** | wick | No basis either way in the videos; the wider zone tags more often, which the calibration loop can see |
| Mitigation = **wick touch** | wick | Same |
| `orderBlockLookbackBars` = 10 | 10 | A search bound so a long one-sided run cannot return a stale block. Not a strategy claim |
| Displacement spans **one candle** | one | He explicitly allows several. Ours is a narrowing, taken for testability |
| FVG = the **3-candle** rule | ICT's | He never defines it |
| Entry at the **midpoint** of the gap, resting limit | midpoint | He calls execution at the gap *personal preference* and offers three styles. **Fixed by fiat** |
| Entry validity = **until invalidated**, not a bar count | structural | The 6-bar window would have missed his own 12-hour example (note E). **Fixed by fiat**, costs no trial |
| Stop buffer beyond the level | 0 | He says "above or below the level" and nothing more. **Fixed by fiat** |
| Session extremes as liquidity pools | **off** | He lists the pools that count and sessions are not among them |
| Killzone windows | London 02:00–05:00, NY 08:00–11:30 NY time — **recorded, not gated** | Entirely ours. Section 11 |
| R computed **after fees** | after fees | He never mentions costs. The journal's own calculator already shows a 2R gross setup landing at 0.87R net on the owner's fee tier — so a raw 2:1 gate is not the same gate on a perp |
| Counter-trend entries forbidden | forbidden | He takes them and says beginners should not |
| Displacement mandatory | mandatory | He softens it in the same video; a soft rule cannot be tested |

### The parameter budget, honestly

Decision **D10** caps in-sample parameter sets at nine. The nine trial dials above spend that budget
in full **before stage 2 has asked for anything**, and stage 2 wants at least four more: where in the
gap the entry sits, how long the gap stays armed, how far past the level the stop goes, and which
killzone windows gate a signal.

There is no honest way to fit thirteen dials against this much data. The four stage-2 dials are
therefore **fixed by fiat and never counted as trials**, on the grounds that for each one he either
declined to make the choice himself or the evidence already decides it:

- **Entry point = gap midpoint.** He calls it preference. A preference is not an edge parameter.
- **Entry validity = until invalidated.** Structural, and his own example rules out a short window.
- **Stop buffer = 0.** He gives no distance. Zero is the only value that adds no assumption.
- **Killzones = recorded, not gated.** Removes the dial entirely rather than choosing it.

`atrPeriod` is fixed by fiat for the same reason, which frees a slot. That leaves **eight fitted
dials against a budget of nine**, with one held in reserve — most likely for `fvgMinAtr`, the only
dial currently shipped switched off.

If a later session wants a tenth fitted dial, D10 is explicit about what that means: *"A tenth
parameter to rescue a model is a kill, not a fix."*
