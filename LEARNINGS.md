# LEARNINGS.md — TradeGenie friction ledger

Concept cards appended by `/wrap`. Format and method: `playbook/LEARNING_METHOD.md` in
`instatank/time-tracker`. One card per friction, not per session; zero is a valid count.

### 2026-07-02 — Journal data would have died on the next redeploy

- What happened: a partially-set Firebase config silently fell back to local-file storage
  (`data/tradeforge-store.json`) — which on Vercel is an ephemeral disk, so every redeploy
  would have wiped the journal while the app looked like it was working fine.
- Concept: silent fallbacks hide data loss — fail loud beats fail safe-looking (PLAYBOOK
  Rule 4). Fixed by making `usesFirebase()` THROW on a partial config instead of quietly
  degrading; `/settings` also shows a storage banner and `/api/export` gives a backup path.
- In my words: (pending — answer at next wrap)
- Where else: (pending — answer at next wrap)
- Quiz question: your app can't reach its database at startup and quietly writes to local
  disk instead — why is "it still works" the worst outcome?
- Internalized: no
