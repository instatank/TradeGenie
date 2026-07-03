---
name: wrap
description: Session-wrap ritual - run before ending any session that shipped commits (the Stop hook will nudge once if forgotten). Reconciles CLAUDE.md's Decisions log + Open items against reality, appends friction cards to LEARNINGS.md, asks the founder the teach-back/transfer questions, quizzes one old card. Also triggered by "wrap and teach" or "wrap up".
---

# /wrap — TradeGenie

The learning half lives in `playbook/LEARNING_METHOD.md` in `instatank/time-tracker` (read `/home/user/time-tracker/playbook/LEARNING_METHOD.md` if cloned, else fetch via GitHub `get_file_contents`); this skill is its trigger. The founder is non-technical — plain language throughout.

1. **Reconcile the handoff doc** — this repo's handoff doc is CLAUDE.md's **"Decisions log"** and **"Open items"** sections. Verify every stated fact against reality (branch, what shipped vs pending, resolved items still true) and fix drift in place (PLAYBOOK Rule 6).
2. **Friction cards:** for each genuine friction this session (0 is a valid count — don't pad), append a card to `LEARNINGS.md` (format in `playbook/LEARNING_METHOD.md`). Fill every field except the two founder fields.
3. **Ask the founder, and wait for answers** (use AskUserQuestion or plain questions):
   - Teach-back: "One sentence, your words — what's the concept behind today's friction?" → record verbatim in the card's *In my words*. If it misses the concept, re-explain plainly and invite one retry.
   - Transfer: "Where else in your stack could this same failure bite?" → record in *Where else*.
4. **Quiz one old card:** pick the oldest card with `Internalized: no` or `streak 1`, ask its quiz question. Correct → bump streak; streak 2 on separate dates → mark `Internalized: YES (date)`. Wrong → say the answer plainly, streak resets.
5. **Recap:** produce the session recap per the owner's wrap commands (this session only, no padding).
6. **Mark done:** `touch "${TMPDIR:-/tmp}/wrap-done-$(basename "$(git rev-parse --show-toplevel)")-$(date +%F)"` so the Stop-hook reminder stays quiet.
7. Commit the doc updates (CLAUDE.md + LEARNINGS.md) and push.

If the founder doesn't respond to step 3 (unattended session): leave the two founder fields as `(pending — answer at next wrap)`, complete everything else, and surface the questions at the start of the next wrap.
