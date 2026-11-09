// loading.js - the loading screen (UC-20): one of the cars for sale, in its own listing photo, behind the progress bar while the
// lot (or the track) loads, and a small shooter to play while it does. Loaded before app.js (index.html), so the photo and the
// game are there while three.js is still on its way; app.js calls loadingShow() when the track starts loading and loadingDone()
// when the lot or the race is ready. loadingDone() closes the screen at once, unless a game is running: then it says the lot is
// ready and closes on Enter or a click, so nobody is pulled out mid-game (UC-20.3) and a race never counts down behind it.
// The photos are the dealer's own (data/photos.json, tools/photos.py: shown from their image server and credited); a photo list
// that does not load is SAID on the screen, never swapped for a stand-in picture (UC-20.1a).
// UC-24: the game starts by itself, idling (it cannot be lost) until its first key, click, touch or pad press; a screen whose game
// was never touched closes the moment loading is done. Game over shows the shared board (scores.js) with a name box.
import { ScoreBoard, HOUSE_NAME, checkName, ranked, qualifies, boardHTML, lastName, keepName } from './scores.js';
const $ = (id) => document.getElementById(id);
// AUTHORED: the house score on the rocks board (the owner's ask 11-07: R.J.Thompson on every board); about four big rocks shot
// all the way down (20 + 2 x 50 + 4 x 100 = 520 each), so a first game has something to beat
const ROCKS_HOUSE = { name: HOUSE_NAME, score: 2000, at: '' };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const money = (v) => '$' + Number(v).toLocaleString('en-CA');
const V = (f) => (f && f.kind !== 'ABSENT' ? f.value : null);

/** the screen itself: the photo and its caption, the play button, the "ready" banner; owns nothing of the progress bar
 *  (app.js showProgress writes #bar and #lmb as the bytes arrive) */
class LoadingScreen {
  constructor() {
    this.el = $('loading');
    this.done = null;                                  // the pending loadingDone() promise's resolve, while "ready" waits
    this.data = Promise.all(['photos.json', 'listings.json'].map((f) => fetch('data/' + f).then((r) => {
      if (!r.ok) throw new Error('data/' + f + ': HTTP ' + r.status); return r.json(); })));
    this.board = fetch('data/scores.json').then((r) => { if (!r.ok) throw new Error('data/scores.json: HTTP ' + r.status); return r.json(); }).then((c) => new ScoreBoard(c));
    this.board.catch(() => { /* said at game over, where the board is read */ });
    this.game = null;
    if (!this.el) return;                              // no GPU: app.js removed the screen
    this.el.insertAdjacentHTML('afterbegin', '<div id="lphoto" aria-hidden="true"></div><canvas id="lgame" aria-label="Rock shooter: keep the rocks off the lot"></canvas>');
    $('lbox').insertAdjacentHTML('beforeend', '<button id="lplay" type="button" hidden>Play while you wait</button><div id="lready" hidden><b>The lot is ready</b><button id="lenter" type="button">Enter the lot ⏎</button></div>');
    this.el.insertAdjacentHTML('beforeend', '<div id="lcap"></div><div id="lhs" hidden role="dialog" aria-label="High scores"><b id="lhst"></b><div id="lhsrows"></div>' +
      '<form id="lhsform" hidden><label for="lhsname">Your name for the board</label><div><input id="lhsname" maxlength="16" autocomplete="nickname" spellcheck="false"><button type="submit">Save</button></div></form>' +
      '<p id="lhsmsg" aria-live="polite"></p><button id="lhsagain" type="button">Play again ⏎</button></div>');
    $('lplay').addEventListener('click', () => this.play());
    $('lenter').addEventListener('click', () => this.close());
    $('lhsagain').addEventListener('click', () => this.again());
    $('lhsform').addEventListener('submit', (e) => { e.preventDefault(); this.save(); });
    // the game's keys, caught here at load (before app.js adds its own) in the capture phase, so while the game runs the lot
    // behind it never sees them: 11-06 a game built later let app.js take ArrowRight (the next car) and Enter (a test drive)
    const key = (e) => { if (this.game) this.game.onKey(e); };
    addEventListener('keydown', key, true); addEventListener('keyup', key, true);
    addEventListener('resize', () => this.fitCaption());
    this.stillness();
    const linked = location.hash.match(/car=([a-z0-9_]+)/);
    this.photo(linked && linked[1]);
    this.play();                                       // UC-24.1: running at once, no button to press
  }
  /** a car's first listing photo (the one its listing leads with), the large copy where tools/photos.py proved one; a key with no
   *  photos (a template car, the unlisted S7) shows one of the cars for sale instead, named as such */
  async photo(key) {
    let P, L;
    try { [P, L] = await this.data; } catch (e) { $('lcap').textContent = 'Photo not loaded: ' + e.message; return; }
    const keys = Object.keys(P.cars);
    const own = key && P.cars[key];
    const k = own ? key : keys[Math.floor(Math.random() * keys.length)];
    const car = L.cars.find((c) => c.key === k), ph = P.cars[k].photos[0];
    const img = new Image();
    img.onload = () => { const el = $('lphoto'); if (!el) return; el.style.backgroundImage = 'url("' + img.src + '")'; el.classList.remove('on'); void el.offsetWidth; el.classList.add('on'); };
    img.onerror = () => { $('lcap').textContent = 'Photo not loaded: ' + img.src; };
    img.src = ph.large || ph.full;
    const price = car && V(car.price) !== null ? ' · ' + money(V(car.price)) : '';
    $('lcap').innerHTML = (own ? '' : 'On the lot now: ') + '<b>' + esc(car ? car.display.value : k) + '</b>' + esc(price) +
      ' · <a href="' + esc(P.cars[k].listing) + '" target="_blank" rel="noopener">' + esc(P.cars[k].credit.replace('Photos', 'Photo')) + '</a>';
    this.fitCaption();
  }
  /** UC-44.1 while the game runs the caption sits at the top and the title box under it: --lcapb is the caption's bottom, measured
   *  (upright on a 390 px phone the caption takes two lines and ran into the title, shots/lotpass/b0_port_load.png) */
  fitCaption() {
    const c = $('lcap');
    if (!this.el || !c || !this.el.classList.contains('playing')) return;   // not playing: the caption is at the bottom, the box in the middle
    this.el.style.setProperty('--lcapb', Math.ceil(c.getBoundingClientRect().bottom) + 'px');
  }
  /** UC-44 alternates: the Motion pill off (app.js keeps it as hoc.motion) or the OS's reduced motion: the photo does not drift and the
   *  bar's sheen does not run (#loading.still, index.html) */
  stillness() {
    let off = false;
    try { off = localStorage.getItem('hoc.motion') === 'off'; } catch (e) { /* storage blocked: the pill's choice was not kept either */ }
    this.el.classList.toggle('still', off || matchMedia('(prefers-reduced-motion: reduce)').matches);
  }
  show(text, key) {
    if (!this.el) return;
    this.el.style.display = 'grid'; this.el.classList.remove('ready'); $('lready').hidden = true;
    this.stillness();                                  // the Motion pill may have changed on the lot
    $('lt').textContent = text;
    this.photo(key);
    this.play();                                       // UC-24.1
  }
  /** loading is over: close now, or (a game running) say so and close when the player says */
  finished() {
    if (!this.el) return Promise.resolve();
    if (!this.game || !this.game.running || !this.game.touched) { this.close(); return Promise.resolve(); }   // UC-24.3: not played
    this.el.classList.add('ready'); $('lready').hidden = false; $('lt').textContent = 'Ready.';
    return new Promise((res) => { this.done = res; });
  }
  close() {
    if (this.game) this.game.stop();
    $('lhs').hidden = true;
    this.el.style.display = 'none'; this.el.classList.remove('playing', 'ready');
    if (this.done) { const d = this.done; this.done = null; d(); }
  }
  /** Esc in the game: back to the loading screen, or into the lot if it is already ready */
  quit() {
    this.game.stop(); $('lhs').hidden = true;
    if (this.el.classList.contains('ready')) { this.close(); return; }
    this.el.classList.remove('playing'); $('lplay').hidden = false;
  }
  play() {
    if (!this.game) this.game = new RingShooter($('lgame'), this);
    this.el.classList.add('playing'); $('lplay').hidden = true; $('lhs').hidden = true;
    this.game.start(); this.fitCaption();
  }
  /** UC-24.4 game over: the shared board with the house row, and a name box when the score makes its top ten */
  async gameOver(score) {
    const last = this.last = { score, at: new Date().toISOString() };
    $('lhst').textContent = 'Game over · ' + score.toLocaleString('en-CA');
    $('lhsform').hidden = true; $('lhsmsg').textContent = 'Reading the board…'; $('lhsrows').innerHTML = this.rows([]);
    $('lhs').hidden = false;
    let rows;
    try { this.scores = await this.board; rows = await this.scores.top('rocks'); }
    catch (e) { if (this.last === last) $('lhsmsg').textContent = e.message + '. Your score is not on it.'; return; }   // UC-24.4a: said, kept nowhere else
    if (this.last !== last) return;                     // a new game started while the board was on its way
    $('lhsrows').innerHTML = this.rows(rows);
    if (score > 0 && qualifies(rows, ROCKS_HOUSE, false, score)) {
      $('lhsmsg').textContent = 'You made the top ten.'; $('lhsform').hidden = false;
      const box = $('lhsname'); box.value = lastName(); box.focus(); box.select();
    } else $('lhsmsg').textContent = '';
  }
  rows(rows, mine) { return boardHTML(ranked(rows, ROCKS_HOUSE, false), (r) => r.score.toLocaleString('en-CA'), mine); }
  async save() {
    const c = checkName($('lhsname').value);
    if (!c.ok) { $('lhsmsg').textContent = c.why; return; }   // UC-24.4b
    const entry = { name: c.name, score: this.last.score, at: this.last.at };
    $('lhsform').hidden = true; $('lhsmsg').textContent = 'Saving…';
    try { const rows = await this.scores.submit('rocks', entry); keepName(c.name); $('lhsrows').innerHTML = this.rows(rows, entry); $('lhsmsg').textContent = 'Saved. You are on the board.'; }
    catch (e) { $('lhsform').hidden = false; $('lhsmsg').textContent = e.message + '. Not saved: try again.'; }
  }
  again() { $('lhs').hidden = true; this.last = null; if (this.game) { this.game.reset(); this.game.touched = true; this.el.classList.add('touched'); } }
}

/** the game: your ship rides a ring round the lot's badge and shoots inward; rocks fly out of the middle and split when hit.
 *  Keys: left/right or A/D to move round, Space (or up / W) to fire, Esc to stop; a mouse or a finger: the ship goes where you
 *  point and fires while you press; a gamepad: the left stick or the pad, A to fire. Every number below is AUTHORED, for feel.
 *  Until its first input (touched) it idles: the ship circles and fires on its own, rocks pass through it, nothing is scored. */
class RingShooter {
  constructor(canvas, screen) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.screen = screen;
    this.running = false; this.raf = 0;
    this.keys = new Set(); this.pointer = null;
    this.best = 0; try { this.best = Number(localStorage.getItem('hoc.rocks.best')) || 0; } catch (e) { /* a private window: no best kept */ }
    // while it runs, the game's keys are its own: the lot behind it never sees them (LoadingScreen hands them here, stopped)
    const OWN = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', 'A', 'D', 'W', 'S', ' ', 'Enter', 'Escape'];
    this.onKey = (e) => {
      // the board's name box: its keys type the name and reach nothing behind it (11-07: an "m" muted the lot, an Enter drove)
      if (e.target && e.target.id === 'lhsname') { e.stopImmediatePropagation(); if (e.type === 'keydown' && e.key === 'Enter') { e.preventDefault(); this.screen.save(); } return; }
      if (!this.running || !OWN.includes(e.key)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type === 'keydown') {
        if (e.key === 'Escape') { this.screen.quit(); return; }
        if (e.key === 'Enter') { if (this.screen.el.classList.contains('ready')) { this.screen.close(); return; } if (this.over) { this.screen.again(); return; } }
        this.wake();
        this.keys.add(e.key.toLowerCase());
      } else this.keys.delete(e.key.toLowerCase());
    };
    const at =(e) => { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => { if (this.over) { this.screen.again(); return; } this.wake(); this.pointer = Object.assign(at(e), { down: true }); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.pointer || e.pointerType === 'mouse') this.pointer = Object.assign(at(e), { down: this.pointer ? this.pointer.down : false }); });
    const up = () => { if (this.pointer) this.pointer.down = false; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    this.resize = () => { const d = Math.min(devicePixelRatio || 1, 2); this.cv.width = innerWidth * d; this.cv.height = innerHeight * d; this.dpr = d; };
    addEventListener('resize', this.resize);
  }
  start() { this.resize(); this.reset(); this.touched = false; this.screen.el.classList.remove('touched'); this.running = true; this.last = performance.now(); cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame((t) => this.frame(t)); }
  /** the first input: from here it is a game (scored, losable), started fresh */
  wake() { if (!this.touched) { this.touched = true; this.reset(); this.screen.el.classList.add('touched'); } }   // UC-44.1: the photo steps back for the game (index.html)
  stop() { this.running = false; cancelAnimationFrame(this.raf); this.keys.clear(); }
  reset() {
    this.angle = Math.PI / 2; this.shots = []; this.rocks = []; this.bits = []; this.score = 0; this.lives = 3; this.hurt = 0;
    this.cool = 0; this.t = 0; this.spawn = 0.6; this.over = false;
  }
  /** the ring's middle and radius, under the loading bar (#lbox's bottom, read from the page) and over the score lines */
  layout() {
    const s = this.dpr, W = this.cv.width, H = this.cv.height, box = $('lbox');
    const top = (box && !this.screen.el.classList.contains('ready') ? box.getBoundingClientRect().bottom : 0) * s + 16 * s, bottom = H - 84 * s;
    return { cx: W / 2, cy: (top + bottom) / 2, R: Math.max(60 * s, Math.min(W * 0.42, (bottom - top) / 2 - 14 * s)) };
  }
  rock(x, y, size, dir) {
    const s = this.dpr, r = [0, 11, 18, 28][size] * s, n = 9 + size, sp = (46 + Math.random() * 46 + this.t * 0.9) * s / (size === 3 ? 1.25 : 1);
    const pts = Array.from({ length: n }, (_, i) => [Math.cos(i / n * Math.PI * 2), Math.sin(i / n * Math.PI * 2), 0.72 + Math.random() * 0.36]);
    this.rocks.push({ x, y, vx: Math.cos(dir) * sp, vy: Math.sin(dir) * sp, r, size, pts, rot: 0, spin: (Math.random() - 0.5) * 2 });
  }
  frame(t) {
    if (!this.running) return;
    const dt = Math.min(0.05, (t - this.last) / 1000); this.last = t;
    this.step(dt); this.draw();
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }
  step(dt) {
    if (this.over) return;
    const s = this.dpr, { cx, cy, R } = this.layout();
    this.t += dt; this.hurt = Math.max(0, this.hurt - dt); this.cool -= dt;
    // move: keys, then a gamepad, then the pointer (the ship goes to the angle it points at)
    let turn = (this.keys.has('arrowright') || this.keys.has('d') ? 1 : 0) - (this.keys.has('arrowleft') || this.keys.has('a') ? 1 : 0);
    let fire = this.keys.has(' ') || this.keys.has('arrowup') || this.keys.has('w');
    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected) : null;
    if (pad) {
      const ax = pad.axes[0] || 0; if (Math.abs(ax) > 0.2) turn = ax;
      if (pad.buttons[14] && pad.buttons[14].pressed) turn = -1; if (pad.buttons[15] && pad.buttons[15].pressed) turn = 1;
      if ((pad.buttons[0] && pad.buttons[0].pressed) || (pad.buttons[7] && pad.buttons[7].value > 0.3)) fire = true;
      if (turn || fire) this.wake();
    }
    if (!this.touched) { turn = 0.35; fire = true; }    // idling: it circles and fires by itself
    this.angle += turn * 3.4 * dt;
    if (this.pointer && (this.pointer.down || !turn)) {
      const want = Math.atan2(this.pointer.y * s - cy, this.pointer.x * s - cx);
      let d = ((want - this.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      this.angle += Math.max(-6 * dt, Math.min(6 * dt, d));
      if (this.pointer.down) fire = true;
    }
    const sx = cx + Math.cos(this.angle) * R, sy = cy + Math.sin(this.angle) * R;
    if (fire && this.cool <= 0) { this.cool = 0.17; this.shots.push({ x: sx, y: sy, vx: -Math.cos(this.angle) * 560 * s, vy: -Math.sin(this.angle) * 560 * s, life: R / (560 * s) }); }
    // rocks out of the middle, sooner as the game goes on
    this.spawn -= dt;
    if (this.spawn <= 0) { this.rock(cx, cy, Math.random() < 0.55 ? 3 : 2, Math.random() * Math.PI * 2); this.spawn = Math.max(0.45, 1.6 - this.t * 0.02); }
    for (const p of this.shots) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    for (const r of this.rocks) { r.x += r.vx * dt; r.y += r.vy * dt; r.rot += r.spin * dt; }
    for (const b of this.bits) { b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt; }
    // a shot through a rock: the rock splits in two (the smallest ones break up), the score counts small rocks higher
    for (const p of this.shots) {
      if (p.life <= 0) continue;
      const r = this.rocks.find((q) => !q.dead && Math.hypot(q.x - p.x, q.y - p.y) < q.r + 3 * s);
      if (!r) continue;
      p.life = 0; r.dead = true; if (this.touched) this.score += [0, 100, 50, 20][r.size];
      for (let i = 0; i < 8; i++) { const a = Math.random() * Math.PI * 2, v = (60 + Math.random() * 140) * s; this.bits.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 }); }
      if (r.size > 1) { const a = Math.atan2(r.vy, r.vx); this.rock(r.x, r.y, r.size - 1, a + 0.5); this.rock(r.x, r.y, r.size - 1, a - 0.5); }
    }
    // a rock that reaches the ring where the ship is costs a life; past the ring it is gone
    for (const r of this.rocks) {
      if (r.dead) continue;
      if (this.touched && this.hurt <= 0 && Math.hypot(r.x - sx, r.y - sy) < r.r + 12 * s) {
        r.dead = true; this.lives--; this.hurt = 1.4;
        if (this.lives <= 0) {
          this.over = true;
          if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('hoc.rocks.best', String(this.best)); } catch (e) { /* not kept */ } }
          this.screen.gameOver(this.score);               // UC-24.4
        }
      }
      if (Math.hypot(r.x - cx, r.y - cy) > R + 80 * s) r.dead = true;
    }
    this.shots = this.shots.filter((p) => p.life > 0); this.rocks = this.rocks.filter((r) => !r.dead); this.bits = this.bits.filter((b) => b.life > 0);
  }
  draw() {
    const g = this.g, s = this.dpr, W = this.cv.width, H = this.cv.height, { cx, cy, R } = this.layout();
    const css = getComputedStyle(document.documentElement), accent = css.getPropertyValue('--accent').trim() || '#f25827', soft = css.getPropertyValue('--accent-soft').trim() || '#ff9b74';
    g.clearRect(0, 0, W, H);
    // the ring and the badge in the middle the rocks come out of
    g.lineWidth = 2 * s; g.strokeStyle = 'rgba(242,88,39,.35)'; g.setLineDash([6 * s, 10 * s]); g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(10,10,10,.75)'; g.strokeStyle = accent; g.beginPath(); g.arc(cx, cy, 30 * s, 0, Math.PI * 2); g.fill(); g.stroke();
    g.fillStyle = '#fefefe'; g.font = '800 ' + 13 * s + 'px "Open Sans", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('HOC', cx, cy);
    g.strokeStyle = '#c9cfd3'; g.lineWidth = 1.6 * s;
    for (const r of this.rocks) {
      g.beginPath();
      r.pts.forEach(([x, y, k], i) => { const c = Math.cos(r.rot), sn = Math.sin(r.rot), px = r.x + (x * c - y * sn) * r.r * k, py = r.y + (x * sn + y * c) * r.r * k; i ? g.lineTo(px, py) : g.moveTo(px, py); });
      g.closePath(); g.fillStyle = 'rgba(50,57,59,.7)'; g.fill(); g.stroke();
    }
    g.fillStyle = soft; for (const p of this.shots) { g.beginPath(); g.arc(p.x, p.y, 3 * s, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = accent; for (const b of this.bits) { g.globalAlpha = Math.max(0, b.life * 2); g.fillRect(b.x - 1.5 * s, b.y - 1.5 * s, 3 * s, 3 * s); } g.globalAlpha = 1;
    // the ship: a wedge on the ring, nose to the middle, blinking while it is hurt
    if (!this.over && (this.hurt <= 0 || Math.floor(this.hurt * 10) % 2)) {
      const sx = cx + Math.cos(this.angle) * R, sy = cy + Math.sin(this.angle) * R, a = this.angle + Math.PI;
      g.save(); g.translate(sx, sy); g.rotate(a); g.fillStyle = accent; g.strokeStyle = '#fff'; g.lineWidth = 1.5 * s;
      g.beginPath(); g.moveTo(16 * s, 0); g.lineTo(-10 * s, -10 * s); g.lineTo(-5 * s, 0); g.lineTo(-10 * s, 10 * s); g.closePath(); g.fill(); g.stroke(); g.restore();
    }
    // the score, the best, the lives; and the end
    g.textAlign = 'left'; g.textBaseline = 'top'; g.fillStyle = '#fefefe'; g.font = '700 ' + 15 * s + 'px "Open Sans", system-ui, sans-serif';
    const coarse = matchMedia('(pointer:coarse)').matches;
    if (!this.touched) {                                // idling: the invitation, in the middle of the field (UC-48.1)
      // UC-48.1 (the owner 11-09: "Making loading game more apparent.. play while it loads"): it was one small line in the corner. Now the
      // field's own middle, under the house disc, says it, with this device's controls; it breathes unless the visitor asked for less motion
      const still = matchMedia('(prefers-reduced-motion: reduce)').matches, pulse = still ? 1 : 0.75 + 0.25 * Math.sin(performance.now() / 350);
      const big = Math.min(30 * s, W / 13), y0 = cy + 44 * s;
      g.save(); g.textAlign = 'center'; g.textBaseline = 'top'; g.shadowColor = 'rgba(0,0,0,.85)'; g.shadowBlur = 8 * s;
      g.globalAlpha = pulse; g.fillStyle = '#fff'; g.font = '800 ' + big + 'px "Open Sans", system-ui, sans-serif'; g.fillText('PLAY WHILE IT LOADS', cx, y0);
      g.fillStyle = soft; g.font = '800 ' + Math.min(15 * s, W / 26) + 'px "Open Sans", system-ui, sans-serif';
      g.fillText(coarse ? 'TAP ANYWHERE TO START' : 'PRESS ← → OR CLICK TO START', cx, y0 + big * 1.35);
      g.restore(); g.textAlign = 'left'; g.textBaseline = 'top';
    } else g.fillText('SCORE ' + this.score.toLocaleString('en-CA'), 18 * s, H - 70 * s);
    g.fillStyle = '#a3abb0'; g.font = '600 ' + 12 * s + 'px "Open Sans", system-ui, sans-serif';
    g.fillText('YOUR BEST ' + Math.max(this.best, this.score).toLocaleString('en-CA') + (this.touched ? '   ' + '▲'.repeat(Math.max(0, this.lives)) : ''), 18 * s, H - 48 * s);
    g.fillText(coarse ? 'Drag to aim · hold to fire' : '← → or A D to move · Space to fire · Esc to stop', 18 * s, H - 30 * s);
  }
}

const screen = new LoadingScreen();
window.HOC_LOADING = screen;                           // for the page check (test/page_check.py UC-20) and devtools
/** the track (or anything) starts loading: the screen, with this car's own photo where it has one */
export function loadingShow(text, key) { screen.show(text, key); }
/** the lot or the race is ready: resolves when the screen has closed (at once, unless a game is being played) */
export function loadingDone() { return screen.finished(); }
