// hud.js - the 2D layer over the WebGPU canvas: the in-match HUD (round and level, the phase and its timer, team lives and score,
// the big banner, one card per player with their colour, score, cannons to place, the piece they hold and why their last command
// was refused), the tag over each hero, and every menu screen (title, join/setup, pause, the continue-or-give-up screen, results,
// initials, high scores). It only READS the ported HudViewModel, MenuModel and model; it decides nothing.
// The look (UC-L1, 11-09): chunky wooden panels in a stone frame, gold numerals, no thin bright edges (woodPanel).
import { Phase, Screen, MenuModel, HudViewModel, ItemBought, ItemNames } from '../core/index.js';
import { PLAYER_CSS, PLAYER_TEXT_CSS, PLAYER_INK_CSS, HUD_PANEL_CSS, UI } from './look.js';

const WARN = '#ffd24a';                                   // AUTHORED: the warning colour of a refusal, a stun
const NOTE_SECONDS = 2;                                   // AUTHORED: how long a fresh refusal or purchase takes over a card's line
const ITEM_WORDS = Object.freeze({ metal: 'METAL PIECE', trap: 'TRAP', bombPack: 'BOMB PACK', bigBomb: 'BIG BOMB' });
const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const PHASE_WORD = { [Phase.Claim]: 'CLAIM', [Phase.Cannons]: 'CANNONS', [Phase.Battle]: 'BATTLE', [Phase.Repair]: 'REPAIR',
                     [Phase.Score]: 'SCORE', [Phase.GameOver]: 'GAME OVER', [Phase.Victory]: 'VICTORY', [Phase.Decide]: 'CONTINUE?' };

// AUTHORED (SETTINGS_UC.md UC-ST4 step 2): the smallest screen the HUD is ever laid out for, CSS px. TEXT SIZE draws the HUD for a
// screen that much smaller and scales it up, so a size that would push it under this is cut to what fits.
const MIN_LAYOUT_W = 360, MIN_LAYOUT_H = 320;   // a 360 px wide phone, the narrowest in common use, at 100 %

/** The text size the HUD can give on a w x h (CSS px) screen when `want` (1, 1.25, 1.5) is asked for: never under 1, never laying
 *  the HUD out for a screen under MIN_LAYOUT_W x MIN_LAYOUT_H. */
export function textScaleFor(want, w, h) { return Math.max(1, Math.min(want, w / MIN_LAYOUT_W, h / MIN_LAYOUT_H)); }

// AUTHORED: px of room round a panel sprite for its drop shadow (offset 1, 3)
const PANEL_PAD = 4;
/** Paint a wooden panel (Hud.woodPanel's look) at x, y, w x h on a 2D context g. */
function paintWoodPanel(g, x, y, w, h, r, rim, fill) {
  const b = Math.max(3, Math.min(6, Math.min(w, h) * 0.07));                                // the rim's width, px
  const grad = (y0, y1, a, z) => { const q = g.createLinearGradient(0, y0, 0, y1); q.addColorStop(0, a); q.addColorStop(1, z); return q; };
  g.beginPath(); g.roundRect(x + 1, y + 3, w, h, r); g.fillStyle = 'rgba(0,0,0,0.32)'; g.fill();   // the shadow
  g.beginPath(); g.roundRect(x, y, w, h, r);
  g.fillStyle = rim || grad(y, y + h, UI.stoneLight, UI.stoneDark);
  g.fill(); g.lineWidth = 1.5; g.strokeStyle = UI.ink; g.stroke();
  const ir = Math.max(2, r - b);
  g.beginPath(); g.roundRect(x + b, y + b, w - 2 * b, h - 2 * b, ir);
  g.fillStyle = fill || grad(y + b, y + h - b, UI.woodLight, UI.woodDark);
  g.fill();
  g.save(); g.clip();
  if (!fill && h > 44) {                                                                    // plank seams
    g.fillStyle = 'rgba(30,16,6,0.35)';
    for (let k = 1; k < 3; k++) g.fillRect(x + b, y + b + (h - 2 * b) * k / 3, w - 2 * b, 1.5);
  }
  g.fillStyle = 'rgba(255,240,210,0.16)'; g.fillRect(x + b, y + b, w - 2 * b, Math.max(2, (h - 2 * b) * 0.12));   // lit along the top
  g.restore();
  g.lineWidth = 1.5; g.strokeStyle = 'rgba(20,10,4,0.55)'; g.stroke();
}

export class Hud {
  constructor(canvas, title) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('hud.js: the HUD canvas gave no 2D context');
    this.title = title;
    this.said = new Map();         // slot -> the last lastMessage seen, to tell a new one
    this.notes = new Map();       // slot -> { text, at, buy }: the latest refusal or purchase on a card, shown for NOTE_SECONDS in a bright colour
    this.want = 1;                // UC-ST4: the text size asked for (setTextSize), and `s` the one this screen gives (textScaleFor)
    this.s = 1;
  }

  /** UC-ST4 step 1: TEXT SIZE as a ratio (1, 1.25, 1.5). Everything the HUD draws is laid out for a screen that much smaller (cssW,
   *  cssH) and drawn scaled up, so a card or a menu grows whole and nothing is laid out past the edge. The size unit u stays the
   *  window's (min(W / 100, H / 60) times s in the layout), so a part sized from u grows by s too, not only one sized in px. Every point handed IN (a
   *  projected tag, a ghost note, a free rect, a click) is in the window's CSS px and is turned into the layout's here; every box
   *  handed OUT (layout, titleBox) is in the window's px. */
  setTextSize(want) {
    if (!(want >= 1 && want <= 2)) throw new Error('hud.js: a text size is a ratio from 1 to 2, got ' + want);
    this.want = want;
    if (this.realW) this.resize(this.realW, this.realH, this.dpr);
  }

  /** The match HUD's layout (matchLayout) for n cards, in the window's CSS px: what the camera's free rect and the page's hint strip
   *  and action bar are cut from. */
  layout(n) {
    const s = this.s, L = Hud.matchLayout(this.cssW, this.cssH, n, s);
    return { u: L.u * s, barH: L.barH * s, cardH: L.cardH * s, cardW: L.cardW * s, cardsTop: L.cardsTop * s };
  }

  /** Where the pointer can act on the menu drawn last, in CSS px (taken from the drawing code itself, so a hit box can never drift
   *  from what is on screen): { kind: 'row', row } a menu row, { kind: 'seat', seat } a seat card on the join screen, { kind:
   *  'step', row, dir } the arrow beside a setup value, { kind: 'letter', dir } the top or bottom half of the initial being set.
   *  hitsScreen: the menu screen they belong to. As the private model's host keeps its menu rows for its mouse. */
  hitAt(screen, x, y) {
    if (screen !== this.hitsScreen) return null;
    for (const h of this.hits) if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1) return h;
    return null;
  }
  /** The menu drawn last for `screen` has pointer targets (else a click anywhere is "press a button", as on the title). */
  hasHits(screen) { return screen === this.hitsScreen && this.hits.length > 0; }
  // the boxes are kept in the window's px (drawn in the layout's: TEXT SIZE scales them by s, UC-ST4)
  hit(h, x0, y0, x1, y1) { const s = this.s; this.hits.push(Object.assign(h, { x0: x0 * s, y0: y0 * s, x1: x1 * s, y1: y1 * s })); }

  resize(w, h, dpr) {
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); this.dpr = dpr;
    this.realW = w; this.realH = h;
    this.s = textScaleFor(this.want, w, h);
    this.cssW = w / this.s; this.cssH = h / this.s;                          // the screen the HUD is laid out for (UC-ST4)
  }

  /** A point in the window's CSS px as the layout's; a rect { x0, y0, x1, y1 } the same. */
  inLayout(p) { return { ...p, x: p.x / this.s, y: p.y / this.s }; }
  rectInLayout(f) { const s = this.s; return { x0: f.x0 / s, y0: f.y0 / s, x1: f.x1 / s, y1: f.y1 / s }; }

  // ------------------------------------------------------------------ drawing helpers (sizes in CSS px; the context is scaled)
  font(px, weight = 800) { this.ctx.font = weight + ' ' + px + 'px ' + FONT; }
  text(s, x, y, px, color, align = 'center', weight = 800, stroke = true) {
    const c = this.ctx; this.font(px, weight); c.textAlign = align; c.textBaseline = 'middle';
    if (stroke) { c.lineJoin = 'round'; c.lineWidth = Math.max(2, px * 0.16); c.strokeStyle = 'rgba(10,24,40,0.85)'; c.strokeText(s, x, y); }
    c.fillStyle = color; c.fillText(s, x, y);
  }
  panel(x, y, w, h, r, fill, edge) {
    const c = this.ctx; c.beginPath(); c.roundRect(x, y, w, h, r); c.fillStyle = fill; c.fill();
    if (edge) { c.lineWidth = 2; c.strokeStyle = edge; c.stroke(); }
  }
  /** A chunky wooden panel in a stone frame (UC-L1): a soft drop shadow, a stone rim (lighter at the top, `rim` replaces its colour:
   *  a player's colour, the warning colour), a dark ink line round it, and planks inside (light to dark, with a seam or two when it is
   *  tall enough), lit along the top. `fill` replaces the planks with a flat colour (a joined seat's colour, a chosen button).
   *  Drawn once per size and look into a sprite of its own and stamped from then on: a frame draws a dozen of them (the cards, the
   *  phase chip, the menus), and painting each from paths and gradients every frame cost the HUD ~0.1 ms a frame (11-09, perf). */
  woodPanel(x, y, w, h, r, { rim = null, fill = null, alpha = 1 } = {}) {
    const dpr = this.dpr, W = Math.round(w), H = Math.round(h), key = [W, H, Math.round(r), rim, fill, dpr].join('|');
    if (!this.panels || this.panels.size > 64) this.panels = new Map();
    let sp = this.panels.get(key);
    if (!sp) {
      sp = document.createElement('canvas');
      sp.width = Math.ceil((W + PANEL_PAD * 2) * dpr); sp.height = Math.ceil((H + PANEL_PAD * 2) * dpr);
      const g = sp.getContext('2d');
      if (!g) throw new Error('hud.js: a panel sprite gave no 2D context');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintWoodPanel(g, PANEL_PAD, PANEL_PAD, W, H, r, rim, fill);
      this.panels.set(key, sp);
    }
    const c = this.ctx; c.save(); c.globalAlpha *= alpha;
    c.drawImage(sp, x - PANEL_PAD, y - PANEL_PAD, sp.width / dpr, sp.height / dpr);
    c.restore();
  }

  /** The seat a player slot sits at (HudViewModel.seatOfSlot, set by the host): a card, a tag and a colour say "P" + seat + 1, so a
   *  lone player in seat 3 is P3 in P3's colour. null in the view model means seat = slot (the demo). */
  static seatOf(hud, slot) {
    const map = hud.seatOfSlot;
    if (map === null) return slot;
    if (!(slot < map.length)) throw new Error('hud.js: slot ' + slot + ' has no seat in seatOfSlot [' + map.join(',') + ']');
    return map[slot];
  }

  /** view: the frame's view ({match, controllers, hud, menu}); project(vec3) -> {x, y, visible} in CSS px; tags from the units. */
  draw(view, project, tags, seconds, full) {
    const c = this.ctx, W = this.cssW, H = this.cssH;
    c.setTransform(this.dpr * this.s, 0, 0, this.dpr * this.s, 0, 0);
    c.clearRect(0, 0, W, H);
    const real = project; project = (v) => this.inLayout(real(v));
    const menu = view.menu, m = view.match;
    if (m) for (const e of view.events) if (e instanceof ItemBought) this.notes.set(e.slot, { text: 'BOUGHT ' + ITEM_WORDS[ItemNames[e.item]], at: seconds, buy: true });
    const screen = menu ? menu.screen : Screen.Playing;
    this.hits = []; this.hitsScreen = full ? screen : -1;
    if (m && (screen === Screen.Playing || screen === Screen.Pause || screen === Screen.Decide || (screen === Screen.Title && menu.inDemo))) {
      this.drawTags(view.hud, project, tags);
      if (full) this.drawMatch(view, seconds, screen !== Screen.Decide);   // the fate screen has its own heading
    }
    if (!menu || !full) return;
    switch (screen) {
      case Screen.Title: this.drawTitle(menu, seconds, !!m); break;
      case Screen.Setup: this.drawSetup(menu, seconds, (view.menuCover || []).map((r) => ({ left: r.left / this.s, right: r.right / this.s, top: r.top / this.s, bottom: r.bottom / this.s }))); break;
      case Screen.Pause: this.drawRows('PAUSED', MenuModel.PauseRows, menu.row, ''); break;
      case Screen.Decide: this.drawDecide(view, seconds); break;
      case Screen.Results: this.drawResults(menu, seconds); break;
      case Screen.Initials: this.drawInitials(menu, seconds); break;
      case Screen.HighScores: this.drawScores(menu); break;
      case Screen.Playing: break;
      default: throw new Error('hud.js: no drawing for menu screen ' + screen);
    }
  }

  drawTags(hud, project, tags) {
    for (const t of tags) {
      const p = project(t.at); if (!p.visible) continue;
      const seat = Hud.seatOf(hud, t.slot), s = 'P' + (seat + 1);
      this.panel(p.x - 17, p.y - 12, 34, 24, 12, UI.ink); this.panel(p.x - 15, p.y - 10, 30, 20, 10, PLAYER_CSS[seat], 'rgba(255,255,255,0.85)');
      this.text(s, p.x, p.y + 1, 13, PLAYER_INK_CSS[seat], 'center', 900, false);
    }
  }

  /** Where the match HUD draws its parts on a W x H (CSS px) screen with n player cards: the top bar's height and the card row's
   *  top. The camera keeps its frame between the two (renderer.freeRect), so these are the numbers drawMatch draws with. */
  static matchLayout(W, H, n, s = 1) {
    // s: TEXT SIZE (UC-ST4): W, H are the layout's (the window / s) and u the window's, so every part grows by s
    const u = Math.min(W / 100, H / 60) * s, barH = Math.max(40, u * 5.2), cardH = Math.max(64, u * 8.5);
    return { u, barH, cardH, cardW: n > 0 ? Math.min(250, (W - 30) / n - 10) : 0, cardsTop: n > 0 ? H - cardH - 12 : H };
  }

  /** A chevron at the free rect's edge for each enemy ship outside it, pointing at the ship (the private host's ShipMarks rule:
   *  a ship the players cannot see gets a red chevron at the band's edge; graphics round 3). marks: [{ x, y } screen px]. */
  shipMarks(marks, free, seconds) {
    const c = this.ctx, E = 18;
    marks = marks.map((m) => this.inLayout(m)); free = this.rectInLayout(free);
    marks.forEach((m, i) => {
      const cx = Math.min(Math.max(m.x, free.x0 + E), free.x1 - E), cy = Math.min(Math.max(m.y, free.y0 + E), free.y1 - E);
      let dx = m.x - cx, dy = m.y - cy, len = Math.hypot(dx, dy);
      if (len < 1) { dx = 0; dy = -1; len = 1; }
      dx /= len; dy /= len;
      const r = 16 * (0.82 + 0.18 * Math.sin(seconds * 6 + i)), tx = cx + dx * r, ty = cy + dy * r, bx = cx - dx * r * 0.6, by = cy - dy * r * 0.6;
      const ox = -dy * r * 0.8, oy = dx * r * 0.8;
      c.beginPath(); c.moveTo(tx, ty); c.lineTo(bx + ox, by + oy); c.lineTo(cx - dx * r * 0.1, cy - dy * r * 0.1); c.lineTo(bx - ox, by - oy); c.closePath();
      c.fillStyle = '#ff3a1f'; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke();
    });
  }

  /** REPAIRFAR (round 5): a disc in the player's colour at the free rect's edge with an arrow pointing at their hero, for a hero
   *  the REPAIR frame left out (camera.js REPAIR_NEAR). Not a ship chevron: round, white-rimmed, in the player's own colour.
   *  marks: [{ x, y, colour }] screen px. */
  heroMarks(marks, free, seconds) {
    const c = this.ctx, E = 26;
    marks = marks.map((m) => this.inLayout(m)); free = this.rectInLayout(free);
    for (const m of marks) {
      const cx = Math.min(Math.max(m.x, free.x0 + E), free.x1 - E), cy = Math.min(Math.max(m.y, free.y0 + E), free.y1 - E);
      let dx = m.x - cx, dy = m.y - cy, len = Math.hypot(dx, dy);
      if (len < 1) { dx = 0; dy = -1; len = 1; }
      dx /= len; dy /= len;
      const r = 12 + 1.5 * Math.sin(seconds * 5), tx = cx + dx * (r + 12), ty = cy + dy * (r + 12), ox = -dy * 8, oy = dx * 8;
      c.beginPath(); c.moveTo(tx, ty); c.lineTo(cx + dx * r + ox, cy + dy * r + oy); c.lineTo(cx + dx * r - ox, cy + dy * r - oy); c.closePath();
      c.fillStyle = m.colour; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.95)'; c.stroke();
      c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fillStyle = m.colour; c.fill(); c.stroke();
      c.beginPath(); c.arc(cx, cy, r * 0.42, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.95)'; c.fill();
    }
  }

  drawMatch(view, seconds, banner) {
    const hud = view.hud, m = view.match, W = this.cssW, H = this.cssH, ctl = view.controllers[0];
    const n = hud.players.filter((p) => p.present).length, L = Hud.matchLayout(W, H, n, this.s), u = L.u;
    // the top bar: round + level on the left, the phase and its timer in the middle, lives and team score on the right
    const barH = L.barH;
    const g = this.ctx.createLinearGradient(0, 0, 0, barH * 1.4); g.addColorStop(0, 'rgba(36,20,8,0.7)'); g.addColorStop(1, 'rgba(36,20,8,0)');
    this.ctx.fillStyle = g; this.ctx.fillRect(0, 0, W, barH * 1.4);
    const fs = Math.max(14, u * 2.1);
    const narrow = W < 640;                                   // a phone held upright: the short form, so nothing runs into the phase chip
    // the round and level: the longest form that ends before the phase chip (at 150 % text the island's name ran under it, 11-10)
    const chipW0 = narrow ? Math.max(118, fs * 7.5) : Math.max(150, fs * 9), left = narrow ? 12 : 18, room = W / 2 - chipW0 / 2 - left - 12;
    const forms = ['ROUND ' + hud.round + '  ·  LEVEL ' + hud.level + (hud.mapName ? '  ·  ' + hud.mapName : ''), 'ROUND ' + hud.round + '  ·  LEVEL ' + hud.level,
                   'R' + hud.round + ' · L' + hud.level];
    const said = forms.slice(narrow ? 2 : 0).find((t) => this.textWidth(t, fs) <= room) ?? forms[2];
    this.text(said, left, barH / 2, fs, '#fff', 'left');
    const lives = Math.max(0, hud.lives);
    let lx = W - 18;
    this.text('SCORE ' + hud.teamScore, lx, barH / 2, fs, UI.gold, 'right');
    this.font(fs); lx -= this.ctx.measureText('SCORE ' + hud.teamScore).width + 26;
    for (let i = 0; i < lives; i++) { this.shield(lx - i * (fs * 1.2), barH / 2, fs * 0.5); }
    // phase chip and the timer ring
    const word = PHASE_WORD[hud.phase];
    if (word === undefined) throw new Error('hud.js: no word for phase ' + hud.phase);
    const cx = W / 2, chipW = chipW0;
    this.woodPanel(cx - chipW / 2, barH * 0.1, chipW, barH * 0.8, barH * 0.3);
    this.text(word, cx - (hud.secondsTotal > 0 ? fs * 0.9 : 0), barH / 2, fs * 1.05, '#fff');
    if (hud.secondsTotal > 0 && !m.ended) {
      const rx = cx + chipW / 2 - barH * 0.36, ry = barH / 2, rr = barH * 0.27, k = hud.secondsLeft / hud.secondsTotal, c = this.ctx;
      c.beginPath(); c.arc(rx, ry, rr, 0, Math.PI * 2); c.fillStyle = UI.woodDark; c.fill(); c.lineWidth = 2; c.strokeStyle = UI.ink; c.stroke();
      c.beginPath(); c.moveTo(rx, ry); c.arc(rx, ry, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); c.closePath();
      c.fillStyle = hud.secondsLeft <= 5 ? 'rgba(255,91,74,0.85)' : 'rgba(255,210,74,0.45)'; c.fill();
      this.text(String(hud.secondsLeft), rx, ry + 1, rr * 1.05, hud.secondsLeft <= 5 ? '#fff' : UI.gold, 'center', 900);
    }
    // the banner: big for a moment after it changes
    const since = Number(m.tick - hud.bannerTick);
    if (banner && hud.banner && since >= 0 && since < hud.bannerTicks) {
      const k = since / hud.bannerTicks, a = Math.min(1, k * 8, (1 - k) * 5), pop = 1 + 0.25 * Math.max(0, 1 - k * 10);
      this.ctx.globalAlpha = a;
      const by = H * 0.36, bs = Math.max(26, u * 5.4) * pop;
      this.text(hud.banner, W / 2, by, bs, '#fff', 'center', 900);
      if (hud.subtitle) this.text(hud.subtitle, W / 2, by + bs * 0.95, bs * 0.42, UI.gold);
      this.ctx.globalAlpha = 1;
    }
    // the player cards along the bottom
    if (n === 0) return;
    const cw = L.cardW, ch = L.cardH, y0 = L.cardsTop;
    let x = (W - (cw + 10) * n + 10) / 2;
    for (let s = 0; s < hud.players.length; s++) {
      const p = hud.players[s]; if (!p.present) continue;
      this.card(s, Hud.seatOf(hud, s), p, x, y0, cw, ch, m, ctl, seconds);
      x += cw + 10;
    }
  }

  shield(x, y, r) {
    const c = this.ctx; c.beginPath();
    c.moveTo(x, y - r); c.lineTo(x + r * 0.85, y - r * 0.6); c.lineTo(x + r * 0.7, y + r * 0.35); c.lineTo(x, y + r); c.lineTo(x - r * 0.7, y + r * 0.35); c.lineTo(x - r * 0.85, y - r * 0.6); c.closePath();
    c.fillStyle = '#ff6a6a'; c.fill(); c.lineWidth = 2; c.strokeStyle = 'rgba(255,255,255,0.9)'; c.stroke();
  }

  /** One player's card: s is the player SLOT (what the model and controller are asked by), seat names and colours it. */
  card(s, seat, p, x, y, w, h, m, ctl, seconds) {
    const col = PLAYER_CSS[seat], c = this.ctx, bombs = m.options.bombs, pl = m.player(s);
    // a refusal that just came in, or a purchase, takes the line for NOTE_SECONDS and lights the card's edge
    if (p.lastMessage !== (this.said.get(s) ?? '')) { this.said.set(s, p.lastMessage); if (p.lastMessage) this.notes.set(s, { text: p.lastMessage, at: seconds, buy: false }); }
    const note = this.notes.get(s), fresh = note !== undefined && seconds - note.at < NOTE_SECONDS;
    // a wooden card (its planks: HUD_PANEL_CSS's wood, the colour tools/colour_check.py holds the labels to), its stone rim lit in
    // the warning colour (or white for a purchase) while a fresh note shows, and a cloth ribbon in the player's colour down its left
    this.woodPanel(x, y, w, h, 12, { rim: fresh ? (note.buy ? '#ffffff' : WARN) : null, fill: HUD_PANEL_CSS });
    c.fillStyle = col; c.beginPath(); c.roundRect(x + 4, y + 4, 10, h - 8, [9, 0, 0, 9]); c.fill();
    c.lineWidth = 1.5; c.strokeStyle = UI.ink; c.stroke();
    const fs = Math.max(13, h * 0.24);
    this.text('P' + (seat + 1), x + 22, y + h * 0.28, fs * 1.2, PLAYER_TEXT_CSS[seat], 'left', 900);
    if (ctl.isBot(s)) this.text('BOT', x + 22 + fs * 1.9, y + h * 0.3, fs * 0.62, 'rgba(255,255,255,0.65)', 'left', 700, false);
    this.text(String(p.score), x + w - 12, y + h * 0.28, fs, UI.gold, 'right');
    if (bombs) this.stock(pl, x + w - 12 - this.textWidth(String(p.score), fs) - 10, y + h * 0.3, fs * 0.58);
    // what this player is doing now
    const mid = x + 22, row = y + h * 0.68;
    // why the last command was refused, or that the player fell, takes the line: it is what they need to read now
    const status = p.fell ? 'NO CASTLE INSIDE YOUR WALLS' : fresh ? note.text : p.lastMessage;
    const onFoot = bombs && (m.phase === Phase.Repair || m.phase === Phase.Battle);
    const hand = onFoot ? this.hand(pl, x + w - 12, row, fs) : 0;       // the bombs in hand, at the line's right end
    if (status) {                                                         // shrunk to fit the card, never cut
      let px = fs * 0.62; this.font(px); const room = w - (mid - x) - 12 - hand, tw = this.ctx.measureText(status).width;
      if (tw > room) px *= room / tw;
      this.text(status, mid, row, px, p.fell ? '#ff6a6a' : fresh ? (note.buy ? PLAYER_TEXT_CSS[seat] : WARN) : '#ffb4a8', 'left', 800, false);
    }
    else if (onFoot && pl.stunLeft > 0) this.text('STUNNED', mid, row, fs * 0.72, WARN, 'left', 800, false);
    else if (m.phase === Phase.Cannons) {
      for (let i = 0; i < p.cannons; i++) this.cannonIcon(mid + fs * 0.4 + i * fs * 1.25, row, fs * 0.5, col);
      if (p.cannons === 0) this.text('READY', mid, row, fs * 0.8, 'rgba(255,255,255,0.8)', 'left', 800, false);
    } else if (m.phase === Phase.Repair) {
      const shape = m.catalog.byId(p.heldShapeId);
      if (!shape) throw new Error('hud.js: player ' + s + ' holds shape ' + p.heldShapeId + ', which the catalog does not have');
      // the tool in hand is named: the bombs when they are out (a piece cannot be placed then), else the piece itself
      if (pl.sword) this.text(bombs ? 'BOMBS' : 'SWORD OUT', mid, row, fs * 0.72, 'rgba(255,255,255,0.85)', 'left', 800, false);
      else this.piece(shape.rotated(ctl.ghostOf(s).quarterTurns), mid, row, fs * 0.42, col);
    } else if (m.phase === Phase.Claim) {
      this.text(pl.claimedCastle !== 0 ? 'HOME CHOSEN' : 'PICK A CASTLE', mid, row, fs * 0.72, 'rgba(255,255,255,0.85)', 'left', 800, false);
    } else if (m.phase === Phase.Battle) {
      this.text(pl.sword ? (bombs ? 'BOMBS' : 'SWORD OUT') : 'CANNON', mid, row, fs * 0.72, 'rgba(255,255,255,0.85)', 'left', 800, false);
    }
    if (!p.connected) {
      this.panel(x, y, w, h, 12, 'rgba(20,20,26,0.72)');
      this.text('DISCONNECTED', x + w / 2, y + h / 2, fs * 0.8, '#ffb4a8');
    }
  }

  textWidth(s, px, weight = 800) { this.font(px, weight); return this.ctx.measureText(s).width; }

  /** The bombs in hand as a bomb icon and a count, right-aligned at x; returns the width taken (the line's text gives way to it). */
  hand(pl, x, y, fs) {
    const c = this.ctx, label = '×' + pl.bombs, tw = this.textWidth(label, fs * 0.8), r = fs * 0.3;
    this.text(label, x, y, fs * 0.8, pl.bombs > 0 ? '#fff' : '#ff9a8a', 'right', 800, false);
    const bx = x - tw - r - 4;
    c.beginPath(); c.arc(bx, y + r * 0.35, r, 0, Math.PI * 2); c.fillStyle = pl.bombs > 0 ? '#1d1f24' : 'rgba(29,31,36,0.45)'; c.fill();
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,0.85)'; c.stroke();
    c.beginPath(); c.moveTo(bx + r * 0.5, y - r * 0.5); c.lineTo(bx + r * 1.1, y - r * 1.3); c.strokeStyle = '#ffc24a'; c.stroke();
    return tw + r * 2 + 12;
  }

  /** The stock bought in the shop and not yet used, as short chips ending at x: metal pieces (M), traps (T) and big bombs (B). */
  stock(pl, x, y, px) {
    const parts = [];
    if (pl.items.metal > 0) parts.push('M' + pl.items.metal);
    if (pl.items.trap > 0) parts.push('T' + pl.items.trap);
    if (pl.items.bigBomb > 0) parts.push('B' + pl.items.bigBomb);
    if (parts.length) this.text(parts.join('  '), x, y, px, '#cfe6ff', 'right', 800, false);
  }

  cannonIcon(x, y, r, col) {
    const c = this.ctx;
    c.beginPath(); c.arc(x, y + r * 0.2, r * 0.7, 0, Math.PI * 2); c.fillStyle = '#2c3138'; c.fill();
    c.lineWidth = 2; c.strokeStyle = col; c.stroke();
    c.save(); c.translate(x, y); c.rotate(-0.6); c.fillStyle = '#2c3138'; c.fillRect(0, -r * 0.22, r * 1.1, r * 0.44); c.restore();
  }

  piece(cells, x, y, sq, col) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const q of cells) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const oy = y - ((y1 - y0 + 1) * sq) / 2;
    for (const q of cells) this.panel(x + (q.x - x0) * sq, oy + (q.y - y0) * sq, sq - 2, sq - 2, 3, col, 'rgba(255,255,255,0.8)');
  }

  // ------------------------------------------------------------------ menus
  /** A short note at the bottom centre over everything (the quality switch says what it switched to); a fades it out. */
  toast(text, a, top = null, big = false) {
    const c = this.ctx; c.save(); c.globalAlpha = a;
    const px = big ? 24 : 16, h = big ? 46 : 34, y = top === null ? this.cssH * 0.7 : top / this.s;
    this.font(px, big ? 900 : 700); const w = c.measureText(text).width + (big ? 52 : 36);
    // a closing ring's toast (UC-P2) is gold on a dark panel; the quality switch's note stays plain
    this.woodPanel(this.cssW / 2 - w / 2, y, w, h, h / 2, { rim: big ? '#ffd257' : null });
    this.text(text, this.cssW / 2, y + h / 2 + 1, px, big ? '#ffd257' : '#ffffff', 'center', big ? 900 : 700, big);
    c.restore();
    this.drawnToast = { text, y, a };
  }
  /** UC-P1: why the ghost would be refused, said AT the ghost: a red pill over it with a pointer down to it ("water", "wall here").
   *  `notes` [{ x, y (CSS px of the ghost's top), text, strong (0..1: a refused press just now, drawn bigger and brighter) }]. */
  ghostNotes(notes) {
    const c = this.ctx;
    notes = notes.map((n) => this.inLayout(n));
    this.drawnNotes = [];
    for (const n of notes) {
      const px = Math.round(13 + 4 * n.strong);
      c.save();
      this.font(px, 800);
      const w = c.measureText(n.text).width + 18, h = px + 10, x = Math.max(4, Math.min(this.cssW - w - 4, n.x - w / 2)), y = n.y - h - 30;
      c.globalAlpha = 0.85 + 0.15 * n.strong;
      c.beginPath(); c.moveTo(n.x - 6, y + h - 1); c.lineTo(n.x, y + h + 26); c.lineTo(n.x + 6, y + h - 1); c.closePath();
      c.fillStyle = 'rgba(178,20,20,0.95)'; c.fill();
      this.panel(x, y, w, h, h / 2, n.strong > 0 ? 'rgba(206,24,24,0.97)' : 'rgba(150,18,18,0.92)', n.strong > 0 ? '#ffffff' : 'rgba(255,255,255,0.6)');
      this.text(n.text, x + w / 2, y + h / 2 + 1, px, '#ffffff', 'center', 800, false);
      c.restore();
      this.drawnNotes.push({ slot: n.slot, text: n.text, box: [x, y, x + w, y + h], strong: n.strong });
    }
  }

  /** The transition wipe between phases and screens (graphics round 2): a slanted band of light sweeps once across the picture,
   *  k = 0..1 through it. It only brightens (no frame of the game is hidden), so nothing a player needs disappears under it. */
  wipe(k) {
    const c = this.ctx, W = this.cssW, H = this.cssH, slant = H * 0.36, band = W * 0.24;
    const e = k * k * (3 - 2 * k), x = -band - slant + e * (W + 2 * band + 2 * slant);
    const g = c.createLinearGradient(x - band / 2, 0, x + band / 2, 0);
    g.addColorStop(0, 'rgba(160,220,255,0)'); g.addColorStop(0.42, 'rgba(160,220,255,0.16)'); g.addColorStop(0.5, 'rgba(255,255,255,0.42)');
    g.addColorStop(0.58, 'rgba(160,220,255,0.16)'); g.addColorStop(1, 'rgba(160,220,255,0)');
    c.save(); c.globalAlpha = Math.min(1, Math.sin(Math.PI * k) * 1.6);
    const s = 2 * slant / H;                                    // the band leans: x moves left by s per pixel down, level at mid-height
    c.setTransform(this.dpr, 0, -s * this.dpr, this.dpr, s * H / 2 * this.dpr, 0);
    c.fillStyle = g; c.fillRect(x - band / 2, 0, band, H); c.restore();
  }
    dim(a = 0.55) { this.ctx.fillStyle = 'rgba(6,20,36,' + a + ')'; this.ctx.fillRect(0, 0, this.cssW, this.cssH); }

  logo(y, size, seconds) {
    const W = this.cssW;
    this.text(this.title.toUpperCase(), W / 2, y, size, '#ffffff', 'center', 900);
    // a wave line under the name, in the four players' colours
    const c = this.ctx, w = size * 5.2, x0 = W / 2 - w / 2;
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      for (let k = 0; k <= 40; k++) { const t = k / 40, xx = x0 + i * w / 4 + t * w / 4, yy = y + size * 0.72 + Math.sin(t * Math.PI * 2 + seconds * 3 + i) * size * 0.06; k ? c.lineTo(xx, yy) : c.moveTo(xx, yy); }
      c.lineWidth = size * 0.1; c.lineCap = 'round'; c.strokeStyle = PLAYER_CSS[i]; c.stroke();
    }
  }

  drawTitle(menu, seconds, behind) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60) * this.s;
    this.dim(behind ? 0.35 : 0.2);
    this.logo(H * 0.34, Math.max(48, u * 11), seconds);
    if (menu.inDemo) this.text('DEMO', W / 2, H * 0.52, Math.max(18, u * 3), '#ffe08a');
    if (Math.sin(seconds * 4) > -0.4) this.text('PRESS ANY BUTTON', W / 2, H * 0.62, Math.max(18, u * 3.2), '#fff');
    const sub = Math.max(13, u * 1.9), press = Math.max(18, u * 3.2);
    this.text('Defend your castle with up to three friends', W / 2, H * 0.7, sub, 'rgba(255,255,255,0.85)', 'center', 700);
    // where the title's words stand (CSS px, text centred on its y): the page keeps its foot below them (TITLE_UC.md UC-T1 R1)
    this.titleBox = { pressTop: (H * 0.62 - press * 0.6) * this.s, subBottom: (H * 0.7 + sub * 0.6) * this.s };   // the window's px
  }

  /** The join screen. cover: DOM rects drawn over the canvas that the seats and rows must stay clear of (QRLAND, round 5: the
   *  phone room's QR panel, which PhonePad places at a fixed corner at a fixed size, and the how-to card); measured by the page
   *  each frame (main.js menuCover). A seat or row band that would cross one moves into the widest gap beside it, or below it
   *  when that gap is too narrow; with no cover crossed the layout is the centred one. */
  drawSetup(menu, seconds, cover) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60) * this.s;
    this.dim(0.5);
    // FOOT: CSS px the page's own foot takes at the bottom (app/style.css .foot, compact under 560 px of height); the rows must end
    // above it. On a short screen (a phone held sideways) the name, the cards and the rows shrink to fit.
    const FOOT = H < 560 ? 84 : 120, short = H < 560;
    this.logo(short ? H * 0.08 : H * 0.12, short ? Math.max(22, H * 0.065) : Math.max(30, u * 6), seconds);
    // AUTHORED: GAP px kept between the menu and a cover; the narrowest band the four seats (SEATS_NEED) and the rows (ROWS_NEED:
    // a label and "◀ GULLROCK ISLE ▶" side by side) are laid in before they move below the cover instead
    const GAP = 12, SEATS_NEED = Math.min(W - 20, 480), ROWS_NEED = Math.min(W - 20, 340);
    const crosses = (y0, y1, x0, x1) => cover.some((c) => c.top < y1 && c.bottom > y0 && c.left < x1 && c.right > x0);
    const gapAt = (y0, y1) => {                        // the widest x span in [0, W] no cover crosses between y0 and y1
      let iv = [[0, W]];
      for (const c of cover) if (c.top < y1 && c.bottom > y0) iv = iv.flatMap(([a, b]) => [[a, Math.min(b, c.left - GAP)], [Math.max(a, c.right + GAP), b]]).filter(([a, b]) => b - a > 1);
      return iv.reduce((best, v) => (!best || v[1] - v[0] > best[1] - best[0] ? v : best), null) || [0, 0];
    };
    const below = (y0, y1) => Math.max(y0, ...cover.filter((c) => c.top < y1 && c.bottom > y0).map((c) => c.bottom + GAP));
    // the four seats: joined ones in their colour, open ones waiting for a button
    let cw = Math.min(200, (W - 60) / 4 - 12), y = short ? H * 0.17 : H * 0.26, sx0 = 0, sx1 = W;
    const ch = short ? Math.max(44, H * 0.14) : Math.max(70, u * 11);
    const seatsW = (cw + 12) * 4 - 12;
    if (crosses(y, y + ch, (W - seatsW) / 2, (W + seatsW) / 2)) {
      let g = gapAt(y, y + ch);
      if (g[1] - g[0] < SEATS_NEED) { y = below(y, y + ch); g = gapAt(y, y + ch); }
      [sx0, sx1] = g; cw = Math.min(cw, (sx1 - sx0 - 20) / 4 - 9);
    }
    let x = (sx0 + sx1 - ((cw + 12) * 4 - 12)) / 2;
    for (let s = 0; s < MenuModel.Seats; s++) {
      const j = menu.joined[s];
      this.woodPanel(x, y, cw, ch, 14, j ? { fill: PLAYER_CSS[s] } : { alpha: 0.85 });
      this.text('P' + (s + 1), x + cw / 2, y + ch * 0.34, ch * 0.3, j ? PLAYER_INK_CSS[s] : 'rgba(255,255,255,0.6)', 'center', 900, !j);
      this.text(j ? 'READY' : 'PRESS TO JOIN', x + cw / 2, y + ch * 0.72, ch * 0.15, j ? PLAYER_INK_CSS[s] : '#fff', 'center', 800, false);
      this.hit({ kind: 'seat', seat: s }, x, y, x + cw, y + ch);
      x += cw + 12;
    }
    // the rows end above the foot and above any cover below the seats that leaves them no ROWS_NEED gap (a how-to card across a
    // portrait phone); beside a cover they centre in the widest gap
    let floor = H - FOOT;
    for (const c of cover) if (c.top > y + ch) { const g = gapAt(c.top, c.bottom); if (g[1] - g[0] < ROWS_NEED) floor = Math.min(floor, c.top - GAP); }
    // the band holds the rows plus one row of air above them and 0.45 + 0.15 below the last one (6 rows: the old fixed / 6.6)
    const rows = MenuModel.SetupRows, rh = Math.min(Math.max(30, u * 4.6), (floor - y - ch) / (rows.length + 0.6)), top = y + ch + rh;
    let half = Math.min(230, W / 2 - 10), cx = W / 2;            // the rows' half width (narrow on a phone) and their centre
    const ry0 = top - rh * 0.45, ry1 = top + (rows.length - 1) * rh + rh * 0.45;
    if (crosses(ry0, ry1, cx - half, cx + half)) { const g = gapAt(ry0, ry1); cx = (g[0] + g[1]) / 2; half = Math.min(half, (g[1] - g[0]) / 2); }
    const lab = half - 30;                                       // where a label starts and a value ends, from the centre
    for (let i = 0; i < rows.length; i++) {
      const sel = i === menu.row, yy = top + i * rh, raw = menu.valueOfRow(i);
      const val = i === MenuModel.RowMap ? HudViewModel.pretty(raw) : raw;   // "GullrockIsle" -> "GULLROCK ISLE", as the match's top bar says it
      if (sel) this.woodPanel(cx - half, yy - rh * 0.5, half * 2, rh, rh * 0.4, { rim: UI.gold });
      this.text(rows[i], val ? cx - lab : cx, yy, rh * 0.5, sel ? '#fff' : 'rgba(255,255,255,0.75)', val ? 'left' : 'center');
      if (val) this.text((sel ? '◀ ' : '') + val + (sel ? ' ▶' : ''), cx + lab, yy, rh * 0.5, sel ? UI.gold : 'rgba(255,210,74,0.8)', 'right');
      const y0 = yy - rh * 0.45, y1 = yy + rh * 0.45;
      if (sel && val) {                                       // the arrows, measured in the font they were drawn in
        this.font(rh * 0.5); const all = this.ctx.measureText('◀ ' + val + ' ▶').width, arrow = this.ctx.measureText('◀ ').width;
        const xr = cx + lab, xl = xr - all;
        this.hit({ kind: 'step', row: i, dir: -1 }, xl - 8, y0, xl + arrow, y1);
        this.hit({ kind: 'step', row: i, dir: 1 }, xr - arrow, y0, xr + 8, y1);
      }
      this.hit({ kind: 'row', row: i }, cx - half, y0, cx + half, y1);
    }
  }

  drawRows(head, rows, at, sub) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60) * this.s, rh = Math.max(34, u * 5.4);
    this.dim(0.55);
    this.text(head, W / 2, H * 0.3, Math.max(34, u * 7), '#fff', 'center', 900);
    if (sub) this.text(sub, W / 2, H * 0.3 + u * 6, Math.max(14, u * 2.2), '#ffe08a');
    const top = H * 0.46;
    rows.forEach((r, i) => {
      const sel = i === at, yy = top + i * rh;
      if (sel) this.woodPanel(W / 2 - 170, yy - rh * 0.5, 340, rh, rh * 0.4, { rim: UI.gold });
      this.text(r, W / 2, yy, rh * 0.52, sel ? '#fff' : 'rgba(255,255,255,0.7)');
      this.hit({ kind: 'row', row: i }, W / 2 - 170, yy - rh * 0.45, W / 2 + 170, yy + rh * 0.45);
    });
  }

  drawDecide(view, seconds) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60) * this.s, menu = view.menu, hud = view.hud;
    this.dim(0.6);
    this.text(hud.banner, W / 2, H * 0.32, Math.max(30, u * 6), '#fff', 'center', 900);
    if (hud.subtitle) this.text(hud.subtitle, W / 2, H * 0.32 + u * 6.5, Math.max(14, u * 2.4), '#ffe08a');
    const rows = MenuModel.DecideRows, bw = Math.max(170, u * 24), bh = Math.max(56, u * 8.5), y = H * 0.55;
    rows.forEach((r, i) => {
      const sel = i === menu.row, x = W / 2 + (i === 0 ? -bw - 16 : 16);
      this.woodPanel(x, y, bw, bh, bh * 0.4, sel ? { fill: i === 0 ? '#2f9f5f' : '#c4433f', rim: UI.gold } : {});
      this.text(r, x + bw / 2, y + bh / 2, bh * 0.36, '#fff');
      this.hit({ kind: 'row', row: i }, x, y, x + bw, y + bh);
    });
  }

  drawResults(menu, seconds) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60) * this.s;
    this.dim(0.65);
    this.text(menu.lastWon ? 'VICTORY!' : 'GAME OVER', W / 2, H * 0.34, Math.max(44, u * 10), menu.lastWon ? '#ffe08a' : '#ff8a7a', 'center', 900);
    this.text('TEAM SCORE  ' + menu.pendingScore, W / 2, H * 0.5, Math.max(22, u * 4), UI.gold);
    if (Math.sin(seconds * 4) > -0.4) this.text('PRESS A BUTTON', W / 2, H * 0.64, Math.max(16, u * 2.6), 'rgba(255,255,255,0.85)');
  }

  drawInitials(menu, seconds) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60) * this.s, bs = Math.max(64, u * 12);
    this.dim(0.7);
    this.text('NEW HIGH SCORE', W / 2, H * 0.26, Math.max(32, u * 6.5), '#ffe08a', 'center', 900);
    this.text(String(menu.pendingScore), W / 2, H * 0.37, Math.max(22, u * 4), UI.gold);
    for (let i = 0; i < 3; i++) {
      const x = W / 2 + (i - 1) * (bs + 16) - bs / 2, y = H * 0.48, sel = i === menu.initialsAt;
      this.woodPanel(x, y, bs, bs * 1.15, 14, sel ? { rim: UI.gold } : {});
      this.text(menu.initials[i], x + bs / 2, y + bs * 0.58, bs * 0.7, sel && Math.sin(seconds * 8) < 0 ? '#ffe08a' : '#fff', 'center', 900);
      if (sel) {                                              // a click on its top half steps the letter back, its bottom half on
        this.text('▲', x + bs / 2, y - bs * 0.16, bs * 0.22, 'rgba(255,255,255,0.8)', 'center', 900, false);
        this.text('▼', x + bs / 2, y + bs * 1.31, bs * 0.22, 'rgba(255,255,255,0.8)', 'center', 900, false);
        this.hit({ kind: 'letter', dir: -1 }, x, y - bs * 0.3, x + bs, y + bs * 0.575);
        this.hit({ kind: 'letter', dir: 1 }, x, y + bs * 0.575, x + bs, y + bs * 1.45);
      }
    }
    if (Math.sin(seconds * 4) > -0.4) this.text('CLICK OR PRESS A FOR THE NEXT LETTER', W / 2, H * 0.48 + bs * 1.7, Math.max(13, u * 1.9), 'rgba(255,255,255,0.75)', 'center', 700);
  }

  drawScores(menu) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60) * this.s, rh = Math.max(24, u * 3.6);
    this.dim(0.7);
    this.text('HIGH SCORES', W / 2, H * 0.14, Math.max(32, u * 6.5), '#fff', 'center', 900);
    const rows = menu.highScores.rows;
    // the table stands on a wooden board like every other menu (11-10: its rows floated over the island and its castles)
    const pw = Math.min(W - 24, 420), top = rows.length ? H * 0.26 - rh * 0.85 : H * 0.4 - rh * 1.1;
    const ph = rows.length ? rows.length * rh + rh * 0.7 : rh * 2.2;
    this.woodPanel(W / 2 - pw / 2, top, pw, ph, Math.min(22, rh * 0.6), { alpha: 0.92 });
    if (rows.length === 0) this.text('NO SCORES YET', W / 2, H * 0.4, rh * 0.8, 'rgba(255,255,255,0.75)');
    rows.forEach((r, i) => {
      const y = H * 0.26 + i * rh;
      this.text(String(i + 1).padStart(2, ' ') + '.', W / 2 - 150, y, rh * 0.65, 'rgba(255,255,255,0.7)', 'right');
      this.text(r.key, W / 2 - 110, y, rh * 0.65, PLAYER_TEXT_CSS[i % 4], 'left', 900);
      this.text(String(r.value), W / 2 + 160, y, rh * 0.65, UI.gold, 'right');
    });
  }
}
