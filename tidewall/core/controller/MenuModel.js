// port of model/Controller/MenuModel.cs
//
// Public-build changes (PLAN.md hard limits):
//   - the GAME TYPE row (normal / extended) is gone: options.type is fixed to GameType.Normal. Row 0 is MAP instead: the maps come
//     from the app's generated-map list, handed to the constructor as [{name, seed}, ...] (the seam that replaces a fixed map
//     library). Left/right or confirm on row 0 steps through that list; `map` is the chosen entry the host starts the match on.
//   - the fate rows read CONTINUE / GIVE UP (the private build quoted an existing game's wording).
//   - SETTINGS (SETTINGS_UC.md UC-ST1, this game's own): a row of the pause menu, and from the title and the join screen the host's
//     openSettings() (its SETTINGS button and READY: the join screen's rows already fill the band the HUD lays them in, and the title
//     has none). The settings rows are a panel over the screen they opened from (`settingsOver`): `screen` stays Title, Setup or
//     Pause, so everything that follows the screen
//     (the paused rules, the music, the HUD under the panel) is unchanged. Their values live in a SettingsModel; a change returns a
//     SettingsChanged action for the host to apply (the sound buses, the renderer's quality, the store).
//   - CONTROLS & CREDITS (TITLE_UC.md UC-T1, this game's own): a panel of two pages over the title or the join screen (`infoOver`),
//     opened by the host's openInfo() (its button, H, a pad's X). Left / right turn the page; back, confirm or START close it. The
//     title's foot is one line because of it: the full key list and the credits live here.
// Everything else (the battlefield and difficulty rows, joining, pause, the fate screen's left/right + START, results, initials,
// the high-score table, the idle-title demo) is the C# behaviour unchanged.
import { GameRules } from '../rules/GameRules.js';
import { GameOptions, GameType, Battlefield, Difficulty } from '../rules/Campaign.js';
import { Phase } from '../match/Entities.js';
import { MatchModel } from '../match/MatchModel.js';
import { SettingsModel } from './SettingsModel.js';

const MENU_FIELDS = Object.freeze(['up', 'down', 'left', 'right', 'confirm', 'back', 'start']);

/** One seat's menu buttons this frame, as edges (pressed THIS frame). The app's input layer fills it from a pad, keys or a phone.
 *  Unset buttons are false; a button this struct does not have is refused. */
export class MenuInput {
  constructor(fields = {}) {
    this.up = false; this.down = false; this.left = false; this.right = false; this.confirm = false; this.back = false; this.start = false;
    for (const k of Object.keys(fields)) {
      if (!MENU_FIELDS.includes(k)) throw new TypeError('MenuInput has no button "' + k + '"');
      if (typeof fields[k] !== 'boolean') throw new TypeError('MenuInput.' + k + ' is true or false, got ' + fields[k]);
      this[k] = fields[k];
    }
  }
  get any() { return this.up || this.down || this.left || this.right || this.confirm || this.back || this.start; }
}

export const Screen = Object.freeze({ Title: 0, Setup: 1, Playing: 2, Pause: 3, Decide: 4, Results: 5, Initials: 6, HighScores: 7 });

export const MenuActionKind = Object.freeze({ StartGame: 0, StartDemo: 1, Restart: 2, QuitToTitle: 3, QuitApp: 4, Decide: 5, SaveHighScores: 6, SettingsChanged: 7 });

function kindName(v) { for (const k of Object.keys(MenuActionKind)) if (MenuActionKind[k] === v) return k; return String(v); }

export class MenuAction {
  constructor(kind, flag = false) { this.kind = kind; this.flag = flag; Object.freeze(this); }
  toString() { return kindName(this.kind) + (this.flag ? '(yes)' : ''); }
}

const INT_MIN = -2147483648, INT_MAX = 2147483647;

function checkMaps(maps) {
  if (!Array.isArray(maps) || maps.length === 0) throw new TypeError('MenuModel: maps is a non-empty array of {name, seed}');
  const out = [];
  for (let i = 0; i < maps.length; i++) {
    const m = maps[i];
    if (m === null || typeof m !== 'object') throw new TypeError('MenuModel: maps[' + i + '] is not {name, seed}');
    if (typeof m.name !== 'string' || m.name.length === 0) throw new TypeError('MenuModel: maps[' + i + '].name is not a non-empty string');
    if (!Number.isInteger(m.seed) || m.seed < INT_MIN || m.seed > INT_MAX) throw new TypeError('MenuModel: maps[' + i + '].seed is not a 32-bit whole number');
    out.push(Object.freeze({ name: m.name, seed: m.seed }));
  }
  return Object.freeze(out);
}

/** Every screen around the match (a view model + its rules), engine-free so a test can walk it: the title, the setup screen with
 *  players joining by pressing a button and its options, pause with START and Restart / Quit, the continue-or-give-up screen, the
 *  results, initials for a high score and the high-score table. It never touches the match: it returns ACTIONS the host carries out.
 *  Couch co-op, four seats on one screen: any joined seat may drive a menu. */
export class MenuModel {
  static Seats = MatchModel.MaxPlayers;
  static TitleIdleTicks = 30 * GameRules.TicksPerSecond;      // AUTHORED in the private model: an untouched title plays the demo

  static SetupRows = Object.freeze(['MAP', 'BATTLEFIELD', 'DIFFICULTY', 'START', 'HIGH SCORES', 'QUIT']);
  static PauseRows = Object.freeze(['RESUME', 'RESTART', 'SETTINGS', 'QUIT TO TITLE']);
  static DecideRows = Object.freeze(['CONTINUE', 'GIVE UP']);
  static RowMap = 0; static RowField = 1; static RowDifficulty = 2; static RowStart = 3; static RowScores = 4; static RowQuit = 5;
  static PauseRowSettings = 2;
  static InfoPages = Object.freeze(['CONTROLS', 'CREDITS']);
  static SettingsRows = Object.freeze(['MUSIC', 'EFFECTS', 'AMBIENCE', 'MUTE', 'GRAPHICS', 'MOTION', 'BACK']);
  static SetMusic = 0; static SetEffects = 1; static SetAmbience = 2; static SetMute = 3; static SetGraphics = 4; static SetMotion = 5; static SetBack = 6;
  /** The SettingsModel volume each volume row changes. */
  static SettingsVolume = Object.freeze({ 0: 'music', 1: 'fx', 2: 'ambience' });

  /** scores: a HighScoreTable or null (a new empty one). maps: the app's generated maps, [{name, seed}, ...], at least one.
   *  settings: the SettingsModel the settings rows change, or undefined (a test: SettingsModel.defaults('high')). */
  constructor(scores, maps, settings) {
    this.maps = checkMaps(maps);
    this.mapIndex = 0;
    this.screen = Screen.Title;
    this.row = 0;
    this.options = new GameOptions();
    this.options.type = GameType.Normal;             // the public build plays the normal rules only
    this.joined = new Array(MenuModel.Seats).fill(false);
    this.highScores = scores === null || scores === undefined ? new HighScoreTable() : scores;
    if (!(this.highScores instanceof HighScoreTable)) throw new TypeError('MenuModel: scores is a HighScoreTable or null');
    this.initials = ['A', 'A', 'A'];
    this.initialsAt = 0;
    this.pendingScore = 0;
    this.lastWon = false;
    this.inDemo = false;
    this._idle = 0;
    this.settings = settings === undefined ? SettingsModel.defaults('high') : settings;
    if (!(this.settings instanceof SettingsModel)) throw new TypeError('MenuModel: settings is a SettingsModel');
    this.settingsOver = null;          // the screen the settings panel is open over (Setup or Pause), or null when it is shut
    this.settingsRow = 0;
    this.infoOver = null;              // the screen the controls & credits panel is open over (Title or Setup), or null
    this.infoPage = 0;                 // its page: an index of InfoPages
  }

  get infoOpen() { return this.infoOver !== null; }

  /** The controls & credits panel opens over the title (not while the demo fills it) or the join screen, on CONTROLS. */
  openInfo() {
    const sc = this.screen;
    if (!(sc === Screen.Setup || (sc === Screen.Title && !this.inDemo)))
      throw new Error('MenuModel: controls & credits open over the title or the join screen, not screen ' + sc + (this.inDemo ? ' (the demo)' : ''));
    if (this.settingsOver !== null) throw new Error('MenuModel: the settings panel is open');
    if (this.infoOver !== null) throw new Error('MenuModel: the controls & credits panel is already open');
    this.infoOver = sc; this.infoPage = 0;
  }

  /** Back to the screen it opened over; the title's idle demo timer starts again. */
  closeInfo() { this.infoOver = null; this._idle = 0; }

  /** A page by index (the panel's tabs). */
  showInfoPage(page) {
    if (this.infoOver === null) throw new Error('MenuModel: the controls & credits panel is shut');
    if (!Number.isInteger(page) || page < 0 || page >= MenuModel.InfoPages.length) throw new RangeError('MenuModel: no info page ' + page);
    this.infoPage = page;
  }

  get settingsOpen() { return this.settingsOver !== null; }

  /** The chosen map entry {name, seed}. */
  get map() { return this.maps[this.mapIndex]; }

  get joinedCount() { let n = 0; for (const j of this.joined) if (j) n++; return n; }

  /** The value shown beside a setup row (C# ValueOf; renamed so it does not replace Object.prototype.valueOf). */
  valueOfRow(row) {
    switch (row) {
      case MenuModel.RowMap: return this.map.name;
      case MenuModel.RowField: return this.options.field === Battlefield.Recruit ? 'RECRUIT' : 'VETERAN';
      case MenuModel.RowDifficulty: return this.options.level === Difficulty.Easy ? 'EASY' : this.options.level === Difficulty.Medium ? 'MEDIUM' : 'TOUGH';
      default: return '';
    }
  }

  /** The value shown beside a settings row: '70%', 'ON' / 'OFF' (MUTE), 'HIGH' / 'LOW' (GRAPHICS), 'FULL' / 'REDUCED' (MOTION), ''
   *  for BACK. */
  valueOfSettingsRow(row) {
    const st = this.settings, vol = MenuModel.SettingsVolume[row];
    if (vol !== undefined) return st[vol] + '%';
    if (row === MenuModel.SetMute) return st.muted ? 'ON' : 'OFF';
    if (row === MenuModel.SetGraphics) return st.quality === 'high' ? 'HIGH' : 'LOW';
    if (row === MenuModel.SetMotion) return st.motion === 'full' ? 'FULL' : 'REDUCED';   // UC-ST2
    if (row === MenuModel.SetBack) return '';
    throw new RangeError('MenuModel: no settings row ' + row);
  }

  /** The settings panel opens over the title, the join screen or the pause menu (the pause menu's SETTINGS row, or the host for the
   *  other two), on its first row. Not over the title while the demo fills it. */
  openSettings() {
    const sc = this.screen;
    if (!(sc === Screen.Setup || sc === Screen.Pause || (sc === Screen.Title && !this.inDemo)))
      throw new Error('MenuModel: settings open over the title, the join screen or the pause menu, not screen ' + sc + (this.inDemo ? ' (the demo)' : ''));
    if (this.settingsOver !== null) throw new Error('MenuModel: the settings panel is already open');
    if (this.infoOver !== null) throw new Error('MenuModel: the controls & credits panel is open');
    this.settingsOver = this.screen; this.settingsRow = 0;
  }

  /** Back to the screen it opened over, on the row it was on (the settings rows move settingsRow, never row). */
  closeSettings() { this.settingsOver = null; this._idle = 0; }

  /** One frame. `match` is the running match or null; the menu follows it into the fate screen and out to the results. */
  update(seats, match) {
    if (seats === null || seats === undefined || seats.length !== MenuModel.Seats) throw new RangeError('one MenuInput per seat (' + MenuModel.Seats + ')');
    for (let i = 0; i < seats.length; i++) if (!(seats[i] instanceof MenuInput)) throw new TypeError('seats[' + i + '] is not a MenuInput');
    const acts = [];
    let any = false; for (const s of seats) any = any || s.any;
    if (this.settingsOver !== null) { this._settings(seats, acts); return acts; }
    if (this.infoOver !== null) { this._info(seats); return acts; }
    switch (this.screen) {
      case Screen.Title:
        if (this.inDemo && any) { this.inDemo = false; acts.push(new MenuAction(MenuActionKind.QuitToTitle)); this._idle = 0; break; }
        if (this.inDemo) break;
        for (let i = 0; i < MenuModel.Seats; i++)
          if (seats[i].confirm || seats[i].start) {
            this._go(Screen.Setup);
            for (let k = 0; k < MenuModel.Seats; k++) this.joined[k] = false;
            this.joined[i] = true;
            return acts;
          }
        if (++this._idle >= MenuModel.TitleIdleTicks) { this._idle = 0; this.inDemo = true; acts.push(new MenuAction(MenuActionKind.StartDemo)); }
        break;
      case Screen.Setup: this._setup(seats, acts); break;
      case Screen.Playing:
        if (match !== null && match !== undefined && match.phase === Phase.Decide) { this._go(Screen.Decide); break; }
        if (match !== null && match !== undefined && match.ended) { this._results(match); break; }
        for (let i = 0; i < MenuModel.Seats; i++) if (this.joined[i] && seats[i].start) { this._go(Screen.Pause); break; }
        break;
      case Screen.Pause: {
        const pick = this._nav(seats, MenuModel.PauseRows.length, false);
        if (pick !== null) {
          if (pick === 0) this._go(Screen.Playing);
          else if (pick === 1) { this._go(Screen.Playing); acts.push(new MenuAction(MenuActionKind.Restart)); }
          else if (pick === MenuModel.PauseRowSettings) this.openSettings();
          else { this._go(Screen.Title); acts.push(new MenuAction(MenuActionKind.QuitToTitle)); }
        } else for (let i = 0; i < MenuModel.Seats; i++) if (this.joined[i] && (seats[i].start || seats[i].back)) { this._go(Screen.Playing); break; }
        break;
      }
      case Screen.Decide: {
        if (match === null || match === undefined || match.phase !== Phase.Decide) { this._go(Screen.Playing); break; }   // decided by the timeout
        const fate = this._nav(seats, MenuModel.DecideRows.length, true);
        if (fate !== null) {
          acts.push(new MenuAction(MenuActionKind.Decide, fate === 0));
          this._go(Screen.Playing);
        }
        break;
      }
      case Screen.Results:
        if (anyConfirm(seats)) {
          if (this.highScores.qualifies(this.pendingScore)) {
            this._go(Screen.Initials); this.initialsAt = 0; this.initials[0] = this.initials[1] = this.initials[2] = 'A';
          } else this._go(Screen.HighScores);
        }
        break;
      case Screen.Initials: this._initial(seats, acts); break;
      case Screen.HighScores:
        if (anyConfirm(seats) || anyBack(seats)) {
          if ((match === null || match === undefined) && this.joinedCount > 0) this._go(Screen.Setup);            // looked at from the setup screen
          else { this._go(Screen.Title); acts.push(new MenuAction(MenuActionKind.QuitToTitle)); }               // after a game: the host clears it
        }
        break;
    }
    return acts;
  }

  /** The match ended: the results screen, with what it scored. */
  _results(match) {
    this.pendingScore = match.teamScore; this.lastWon = match.phase === Phase.Victory;
    this._go(Screen.Results);
  }

  _setup(seats, acts) {
    // a player joins by pressing a button on their controller; Back leaves (the last seat backing out returns to the title)
    for (let i = 0; i < MenuModel.Seats; i++) {
      if (!this.joined[i] && (seats[i].confirm || seats[i].start)) { this.joined[i] = true; return; }
      if (this.joined[i] && seats[i].back) {
        if (this.joinedCount > 1) { this.joined[i] = false; return; }
        this._go(Screen.Title); return;
      }
    }
    for (let i = 0; i < MenuModel.Seats; i++) {
      if (!this.joined[i]) continue;
      const s = seats[i];
      if (s.left || s.right) this._change(this.row, s.right ? 1 : -1);
      if (s.start) { acts.push(new MenuAction(MenuActionKind.StartGame)); this._go(Screen.Playing); return; }
    }
    const pick = this._nav(seats, MenuModel.SetupRows.length, false);
    if (pick !== null) {
      if (pick === MenuModel.RowStart) { acts.push(new MenuAction(MenuActionKind.StartGame)); this._go(Screen.Playing); }
      else if (pick === MenuModel.RowScores) this._go(Screen.HighScores);
      else if (pick === MenuModel.RowQuit) acts.push(new MenuAction(MenuActionKind.QuitApp));
      else { this._change(pick, 1); this.row = pick; }
    }
  }

  /** The settings panel: Back (or the BACK row) shuts it; left / right change the chosen row; up / down / confirm as every menu
   *  (_nav). The seats that drive it are the ones that drive the screen under it. */
  _settings(seats, acts) {
    const open = this.joinedCount === 0;
    for (let i = 0; i < MenuModel.Seats; i++) if ((open || this.joined[i]) && seats[i].back) { this.closeSettings(); return; }
    for (let i = 0; i < MenuModel.Seats; i++) {
      if (!open && !this.joined[i]) continue;
      const s = seats[i];
      if (s.left || s.right) this._changeSetting(this.settingsRow, s.right ? 1 : -1, acts);
    }
    const pick = this._nav(seats, MenuModel.SettingsRows.length, false, 'settingsRow');
    if (pick === MenuModel.SetBack) this.closeSettings();
    else if (pick !== null) this._changeSetting(pick, 0, acts);
  }

  _info(seats) {
    const n = MenuModel.InfoPages.length;
    for (const s of seats) {
      if (s.back || s.confirm || s.start) { this.closeInfo(); return; }
      if (s.left || s.right) { this.infoPage = (this.infoPage + (s.right ? 1 : -1) + n) % n; return; }
    }
  }

  /** dir: -1 / 1 left / right, 0 confirm. A change returns SettingsChanged (a volume already at its end does not change). */
  _changeSetting(row, dir, acts) {
    const st = this.settings, vol = MenuModel.SettingsVolume[row];
    let changed = true;
    if (vol !== undefined) { if (dir === 0) st.cycle(vol); else changed = st.step(vol, dir); }
    else if (row === MenuModel.SetMute) st.toggleMute();
    else if (row === MenuModel.SetGraphics) st.toggleQuality();
    else if (row === MenuModel.SetMotion) st.toggleMotion();
    else changed = false;                                              // BACK: left / right do nothing
    if (changed) acts.push(new MenuAction(MenuActionKind.SettingsChanged));
  }

  _change(row, dir) {
    if (row === MenuModel.RowMap) { const n = this.maps.length; this.mapIndex = (this.mapIndex + dir + n) % n; }
    else if (row === MenuModel.RowField) this.options.field = this.options.field === Battlefield.Recruit ? Battlefield.Veteran : Battlefield.Recruit;
    else if (row === MenuModel.RowDifficulty) this.options.level = (this.options.level + dir + 3) % 3;
  }

  _initial(seats, acts) {
    // up/down scroll the letter, right goes to the next initial, START saves
    for (const s of seats) {
      if (s.up) this.initials[this.initialsAt] = letter(this.initials[this.initialsAt], -1);
      if (s.down) this.initials[this.initialsAt] = letter(this.initials[this.initialsAt], 1);
      const save = s.start || (s.confirm && this.initialsAt === 2);      // Confirm on the last letter saves too
      if (!save && (s.right || s.confirm)) this.initialsAt = Math.min(2, this.initialsAt + 1);
      if (s.left || s.back) this.initialsAt = Math.max(0, this.initialsAt - 1);
      if (save) {
        this.highScores.insert(this.initials.join(''), this.pendingScore);
        acts.push(new MenuAction(MenuActionKind.SaveHighScores));
        this._go(Screen.HighScores);
        return;
      }
    }
  }

  /** Up/down move the row (wrapping), Confirm picks it. Any joined seat drives it; with nobody joined, any seat. On the fate screen
   *  (sideways) left/right move it too, and START takes it. null = nothing picked this frame. */
  _nav(seats, rows, sideways, key = 'row') {
    const open = this.joinedCount === 0;
    for (let i = 0; i < MenuModel.Seats; i++) {
      if (!open && !this.joined[i]) continue;
      const s = seats[i];
      if (s.up || (sideways && s.left)) this[key] = (this[key] + rows - 1) % rows;
      if (s.down || (sideways && s.right)) this[key] = (this[key] + 1) % rows;
      if (s.confirm || s.start) return this[key];
    }
    return null;
  }

  _go(s) { this.screen = s; this.row = 0; this._idle = 0; this.settingsOver = null; this.infoOver = null; }

  /** The pointer is over a row (a mouse in the host): it becomes the chosen row, so a click confirms the row under the mouse. */
  pointAt(row) {
    if (this.settingsOver !== null) { if (row >= 0 && row < MenuModel.SettingsRows.length) this.settingsRow = row; return; }
    const rows = this.screen === Screen.Setup ? MenuModel.SetupRows.length : this.screen === Screen.Pause ? MenuModel.PauseRows.length
               : this.screen === Screen.Decide ? MenuModel.DecideRows.length : 0;
    if (row >= 0 && row < rows) this.row = row;
  }

  /** The host started a match the menu did not ask for (the demo) or ended one (quit): keep the screen in step. */
  playing() { this._go(Screen.Playing); }
  toTitle() { this.inDemo = false; this._go(Screen.Title); }
}

function letter(c, d) {
  const A = 'A'.charCodeAt(0);
  return String.fromCharCode(A + ((c.charCodeAt(0) - A + d + 26) % 26));
}

function anyConfirm(seats) { for (const s of seats) if (s.confirm || s.start) return true; return false; }
function anyBack(seats) { for (const s of seats) if (s.back) return true; return false; }

// .NET int.TryParse (NumberStyles.Integer): optional leading/trailing white space (U+0009..U+000D, U+0020), an optional sign, digits,
// and the value must fit an int.
const INT_TEXT = /^[\t\n\v\f\r ]*([+-]?[0-9]+)[\t\n\v\f\r ]*$/;
function tryParseInt(text) {
  const m = INT_TEXT.exec(text);
  if (m === null) return null;
  const v = Number(m[1]);
  if (v < INT_MIN || v > INT_MAX) return null;
  return v === 0 ? 0 : v;     // "-0" is 0
}

/** The high-score table: the best ten team scores with three initials, saved by the host (save / parse) so it survives. Rows are
 *  {key: initials, value: score}, best first. */
export class HighScoreTable {
  static Size = 10;

  constructor() { this._rows = []; }

  get rows() { return this._rows; }

  qualifies(score) { return score > 0 && (this._rows.length < HighScoreTable.Size || score > this._rows[this._rows.length - 1].value); }

  /** Inserts and returns the 1-based rank, or 0 when it did not make the table. Ties keep the older score first. */
  insert(initials, score) {
    if (!this.qualifies(score)) return 0;
    if (typeof initials !== 'string' || initials.length !== 3) throw new RangeError('three initials');
    let at = this._rows.length;
    for (let i = 0; i < this._rows.length; i++) if (score > this._rows[i].value) { at = i; break; }
    this._rows.splice(at, 0, Object.freeze({ key: initials, value: score }));
    if (this._rows.length > HighScoreTable.Size) this._rows.splice(HighScoreTable.Size, 1);
    return at + 1;
  }

  save() {
    let sb = '';
    for (const r of this._rows) sb += r.key + ' ' + r.value + '\n';
    return sb;
  }

  /** Reads save()'s text. A malformed line is refused with its number - a high-score file is never half-read. */
  static parse(text) {
    const t = new HighScoreTable();
    if (text === null || text === undefined || text.length === 0) return t;
    const lines = text.split('\r').join('').split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].length === 0) continue;
      const parts = lines[i].split(' ');
      const score = parts.length === 2 ? tryParseInt(parts[1]) : null;
      if (parts.length !== 2 || parts[0].length !== 3 || score === null)
        throw new SyntaxError('high-score line ' + (i + 1) + " is '" + lines[i] + "': want 'ABC 12345'");
      t._rows.push(Object.freeze({ key: parts[0], value: score }));
    }
    return t;
  }
}
