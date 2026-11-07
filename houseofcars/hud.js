// hud.js - the drive's instruments, drawn by the page: a tachometer whose scale is the car's READ max RPM and whose red band starts
// at its READ change-up RPM, the countdown's motion, the lap banner, the minimap and the stored record. The numbers it shows come
// from the ported rules (rules.js: lap time, best, speed text, gear text); only the drawing and the device record are the page's
// own (AUTHORED). Serves UC-7.4, UC-7.5, UC-7.6, UC-7.7.
const NS = 'http://www.w3.org/2000/svg';
const A0 = -225, A1 = 45;                                 // the dial's sweep, degrees (0 = 3 o'clock, clockwise)

const pol = (cx, cy, r, deg) => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180)];
function arc(cx, cy, r, a, b) {
  const [x0, y0] = pol(cx, cy, r, a), [x1, y1] = pol(cx, cy, r, b);
  return 'M' + x0.toFixed(1) + ' ' + y0.toFixed(1) + 'A' + r + ' ' + r + ' 0 ' + (b - a > 180 ? 1 : 0) + ' 1 ' + x1.toFixed(1) + ' ' + y1.toFixed(1);
}

// the tachometer for one car: maxRpm and shiftUpRpm are READ (cars.json engine.max_rpm, transmission.change_up_rpm)
export function buildTach(el, maxRpm, shiftUpRpm) {
  const ang = (rpm) => A0 + (A1 - A0) * rpm / maxRpm;
  let s = '<svg viewBox="0 0 220 220" class="tach" aria-hidden="true">' +
    '<path d="' + arc(110, 110, 92, A0, A1) + '" class="t-track"/>' +
    '<path d="' + arc(110, 110, 92, ang(shiftUpRpm), A1) + '" class="t-red"/>' +
    '<path id="t-fill" d="' + arc(110, 110, 92, A0, A0 + 0.01) + '" class="t-fill"/>';
  for (let r = 0; r <= maxRpm + 1; r += 500) {
    const major = r % 1000 === 0, a = ang(r);
    const [x0, y0] = pol(110, 110, major ? 74 : 79, a), [x1, y1] = pol(110, 110, 84, a);
    s += '<line x1="' + x0.toFixed(1) + '" y1="' + y0.toFixed(1) + '" x2="' + x1.toFixed(1) + '" y2="' + y1.toFixed(1) + '" class="' + (r >= shiftUpRpm ? 't-tick red' : 't-tick') + (major ? ' major' : '') + '"/>';
    if (major) { const [lx, ly] = pol(110, 110, 62, a); s += '<text x="' + lx.toFixed(1) + '" y="' + (ly + 4).toFixed(1) + '" class="t-num">' + r / 1000 + '</text>'; }
  }
  s += '<g id="t-needle"><line x1="110" y1="110" x2="110" y2="30" class="t-needle"/><circle cx="110" cy="110" r="6" class="t-hub"/></g>' +
    '<text x="110" y="98" class="t-x">×1000 rpm</text></svg>';
  el.insertAdjacentHTML('afterbegin', s);
  return { el, maxRpm, shiftUpRpm, ang, fill: el.querySelector('#t-fill'), needle: el.querySelector('#t-needle'), shift: document.getElementById('shift') };
}

export function updateTach(t, rpm) {
  const r = Math.max(0, Math.min(t.maxRpm, rpm)), a = t.ang(r);
  t.needle.setAttribute('transform', 'rotate(' + (a + 90).toFixed(2) + ' 110 110)');
  t.fill.setAttribute('d', arc(110, 110, 92, A0, Math.max(A0 + 0.01, a)));
  t.shift.classList.toggle('on', rpm >= t.shiftUpRpm);
}

// the countdown: each new text pops (UI_Start's POP plays per text; its keys are not ported, the motion is the page's)
export function popCountdown(el, text) {
  if (el.textContent === text) return false;
  el.textContent = text;
  el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
  el.classList.toggle('go', text === 'GO');
  return true;
}

// the lap banner: the lap's time (rules.formatTime) and its split against the best before it
export function lapBanner(el, lapText, splitS, isBest, recordText) {
  const split = splitS === null ? '' : '<span class="split ' + (splitS <= 0 ? 'faster' : 'slower') + '">' + (splitS <= 0 ? '−' : '+') + Math.abs(splitS).toFixed(3) + ' s</span>';
  el.innerHTML = '<small>' + (isBest ? 'New best lap' : 'Lap') + '</small><b>' + lapText + '</b>' + split + (recordText ? '<em>' + recordText + '</em>' : '');
  el.classList.toggle('best', isBest);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

// the device record: the best lap ever driven here in this car (the Blueprint's Best Time lives only for one play)
const KEY = (car) => 'hoc.record.' + car;
export function readRecord(car) { try { const v = localStorage.getItem(KEY(car)); return v === null ? null : +v; } catch (e) { return null; } }
export function writeRecord(car, s) { try { localStorage.setItem(KEY(car), String(s)); return true; } catch (e) { return false; } }

// ---------------------------------------------------------------- the minimap: the road, the gates, the car, from above
// The road is drawn from the collision triangles (world.tris, kind 'road' and 'tunnel': track.glb's own triangles), the gates
// from track.json (READ). Unreal space: X forward is up on the map, Y right is right.
// the map's road: the landscape spline's own left and right edges (data/road_spline.json, READ out of Unreal's level), one quad
// between each pair of points. 11-07 (UC-30, ?perf): drawn from every road and tunnel triangle of the collision mesh, the map took
// 17.8 s in one task while the lot was open; the spline's 188 points draw the same road in a few milliseconds
export function buildMinimap(canvas, spline, gates) {
  const L = spline.left, R = spline.right;
  if (!(L && R && L.length === R.length && L.length > 2)) throw new Error('hud.js: road_spline.json has no left and right edges to map');
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of L.concat(R)) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  const W = canvas.width, H = canvas.height, pad = 10;
  const s = Math.min((W - 2 * pad) / (maxY - minY), (H - 2 * pad) / (maxX - minX));
  const ox = (W - s * (maxY - minY)) / 2, oy = (H - s * (maxX - minX)) / 2;
  const px = (x, y) => [ox + (y - minY) * s, oy + (maxX - x) * s];
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const g = base.getContext('2d');
  g.fillStyle = 'rgba(254,254,254,.55)'; g.beginPath();
  const n = L.length, quads = spline.loop ? n : n - 1;
  for (let i = 0; i < quads; i++) {
    const j = (i + 1) % n, a = px(L[i][0], L[i][1]), b = px(L[j][0], L[j][1]), c = px(R[j][0], R[j][1]), d = px(R[i][0], R[i][1]);
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.lineTo(c[0], c[1]); g.lineTo(d[0], d[1]); g.closePath();
  }
  g.fill();
  return { canvas, base, px, gates, s };
}

export function drawMinimap(m, posCm, yawDeg, target, accent) {
  const g = m.canvas.getContext('2d');
  g.clearRect(0, 0, m.canvas.width, m.canvas.height);
  g.drawImage(m.base, 0, 0);
  m.gates.forEach((gate, i) => {                         // each gate as its box's long side (the line the car crosses), the next in the accent
    const yaw = gate.yaw_deg * Math.PI / 180, [hx, hy] = gate.half_extent_cm;
    const [ux, uy, h] = hx >= hy ? [Math.cos(yaw), Math.sin(yaw), hx] : [-Math.sin(yaw), Math.cos(yaw), hy];
    const [cx, cy] = gate.center_cm;
    const a = m.px(cx - ux * h, cy - uy * h), b = m.px(cx + ux * h, cy + uy * h);
    g.strokeStyle = i === target ? accent : gate.finish ? '#fefefe' : 'rgba(254,254,254,.35)';
    g.lineWidth = i === target ? 4 : 2.5;
    g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
  });
  const [x, y] = m.px(posCm[0], posCm[1]), h = yawDeg * Math.PI / 180;
  g.save(); g.translate(x, y); g.rotate(h);              // yaw 0 faces +X (up on the map); +yaw turns toward +Y (right)
  g.fillStyle = accent; g.strokeStyle = '#0a0a0a'; g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, -9); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
  g.restore();
}
