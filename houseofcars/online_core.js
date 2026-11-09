// online_core.js - UC-42 race someone online: the lobby, the challenge, the start, the poses and the slips between two browsers.
// Pure: no DOM and no network of its own. makeOnline() is handed a Trystero-shaped joinRoom (online.js passes the real one, the
// node test an in-memory one), a clock and timers, so every step and alternate runs the same code in node and in the page.
//
// UC-42 race someone online. Actor: two drivers on two devices. Goal: drag race each other.
//   1  open the lobby with a nickname -> see everyone waiting (nickname + car), appear in their lists          hello
//   2  challenge someone -> they accept or decline -> on accept both get a match (opponent, car, who hosts)   chal ask/yes/no/ok/cxl
//   3  both ready -> the host sends GO with a start time on its clock -> both start the tree together        ping/pong, rdy, go
//   4  during the run each sends its pose ~20 a second -> the other replays it in the other lane             pose
//   5  at the line each sends its slip -> both learn who won                                                  fin
//   alternates: 1a nobody waiting (the list is empty) - 2a declined - 2b timed out - 2c busy - 2d both challenge each other at once
//   (the lower peer id hosts) - 3a the clock sync gets no answer (onError, ready again to retry) - 4a the opponent leaves (onLeave,
//   the race goes on solo) - 4b a malformed, oversized, too-fast, stale or out-of-place message is DROPPED AND COUNTED (stats().dropped),
//   never handed on; JSON is only ever parsed (by Trystero, JSON.parse), never evaluated
//
// What travels where: the relays (public Nostr relays, Trystero's default) carry only the WebRTC handshake. Every message here goes
// over the direct WebRTC data channel (ordered, reliable), so the nickname reaches the other players and nobody else.
//
// CLASSES (plain objects) Peer {id, hello, buckets, ...} - Challenge {peerId, id, timer} - Match {id, peerId, host, clock, go, mine,
// theirs, ...}. Every number below marked AUTHORED is this module's own choice, not read from anywhere.

export const PROTOCOL = 1;
export const ROOM = 'lobby';
export const NAME_MAX = 16;                        // brief: letters, digits, spaces, 1-16 chars
export const CAR_RE = /^[a-z0-9_]{1,48}$/;         // the lot's keys (rivals.js SHORT, sim_cars/<key>.json)
export const ID_RE = /^[A-Za-z0-9]{8,24}$/;
export const POSE_HZ = 20;                         // use case step 4: about 20 a second
export const POSE_RATE_MAX = 40;                   // brief: incoming poses beyond 40/s are dropped and counted
export const CTL_RATE = 20, CTL_BURST = 30;        // AUTHORED: every other message, per peer
export const CHALLENGE_MS = 20000;                 // AUTHORED: an unanswered challenge times out
export const CONFIRM_MS = 10000;                   // AUTHORED: an accepted challenge waits this long for the challenger's ok
export const SYNC_PINGS = 12, SYNC_MIN = 4, SYNC_WAIT_MS = 1000;   // AUTHORED: the clock sync's pings
export const GO_LEAD_MS = 1500;                    // AUTHORED: GO is sent this far ahead of the start
export const FINISH_WAIT_MS = 30000;               // AUTHORED: how long a sent slip waits for the other's
// AUTHORED: the largest payload each message may have, in bytes of its JSON (checked by Trystero's onReceive BEFORE it is parsed)
export const MAX_BYTES = { hello: 256, chal: 160, rdy: 160, go: 160, ping: 96, pong: 160, pose: 1024, fin: 512 };
export const ACTIONS = Object.keys(MAX_BYTES);
export const DROP_KINDS = ['oversized', 'rate', 'malformed', 'stale', 'unexpected'];

/* ------------------------------------------------------------------------------------------------------------- pure helpers */

/** a nickname as others see it: letters and digits of any script, single spaces, at most 16 characters; '' when nothing is left */
export function sanitizeName(s) {
  if (typeof s !== 'string') return '';
  const clean = s.normalize('NFC').replace(/\s+/gu, ' ').replace(/[^\p{L}\p{Nd} ]+/gu, '').replace(/ {2,}/g, ' ').trim();
  return [...clean].slice(0, NAME_MAX).join('').trim();
}
export const isName = (s) => typeof s === 'string' && s.length > 0 && sanitizeName(s) === s;

const plain = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const num = (x, lo, hi) => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;
const numOrNull = (x, lo, hi) => x === null || num(x, lo, hi);
const bad = (why) => ({ ok: false, why });
const good = (value) => ({ ok: true, value });
/** the object has exactly these keys (optional ones may be missing); returns the problem or null */
function keysOf(o, req, opt = []) {
  if (!plain(o)) return 'not an object';
  for (const k of req) if (!(k in o)) return 'no ' + k;
  for (const k of Object.keys(o)) if (!req.includes(k) && !opt.includes(k)) return 'unknown key ' + JSON.stringify(k).slice(0, 40);
  if (o.v !== undefined && o.v !== PROTOCOL) return 'protocol ' + String(o.v).slice(0, 12) + ', this page speaks ' + PROTOCOL;
  return null;
}

/** step 1: who a peer is. { v, name, car, state: 'lobby' | 'busy' } */
export function validateHello(m) {
  const k = keysOf(m, ['v', 'name', 'car', 'state']); if (k) return bad(k);
  if (!isName(m.name)) return bad('name is not a clean 1-16 character nickname');
  if (typeof m.car !== 'string' || !CAR_RE.test(m.car)) return bad('car is not a lot key');
  if (m.state !== 'lobby' && m.state !== 'busy') return bad('state is not lobby or busy');
  return good(m);
}
const CHAL_WHY = { no: ['declined', 'busy', 'timeout'], cxl: ['timeout', 'late', 'left'] };
/** step 2: the challenge's five messages. { v, op: ask|yes|no|ok|cxl, id, why (no and cxl only) } */
export function validateChallenge(m) {
  const k = keysOf(m, ['v', 'op', 'id'], ['why']); if (k) return bad(k);
  if (!['ask', 'yes', 'no', 'ok', 'cxl'].includes(m.op)) return bad('op is not ask, yes, no, ok or cxl');
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return bad('id is not 8-24 letters and digits');
  if (CHAL_WHY[m.op]) { if (!CHAL_WHY[m.op].includes(m.why)) return bad(m.op + ' needs why in ' + CHAL_WHY[m.op].join('|')); }
  else if ('why' in m) return bad(m.op + ' carries no why');
  return good(m);
}
/** step 3: ready. { v, id } from the host; the guest adds its clock estimate { off, err } (ms) */
export function validateReady(m) {
  const k = keysOf(m, ['v', 'id'], ['off', 'err']); if (k) return bad(k);
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return bad('id is not 8-24 letters and digits');
  if (('off' in m) !== ('err' in m)) return bad('off and err come together');
  if ('off' in m && !(num(m.off, -1e13, 1e13) && num(m.err, 0, 1e5))) return bad('off/err are not finite ms');
  return good(m);
}
/** step 3: GO. { v, id, at } at: the start, on the host's clock (ms) */
export function validateGo(m) {
  const k = keysOf(m, ['v', 'id', 'at']); if (k) return bad(k);
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) return bad('id is not 8-24 letters and digits');
  if (!num(m.at, -1e13, 1e13)) return bad('at is not a finite time');
  return good(m);
}
export function validatePing(m) {
  const k = keysOf(m, ['v', 'n', 'a']); if (k) return bad(k);
  if (!Number.isInteger(m.n) || m.n < 0 || m.n > 1000) return bad('n is not a ping number');
  if (!num(m.a, -1e13, 1e13)) return bad('a is not a finite time');
  return good(m);
}
export function validatePong(m) {
  const k = keysOf(m, ['v', 'n', 'a', 'b']); if (k) return bad(k);
  if (!Number.isInteger(m.n) || m.n < 0 || m.n > 1000) return bad('n is not a ping number');
  if (!num(m.a, -1e13, 1e13) || !num(m.b, -1e13, 1e13)) return bad('a/b are not finite times');
  return good(m);
}
// AUTHORED sanity bounds for a pose (UE units, as drag.js poseOf records them): the run clock within 10 minutes, positions within
// 10 km of the origin, the axes unit rows, wheels at most 4 with steer within +-90 deg and suspension within +-2 m
const POSE_T_MAX = 600, POS_MAX = 1e6, STEER_MAX = 90, SPIN_MAX = 1e7, SUSP_MAX = 200;
/** step 4: one pose. { t (run clock s), pos [3] cm, axes [[X],[Y],[Z]] unit rows, w: up to 4 x [steerDeg, spinRad, suspensionOffsetCm] } */
export function validatePose(p) {
  const k = keysOf(p, ['t', 'pos', 'axes', 'w']); if (k) return bad(k);
  if (!num(p.t, 0, POSE_T_MAX)) return bad('t is not a run clock time (0-' + POSE_T_MAX + ' s)');
  if (!Array.isArray(p.pos) || p.pos.length !== 3 || !p.pos.every((x) => num(x, -POS_MAX, POS_MAX))) return bad('pos is not 3 finite numbers');
  if (!Array.isArray(p.axes) || p.axes.length !== 3) return bad('axes is not 3 rows');
  for (const r of p.axes) {
    if (!Array.isArray(r) || r.length !== 3 || !r.every((x) => num(x, -1.001, 1.001))) return bad('an axis is not 3 numbers in [-1, 1]');
    const l = Math.hypot(r[0], r[1], r[2]); if (l < 0.98 || l > 1.02) return bad('an axis is not unit length (' + l.toFixed(3) + ')');
  }
  if (!Array.isArray(p.w) || p.w.length > 4) return bad('w is not up to 4 wheels');
  for (const w of p.w) if (!Array.isArray(w) || w.length !== 3 || !num(w[0], -STEER_MAX, STEER_MAX) || !num(w[1], -SPIN_MAX, SPIN_MAX) || !num(w[2], -SUSP_MAX, SUSP_MAX)) return bad('a wheel is not [steerDeg, spinRad, suspensionOffsetCm] in range');
  return good(p);
}
/** step 5: the finish slip. { reaction_s, sixty_s, eighth_s, quarter_s, quarterAt (run clock s at the line), foul }; null = not reached.
 *  As drag.js keeps them: a foul is exactly a negative reaction, the marks come in order, the quarter and its run-clock time together */
export function validateSlip(s) {
  const k = keysOf(s, ['reaction_s', 'sixty_s', 'eighth_s', 'quarter_s', 'quarterAt', 'foul']); if (k) return bad(k);
  if (!numOrNull(s.reaction_s, -10, 60)) return bad('reaction_s is not null or -10..60 s');
  for (const m of ['sixty_s', 'eighth_s', 'quarter_s']) if (!(s[m] === null || num(s[m], 1e-3, 300))) return bad(m + ' is not null or 0..300 s');
  if (!numOrNull(s.quarterAt, 0, POSE_T_MAX)) return bad('quarterAt is not null or a run clock time');
  if (typeof s.foul !== 'boolean') return bad('foul is not true or false');
  if (s.foul !== (s.reaction_s !== null && s.reaction_s < 0)) return bad('foul must be exactly a negative reaction');
  if ((s.quarter_s === null) !== (s.quarterAt === null)) return bad('quarter_s and quarterAt come together');
  const marks = [s.sixty_s, s.eighth_s, s.quarter_s];
  for (let i = 1; i < 3; i++) if (marks[i] !== null && (marks[i - 1] === null || marks[i - 1] > marks[i])) return bad('the marks are out of order');
  if (s.quarterAt !== null && s.quarterAt < s.quarter_s) return bad('quarterAt is before the quarter time itself');
  return good(s);
}
export const VALIDATE = { hello: validateHello, chal: validateChallenge, rdy: validateReady, go: validateGo, ping: validatePing, pong: validatePong, pose: validatePose, fin: validateSlip };

/** step 3: the other clock from ping samples { a: sent (local ms), b: the other's clock when it answered, c: back (local ms) }.
 *  offset = other - local. The sample with the shortest round trip wins (NTP's rule): its error is at most half that round trip,
 *  whatever the split between the two directions. spread: how far the other samples' offsets range (the jitter seen) */
export function clockOffset(samples) {
  if (!Array.isArray(samples) || !samples.length) throw new Error('clockOffset: no samples');
  const rows = samples.map((s) => {
    if (!(num(s.a, -1e13, 1e13) && num(s.b, -1e13, 1e13) && num(s.c, -1e13, 1e13)) || s.c < s.a) throw new Error('clockOffset: a sample is not {a <= c, b} finite ms');
    return { rtt: s.c - s.a, off: s.b - (s.a + s.c) / 2 };
  });
  const best = rows.reduce((x, y) => (y.rtt < x.rtt ? y : x));
  const offs = rows.map((r) => r.off).sort((x, y) => x - y);
  return { offset: best.off, err: best.rtt / 2, rtt: best.rtt, n: rows.length, median: offs[offs.length >> 1], spread: offs[offs.length - 1] - offs[0] };
}

/** step 5: who won, from my slip and theirs (theirs null: nobody to beat). Both sides run this on the same two slips, so they agree.
 *  A red light loses; two red lights: the earlier one loses (more negative reaction). Otherwise the first to the line on the shared
 *  run clock (the trees started together, so quarterAt = green + reaction + ET); a car that never got there loses to one that did */
export function decideRace(mine, theirs) {
  if (!validateSlip(mine).ok) throw new Error('decideRace: my slip is not a slip: ' + validateSlip(mine).why);
  if (theirs === null) return { result: 'solo', why: 'Nobody to beat: the other driver left', margin_s: null };
  if (!validateSlip(theirs).ok) throw new Error('decideRace: their slip is not a slip: ' + validateSlip(theirs).why);
  if (mine.foul && theirs.foul) {
    if (mine.reaction_s === theirs.reaction_s) return { result: 'tie', why: 'Both red-lit at the same moment', margin_s: 0 };
    return { result: mine.reaction_s < theirs.reaction_s ? 'lose' : 'win', why: 'Both red-lit; the earlier red loses', margin_s: Math.abs(mine.reaction_s - theirs.reaction_s) };
  }
  if (mine.foul) return { result: 'lose', why: 'Red light', margin_s: null };
  if (theirs.foul) return { result: 'win', why: 'They red-lit', margin_s: null };
  const a = mine.quarterAt, b = theirs.quarterAt;
  if (a === null && b === null) return { result: 'none', why: 'Neither car reached the line', margin_s: null };
  if (a === null) return { result: 'lose', why: 'Only they reached the line', margin_s: null };
  if (b === null) return { result: 'win', why: 'Only you reached the line', margin_s: null };
  const d = Math.round((b - a) * 1e4) / 1e4;                     // to 0.1 ms: the slips' own resolution is 1 ms
  if (d === 0) return { result: 'tie', why: 'A dead heat', margin_s: 0 };
  return { result: d > 0 ? 'win' : 'lose', why: 'First to the line', margin_s: Math.abs(d) };
}

/** a token bucket: `rate` a second, at most `burst` at once. take() false = over the limit */
export const makeBucket = (rate, burst, t) => ({ rate, burst, tokens: burst, t });
export function bucketTake(b, t) {
  b.tokens = Math.min(b.burst, b.tokens + Math.max(0, t - b.t) * b.rate / 1000); b.t = t;
  if (b.tokens < 1) return false;
  b.tokens -= 1; return true;
}

/** a pose as sent: t to the ms, positions to 0.1 cm, axes to 1e-4, steer and suspension to 0.01, spin to 1e-3 (a pose ~250 bytes) */
const q = (x, s) => Math.round(x * s) / s;
export const packPose = (p) => ({ t: q(p.t, 1e3), pos: p.pos.map((x) => q(x, 10)), axes: p.axes.map((r) => r.map((x) => q(x, 1e4))), w: p.w.map((w) => [q(w[0], 100), q(w[1], 1e3), q(w[2], 100)]) });

/* ------------------------------------------------------------------------------------------------------------- the protocol */

/** deps: { joinRoom, selfId, now() ms, setTimer(fn, ms), clearTimer(h), makeId() 12 letters/digits, relaySockets?() {url: WebSocket} }
 *  opts: { appId, nickname, car, room?, relays?, onLobby, onChallenge, onMatch, onGo, onPose, onFinish, onLeave, onError } */
export function makeOnline(deps, opts) {
  const { joinRoom, selfId, now, setTimer, clearTimer, makeId } = deps;
  if (!opts || typeof opts.appId !== 'string' || !opts.appId) throw new Error('online: appId is required');
  const nickname = sanitizeName(opts.nickname);
  if (!nickname) throw new Error('online: the nickname has no letters or digits');
  if (typeof opts.car !== 'string' || !CAR_RE.test(opts.car)) throw new Error('online: car must be a lot key (a-z, 0-9, _), got ' + String(opts.car).slice(0, 60));
  const car = opts.car, created = now();

  const EV = ['lobby', 'challenge', 'match', 'go', 'pose', 'finish', 'leave', 'error', 'state'];
  const cbs = { lobby: opts.onLobby, challenge: opts.onChallenge, match: opts.onMatch, go: opts.onGo, pose: opts.onPose, finish: opts.onFinish, leave: opts.onLeave, error: opts.onError, state: null };
  const subs = Object.fromEntries(EV.map((e) => [e, []]));
  const emit = (e, a, b) => { for (const f of subs[e]) f(a, b); if (cbs[e]) cbs[e](a, b); };

  const peers = new Map();              // peerId -> { id, hello, pose: bucket, ctl: bucket }
  let phase = 'lobby';                  // lobby | asking | asked | joining | match | go | racing | finished | left
  let out = null, inc = null, match = null;
  const recentOut = new Set();          // ids of my challenges that timed out: a late yes gets a 'late' cancel
  const dropped = Object.fromEntries(DROP_KINDS.map((k) => [k, 0]));
  const lastDrops = [];
  const sent = Object.fromEntries(ACTIONS.map((a) => [a, 0])), recv = Object.fromEntries(ACTIONS.map((a) => [a, 0]));
  let firstListedMs = null, helloState = null;

  const room = joinRoom({ appId: opts.appId, ...(opts.relays ? { relayConfig: { urls: opts.relays } } : {}) }, opts.room || ROOM, {
    onJoinError: (d) => error('join', 'could not connect to a peer' + (d && d.peerId ? ' (' + String(d.peerId).slice(0, 12) + ')' : '') + ': ' + (d && d.error)),
  });
  const actions = {};
  for (const name of ACTIONS) {
    const a = room.makeAction(name);
    a.onReceive = ({ byteLength, peerId }) => {                     // before the payload is even parsed
      if (byteLength > MAX_BYTES[name]) { drop('oversized', name, peerId, byteLength + ' bytes > ' + MAX_BYTES[name]); return false; }
      return true;
    };
    a.onMessage = (data, meta) => receive(name, data, meta.peerId);
    actions[name] = a;
  }

  function error(where, message) {
    if (!subs.error.length && !cbs.error) console.error('online ' + where + ': ' + message);
    emit('error', { where, message });
  }
  function drop(kind, action, peerId, why) {
    dropped[kind]++;
    lastDrops.push({ kind, action, peer: String(peerId).slice(0, 12), why: String(why).slice(0, 120), at: Math.round(now() - created) });
    if (lastDrops.length > 8) lastDrops.shift();
  }
  function send(name, data, target) {
    sent[name]++;
    actions[name].send(data, target ? { target } : undefined).catch((e) => error('send ' + name, e && e.message ? e.message : String(e)));
  }
  const peerOf = (id) => {
    let p = peers.get(id);
    if (!p) { const t = now(); p = { id, hello: null, pose: makeBucket(POSE_RATE_MAX, POSE_RATE_MAX, t), ctl: makeBucket(CTL_RATE, CTL_BURST, t) }; peers.set(id, p); }
    return p;
  };
  const busy = () => ['asking', 'asked', 'joining', 'match', 'go', 'racing'].includes(phase);
  const myHello = () => ({ v: PROTOCOL, name: nickname, car, state: busy() ? 'busy' : 'lobby' });
  function setPhase(p) {
    phase = p;
    const h = busy() ? 'busy' : 'lobby';
    if (phase !== 'left' && h !== helloState) { helloState = h; send('hello', myHello()); }   // everyone sees me go busy / free
    emit('state', snapshot());
  }
  const free = () => setPhase(match && match.result ? 'finished' : 'lobby');
  const list = () => [...peers.values()].filter((p) => p.hello).map((p) => ({ peerId: p.id, name: p.hello.name, car: p.hello.car, state: p.hello.state }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.peerId < b.peerId ? -1 : 1));
  const lobbyChanged = () => emit('lobby', list());
  const who = (id) => { const p = peers.get(id); return p && p.hello ? { name: p.hello.name, car: p.hello.car } : { name: null, car: null }; };

  room.onPeerJoin = (peerId) => { peerOf(peerId); send('hello', myHello(), peerId); };
  room.onPeerLeave = (peerId) => {
    const p = peers.get(peerId);
    peers.delete(peerId);
    if (out && out.peerId === peerId) { clearTimer(out.timer); const w = { dir: 'out', state: 'left', peerId, ...out.who }; out = null; free(); emit('challenge', w); }
    if (inc && inc.peerId === peerId) { clearTimer(inc.timer); const w = { dir: 'in', state: 'left', peerId, ...inc.who }; inc = null; free(); emit('challenge', w); }
    if (match && match.peerId === peerId && match.oppHere) {
      match.oppHere = false;
      const during = phase;
      if (phase === 'match') { endSync(); match = null; free(); }      // no race had started: back to the lobby
      emit('leave', { peerId, name: p && p.hello ? p.hello.name : null, car: p && p.hello ? p.hello.car : null, during });
      if (match && match.mine && !match.result) settle();               // 4a: my slip was waiting on theirs
    }
    if (p && p.hello) lobbyChanged();
  };

  function receive(name, data, peerId) {
    if (phase === 'left') return;
    const p = peerOf(peerId);
    if (!bucketTake(name === 'pose' ? p.pose : p.ctl, now())) return drop('rate', name, peerId, name === 'pose' ? '> ' + POSE_RATE_MAX + '/s' : '> ' + CTL_RATE + '/s');
    const v = VALIDATE[name](data);
    if (!v.ok) return drop('malformed', name, peerId, v.why);
    recv[name]++;
    ON[name](v.value, p);
  }

  const ON = {
    hello(m, p) {
      const first = !p.hello;
      p.hello = { name: m.name, car: m.car, state: m.state };
      if (first && firstListedMs === null) firstListedMs = now() - created;
      lobbyChanged();
    },
    chal(m, p) {
      const id = p.id;
      if (m.op === 'ask') {
        if (!p.hello) { drop('unexpected', 'chal', id, 'ask before hello'); return send('chal', { v: PROTOCOL, op: 'no', id: m.id, why: 'busy' }, id); }
        if (phase === 'asking' && out.peerId === id) {                // 2d: both challenged each other: the lower id hosts
          if (selfId < id) return;                                     // mine stands; they will take it the same way
          clearTimer(out.timer); out = null;
        } else if (busy() || inc) return send('chal', { v: PROTOCOL, op: 'no', id: m.id, why: 'busy' }, id);   // 2c
        const crossed = phase === 'asking';
        match = null;
        inc = { peerId: id, id: m.id, who: who(id), timer: setTimer(() => expireIn('timeout'), CHALLENGE_MS + 2000) };   // the challenger cancels at CHALLENGE_MS; this is the safety net
        setPhase('asked');
        if (crossed) return answer(id, true);                          // both pressed Challenge on each other: both said yes
        return emit('challenge', { dir: 'in', state: 'asked', peerId: id, ...inc.who, id: m.id });
      }
      if (m.op === 'yes') {
        if (phase === 'asking' && out.peerId === id && out.id === m.id) {
          clearTimer(out.timer); const c = out; out = null;
          send('chal', { v: PROTOCOL, op: 'ok', id: m.id }, id);
          return startMatch(c.id, id, true);
        }
        if (recentOut.has(m.id)) return send('chal', { v: PROTOCOL, op: 'cxl', id: m.id, why: 'late' }, id);
        return drop('unexpected', 'chal', id, 'yes to no challenge of mine');
      }
      if (m.op === 'no') {
        if (phase === 'asking' && out.peerId === id && out.id === m.id) {
          clearTimer(out.timer); const w = { dir: 'out', state: m.why === 'busy' ? 'busy' : m.why === 'timeout' ? 'timeout' : 'declined', peerId: id, ...out.who, id: m.id };
          out = null; free(); return emit('challenge', w);
        }
        return drop('unexpected', 'chal', id, 'no to no challenge of mine');
      }
      if (m.op === 'ok') {
        if (phase === 'joining' && inc && inc.peerId === id && inc.id === m.id) { clearTimer(inc.timer); const c = inc; inc = null; return startMatch(c.id, id, false); }
        return drop('unexpected', 'chal', id, 'ok to nothing I accepted');
      }
      if (m.op === 'cxl') {
        if (inc && inc.peerId === id && inc.id === m.id) return expireIn(m.why);
        return drop('unexpected', 'chal', id, 'cancel of nothing I hold');
      }
    },
    ping(m, p) {
      if (!(match && match.peerId === p.id && match.oppHere && phase === 'match')) return drop('unexpected', 'ping', p.id, 'ping outside a match');
      send('pong', { v: PROTOCOL, n: m.n, a: m.a, b: now() }, p.id);
    },
    pong(m, p) {
      const s = match && match.peerId === p.id && match.sync;
      if (!s || !s.wait || s.wait.n !== m.n || s.wait.a !== m.a) return drop('unexpected', 'pong', p.id, 'pong to no ping waiting');
      const c = now(); clearTimer(s.wait.timer);
      s.samples.push({ a: s.wait.a, b: m.b, c }); s.wait = null;
      nextPing();
    },
    rdy(m, p) {
      if (!(match && match.peerId === p.id && match.id === m.id && phase === 'match' && !match.oppReady)) return drop('unexpected', 'rdy', p.id, 'ready outside a match');
      if (match.host && !('off' in m)) return drop('malformed', 'rdy', p.id, 'the guest\'s ready carries its clock estimate');
      match.oppReady = true;
      if ('off' in m) match.oppClock = { offset: m.off, err: m.err };
      emit('state', snapshot());
      maybeGo();
    },
    go(m, p) {
      if (!(match && match.peerId === p.id && match.id === m.id && !match.host && match.meReady && !match.go && phase === 'match')) return drop('unexpected', 'go', p.id, 'GO outside a ready match');
      schedule(m.at - match.clock.offset, m.at);
    },
    pose(m, p) {
      if (!(match && match.peerId === p.id && match.oppHere)) return drop('unexpected', 'pose', p.id, 'pose from someone I am not racing');
      if (m.t <= match.lastInT) return drop('stale', 'pose', p.id, 't ' + m.t + ' <= ' + match.lastInT);
      match.lastInT = m.t; match.posesIn++;
      emit('pose', m, { peerId: p.id, n: match.posesIn });
    },
    fin(m, p) {
      if (!(match && match.peerId === p.id && !match.theirs && match.go)) return drop('unexpected', 'fin', p.id, 'slip outside a started race');
      match.theirs = m;
      if (match.mine) settle();
      else emit('state', snapshot());
    },
  };

  function expireIn(why) {
    if (!inc) return;
    clearTimer(inc.timer);
    const w = { dir: 'in', state: why, peerId: inc.peerId, ...inc.who, id: inc.id };
    inc = null; free(); emit('challenge', w);
  }
  function startMatch(id, peerId, host) {
    const w = who(peerId);
    match = { id, peerId, name: w.name, car: w.car, host, hostId: host ? selfId : peerId, oppHere: true, meReady: false, oppReady: false, clock: null, oppClock: null,
              sync: null, go: null, mine: null, theirs: null, result: null, nextPoseT: 0, lastInT: -Infinity, posesIn: 0, posesOut: 0, finishTimer: null, matchedAt: now() };
    setPhase('match');
    emit('match', { peerId, name: w.name, car: w.car, host, hostId: match.hostId, id });
  }

  /* step 3: the guest times pings to the host; ready goes out with the estimate once enough came back */
  function startSync(done, fail) { match.sync = { n: 0, samples: [], wait: null, done, fail }; nextPing(); }
  function endSync() { if (match && match.sync) { if (match.sync.wait) clearTimer(match.sync.wait.timer); match.sync = null; } }
  function nextPing() {
    const s = match.sync;
    if (s.n >= SYNC_PINGS) {
      match.sync = null;
      if (s.samples.length < SYNC_MIN) return s.fail(new Error('clock sync: ' + s.samples.length + ' of ' + SYNC_PINGS + ' pings came back (need ' + SYNC_MIN + ')'));
      return s.done(clockOffset(s.samples));
    }
    const n = s.n++, a = now();
    s.wait = { n, a, timer: setTimer(() => { if (match && match.sync === s && s.wait && s.wait.n === n) { s.wait = null; nextPing(); } }, SYNC_WAIT_MS) };
    send('ping', { v: PROTOCOL, n, a }, match.peerId);
  }
  function maybeGo() {
    if (!(match.host && match.meReady && match.oppReady && !match.go && match.oppHere)) return;
    const at = now() + GO_LEAD_MS;
    send('go', { v: PROTOCOL, id: match.id, at }, match.peerId);
    schedule(at, at);
  }
  function schedule(startAt, hostAt) {
    const m = match;
    m.go = { startAt, hostAt, receivedAt: now(), timer: null, firedAt: null };
    setPhase('go');
    m.go.timer = setTimer(() => {
      if (match !== m || phase === 'left') return;
      m.go.firedAt = now();
      setPhase('racing');
      emit('go', { id: m.id, host: m.host, startAt, firedAt: m.go.firedAt, lateMs: m.go.firedAt - startAt, hostAt,
                   offsetMs: m.host ? 0 : m.clock.offset, offsetErrMs: m.host ? 0 : m.clock.err, rttMs: m.host ? null : m.clock.rtt, oppHere: m.oppHere });
    }, Math.max(0, startAt - now()));
  }
  function settle() {
    const m = match;
    if (m.finishTimer) { clearTimer(m.finishTimer); m.finishTimer = null; }
    const r = m.theirs ? decideRace(m.mine, m.theirs) : !m.oppHere ? decideRace(m.mine, null) : { result: 'none', why: 'No slip from ' + m.name + ' in ' + FINISH_WAIT_MS / 1000 + ' s', margin_s: null };
    m.result = r;
    setPhase('finished');
    emit('finish', { mine: m.mine, theirs: m.theirs, peerId: m.peerId, name: m.name, ...r });
  }

  function snapshot() {
    return { phase, me: { name: nickname, car, selfId },
      out: out ? { peerId: out.peerId, ...out.who } : null,
      inc: inc ? { peerId: inc.peerId, ...inc.who } : null,
      match: match ? { peerId: match.peerId, name: match.name, car: match.car, host: match.host, meReady: match.meReady, oppReady: match.oppReady, syncing: !!match.sync,
                       oppHere: match.oppHere, startAt: match.go ? match.go.startAt : null, mineSent: !!match.mine, theirsIn: !!match.theirs, result: match.result } : null };
  }

  return {
    selfId,
    list,
    state: snapshot,
    /** step 2 */
    challenge(peerId) {
      if (phase !== 'lobby' && phase !== 'finished') throw new Error('online: cannot challenge while ' + phase);
      const p = peers.get(peerId);
      if (!p || !p.hello) throw new Error('online: ' + String(peerId).slice(0, 12) + ' is not in the lobby');
      if (p.hello.state !== 'lobby') throw new Error('online: ' + p.hello.name + ' is busy');
      match = null;
      const id = makeId();
      out = { peerId, id, who: who(peerId), timer: setTimer(() => {
        if (!out || out.id !== id) return;
        recentOut.add(id);
        send('chal', { v: PROTOCOL, op: 'cxl', id, why: 'timeout' }, peerId);
        const w = { dir: 'out', state: 'timeout', peerId, ...out.who, id };
        out = null; free(); emit('challenge', w);
      }, CHALLENGE_MS) };
      setPhase('asking');
      send('chal', { v: PROTOCOL, op: 'ask', id }, peerId);
      emit('challenge', { dir: 'out', state: 'sent', peerId, ...out.who, id });
    },
    answer,
    /** step 3: the host is ready at once; the guest first times the host's clock */
    ready() {
      if (!match || phase !== 'match') throw new Error('online: ready needs a match (now ' + phase + ')');
      if (match.meReady || match.sync) return;
      if (match.host) { match.meReady = true; send('rdy', { v: PROTOCOL, id: match.id }, match.peerId); emit('state', snapshot()); return maybeGo(); }
      const m = match;
      startSync((clk) => {
        if (match !== m || phase !== 'match') return;
        m.clock = clk; m.meReady = true;
        send('rdy', { v: PROTOCOL, id: m.id, off: clk.offset, err: clk.err }, m.peerId);
        emit('state', snapshot());
      }, (e) => { if (match === m) { emit('state', snapshot()); error('clock', e.message + '; press Ready to try again'); } });
      emit('state', snapshot());
    },
    /** step 4: call it every frame; it sends at most POSE_HZ a second (true when this one went). false: no one to send to */
    sendPose(pose) {
      const v = validatePose(pose);
      if (!v.ok) throw new Error('sendPose: ' + v.why);
      if (!match || !match.oppHere || phase === 'left') return false;
      if (pose.t < match.nextPoseT - 1e-6) return false;
      match.nextPoseT += 1 / POSE_HZ;
      if (match.nextPoseT <= pose.t) match.nextPoseT = pose.t + 1 / POSE_HZ;
      match.posesOut++;
      send('pose', packPose(pose), match.peerId);
      return true;
    },
    /** step 5 */
    sendFinish(slip) {
      if (!match || !match.go) throw new Error('online: a slip needs a started race (now ' + phase + ')');
      if (match.mine) throw new Error('online: the slip was already sent');
      const v = validateSlip(slip);
      if (!v.ok) throw new Error('sendFinish: ' + v.why);
      match.mine = { reaction_s: slip.reaction_s, sixty_s: slip.sixty_s, eighth_s: slip.eighth_s, quarter_s: slip.quarter_s, quarterAt: slip.quarterAt, foul: slip.foul };
      if (match.oppHere) send('fin', match.mine, match.peerId);
      if (match.theirs || !match.oppHere) return settle();
      const m = match;
      m.finishTimer = setTimer(() => { if (match === m && !m.result) settle(); }, FINISH_WAIT_MS);
      emit('state', snapshot());
    },
    leave() {
      if (phase === 'left') return;
      if (out) clearTimer(out.timer);
      if (inc) clearTimer(inc.timer);
      if (match) { endSync(); if (match.go && match.go.timer) clearTimer(match.go.timer); if (match.finishTimer) clearTimer(match.finishTimer); }
      room.leave();
      peers.clear();
      setPhase('left');
    },
    stats() {
      const sockets = deps.relaySockets ? deps.relaySockets() : {};
      return {
        selfId, phase, nickname, car,
        peers: peers.size, listed: list().length, firstListedMs,
        sent: { ...sent }, received: { ...recv },
        dropped: { ...dropped }, droppedTotal: DROP_KINDS.reduce((s, k) => s + dropped[k], 0), lastDrops: lastDrops.slice(),
        clock: match && match.clock ? { ...match.clock } : null, oppClock: match && match.oppClock ? { ...match.oppClock } : null,
        poses: match ? { in: match.posesIn, out: match.posesOut } : null,
        relays: Object.entries(sockets).map(([url, ws]) => ({ url, open: !!ws && ws.readyState === 1, state: ws ? ['connecting', 'open', 'closing', 'closed'][ws.readyState] : 'none' })),
      };
    },
    /** more listeners for the same events (the lobby panel uses these, the page keeps its own callbacks) */
    on(event, fn) {
      if (!subs[event]) throw new Error('online.on: no event ' + event + ' (' + EV.join(', ') + ')');
      subs[event].push(fn);
      return () => { const i = subs[event].indexOf(fn); if (i >= 0) subs[event].splice(i, 1); };
    },
    /** TEST ONLY: send anything on an action, as a misbehaving peer would (online_two.py proves the drops with it) */
    debugSend(action, data, target) {
      if (!actions[action]) throw new Error('debugSend: no action ' + action);
      return actions[action].send(data, target ? { target } : undefined);
    },
  };

  /** step 2: accept or decline the challenge in hand */
  function answer(peerId, yes) {
    if (!(phase === 'asked' && inc && inc.peerId === peerId)) throw new Error('online: no challenge from ' + String(peerId).slice(0, 12) + ' to answer');
    if (yes) {
      clearTimer(inc.timer);
      const c = inc;
      inc.timer = setTimer(() => { if (inc === c) expireIn('timeout'); }, CONFIRM_MS);
      send('chal', { v: PROTOCOL, op: 'yes', id: c.id }, peerId);
      setPhase('joining');
      return;
    }
    clearTimer(inc.timer);
    send('chal', { v: PROTOCOL, op: 'no', id: inc.id, why: 'declined' }, peerId);
    const w = { dir: 'in', state: 'declined', peerId, ...inc.who, id: inc.id };
    inc = null; free(); emit('challenge', w);
  }
}
