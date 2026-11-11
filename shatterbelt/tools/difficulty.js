// How hard the game is, measured: 200 seeded games played to the end by two bots, written into index.html.
//
//   node tools/difficulty.js            (from the shatterbelt folder)
//
// "Aims" is tools/parity.js's aimer: it turns to the nearest rock or hunter, fires when it faces it, and jumps
// to hyperspace when something is about to hit it. "Random" is parity.js's holder: it changes what it holds
// every so often, like someone mashing keys. Neither is a person, so the numbers say how the rules pace a game
// (when ships are lost, how far a steady player gets), not how well people will do.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Game } from '../core.js';
import { aimer, holder } from './parity.js';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const GAMES = 100;          // per bot
const CAP = 216000;         // an hour of game time; a game still going then is counted as reaching the cap

function playOne(seed, player) {
  const game = new Game({ seed });
  const lostInWave = [];
  let steps = 0;
  while (!game.over && steps < CAP) {
    const events = game.step(player(game));
    steps += 1;
    if (events.some(e => e.type === 'shipDestroyed')) lostInWave[game.wave] = (lostInWave[game.wave] || 0) + 1;
  }
  return { wave: game.wave, score: game.score, minutes: game.time / 60, over: game.over, lostInWave };
}

function summarise(name, make) {
  const games = [];
  for (let i = 0; i < GAMES; i++) games.push(playOne(1000 + i, make(i)));
  const sorted = key => games.map(g => g[key]).sort((a, b) => a - b);
  const median = key => sorted(key)[Math.floor(GAMES / 2)];
  const waves = sorted('wave');
  const lost = [];
  for (const g of games) g.lostInWave.forEach((n, w) => { if (n) lost[w] = (lost[w] || 0) + n; });
  const firstWaveLosses = lost[1] || 0;
  const totalLosses = lost.reduce((a, b) => a + (b || 0), 0);
  return { name, median: { wave: median('wave'), score: median('score'), minutes: median('minutes') },
           best: { wave: waves[GAMES - 1], score: sorted('score')[GAMES - 1] }, unfinished: games.filter(g => !g.over).length,
           firstWaveShare: totalLosses ? firstWaveLosses / totalLosses : 0, lost };
}

const bots = [
  summarise('Aims', () => aimer()),
  summarise('Random', i => holder(500 + i, 12)),
];
const n = v => Math.round(v).toLocaleString('en-US');
for (const b of bots) {
  console.log(`${b.name}: median wave ${b.median.wave}, score ${n(b.median.score)}, ${b.median.minutes.toFixed(1)} min; best wave ${b.best.wave}, ` +
              `score ${n(b.best.score)}; ${b.unfinished} of ${GAMES} still going at an hour; ${(b.firstWaveShare * 100).toFixed(0)}% of ships lost in wave 1; ` +
              `losses by wave: ${b.lost.map((x, w) => x ? `${w}:${x}` : '').filter(Boolean).join(' ')}`);
}

const row = b => `<tr><td><b>${b.name}</b></td><td>${b.median.wave}</td><td>${n(b.median.score)}</td><td>${b.median.minutes.toFixed(1)} min</td>` +
  `<td>wave ${b.best.wave}, ${n(b.best.score)}</td><td>${(b.firstWaveShare * 100).toFixed(0)}%</td></tr>`;
const block = `<div class="tablewrap"><table><thead><tr><th>Player</th><th>Median wave reached</th><th>Median score</th><th>Median game</th>` +
  `<th>Best of ${GAMES}</th><th>Ships lost in wave 1</th></tr></thead><tbody>${bots.map(row).join('')}</tbody></table></div>` +
  `<p class="cap">Measured by <code>tools/difficulty.js</code>: ${GAMES} seeded games per player, each played to game over (or an hour). ` +
  `&ldquo;Aims&rdquo; turns to the nearest rock or hunter, fires when it faces it and jumps away from a hit; &ldquo;Random&rdquo; changes the keys it holds ` +
  `every so often. Neither is a person: this shows how the rules pace a game, not how people will score. ` +
  `${bots.map(b => `${b.name}: ${b.unfinished} still going at an hour`).join('; ')}.</p>`;

const page = join(HERE, 'index.html');
const text = readFileSync(page, 'utf8');
if (!/<!--gen:difficulty-->[\s\S]*?<!--\/gen:difficulty-->/.test(text)) throw new Error('index.html has no <!--gen:difficulty--> block');
writeFileSync(page, text.replace(/(<!--gen:difficulty-->)[\s\S]*?(<!--\/gen:difficulty-->)/, (m, a, b) => a + block + b));
console.log('written into index.html');
