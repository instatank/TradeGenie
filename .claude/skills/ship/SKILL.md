---
name: ship
description: TradeGenie pre-push ship ritual - run before every push. Runs the typecheck/lint/build gate (+ route smoke-check for UI changes), refuses to push red. Use when about to commit/push changes, or when the user says "ship it".
---

# /ship — TradeGenie

Repo-specific config for `playbook/SOP-ship.md` in `instatank/time-tracker` (read it for the why and the full ordering). **Never push red.**

1. `git status` + `git diff` — confirm the diff contains only the asked-for change (PLAYBOOK Rule 1: no bundled fixes).
2. **No service worker in this repo** — there is no cache-key bump step.
3. **Gates (all three must pass):** `npm run typecheck && npm run lint && npm run build`. For UI changes, also smoke-check the affected route on the local dev server (`npm run dev`).
4. **Silent-failure question** for any new write/scheduled/external path in the diff (PLAYBOOK Rule 4) — TradeGenie's `usesFirebase()` throw is the house example.
5. Commit (clear message) and push to the designated branch.
6. **Deploy awareness:** a push to `main` auto-deploys to Vercel production. The owner has given standing authorization to push when work is ready (per CLAUDE.md) — but a red build is never pushed, standing authorization or not. If a deploy misbehaves: `git revert` + push to roll back.
7. If the change touches the daily workflow, state which verification rung was reached (typecheck/build ≠ verified — PLAYBOOK Rule 5) and list what the owner should click through.
