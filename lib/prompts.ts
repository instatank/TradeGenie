export type PromptTemplateKey =
  | "tradeEntry"
  | "tradeExit"
  | "eodReview"
  | "lessonExtraction"
  | "weeklyReview";

// Bump this when the default templates change in a way that should override
// previously-saved settings. getSettings() resets stored templates to these
// defaults when the saved version is older, so improvements actually ship.
export const PROMPT_TEMPLATES_VERSION = 3;

export const defaultPromptTemplates: Record<PromptTemplateKey, string> = {
  tradeEntry: `Extract a TRADE ENTRY note. Return JSON with these fields:
- transcriptType: "TRADE_ENTRY_NOTE"
- instrument: ticker as stated (e.g. BTC, SOL, ETH), else null
- direction: LONG | SHORT | UNKNOWN
- setupName: the named setup if stated, else null
- entryThesis: 1-2 sentences on why this trade, why now
- invalidation: where the idea is wrong / the stop logic, else null
- concern: a stated worry or risk, else null
- emotionalState: one allowed emotional-state value (see system instructions)
- riskPosture: REDUCED | NORMAL | AGGRESSIVE | UNKNOWN
- confidenceScore: integer 1-10 if stated, else null
- entryGrade: A | B | C | NA
- entryPrice: the entry price as a number if stated, else null
- stopPrice: the stop / invalidation price as a number if stated, else null
- targetPrice: the target / take-profit price as a number if stated, else null
- quantity: position size in units/contracts as a number if stated, else null
- leverage: leverage as a number (e.g. 10 for "10x") if stated, else null
- suggestedMistakeTags: array of exact mistake-tag identifiers (usually empty for a fresh entry)
- lessons: array of { lessonText, category } with category one of ENTRY_DISCIPLINE | RISK_MANAGEMENT | PSYCHOLOGY | PROCESS | OTHER
- missingInfo: array of field names the trader did not provide
- confidence: LOW | MEDIUM | HIGH

Numbers: capture prices/size/leverage only when the trader actually says them. Never invent or estimate a number.

Example:
{"transcriptType":"TRADE_ENTRY_NOTE","instrument":"SOL","direction":"LONG","setupName":"Range reclaim","entryThesis":"Buyers defended the retest of the range low, expecting continuation back to range highs.","invalidation":"A close back inside the range","concern":null,"emotionalState":"CALM","riskPosture":"NORMAL","confidenceScore":6,"entryGrade":"NA","entryPrice":142.5,"stopPrice":138,"targetPrice":155,"quantity":null,"leverage":5,"suggestedMistakeTags":[],"lessons":[],"missingInfo":["target"],"confidence":"MEDIUM"}`,

  tradeExit: `Extract a TRADE EXIT review. Return JSON with these fields:
- transcriptType: "TRADE_EXIT_REVIEW"
- instrument: ticker if stated, else null
- exitReason: why the trade was closed (target hit, stopped out, discretionary), else null
- followedPlan: YES | NO | PARTIAL | NA
- emotionalState: one allowed emotional-state value (see system instructions)
- exitPrice: the price the trade was closed at, as a number, if stated, else null
- realizedPnl: realized profit/loss as a number (negative for a loss) if stated, else null
- suggestedMistakeTags: array of exact mistake-tag identifiers actually described
- lesson: the single most important takeaway, else null
- futureRule: a concrete rule for next time if stated, else null
- confidence: LOW | MEDIUM | HIGH

Numbers: capture exit price / realized P&L only when the trader actually says them. Never invent a number.

Example:
{"transcriptType":"TRADE_EXIT_REVIEW","instrument":"BTC","exitReason":"Closed early out of fear before the target.","followedPlan":"PARTIAL","emotionalState":"ANXIOUS","exitPrice":61200,"realizedPnl":-120,"suggestedMistakeTags":["CUT_WINNER_EARLY"],"lesson":"Let the trade reach its planned target instead of reacting to a wick.","futureRule":"No discretionary exits before target unless the invalidation is hit.","confidence":"HIGH"}`,

  eodReview: `Extract an END-OF-DAY review. This template also handles pre-session daily check-ins. Return JSON with these fields:
- transcriptType: "EOD_REVIEW", or "DAILY_CHECKIN" if this is a pre-session plan rather than a recap
- tradedToday: true | false | null
- followedMaxLoss: true | false | null
- followedMaxTrades: true | false | null
- bestDecision: else null
- worstDecision: else null
- mainEmotion: one allowed emotional-state value (see system instructions), else null
- mainMistake: short description of the day's main mistake, else null
- oneThingDoneWell: else null
- oneThingToAvoidTomorrow: else null
- disciplineScore: integer 1-10 if stated, else null
- lessons: array of { lessonText, category }
- confidence: LOW | MEDIUM | HIGH

Example:
{"transcriptType":"EOD_REVIEW","tradedToday":true,"followedMaxLoss":true,"followedMaxTrades":false,"bestDecision":"Stood aside during the chop after lunch.","worstDecision":"Took a fourth trade out of boredom.","mainEmotion":"TIRED","mainMistake":"Overtraded a slow session.","oneThingDoneWell":"Respected the daily max loss.","oneThingToAvoidTomorrow":"No trades after the third without an A setup.","disciplineScore":6,"lessons":[{"lessonText":"Stop trading once the third trade closes unless it is an A setup.","category":"PROCESS"}],"confidence":"MEDIUM"}`,

  lessonExtraction: `Extract reusable trading LESSONS only. Return JSON with:
- lessons: array of { lessonText, category, confidence } where category is one of ENTRY_DISCIPLINE | RISK_MANAGEMENT | PSYCHOLOGY | PROCESS | OTHER and confidence is LOW | MEDIUM | HIGH

Keep each lessonText a single actionable sentence. Return an empty array if there is no durable, reusable lesson.

Example:
{"lessons":[{"lessonText":"Wait for the planned entry zone instead of chasing a move that already ran.","category":"ENTRY_DISCIPLINE","confidence":"MEDIUM"}]}`,

  weeklyReview: `Synthesize a WEEKLY trading review. Return JSON with:
- transcriptType: "WEEKLY_REFLECTION"
- summaryText: a 2-4 sentence summary of the week
- whatImproved: else null
- whatDeteriorated: else null
- mostExpensiveMistake: else null
- emotionalPattern: the recurring emotional theme of the week, else null
- keyLesson: the single most important lesson, else null
- actionItemForNextWeek: one concrete action, else null
- lessons: array of { lessonText, category }
- confidence: LOW | MEDIUM | HIGH

Example:
{"transcriptType":"WEEKLY_REFLECTION","summaryText":"A flat week dominated by impatience in chop. Process held on planned trades but broke on boredom entries.","whatImproved":"Sizing stayed consistent.","whatDeteriorated":"Discipline late in slow sessions.","mostExpensiveMistake":"Boredom trades in the US afternoon.","emotionalPattern":"Impatience during low-volatility windows.","keyLesson":"Edge only exists on planned setups.","actionItemForNextWeek":"Hard stop after the daily max trades.","lessons":[{"lessonText":"Do not trade low-volatility afternoons without an A setup.","category":"PROCESS"}],"confidence":"MEDIUM"}`,
};

// Used only when the note type is UNKNOWN: classify first, then fill the
// field group that matches. The schema accepts every field, so the model
// fills the relevant block and leaves the rest null.
export const generalExtraction = `Classify this trading voice note, then extract it. Return STRICT JSON only.

First set transcriptType to exactly one of:
TRADE_ENTRY_NOTE | TRADE_EXIT_REVIEW | DAILY_CHECKIN | EOD_REVIEW | WEEKLY_REFLECTION | GENERAL_LEARNING_NOTE | UNKNOWN

Then fill ONLY the fields that match that type, leaving everything else null:
- TRADE_ENTRY_NOTE: instrument, direction (LONG|SHORT|UNKNOWN), setupName, entryThesis, invalidation, concern, emotionalState, riskPosture (REDUCED|NORMAL|AGGRESSIVE|UNKNOWN), confidenceScore (1-10), entryGrade (A|B|C|NA), entryPrice, stopPrice, targetPrice, quantity, leverage (numbers, only if stated)
- TRADE_EXIT_REVIEW: instrument, exitReason, followedPlan (YES|NO|PARTIAL|NA), emotionalState, exitPrice, realizedPnl (numbers, only if stated), lesson, futureRule
- EOD_REVIEW / DAILY_CHECKIN: tradedToday, followedMaxLoss, followedMaxTrades, bestDecision, worstDecision, mainEmotion, mainMistake, oneThingDoneWell, oneThingToAvoidTomorrow, disciplineScore (1-10)
- Any type: suggestedMistakeTags (exact identifiers), lessons ([{lessonText, category}]), missingInfo, confidence (LOW|MEDIUM|HIGH)

emotionalState / mainEmotion must be an allowed emotional-state value (see system instructions). Use null for anything not stated; never invent numbers.`;

// Built in code (not user-editable) so the core rules, enum discipline, and the
// live mistake-tag vocabulary are always enforced regardless of saved templates.
export function extractionSystemPrompt(mistakeTagReference: string) {
  return `You extract structured journal data from a discretionary crypto-perpetuals trader's dictated voice notes. These are personal trading notes — never give financial advice or recommendations.

Context: crypto perps trade 24/7. Expect longs and shorts, leverage, funding rates, stop/invalidation levels, and strong BTC correlation.

Output rules:
- Return STRICT JSON only. No prose, no markdown, no code fences.
- Use null for any field the trader did not actually state. Never invent prices, stops, sizes, setup names, or any number that was not spoken.
- For every enum field, output ONLY a value from its allowed list. If the trader's words do not clearly match one, use UNKNOWN (or NA where that is the listed default).
- Only flag a mistake the trader actually describes doing — never infer or moralize.

Emotional state — map the trader's words onto exactly one of:
- CALM: composed, in control, patient
- TIRED: exhausted, sleepy, low energy
- ANXIOUS: nervous, fearful, hesitant, uncertain
- TILTED: frustrated, angry, revenge-seeking, "on tilt"
- FOMO: chasing, fear of missing out, jumping in late
- OVERCONFIDENT: greedy, euphoric, invincible, oversized conviction
- UNKNOWN: no clear emotional signal

Allowed mistake tags — when filling suggestedMistakeTags use the EXACT left-hand identifier and nothing else:
${mistakeTagReference}`;
}

export const promptLabels: Record<PromptTemplateKey, string> = {
  tradeEntry: "Trade Entry Transcript Extraction",
  tradeExit: "Trade Exit Review Extraction",
  eodReview: "EOD Review Extraction",
  lessonExtraction: "Lesson Extraction",
  weeklyReview: "Weekly Review Synthesis",
};
