// Phrases: melody notes grouped under the lyric lines that they sing, plus lookups by song time.
// Serves: S6 (current line), S7 (lead-in time per phrase), S10 (phrase windows), A2 (no lines, no phrases),
// A3 (no notes, no preview), A5 (seek: lookups use the time they are given, nothing is carried over).
// Pure functions, no browser APIs.

// Index of the last line that has started by time t, or -1 before the first line.
export function currentLineIndex(lines, t) {
  let lo = 0;
  let hi = lines.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].t <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

// Each line owns the notes that start between its time and the next line's time.
// Notes that start before the first line or after the last one belong to no phrase and are counted, not hidden.
export function buildPhrases(lines, notes, leadInSeconds, tailSeconds) {
  const phrases = lines.map((line, index) => {
    const next = index + 1 < lines.length ? lines[index + 1].t : Infinity;
    const owned = notes.filter((note) => note.start >= line.t && note.start < next).map((note) => ({ ...note, phrase: index }));
    const first = owned[0];
    const last = owned[owned.length - 1];
    return {
      index,
      text: line.text,
      start: line.t,
      notes: owned,
      previewAt: first ? first.start - leadInSeconds : null,
      scoreEnd: last ? last.end + tailSeconds : null,
    };
  });
  const owned = new Set(phrases.flatMap((phrase) => phrase.notes.map((note) => note.start)));
  const unowned = notes.filter((note) => !owned.has(note.start)).length;
  return { phrases, unowned };
}

// The note sounding at time t, or null (a rest, or no melody). The end time is exclusive.
export function noteAt(notes, t) {
  for (const note of notes) {
    if (t >= note.start && t < note.end) {
      return note;
    }
  }
  return null;
}

// A chord name the band can play: a root, an optional sharp or flat, and m, 7, m7 or maj7.
export const CHORD = /^[A-G][#b]?(m7|maj7|m|7)?$/;

// Validates a song file: {"title", "lines": [{"t", "text"}], "notes": [{"start", "end", "midi"}]}.
// Bad data throws with the reason, and nothing is repaired. Serves: P7 (own file), A3 (bad file).
export function parseSong(obj) {
  if (!obj || typeof obj !== "object") {
    throw new Error("the file must be a JSON object");
  }
  if (typeof obj.title !== "string" || !obj.title.trim()) {
    throw new Error('"title" must be a non-empty string');
  }
  if (!Array.isArray(obj.lines) || !Array.isArray(obj.notes)) {
    throw new Error('the file needs a "lines" list and a "notes" list');
  }
  const lines = obj.lines.map((line, i) => {
    if (!line || typeof line.t !== "number" || line.t < 0 || typeof line.text !== "string") {
      throw new Error(`line ${i}: needs a time "t" of 0 or more and a string "text"`);
    }
    const out = { t: line.t, text: line.text };
    if (line.part !== undefined) {
      if (line.part !== 1 && line.part !== 2 && line.part !== "both") {
        throw new Error(`line ${i}: "part" must be 1, 2 or "both"`);
      }
      out.part = line.part;
    }
    return out;
  });
  const notes = obj.notes.map((note, i) => {
    if (!note || typeof note.start !== "number" || typeof note.end !== "number" || !Number.isInteger(note.midi)) {
      throw new Error(`note ${i}: needs numeric "start" and "end" and an integer "midi"`);
    }
    if (!(note.start >= 0 && note.start < note.end) || note.midi < 0 || note.midi > 127) {
      throw new Error(`note ${i}: need 0 <= start < end and 0 <= midi <= 127`);
    }
    const out = { start: note.start, end: note.end, midi: note.midi };
    if (note.syl !== undefined) {
      if (typeof note.syl !== "string") {
        throw new Error(`note ${i}: "syl" must be a string`);
      }
      out.syl = note.syl;
    }
    return out;
  });
  lines.sort((a, b) => a.t - b.t);
  notes.sort((a, b) => a.start - b.start);
  const song = { title: obj.title.trim(), lines, notes };
  // Optional co-op fields (C1, C3): a backing band, whether to preview each line, and a credit line.
  if (obj.band !== undefined) {
    const band = obj.band;
    if (!band || typeof band.bpm !== "number" || !(band.bpm >= 30 && band.bpm <= 300)) {
      throw new Error('"band.bpm" must be a number from 30 to 300');
    }
    if (typeof band.start !== "number" || band.start < 0) {
      throw new Error('"band.start" must be a time of 0 or more');
    }
    if (!Array.isArray(band.chords) || !band.chords.length || !band.chords.every((c) => typeof c === "string" && CHORD.test(c))) {
      throw new Error('"band.chords" must be a list of chord names such as "C", "Am", "G7"');
    }
    song.band = { bpm: band.bpm, start: band.start, chords: [...band.chords] };
  }
  if (obj.preview !== undefined) {
    if (typeof obj.preview !== "boolean") {
      throw new Error('"preview" must be true or false');
    }
    song.preview = obj.preview;
  }
  if (typeof obj.credit === "string") {
    song.credit = obj.credit;
  }
  return song;
}
