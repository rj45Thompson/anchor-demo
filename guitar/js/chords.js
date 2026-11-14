// Chord shapes for a 6-string guitar in standard tuning, and the notes each shape sounds.
// Serves: S4 (diagram of the next chord), S7 (chords the camera can learn), P1 (practice diagram).
// Pure data and functions, no browser APIs, so Node can test them.

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

// Open-string MIDI notes, low E string first: E2 A2 D3 G3 B3 E4.
export const OPEN_STRINGS = [40, 45, 50, 55, 59, 64];
export const STRING_NAMES = ["E", "A", "D", "G", "B", "e"];

// frets: one entry per string, low E first; -1 = not played (x), 0 = open.
// fingers: 1 index, 2 middle, 3 ring, 4 little, 0 = none. Standard beginner fingerings.
export const SHAPES = {
  "C":  { frets: [-1, 3, 2, 0, 1, 0], fingers: [0, 3, 2, 0, 1, 0], root: 0,  quality: "maj" },
  "G":  { frets: [3, 2, 0, 0, 0, 3],  fingers: [2, 1, 0, 0, 0, 3], root: 7,  quality: "maj" },
  "D":  { frets: [-1, -1, 0, 2, 3, 2], fingers: [0, 0, 0, 1, 3, 2], root: 2, quality: "maj" },
  "A":  { frets: [-1, 0, 2, 2, 2, 0], fingers: [0, 0, 1, 2, 3, 0], root: 9,  quality: "maj" },
  "E":  { frets: [0, 2, 2, 1, 0, 0],  fingers: [0, 2, 3, 1, 0, 0], root: 4,  quality: "maj" },
  "F":  { frets: [-1, -1, 3, 2, 1, 1], fingers: [0, 0, 3, 2, 1, 1], root: 5, quality: "maj", note: "easy F, 4 strings" },
  "Am": { frets: [-1, 0, 2, 2, 1, 0], fingers: [0, 0, 2, 3, 1, 0], root: 9,  quality: "min" },
  "Em": { frets: [0, 2, 2, 0, 0, 0],  fingers: [0, 2, 3, 0, 0, 0], root: 4,  quality: "min" },
  "Dm": { frets: [-1, -1, 0, 2, 3, 1], fingers: [0, 0, 0, 2, 3, 1], root: 2, quality: "min" },
  "A7": { frets: [-1, 0, 2, 0, 2, 0], fingers: [0, 0, 2, 0, 3, 0], root: 9,  quality: "7" },
  "D7": { frets: [-1, -1, 0, 2, 1, 2], fingers: [0, 0, 0, 2, 1, 3], root: 2, quality: "7" },
  "E7": { frets: [0, 2, 0, 1, 0, 0],  fingers: [0, 2, 0, 1, 0, 0], root: 4,  quality: "7" },
  "G7": { frets: [3, 2, 0, 0, 0, 1],  fingers: [3, 2, 0, 0, 0, 1], root: 7,  quality: "7" },
  "C7": { frets: [-1, 3, 2, 3, 1, 0], fingers: [0, 3, 2, 4, 1, 0], root: 0, quality: "7" },
  "B7": { frets: [-1, 2, 1, 2, 0, 2], fingers: [0, 2, 1, 3, 0, 4], root: 11, quality: "7" },
};

const INTERVALS = { maj: [0, 4, 7], min: [0, 3, 7], "7": [0, 4, 7, 10] };

// Pitch classes (0 = C) a chord of this root and quality contains.
export function chordPitchClasses(root, quality) {
  return INTERVALS[quality].map((i) => (root + i) % 12);
}

export function chordName(root, quality) {
  const suffix = quality === "maj" ? "" : quality === "min" ? "m" : "7";
  return NOTE_NAMES[root] + suffix;
}

// MIDI notes the shape sounds, low string first (muted strings left out).
export function shapeMidiNotes(shape) {
  const notes = [];
  shape.frets.forEach((fret, s) => {
    if (fret >= 0) {
      notes.push(OPEN_STRINGS[s] + fret);
    }
  });
  return notes;
}

// Every chord the matcher chooses between: all 24 major and minor triads, plus the 7th chords in SHAPES.
// Each entry: { name, root, quality, pcs }.
export function candidateChords() {
  const list = [];
  for (let root = 0; root < 12; root++) {
    for (const quality of ["maj", "min"]) {
      list.push({ name: chordName(root, quality), root, quality, pcs: chordPitchClasses(root, quality) });
    }
  }
  for (const [name, shape] of Object.entries(SHAPES)) {
    if (shape.quality === "7") {
      list.push({ name, root: shape.root, quality: "7", pcs: chordPitchClasses(shape.root, "7") });
    }
  }
  return list;
}
