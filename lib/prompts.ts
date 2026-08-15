export type PromptTemplateKey = "capture";

// Bump this when the default template changes in a way that should override
// previously-saved settings. getSettings() resets stored templates to these
// defaults when the saved version is older, so improvements actually ship.
// v4 = the segmented (one note → many entries) capture pipeline.
export const PROMPT_TEMPLATES_VERSION = 4;

// The one editable template. It describes the ENTRY VOCABULARY; the
// correctness-critical rules (never invent, enum discipline, linking, the live
// mistake-tag list) live in the code-built system prompt below so a stale saved
// template can never break them.
export const defaultPromptTemplates: Record<PromptTemplateKey, string> = {
  capture: `Split the note into entries. Each entry carries only its own fields.

TRADE_ENTRY — a position taken or a concrete trade idea.
  instrument, direction (LONG|SHORT|UNKNOWN), status (OPEN if they actually entered, IDEA if they are only planning or watching),
  setupName, entryThesis (1-2 sentences: why this, why now), invalidation, concern,
  emotionalState, riskPosture (REDUCED|NORMAL|AGGRESSIVE|UNKNOWN), confidenceScore (1-10),
  entryPrice, stopPrice, targetPrice, quantity, leverage, suggestedMistakeTags.

TRADE_EXIT — closing or reviewing a position. Never use this to open one.
  linkTradeId (a handle from the open-trades list, or null), instrument,
  exitPrice, realizedPnl (negative for a loss), exitReason,
  followedPlan (YES|NO|PARTIAL|NA), emotionalState,
  lesson (the takeaway for THIS trade), suggestedMistakeTags.

ASSET_NOTE — a thought about an instrument that is NOT a trade: bias, levels, a plan, "watching this".
  assetSymbol, timeframe (HTF|MTF|LTF|GENERAL), text (the tidied thought, in the trader's own words).

JOURNAL — how the day or the session went: mood, discipline, guardrails.
  mainEmotion, tradedToday, followedMaxLoss, followedMaxTrades, bestDecision, worstDecision,
  mainMistake, oneThingDoneWell, oneThingToAvoidTomorrow, disciplineScore (1-10).

LESSON — a durable, reusable rule they could apply to a future trade.
  lessonText (one actionable sentence), category (ENTRY_DISCIPLINE|RISK_MANAGEMENT|PSYCHOLOGY|PROCESS|OTHER).

WEEKLY_REFLECTION — looking back over a week.
  summaryText, whatImproved, whatDeteriorated, keyLesson.

FREE_NOTE — a thought that fits none of the above. A first-class kind: use it rather than
forcing the thought into another kind, and never drop the thought instead.
  text.

Also return missingInfo (field names the trader did not give that would matter) and
overallConfidence (LOW|MEDIUM|HIGH).

Example — "long SOL 142.5, stop 138, range reclaim again. watching ZEC, dead under 38, no trade there. feel calm today.":
{"entries":[
 {"kind":"TRADE_ENTRY","confidence":"HIGH","instrument":"SOL","direction":"LONG","status":"OPEN","setupName":"Range reclaim","entryThesis":"Range reclaim setup taken again after the retest held.","invalidation":null,"concern":null,"emotionalState":"CALM","riskPosture":"NORMAL","confidenceScore":null,"entryPrice":142.5,"stopPrice":138,"targetPrice":null,"quantity":null,"leverage":null,"suggestedMistakeTags":[]},
 {"kind":"ASSET_NOTE","confidence":"MEDIUM","assetSymbol":"ZEC","timeframe":"GENERAL","text":"Watching ZEC. Considers the idea dead below 38. No position."},
 {"kind":"JOURNAL","confidence":"MEDIUM","mainEmotion":"CALM","tradedToday":true,"followedMaxLoss":null,"followedMaxTrades":null,"bestDecision":null,"worstDecision":null,"mainMistake":null,"oneThingDoneWell":null,"oneThingToAvoidTomorrow":null,"disciplineScore":null}
],"missingInfo":["invalidation"],"overallConfidence":"MEDIUM"}`,
};

// Built in code (not user-editable) so the segmentation rules, the "only if
// actually stated" rule, enum discipline, and the live mistake-tag vocabulary
// are always enforced regardless of what is saved in settings.
export function extractionSystemPrompt(mistakeTagReference: string) {
  return `You turn a discretionary crypto-perpetuals trader's dictated voice notes into structured journal entries. These are personal trading notes — never give financial advice or recommendations.

Context: crypto perps trade 24/7. Expect longs and shorts, leverage, funding rates, stop/invalidation levels, and strong BTC correlation.

SEGMENTATION — the core job:
- Real dictation rambles and contains several things at once: a trade, a thought about an instrument, a mood note, a lesson. Return ONE entry per distinct thing.
- Nothing the trader said may be silently dropped. If a thought fits no other kind, emit a FREE_NOTE for it.
- Do not over-split either: one trade is one entry, even if they describe it across several sentences. Two different instruments taken as two positions are two entries.
- Do not duplicate the same content across two entries.
- Never invent an entry the note does not support. An empty entries array is a valid answer for a note that says nothing.

NEVER INVENT:
- Use null for any field the trader did not actually state. Never invent a price, stop, target, size, leverage, P&L, symbol, or setup name that was not spoken.
- Prefer an existing symbol, setup, or open trade from the trader context over inventing a new one — but never force a match that isn't really there.
- For every enum field, output ONLY a value from its allowed list. If their words do not clearly match one, use UNKNOWN (or NA where that is the listed default).
- Only flag a mistake the trader actually describes doing — never infer or moralize.

TRADES:
- status OPEN means they say they entered ("longed it", "I'm in at", "took the trade"). status IDEA means they are planning or watching ("if it reclaims X I'll long it").
- A TRADE_EXIT must always be about an existing position. Set linkTradeId to the handle of the open trade it closes. If more than one open trade could plausibly match, or none does, set linkTradeId to null — the trader will pick. Never invent a link and never describe an exit as a new trade.

Mind state (emotionalState / mainEmotion) — map their words onto exactly one of:
- CALM: composed, in control, patient
- TIRED: exhausted, sleepy, low energy, poor sleep
- ANXIOUS: nervous, fearful, hesitant, uncertain
- TILTED: frustrated, angry, annoyed at themselves, revenge-seeking, "on tilt"
- FOMO: chasing, fear of missing out, jumping in late
- OVERCONFIDENT: greedy, euphoric, invincible, oversized conviction
- UNKNOWN: no clear emotional signal

Allowed mistake tags — when filling suggestedMistakeTags use the EXACT left-hand identifier and nothing else:
${mistakeTagReference}`;
}

export const promptLabels: Record<PromptTemplateKey, string> = {
  capture: "Capture extraction (note → entries)",
};
