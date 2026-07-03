#!/bin/bash
# Stop hook: nudge the session (max once per repo per day) to run /wrap when
# commits shipped this session but the wrap ritual hasn't run. The tooling
# triggers the ritual — nobody's memory does. See playbook/LEARNING_METHOD.md.
top="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -z "$top" ] && exit 0
repo="$(basename "$top")"
tmp="${TMPDIR:-/tmp}"
done_marker="$tmp/wrap-done-$repo-$(date +%F)"
nudge_marker="$tmp/wrap-nudged-$repo-$(date +%F)"
[ -f "$done_marker" ] && exit 0
[ -f "$nudge_marker" ] && exit 0
recent=$(git -C "$top" log --since="8 hours ago" --oneline 2>/dev/null | wc -l | tr -d ' ')
[ "${recent:-0}" -eq 0 ] && exit 0
touch "$nudge_marker"
printf '{"decision":"block","reason":"Wrap check: commits shipped recently but the /wrap ritual has not run today. If the working session is ending, run the wrap skill now: reconcile the handoff doc against reality, append friction cards to LEARNINGS.md, ask the founder the teach-back and transfer questions, quiz one old card, then create the marker file %s. If the founder is unavailable or mid-task, note that and continue - this reminder fires at most once per day."}\n' "$done_marker"
exit 0
