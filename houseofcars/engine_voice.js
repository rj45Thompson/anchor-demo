// engine_voice.js - UC-50.2 the engine's voice from what the car is (the owner 11-09: "Is it possible to have better engine revving
// sound"). Its cylinders and their layout are READ from the listing's engine line ("Twin Turbo Premium Gasoline V-8 4.0 L/243",
// data/listings.json, the dealer's own); a car with no such line (the Unreal template's) has the page's own voice, said so (AUTHORED).
// Pure: test/engine_voice.test.mjs. audio.js builds a PeriodicWave from partials() and plays it at cycleHz(rpm).
//
// The physics, standard four-stroke engine acoustics: a cycle is two turns of the crank, every cylinder fires once in it, so the firing
// frequency is rpm / 60 x cylinders / 2, and the sound's energy sits on the harmonics of the cycle (the engine "orders"). An evenly
// firing engine (a flat six, a V12) puts nearly all of it on the firing harmonics, which is its smooth note. A cross-plane V8 fires its
// two banks unevenly, so the half-firing harmonics are strong too: the burble. A three-cylinder's firing harmonics are low and few,
// which is its thrum. The weights below (the roll-off, the firing, half-firing and stray shares) are the page's own voicing, AUTHORED
// for the sound; which harmonics carry them follows from the cylinders and the layout.

/** a listing's engine line to { cyl, layout ('V', 'I', 'flat', 'W'), turbo }, or null when it names none */
export function engineOf(text) {
  if (typeof text !== 'string') return null;
  const m = /\b(V|W|I|H|Flat)[- ]?(\d{1,2})\b/i.exec(text);
  if (!m) return null;
  const cyl = +m[2], L = m[1].toLowerCase();
  if (!(cyl >= 1 && cyl <= 16)) return null;
  return { cyl, layout: L === 'flat' || L === 'h' ? 'flat' : L === 'v' ? 'V' : L === 'w' ? 'W' : 'I', turbo: /turbo/i.test(text) };   // turbo: its whine (audio.js)
}

// AUTHORED: the template car's voice (no engine line READ for it): the page's old one, two firings a turn
export const TEMPLATE_VOICE = { cyl: 4, layout: 'I', authored: true };
export const VOICE = { harmonics: 64, rolloff: 0.85, firing: 1, half: 0.55, stray: 0.07 };   // AUTHORED, see the header

/** the cycle's frequency (Hz): one cycle is two turns of the crank */
export const cycleHz = (rpm) => Math.max(0, rpm) / 120;
/** the firing frequency (Hz) */
export const firingHz = (rpm, cyl) => cycleHz(rpm) * cyl;

/** the harmonic weights of one engine cycle: { real, imag } for AudioContext.createPeriodicWave, index 0 the DC term (0). The phases
 *  come from a fixed seed, so a car sounds the same every time */
export function partials(voice, n = VOICE.harmonics) {
  if (!voice || !(voice.cyl >= 1)) throw new Error('engine_voice: a voice needs its cylinders');
  const real = new Float32Array(n + 1), imag = new Float32Array(n + 1);
  const cyl = voice.cyl, crossPlane = voice.layout === 'V' && cyl === 8, half = cyl % 2 === 0 ? cyl / 2 : null;
  let seed = 7 + cyl * 13 + (crossPlane ? 101 : 0);
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let h = 1; h <= n; h++) {
    let w = VOICE.stray;
    if (h % cyl === 0) w = VOICE.firing;
    else if (crossPlane && half && h % half === 0) w = VOICE.half;
    else if (cyl === 3 && h % 3 !== 0 && h <= 6) w = 0.3;                // a triple's low uneven orders: its thrum
    const a = w / Math.pow(Math.max(1, h / cyl), VOICE.rolloff) / Math.max(1, h / (cyl * 6)), ph = rnd() * Math.PI * 2;   // no boost under the firing note
    real[h] = a * Math.cos(ph); imag[h] = a * Math.sin(ph);
  }
  return { real, imag };
}
