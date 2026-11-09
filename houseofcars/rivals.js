// rivals.js - UC-38 the rival in the other lane. The owner 11-08: "make the car dragging behind you slower to start off, I can
// never catch it", "show the user's opponent", "the CPU you fight should have a personality and say things like the Wraith will
// never beat my (whatever)".
// A rival is a named driver in ANOTHER car from the lot. They leave the line a human reaction time after the green (the house run
// under them leaves ON the green, a reaction of 0.000 s, which no person matches: the owner's own run 11-08 reacted in 0.642 s), and
// they talk: a taunt while staged, a line when the lead changes, one at the finish. The names, the lines and the reaction times are
// the page's own (AUTHORED). The car's run is that car's own house run (drag.js houseRun, DERIVED), replayed late by the reaction.
// Pure (no three, no DOM): test/rivals.test.mjs.

// what a driver calls each car: the model's own name, from its READ title (data/listings.json)
export const SHORT = {
  bentley_flying_spur_2018: 'Flying Spur', rolls_royce_wraith_2017: 'Wraith', rolls_royce_ghost_2014: 'Ghost',
  mercedes_amg_e63s_2021: 'E63', bmw_i8_2016: 'i8', porsche_911_c4_2012: '911',
};
// one driver to each car. reaction: s after the green, before the jitter below. {mine} is the rival's car, {yours} the player's
export const DRIVERS = {
  mercedes_amg_e63s_2021: { name: 'Dez', reaction: 0.44, lines: {
    stage: ['That {yours} will never beat my {mine}.', 'Hope you brought a tow strap for that {yours}.'],
    ahead: ['See ya!', 'Enjoy the view of my tail lights.'], passed: ['Oh, you want some?', 'No way. NO way.'],
    win: ['Told you. {mine} all day.', 'Go home and practise, {yours}.'], lose: ['Alright, alright. That {yours} can move.', 'Rematch. Right now.'],
    red: ['Easy! The tree was not done yet.'], stall: ['Stalled it? In a {yours}? Wow.'] } },
  rolls_royce_wraith_2017: { name: 'Big Lou', reaction: 0.55, lines: {
    stage: ['Two and a half tonnes of {mine} says your {yours} goes home second.', 'I have raced bigger and better than a {yours}.'],
    ahead: ['Out of the way, coming through!', 'Feel that? That is twelve cylinders.'], passed: ['Hey! Who said you could pass?', 'Not for long, pal.'],
    win: ['The {mine} never loses. Remember that.', 'Ha! Like I said.'], lose: ['Lucky. The {mine} was just warming up.', 'Okay, you got me. This time.'],
    red: ['Jumped it! Nobody wins like that.'], stall: ['Ha! Need a push?'] } },
  rolls_royce_ghost_2014: { name: 'Marge', reaction: 0.62, lines: {
    stage: ['Dear, my {mine} has been doing this since before your {yours} was a drawing.', 'Try to keep up with an old lady.'],
    ahead: ['Toodle-oo!', 'Manners, dear. Slow down.'], passed: ['Oh my.', 'Well, aren\'t you keen.'],
    win: ['Never underestimate a {mine}, sweetheart.', 'That was lovely. For me.'], lose: ['Well done, dear. Truly.', 'My {mine} and I will be back.'],
    red: ['Patience, dear. Wait for the green.'], stall: ['Oh dear. Clutch, sweetheart.'] } },
  bmw_i8_2016: { name: 'Priya', reaction: 0.38, lines: {
    stage: ['Electric torque, baby. Your {yours} is still waking up.', 'My {mine} did the maths. You lose.'],
    ahead: ['Instant torque!', 'Physics says bye.'], passed: ['Hm. Interesting.', 'Recalculating...'],
    win: ['As predicted. {mine} for the win.', 'Numbers do not lie.'], lose: ['Okay, that {yours} has some numbers too.', 'Error. Rematch required.'],
    red: ['Your reaction time is negative. That is not good.'], stall: ['Stalled. My {mine} cannot even do that.'] } },
  porsche_911_c4_2012: { name: 'Kenji', reaction: 0.4, lines: {
    stage: ['A {yours}? Fine. My {mine} likes a challenge.', 'Clean launch, clean shifts. Watch.'],
    ahead: ['Smooth is fast.', 'Nice try.'], passed: ['Good launch.', 'Not bad at all.'],
    win: ['The {mine} rewards a clean run.', 'Good race. Mine though.'], lose: ['Respect. That was a clean run.', 'You earned that one.'],
    red: ['Too early. Breathe, then go.'], stall: ['Feed it more revs off the line.'] } },
  bentley_flying_spur_2018: { name: 'Nigel', reaction: 0.52, lines: {
    stage: ['I shall have a cup of tea at the finish while I wait for your {yours}.', 'A {yours}. How quaint.'],
    ahead: ['Cheerio!', 'Do try to keep up.'], passed: ['I say!', 'Steady on, old chap.'],
    win: ['Splendid. The {mine} prevails.', 'Jolly good race. For me.'], lose: ['Well driven. Most irritating.', 'The {mine} demands a rematch.'],
    red: ['Bad form, jumping the light.'], stall: ['Oh dear. Shall I fetch a mechanic?'] } },
};
export const JITTER = 0.08;            // s: a rival's reaction varies this much either way from run to run (AUTHORED)
export const SAY_S = 2.6;              // s: a line stays up this long, and the next waits for it to go (one bubble at a time)

// the rival for a run: the car after the player's in the lot's order, then the one after that on the next run, never the player's
// own car. cars: the lot's keys in order; n: how many runs the player has started (any integer). -> { key, driver, reaction }
export function pickRival(playerKey, cars, n, rnd = Math.random) {
  const others = cars.filter((k) => k !== playerKey && DRIVERS[k]);
  if (!others.length) return null;
  const at = cars.indexOf(playerKey), order = at < 0 ? others : [...cars.slice(at + 1), ...cars.slice(0, at)].filter((k) => others.includes(k));
  const key = order[((n % order.length) + order.length) % order.length], d = DRIVERS[key];
  return { key, driver: d, name: d.name, reaction: Math.max(0.2, d.reaction + (rnd() * 2 - 1) * JITTER) };
}
// a line for a moment ('stage', 'ahead', 'passed', 'win', 'lose', 'red', 'stall'), both cars named
export function rivalLine(rival, moment, playerKey, rnd = Math.random) {
  const pool = rival && rival.driver.lines[moment];
  if (!pool || !pool.length) throw new Error('rivals.js: ' + (rival ? rival.name : 'no rival') + ' has no line for "' + moment + '"');
  const pick = pool[Math.floor(rnd() * pool.length) % pool.length];
  return pick.replace(/\{mine\}/g, SHORT[rival.key]).replace(/\{yours\}/g, SHORT[playerKey] || 'car');
}
// who leads the run, by the cars' distances (m): 'player', 'rival' or null when level (within `tie` m), for the lead-change lines
export function leader(playerM, rivalM, tie = 0.5) {
  return Math.abs(playerM - rivalM) <= tie ? null : playerM > rivalM ? 'player' : 'rival';
}
