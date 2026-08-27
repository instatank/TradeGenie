# TradeGenie (magic journal) — Project Brief

This is the source-of-truth brief for what this app is *for*. It is written by the owner.
Where this brief and any older doc (AGENTS.md, a prior AI-generated spec, code comments)
disagree, THIS BRIEF WINS. When in doubt, optimize for the goals and budgets below, not for
feature completeness.

## Who this is for
One user: me. Non-technical operator, beginner discretionary trader. I trade mainly
large-cap crypto perpetual futures (BTC, ETH, SOL, and similar), with occasional crypto
spot and Indian large-caps. This is a personal tool, not a product. There is no second user,
no team, no customer. Do not build for scale, SaaS, multi-user, payments, or sharing.

## What I actually want this to do
1. Let me journal ideas, trades, and reasoning with almost no friction.
2. Capture BOTH:
   - numeric data (P&L, R-multiple, win rate, expectancy), and
   - subjective data (thesis, emotional state, mistakes, lessons).
3. Surface patterns over time so I keep learning from my own history.
4. Be sustainable to use every day as my single source of truth.

The point is a *habit*, not a database. A journal I actually open daily beats a complete one
I abandon. Subtraction beats addition.

## The hard constraint: friction budgets (these are requirements)
- Daily check-in: under 60 seconds
- Quick trade note: under 30 seconds
- Transcript paste/save: under 20 seconds
- End-of-day review: 2–4 minutes

Any field, enum, or feature that doesn't fit inside these budgets must be cut, deferred, or
hidden behind an "advanced/optional" toggle. Speed wins over completeness every time.

## Design defaults
- Beginner mode is the default. Advanced fields are collapsed/hidden until I ask for them.
- Almost nothing is mandatory. The minimum to log a trade is: instrument, direction, status,
  and a one-line thesis. Everything else is optional.
- Plain-language labels. Avoid jargon.
- Voice/transcript capture stays prominent — talking is lower friction than typing.
- AI-extracted content is ALWAYS shown for review before it's saved. Nothing auto-writes to
  a final record.

## Lean defaults (cut the bloat)
A previous AI-generated spec piled on long lists. For a solo beginner those lists ARE the
friction. Start lean. I can always add a category back when I notice I miss it.

- Mistake tags: start with a SHORT set of the ones I'll actually hit as a crypto-perp
  beginner — e.g. FOMO entry, revenge trade, oversized, moved stop, no clear invalidation,
  chased breakout, exited too early, overtraded, no plan. Park the rest in a "more" list,
  don't show them by default. (Claude: propose the final short set and justify it.)
- Emotional states: collapse to a handful that are actually distinct and actionable
  (e.g. calm/sharp, tired, anxious, tilted, FOMO, overconfident). Don't make me scroll a
  dropdown of 11.
- Lesson categories: a few broad buckets, not eight. (Claude: propose a lean set.)
- Prefer one good field over three overlapping ones.

## Capture > analytics (for now)
The first job is to make capturing trades and reflections effortless and to get my data
durable and trustworthy. Heavy analytics, charts, and "pro" review features come AFTER the
daily loop is frictionless and the data is safe. Don't gold-plate the dashboard while the
capture flow still has friction or the storage isn't durable.

## Non-goals (do not build in this phase)
~~Exchange/broker API sync~~ — **lifted by the owner (Aug 2026)**: read-only CoinDCX import is
built, because entering approximate figures and skipping fees was making the journal's numbers
untrustworthy. Execution stays a non-goal and is blocked in code, not just in policy.
AI screenshot parsing · real-time signals or recommendations ·
any financial advice · full charting · backtesting · trade replay · TradingView integration ·
auth · multi-user · payments · social sharing · automated execution.
This app must never give trade recommendations or financial advice.

## Tech reality
The repo is the source of truth on stack. (It currently runs on Next.js + Firebase/Firestore
with a local-JSON fallback, which differs from older docs that mention Prisma/SQLite — go by
the code, not the old docs.) The most important technical question for me is simple and
non-negotiable to get right: **is my journal data actually saved durably, so I won't lose it?**
Treat data durability as a top priority and explain the real situation to me in plain English.

## How I want you (Claude Code) to work
- Small, scoped changes. One concern at a time. No broad rewrites unless I ask.
- Before calling anything done: run lint, typecheck, build; smoke-check any changed UI route.
- Never push to GitHub or deploy to Vercel without me explicitly asking for that change.
- Don't revert my changes or unrelated work.
- When something is a real tradeoff or changes my daily workflow, stop and ask me in plain
  English. Don't quietly decide for me.
- Default bias: if you're unsure whether something earns its place for a solo beginner,
  leave it out and flag it.
