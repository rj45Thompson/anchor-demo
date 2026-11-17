// The vocal seat: the singer's pitch against the song's vocal line.
//
// PhonePad carries buttons and sticks, not audio, so the singer uses the microphone
// on the machine the game runs on, the way a console game takes one mic for the room
// while the guitars are controllers. The pitch maths is the karaoke page's, which is
// already covered by karaoke/tests/core.test.mjs, so this file only decides what a
// sung note is worth.
// Pure functions, no browser APIs (tests/vocals.test.mjs).
import { foldSemitones, hzToMidi } from "../../karaoke/js/pitch.js";
import { activeMultiplier, creditNote, failNote } from "./scoring.js";

// Within this many semitones of the written note counts as on pitch. An octave out
// still counts, because a bass singing a line written for a tenor is not wrong.
export const TOLERANCE_SEMITONES = 1.0;
// Paid per second held on pitch, at the seat's current multiplier.
export const VOCAL_POINTS_PER_SECOND = 90;
// What share of a note has to land on pitch for each verdict.
export const VERDICT_SHARE = { perfect: 0.9, great: 0.7, good: 0.45 };

// The vocal note sounding at `t`, or null for a rest. End times are exclusive.
export function noteAt(vocals, t) {
  for (const n of vocals) {
    if (t >= n.t && t < n.end) return n;
  }
  return null;
}

// How far the sung pitch is from the target, in semitones, folded into (-6, 6] so an
// octave out reads as nothing out. Positive means the target is above what was sung.
export function gapTo(targetMidi, sungMidi) {
  return foldSemitones(targetMidi - sungMidi);
}

export function onPitch(targetMidi, sungMidi, tolerance = TOLERANCE_SEMITONES) {
  return Math.abs(gapTo(targetMidi, sungMidi)) <= tolerance;
}

export function verdictForShare(share) {
  if (share >= VERDICT_SHARE.perfect) return "perfect";
  if (share >= VERDICT_SHARE.great) return "great";
  if (share >= VERDICT_SHARE.good) return "good";
  return null;
}

export function createVocals(song, { tolerance = TOLERANCE_SEMITONES } = {}) {
  return {
    vocals: song.vocals,
    tolerance,
    // The note being sung now, and how much of it has landed.
    current: null,
    heldOn: 0,
    heldTotal: 0,
    lastT: null,
    // What the HUD draws: the target, what was sung, and which way to move.
    target: null,
    sung: null,
    gap: null,
  };
}

// Feeds one frame of microphone pitch in. `hz` is the detector's reading, or null for
// silence or an unclear frame, which counts against the note rather than being
// skipped: not singing is not the same as singing it right.
//
// Returns what the HUD needs, plus `finished` when a note has just been settled.
export function feed(state, play, seatId, hz, t) {
  const seat = play.seats.get(seatId);
  if (!seat || seat.role !== "vocals") return { ok: false, reason: "not a vocal seat" };
  const dt = state.lastT === null ? 0 : Math.max(0, t - state.lastT);
  state.lastT = t;
  const sungMidi = hz === null ? null : hzToMidi(hz);
  const note = noteAt(state.vocals, t);
  let finished = null;

  // A different note (or a rest) means the one before it is over: settle it.
  if (state.current && note !== state.current) {
    finished = settle(state, play, seat);
  }
  if (note !== state.current) {
    state.current = note;
    state.heldOn = 0;
    state.heldTotal = 0;
  }

  state.target = note ? note.midi : null;
  state.sung = sungMidi;
  state.gap = note && sungMidi !== null ? gapTo(note.midi, sungMidi) : null;

  if (note) {
    state.heldTotal += dt;
    if (sungMidi !== null && onPitch(note.midi, sungMidi, state.tolerance)) {
      state.heldOn += dt;
      // Paid as it is sung, so the meter moves while the note is still sounding.
      seat.score += dt * VOCAL_POINTS_PER_SECOND * activeMultiplier(play, seat);
      seat.sustainHeld += dt;
    }
  }
  return { ok: true, note, sung: sungMidi, gap: state.gap, on: note ? state.gap !== null && Math.abs(state.gap) <= state.tolerance : null, finished };
}

// Closes the note just sung and climbs or breaks the combo on the same ladder the
// fret lanes use.
function settle(state, play, seat) {
  const note = state.current;
  const share = state.heldTotal > 0 ? state.heldOn / state.heldTotal : 0;
  const verdict = verdictForShare(share);
  if (verdict) {
    creditNote(play, seat, verdict);
  } else {
    seat.hits.miss += 1;
    failNote(seat, play);
  }
  return { note, share, verdict };
}

// Call once when the song ends, so a note still sounding at the last frame is scored
// rather than dropped.
export function finish(state, play, seatId) {
  const seat = play.seats.get(seatId);
  if (!seat || seat.role !== "vocals" || !state.current) return null;
  const out = settle(state, play, seat);
  state.current = null;
  state.heldOn = 0;
  state.heldTotal = 0;
  return out;
}

// The vocal notes in view, for drawing the pitch ribbon ahead of the singer.
export function notesInView(vocals, t, ahead, behind) {
  return vocals.filter((n) => n.end >= t - behind && n.t <= t + ahead);
}
