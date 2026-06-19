// Golden set for the extraction eval harness (Tier 3 of EVALUATION_PLAN.md).
//
// This is the regression safety net for the AI extraction: run `npm run
// eval:extraction` before changing lib/prompts.ts or ANTHROPIC_MODEL. With an
// ANTHROPIC_API_KEY set it scores the real Claude path; with no key it scores the
// offline regex mock (lower, but still catches gross breakage).
//
// Checks are deliberately ROBUST (enums, instrument, direction, whether a number
// was captured vs invented, emotion mapped to the lean-6 vocab) rather than exact
// prose, so a slightly different but correct extraction still passes.

export type FieldCheck =
  | { kind: "equals"; field: string; value: string }
  | { kind: "instrument"; value: string }
  | { kind: "number"; field: string; present: boolean }
  | { kind: "numberEquals"; field: string; value: number }
  | { kind: "bool"; field: string; value: boolean }
  | { kind: "emotionIn"; field: string; values: string[] }
  | { kind: "minArray"; field: string; min: number }
  | { kind: "arrayIncludes"; field: string; value: string };

export type EvalCase = {
  name: string;
  declaredType: string;
  rawText: string;
  checks: FieldCheck[];
};

const LEAN_EMOTIONS = ["CALM", "TIRED", "ANXIOUS", "TILTED", "FOMO", "OVERCONFIDENT", "UNKNOWN"];

export const evalCases: EvalCase[] = [
  {
    name: "Clean long entry with full numbers",
    declaredType: "TRADE_ENTRY_NOTE",
    rawText:
      "Entering BTC long. Entry 50000, stop 48000, target 56000. Macro is risk-on and BTC has lagged the move, expecting continuation. Feeling calm.",
    checks: [
      { kind: "equals", field: "transcriptType", value: "TRADE_ENTRY_NOTE" },
      { kind: "instrument", value: "BTC" },
      { kind: "equals", field: "direction", value: "LONG" },
      { kind: "numberEquals", field: "entryPrice", value: 50000 },
      { kind: "numberEquals", field: "stopPrice", value: 48000 },
      { kind: "number", field: "targetPrice", present: true },
      { kind: "emotionIn", field: "emotionalState", values: LEAN_EMOTIONS },
    ],
  },
  {
    name: "Short entry, no prices stated (must not invent)",
    declaredType: "TRADE_ENTRY_NOTE",
    rawText: "Thinking about shorting ETH here, looks heavy. No clear level yet, will wait.",
    checks: [
      { kind: "instrument", value: "ETH" },
      { kind: "equals", field: "direction", value: "SHORT" },
      { kind: "number", field: "entryPrice", present: false },
      { kind: "number", field: "stopPrice", present: false },
      { kind: "number", field: "targetPrice", present: false },
    ],
  },
  {
    name: "Exit review, target hit",
    declaredType: "TRADE_EXIT_REVIEW",
    rawText: "Closed my SOL long, exited at 180 for a profit of 600. Target hit, followed the plan this time.",
    checks: [
      { kind: "equals", field: "transcriptType", value: "TRADE_EXIT_REVIEW" },
      { kind: "number", field: "exitPrice", present: true },
      { kind: "number", field: "realizedPnl", present: true },
    ],
  },
  {
    name: "FOMO mistake reflection",
    declaredType: "MISTAKE_REFLECTION",
    rawText:
      "I chased BTC after it already ran, classic FOMO entry. Got in late and it reversed. Lesson: wait for the planned entry zone instead of reacting to a missed move.",
    checks: [
      { kind: "arrayIncludes", field: "suggestedMistakeTags", value: "FOMO_ENTRY" },
      { kind: "minArray", field: "lessons", min: 1 },
    ],
  },
  {
    name: "Revenge / tilted exit",
    declaredType: "TRADE_EXIT_REVIEW",
    rawText: "Took a revenge trade after the last loss, totally tilted. Moved my stop and held the loser too long. Cut it for -300.",
    checks: [
      { kind: "emotionIn", field: "emotionalState", values: ["TILTED"] },
      { kind: "arrayIncludes", field: "suggestedMistakeTags", value: "REVENGE_TRADE" },
    ],
  },
  {
    name: "EOD review with discipline score",
    declaredType: "EOD_REVIEW",
    rawText:
      "End of day. I traded today, followed my max loss but I overtraded a bit. Best decision was standing aside in chop. Discipline score 7. Tomorrow I want to avoid revenge trading.",
    checks: [
      { kind: "equals", field: "transcriptType", value: "EOD_REVIEW" },
      { kind: "bool", field: "tradedToday", value: true },
      { kind: "number", field: "disciplineScore", present: true },
    ],
  },
  {
    name: "EOD review, did not trade",
    declaredType: "EOD_REVIEW",
    rawText: "Did not trade today. Market was choppy and I had no edge, so I stood aside. Happy with the discipline.",
    checks: [
      { kind: "equals", field: "transcriptType", value: "EOD_REVIEW" },
      { kind: "bool", field: "tradedToday", value: false },
    ],
  },
  {
    name: "Weekly reflection",
    declaredType: "WEEKLY_REFLECTION",
    rawText:
      "This week I was too aggressive early and gave back gains. My A+ setups worked but I kept taking B setups out of boredom. Next week: only trade the plan.",
    checks: [
      { kind: "equals", field: "transcriptType", value: "WEEKLY_REFLECTION" },
      { kind: "minArray", field: "lessons", min: 1 },
    ],
  },
  {
    name: "Tired / poor state note",
    declaredType: "DAILY_CHECKIN",
    rawText: "Slept badly, feeling tired and foggy. Plan is to watch only, no trades unless an A+ setup appears.",
    checks: [
      { kind: "emotionIn", field: "mainEmotion", values: ["TIRED", "UNKNOWN"] },
    ],
  },
  {
    name: "Indian index trade",
    declaredType: "TRADE_ENTRY_NOTE",
    rawText: "Long NIFTY on the pullback into support. Entry 23500, stop 23300.",
    checks: [
      { kind: "instrument", value: "NIFTY" },
      { kind: "equals", field: "direction", value: "LONG" },
      { kind: "numberEquals", field: "entryPrice", value: 23500 },
    ],
  },
];
