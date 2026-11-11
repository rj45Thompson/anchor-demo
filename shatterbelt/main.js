// main.js: the page around the game. It owns the frame loop, the menus, the HUD and the best score.
//
// The frame loop is the classic fixed-timestep loop: real time goes into FixedTimestep, which runs
// Game.step() a whole number of times at 60 Hz, and whatever time is left over is used only to draw
// smoothly between two steps. The rules never see a frame rate.
import { Game, FixedTimestep, InputLog, Rules } from './core.js';
import { loadArt, Renderer } from './render.js';
import { Controls } from './input.js';
import { Sound } from './audio.js';

const $ = id => document.getElementById(id);
const stage = $('stage');

// ---- saved settings: best score and sound. Storage can be missing or blocked; then nothing is kept.
const saved = {
  read(key, otherwise) {
    try { const v = localStorage.getItem(`shatterbelt.${key}`); return v === null ? otherwise : JSON.parse(v); } catch { return otherwise; }
  },
  write(key, value) {
    try { localStorage.setItem(`shatterbelt.${key}`, JSON.stringify(value)); } catch { /* private mode or blocked: not kept */ }
  },
};

// A field with the same area as the standard one, shaped like the screen, so a phone held upright
// plays on an upright field. Each game keeps the field it started with.
function fieldFor(aspect) {
  const area = Rules.field.width * Rules.field.height;
  const shape = Math.min(Math.max(aspect, 0.62), Rules.field.width / Rules.field.height);
  const width = Math.round(Math.sqrt(area * shape));
  return { width, height: Math.round(area / width) };
}

const format = n => n.toLocaleString('en-US');

// ---- state -------------------------------------------------------------------------------------
let mode = 'loading';       // loading, title, playing, paused, over, replay
let game = null;
let renderer = null;
let log = null;             // this game's input, one byte per step
let lastRun = null;         // { options, log, steps, snapshot, score } of the last finished game
let overAt = 0;
let best = saved.read('best', 0);
let alpha = 0;
let stageVisible = true;
const clock = new FixedTimestep();
const sound = new Sound({ muted: saved.read('muted', false), music: saved.read('music', true) });
const stats = { frames: 0, steps: 0, rocksBroken: 0, explosions: 0, gamesStarted: 0, replayMatched: null,
                shipsLost: 0, slowMos: 0, banners: [] };
// Losing a ship slows time to a third for a moment, so the player sees what hit them. Only the clock's pace changes:
// the game still takes one step per input, so a replay plays back the same.
const SLOW_MO = { scale: 0.35, seconds: 0.7 };
let slowUntil = 0;
// The time each frame spends in this page's code (the game steps and issuing the draw calls; the GPU's own work is
// not in it), for the last 600 frames, kept without allocating. play_check.py reads it for the frame budget.
const frameCost = new Float32Array(600);

const controls = new Controls({
  wantsKeys: () => stageVisible && mode !== 'loading',
  onAction: action,
  touchRoot: stage,
});

// ---- the loop ----------------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  const started = performance.now();
  const dt = Math.min((now - last) / 1000, 0.25);
  last = now;
  const pace = (mode === 'replay' ? 2 : 1) * (now < slowUntil ? SLOW_MO.scale : 1);
  if (mode !== 'paused' && mode !== 'loading') alpha = clock.advance(dt * pace, stepOnce);
  else if (mode === 'paused') controls.pollPad(); // no steps run, so the pad's Start is read here to carry on
  if (renderer && game) renderer.draw(game, alpha, mode === 'paused' ? 0 : dt);
  frameCost[stats.frames % frameCost.length] = performance.now() - started;
  stats.frames += 1;
  requestAnimationFrame(frame);
}

function stepOnce() {
  const held = controls.sample();
  let input = 0;
  if (mode === 'playing') {
    input = held;
    log.record(input);
  } else if (mode === 'replay') {
    if (game.steps >= lastRun.steps) { finishReplay(); return; }
    input = lastRun.log.at(game.steps);
  }
  const events = game.step(input);
  stats.steps += 1;
  renderer.onEvents(events);
  if (mode === 'playing' || mode === 'replay') sound.onEvents(events, game.field.width);
  hudEvents(events);
  if (mode === 'playing' && game.over && !overAt) overAt = game.time + 2.2;
  if (mode === 'playing' && overAt && game.time >= overAt) endGame();
}

// ---- modes -------------------------------------------------------------------------------------
function show(id) {
  for (const el of stage.querySelectorAll('.screen')) el.hidden = el.id !== id;
  stage.dataset.mode = mode;
}

function newGame(options) {
  game = new Game(options);
  const { width, height } = game.field;
  renderer.setField(width, height);
  clock.accumulator = 0;
  updateHud();
}

function attract() {
  mode = 'title';
  newGame({ seed: (Math.random() * 2 ** 32) >>> 0, ...fieldFor(stage.clientWidth / stage.clientHeight), startingShips: 0 });
  $('titleBest').textContent = best ? `Best ${format(best)}` : '';
  show('title');
}

function start() {
  sound.unlock().then(soundButtons);
  mode = 'playing';
  overAt = 0;
  const options = { seed: (Math.random() * 2 ** 32) >>> 0, ...fieldFor(stage.clientWidth / stage.clientHeight) };
  newGame(options);
  log = new InputLog();
  lastRun = { options, log };
  controls.clear();
  stats.gamesStarted += 1;
  show(null);
  stage.focus({ preventScroll: true });
  fitStageOnScreen();
}

// A phone's stage is sized to the screen less the page header, but the page can be scrolled anywhere when Play is
// tapped, which left the touch buttons under the bottom edge. Bring the whole stage into view (the buttons first,
// if it is taller than the screen). Checked by play_check.py: "every touch button is on screen in play".
function fitStageOnScreen() {
  if (!stage.classList.contains('touch')) return;
  const r = stage.getBoundingClientRect();
  const below = r.bottom - innerHeight;
  const by = r.height > innerHeight || below > 0 ? below : (r.top < 0 ? r.top : 0);
  if (by) window.scrollBy({ top: by, behavior: 'instant' });
}

function pause(on) {
  if (on && mode === 'playing') { mode = 'paused'; controls.clear(); show('paused'); }
  else if (!on && mode === 'paused') { mode = 'playing'; last = performance.now(); show(null); fitStageOnScreen(); }
}

function endGame() {
  mode = 'over';
  lastRun.steps = log.length;
  lastRun.replayable = log.dropped === 0; // the log holds an hour of play; a longer game cannot be replayed
  lastRun.score = game.score;
  lastRun.snapshot = JSON.stringify(game.snapshot());
  const newBest = game.score > best;
  if (newBest) { best = game.score; saved.write('best', best); }
  $('overScore').textContent = format(game.score);
  $('overBest').textContent = newBest ? 'A new best score' : `Best ${format(best)}`;
  $('overWave').textContent = `Wave ${game.wave}, ${format(Math.round(game.steps / 60))} seconds`;
  $('replayBtn').hidden = !lastRun.replayable;
  $('replayResult').textContent = lastRun.replayable ? ''
    : 'No replay for this game: it ran past an hour, and the input log keeps only the first hour.';
  updateHud();
  show('over');
}

// Plays the last game again from its seed and its input log, at double speed, then checks that it
// ended in exactly the same state.
function watchReplay() {
  if (!lastRun || !lastRun.replayable) return;
  mode = 'replay';
  newGame(lastRun.options);
  show('replaying');
}

function finishReplay() {
  const same = JSON.stringify(game.snapshot()) === lastRun.snapshot;
  stats.replayMatched = same;
  $('replayResult').textContent = same
    ? `The replay ended exactly where your game did: ${format(lastRun.steps)} steps, score ${format(game.score)}.`
    : 'The replay did not match the game. That is a bug: please tell me.';
  mode = 'over';
  show('over');
}

function action(name) {
  if (mode === 'loading') return;
  if (name === 'start' && (mode === 'title' || mode === 'over')) start();
  else if (name === 'restart' && (mode === 'over' || mode === 'paused')) start();
  else if (name === 'pause') {
    if (mode === 'playing') pause(true); else if (mode === 'paused') pause(false); else if (mode === 'replay') { mode = 'over'; show('over'); }
  } else if (name === 'mute') toggleMute();
  else if (name === 'music') toggleMusic();
}

// ---- HUD ---------------------------------------------------------------------------------------
function updateHud() {
  $('score').textContent = format(game ? game.score : 0);
  $('best').textContent = format(Math.max(best, game && mode !== 'replay' ? game.score : 0));
  $('wave').textContent = game ? game.wave : 1;
  const ships = $('ships');
  const count = game ? Math.max(0, game.ships - (game.ship.alive ? 1 : 0)) : 0; // spare ships, not the one flying
  if (ships.childElementCount !== count) {
    ships.replaceChildren(...Array.from({ length: Math.min(count, 8) }, () => {
      const i = document.createElement('i');
      i.setAttribute('aria-hidden', 'true');
      return i;
    }));
    ships.setAttribute('aria-label', `${count} spare ${count === 1 ? 'ship' : 'ships'}`);
  }
  $('hud').hidden = mode === 'title' || mode === 'loading';
  $('hud').classList.toggle('lastship', !!game && !game.over && game.ships === 1); // the Ships label warns in red
}

function hudEvents(events) {
  let changed = false;
  for (const e of events) {
    if (e.type === 'rockBroken') { stats.rocksBroken += 1; stats.explosions += 1; }
    if (e.type === 'hunterDestroyed' || e.type === 'shipDestroyed') stats.explosions += 1;
    if (e.type === 'waveStart' && mode !== 'title') banner(`Wave ${game.wave}`);
    if (e.type === 'extraShip') banner('Extra ship');
    if (e.type === 'respawn' && game.ships === 1) banner('Last ship');
    if (e.type === 'shipDestroyed') { stats.shipsLost += 1; stats.slowMos += 1; slowUntil = performance.now() + SLOW_MO.seconds * 1000; }
    if (e.type !== 'shot') changed = true;
  }
  if (changed) updateHud();
}

let bannerTimer = 0;
function banner(text) {
  stats.banners.push(text);
  if (stats.banners.length > 20) stats.banners.shift();
  const el = $('banner');
  el.textContent = text;
  el.classList.remove('show');
  void el.offsetWidth; // restart the fade
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 1600);
}

// ---- sound buttons -----------------------------------------------------------------------------
function soundButtons() {
  $('muteBtn').setAttribute('aria-pressed', String(sound.muted));
  $('muteBtn').textContent = sound.muted ? 'Sound off' : 'Sound on';
  $('musicBtn').setAttribute('aria-pressed', String(!sound.musicOn));
  $('musicBtn').textContent = sound.musicOn ? 'Music on' : 'Music off';
  if (sound.problems.length) $('soundNote').textContent = `Some sounds cannot play in this browser: ${sound.problems.join('; ')}`;
}
function toggleMute() { sound.setMuted(!sound.muted); saved.write('muted', sound.muted); soundButtons(); }
function toggleMusic() { sound.setMusic(!sound.musicOn); saved.write('music', sound.musicOn); soundButtons(); }

// ---- page wiring -------------------------------------------------------------------------------
function wire() {
  $('playBtn').addEventListener('click', start);
  $('againBtn').addEventListener('click', start);
  $('restartBtn').addEventListener('click', start);
  $('resumeBtn').addEventListener('click', () => pause(false));
  $('replayBtn').addEventListener('click', watchReplay);
  $('stopReplayBtn').addEventListener('click', () => { mode = 'over'; show('over'); });
  $('pauseBtn').addEventListener('click', () => action('pause'));
  $('muteBtn').addEventListener('click', () => { sound.unlock().then(soundButtons); toggleMute(); });
  $('musicBtn').addEventListener('click', () => { sound.unlock().then(soundButtons); toggleMusic(); });
  const fullBtn = $('fullBtn');
  if (stage.requestFullscreen) {
    fullBtn.addEventListener('click', () => (document.fullscreenElement ? document.exitFullscreen() : stage.requestFullscreen())
      .catch(error => console.warn(`Shatterbelt: full screen was refused (${error.message})`)));
  } else fullBtn.hidden = true;  // an iPhone cannot make a page element full screen
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(true); });
  new IntersectionObserver(([entry]) => {
    stageVisible = entry.intersectionRatio >= 0.35;
    if (!stageVisible) pause(true);
  }, { threshold: [0, 0.35, 0.7, 1] }).observe(stage);
  new ResizeObserver(() => renderer && renderer.resize(stage.clientWidth, stage.clientHeight)).observe(stage);
  const touch = window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  stage.classList.toggle('touch', touch);
  $('titleHint').textContent = touch ? 'Tap Play. Steer with the buttons at the bottom.' : 'Press Enter or Space to play.';
  soundButtons();
}

async function boot() {
  wire();
  show('loading');
  try {
    const art = await loadArt();
    renderer = new Renderer($('canvas'), art, $('labels'));
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    renderer.calm = calm.matches;
    calm.addEventListener('change', () => { renderer.calm = calm.matches; });
  } catch (error) {
    $('loadingText').textContent = `The game could not start: ${error.message}`;
    stage.dataset.failed = 'true';
    throw error;
  }
  renderer.resize(stage.clientWidth, stage.clientHeight);
  if (stage.classList.contains('touch')) renderer.setInsets(56, 150); // the HUD above, the touch buttons below
  attract();
  requestAnimationFrame(t => { last = t; frame(t); });
}

// For the browser console and the scripted play-through (tools/play_check.py): read-only views.
window.shatterbelt = {
  get game() { return game; },
  get mode() { return mode; },
  get log() { return log; },
  get renderer() { return renderer; },
  frameCost,
  stats,
};

boot();
