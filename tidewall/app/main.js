// main.js - the page: one fixed-tick loop at the rules' own tick rate (GameRules.TicksPerSecond, read from the port), the menus
// driven by the ported MenuModel, the match by the ported MatchController, drawn by the WebGPU renderer, with an interpolation
// alpha between ticks. The flow is the original host's: a bot demo plays behind the title; START on the title opens the join
// screen; START there begins a match for the joined seats; the menu follows the match into the fate screen, the results, initials
// and the high scores, and back to the title. An untouched title plays the demo full screen (attract), and any press leaves it.
//
// URL switches (for a kiosk and for the page check): ?attract=1 the demo with HUD and sound and no menus; ?seed=N the match seed;
// ?speed=N run N ticks per tick of real time (1..16, default 1); ?quality=low starts the graphics on the low setting (Q switches).
import { GAME_TITLE } from './title.js';
import { InputHub, KEY_CLUSTERS, SEATS } from './input.js';
import { Overlay, HintStrip } from './overlay.js';
import { SoundPlayer, VOLUME } from './sound.js';
import { Phones } from './phones.js';
import { ControlsChoice, TouchPad } from './controls.js';
import { MapSource, CAMPAIGN_ISLANDS } from './maps.js';
import * as core from '../core/index.js';
import { createRenderer, NoWebGpuError, PLAYER_TEXT_CSS } from '../render/renderer.js';

const {
  GameRules, GameOptions, GridModel, MapCheck, MatchModel, MatchController, MenuModel, MenuInput, PadInput, Screen, MenuActionKind, HighScoreTable,
  SeededRandom, Synth, LoopClosed, Cell,
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
  const quality = q.get('quality');
  if (quality !== null && quality !== 'high' && quality !== 'low') throw new Error('?quality=' + quality + ' is not high or low');
  return { attract: q.get('attract') === '1', seed: int('seed', 0, 2147483647), speed: int('speed', 1, 16) ?? 1, quality: quality ?? 'high' };
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
    let coarse = false;
    if (typeof matchMedia === 'function') coarse = matchMedia('(pointer: coarse)').matches;
    this.controls = new ControlsChoice(GAME_TITLE.toLowerCase() + '-controls', { coarse, userAgent: navigator.userAgent });
    this.touchpad = new TouchPad(document.body);
    // the first match's hint strip (overlay.js HintStrip): the match and the round it speaks in, set when a player's first match starts
    this.hint = new HintStrip(document.body); this.hintMatch = null; this.hintRound = 0;
    this.input.attachTouch(this.touchpad);
    // the CONTROLS buttons on the join screen (overlay.js draws them), and C on the keyboard there
    document.getElementById('ui').addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('[data-controls]') : null;
      if (b) this.controls.set(b.dataset.controls);
    });
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyC' && !e.repeat && this.menu.screen === Screen.Setup && !this.sw.attract) this.controls.next(); });
    this.sound = new SoundPlayer(Synth);
    this.maps = new MapSource(GameRules.default());
    this.scoresNote = '';
    this.menu = new MenuModel(this.loadScores(), CAMPAIGN_ISLANDS);
    this.overlay = new Overlay(document.getElementById('ui'), PLAYER_TEXT_CSS, Screen, KEY_CLUSTERS.map((c) => 'P' + (c.seat + 1) + ': ' + c.help));
    this.seed = sw.seed ?? (Date.now() & 0x7fffffff);
    this.ticks = 0;
    this.acc = 0;
    this.events = [];             // events presented since the last drawn frame (the renderer's view.events)
    this.endedAt = -1;
    this.wasPresent = new Array(SEATS).fill(true);
    this.stopped = false;
    this.phonesOpened = false;
    this.pointerMode = false;      // the mouse player's hero follows the pointer (set when it moves in play, cleared by their stick)
    /** The page check's brake: when set, it is asked after every tick whether to stop there; the page then keeps drawing without
     *  ticking until the check clears `braked`. phaseTick is the tick the current (round, phase) began. */
    this.brake = null; this.braked = false; this.phaseKey = ''; this.phaseTick = 0;
    const wake = () => { this.sound.wake(); };
    window.addEventListener('keydown', wake);
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyQ' && !e.repeat) this.renderer.cycleQuality(); });   // graphics quality: high <-> low
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
    if (!demo && !this.sw.attract && this.hintMatch === null) { this.hintMatch = model; this.hintRound = model.round; }
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

  /** The mouse or a finger in a menu (11-09: a click on the title did nothing), the same rule as the private model's host:
   *  hovering a row chooses it (MenuModel.pointAt); a click takes the row UNDER the pointer as seat 1's confirm; a click on a
   *  screen with no rows (the title, the results, the scores) is "press a button"; a click beside the rows does nothing. On the
   *  join screen a click on a free seat's card joins that seat; the arrows beside a setup value step it; the initial being set steps
   *  its letter from its top or bottom half. The hit boxes are the ones the HUD drew this frame (render/hud.js hitAt). */
  pointerToMenu(menuIn, p) {
    if (!(p.click || p.moved) || Number.isNaN(p.x)) return;
    const screen = this.menu.screen;
    if (screen === Screen.Playing) return;                                  // in play the pointer does nothing (yet)
    const r = this.canvas.getBoundingClientRect(), hud = this.renderer.hud;
    const h = hud.hitAt(screen, p.x - r.left, p.y - r.top);
    if (h && (h.kind === 'row' || h.kind === 'step')) this.menu.pointAt(h.row);
    if (!p.click) return;
    // whose press a click is: P1's on the title (the mouse sits with P1's keys), else the first joined seat's (a menu takes only
    // joined seats' presses once anyone has joined, MenuModel._nav), so a group that joined from pads alone can still click
    const first = this.menu.joined.indexOf(true), seat = screen === Screen.Title || first < 0 ? 0 : first, s = menuIn[seat];
    if (!h) { if (!hud.hasHits(screen) || screen === Screen.Initials) s.confirm = true; return; }   // initials: a click is "next"
    if (h.kind === 'row') s.confirm = true;
    else if (h.kind === 'seat') { if (!this.menu.joined[h.seat]) menuIn[h.seat].confirm = true; }
    else if (h.kind === 'step') { if (h.dir < 0) s.left = true; else s.right = true; }
    else if (h.kind === 'letter') { if (h.dir < 0) s.up = true; else s.down = true; }
    else throw new Error('main.js: no pointer handling for a ' + h.kind + ' hit box');
  }

  /** The mouse in play is the keyboard player's (seat 1's; if seat 1 did not join, the first player's): the slot it drives. */
  get mouseSlot() { const k = this.seatOf.indexOf(0); return k >= 0 ? k : 0; }

  /** The pointer in play, onto the mouse player's PadInput (the private model's host does the same): once the pointer moves the hero follows
   *  the square under it (picked through the live camera, renderer.pickCell) until that player's stick or keys move again; a left
   *  click confirms at that square (claim, place a cannon, fire, place the piece), a right click rotates (a right drag pans and the
   *  wheel zooms the camera, input.js), middle click is
   *  ready (Tab too). `fields` is the slot's PadInput fields from its keys and pads, merged here. */
  pointerToPlay(fields, p) {
    const stick = fields.stickX !== 0 || fields.stickY !== 0;
    const out = Object.assign({}, fields);
    if (p.touch) {
      // a finger: the square under it is picked ONCE, when it touches, and the tap acts on that square when it lifts. It is not
      // picked again every tick (the camera follows the hero, so a still screen point would walk the hero across the map), and a
      // finger player is not a pointer player (the camera follows their hero, as a stick player's)
      this.pointerMode = false;
      if (p.click && !Number.isNaN(p.x)) this.touchCell = this.renderer.pickCell(p.x, p.y);
      if ((p.click || p.confirm) && this.touchCell) { out.hasPointer = true; out.pointer = new Cell(this.touchCell.x, this.touchCell.y); }
    } else {
      if (p.moved) this.pointerMode = true;
      if (stick && !p.moved) this.pointerMode = false;
      if (this.pointerMode && !Number.isNaN(p.x)) {
        const c = this.renderer.pickCell(p.x, p.y);
        if (c !== null) { out.hasPointer = true; out.pointer = new Cell(c.x, c.y); }
      }
    }
    out.confirm = fields.confirm || p.confirm; out.rotate = fields.rotate || p.rotate; out.ready = fields.ready || p.ready;
    return out;
  }

  /** The pointer cursor: a hand over anything the pointer can act on in a menu, a crosshair over the board in play. */
  pointerCursor() {
    const p = this.input.pointer, screen = this.menu.screen, r = this.canvas.getBoundingClientRect(), hud = this.renderer.hud;
    const menuUp = !this.sw.attract && !(screen === Screen.Playing);
    const on = menuUp && !Number.isNaN(p.x) && (!hud.hasHits(screen) || screen === Screen.Initials || hud.hitAt(screen, p.x - r.left, p.y - r.top) !== null);
    const aim = !this.sw.attract && !this.demo && screen === Screen.Playing && this.pointerMode;
    const want = on ? 'pointer' : aim ? 'crosshair' : '';
    if (document.body.style.cursor !== want) document.body.style.cursor = want;
  }

  gameTick() {
    this.ticks++;
    const seats = this.input.take();
    const menuIn = seats.map((s) => new MenuInput(s.menu));
    const ptr = this.input.takePointer();
    const wasPlaying = this.menu.screen === Screen.Playing && !this.demo;   // a click that started the match is not a move in it
    this.input.playing = wasPlaying;
    if (!this.sw.attract) this.pointerToMenu(menuIn, ptr);
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
    const mouse = this.mouseSlot, play = wasPlaying && this.menu.screen === Screen.Playing;
    // the camera may turn a quarter (portrait: it looks east, render/camera.js): every stick turns with it, so up on the stick is
    // up on the screen. A quarter turn maps whole numbers to whole numbers: (x, y) -> (-y, x) moves the cursor east for "up".
    const turn = this.renderer.screenTurn, turned = (pad) => (turn === 1 ? Object.assign({}, pad, { stickX: -pad.stickY, stickY: pad.stickX }) : pad);
    const pads = this.seatOf.map((seat, slot) => this.demo ? new PadInput()
      : new PadInput(play && slot === mouse ? this.pointerToPlay(turned(seats[seat].pad), ptr) : turned(seats[seat].pad)));
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
    // the renderer takes the seconds SINCE THE LAST FRAME (renderer.js frame(view, dt)). Until 11-09 this passed the page clock
    // (now / 1000), which the renderer clamps to 0.1 s, so every animation on the page ran 5-6x fast (measured: the renderer's clock
    // went 10.3 s in 2.0 s of wall time); the test scene and the review frames passed the right value and never showed it.
    // the camera's hints: the human players it frames (bots never steer it), the pointer player (its hero follows a still pointer,
    // so the camera must not follow that hero), the on-screen controls it keeps its frame clear of, and the player's own zoom/pan
    const playing = !this.demo && !this.sw.attract;
    // the hint strip: in the first round of the first match, while it is being played; under the top bar, or below any on-screen
    // control it would sit on (its rect is then a cover rect, so the camera frames round it)
    const hinting = playing && this.model === this.hintMatch && this.model.round === this.hintRound && this.menu.screen === Screen.Playing;
    this.hint.set(hinting ? Object.keys(core.Phase).find((k) => core.Phase[k] === this.model.phase) : null, this.controls.showsTouch, !hinting);
    const pads = this.touchpad.visible ? this.touchpad.coverRects() : [];
    if (this.hint.covering) this.hint.place(this.renderer.hudBarHeight() + 6, pads);
    const camera = {
      humans: playing ? this.seatOf.map((_, slot) => slot).filter((slot) => !this.controller.isBot(slot)) : [],
      pointerSlot: playing && this.pointerMode ? this.mouseSlot : -1,
      cover: this.hint.covering ? [...pads, this.hint.rect()] : pads,
      input: this.input.takeCamera(),
    };
    if (this.touchpad.takeFrame()) camera.input.toggle = true;
    this.renderer.frame({ match: this.model, controllers: [this.controller], hud: this.controller.hud, menu: this.menu, events, alpha, camera }, dt);
    this.pointerCursor();
    const joinScreen = !this.sw.attract && this.menu.screen === Screen.Setup;
    // the phone room: opened when a join screen shows and the CONTROLS choice includes phones, closed when LOCAL is chosen; its
    // phones are read by the input hub once it is open
    const phones = this.controls.usesPhones;
    if (phones && joinScreen && this.phones.state === 'off') {
      this.phones.open().then((ph) => { if (ph.state === 'open') this.input.attachPhones(ph.pads); });
    }
    if (!phones && this.phones.state !== 'off') { this.phones.close(); this.input.attachPhones(null); }
    this.phones.show(joinScreen && phones);
    this.touchpad.show(this.controls.showsTouch && !this.sw.attract && !this.demo && this.menu.screen === Screen.Playing);
    this.overlay.render({
      screen: this.menu.screen, inDemo: this.menu.inDemo, attract: this.sw.attract, devices: this.input.devices,
      phones: { state: this.phones.state, reason: this.phones.reason }, scoresNote: this.scoresNote, controls: this.controls.mode,
      touchControls: this.controls.showsTouch, touchFirst: this.controls.touchFirst,
      soundNote: this.silent ? '' : this.sound.needsGesture ? 'Press any key for sound' : '',
    });
  }

  run() {
    // dt is measured between animation-frame timestamps only: the first frame's timestamp is the start of that frame, which can be
    // EARLIER than a performance.now() read before it was requested (11-09: a negative first dt, refused by the renderer)
    let last = null;
    const loop = (now) => {
      if (this.stopped) return;
      const dt = last === null ? 0 : (now - last) / 1000; last = now;
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
  try { renderer = await createRenderer(canvas, { quality: sw.quality }); }
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
