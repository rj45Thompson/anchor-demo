/* sales_chat.js - Claude as the lot's sales assistant: a chat panel that greets the visitor once the lot opens, answers in text and
 * reads each answer aloud.
 *
 * WHAT IT TALKS TO
 * The House of Cars sales relay (D:/_houseofcars/relay, a Cloudflare Worker). The relay holds the Claude key and the lot's listings;
 * this file holds neither. Its address comes from the script tag, and a page without one says so instead of guessing:
 *     <script src="sales_chat.js" data-relay="https://hoc-sales-relay.<account>.workers.dev"></script>
 *
 * WHEN IT STARTS
 * On the 'hoc:lot-open' window event, which the loading screen fires when the visitor enters the lot. The first one greets; later
 * ones (back from a race) only show the panel's tab. The click that entered the lot is what lets the browser speak at once.
 *
 * NOTHING IS FAKED
 * Every state is the relay's own answer: not switched on, over a cap, Claude declined, Anthropic down. Each is a sentence on the
 * panel. No reply is ever made up here.
 *
 * CLASSES  RelayClient (the two calls) - Voice (the browser's speech, waiting for the visitor's first click) - SalesChat (the panel)
 * Use case: relay/README.md "a visitor talks to the sales assistant", steps 1-4 and the alternates.
 */
(function () {
  'use strict';
  const RELAY = document.currentScript && document.currentScript.dataset.relay;

  /* ------------------------------------------------------------------------------------------------- RelayClient */
  class RelayClient {
    /* Every outcome is { ok:true, ... } or { ok:false, say } where say is a sentence for the panel. */
    constructor(base) { this.base = base ? base.replace(/\/+$/, '') : ''; }
    async call(path, init) {
      if (!this.base) return { ok: false, say: 'This page has no relay address (data-relay on the sales_chat.js script tag), so the assistant cannot start.' };
      let res;
      try { res = await fetch(this.base + path, init); } catch (e) { return { ok: false, say: 'The sales assistant could not be reached: ' + e.message + '.' }; }
      let body;
      try { body = await res.json(); } catch (e) { return { ok: false, say: 'The relay answered ' + res.status + ' with something that is not JSON.' }; }
      if (!body || typeof body.ok !== 'boolean') return { ok: false, say: 'The relay answered ' + res.status + ' without saying whether it worked.' };
      if (!body.ok && !body.say) return { ok: false, say: 'The relay refused (' + res.status + ') without a reason.' };
      return body;
    }
    health() { return this.call('/health', { method: 'GET' }); }
    chat(history, page) {                       // page: what is on the visitor's screen (UC-41; the relay checks every field)
      return this.call('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(page ? { history, page } : { history }) });
    }
  }

  /* ------------------------------------------------------------------------------------------------------- Voice */
  class Voice {
    /* The browser's own speech. Chrome refuses to speak before the visitor's first click or key, so a line asked for earlier waits
       for it. The on/off choice is kept per browser; if storage is blocked it simply is not kept. */
    constructor() {
      this.synth = window.speechSynthesis || null;
      this.on = true;
      try { this.on = localStorage.getItem('hoc.sales.voice') !== 'off'; } catch (e) { /* not kept */ }
      this.pending = null;
      this.voice = null;
      if (!this.synth) return;
      const pick = () => {
        const all = this.synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
        const rank = (v) => (/natural|online|google/i.test(v.name) ? 0 : 2) + (/^en-CA/i.test(v.lang) ? 0 : /^en-US/i.test(v.lang) ? 0.5 : 1);
        this.voice = all.sort((a, b) => rank(a) - rank(b))[0] || null;
      };
      pick();
      this.synth.addEventListener('voiceschanged', pick);
      const wake = () => { if (this.pending) { const t = this.pending; this.pending = null; this.say(t); } };
      window.addEventListener('pointerdown', wake, true);
      window.addEventListener('keydown', wake, true);
    }
    get available() { return !!this.synth; }
    setOn(on) {
      this.on = on;
      try { localStorage.setItem('hoc.sales.voice', on ? 'on' : 'off'); } catch (e) { /* not kept */ }
      if (!on) this.stop();
    }
    stop() { this.pending = null; if (this.synth) this.synth.cancel(); }
    say(text) {
      if (!this.synth || !this.on) return;
      const active = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
      if (!active) { this.pending = text; return; }
      this.synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'en-CA';
      u.rate = 1.02;
      this.synth.speak(u);
    }
  }

  /* --------------------------------------------------------------------------------------------------- SalesChat */
  /* Where it sits, READ from the lot page 2026-11-07 (index.html at 1440x900, 1024x768, 375x812): the page header ends 50 px from the
     top; on a wide screen the Test drive / Walk the lot bar reaches 67-89 px up from the bottom and the footer 42 px, so the panel
     sits 100 px up, on the left; on a phone the car card and the bar fill the bottom 345 px, so the panel goes under the header.
     The page can move it with --sales-chat-bottom and --sales-chat-top-phone. No element selectors: the page styles bare `header`
     (fixed, pointer-events:none), so everything here is a class under #salechat. */
  const CSS = `
#salechat{position:fixed;left:16px;bottom:var(--sales-chat-bottom,100px);z-index:4;width:min(360px,calc(100vw - 32px));font:14px/1.45 "Open Sans",system-ui,sans-serif;color:var(--ink,#fefefe)}
#salechat[hidden]{display:none}
#salechat .sc-tab{display:flex;align-items:center;gap:8px;padding:9px 14px;border-radius:99px;background:var(--panel,rgba(16,16,16,.9));border:1px solid var(--line,rgba(254,254,254,.13));backdrop-filter:blur(6px);font-weight:700}
#salechat .sc-tab b{color:var(--accent,#f25827)}
#salechat .sc-box{display:flex;flex-direction:column;max-height:min(460px,calc(100vh - var(--sales-chat-bottom,100px) - 66px));background:var(--panel,rgba(16,16,16,.9));border:1px solid var(--line,rgba(254,254,254,.13));border-radius:14px;backdrop-filter:blur(6px);overflow:hidden}
#salechat .sc-box[hidden],#salechat .sc-tab[hidden]{display:none}
#salechat .sc-head{display:flex;align-items:flex-start;gap:8px;padding:12px 12px 8px 14px;border-bottom:1px solid var(--line,rgba(254,254,254,.13))}
#salechat .sc-who{flex:1}
#salechat .sc-who strong{display:block;font-size:15px}
#salechat .sc-who strong b{color:var(--accent,#f25827)}
#salechat .sc-who small{display:block;color:var(--dim,#a3abb0);font-size:12px}
#salechat .sc-head button{padding:5px 9px;font-size:12px;border-radius:8px}
#salechat .sc-log{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
#salechat .sc-msg{max-width:88%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}
#salechat .sc-msg.claude{align-self:flex-start;background:rgba(255,255,255,.07)}
#salechat .sc-msg.claude::before{content:"Claude (AI)";display:block;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-soft,#ff9b74);margin-bottom:2px}
#salechat .sc-msg.you{align-self:flex-end;background:var(--accent,#f25827);color:#fff}
#salechat .sc-msg.note{align-self:stretch;max-width:none;background:none;border:1px dashed var(--line,rgba(254,254,254,.13));color:var(--dim,#a3abb0);font-size:13px}
#salechat .sc-msg.note.bad{border-color:var(--absent,#d9534f);color:#f0b4b2}
#salechat form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid var(--line,rgba(254,254,254,.13))}
#salechat input{flex:1;min-width:0;font:inherit;font-size:16px;color:inherit;background:rgba(255,255,255,.06);border:1px solid var(--line,rgba(254,254,254,.13));border-radius:10px;padding:8px 10px}
#salechat input:focus-visible,#salechat button:focus-visible{outline:2px solid var(--accent,#f25827);outline-offset:2px}
#salechat form button{padding:8px 14px;background:var(--accent,#f25827);border-color:var(--accent,#f25827);color:#fff;font-weight:800}
#salechat form button:disabled,#salechat input:disabled{opacity:.5;cursor:default}
@media (max-width:600px){#salechat{left:8px;right:8px;top:var(--sales-chat-top-phone,58px);bottom:auto;width:auto}#salechat .sc-box{max-height:max(200px,calc(100vh - 420px))}}
`;

  class SalesChat {
    constructor(relay, voice) {
      this.relay = relay; this.voice = voice;
      this.history = [];          // what the relay is sent: {role:'assistant'|'user', text}, starting with Claude's greeting
      this.greeted = false; this.busy = false; this.ready = false;
      this.build();
    }
    build() {
      const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
      const el = document.createElement('section');
      el.id = 'salechat'; el.hidden = true; el.setAttribute('aria-label', 'Sales assistant chat');
      el.innerHTML =
        '<button type="button" class="sc-tab" hidden aria-expanded="false"><b>Ask</b> the sales assistant</button>' +
        '<div class="sc-box" hidden>' +
        '<div class="sc-head"><div class="sc-who"><strong><b>Claude</b>, sales assistant</strong><small>An AI on an unofficial concept page, not House of Cars staff</small></div>' +
        '<button type="button" class="sc-voice"></button><button type="button" class="sc-min" aria-label="Hide the chat">Hide</button></div>' +
        '<div class="sc-log" role="log" aria-live="polite"></div>' +
        '<form><label class="sc-sr" for="sc-in" style="position:absolute;left:-9999px">Your question</label>' +
        '<input id="sc-in" maxlength="600" autocomplete="off" placeholder="Ask about any car here" disabled>' +
        '<button type="submit" disabled>Send</button></form></div>';
      document.body.appendChild(el);
      this.el = el;
      this.tab = el.querySelector('.sc-tab'); this.box = el.querySelector('.sc-box'); this.log = el.querySelector('.sc-log');
      this.input = el.querySelector('input'); this.send = el.querySelector('form button'); this.voiceBtn = el.querySelector('.sc-voice');
      this.tab.addEventListener('click', () => this.open(true));
      el.querySelector('.sc-min').addEventListener('click', () => this.open(false));
      this.voiceBtn.hidden = !this.voice.available;
      this.voiceBtn.addEventListener('click', () => { this.voice.setOn(!this.voice.on); this.paintVoice(); });
      this.paintVoice();
      el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); this.ask(); });
      // keys typed into the chat belong to the chat, not to the lot's driving and walking controls
      el.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.open(false); });
      el.addEventListener('keyup', (e) => e.stopPropagation());
    }
    paintVoice() {
      this.voiceBtn.textContent = this.voice.on ? 'Voice on' : 'Voice off';
      this.voiceBtn.setAttribute('aria-pressed', String(this.voice.on));
    }
    open(yes) {
      this.el.hidden = false;
      this.box.hidden = !yes; this.tab.hidden = yes; this.tab.setAttribute('aria-expanded', String(yes));
      if (yes && this.ready && !this.busy) this.input.focus({ preventScroll: true });
      if (!yes) this.voice.stop();
    }
    hide() { this.voice.stop(); this.el.hidden = true; }
    show() { if (this.greeted) this.open(!this.box.hidden); }
    line(kind, text) {
      const p = document.createElement('div'); p.className = 'sc-msg ' + kind; p.textContent = text;
      this.log.appendChild(p); this.log.scrollTop = this.log.scrollHeight;
      return p;
    }
    setBusy(b) { this.busy = b; this.input.disabled = b || !this.ready; this.send.disabled = b || !this.ready; }

    /* step 1: the lot opened */
    async lotOpen() {
      if (this.greeted) { if (this.el.hidden) this.open(false); return; }
      this.greeted = true;
      this.open(true);
      const wait = this.line('note', 'Asking Claude to say hello...');
      const h = await this.relay.health();
      if (!h.ok) { wait.remove(); this.line('note bad', h.say); return; }
      if (!h.ready) { wait.remove(); this.line('note bad', 'The sales assistant is not switched on yet: the relay has no Claude key.'); return; }
      this.ready = true;
      this.setBusy(true);
      const r = await this.relay.chat([]);
      wait.remove();
      if (!r.ok) { this.line('note bad', r.say); this.setBusy(false); return; }
      this.history.push({ role: 'assistant', text: r.text });
      this.line('claude', r.text);
      this.voice.say(r.text);
      this.setBusy(false);
    }

    /* steps 2-4: a question */
    async ask() {
      const q = this.input.value.trim();
      if (!q || this.busy || !this.ready) return;
      this.voice.stop();
      this.trim();
      this.history.push({ role: 'user', text: q });
      this.line('you', q);
      this.input.value = '';
      this.setBusy(true);
      const wait = this.line('note', 'Claude is thinking...');
      const page = window.HOC && window.HOC.salesPage ? window.HOC.salesPage() : null;
      const r = await this.relay.chat(this.history, page);
      wait.remove();
      if (!r.ok) {
        this.history.pop();                      // an unanswered question is not sent again as history
        this.line('note bad', r.say);
        this.input.value = q;                    // back in the box, to send again
      } else {
        // an action with no words is kept as what it did, so the history never holds an empty turn (the relay refuses one)
        const did = (r.actions || []).map((a) => (a.name === 'drag_race' ? 'Started a drag race in the ' : 'Showed the ') + a.car.replace(/_/g, ' ') + '.').join(' ');
        const said = r.text || did;
        this.history.push({ role: 'assistant', text: said });
        this.line('claude', said + (r.cut ? ' [cut short]' : ''));
        if (r.text) this.voice.say(r.text);
        for (const a of r.actions || []) window.HOC.salesAct(a);    // UC-41 show a car, or race one
      }
      this.setBusy(false);
      this.input.focus({ preventScroll: true });
    }
    /* the relay takes 16 turns; keep the greeting and drop the oldest question and answer to make room */
    trim() { while (this.history.length > 13) this.history.splice(1, 2); }
  }

  const chat = new SalesChat(new RelayClient(RELAY), new Voice());
  window.HOC_SALES = chat;                       // for the page check and devtools
  window.addEventListener('hoc:lot-open', () => { chat.lotOpen(); });
})();
