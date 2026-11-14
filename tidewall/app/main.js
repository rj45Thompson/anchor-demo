// main.js - the page: one fixed-tick loop at the rules' own tick rate (GameRules.TicksPerSecond, read from the port), the menus
// driven by the ported MenuModel, the match by the ported MatchController, drawn by the WebGPU renderer, with an interpolation
// alpha between ticks. The flow is the original host's: a bot demo plays behind the title; START on the title opens the join
// screen; START there begins a match for the joined seats; the menu follows the match into the fate screen, the results, initials
// and the high scores, and back to the title. An untouched title plays the demo full screen (attract), and any press leaves it.
//
// URL switches (for a kiosk and for the page check): ?attract=1 the demo with HUD and sound and no menus; ?seed=N the match seed;
// ?speed=N run N ticks per tick of real time (1..16, default 1); ?quality=low starts the graphics on the low setting (G switches);
// ?bombs=0 plays the base rules (no bombs, no shop; a hidden switch for the page checks - bombs are the game); ?dev=0|1 overrides
// whether this is a development page (a sound file that fails to load stops a development page; a public one shows it on the title
// footer); by default a page served from this machine (localhost, 127.0.0.1, ::1) is a development page.
//
// The page's host (app/host.js, SETTINGS_UC.md UC-DH1): a program that runs this page (the desktop build) sets window.tidewallHost
// before this module runs; it is read once, checked whole, and from then on supplies the storage, the title footer's extra lines,
// whether phones may join, QUIT and the match events. With no host the page is the web page it always was.
import { GAME_TITLE } from './title.js';
import { readHost } from './host.js';
import { InputHub, SEATS, tickMoments, PointerSquare } from './input.js';
import { Overlay, HintStrip } from './overlay.js';
import { SoundPlayer, SoundLoadError } from './sound.js';
import { musicFor, duckFor, bedFor } from './soundbank.js';
import { STORE_PACKS } from '../render/packs.js';
import { Phones } from './phones.js';
import { ControlsChoice, TouchPad } from './controls.js';
import { ActionBar, ACTIONS } from './actions.js';
const PLACE_ACTION = ACTIONS.find((a) => a.id === 'place');   // its label is the touch A button's caption too
import { MapSource, CAMPAIGN_ISLANDS, campaignNames } from './maps.js';
import * as core from '../core/index.js';
import { createRenderer, NoWebGpuError, PLAYER_TEXT_CSS } from '../render/renderer.js';

const {
  GameRules, GameOptions, GameType, Campaign, GridModel, MapCheck, MatchModel, MatchController, MenuModel, MenuInput, PadInput, Screen, MenuActionKind, HighScoreTable,
  SeededRandom, Synth, Cell, SettingsModel, SettingsError, KeyBindings, KeyBindingsError, FirstMatchGuide,
} = core;

document.title = GAME_TITLE;

const TPS = GameRules.TicksPerSecond;
const STEP = 1 / TPS;
const DEMO_BOTS_FROM = 2 * TPS;      // AUTHORED: the demo's bots wait two seconds so the island is seen before anyone builds
const DEMO_RESTART = 6 * TPS;        // AUTHORED: an ended demo holds its last screen six seconds, then a new demo starts
const SCORES_KEY = GAME_TITLE.toLowerCase() + '-highscores';
const SOUND_KEY = GAME_TITLE.toLowerCase() + '-sound';     // R4: mute and the three volumes, kept like the high scores
const MOTION_KEY = GAME_TITLE.toLowerCase() + '-motion';   // SETTINGS_UC.md UC-ST2: 'full' or 'reduced', the bare word
const KEYS_KEY = GAME_TITLE.toLowerCase() + '-keys';       // UC-ST3: the rebound keys, KeyBindings.save()
const GUIDE_HOLD = 1.6;                                    // AUTHORED (UC-T2): seconds a finished phase's ticked goals stay up
const SMOOTH_FRAMES = 10, SMOOTH_MS = 40, REVEAL_MAX = 4;   // AUTHORED (LOAD_UC.md UC-L7 step 3): the game shows once it runs smoothly
// AUTHORED (CONTROLS_SMOOTH_UC.md UC-C2 step 1): a started match shows once the GPU keeps up with its island - HOLD_SMOOTH frames in a
// row whose GPU work is done within SMOOTH_MS of their start (three shadow-map redraws, renderer.js SHADOW_EVERY 2: after the island's
// draw the shadow frames were the slow ones, 11-13) - or HOLD_MAX s after its draw, whichever is first (as the boot's reveal: a device
// that never runs smoothly still plays)
const HOLD_SMOOTH = 6, HOLD_MAX = REVEAL_MAX;
const LIFT_PX = 64;                                        // AUTHORED (UC-P4): a dragged ghost rides this far above the finger (a fingertip ~40 px)
const TEXT_KEY = GAME_TITLE.toLowerCase() + '-text';       // UC-ST4: the text size percent, the bare number

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
  const bombs = int('bombs', 0, 1), dev = int('dev', 0, 1);
  // RJ 11-11 "put all the features in": the FULL rules (land, pits, gunboats, the dreadnought, fireships, the serpent, mortars, kites,
  // treasure) are the game; ?rules=classic plays the ported base rules alone
  const rules = q.get('rules') ?? 'full';
  if (rules !== 'full' && rules !== 'classic') throw new Error('?rules=' + rules + ' is not full or classic');
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(location.hostname);
  return { check: q.get('check') === '1', attract: q.get('attract') === '1', seed: int('seed', 0, 2147483647), speed: int('speed', 1, 16) ?? 1, quality: quality ?? 'high', bombs: bombs !== 0, full: rules === 'full',
           dev: dev === null ? local : dev === 1 };
}

function showFatal(text) {
  const box = document.createElement('div');
  box.id = 'nogpu';
  box.innerHTML = '<div><h1></h1><p></p></div>';
  box.querySelector('h1').textContent = GAME_TITLE;
  box.querySelector('p').textContent = text;
  document.body.classList.remove('booting', 'revealing');               // UC-L7: a notice is never left under the loading screen
  document.getElementById('ui').replaceChildren();
  document.body.append(box);
}

/** Use case 1a: no WebGPU. The notice names the browsers that have it; nothing else is drawn (there is no WebGL stand-in). */
function noWebGpu(why) {
  showFatal(GAME_TITLE + ' draws with WebGPU, which this browser does not offer' + (why ? ' (' + why + ')' : '') + '. '
    + 'Open it in Chrome or Edge, version 113 or later, on Windows, macOS or ChromeOS.');
}

class Game {
  /** host: the checked page host (app/host.js readHost), or null on the web. */
  constructor(renderer, canvas, sw, host) {
    this.renderer = renderer; this.canvas = canvas; this.sw = sw; this.host = host;
    this.keysNote = '';                                            // UC-ST3 3e / UC-ST4: an unreadable or unsaved key or text setting
    this.keyBindings = this.loadKeys();
    this.input = new InputHub(window, this.keyBindings);
    this.phones = new Phones(SEATS);
    let coarse = false;
    if (typeof matchMedia === 'function') coarse = matchMedia('(pointer: coarse)').matches;
    this.controls = new ControlsChoice(GAME_TITLE.toLowerCase() + '-controls', { coarse, userAgent: navigator.userAgent,
      storage: host ? host.storage : null, phones: host ? host.phones : null });
    // who plays, for the host's match events: no person plays the bots' demo or the attract match
    const game = this;
    this.who = Object.freeze({ get demo() { return game.demo || game.sw.attract; }, isHuman: (slot) => !game.controller.isBot(slot) });
    this.touchpad = new TouchPad(document.body);
    // the first match's hint strip (overlay.js HintStrip): the match and the round it speaks in, set when a player's first match starts
    this.hint = new HintStrip(document.body); this.hintMatch = null; this.hintRound = 0; this.guide = null;
    this.input.attachTouch(this.touchpad);
    // the action bar: labelled buttons for the mouse and keyboard player (touch has its own on-screen buttons)
    this.bar = new ActionBar(document.body, ACTIONS);
    this.input.attachBar(this.bar);
    // the CONTROLS buttons on the join screen (overlay.js draws them), and C on the keyboard there
    // and the SETTINGS button on the title and the join screen (its press is taken by the next tick, gameTick)
    this.settingsAsked = false;
    document.getElementById('ui').addEventListener('click', (e) => {
      const b = e.target instanceof Element ? e.target.closest('[data-controls]') : null;
      if (b) this.controls.set(b.dataset.controls);
      if (e.target instanceof Element && e.target.closest('[data-settings]')) this.settingsAsked = true;
      const info = e.target instanceof Element ? e.target.closest('[data-info]') : null;
      if (info) this.infoAsked = info.dataset.info;                   // 'open', 'close' or 'page:N', taken by the next tick
    });
    this.infoAsked = null;
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyC' && !e.repeat && this.menu.screen === Screen.Setup && !this.menu.settingsOpen && !this.sw.attract) this.controls.next(); });
    this.soundNote = '';
    this.motionNote = '';                                          // UC-ST2 alternate 1a: an unreadable or unsaved motion setting
    // the settings (SETTINGS_UC.md UC-ST1): the stored sound settings and the quality the page started on, one SettingsModel the
    // menu's settings rows, M and G all change; applySound / applyQuality hand it to the SoundPlayer and the renderer
    const settings = this.loadSettings();
    this.sound = new SoundPlayer(Synth, settings.sound());
    this.maps = new MapSource(GameRules.default());
    this.scoresNote = '';
    this.menu = new MenuModel(this.loadScores(), CAMPAIGN_ISLANDS, settings, this.keyBindings);
    const kb = this.keyBindings;
    this.overlay = new Overlay(document.getElementById('ui'), PLAYER_TEXT_CSS, Screen, () => [0, 1].map((s) => 'P' + (s + 1) + ': ' + kb.help(s)), MenuModel.InfoPages);
    this.seed = sw.seed ?? (Date.now() & 0x7fffffff);
    this.ticks = 0;
    this.acc = 0;
    this.preparing = false;       // UC-C2 step 1: false, or 'draw' / 'settle' while a new island is got ready (prepareLevel): no tick runs
    this.prepared = null;
    this.settle = null;
    this.events = [];             // events presented since the last drawn frame (the renderer's view.events)
    this.endedAt = -1;
    this.wasPresent = new Array(SEATS).fill(true);
    this.stopped = false;
    this.phonesOpened = false;
    this.shopOpen = false;         // a touch screen's shop row is open
    this.pointerMode = false;      // the mouse player's hero follows the pointer (set when it moves in play, cleared by their stick)
    this.mouseSquare = new PointerSquare();   // UC-C2: the square the mouse names, picked when it moves, not again under a moving camera
    /** The page check's brake: when set, it is asked after every tick whether to stop there; the page then keeps drawing without
     *  ticking until the check clears `braked`. phaseTick is the tick the current (round, phase) began. */
    this.brake = null; this.braked = false; this.phaseKey = ''; this.phaseTick = 0;
    /** The page check's still frame: while set, every frame is drawn with no time passing (dt 0, the clock where it stood), so two
     *  pictures of one moment differ only by what the check changed between them (run_page rise_drawn: a hero's idle pose and the
     *  waving flags were counted as a column's noise, 11-13). */
    this.still = false; this.clock = 0;
    const wake = () => { this.sound.wake(); };
    window.addEventListener('keydown', wake);
    // graphics quality: high <-> low (the settings' GRAPHICS row follows it)
    window.addEventListener('keydown', (e) => { if (e.code === 'KeyG' && !e.repeat) { this.menu.settings.toggleQuality(); this.applyQuality(); } });
    window.addEventListener('pointerdown', wake);
    // M mutes (UC-S2 1a) everywhere, and the choice is kept (the settings' MUTE row follows it). Player 2's trap key moved from M to
    // Numpad 0 (next to their Numpad 1-4 shop keys, app/input.js) so the two never clash.
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyM' || e.repeat) return;
      this.menu.settings.toggleMute();
      this.applySound(0.05);
    });
    this.applyMotion(false);                                       // UC-ST2 step 1: the motion the page starts with
    this.applyText(false);                                         // UC-ST4: the text size the page starts with
    this.textAsked = this.menu.settings.text;
    this.startMatch(true, null);
    if (sw.attract) this.menu.playing();
  }

  /** Where the page keeps its saved values: the host's storage, or the browser's localStorage. Read inside each caller's try: a
   *  browser that refuses localStorage throws on the read. */
  store() { return this.host ? this.host.storage : localStorage; }

  loadScores() {
    let text;
    try { text = this.store().getItem(SCORES_KEY); }
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

  /** R4: the settings (core/controller/SettingsModel.js): the stored sound settings ({ muted, music, fx, ambience }, each volume 0..1,
   *  a whole percent) and the quality the page started on. Unreadable ones are reported and never written over. */
  /** UC-ST2 step 1: the stored motion, else the system's (prefers-reduced-motion). An unreadable stored value is said on the title
   *  foot and left untouched until the player changes MOTION (alternate 1a). */
  loadMotion() {
    const system = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full';
    let text;
    try { text = this.store().getItem(MOTION_KEY); }
    catch (e) { this.motionStorable = false; return system; }              // no storage: the sound settings' note already says so
    this.motionStorable = true;
    if (text === null) return system;
    try { return SettingsModel.parseMotion(text); }
    catch (e) {
      if (!(e instanceof SettingsError)) throw e;
      this.motionNote = "The saved motion setting could not be read (" + e.message + "); the system's choice is used and the saved one is left untouched.";
      return system;
    }
  }

  /** UC-ST3 3e: the stored keys, else the shipped ones. Unreadable ones are said on the title foot and never written over until the
   *  player changes a key. */
  loadKeys() {
    let text;
    try { text = this.store().getItem(KEYS_KEY); }
    catch (e) { this.keysStorable = false; return KeyBindings.defaults(); }   // no storage: the sound settings' note already says so
    this.keysStorable = true;
    if (text === null) return KeyBindings.defaults();
    try { return KeyBindings.parse(text); }
    catch (e) {
      if (!(e instanceof KeyBindingsError)) throw e;
      this.keysNote = 'The saved keys could not be read (' + e.message + '); the shipped keys are used and the saved ones are left untouched.';
      return KeyBindings.defaults();
    }
  }

  saveKeys() {
    if (!this.keysStorable) return;
    try { this.store().setItem(KEYS_KEY, this.keyBindings.save()); this.keysNote = ''; }
    catch (e) { this.keysNote = 'The keys could not be saved: ' + e.message; }
  }

  /** UC-ST4 step 3: the stored text size percent, else 100. */
  loadText() {
    let text;
    try { text = this.store().getItem(TEXT_KEY); }
    catch (e) { this.textStorable = false; return 100; }
    this.textStorable = true;
    if (text === null) return 100;
    try { return SettingsModel.parseText(text); }
    catch (e) {
      if (!(e instanceof SettingsError)) throw e;
      this.keysNote = 'The saved text size could not be read (' + e.message + '); 100 % is used and the saved one is left untouched.';
      return 100;
    }
  }

  /** UC-ST4 steps 1-2: the HUD and the page's panels at the TEXT SIZE (what this screen can give, hud.js textScaleFor); stored when
   *  the player changed it (save: true). */
  applyText(save) {
    const st = this.menu.settings, hud = this.renderer.hud;
    hud.setTextSize(st.text / 100);
    this.showTextSize();
    if (!save || !this.textStorable) return;
    try { this.store().setItem(TEXT_KEY, String(st.text)); }
    catch (e) { this.keysNote = 'The text size could not be saved: ' + e.message; }
  }

  /** The page's panels at the size the HUD gives (style.css --ts); a resize can change it (hud.js textScaleFor), so frame() asks. */
  showTextSize() {
    const s = this.renderer.hud.s;
    if (s === this.tsShown) return;
    this.tsShown = s; this.textGiven = Math.round(s * 100);
    document.documentElement.style.setProperty('--ts', String(s));
  }

  /** The renderer follows the MOTION setting; it is stored when the player changed it (save: true). */
  applyMotion(save) {
    const st = this.menu.settings;
    this.renderer.setMotion(st.reducedMotion);
    if (!save || !this.motionStorable) return;
    try { this.store().setItem(MOTION_KEY, st.motion); this.motionNote = ''; }
    catch (e) { this.motionNote = 'The motion setting could not be saved: ' + e.message; }
  }

  loadSettings() {
    const motion = this.loadMotion();
    const textSize = this.loadText();
    const first = SettingsModel.defaults(this.sw.quality, motion, textSize);
    let text;
    try { text = this.store().getItem(SOUND_KEY); }
    catch (e) { this.soundNote = 'Sound settings are not kept in this browser: ' + e.message; this.soundWritable = false; return first; }
    this.soundWritable = true;
    if (!text) return first;
    try { return SettingsModel.parse(text, this.sw.quality, motion, textSize); }
    catch (e) {
      if (!(e instanceof SettingsError)) throw e;
      this.soundNote = 'The saved sound settings could not be read (' + text.slice(0, 60) + '); they are left untouched.';
      this.soundWritable = false;
      return first;
    }
  }

  saveSoundSettings() {
    if (!this.soundWritable) return;
    try { this.store().setItem(SOUND_KEY, this.menu.settings.save()); }
    catch (e) { this.soundNote = 'Sound settings could not be saved: ' + e.message; }
  }

  /** The settings' sound onto the SoundPlayer's master and bus gains (ramped over `secs`; 0 = at once: a time constant of 1 ms, so
   *  the pick that follows a settings change is heard at the new level), then stored. */
  applySound(secs) {
    this.sound.settings = this.menu.settings.sound();
    this.sound.applySettings(secs);
    this.saveSoundSettings();
  }

  /** The settings' graphics quality onto the renderer (its own note shows the switch). */
  applyQuality() {
    const q = this.menu.settings.quality;
    if (this.renderer.quality !== q) this.renderer.setQuality(q);
    if (this.renderer.quality !== q) throw new Error('main.js: the renderer stayed on ' + this.renderer.quality + ' graphics after setQuality(' + q + ')');
  }

  /** The SETTINGS button is offered on the title (not while the demo fills it) and on the join screen, while the panel is shut. */
  get settingsOffered() {
    const sc = this.menu.screen;
    return !this.sw.attract && !this.menu.settingsOpen && !this.menu.infoOpen && ((sc === Screen.Title && !this.menu.inDemo) || sc === Screen.Setup);
  }

  /** The CONTROLS & CREDITS panel (TITLE_UC.md UC-T1) is offered where SETTINGS is, while neither panel is open. */
  get infoOffered() { return this.settingsOffered; }

  saveScores() {
    if (!this.scoresWritable) return;
    try { this.store().setItem(SCORES_KEY, this.menu.highScores.save()); }
    catch (e) { this.scoresNote = 'High scores could not be saved: ' + e.message; }
  }

  /** A new match: the demo (all four seats bots) or a game for the seats that joined. */
  startMatch(demo, joined) {
    const options = new GameOptions({ type: this.sw.full ? GameType.Full : GameType.Normal, field: this.menu.options.field, level: this.menu.options.level, bombs: this.sw.bombs });
    const seatOf = [];
    for (let s = 0; s < SEATS; s++) if (demo || joined[s]) seatOf.push(s);
    const seed = demo && !this.sw.attract ? (this.seed ^ (this.ticks & 0xffff)) : this.seed;
    const names = campaignNames(this.menu.map.name, CAMPAIGN_ISLANDS, Campaign.mapCount(options));   // 4 islands, 6 with the full rules' Challenge rounds
    const maps = this.maps.forPlayers(seatOf.length);   // UC-S1: the island's size follows the player count (1-2 small, 3 medium, 4 large)
    const levels = { names, load: (name, rules, challenge) => MapCheck.loadChecked(maps.byName(name), rules, challenge) };
    const first = GridModel.fromAscii(maps.byName(MatchModel.firstMapName(options, names)));
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
    this.sound.newMatch();
    if (!demo && !this.sw.attract && this.hintMatch === null) {
      this.hintMatch = model; this.hintRound = model.round;
      this.guide = new FirstMatchGuide(0);                            // UC-T2: the first match's first player (slot 0 is a person here)
    }
  }


  get silent() { return this.demo && !this.sw.attract; }

  present(e) {
    this.events.push(e);
    if (this.guide && this.model === this.hintMatch && this.model.round === this.hintRound) this.guide.see([e]);   // UC-T2
    this.sound.forEvent(e, !this.silent);
    if (this.host) this.host.event(e, this.who);
  }

  act(a) {
    // a settings change is applied first, so its pick is heard at the new effects volume (UC-ST1 step 3)
    if (a.kind === MenuActionKind.SettingsChanged) {
      const motionChanged = (this.renderer.reducedMotion === true) !== this.menu.settings.reducedMotion;
      const textChanged = this.textAsked !== this.menu.settings.text;
      this.applyQuality(); this.applySound(0); this.applyMotion(motionChanged); this.applyText(textChanged); this.textAsked = this.menu.settings.text;
      this.sound.menu('pick', this.ticks); return;
    }
    if (a.kind === MenuActionKind.KeysChanged) { this.saveKeys(); this.sound.menu('pick', this.ticks); return; }   // UC-ST3 step 3
    this.sound.menu('pick', this.ticks);
    switch (a.kind) {
      case MenuActionKind.StartGame: this.startMatch(false, this.menu.joined.slice()); this.prepareLevel(Screen.Setup); break;
      case MenuActionKind.Restart: this.startMatch(false, this.menu.joined.slice()); this.prepareLevel(Screen.Pause); break;
      case MenuActionKind.QuitToTitle: this.menu.toTitle(); this.startMatch(true, null); break;
      case MenuActionKind.StartDemo: break;                                   // the demo is already playing behind the title
      case MenuActionKind.Decide: this.controller.decide(a.flag); break;
      case MenuActionKind.SaveHighScores: this.saveScores(); break;
      case MenuActionKind.QuitApp:
        if (this.host) { this.host.quit(); break; }                         // the host closes the program
        this.menu.toTitle(); this.startMatch(true, null); break;            // a web page cannot close itself: back to the title
      default: throw new Error('no handler for menu action ' + a.kind);
    }
  }

  /** CONTROLS_SMOOTH_UC.md UC-C2 step 1: the island setMatch just built has its pipelines built before it is played. A started match
   *  (`screen`: the join screen or the pause menu it was started from) holds that screen, taking no input, until the renderer's one
   *  draw of everything the island draws later has been done by the GPU, and the GPU then finishes HOLD_SMOOTH frames in a row
   *  within SMOOTH_MS of their start (or HOLD_MAX s have passed, as the boot's reveal). While it holds, the match's overlays and HUD
   *  are painted unseen (frame: warming; renderer.warmPlayingHud), so what the match shows first has been drawn once. Measured 11-13
   *  (run_page ctl): after the island's draw the held frames still finished 73-165 ms late on the GPU, and the overlays' and the
   *  HUD's first paint (Skia building its raster programs) made the match's first frames 53-159 ms; the gate waits both out. A new
   *  island mid-match (`screen` null) holds the rules the same way. The rules never run while it lasts, so no tick is caught up
   *  after it and no press is lost to it. prepared: the hold (the page check reads it). */
  prepareLevel(screen) {
    if (this.preparing) throw new Error('prepareLevel: a level is already being prepared');
    if (screen !== null) this.menu.hold(screen);
    const from = performance.now();
    this.preparing = 'draw';
    this.renderer.prepareLevel().then(() => {
      this.prepared = { drawMs: Math.round(performance.now() - from), screen };
      this.settle = { from, drawn: performance.now(), run: 0, screen, frames: [] };
      this.preparing = 'settle';                                              // frame() ends it (settleLevel)
    }, (e) => { this.stopped = true; console.error(e); showFatal('The graphics device failed while the island was got ready: ' + e); });
  }

  /** prepareLevel's second half, at the start of each frame while it settles: the hold ends once the GPU has finished HOLD_SMOOTH
   *  frames in a row within SMOOTH_MS of their start, or HOLD_MAX s after the island's draw. Measured on the GPU, not by the frames'
   *  spacing: 11-13 the held frames came 12-17 ms apart while their GPU work finished 73-165 ms late (the browser queues frames ahead
   *  of a GPU that lags), and the first frames of the match then stalled 52 and 159 ms. */
  settleLevel() {
    const s = this.settle, now = performance.now();
    while (s.frames.length > 0 && s.frames[0].done !== null) { const f = s.frames.shift(); s.run = f.done - f.t < SMOOTH_MS ? s.run + 1 : 0; }
    if (s.run < HOLD_SMOOTH && now - s.drawn < HOLD_MAX * 1000) {
      const f = { t: now, done: null };                                        // this frame: when the GPU finishes what it submits
      s.frames.push(f);
      queueMicrotask(() => this.renderer.renderer.backend.device.queue.onSubmittedWorkDone().then(() => { f.done = performance.now(); }));
      return;
    }
    this.preparing = false; this.settle = null; this.acc = 0;
    Object.assign(this.prepared, { ms: Math.round(now - s.from), smooth: s.run >= HOLD_SMOOTH, at: Math.round(now) });
    // UC-C2 3b: what was pressed on the held screen is dropped (a second START must not pause the match it started); a press made
    // while a new island got ready mid-match is kept for the first tick, as any press is
    if (s.screen !== null) { this.input.take(); this.input.takePointer(); this.menu.playing(); }
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
   *  its letter from its top or bottom half. The hit boxes are the ones the HUD drew this frame (render/hud.js hitAt); while the
   *  settings panel is open, its rows and arrows as the overlay drew them (overlay.js settingsHitAt), the same kinds of box, and a
   *  click beside them does nothing. */
  pointerToMenu(menuIn, p) {
    if (!(p.click || p.moved) || Number.isNaN(p.x)) return;
    const screen = this.menu.screen, settings = this.menu.settingsOpen;
    if (screen === Screen.Playing) return;                                  // in play the pointer does nothing (yet)
    if (this.menu.infoOpen) return;                                         // the info panel takes its own clicks (overlay.js infoPanel)
    const r = this.canvas.getBoundingClientRect(), hud = this.renderer.hud;
    const h = settings ? this.overlay.settingsHitAt(p.x, p.y) : hud.hitAt(screen, p.x - r.left, p.y - r.top);
    if (h && (h.kind === 'row' || h.kind === 'step')) this.menu.pointAt(h.row);
    if (!p.click) return;
    // whose press a click is: P1's on the title (the mouse sits with P1's keys), else the first joined seat's (a menu takes only
    // joined seats' presses once anyone has joined, MenuModel._nav), so a group that joined from pads alone can still click
    const first = this.menu.joined.indexOf(true), seat = screen === Screen.Title || first < 0 ? 0 : first, s = menuIn[seat];
    if (!h) { if (!settings && (!hud.hasHits(screen) || screen === Screen.Initials)) s.confirm = true; return; }   // initials: a click is "next"
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
    // a stick push, or a key / d-pad press shorter than a tick (its latched step), hands the hero back from the pointer
    const stick = fields.stickX !== 0 || fields.stickY !== 0 || fields.stepX !== 0 || fields.stepY !== 0;
    const out = Object.assign({}, fields);
    if (p.touch) {
      // a finger: the square under it is picked ONCE, when it touches, and the tap acts on that square when it lifts. It is not
      // picked again every tick (the camera follows the hero, so a still screen point would walk the hero across the map), and a
      // finger player is not a pointer player (the camera follows their hero, as a stick player's)
      this.pointerMode = false;
      if (p.click && !Number.isNaN(p.x)) {
        this.touchCell = this.renderer.pickCell(p.x, p.y);
        // UC-P1 (11-09): where a ghost is drawn (REPAIR's piece, CANNONS' cannon) a tap ON it places it exactly where it is drawn,
        // and a tap anywhere else only moves it there. A tap used to place at once on the tapped square, where no ghost had been
        // drawn: on a phone the piece never landed on the ghost the player saw (the probe: 116 of 116 taps)
        const shown = this.renderer.units ? this.renderer.units.ghostShown(this.mouseSlot) : null, t = this.touchCell;
        this.touchGhost = shown !== null;
        this.touchOnGhost = shown !== null && t !== null && shown.cells.some(([x, y]) => x === t.x && y === t.y);
      }
      // UC-P4 (TOUCH_PLACE_UC.md): in CANNONS and REPAIR a DRAG carries the ghost LIFT_PX above the finger, where the finger does not
      // hide it, square by square, and lifting the finger places it there; a quick tap keeps UC-P1's rule below
      const place = this.model.phase === core.Phase.Cannons || this.model.phase === core.Phase.Repair;
      if (place && (p.dragging || p.dragged) && !Number.isNaN(p.x)) {
        const c = this.renderer.pickCell(p.x, p.y - LIFT_PX);
        if (c !== null && this.model.grid.in(c.x, c.y)) this.dragCell = c;                    // 2a: off the board it keeps the last square
        if (this.dragCell) { out.hasPointer = true; out.pointer = new Cell(this.dragCell.x, this.dragCell.y); }
        if (p.dragged) this.dragCell = null;                                                  // placed (confirm stays: step 2)
      } else {
        const onGhost = this.touchGhost && this.touchOnGhost;
        if ((p.click || p.confirm) && this.touchCell && !onGhost) { out.hasPointer = true; out.pointer = new Cell(this.touchCell.x, this.touchCell.y); }
        if (this.touchGhost && !this.touchOnGhost) p = { ...p, confirm: false };   // the tap moved the ghost; it places nothing
      }
    } else {
      if (p.moved) this.pointerMode = true;
      if (stick && !p.moved) this.pointerMode = false;
      const c = this.mouseSquare.at(p, (x, y) => this.renderer.pickCell(x, y));
      if (this.pointerMode && c !== null) { out.hasPointer = true; out.pointer = new Cell(c.x, c.y); }
    }
    out.confirm = fields.confirm || p.confirm; out.rotate = fields.rotate || p.rotate; out.ready = fields.ready || p.ready; out.swap = fields.swap || p.swap;
    out.grab = fields.grab || p.grab; out.tap = fields.tap || p.tap;   // the right button in the bomb rule set (input.js)
    return out;
  }

  /** The pointer cursor: a hand over anything the pointer can act on in a menu, a crosshair over the board in play. */
  pointerCursor() {
    const p = this.input.pointer, screen = this.menu.screen, r = this.canvas.getBoundingClientRect(), hud = this.renderer.hud;
    const menuUp = !this.sw.attract && !(screen === Screen.Playing);
    const on = menuUp && !Number.isNaN(p.x) && (this.menu.settingsOpen ? this.overlay.settingsHitAt(p.x, p.y) !== null
      : !hud.hasHits(screen) || screen === Screen.Initials || hud.hitAt(screen, p.x - r.left, p.y - r.top) !== null);
    const aim = !this.sw.attract && !this.demo && screen === Screen.Playing && this.pointerMode;
    const want = on ? 'pointer' : aim ? 'crosshair' : '';
    if (document.body.style.cursor !== want) document.body.style.cursor = want;
  }

  /** One tick of the rules. `at`: the moment (performance.now() ms) the tick stands for (tickMoments): it takes the input as it was
   *  then (CONTROLS_SMOOTH_UC.md UC-C2 step 3). */
  gameTick(at) {
    this.ticks++;
    const seats = this.input.take(at);
    const menuIn = seats.map((s) => new MenuInput(s.menu));
    const ptr = this.input.takePointer();
    const wasPlaying = this.menu.screen === Screen.Playing && !this.demo;   // a click that started the match is not a move in it
    this.input.playing = wasPlaying;
    this.input.bombMode = this.model.options.bombs;
    this.input.enterReadies = wasPlaying && !this.seatOf.includes(1);   // Enter is P1's READY unless P2 is in the match (P2's place key)
    if (!this.sw.attract) this.pointerToMenu(menuIn, ptr);
    if (!this.sw.attract) {
      const where = () => [this.menu.screen, this.menu.row, this.menu.joinedCount, this.menu.settingsOver, this.menu.settingsRow, this.menu.infoOver, this.menu.infoPage].join(':');
      const before = where();
      // the settings panel from the title or the join screen (UC-ST1 step 1): the SETTINGS button, or READY on a seat's own device
      // (E, /, a pad's or phone's Y) - on the join screen a joined seat's, on the title anyone's, as the menus take presses
      const offered = this.settingsOffered, title = this.menu.screen === Screen.Title;
      const ready = seats.some((s, i) => s.pad.ready && (title || this.menu.joined[i]));
      if (offered && (this.settingsAsked || ready)) this.menu.openSettings();
      this.settingsAsked = false;
      // the controls & credits panel (UC-T1 steps 3-5): its button, H or a pad's X opens it; H, X, its tabs, CLOSE and the dim around
      // it act on it while it is open (the menu's own back / confirm / START close it, left / right turn the page)
      const infoKey = seats.some((s) => s.info), asked = this.infoAsked;
      this.infoAsked = null;
      if (this.menu.infoOpen) {
        if (asked === 'close' || infoKey) this.menu.closeInfo();
        else if (asked && asked.startsWith('page:')) this.menu.showInfoPage(Number(asked.slice(5)));
      } else if (!this.menu.settingsOpen && this.infoOffered && (asked === 'open' || infoKey)) this.menu.openInfo();
      const acts = this.menu.update(menuIn, this.demo ? null : this.model);
      for (const a of acts) this.act(a);
      if (where() !== before) this.sound.menu('move', this.ticks);
    }
    const sc = this.menu.screen;
    const run = this.sw.attract || (this.demo ? sc === Screen.Title || sc === Screen.Setup || sc === Screen.HighScores
                                              : sc === Screen.Playing || sc === Screen.Decide || sc === Screen.Results);
    if (!run) return;                                                       // paused: the rules do not run
    if (!this.demo) this.followConnections();
    const mouse = this.mouseSlot, play = wasPlaying && this.menu.screen === Screen.Playing;
    // the camera may turn a quarter (portrait: it looks east, render/camera.js): every stick turns with it, so up on the stick is
    // up on the screen. A quarter turn maps whole numbers to whole numbers: (x, y) -> (-y, x) moves the cursor east for "up".
    const turn = this.renderer.screenTurn, turned = (pad) => (turn === 1 ? Object.assign({}, pad, { stickX: -pad.stickY, stickY: pad.stickX, stepX: -pad.stepY, stepY: pad.stepX }) : pad);
    const pads = this.seatOf.map((seat, slot) => this.demo ? new PadInput()
      : new PadInput(play && slot === mouse ? this.pointerToPlay(turned(seats[seat].pad), ptr) : turned(seats[seat].pad)));
    this.controller.frame(pads);
    const key = this.model.round + ':' + this.model.phase;
    if (key !== this.phaseKey) { this.phaseKey = key; this.phaseTick = this.model.tick; }
    if (this.brake && this.brake(this)) this.braked = true;
    if (this.model.grid !== this.grid) {                                    // a new island: its pipelines are built before it is played
      this.grid = this.model.grid; this.renderer.setMatch(this.model, this.seatOf);
      if (!this.demo) this.prepareLevel(null);
    }
    if (this.demo && this.model.ended) {
      if (this.endedAt < 0) this.endedAt = this.ticks;
      else if (this.ticks - this.endedAt >= DEMO_RESTART) this.startMatch(true, null);
    }
  }

  frame(dt, seconds) {
    // UC-ST3 step 2: while the KEYS page waits, the next key press is its new key and is not played
    this.input.captureKey = this.menu.keysWaiting ? (code) => { for (const a of this.menu.keyPressed(code)) this.act(a); } : null;
    const now = performance.now();
    if (this.preparing === 'settle') this.settleLevel();
    this.input.poll(now);
    this.showTextSize();
    this.acc += Math.min(dt, 0.25) * this.sw.speed;
    let steps = 0;
    const max = 8 * this.sw.speed;
    // UC-C2 step 3: the moments this frame's ticks stand for, counted the way the loop below counts them (the same subtractions)
    let n = 0;
    for (let a = this.acc; a >= STEP && n < max; a -= STEP) n++;
    const at = tickMoments(now, n, 1000 * STEP / this.sw.speed);
    while (this.acc >= STEP && steps < max && !this.braked && !this.preparing) { this.gameTick(at[steps]); this.acc -= STEP; steps++; }
    if (this.braked || this.preparing) this.acc = 0;
    if (this.acc > STEP * max) this.acc = STEP * max;   // a stalled tab does not owe a burst of ticks when it comes back
    const alpha = Math.min(1, this.acc / STEP);
    const events = this.events; this.events = [];
    // the renderer takes the seconds SINCE THE LAST FRAME (renderer.js frame(view, dt)). Until 11-09 this passed the page clock
    // (now / 1000), which the renderer clamps to 0.1 s, so every animation on the page ran 5-6x fast (measured: the renderer's clock
    // went 10.3 s in 2.0 s of wall time); the test scene and the review frames passed the right value and never showed it.
    // the camera's hints: the human players it frames (bots never steer it), the pointer player (its hero follows a still pointer,
    // so the camera must not follow that hero), the on-screen controls it keeps its frame clear of, and the player's own zoom/pan
    const playing = !this.demo && !this.sw.attract;
    // CONTROLS_SMOOTH_UC.md UC-C2 step 1: while a started match is held (prepareLevel), the overlays its Playing screen shows (the
    // action bar, the hint strip, the touch controls) are laid out and painted as they will be, all but transparent and untouchable
    // (style.css body.warming): their FIRST paint cost the GPU 50-160 ms in the match's first frames (measured 11-13, run_page ctl:
    // with the bar, the strip and #ui hidden by a style the first 5 s ran at most 35 ms a frame; the bar alone hidden, 53 ms; the strip
    // alone hidden, 105 ms).
    // .warmed is the frame after, so the hint strip's opacity fade does not run as they come in.
    const warming = this.preparing !== false && this.menu.holding, inPlay = this.menu.screen === Screen.Playing || warming;
    const body = document.body.classList;
    if (warming) body.add('warming'); else if (body.contains('warming')) { body.remove('warming'); body.add('warmed'); } else body.remove('warmed');
    // the hint strip: in the first round of the first match, while it is being played; under the top bar, or below any on-screen
    // control it would sit on (its rect is then a cover rect, so the camera frames round it)
    const hinting = playing && this.model === this.hintMatch && this.model.round === this.hintRound && inPlay;
    let phaseName = Object.keys(core.Phase).find((k) => core.Phase[k] === this.model.phase);
    // UC-T2: a phase whose goals were all done stays on the strip, ticked, for GUIDE_HOLD s into the next (a lone player's claim ends
    // CLAIM on the tick it is made, and its tick would never be seen)
    if (hinting && this.guide) {
      if (this.guidePhase && this.guidePhase !== phaseName && this.guide.phaseDone(this.guidePhase)) this.guideHeld = { phase: this.guidePhase, until: seconds + GUIDE_HOLD };
      this.guidePhase = phaseName;
      if (this.guideHeld && seconds < this.guideHeld.until) phaseName = this.guideHeld.phase; else this.guideHeld = null;
    }
    this.hint.set(hinting ? phaseName : null, this.controls.showsTouch, !hinting, (a) => this.keyBindings.label(0, a), hinting && this.guide ? this.guide.goals(phaseName) : []);
    const pads = this.touchpad.visible ? this.touchpad.coverRects() : [];
    if (this.hint.covering) this.hint.place(this.renderer.hudBarHeight() + 6, pads);
    // the action bar: shown to the keyboard-and-mouse player in a match, above the HUD's cards; its rect is a camera cover rect, so the
    // camera frames round it. A touch screen has its own stick and A / B / Y: it gets the shop row alone, in REPAIR, in the bomb rule set.
    const bombs = this.model.options.bombs, repair = this.model.phase === core.Phase.Repair;
    const touch = this.controls.showsTouch;
    // a touch screen's shop row opens from the SHOP button (it covers part of the board, so it stays out of the way until asked for)
    if (this.touchpad.takeShop()) this.shopOpen = !this.shopOpen;
    if (!(playing && bombs && repair && touch)) this.shopOpen = false;
    this.touchpad.setShop(playing && bombs && repair && touch && this.menu.screen === Screen.Playing, this.shopOpen);
    const bar = playing && inPlay && (!touch || this.shopOpen);
    this.bar.show(bar);
    this.touchpad.setBombs(bombs);
    const mp = playing ? this.model.player(this.mouseSlot) : null;
    const act = mp && {
      phase: Object.keys(core.Phase).find((k) => core.Phase[k] === this.model.phase), sword: mp.sword, ready: mp.ready, bombs,
      carrying: mp.carrying !== 0, bombsLeft: mp.bombs, score: mp.score, costs: bombs ? this.model.rules.itemCosts : null, items: mp.items,
      key: (a) => this.keyBindings.label(0, a), enterReady: this.input.enterReadies && this.keyBindings.enterFree,
      // the full rules: rotate picks what CANNONS places (cannon, mortar, kite) and aims the kite in BATTLE (MatchController.placeOf)
      full: this.model.options.full, gun: this.model.options.full ? ['cannon', 'mortar', 'kite'][this.controller.placeOf(this.mouseSlot)] : 'cannon',
    };
    // the touch buttons say what they do now: A the action bar's own label for its place / fire / bomb button (one rule for both), B
    // grab (the RAID: THROW with a bomb in hand) or turn (REPAIR), Y ready in CANNONS (and the tool in BATTLE and REPAIR in the no-bomb
    // rules: with bombs there is one tool a beat, BOMBER_UC.md R3)
    if (act && touch) {
      const tools = !bombs && (act.phase === 'Battle' || act.phase === 'Repair');
      this.touchpad.setCaptions({ confirm: PLACE_ACTION.label(act).toUpperCase(),
                                  rotate: act.phase === 'Raid' ? (act.carrying ? 'THROW' : 'GRAB') : act.phase === 'Repair' ? 'TURN' : '',
                                  ready: act.phase === 'Cannons' ? 'READY' : tools ? 'TOOL' : '' });
    }
    if (bar) {
      this.bar.setCompact(touch);
      this.bar.update(act);
      // a narrow touch screen: the shop row rides above the stick and the buttons; a wide one has room between them
      const low = pads.filter((r) => r.top > window.innerHeight / 2);   // the stick and the buttons (the pause and frame buttons are at the top)
      const high = touch && window.innerWidth < 700 && low.length ? window.innerHeight - Math.min(...low.map((r) => r.top)) + 8 : 0;
      this.bar.place(Math.max(this.renderer.hudFootHeight() + 8, high));
    }
    const camera = {
      humans: playing ? this.seatOf.map((_, slot) => slot).filter((slot) => !this.controller.isBot(slot)) : [],
      pointerSlot: playing && this.pointerMode ? this.mouseSlot : -1,
      cover: [...pads, ...(this.hint.covering ? [this.hint.rect()] : []), ...(bar ? [this.bar.rect()] : [])],
      input: this.input.takeCamera(),
    };
    if (this.touchpad.takeFrame()) camera.input.toggle = true;
    // QRLAND (round 5): the join screen lays its seats and rows out around what the page draws over the canvas: the phone room's QR
    // panel (PhonePad's own box, [data-phonepad]; its host script offers a corner (place) and a parent, no size) and the how-to
    // card, as measured last frame (the canvas fills the window, so these CSS px are the HUD's)
    const menuCover = !this.sw.attract && this.menu.screen === Screen.Setup && !this.menu.settingsOpen
      ? ['[data-phonepad]', '#ui .howto'].map((q) => document.querySelector(q)).filter(Boolean).map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0)
      : [];
    this.renderer.frame({ match: this.model, controllers: [this.controller], hud: this.controller.hud, menu: this.menu, events, alpha, camera, menuCover, warmPlaying: warming }, dt);
    // UC-S2: the music for what is on screen (crossfaded on a change), the ambience ducked in battle
    const boss = this.model.ships.some((s) => s.alive && s.kind === core.ShipKind.Boss);   // BOSS_UC.md UC-B1: its theme while it is afloat
    const scene = { screen: this.menu.screen, demo: this.demo, attract: this.sw.attract, phase: this.model.phase, boss };
    this.sound.update({ music: musicFor(scene), duck: duckFor(scene), bed: bedFor(scene, this.renderer.mood.current.name) });
    // MOOD_UC.md UC-L6: each lightning strike is heard - the crack at once, the boom a moment later (nearer strikes sooner; AUTHORED
    // 0.25..1.1 s, view-only randomness)
    const strikes = this.renderer.weather.flashes;
    // (the thunder is a store pack's, render/packs.js: without it a strike is seen, not heard)
    if (STORE_PACKS && strikes > (this.strikesHeard ?? strikes)) { this.sound.play('thunderCrack', this.ticks); this.sound.playIn('thunderBoom', 0.25 + Math.random() * 0.85); }
    this.strikesHeard = strikes;
    // CASTLE_RISE_UC.md UC-L8 3: each landed piece of a castle's rise is heard - the wall's stone thunk, pitched up as the ring fills
    for (const rate of this.renderer.units.rise.takeLandings()) if (!this.silent) this.sound.riseThunk(rate, this.ticks);
    this.pointerCursor();
    const joinScreen = !this.sw.attract && this.menu.screen === Screen.Setup && !this.menu.settingsOpen && !this.menu.infoOpen;
    // the phone room: opened when a join screen shows and the CONTROLS choice includes phones, closed when LOCAL is chosen; its
    // phones are read by the input hub once it is open
    const phones = this.controls.usesPhones;
    if (phones && joinScreen && this.phones.state === 'off') {
      this.phones.open().then((ph) => { if (ph.state === 'open') this.input.attachPhones(ph.pads); });
    }
    if (!phones && this.phones.state !== 'off') { this.phones.close(); this.input.attachPhones(null); }
    this.phones.show(joinScreen && phones);
    this.touchpad.show(this.controls.showsTouch && !this.sw.attract && !this.demo && inPlay);
    this.overlay.render({
      screen: this.menu.screen, inDemo: this.menu.inDemo, attract: this.sw.attract, devices: this.input.devices,
      phones: { state: this.phones.state, reason: this.phones.reason }, scoresNote: this.scoresNote, controls: this.controls.mode,
      touchControls: this.controls.showsTouch, touchFirst: this.controls.touchFirst,
      soundNote: this.sound.muted ? 'Sound off (M)' : this.sound.needsGesture ? 'Press any key for sound' : '',
      soundError: [this.soundNote, this.motionNote, this.keysNote, ...this.sound.loadErrors.map((f) => 'Sound file ' + f.file + ' did not load: ' + f.why)].filter(Boolean).join(' '),
      phonesAllowed: this.controls.phonesAllowed, phonesWhy: this.controls.phonesWhy, hostLines: this.host ? this.host.footer : [],
      settingsButton: this.settingsOffered, settings: this.settingsView(),
      infoButton: this.infoOffered, info: this.menu.infoOpen && !this.sw.attract ? { page: this.menu.infoPage } : null,
    });
  }

  /** What the settings panel shows (overlay.js settingsPanel), read from the menu model; null while it is shut. */
  settingsView() {
    const m = this.menu;
    if (!m.settingsOpen || this.sw.attract) return null;
    if (m.keysOpen) return {                                          // UC-ST3: the KEYS page
      head: 'KEYS', row: m.keysRow, note: m.keysNote,
      help: m.keysWaiting ? 'Press the new key for ' + MenuModel.KeysRows[m.keysRow] + '; Esc or a pad\'s B keeps the old one'
        : 'Pick an action, then press its new key. Pads and phones keep their buttons.',
      rows: MenuModel.KeysRows.map((label, i) => ({ label, value: m.valueOfKeysRow(i), level: null, arrows: i === MenuModel.KeysPlayer })) };
    return { row: m.settingsRow, rows: MenuModel.SettingsRows.map((label, i) => {
      const vol = MenuModel.SettingsVolume[i];
      // TEXT SIZE says what this screen gives when that is less than asked (UC-ST4 step 2)
      const value = i === MenuModel.SetText && this.textGiven < m.settings.text ? m.settings.text + '% (fits ' + this.textGiven + '%)' : m.valueOfSettingsRow(i);
      return { label, value, level: vol === undefined ? null : m.settings[vol] };
    }) };
  }

  run() {
    // dt is measured between animation-frame timestamps only: the first frame's timestamp is the start of that frame, which can be
    // EARLIER than a performance.now() read before it was requested (11-09: a negative first dt, refused by the renderer)
    let last = null, revealing = false;
    const loop = (now) => {
      if (this.stopped) return;
      const dt = last === null ? 0 : (now - last) / 1000; last = now;
      if (!this.still) this.clock = now / 1000;
      try { this.frame(this.still ? 0 : dt, this.clock); }
      catch (e) {
        this.stopped = true;
        console.error(e);
        showFatal('The game stopped: ' + (e && e.stack ? e.stack : e));
        return;
      }
      // LOAD_UC.md UC-L7 step 3: the canvases were hidden while the renderer warmed up and drew the island once; they show once the
      // first real frame is done on the GPU, fading in from the loading screen (11-11: the warm-up's row of models was on screen)
      // ... and only once the game RUNS smoothly: the first seconds of play stutter while the browser builds what the warm-up did not
      // reach (measured 11-11 on the published build too: frames of 0.8-0.9 s), and a press made in a stutter can land on the same
      // frame as the next one. SMOOTH_FRAMES in a row under SMOOTH_MS, or REVEAL_MAX s after the first frame, whichever is first.
      if (!revealing) {
        revealing = true;
        this.renderer.renderer.backend.device.queue.onSubmittedWorkDone().then(() => { this.firstFrameAt = performance.now(); this.smoothRun = 0; },
          (e) => { this.stopped = true; console.error(e); showFatal('The graphics device failed before the first picture: ' + e); });
      } else if (document.body.classList.contains('booting') && this.firstFrameAt !== undefined) {
        this.smoothRun = dt * 1000 < SMOOTH_MS ? this.smoothRun + 1 : 0;
        if (this.smoothRun >= SMOOTH_FRAMES || performance.now() - this.firstFrameAt > REVEAL_MAX * 1000) {
          const b = document.body;
          b.classList.add('revealing'); b.classList.remove('booting');
          this.revealedAt = performance.now(); this.revealWaited = Math.round(this.revealedAt - this.firstFrameAt);
          requestAnimationFrame(() => requestAnimationFrame(() => b.classList.remove('revealing')));
        }
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

/** UC-L7: the loading screen names the step the page is on, and after BOOT_SLOW s on one step says so with the step's name, so a
 *  device where the game never starts tells its player (and us) where it stopped (11-11: it starts in Brave on Android but not in
 *  Chrome or Edge there; nothing said why). */
const BOOT_SLOW = 25;                                  // AUTHORED: seconds on one loading step before the screen calls it slow
let bootStep = '', bootTimer = 0;
function bootStage(step) {
  bootStep = step;
  const el = document.getElementById('boot');
  if (!el) return;
  el.innerHTML = 'LOADING<small></small>';
  el.querySelector('small').textContent = step;
  clearTimeout(bootTimer);
  bootTimer = setTimeout(() => {
    if (!document.body.classList.contains('booting')) return;
    const s = el.querySelector('small');
    s.className = 'bad';
    s.textContent = 'Still on "' + bootStep + '" after ' + BOOT_SLOW + ' s. This device or browser may not be able to run the game.';
  }, BOOT_SLOW * 1000);
}

/** CHECK_UC.md (?check=1): the device's graphics and every figure model, for a phone where the game misbehaves. The models turn
 *  slowly under the match's light; their names sit under them; the adapter, its limits and the browser are listed. */
function checkPage(renderer) {
  const row = renderer.modelCheck(), d = renderer.device, ui = document.getElementById('ui');
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const lines = ['Tidewall device check', 'GPU: ' + [d.vendor, d.architecture, d.device, d.description].filter(Boolean).join(' / '),
    'Limits: ' + Object.entries(d.limits).map(([k, v]) => k + ' ' + v).join(', '), 'Texture features: ' + (d.features.join(', ') || 'none'),
    'Browser: ' + navigator.userAgent, 'Screen: ' + innerWidth + 'x' + innerHeight + ' at ' + devicePixelRatio + 'x'];
  ui.innerHTML = '<div class="checkinfo">' + lines.map((l) => '<div>' + esc(l) + '</div>').join('') + '</div>'
    + row.map((r, i) => '<div class="checklabel" data-i="' + i + '">' + esc(r.name) + '</div>').join('');
  document.body.classList.remove('booting');
  const labels = [...ui.querySelectorAll('.checklabel')];
  let t0 = null;
  const loop = (now) => {
    t0 ??= now;
    renderer.scene.children.at(-1).children.forEach((o, i) => { if (i < row.length) o.rotation.y = (now - t0) / 1000 * 0.6; });
    renderer.renderFrame();
    const cam = renderer.rig.camera;
    row.forEach((r, i) => { const p = r.at.clone().setY(-0.4).project(cam); labels[i].style.left = ((p.x + 1) / 2 * innerWidth) + 'px'; labels[i].style.top = ((1 - p.y) / 2 * innerHeight) + 'px'; });
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__check = { device: d, models: row.map((r) => r.name) };
}

async function boot() {
  const sw = readSwitches();
  const host = readHost(window);     // before the first await: a host sets itself before this module runs (UC-DH1 step 1)
  if (!navigator.gpu) { noWebGpu('navigator.gpu is missing'); return; }
  const canvas = document.getElementById('view');
  let renderer;
  bootStage('graphics and models');
  try { renderer = await createRenderer(canvas, { quality: sw.quality }); }
  catch (e) {
    if (e instanceof NoWebGpuError) { noWebGpu(e.message); return; }
    throw e;
  }
  const fit = () => { const w = window.innerWidth, h = window.innerHeight; renderer.resize(w, h); };
  window.addEventListener('resize', fit);
  fit();
  if (sw.check) { checkPage(renderer); return; }                  // CHECK_UC.md: the device check, no game
  const game = new Game(renderer, canvas, sw, host);
  // UC-S2 1b: every sound file is fetched and decoded before the loop starts. A failure is logged and shown on the title footer; on a
  // development page it also stops the page (no other sound is put in its place either way)
  bootStage('sounds');
  try { await game.sound.load(); }
  catch (e) {
    if (!(e instanceof SoundLoadError)) throw e;
    console.error(e.message);
    if (sw.dev) throw e;
  }
  bootStage('the first island');
  await renderer.settle();        // the first island's pipelines are built before the loop starts (a first-second stall drops a tap)
  window.__game = game;           // the page check reads the model, the menu and the controller through these two
  window.__core = core;
  game.run();
}

boot().catch((e) => { console.error(e); showFatal('The game could not start: ' + (e && e.stack ? e.stack : e)); });
