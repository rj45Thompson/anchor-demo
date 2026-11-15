// Co-op judging: who sings each line, how each note is judged, the team combo, the hype bar, and the results.
// Serves: C1 (parts per mode), C4 (on pitch), C5 (whose turn, which mic), C6 (combo, multiplier, hype, sync),
// C7 (line word), C8 (results, stars, swap), CA3 (silence is a miss), CA4 (lines with no part alternate),
// CA5 (solo). Pure functions and one class, no browser APIs, so Node tests run all of it.
import { foldSemitones } from "./pitch.js";

// Authored game rules (design values for this page, not measured or ported from anywhere).
export const RULES = {
  hitShare: 0.5, // a note is hit when at least half of its time was on pitch (C6)
  comboStep: 8, // the multiplier goes up by one every 8 hits in a row
  maxMultiplier: 4,
  hypePerHit: 6, // percent of the hype bar per hit note
  harmonySeconds: 8, // a full hype bar doubles points for this long
  pointsPerNote: 100,
  syncBonus: 50, // both singers hit a "both" note, each on their own mic
  starShares: [0.35, 0.5, 0.65, 0.8], // team on-pitch share for 2, 3, 4 and 5 stars
};

// The part a line is sung by in a mode: 1, 2 or "both" (C1, CA4, CA5). swap exchanges 1 and 2 (C8).
export function linePart(line, index, mode, swap = false) {
  if (mode === "solo") {
    return 1;
  }
  if (mode === "together") {
    return "both";
  }
  let part = line.part ?? (index % 2 === 0 ? 1 : 2);
  if (swap && part !== "both") {
    part = part === 1 ? 2 : 1;
  }
  return part;
}

// The singers of a part (C5).
export function singers(part) {
  return part === "both" ? [1, 2] : [part];
}

// The microphone that judges a singer: with one mic it judges everyone, with two each has their own (C5).
export function micFor(player, micCount) {
  return micCount >= 2 ? player - 1 : 0;
}

// Within the tolerance, octaves folded (C4). No voice is never on pitch (CA3).
export function isOnPitch(targetMidi, sungMidi, tolerance) {
  if (sungMidi === null || sungMidi === undefined) {
    return false;
  }
  return Math.abs(foldSemitones(targetMidi - sungMidi)) <= tolerance;
}

// The word shown at the end of a line (C7).
export function lineWord(share) {
  if (share === null) {
    return "";
  }
  if (share >= 0.9) {
    return "Perfect";
  }
  if (share >= 0.7) {
    return "Great";
  }
  if (share >= 0.4) {
    return "Good";
  }
  return "Missed";
}

// 1 to 5 stars from the team's on-pitch share (C8).
export function stars(share, rules = RULES) {
  if (share === null) {
    return 0;
  }
  return 1 + rules.starShares.filter((s) => share >= s).length;
}

function blank() {
  return { time: 0, on: 0, hits: 0, notes: 0 };
}

// The team's run through one song. notes carry {start, end, midi, phrase}; partOf(phrase) gives that line's part.
export class Team {
  constructor(notes, partOf, micCount, rules = RULES) {
    this.notes = notes;
    this.partOf = partOf;
    this.micCount = micCount;
    this.rules = rules;
    this.cells = notes.map(() => ({ 1: { time: 0, on: 0 }, 2: { time: 0, on: 0 } }));
    this.outcome = notes.map(() => null); // after closeNote: {player: hit?} for the singers of that note
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.hype = 0;
    this.harmonyUntil = -Infinity;
    this.players = { 1: blank(), 2: blank() };
  }

  multiplier() {
    return Math.min(this.rules.maxMultiplier, 1 + Math.floor(this.combo / this.rules.comboStep));
  }

  inHarmony(t) {
    return t < this.harmonyUntil;
  }

  // One frame of judging: dt seconds of note i for a singer, on pitch or not (C4, CA3).
  addFrame(i, player, dt, on) {
    const cell = this.cells[i][player];
    cell.time += dt;
    if (on) {
      cell.on += dt;
    }
  }

  // Ends note i at song time t. Returns what happened, for the screen (C6).
  closeNote(i, t) {
    if (this.outcome[i] !== null) {
      return [];
    }
    const who = singers(this.partOf(this.notes[i].phrase));
    const outcome = {};
    const events = [];
    for (const p of who) {
      const cell = this.cells[i][p];
      const player = this.players[p];
      player.time += cell.time;
      player.on += cell.on;
      player.notes += 1;
      const hit = cell.time > 0 && cell.on / cell.time >= this.rules.hitShare;
      outcome[p] = hit;
      if (hit) {
        player.hits += 1;
        this.combo += 1;
        this.bestCombo = Math.max(this.bestCombo, this.combo);
        const points = this.rules.pointsPerNote * this.multiplier() * (this.inHarmony(t) ? 2 : 1);
        this.score += points;
        events.push({ kind: "hit", player: p, points });
        if (!this.inHarmony(t)) {
          this.hype += this.rules.hypePerHit;
          if (this.hype >= 100) {
            this.hype = 0;
            this.harmonyUntil = t + this.rules.harmonySeconds;
            events.push({ kind: "harmony" });
          }
        }
      } else {
        if (this.combo > 0) {
          events.push({ kind: "break", combo: this.combo });
        }
        this.combo = 0;
        events.push({ kind: "miss", player: p });
      }
    }
    if (who.length === 2 && this.micCount >= 2 && outcome[1] && outcome[2]) {
      this.score += this.rules.syncBonus;
      events.push({ kind: "sync", points: this.rules.syncBonus });
    }
    this.outcome[i] = outcome;
    return events;
  }

  // The on-pitch share of one line over its singers, or null when nothing in it was judged (C7).
  lineShare(phrase) {
    let time = 0;
    let on = 0;
    this.notes.forEach((note, i) => {
      if (note.phrase !== phrase) {
        return;
      }
      for (const p of singers(this.partOf(phrase))) {
        time += this.cells[i][p].time;
        on += this.cells[i][p].on;
      }
    });
    return time > 0 ? on / time : null;
  }

  // The results screen (C8).
  results() {
    const share = (x) => (x.time > 0 ? x.on / x.time : null);
    const [a, b] = [this.players[1], this.players[2]];
    const team = { time: a.time + b.time, on: a.on + b.on };
    return {
      score: this.score,
      stars: stars(share(team), this.rules),
      teamShare: share(team),
      notesHit: a.hits + b.hits,
      notesJudged: a.notes + b.notes,
      bestCombo: this.bestCombo,
      players: {
        1: { share: share(a), hits: a.hits, notes: a.notes },
        2: { share: share(b), hits: b.hits, notes: b.notes },
      },
    };
  }
}
