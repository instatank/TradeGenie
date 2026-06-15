# Pending Tasks

This is the working backlog for TradeForge Journal. The list is ordered around maximum practical benefit for daily trading-journal use, with emphasis on lower friction, better organization, and safer data management.

## Priority 1

1. **Set up real persistence**
   Connect Firebase Firestore properly for local development and Vercel. Current local JSON storage is useful for development, but not deployment-safe.

2. **Data backup/export**
   Add one-click export to JSON/CSV for trades, lessons, journals, transcripts, and raw executions.

3. **Done: Compact table pattern beyond Trades**
   Applied compact expandable rows to:
   - Inbox voice notes
   - Lessons
   - Import/raw executions

4. **Done: Trade detail page cleanup**
   Turned the trade detail page into a cleaner editing workspace:
   - compact summary at top
   - collapsible sections for Entry, Exit, Mistakes, Executions, Lessons, Screenshots
   - clearer save/edit affordances

5. **Better voice note confirmation flow**
   After structuring a transcript, show a cleaner review panel:
   - suggested destination
   - extracted trade fields
   - missing fields
   - buttons for Create trade, Update linked trade, Save lesson only, Attach to daily

## Priority 2

6. **Quick Add command**
   Add a persistent Quick Add button or shortcut for:
   - Voice note
   - Quick trade
   - EOD review
   - Manual lesson

7. **Today workspace**
   Make Dashboard or Daily show a focused Today panel:
   - today’s check-in status
   - open trades
   - today’s notes
   - EOD review status
   - quick links

8. **Trade lifecycle status prompts**
   Add prompts for unfinished journal loops:
   - IDEA/OPEN without invalidation
   - CLOSED without exit review
   - trade with mistake but no lesson
   - transcript structured but unconfirmed

9. **Saved filters / named views**
   Add user-defined saved views, for example:
   - Open crypto perps
   - Closed this week
   - Mistakes to review
   - No exit review

10. **Execution linking improvements**
    Make imported execution linking easier:
    - suggest matching trades by instrument/date
    - bulk link selected rows
    - show linked/unlinked count
    - show order value/P&L totals by selected rows

## Priority 3

11. **Weekly review upgrade**
    Improve weekly review output with:
    - biggest win/loss
    - most repeated mistake
    - trades without plan
    - best lesson
    - one rule for next week

12. **Lesson bank upgrades**
    Add:
    - pinned lessons
    - lessons seen this week
    - lessons linked to mistake tag/setup
    - active vs archived views

13. **Mistake review page**
    Add a dedicated page for recurring mistakes:
    - frequency over time
    - examples
    - linked trades
    - rule to prevent the mistake

14. **Screenshot management**
    Improve attachment UX without AI screenshot parsing:
    - thumbnails
    - captions
    - attach to trade/daily/transcript
    - delete/replace

15. **Mobile polish**
    Make key flows comfortable on mobile:
    - paste voice note
    - quick trade
    - daily check-in
    - EOD review

## Priority 4

16. **CSV import templates**
    Save column mappings by source:
    - Binance
    - Bybit
    - broker CSV
    - manual template

17. **Data quality checks**
    Add a Needs Cleanup view:
    - missing thesis
    - missing invalidation
    - closed trade without P&L
    - imported execution unlinked
    - transcript unconfirmed

18. **Performance and structure cleanup**
    Once Firebase is connected, review query patterns and avoid loading every collection everywhere as data grows.

19. **Deployment hardening**
    Before relying on Vercel:
    - Firebase env vars
    - upload/storage decision for screenshots
    - backup/export
    - README deploy steps
    - production smoke checklist

20. **Light keyboard shortcuts**
    Add only high-value shortcuts:
    - `/` search
    - `n` new trade
    - `v` voice note
    - `d` daily
    - `e` EOD

## Recommended Next Sequence

1. Firebase persistence + Vercel-safe storage.
2. Voice note confirmation flow cleanup.
3. Trade detail page cleanup.
4. Compact expandable pattern for Inbox/Lessons/Import.
5. Today workspace / dashboard refinement.
