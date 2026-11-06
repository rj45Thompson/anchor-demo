// loading.js - the loading screen (UC-20): one of the cars for sale, in its own listing photo, behind the progress bar while the
// lot (or the track) loads, and a small shooter to play while it does. Loaded before app.js (index.html), so the photo and the
// game are there while three.js is still on its way; app.js calls loadingShow() when the track starts loading and loadingDone()
// when the lot or the race is ready. loadingDone() closes the screen at once, unless a game is running: then it says the lot is
// ready and closes on Enter or a click, so nobody is pulled out mid-game (UC-20.3) and a race never counts down behind it.
// The photos are the dealer's own (data/photos.json, tools/photos.py: shown from their image server and credited); a photo list
// that does not load is SAID on the screen, never swapped for a stand-in picture (UC-20.1a).
const $ = (id) => document.getElementById(id);
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
    this.game = null;
    if (!this.el) return;                              // no GPU: app.js removed the screen
    this.el.insertAdjacentHTML('afterbegin', '<div id="lphoto" aria-hidden="true"></div><canvas id="lgame" aria-label="Rock shooter: keep the rocks off the lot"></canvas>');
    $('lbox').insertAdjacentHTML('beforeend', '<button id="lplay" type="button">Play while you wait</button><div id="lready" hidden><b>The lot is ready</b><button id="lenter" type="button">Enter the lot ⏎</button></div>');
    this.el.insertAdjacentHTML('beforeend', '<div id="lcap"></div>');
    $('lplay').addEventListener('click', () => this.play());
    $('lenter').addEventListener('click', () => this.close());
    // the game's keys, caught here at load (before app.js adds its own) in the capture phase, so while the game runs the lot
    // behind it never sees them: 11-06 a game built later let app.js take ArrowRight (the next car) and Enter (a test drive)
    const key = (e) => { if (this.game) this.game.onKey(e); };
    addEventListener('keydown', key, true); addEventListener('keyup', key, true);
    const linked = location.hash.match(/car=([a-z0-9_]+)/);
    this.photo(linked && linked[1]);
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
  }
  show(text, key) {
    if (!this.el) return;
    this.el.style.display = 'grid'; this.el.classList.remove('ready'); $('lready').hidden = true; $('lplay').hidden = false;
    $('lt').textContent = text;
    this.photo(key);
  }
  /** loading is over: close now, or (a game running) say so and close when the player says */
  finished() {
    if (!this.el) return Promise.resolve();
    if (!this.game || !this.game.running) { this.close(); return Promise.resolve(); }
    this.el.classList.add('ready'); $('lready').hidden = false; $('lt').textContent = 'Ready.';
    return new Promise((res) => { this.done = res; });
  }
  close() {
    if (this.game) this.game.stop();
    this.el.style.display = 'none'; this.el.classList.remove('playing', 'ready');
    if (this.done) { const d = this.done; this.done = null; d(); }
  }
  /** Esc in the game: back to the loading screen, or into the lot if it is already ready */
  quit() {
    this.game.stop();
    if (this.el.classList.contains('ready')) { this.close(); return; }
    this.el.classList.remove('playing'); $('lplay').hidden = false;
  }
  play() {
    if (!this.game) this.game = new RingShooter($('lgame'), this);
    this.el.classList.add('playing'); $('lplay').hidden = true;
    this.game.start();
  }
}

/** the game: your ship rides a ring round the lot's badge and shoots inward; rocks fly out of the middle and split when hit.
 *  Keys: left/right or A/D to move round, Space (or up / W) to fire, Esc to stop; a mouse or a finger: the ship goes where you
 *  point and fires while you press; a gamepad: the left stick or the pad, A to fire. Every number below is AUTHORED, for feel. */
class RingShooter {
  constructor(canvas, screen) {
    this.cv = canvas; this.g = canvas.getContext('2d'); this.screen = screen;
    this.running = false; this.raf = 0;
    this.keys = new Set(); this.pointer = null;
    this.best = 0; try { this.best = Number(localStorage.getItem('hoc.rocks.best')) || 0; } catch (e) { /* a private window: no best kept */ }
    // while it runs, the game's keys are its own: the lot behind it never sees them (LoadingScreen hands them here, stopped)
    const OWN = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'a', 'd', 'w', 's', 'A', 'D', 'W', 'S', ' ', 'Enter', 'Escape'];
    this.onKey = (e) => {
      if (!this.running || !OWN.includes(e.key)) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.type === 'keydown') {
        if (e.key === 'Escape') { this.screen.quit(); return; }
        if (e.key === 'Enter') { if (this.screen.el.classList.contains('ready')) { this.screen.close(); return; } if (this.over) this.reset(); }
        this.keys.add(e.key.toLowerCase());
      } else this.keys.delete(e.key.toLowerCase());
    };
    const at =(e) => { const r = this.cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    canvas.addEventListener('pointerdown', (e) => { if (this.over) { this.reset(); return; } this.pointer = Object.assign(at(e), { down: true }); canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => { if (this.pointer || e.pointerType === 'mouse') this.pointer = Object.assign(at(e), { down: this.pointer ? this.pointer.down : false }); });
    const up = () => { if (this.pointer) this.pointer.down = false; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    this.resize = () => { const d = Math.min(devicePixelRatio || 1, 2); this.cv.width = innerWidth * d; this.cv.height = innerHeight * d; this.dpr = d; };
    addEventListener('resize', this.resize);
  }
  start() { this.resize(); this.reset(); this.running = true; this.last = performance.now(); cancelAnimationFrame(this.raf); this.raf = requestAnimationFrame((t) => this.frame(t)); }
  stop() { this.running = false; cancelAnimationFrame(this.raf); this.keys.clear(); }
  reset() {
    this.angle = Math.PI / 2; this.shots = []; this.rocks = []; this.bits = []; this.score = 0; this.lives = 3; this.hurt = 0;
    this.cool = 0; this.t = 0; this.spawn = 0.6; this.over = false;
  }
  get R() { return Math.min(this.cv.width, this.cv.height) * 0.36; }
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
    const s = this.dpr, cx = this.cv.width / 2, cy = this.cv.height / 2, R = this.R;
    this.t += dt; this.hurt = Math.max(0, this.hurt - dt); this.cool -= dt;
    // move: keys, then a gamepad, then the pointer (the ship goes to the angle it points at)
    let turn = (this.keys.has('arrowright') || this.keys.has('d') ? 1 : 0) - (this.keys.has('arrowleft') || this.keys.has('a') ? 1 : 0);
    let fire = this.keys.has(' ') || this.keys.has('arrowup') || this.keys.has('w');
    const pad = navigator.getGamepads ? [...navigator.getGamepads()].find((p) => p && p.connected) : null;
    if (pad) {
      const ax = pad.axes[0] || 0; if (Math.abs(ax) > 0.2) turn = ax;
      if (pad.buttons[14] && pad.buttons[14].pressed) turn = -1; if (pad.buttons[15] && pad.buttons[15].pressed) turn = 1;
      if ((pad.buttons[0] && pad.buttons[0].pressed) || (pad.buttons[7] && pad.buttons[7].value > 0.3)) fire = true;
    }
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
      p.life = 0; r.dead = true; this.score += [0, 100, 50, 20][r.size];
      for (let i = 0; i < 8; i++) { const a = Math.random() * Math.PI * 2, v = (60 + Math.random() * 140) * s; this.bits.push({ x: r.x, y: r.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 }); }
      if (r.size > 1) { const a = Math.atan2(r.vy, r.vx); this.rock(r.x, r.y, r.size - 1, a + 0.5); this.rock(r.x, r.y, r.size - 1, a - 0.5); }
    }
    // a rock that reaches the ring where the ship is costs a life; past the ring it is gone
    for (const r of this.rocks) {
      if (r.dead) continue;
      if (this.hurt <= 0 && Math.hypot(r.x - sx, r.y - sy) < r.r + 12 * s) {
        r.dead = true; this.lives--; this.hurt = 1.4;
        if (this.lives <= 0) { this.over = true; if (this.score > this.best) { this.best = this.score; try { localStorage.setItem('hoc.rocks.best', String(this.best)); } catch (e) { /* not kept */ } } }
      }
      if (Math.hypot(r.x - cx, r.y - cy) > R + 80 * s) r.dead = true;
    }
    this.shots = this.shots.filter((p) => p.life > 0); this.rocks = this.rocks.filter((r) => !r.dead); this.bits = this.bits.filter((b) => b.life > 0);
  }
  draw() {
    const g = this.g, s = this.dpr, W = this.cv.width, H = this.cv.height, cx = W / 2, cy = H / 2, R = this.R;
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
    g.fillText('SCORE ' + this.score, 18 * s, H - 70 * s); g.fillStyle = '#a3abb0'; g.font = '600 ' + 12 * s + 'px "Open Sans", system-ui, sans-serif';
    g.fillText('BEST ' + Math.max(this.best, this.score) + '   ' + '▲'.repeat(Math.max(0, this.lives)), 18 * s, H - 48 * s);
    g.fillText(matchMedia('(pointer:coarse)').matches ? 'Drag to aim · hold to fire' : '← → or A D to move · Space to fire · Esc to stop', 18 * s, H - 30 * s);
    if (this.over) {
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(10,10,10,.7)'; g.fillRect(cx - 170 * s, cy - 54 * s, 340 * s, 108 * s);
      g.fillStyle = '#fefefe'; g.font = '800 ' + 22 * s + 'px "Open Sans", system-ui, sans-serif'; g.fillText('GAME OVER · ' + this.score, cx, cy - 16 * s);
      g.fillStyle = soft; g.font = '600 ' + 13 * s + 'px "Open Sans", system-ui, sans-serif'; g.fillText('Enter or tap to play again', cx, cy + 20 * s);
    }
  }
}

const screen = new LoadingScreen();
window.HOC_LOADING = screen;                           // for the page check (test/page_check.py UC-20) and devtools
/** the track (or anything) starts loading: the screen, with this car's own photo where it has one */
export function loadingShow(text, key) { screen.show(text, key); }
/** the lot or the race is ready: resolves when the screen has closed (at once, unless a game is being played) */
export function loadingDone() { return screen.finished(); }
