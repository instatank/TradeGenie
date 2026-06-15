export type PromptTemplateKey =
  | "tradeEntry"
  | "tradeExit"
  | "eodReview"
  | "lessonExtraction"
  | "weeklyReview";

export const defaultPromptTemplates: Record<PromptTemplateKey, string> = {
  tradeEntry: `Extract a trade entry note from the transcript. Return strict JSON only with: transcriptType, instrument, direction, setupName, entryThesis, invalidation, concern, emotionalState, riskPosture, confidenceScore, entryGrade, suggestedMistakeTags, lessons, missingInfo, confidence.`,
  tradeExit: `Extract a trade exit review from the transcript. Return strict JSON only with: transcriptType, instrument, exitReason, followedPlan, emotionalState, suggestedMistakeTags, lesson, futureRule, confidence.`,
  eodReview: `Extract an end-of-day trading review. Return strict JSON only with: transcriptType, tradedToday, followedMaxLoss, followedMaxTrades, bestDecision, worstDecision, mainEmotion, mainMistake, oneThingDoneWell, oneThingToAvoidTomorrow, disciplineScore, lessons, confidence.`,
  lessonExtraction: `Extract reusable trading lessons. Return strict JSON only with: lessons: [{ lessonText, category, confidence }].`,
  weeklyReview: `Synthesize a weekly trading review. Return strict JSON only with: summaryText, whatImproved, whatDeteriorated, mostExpensiveMistake, emotionalPattern, keyLesson, actionItemForNextWeek, confidence.`,
};

export const promptLabels: Record<PromptTemplateKey, string> = {
  tradeEntry: "Trade Entry Transcript Extraction",
  tradeExit: "Trade Exit Review Extraction",
  eodReview: "EOD Review Extraction",
  lessonExtraction: "Lesson Extraction",
  weeklyReview: "Weekly Review Synthesis",
};
