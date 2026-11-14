// A song run: when each chord is due, which strum counts for which chord, hits, misses, and the end results.
// Serves: S5 (count-in sets the clock), S6 (hit and timing grade), S8 (results), A1 (wrong chord), A2 (miss).
// Pure: times are seconds of song time; app.js owns the real clock and the audio.

// events: [{ chord, beats }] in order. Returns [{ chord, time, duration }] with the count-in before the first.
export function scheduleSong(song, speed, countInBeats) {
  const secondsPerBeat = 60 / (song.bpm * speed);
  let beat = countInBeats;
  return song.chords.map(([chord, beats]) => {
    const event = { chord, time: beat * secondsPerBeat, duration: beats * secondsPerBeat };
    beat += beats;
    return event;
  });
}

export class SongRun {
  // mode: "wait" (the song holds at each chord until it is heard) or "keep" (the song keeps time).
  // timing: { perfectMs, goodMs, earlyMs, lateFraction } from config.js. judgeDelay: seconds from a strum to its
  // verdict, so a window is not closed while its last strum is still being listened to.
  constructor(events, mode, timing, judgeDelay) {
    this.events = events.map((e) => ({ ...e, state: "due", wrong: [], grade: null, hitAt: null }));
    this.mode = mode;
    this.timing = timing;
    this.judgeDelay = judgeDelay;
    this.streak = 0;
    this.bestStreak = 0;
    this.points = 0;
  }

  // Index of the first chord not yet hit or missed, or -1 when the song is over.
  current() {
    return this.events.findIndex((e) => e.state === "due");
  }

  windowOf(e) {
    const early = this.timing.earlyMs / 1000;
    const late = this.mode === "wait" ? Infinity : this.timing.lateFraction * e.duration;
    return [e.time - early, e.time + late];
  }

  // Wait mode: the clock may not pass a chord that has not been heard. Returns the allowed song time.
  // grace: seconds it may run past the chord while a strum in its window is still being listened to, so a chord
  // played on the beat does not stop the song for the half second its verdict takes.
  holdTime(songTime, grace = 0) {
    if (this.mode !== "wait") {
      return songTime;
    }
    const i = this.current();
    return i >= 0 ? Math.min(songTime, this.events[i].time + grace) : songTime;
  }

  // A strum at onsetTime (song seconds) that sounded like `heard` (a chord name, or null for not a chord).
  // Returns { kind: "hit", index, grade, offsetMs } | { kind: "wrong", index, heard, wanted } | null (no chord due).
  strum(onsetTime, heard) {
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.state !== "due") {
        continue;
      }
      const [open, close] = this.windowOf(e);
      if (onsetTime < open) {
        return null;
      }
      if (onsetTime > close) {
        continue;
      }
      if (heard !== e.chord) {
        e.wrong.push(heard);
        if (this.mode === "keep") {
          this.streak = 0;
        }
        return { kind: "wrong", index: i, heard, wanted: e.chord };
      }
      const offsetMs = Math.round((onsetTime - e.time) * 1000);
      const abs = Math.abs(offsetMs);
      let grade = "Late";
      if (abs <= this.timing.perfectMs) {
        grade = "Perfect";
      } else if (abs <= this.timing.goodMs) {
        grade = "Good";
      }
      e.state = "hit";
      e.grade = grade;
      e.hitAt = onsetTime;
      this.points += grade === "Perfect" ? 100 : grade === "Good" ? 70 : 40;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      return { kind: "hit", index: i, grade, offsetMs };
    }
    return null;
  }

  // Keep time: chords whose window has closed (plus the verdict delay) become misses. Returns their indexes.
  advance(songTime) {
    const missed = [];
    if (this.mode !== "keep") {
      return missed;
    }
    this.events.forEach((e, i) => {
      if (e.state === "due" && songTime > this.windowOf(e)[1] + this.judgeDelay) {
        e.state = "miss";
        this.streak = 0;
        missed.push(i);
      }
    });
    return missed;
  }

  finished() {
    return this.current() === -1;
  }

  // S8: score, per-chord counts, the slowest change (wait mode: how long past its beat a chord took),
  // and the chord to practise (most misses and wrong strums, then slowest).
  results() {
    const perChord = {};
    let slowest = null;
    for (const e of this.events) {
      const c = (perChord[e.chord] ??= { hits: 0, misses: 0, wrong: 0, lateSum: 0 });
      c.wrong += e.wrong.length;
      if (e.state === "hit") {
        c.hits += 1;
        const late = Math.max(0, e.hitAt - e.time);
        c.lateSum += late;
        if (!slowest || late > slowest.seconds) {
          slowest = { chord: e.chord, seconds: late };
        }
      } else if (e.state === "miss") {
        c.misses += 1;
      }
    }
    const total = this.events.length;
    const hits = this.events.filter((e) => e.state === "hit").length;
    const practise = Object.entries(perChord).sort(
      ([, a], [, b]) => b.misses + b.wrong - (a.misses + a.wrong) || b.lateSum - a.lateSum,
    )[0];
    return {
      points: this.points,
      hits,
      total,
      accuracy: total ? hits / total : 0,
      bestStreak: this.bestStreak,
      perChord,
      slowest,
      practise: practise ? practise[0] : null,
    };
  }
}
