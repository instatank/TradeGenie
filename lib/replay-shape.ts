// The handful of numbers the replay's SERVER half and CLIENT half must agree
// about, in a module that imports nothing.
//
// It exists because they have to be shared and there is nowhere safe to share
// them from. Declaring them in lib/trade-replay.ts and importing the value into
// the chart pulls that module's whole chain — coindcx-sync → store →
// firebase-admin → node:fs — into the browser bundle, which fails the build
// outright (and would be a serious bundle regression if it didn't). Declaring
// them twice is how the first version shipped a chart whose window was double
// the history the fetch provided, so it opened three-quarters empty.
//
// Keep this file dependency-free. A single import here re-creates the problem.

/** How many candles stay on screen behind the playback cursor. */
export const REPLAY_TRAILING_BARS = 90;

/** Bars of lead-in before the entry. Deliberately more than the window, so
 *  playback can start before the entry with a full screen already behind it. */
export const REPLAY_LEAD_IN_BARS = REPLAY_TRAILING_BARS + 30;

/** Where the cursor parks on load: this many bars before the entry, which with
 *  the lead-in above leaves the window exactly full on the first frame. */
export const REPLAY_START_OFFSET_BARS = 30;
