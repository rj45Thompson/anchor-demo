// online.js - UC-42 race someone online, in the browser: Trystero (MIT, 0.26.0) finds the other drivers over public Nostr relays and
// connects the browsers directly by WebRTC; online_core.js holds the protocol and every check (tested in node). This file adds the
// real network, a nickname form and the lobby panel. The page has no server of its own: GitHub Pages serves files only.
//
//   import { createOnline, askNickname, mountLobby } from './online.js';
//   const nickname = await askNickname(box);                 // step 1: the driver types a nickname
//   const online = createOnline({ appId, nickname, car, onMatch, onGo, onPose, onFinish, onLeave, onError });
//   mountLobby(box, online, { carName });                    // the list, Challenge / Accept / Decline, Ready, the status lines
//
// Import it with import() when the visitor opens the lobby, not at the top of app.js: this file loads Trystero from jsDelivr, and a
// static import would make the whole page wait on (and fail with) that CDN.
//
// NICKNAMES go only to the other players, over the WebRTC data channel. Every name shown here is written with textContent, never
// as HTML.
import { joinRoom, selfId, getRelaySockets } from 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm';
import { makeOnline, sanitizeName, NAME_MAX, CHALLENGE_MS } from './online_core.js';

export * from './online_core.js';
export const TRYSTERO = 'https://cdn.jsdelivr.net/npm/trystero@0.26.0/+esm';   // its default export is @trystero-p2p/nostr@0.26.0

const B62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const makeId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => B62[b % 62]).join('');

/** opts: { appId, nickname, car, room?, relays?, onLobby, onChallenge, onMatch, onGo, onPose, onFinish, onLeave, onError } -
 *  see online_core.js makeOnline for each event's payload. Returns { list, challenge, answer, ready, sendPose, sendFinish, leave,
 *  stats, state, on, debugSend } */
export function createOnline(opts) {
  return makeOnline({ joinRoom, selfId, relaySockets: getRelaySockets, now: () => performance.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h), makeId }, opts);
}

/* ---------------------------------------------------------------------------------------------------------------- the panel */
// The page's own colour variables where it has them (index.html :root, as sales_chat.js uses them), the same defaults otherwise.
// Every rule sits under .hol, so nothing here styles the page and the page's bare-element rules reach in as little as possible.
const CSS = `
.hol{box-sizing:border-box;width:min(380px,100%);font:14px/1.45 "Open Sans",system-ui,sans-serif;color:var(--ink,#fefefe);background:var(--panel,rgba(16,16,16,.92));border:1px solid var(--line,rgba(254,254,254,.13));border-radius:14px;backdrop-filter:blur(6px);overflow:hidden}
.hol *{box-sizing:border-box}
.hol [hidden]{display:none!important}
.hol button{font:inherit;font-size:13px;font-weight:700;color:inherit;background:rgba(255,255,255,.08);border:1px solid var(--line,rgba(254,254,254,.13));border-radius:9px;padding:7px 12px;cursor:pointer;min-height:36px}
.hol button:disabled{opacity:.45;cursor:default}
.hol button.go{background:var(--accent,#f25827);border-color:var(--accent,#f25827);color:#fff}
.hol button:focus-visible,.hol input:focus-visible{outline:2px solid var(--accent,#f25827);outline-offset:2px}
.hol-head{display:flex;align-items:flex-start;gap:8px;padding:12px 12px 8px 14px;border-bottom:1px solid var(--line,rgba(254,254,254,.13))}
.hol-head div{flex:1;min-width:0}
.hol-head strong{display:block;font-size:15px}
.hol-head strong b{color:var(--accent,#f25827)}
.hol-head small{display:block;color:var(--dim,#a3abb0);font-size:12px;overflow-wrap:anywhere}
.hol-status{margin:0;padding:9px 14px;font-size:13px;color:var(--dim,#a3abb0);min-height:1.45em}
.hol-status.bad{color:#f0b4b2}
.hol-card{margin:0 12px 10px;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.06)}
.hol-card p{margin:0 0 8px;overflow-wrap:anywhere}
.hol-card .hol-row{display:flex;gap:8px}
.hol-list{list-style:none;margin:0;padding:0 12px 6px;max-height:min(300px,45vh);overflow:auto}
.hol-list li{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--line,rgba(254,254,254,.13))}
.hol-list li:first-child{border-top:0}
.hol-who{flex:1;min-width:0}
.hol-who b{display:block;overflow-wrap:anywhere}
.hol-who small{color:var(--dim,#a3abb0);font-size:12px}
.hol-tag{font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--dim,#a3abb0)}
.hol-empty{margin:0;padding:4px 14px 10px;color:var(--dim,#a3abb0);font-size:13px}
.hol-fine{margin:0;padding:8px 14px 12px;border-top:1px solid var(--line,rgba(254,254,254,.13));color:var(--dim,#a3abb0);font-size:11.5px}
.hol-join{display:flex;flex-direction:column;gap:8px;padding:12px 14px 14px}
.hol-join label{font-size:13px;color:var(--dim,#a3abb0)}
.hol-join .hol-row{display:flex;gap:8px}
.hol-join input{flex:1;min-width:0;font:inherit;font-size:16px;color:inherit;background:rgba(255,255,255,.06);border:1px solid var(--line,rgba(254,254,254,.13));border-radius:10px;padding:8px 10px}
.hol-join .hol-hint{margin:0;font-size:12px;color:#f0b4b2;min-height:1.2em}
`;
function injectCss() {
  if (document.getElementById('hol-css')) return;
  const s = document.createElement('style'); s.id = 'hol-css'; s.textContent = CSS; document.head.appendChild(s);
}
// keys typed into the panel belong to the panel, not to the page's driving and walking controls (as sales_chat.js does)
const keepKeys = (el) => { for (const t of ['keydown', 'keyup', 'keypress']) el.addEventListener(t, (e) => e.stopPropagation()); };
const NICK_KEY = 'hoc.online.nick';

/** step 1: a small form asking for the nickname; resolves with the clean name (sanitizeName). The last one is offered again
 *  (kept per browser; if storage is blocked it is simply not kept). */
export function askNickname(container, { initial } = {}) {
  injectCss();
  let last = '';
  try { last = localStorage.getItem(NICK_KEY) || ''; } catch (e) { /* not kept */ }
  const el = document.createElement('section'); el.className = 'hol'; el.setAttribute('aria-label', 'Race someone online');
  el.innerHTML = '<div class="hol-head"><div><strong>Race someone <b>online</b></strong><small>A drag race against another visitor, browser to browser</small></div></div>' +
    '<form class="hol-join"><label for="hol-nick">Your nickname (only the other players see it)</label>' +
    '<div class="hol-row"><input id="hol-nick" maxlength="40" autocomplete="nickname" spellcheck="false"><button type="submit" class="go">Join</button></div>' +
    '<p class="hol-hint" aria-live="polite"></p></form>' +
    '<p class="hol-fine">The lobby connects browsers directly (WebRTC), so everyone in it can see your IP address.</p>';
  keepKeys(el);
  container.appendChild(el);
  const input = el.querySelector('input'), hint = el.querySelector('.hol-hint');
  input.value = sanitizeName(initial || last);
  return new Promise((resolve) => {
    el.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = sanitizeName(input.value);
      if (!n) { hint.textContent = 'Use letters or digits, up to ' + NAME_MAX + '.'; input.focus(); return; }
      try { localStorage.setItem(NICK_KEY, n); } catch (err) { /* not kept */ }
      el.remove();
      resolve(n);
    });
  });
}

/** the lobby: who is waiting (step 1), Challenge / Accept / Decline (step 2), Ready and the start (step 3), the result (step 5).
 *  carName(key) -> the car's name for a lot key (the page passes its own; the key itself otherwise). Returns { el, destroy } */
export function mountLobby(container, online, { carName = (k) => k } = {}) {
  injectCss();
  const el = document.createElement('section'); el.className = 'hol'; el.setAttribute('aria-label', 'Race someone online');
  el.innerHTML = '<div class="hol-head"><div><strong>Race someone <b>online</b></strong><small class="hol-me"></small></div><button type="button" class="hol-leave">Leave</button></div>' +
    '<p class="hol-status" role="status" aria-live="polite"></p>' +
    '<div class="hol-card hol-inc" hidden><p></p><div class="hol-row"><button type="button" class="hol-yes go">Accept</button><button type="button" class="hol-no">Decline</button></div></div>' +
    '<div class="hol-card hol-match" hidden><p class="hol-vs"></p><p class="hol-step"></p><button type="button" class="hol-ready go">Ready</button></div>' +
    '<ul class="hol-list" aria-label="Drivers in the lobby"></ul>' +
    '<p class="hol-empty" hidden></p>' +
    '<p class="hol-fine">Only the other players see your nickname. The lobby connects browsers directly (WebRTC), so everyone in it can see your IP address.</p>';
  keepKeys(el);
  container.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const statusEl = $('.hol-status'), listEl = $('.hol-list'), emptyEl = $('.hol-empty'), incEl = $('.hol-inc'), matchEl = $('.hol-match');
  const me = online.state().me;
  // the relays are how anyone is found at all: with none open, an empty list means "cannot see", not "nobody waiting", so it says
  // which. Relay sockets change without an event, so this part alone is refreshed every 2 s (the list is not, so a click is never lost)
  function paintRelays() {
    const r = online.state().phase === 'left' ? [] : online.stats().relays, open = r.filter((x) => x.open).length;
    $('.hol-me').textContent = 'You are ' + me.name + ' · ' + carName(me.car) + (r.length ? ' · ' + open + ' of ' + r.length + ' relays' : '');
    emptyEl.textContent = r.length && !open ? 'Not connected to any matchmaking relay yet, so nobody can be seen. Check the connection; it keeps trying.'
      : 'Nobody is waiting yet. Keep this open: anyone who opens the lobby shows up here.';
  }
  const relayTimer = setInterval(paintRelays, 2000);
  let fresh = true, lastFinish = null;                              // fresh: nothing has happened yet but the lobby filling
  const say = (text, bad) => { fresh = false; statusEl.textContent = text; statusEl.classList.toggle('bad', !!bad); };
  const count = () => { const n = online.list().length; statusEl.textContent = n ? n + (n === 1 ? ' driver' : ' drivers') + ' in the lobby.' : 'Looking for drivers…'; };
  const tryDo = (f) => { try { f(); } catch (e) { say(e.message.replace(/^online: /, ''), true); } };
  count();

  $('.hol-leave').addEventListener('click', () => { online.leave(); say('You left the lobby.'); render(); });
  $('.hol-yes').addEventListener('click', () => { const s = online.state(); if (s.inc) tryDo(() => online.answer(s.inc.peerId, true)); });
  $('.hol-no').addEventListener('click', () => { const s = online.state(); if (s.inc) tryDo(() => online.answer(s.inc.peerId, false)); });
  $('.hol-ready').addEventListener('click', () => tryDo(() => online.ready()));
  listEl.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-peer]');
    if (b) tryDo(() => online.challenge(b.dataset.peer));
  });

  const CH = {
    out: { sent: (n) => 'Challenge sent to ' + n + '. Waiting for an answer (' + CHALLENGE_MS / 1000 + ' s)…', declined: (n) => n + ' declined.', busy: (n) => n + ' is busy right now.',
           timeout: (n) => n + ' did not answer.', left: (n) => n + ' left the lobby.' },
    in: { asked: (n) => n + ' challenges you.', declined: (n) => 'You declined ' + n + '.', timeout: (n) => n + '\'s challenge ran out.', late: (n) => 'Too late: ' + n + ' had stopped waiting.', left: (n) => n + ' left.' },
  };
  const ago = (s) => (s === null ? '' : ' by ' + s.toFixed(3) + ' s');
  const runLine = (who, s) => who + ': ' + (!s ? 'no slip' : s.foul ? 'red light (' + s.reaction_s.toFixed(3) + ')' : s.reaction_s === null ? 'did not leave'
    : 'RT ' + s.reaction_s.toFixed(3) + ' · 1/4 ' + (s.quarter_s === null ? 'not reached' : s.quarter_s.toFixed(3) + ' s'));
  const resultLine = (f) => ({ win: 'You beat ' + f.name + ago(f.margin_s) + '. ' + f.why + '.', lose: f.name + ' won' + ago(f.margin_s) + '. ' + f.why + '.',
                               tie: 'A tie with ' + f.name + '. ' + f.why + '.', none: 'No result. ' + f.why + '.', solo: 'Solo run. ' + f.why + '.' })[f.result];
  const offs = [
    online.on('lobby', () => { if (fresh) count(); render(); }),
    online.on('state', () => render()),
    online.on('challenge', (c) => { const f = CH[c.dir][c.state]; if (f && !(c.dir === 'in' && c.state === 'asked')) say(f(c.name)); render(); }),
    online.on('match', (m) => { lastFinish = null; say('Matched with ' + m.name + '. Press Ready when you are.'); render(); }),
    online.on('go', () => { say('GO: the tree is running.'); render(); }),
    online.on('finish', (f) => { lastFinish = f; say(resultLine(f)); render(); }),
    online.on('leave', (l) => { say((l.name || 'The other driver') + ' left' + (l.during === 'match' ? ' before the start.' : ': the race goes on solo.')); render(); }),
    online.on('error', (e) => { say(e.message, true); render(); }),
  ];

  function render() {
    const s = online.state(), people = s.phase === 'left' ? [] : online.list(), free = s.phase === 'lobby' || s.phase === 'finished';
    listEl.replaceChildren(...people.map((p) => {
      const li = document.createElement('li'); li.dataset.name = p.name;
      const who = document.createElement('div'); who.className = 'hol-who';
      const b = document.createElement('b'); b.textContent = p.name;
      const c = document.createElement('small'); c.textContent = carName(p.car);
      who.append(b, c);
      const tag = document.createElement('span'); tag.className = 'hol-tag'; tag.textContent = p.state === 'busy' ? 'busy' : 'waiting';
      const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = 'Challenge'; btn.dataset.peer = p.peerId;
      btn.disabled = !free || p.state !== 'lobby';
      li.append(who, tag, btn);
      return li;
    }));
    emptyEl.hidden = s.phase === 'left' || people.length > 0;
    incEl.hidden = !(s.phase === 'asked' && s.inc);
    if (!incEl.hidden) incEl.querySelector('p').textContent = s.inc.name + ' (' + carName(s.inc.car) + ') challenges you to a drag race.';
    const m = s.match;
    matchEl.hidden = !m || s.phase === 'left';
    if (m) {
      $('.hol-vs').textContent = 'You vs ' + m.name + ' (' + carName(m.car) + ') · ' + (m.host ? 'you host' : m.name + ' hosts');
      const step = s.phase === 'match'
        ? (m.syncing ? 'Timing the connection…' : m.meReady ? 'Ready. Waiting for ' + m.name + '…' : m.oppReady ? m.name + ' is ready.' : 'Press Ready when you are staged.')
        : s.phase === 'go' ? 'Both ready: starting together…' : s.phase === 'racing' ? (m.oppHere ? 'Racing ' + m.name + '.' : 'Racing solo.')
        : lastFinish ? runLine('You', lastFinish.mine) + '. ' + runLine(m.name, lastFinish.theirs) + '.' : '';
      $('.hol-step').textContent = step;
      const rb = $('.hol-ready');
      rb.hidden = s.phase !== 'match';
      rb.disabled = m.meReady || m.syncing;
    }
    $('.hol-leave').disabled = s.phase === 'left';
    if (s.phase === 'left') clearInterval(relayTimer);
    paintRelays();
  }
  render();
  return { el, destroy() { clearInterval(relayTimer); offs.forEach((f) => f()); el.remove(); } };
}
