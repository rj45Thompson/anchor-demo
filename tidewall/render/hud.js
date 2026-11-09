// hud.js - the 2D layer over the WebGPU canvas: the in-match HUD (round and level, the phase and its timer, team lives and score,
// the big banner, one card per player with their colour, score, cannons to place, the piece they hold and why their last command
// was refused), the tag over each hero, and every menu screen (title, join/setup, pause, the continue-or-give-up screen, results,
// initials, high scores). It only READS the ported HudViewModel, MenuModel and model; it decides nothing.
import { Phase, Screen, MenuModel, HudViewModel, ItemBought, ItemNames } from '../core/index.js';
import { PLAYER_CSS, PLAYER_TEXT_CSS, PLAYER_INK_CSS, HUD_PANEL_CSS } from './look.js';

const WARN = '#ffd24a';                                   // AUTHORED: the warning colour of a refusal, a stun
const NOTE_SECONDS = 2;                                   // AUTHORED: how long a fresh refusal or purchase takes over a card's line
const ITEM_WORDS = Object.freeze({ metal: 'METAL PIECE', trap: 'TRAP', bombPack: 'BOMB PACK', bigBomb: 'BIG BOMB' });
const FONT = '"Trebuchet MS", "Segoe UI", system-ui, sans-serif';
const PHASE_WORD = { [Phase.Claim]: 'CLAIM', [Phase.Cannons]: 'CANNONS', [Phase.Battle]: 'BATTLE', [Phase.Repair]: 'REPAIR',
                     [Phase.Score]: 'SCORE', [Phase.GameOver]: 'GAME OVER', [Phase.Victory]: 'VICTORY', [Phase.Decide]: 'CONTINUE?' };

export class Hud {
  constructor(canvas, title) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('hud.js: the HUD canvas gave no 2D context');
    this.title = title;
    this.said = new Map();         // slot -> the last lastMessage seen, to tell a new one
    this.notes = new Map();       // slot -> { text, at, buy }: the latest refusal or purchase on a card, shown for NOTE_SECONDS in a bright colour
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
  hit(h, x0, y0, x1, y1) { this.hits.push(Object.assign(h, { x0, y0, x1, y1 })); }

  resize(w, h, dpr) { this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr); this.dpr = dpr; this.cssW = w; this.cssH = h; }

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
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, W, H);
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
      case Screen.Setup: this.drawSetup(menu, seconds, view.menuCover || []); break;
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
      this.panel(p.x - 16, p.y - 11, 32, 22, 11, PLAYER_CSS[seat], 'rgba(255,255,255,0.9)');
      this.text(s, p.x, p.y + 1, 13, PLAYER_INK_CSS[seat], 'center', 900, false);
    }
  }

  /** Where the match HUD draws its parts on a W x H (CSS px) screen with n player cards: the top bar's height and the card row's
   *  top. The camera keeps its frame between the two (renderer.freeRect), so these are the numbers drawMatch draws with. */
  static matchLayout(W, H, n) {
    const u = Math.min(W / 100, H / 60), barH = Math.max(40, u * 5.2), cardH = Math.max(64, u * 8.5);
    return { u, barH, cardH, cardW: n > 0 ? Math.min(250, (W - 30) / n - 10) : 0, cardsTop: n > 0 ? H - cardH - 12 : H };
  }

  /** A chevron at the free rect's edge for each enemy ship outside it, pointing at the ship (the private host's ShipMarks rule:
   *  a ship the players cannot see gets a red chevron at the band's edge; graphics round 3). marks: [{ x, y } screen px]. */
  shipMarks(marks, free, seconds) {
    const c = this.ctx, E = 18;
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
    const n = hud.players.filter((p) => p.present).length, L = Hud.matchLayout(W, H, n), u = L.u;
    // the top bar: round + level on the left, the phase and its timer in the middle, lives and team score on the right
    const barH = L.barH;
    const g = this.ctx.createLinearGradient(0, 0, 0, barH * 1.4); g.addColorStop(0, 'rgba(8,30,52,0.72)'); g.addColorStop(1, 'rgba(8,30,52,0)');
    this.ctx.fillStyle = g; this.ctx.fillRect(0, 0, W, barH * 1.4);
    const fs = Math.max(14, u * 2.1);
    const narrow = W < 640;                                   // a phone held upright: the short form, so nothing runs into the phase chip
    this.text(narrow ? 'R' + hud.round + ' · L' + hud.level : 'ROUND ' + hud.round + '  ·  LEVEL ' + hud.level + (hud.mapName ? '  ·  ' + hud.mapName : ''), narrow ? 12 : 18, barH / 2, fs, '#fff', 'left');
    const lives = Math.max(0, hud.lives);
    let lx = W - 18;
    this.text('SCORE ' + hud.teamScore, lx, barH / 2, fs, '#ffe08a', 'right');
    this.font(fs); lx -= this.ctx.measureText('SCORE ' + hud.teamScore).width + 26;
    for (let i = 0; i < lives; i++) { this.shield(lx - i * (fs * 1.2), barH / 2, fs * 0.5); }
    // phase chip and the timer ring
    const word = PHASE_WORD[hud.phase];
    if (word === undefined) throw new Error('hud.js: no word for phase ' + hud.phase);
    const cx = W / 2, chipW = narrow ? Math.max(118, fs * 7.5) : Math.max(150, fs * 9);
    this.panel(cx - chipW / 2, barH * 0.16, chipW, barH * 0.7, barH * 0.35, 'rgba(255,255,255,0.14)', 'rgba(255,255,255,0.5)');
    this.text(word, cx - (hud.secondsTotal > 0 ? fs * 0.9 : 0), barH / 2, fs * 1.05, '#fff');
    if (hud.secondsTotal > 0 && !m.ended) {
      const rx = cx + chipW / 2 - barH * 0.36, ry = barH / 2, rr = barH * 0.27, k = hud.secondsLeft / hud.secondsTotal, c = this.ctx;
      c.beginPath(); c.arc(rx, ry, rr, 0, Math.PI * 2); c.fillStyle = 'rgba(0,0,0,0.35)'; c.fill();
      c.beginPath(); c.moveTo(rx, ry); c.arc(rx, ry, rr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); c.closePath();
      c.fillStyle = hud.secondsLeft <= 5 ? '#ff5b4a' : '#7fe0ff'; c.fill();
      this.text(String(hud.secondsLeft), rx, ry + 1, rr * 1.05, '#fff', 'center', 900);
    }
    // the banner: big for a moment after it changes
    const since = Number(m.tick - hud.bannerTick);
    if (banner && hud.banner && since >= 0 && since < hud.bannerTicks) {
      const k = since / hud.bannerTicks, a = Math.min(1, k * 8, (1 - k) * 5), pop = 1 + 0.25 * Math.max(0, 1 - k * 10);
      this.ctx.globalAlpha = a;
      const by = H * 0.36, bs = Math.max(26, u * 5.4) * pop;
      this.text(hud.banner, W / 2, by, bs, '#fff', 'center', 900);
      if (hud.subtitle) this.text(hud.subtitle, W / 2, by + bs * 0.95, bs * 0.42, '#ffe08a');
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
    this.panel(x, y, w, h, 12, HUD_PANEL_CSS, fresh ? (note.buy ? '#ffffff' : WARN) : col);
    c.fillStyle = col; c.beginPath(); c.roundRect(x, y, 10, h, [12, 0, 0, 12]); c.fill();
    const fs = Math.max(13, h * 0.24);
    this.text('P' + (seat + 1), x + 22, y + h * 0.28, fs * 1.2, PLAYER_TEXT_CSS[seat], 'left', 900);
    if (ctl.isBot(s)) this.text('BOT', x + 22 + fs * 1.9, y + h * 0.3, fs * 0.62, 'rgba(255,255,255,0.65)', 'left', 700, false);
    this.text(String(p.score), x + w - 12, y + h * 0.28, fs, '#fff', 'right');
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
  toast(text, a) {
    const c = this.ctx; c.save(); c.globalAlpha = a;
    this.font(16, 700); const w = c.measureText(text).width + 36;
    this.panel(this.cssW / 2 - w / 2, this.cssH * 0.7, w, 34, 17, 'rgba(10,24,40,0.82)', 'rgba(255,255,255,0.35)');
    this.text(text, this.cssW / 2, this.cssH * 0.7 + 17, 16, '#ffffff', 'center', 700, false);
    c.restore();
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
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60);
    this.dim(behind ? 0.35 : 0.2);
    this.logo(H * 0.34, Math.max(48, u * 11), seconds);
    if (menu.inDemo) this.text('DEMO', W / 2, H * 0.52, Math.max(18, u * 3), '#ffe08a');
    if (Math.sin(seconds * 4) > -0.4) this.text('PRESS ANY BUTTON', W / 2, H * 0.62, Math.max(18, u * 3.2), '#fff');
    this.text('Defend your castle with up to three friends', W / 2, H * 0.7, Math.max(13, u * 1.9), 'rgba(255,255,255,0.85)', 'center', 700);
  }

  /** The join screen. cover: DOM rects drawn over the canvas that the seats and rows must stay clear of (QRLAND, round 5: the
   *  phone room's QR panel, which PhonePad places at a fixed corner at a fixed size, and the how-to card); measured by the page
   *  each frame (main.js menuCover). A seat or row band that would cross one moves into the widest gap beside it, or below it
   *  when that gap is too narrow; with no cover crossed the layout is the centred one. */
  drawSetup(menu, seconds, cover) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60);
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
      this.panel(x, y, cw, ch, 14, j ? PLAYER_CSS[s] : 'rgba(255,255,255,0.08)', j ? '#fff' : 'rgba(255,255,255,0.35)');
      this.text('P' + (s + 1), x + cw / 2, y + ch * 0.34, ch * 0.3, j ? PLAYER_INK_CSS[s] : 'rgba(255,255,255,0.6)', 'center', 900, !j);
      this.text(j ? 'READY' : 'PRESS TO JOIN', x + cw / 2, y + ch * 0.72, ch * 0.15, j ? PLAYER_INK_CSS[s] : '#fff', 'center', 800, false);
      this.hit({ kind: 'seat', seat: s }, x, y, x + cw, y + ch);
      x += cw + 12;
    }
    // the rows end above the foot and above any cover below the seats that leaves them no ROWS_NEED gap (a how-to card across a
    // portrait phone); beside a cover they centre in the widest gap
    let floor = H - FOOT;
    for (const c of cover) if (c.top > y + ch) { const g = gapAt(c.top, c.bottom); if (g[1] - g[0] < ROWS_NEED) floor = Math.min(floor, c.top - GAP); }
    const rows = MenuModel.SetupRows, rh = Math.min(Math.max(30, u * 4.6), (floor - y - ch) / 6.6), top = y + ch + rh;
    let half = Math.min(230, W / 2 - 10), cx = W / 2;            // the rows' half width (narrow on a phone) and their centre
    const ry0 = top - rh * 0.45, ry1 = top + (rows.length - 1) * rh + rh * 0.45;
    if (crosses(ry0, ry1, cx - half, cx + half)) { const g = gapAt(ry0, ry1); cx = (g[0] + g[1]) / 2; half = Math.min(half, (g[1] - g[0]) / 2); }
    const lab = half - 30;                                       // where a label starts and a value ends, from the centre
    for (let i = 0; i < rows.length; i++) {
      const sel = i === menu.row, yy = top + i * rh, raw = menu.valueOfRow(i);
      const val = i === MenuModel.RowMap ? HudViewModel.pretty(raw) : raw;   // "GullrockIsle" -> "GULLROCK ISLE", as the match's top bar says it
      if (sel) this.panel(cx - half, yy - rh * 0.45, half * 2, rh * 0.9, rh * 0.45, 'rgba(255,255,255,0.2)', '#fff');
      this.text(rows[i], val ? cx - lab : cx, yy, rh * 0.5, sel ? '#fff' : 'rgba(255,255,255,0.75)', val ? 'left' : 'center');
      if (val) this.text((sel ? '◀ ' : '') + val + (sel ? ' ▶' : ''), cx + lab, yy, rh * 0.5, sel ? '#ffe08a' : 'rgba(255,224,138,0.75)', 'right');
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
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60), rh = Math.max(34, u * 5.4);
    this.dim(0.55);
    this.text(head, W / 2, H * 0.3, Math.max(34, u * 7), '#fff', 'center', 900);
    if (sub) this.text(sub, W / 2, H * 0.3 + u * 6, Math.max(14, u * 2.2), '#ffe08a');
    const top = H * 0.46;
    rows.forEach((r, i) => {
      const sel = i === at, yy = top + i * rh;
      if (sel) this.panel(W / 2 - 170, yy - rh * 0.45, 340, rh * 0.9, rh * 0.45, 'rgba(255,255,255,0.22)', '#fff');
      this.text(r, W / 2, yy, rh * 0.52, sel ? '#fff' : 'rgba(255,255,255,0.7)');
      this.hit({ kind: 'row', row: i }, W / 2 - 170, yy - rh * 0.45, W / 2 + 170, yy + rh * 0.45);
    });
  }

  drawDecide(view, seconds) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60), menu = view.menu, hud = view.hud;
    this.dim(0.6);
    this.text(hud.banner, W / 2, H * 0.32, Math.max(30, u * 6), '#fff', 'center', 900);
    if (hud.subtitle) this.text(hud.subtitle, W / 2, H * 0.32 + u * 6.5, Math.max(14, u * 2.4), '#ffe08a');
    const rows = MenuModel.DecideRows, bw = Math.max(170, u * 24), bh = Math.max(56, u * 8.5), y = H * 0.55;
    rows.forEach((r, i) => {
      const sel = i === menu.row, x = W / 2 + (i === 0 ? -bw - 16 : 16);
      this.panel(x, y, bw, bh, bh / 2, sel ? (i === 0 ? '#2fbf71' : '#d9534f') : 'rgba(255,255,255,0.1)', sel ? '#fff' : 'rgba(255,255,255,0.4)');
      this.text(r, x + bw / 2, y + bh / 2, bh * 0.36, '#fff');
      this.hit({ kind: 'row', row: i }, x, y, x + bw, y + bh);
    });
  }

  drawResults(menu, seconds) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60);
    this.dim(0.65);
    this.text(menu.lastWon ? 'VICTORY!' : 'GAME OVER', W / 2, H * 0.34, Math.max(44, u * 10), menu.lastWon ? '#ffe08a' : '#ff8a7a', 'center', 900);
    this.text('TEAM SCORE  ' + menu.pendingScore, W / 2, H * 0.5, Math.max(22, u * 4), '#fff');
    if (Math.sin(seconds * 4) > -0.4) this.text('PRESS A BUTTON', W / 2, H * 0.64, Math.max(16, u * 2.6), 'rgba(255,255,255,0.85)');
  }

  drawInitials(menu, seconds) {
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60), bs = Math.max(64, u * 12);
    this.dim(0.7);
    this.text('NEW HIGH SCORE', W / 2, H * 0.26, Math.max(32, u * 6.5), '#ffe08a', 'center', 900);
    this.text(String(menu.pendingScore), W / 2, H * 0.37, Math.max(22, u * 4), '#fff');
    for (let i = 0; i < 3; i++) {
      const x = W / 2 + (i - 1) * (bs + 16) - bs / 2, y = H * 0.48, sel = i === menu.initialsAt;
      this.panel(x, y, bs, bs * 1.15, 14, sel ? 'rgba(255,255,255,0.25)' : 'rgba(255,255,255,0.08)', sel ? '#fff' : 'rgba(255,255,255,0.4)');
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
    const W = this.cssW, H = this.cssH, u = Math.min(W / 100, H / 60), rh = Math.max(24, u * 3.6);
    this.dim(0.7);
    this.text('HIGH SCORES', W / 2, H * 0.14, Math.max(32, u * 6.5), '#fff', 'center', 900);
    const rows = menu.highScores.rows;
    if (rows.length === 0) this.text('NO SCORES YET', W / 2, H * 0.4, rh * 0.8, 'rgba(255,255,255,0.75)');
    rows.forEach((r, i) => {
      const y = H * 0.26 + i * rh;
      this.text(String(i + 1).padStart(2, ' ') + '.', W / 2 - 150, y, rh * 0.65, 'rgba(255,255,255,0.7)', 'right');
      this.text(r.key, W / 2 - 110, y, rh * 0.65, PLAYER_TEXT_CSS[i % 4], 'left', 900);
      this.text(String(r.value), W / 2 + 160, y, rh * 0.65, '#fff', 'right');
    });
  }
}
