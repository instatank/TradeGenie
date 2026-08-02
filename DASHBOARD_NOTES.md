# Dashboard redesign notes (branch `claude/dashboard-fable-5v02j1`)

Notes for the owner to fold into CLAUDE.md at merge time. This branch redesigns
`/analytics` and upgrades the Today "Snapshot" panel. No dependency was added,
nothing was removed — everything that existed is still reachable.

## What's new, in plain language

**/analytics is now two tiers** (exhaustive-but-lean, advanced = one tap on
"Go deeper"):

Basic view — readable with zero trading jargon:
- **Where you stand** — net result as a hero number, plus "a typical trade
  makes/costs you X" and win rate in words. This is expectancy without the word
  "expectancy".
- **What's hurting me right now** — the top two plain-language leak cards
  (existing `analyticsLeaks`).
- **Discipline, in money** — the centerpiece. Your actual running P&L (solid
  blue) against a counterfactual (dashed gold) that replays history as if you'd
  followed your plan. The gap is headlined in currency: "Following your plan
  would have left you +X better off."
- **What each mistake cost you** — the mistake-cost ledger: net P&L of trades
  carrying each mistake tag, as money bars; the worst habit named with its
  price.

Advanced view (inside the fold):
- **R-multiple histogram** — the shape of wins vs losses, with a callout when
  losses exceeded planned risk (−1R), i.e. the money the stop should have saved.
- **Right after a loss** — tilt made visible: trades opened within 2h of a
  losing trade vs everything else (avg R, win rate, net P&L side by side).
- **Session money bars** — net P&L per UTC session.
- **Exit-efficiency meter** — share of the favorable move captured (needs MFE).
- The pre-existing recent-trades columns, expectancy breakdown, process/funding
  tiles, remaining leaks, and the setup/session/condition tables — all kept.

**Today Snapshot**: the equity curve gains the discipline overlay when there's
something to show, and the mistake bars now show money instead of counts
(falling back to counts when no P&L exists).

## The counterfactual — exactly what it claims

`disciplineCurve()` in `lib/metrics.ts` is deliberately conservative — it never
invents upside:
1. Trades tagged with an impulse-entry mistake (FOMO entry, revenge trade, no
   plan, boredom trade, traded no-trade condition) are **skipped entirely** —
   including the ones that won. Discipline means not taking them, so the plan
   line forfeits their profits too.
2. Losses worse than −1R on trades tagged *moved stop* / *held loser too long*,
   or marked "didn't follow plan", are **capped at exactly −1R** (currency per R
   derived from the trade's own P&L ÷ R).
3. Everything else passes through unchanged. Nothing hypothetical is added
   (e.g. no "what if you'd held the winner" — that would be invented profit).

Deliberately excluded: OVERTRADED as a skip-tag (no way to know *which* trades
were the excess), and MFE-based "should have taken profit" counterfactuals
(speculative upside).

## Honesty rules (please keep these when editing)

- Every derived panel states its sample size. Below a minimum (5 trades for the
  histogram, 4 after-loss trades for tilt, 3 MFE trades for the meter) the panel
  says what it needs instead of charting noise. A page-level banner calls the
  whole page "a sketch, not a verdict" under 5 closed trades.
- The mistake ledger discloses that a trade with several tags counts fully
  under each (costs overlap; they don't sum across tags).
- Tilt timing uses **entry times only** — the journal has no exit timestamp —
  and the page says so.

## Design/tech decisions

- **Zero client JS, server-rendered SVG** — new primitives live in
  `components/Charts.tsx`: `DisciplineLines` (two-series line), `BinColumns`
  (histogram), `MoneyBars` (diverging money bars), `Meter`. No charting library;
  no new dependency of any kind.
- **Palette**: extended, not replaced. The counterfactual line is forge gold
  `#b98318` **dashed** against solid blue — dashing marks it as hypothetical, so
  meaning never rides on colour alone. Blue↔gold was validated with the dataviz
  palette checker: worst-case CVD ΔE 31.4 (protanopia), normal-vision 34.0,
  all checks pass on white. Green/red remain polarity-only, always doubled by
  position around a zero baseline plus signed labels.
- **`lib/metrics.ts` is additive only** — no existing exported signature was
  changed. New exports: `disciplineCurve`, `mistakeCostLedger`, `rHistogram`,
  `tiltAnalysis` (+ their types).
- Trade-status handling: new code only ever tests `status === "CLOSED"` for
  realized outcomes; nothing assumes what non-closed statuses exist (the
  parallel capture-branch change to IDEA→OPEN is unaffected).
- Advanced view uses a `<details>` fold (existing pattern), not a query param —
  zero JS, one tap, state survives nothing (deliberately: default back to lean).

## Verified

`typecheck` + `lint` + `build` green at every commit; `/` and `/analytics`
smoke-checked (HTTP 200) against seeded data and visually reviewed via headless
Chromium screenshots at laptop and phone widths, including the advanced fold
open.
