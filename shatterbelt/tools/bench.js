// How long one game step takes, measured in node on busy play, and written into index.html's speed block.
//
//   node tools/bench.js            (from the shatterbelt folder)
//
// A bot with 1,000 ships fires and turns at random, so the field fills up wave after wave and nothing ends the run.
// Every step is timed on its own with process.hrtime; the first 2,000 steps warm the JIT and are not counted.
// The numbers are this machine's, from one run: the block says which machine and which node.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import os from 'node:os';
import { Game, Input, Random, STEP } from '../core.js';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
const WARMUP = 2000;
const MEASURED = 60000;          // about 17 minutes of game time

function play() {
  const game = new Game({ seed: 20261111, startingShips: 1000 });
  const bot = new Random(7);
  let held = 0;
  const times = new Float64Array(MEASURED);
  let mostRocks = 0, mostBullets = 0;
  for (let i = 0; i < WARMUP + MEASURED; i++) {
    if (i % 20 === 0) held = Input.Fire | (bot.oneIn(2) ? Input.Left : Input.Right) | (bot.oneIn(3) ? Input.Thrust : 0);
    const t0 = process.hrtime.bigint();
    game.step(held);
    const t1 = process.hrtime.bigint();
    if (i >= WARMUP) {
      times[i - WARMUP] = Number(t1 - t0) / 1000; // microseconds
      mostRocks = Math.max(mostRocks, game.rocks.inUse);
      mostBullets = Math.max(mostBullets, game.bullets.inUse);
    }
  }
  const sorted = Array.from(times).sort((a, b) => a - b);
  const at = q => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { median: at(0.5), p99: at(0.99), max: sorted[sorted.length - 1], wave: game.wave, mostRocks, mostBullets,
           budgetShare: at(0.99) / (STEP * 1e6) };
}

const r = play();
const cpu = os.cpus()[0].model.trim().replace(/\s+/g, ' ');
const us = v => v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString('en-US');
console.log(`steps timed ${MEASURED}, median ${us(r.median)} us, 99th percentile ${us(r.p99)} us, slowest ${us(r.max)} us; ` +
            `wave ${r.wave}, most rocks at once ${r.mostRocks}, most shots ${r.mostBullets}; node ${process.version} on ${cpu}`);

const block = `<div class="stat"><div><b>${us(r.median)} &micro;s</b><span>a game step takes, typically, in node</span></div>` +
  `<div><b>${us(r.p99)} &micro;s</b><span>for the slowest 1 in 100 steps, ${(r.budgetShare * 100).toFixed(2)}% of the 16.7 ms a step stands for</span></div>` +
  `<div><b>${r.mostRocks}</b><span>rocks on the field at the busiest moment, of the pool's 66</span></div>` +
  `<div><b>${r.wave}</b><span>waves played through</span></div></div>` +
  `<p class="cap">Measured by <code>tools/bench.js</code>: ${MEASURED.toLocaleString('en-US')} steps of a bot with 1,000 ships that fires and turns at random, ` +
  `each step timed on its own after ${WARMUP.toLocaleString('en-US')} warm-up steps; the slowest single step took ${us(r.max)} &micro;s (a garbage collection or the JIT can land on any one step). ` +
  `One run, node ${process.version} on ${cpu.replace(/&/g, '&amp;').replace(/</g, '&lt;')}.</p>`;

const page = join(HERE, 'index.html');
const text = readFileSync(page, 'utf8');
if (!/<!--gen:speed-->[\s\S]*?<!--\/gen:speed-->/.test(text)) throw new Error('index.html has no <!--gen:speed--> block');
writeFileSync(page, text.replace(/(<!--gen:speed-->)[\s\S]*?(<!--\/gen:speed-->)/, (m, a, b) => a + block + b));
console.log('written into index.html');
