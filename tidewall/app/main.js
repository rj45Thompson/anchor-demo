// main.js - the page: one fixed-tick loop at the rules' own tick rate (GameRules.TicksPerSecond, read from the port), the menus
// driven by the ported MenuModel, the match by the ported MatchController, drawn by the WebGPU renderer, with an interpolation
// alpha between ticks. The flow is the original host's: a bot demo plays behind the title; START on the title opens the join
// screen; START there begins a match for the joined seats; the menu follows the match into the fate screen, the results, initials
// and the high scores, and back to the title. An untouched title plays the demo full screen (attract), and any press leaves it.
//
// URL switches (for a kiosk and for the page check): ?attract=1 the demo with HUD and sound and no menus; ?seed=N the match seed;
// ?speed=N run N ticks per tick of real time (1..16, default 1).
import { GAME_TITLE } from './title.js';
import { InputHub, KEY_CLUSTERS, SEATS } from './input.js';
import { Overlay } from './overlay.js';
import { SoundPlayer, VOLUME } from './sound.js';
import { Phones } from './phones.js';
import { MapSource, CAMPAIGN_ISLANDS } from './maps.js';
import * as core from '../core/index.js';
import { createRenderer, NoWebGpuError, PLAYER_CSS } from '../render/renderer.js';

const {
  GameRules, GameOptions, GridModel, MapCheck, MatchModel, MatchController, MenuModel, MenuInput, PadInput, Screen, MenuActionKind, HighScoreTable,
  SeededRandom, Synth, LoopClosed,
} = core;

document.title = GAME_TITLE;

const TPS = GameRules.TicksPerSecond;
const STEP = 1 / TPS;
const DEMO_BOTS_FROM = 2 * TPS;      // AUTHORED: the demo's bots wait two seconds so the island is seen before anyone builds
const DEMO_RESTART = 6 * TPS;        // AUTHORED: an ended demo holds its last screen six seconds, then a new demo starts
const SCORES_KEY = GAME_TITLE.toLowerCase() + '-highscores';

/** The URL switches, checked: a value that does not parse is refused with what was wrong, never replaced by a default. */
function readSwitches() {
  const q = new URLSearchParams(location.search);
  const int = (name, lo, hi) => {
    if (!q.has(name)) return null;
    const v = Number(q.get(name));
    if (!Number.isInteger(v) || v < lo || v > hi) throw new Error('?' + name + '=' + q.get(name) + ' is not a whole number from ' + lo + ' to ' + hi);
    return v;
  };
  return { attract: q.get('attract') === '1', seed: int('seed', 0, 2147483647), speed: int('speed', 1, 16) ?? 1 };
}

function showFatal(text) {
  const box = document.createElement('div');
  box.id = 'nogpu';
  box.innerHTML = '<div><h1></h1><p></p></div>';
  box.querySelector('h1').textContent = GAME_TITLE;
  box.querySelector('p').textContent = text;
  document.getElementById('ui').replaceChildren();
  document.body.append(box);
}

/** Use case 1a: no WebGPU. The notice names the browsers that have it; nothing else is drawn (there is no WebGL stand-in). */
function noWebGpu(why) {
  showFatal(GAME_TITLE + ' draws with WebGPU, which this browser does not offer' + (why ? ' (' + why + ')' : '') + '. '
    + 'Open it in Chrome or Edge, version 113 or later, on Windows, macOS or ChromeOS.');
}

class Game {
  constructor(renderer, canvas, sw) {
    this.renderer = renderer; this.canvas = canvas; this.sw = sw;
    this.input = new InputHub(window);
    this.phones = new Phones(SEATS);
    this.sound = new SoundPlayer(Synth);
    this.maps = new MapSource(GameRules.default());
    this.scoresNote = '';
    this.menu = new MenuModel(this.loadScores(), CAMPAIGN_ISLANDS);
    this.overlay = new Overlay(document.getElementById('ui'), PLAYER_CSS, Screen, KEY_CLUSTERS.map((c) => 'P' + (c.seat + 1) + ': ' + c.help));
    this.seed = sw.seed ?? (Date.now() & 0x7fffffff);
    this.ticks = 0;
    this.acc = 0;
    this.events = [];             // events presented since the last drawn frame (the renderer's view.events)
    this.endedAt = -1;
    this.wasPresent = new Array(SEATS).fill(true);
    this.stopped = false;
    this.phonesOpened = false;
    /** The page check's brake: when set, it is asked after every tick whether to stop there; the page then keeps drawing without
     *  ticking until the check clears `braked`. phaseTick is the tick the current (round, phase) began. */
    this.brake = null; this.braked = false; this.phaseKey = ''; this.phaseTick = 0;
    const wake = () => { this.sound.wake(); };
    window.addEventListener('keydown', wake);
    window.addEventListener('pointerdown', wake);
    this.startMatch(true, null);
    if (sw.attract) this.menu.playing();
  }

  loadScores() {
    let text;
    try { text = localStorage.getItem(SCORES_KEY); }
    catch (e) { this.scoresNote = 'High scores are not kept in this browser: ' + e.message; this.scoresWritable = false; return new HighScoreTable(); }
    this.scoresWritable = true;
    if (!text) return new HighScoreTable();
    try { return HighScoreTable.parse(text); }
    catch (e) {
      // the stored table is unreadable: say so, and never write over it (the text is kept for a person to look at)
      this.scoresNote = 'The saved high scores could not be read (' + e.message + '); they are left untouched.';
      this.scoresWritable = false;
      return new HighScoreTable();
    }
  }

  saveScores() {
    if (!this.scoresWritable) return;
    try { localStorage.setItem(SCORES_KEY, this.menu.highScores.save()); }
    catch (e) { this.scoresNote = 'High scores could not be saved: ' + e.message; }
  }

  /** A new match: the demo (all four seats bots) or a game for the seats that joined. */
  startMatch(demo, joined) {
    const options = new GameOptions({ field: this.menu.options.field, level: this.menu.options.level });
    const seatOf = [];
    for (let s = 0; s < SEATS; s++) if (demo || joined[s]) seatOf.push(s);
    const seed = demo && !this.sw.attract ? (this.seed ^ (this.ticks & 0xffff)) : this.seed;
    const names = this.campaignFrom(this.menu.map.name);
    const levels = { names, load: (name, rules, challenge) => MapCheck.loadChecked(this.maps.byName(name), rules, challenge) };
    const first = GridModel.fromAscii(this.maps.byName(MatchModel.firstMapName(options, names)));
    const model = MatchModel.startOn(first, options, seatOf.length, seed, (key) => new SeededRandom(key), levels);
    const presenter = { isIdle: true, present: (e) => this.present(e) };
    this.demo = demo;
    this.seatOf = seatOf;
    this.model = model;
    this.events = [];
    this.endedAt = -1;
    this.controller = new MatchController(model, presenter);
    this.controller.hud.seatOfSlot = seatOf;
    for (let slot = 0; slot < seatOf.length; slot++) this.controller.setBot(slot, demo);
    if (demo) this.controller.botsFrom = DEMO_BOTS_FROM;
    this.connected = seatOf.map(() => true);
    this.phaseKey = ''; this.phaseTick = 0;
    this.grid = model.grid;
    this.renderer.setMatch(model, seatOf);
  }

  /** The campaign's four islands, starting with the one chosen on the setup screen and going on round the list. */
  campaignFrom(first) {
    const names = CAMPAIGN_ISLANDS.map((i) => i.name);
    const at = names.indexOf(first);
    if (at < 0) throw new Error('the setup screen chose an island the campaign does not have: ' + first);
    return names.map((_, k) => names[(at + k) % names.length]);
  }

  get silent() { return this.demo && !this.sw.attract; }

  present(e) {
    this.events.push(e);
    if (!this.silent) this.sound.forEvent(e, LoopClosed);
  }

  act(a) {
    this.sound.play(Synth.Sfx.MenuPick, this.ticks, 0, VOLUME.menuPick);
    switch (a.kind) {
      case MenuActionKind.StartGame: this.startMatch(false, this.menu.joined.slice()); break;
      case MenuActionKind.Restart: this.startMatch(false, this.menu.joined.slice()); break;
      case MenuActionKind.QuitToTitle: this.menu.toTitle(); this.startMatch(true, null); break;
      case MenuActionKind.StartDemo: break;                                   // the demo is already playing behind the title
      case MenuActionKind.Decide: this.controller.decide(a.flag); break;
      case MenuActionKind.SaveHighScores: this.saveScores(); break;
      case MenuActionKind.QuitApp: this.menu.toTitle(); this.startMatch(true, null); break;   // a web page cannot close itself: back to the title
      default: throw new Error('no handler for menu action ' + a.kind);
    }
  }

  /** Use case 2a: a human seat whose every device went away is marked disconnected in the model; its return takes the seat back. */
  followConnections() {
    for (let slot = 0; slot < this.seatOf.length; slot++) {
      if (this.controller.isBot(slot)) continue;
      const present = this.input.devices[this.seatOf[slot]].any;
      if (present !== this.connected[slot]) { this.controller.setConnected(slot, present); this.connected[slot] = present; }
    }
  }

  gameTick() {
    this.ticks++;
    const seats = this.input.take();
    const menuIn = seats.map((s) => new MenuInput(s.menu));
    if (!this.sw.attract) {
      const before = this.menu.screen + ':' + this.menu.row + ':' + this.menu.joinedCount;
      const acts = this.menu.update(menuIn, this.demo ? null : this.model);
      for (const a of acts) this.act(a);
      if (this.menu.screen + ':' + this.menu.row + ':' + this.menu.joinedCount !== before) this.sound.play(Synth.Sfx.MenuMove, this.ticks, 0, VOLUME.menuMove);
    }
    const sc = this.menu.screen;
    const run = this.sw.attract || (this.demo ? sc === Screen.Title || sc === Screen.Setup || sc === Screen.HighScores
                                              : sc === Screen.Playing || sc === Screen.Decide || sc === Screen.Results);
    if (!run) return;                                                       // paused: the rules do not run
    if (!this.demo) this.followConnections();
    const pads = this.seatOf.map((seat) => this.demo ? new PadInput() : new PadInput(seats[seat].pad));
    this.controller.frame(pads);
    const key = this.model.round + ':' + this.model.phase;
    if (key !== this.phaseKey) { this.phaseKey = key; this.phaseTick = this.model.tick; }
    if (this.brake && this.brake(this)) this.braked = true;
    if (this.model.grid !== this.grid) { this.grid = this.model.grid; this.renderer.setMatch(this.model, this.seatOf); }   // a new island
    if (this.demo && this.model.ended) {
      if (this.endedAt < 0) this.endedAt = this.ticks;
      else if (this.ticks - this.endedAt >= DEMO_RESTART) this.startMatch(true, null);
    }
  }

  frame(dt, seconds) {
    this.input.poll();
    this.acc += Math.min(dt, 0.25) * this.sw.speed;
    let steps = 0;
    const max = 8 * this.sw.speed;
    while (this.acc >= STEP && steps < max && !this.braked) { this.gameTick(); this.acc -= STEP; steps++; }
    if (this.braked) this.acc = 0;
    if (this.acc > STEP * max) this.acc = STEP * max;   // a stalled tab does not owe a burst of ticks when it comes back
    const alpha = Math.min(1, this.acc / STEP);
    const events = this.events; this.events = [];
    this.renderer.frame({ match: this.model, controllers: [this.controller], hud: this.controller.hud, menu: this.menu, events, alpha }, seconds);
    const joinScreen = !this.sw.attract && this.menu.screen === Screen.Setup;
    if (joinScreen && !this.phonesOpened) { this.phonesOpened = true; this.phones.open(); }   // a room opens when a join screen first shows
    this.phones.show(joinScreen);
    this.overlay.render({
      screen: this.menu.screen, inDemo: this.menu.inDemo, attract: this.sw.attract, devices: this.input.devices,
      phones: { state: this.phones.state, reason: this.phones.reason }, scoresNote: this.scoresNote,
      soundNote: this.silent ? '' : this.sound.needsGesture ? 'Press any key for sound' : '',
    });
  }

  run() {
    let last = performance.now();
    const loop = (now) => {
      if (this.stopped) return;
      const dt = (now - last) / 1000; last = now;
      try { this.frame(dt, now / 1000); }
      catch (e) {
        this.stopped = true;
        console.error(e);
        showFatal('The game stopped: ' + (e && e.stack ? e.stack : e));
        return;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

async function boot() {
  const sw = readSwitches();
  if (!navigator.gpu) { noWebGpu('navigator.gpu is missing'); return; }
  const canvas = document.getElementById('view');
  let renderer;
  try { renderer = await createRenderer(canvas); }
  catch (e) {
    if (e instanceof NoWebGpuError) { noWebGpu(e.message); return; }
    throw e;
  }
  const fit = () => { const w = window.innerWidth, h = window.innerHeight; renderer.resize(w, h); };
  window.addEventListener('resize', fit);
  fit();
  const game = new Game(renderer, canvas, sw);
  await renderer.settle();        // the first island's pipelines are built before the loop starts (a first-second stall drops a tap)
  window.__game = game;           // the page check reads the model, the menu and the controller through these two
  window.__core = core;
  game.run();
}

boot().catch((e) => { console.error(e); showFatal('The game could not start: ' + (e && e.stack ? e.stack : e)); });
