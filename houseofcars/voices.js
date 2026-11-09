// voices.js - UC-27.3b a speech voice worth hearing (the owner 11-09: "The AI voice is really bad"). Pure: test/voices.test.mjs.
// iOS lists Apple's novelty voices (Albert, Bad News, Bubbles, Zarvox, ...) and its old Eloquence voices (Eddy, Flo, Grandma, ...)
// as en-US, ahead of the real ones in the list, so a pick of "the first English voice" spoke in one of them on an iPhone. They are
// never chosen here. Of the rest: a Premium voice first, then Enhanced and the network voices (Google's, Microsoft's Natural), then
// any; Canadian English before US, US before the others; a network voice before a local one of the same rank
// READ: the novelty and Eloquence names are the voices macOS and iOS list under English (Settings > Accessibility > Spoken Content)
export const NOVELTY = /^(albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|kathy|ralph|eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i;

/** the best English voice of `voices` (speechSynthesis.getVoices()), or null when there is none but novelty ones */
export function bestVoice(voices) {
  const tier = (v) => (/premium/i.test(v.name) ? 0 : /enhanced|neural|natural|online|google/i.test(v.name) ? 1 : 2);
  const place = (v) => (/^en[-_]CA/i.test(v.lang) ? 0 : /^en[-_]US/i.test(v.lang) ? 0.2 : 0.4);
  const rank = (v) => tier(v) + place(v) + (v.localService === false ? -0.05 : 0);
  return voices.filter((v) => /^en([-_]|$)/i.test(v.lang) && !NOVELTY.test(v.name)).sort((a, b) => rank(a) - rank(b))[0] || null;
}
