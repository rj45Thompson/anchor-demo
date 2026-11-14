// Songs: original chord progressions written for this trainer (no real songs, no lyrics).
// Serves: S4 (pick a song), S8 (results per chord). Each chord entry: [chord name, beats].

const repeat = (pattern, times) => Array.from({ length: times }, () => pattern).flat();

export const SONGS = [
  {
    id: "two-chord-start",
    title: "Two Chord Start",
    level: "First steps",
    bpm: 60,
    chords: repeat([["Em", 4], ["G", 4]], 4),
  },
  {
    id: "front-porch",
    title: "Front Porch",
    level: "Easy",
    bpm: 72,
    chords: repeat([["G", 4], ["C", 4], ["D", 4], ["G", 4]], 3),
  },
  {
    id: "three-chord-road",
    title: "Three Chord Road",
    level: "Easy",
    bpm: 80,
    chords: repeat([["A", 4], ["D", 4], ["A", 4], ["E", 4]], 3),
  },
  {
    id: "minor-rain",
    title: "Minor Rain",
    level: "Easy",
    bpm: 70,
    chords: repeat([["Am", 4], ["Dm", 4], ["E", 4], ["Am", 4]], 3),
  },
  {
    id: "evening-walk",
    title: "Evening Walk",
    level: "Medium",
    bpm: 76,
    chords: repeat([["C", 4], ["G", 4], ["Am", 4], ["F", 4]], 3),
  },
  {
    id: "twelve-bar-a",
    title: "Twelve Bar in A",
    level: "Medium",
    bpm: 88,
    chords: [
      ["A7", 4], ["A7", 4], ["A7", 4], ["A7", 4],
      ["D7", 4], ["D7", 4], ["A7", 4], ["A7", 4],
      ["E7", 4], ["D7", 4], ["A7", 4], ["E7", 4],
    ],
  },
  {
    id: "quick-changes",
    title: "Quick Changes",
    level: "Hard",
    bpm: 96,
    chords: repeat([["G", 2], ["D", 2], ["Em", 2], ["C", 2]], 4),
  },
];
