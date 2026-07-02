import { differenceInCalendarDays, format, startOfDay, subDays } from "date-fns";
import type { DailyJournal } from "@/lib/types";

// --- Journaling streak: rewards showing up, never profitability. ---
// Any activity counts: a check-in, a logged trade, a voice note, an asset note.
// Today not journaled yet doesn't break the streak (the day isn't over).

export function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function journalStreak(activityDates: Date[], today = new Date()): number {
  const days = new Set(activityDates.map(dayKey));
  let cursor = startOfDay(today);
  if (!days.has(dayKey(cursor))) cursor = subDays(cursor, 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = subDays(cursor, 1);
  }
  return streak;
}

// Milestones, not XP. One adult user; certificates beat gamification chrome.
export function streakMilestone(streak: number): string | null {
  if (streak >= 100) return "100+ days of showing up. This is a real practice now.";
  if (streak >= 30) return "30-day habit locked in. Most traders never journal this consistently.";
  if (streak >= 7) return "A full week of showing up — the habit is forming.";
  return null;
}

// --- Daily ritual state: what's done today, what's next. ---

export function morningDone(journal: DailyJournal | null | undefined): boolean {
  if (!journal) return false;
  return Boolean(
    journal.currentState ||
      journal.maxLossForDay ||
      journal.maxTradesForDay != null ||
      journal.learningFocus ||
      journal.reasonNotToTrade,
  );
}

export function eveningDone(journal: DailyJournal | null | undefined): boolean {
  if (!journal) return false;
  return Boolean(
    journal.tradedToday != null ||
      journal.disciplineScore != null ||
      journal.oneThingDoneWell ||
      journal.oneThingToAvoidTomorrow,
  );
}

// --- Mentor tip of the day ---
// Process- and psychology-focused nudges for a beginner crypto-perp trader.
// Deterministic by calendar day so the tip stays stable all day. Never market
// calls or financial advice — behavior only.

export type MentorTip = { title: string; body: string };

export const mentorTips: MentorTip[] = [
  {
    title: "Your job is not to make money today",
    body: "Your job is to follow your plan today. Money is the long-run scoreboard of doing that a thousand times.",
  },
  {
    title: "Decide where you're wrong before you enter",
    body: "If you can't name the price that proves the idea failed, you don't have a trade — you have a hope.",
  },
  {
    title: "Size so a loss is boring",
    body: "If a single stop-out would change your mood for the evening, the position was too big. Boring losses are survivable losses.",
  },
  {
    title: "The best trade after a loss is usually no trade",
    body: "Revenge trading turns one planned loss into three unplanned ones. Close the laptop, log the loss, come back tomorrow.",
  },
  {
    title: "A no-trade day can be a perfect day",
    body: "If nothing matched your setup and you didn't force it, that's discipline working. Log it as a win for the process.",
  },
  {
    title: "Funding is a quiet tax on perps",
    body: "Holding a perp position isn't free. Glance at the funding rate before you enter — a great idea held too long can bleed out through funding.",
  },
  {
    title: "Grade the decision, not the outcome",
    body: "A good decision can lose and a bad one can win. Grade yourself on what you knew and did at entry, not on what the market did after.",
  },
  {
    title: "One setup, traded well, beats five traded loosely",
    body: "Beginners grow fastest by getting boringly good at one repeatable pattern before adding another.",
  },
  {
    title: "FOMO means the move already happened",
    body: "If the candle is what's convincing you, you're late. The trade you chase is usually someone else's exit.",
  },
  {
    title: "Journal the loser while it stings",
    body: "The most valuable notes are written within minutes of a losing exit — that's when the real reason is still honest.",
  },
  {
    title: "Leverage changes nothing about the idea",
    body: "It only changes how long you can be wrong. Lower leverage buys your idea time to work.",
  },
  {
    title: "Overtrading is a mood, not a strategy",
    body: "Bored, anxious, or 'making back' — if one of those is the reason, the trade doesn't qualify. Check your mind state first.",
  },
  {
    title: "Protect the streak, not the trade",
    body: "Any single trade is noise. The habit of planning, logging, and reviewing is the only edge you fully control.",
  },
  {
    title: "Wins need reviews too",
    body: "A win that broke your rules is a future loss in disguise. Tag it honestly — that's how lucky doesn't become a habit.",
  },
];

export function tipOfTheDay(today = new Date()): MentorTip {
  const daysSinceEpoch = differenceInCalendarDays(startOfDay(today), new Date(2024, 0, 1));
  return mentorTips[((daysSinceEpoch % mentorTips.length) + mentorTips.length) % mentorTips.length];
}
