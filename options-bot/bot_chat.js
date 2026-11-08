/* bot_chat.js - Claude answers questions about the options trader bot, in text and aloud, on the bot's pages.
 *
 * WHAT IT TALKS TO
 * The bot's chat relay (relay/ in the project, a Cloudflare Worker). The relay holds the Claude key; this file holds none.
 * Its address comes from the script tag, and a page without one says so instead of guessing:
 *     <script src="bot_chat.js" data-relay="https://options-bot-relay.<account>.workers.dev"></script>
 *
 * WHEN IT OPENS
 * On load: open on a wide screen, as a tab on a phone, where an open panel would cover the page. Browsers speak only after
 * the visitor's first click or key, so a reply that arrives before then is spoken at that first click.
 *
 * WHAT CLAUDE MAY DO ON THE PAGE
 * show_part only: scroll this page to one of its parts, or open the other bot page there. The conversation is kept for the
 * tab (sessionStorage), so it carries across the two pages. Claude cannot change the site; the relay gives it no way to.
 *
 * NOTHING IS FAKED
 * Every state is the relay's own answer: not switched on, over a cap, Claude declined, Anthropic down. The opening line is
 * the page's own words, marked as such. No reply is ever made up here.
 *
 * CLASSES  RelayClient (the two calls) - Voice (the browser's speech) - BotChat (the panel)
 * Use case: relay/README.md "a visitor asks about the bot", steps 1-5 and the alternates.
 */
(function () {
  'use strict';
  const RELAY = document.currentScript && document.currentScript.dataset.relay;
  const BOT_PARTS = ['run', 'does', 'fixed', 'light-loop', 'tested', 'replay', 'others', 'questions'];
  const ON_EPICS = /epics\.html$/.test(location.pathname);
  const KEY = 'optionsbot.chat';

  /* ------------------------------------------------------------------------------------------------- RelayClient */
  class RelayClient {
    constructor(base) { this.base = base ? base.replace(/\/+$/, '') : ''; }
    async call(path, init) {
      if (!this.base) return { ok: false, say: 'This page has no relay address (data-relay on the bot_chat.js script tag), so the assistant cannot start.' };
      let res;
      try { res = await fetch(this.base + path, init); } catch (e) { return { ok: false, say: 'The assistant could not be reached: ' + e.message + '.' }; }
      let body;
      try { body = await res.json(); } catch (e) { return { ok: false, say: 'The relay answered ' + res.status + ' with something that is not JSON.' }; }
      if (!body || typeof body.ok !== 'boolean') return { ok: false, say: 'The relay answered ' + res.status + ' without saying whether it worked.' };
      if (!body.ok && !body.say) return { ok: false, say: 'The relay refused (' + res.status + ') without a reason.' };
      return body;
    }
    health() { return this.call('/health', { method: 'GET' }); }
    chat(history, page) {
      return this.call('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ history, page }) });
    }
  }

  /* ------------------------------------------------------------------------------------------------------- Voice */
  class Voice {
    constructor() {
      this.synth = window.speechSynthesis || null;
      this.on = true;
      try { this.on = localStorage.getItem('optionsbot.voice') !== 'off'; } catch (e) { /* not kept */ }
      this.pending = null; this.voice = null;
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
      try { localStorage.setItem('optionsbot.voice', on ? 'on' : 'off'); } catch (e) { /* not kept */ }
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

  /* ------------------------------------------------------------------------------------------------------ BotChat */
  const CSS = `
#botchat{position:fixed;right:16px;bottom:16px;z-index:20;width:min(380px,calc(100vw - 32px));font:14px/1.45 'IBM Plex Sans',system-ui,sans-serif;color:#F4F2EC}
#botchat .bc-tab{display:flex;align-items:center;gap:8px;margin-left:auto;padding:9px 14px;border-radius:99px;background:#121C26;border:1px solid #2E4052;color:#F4F2EC;font:700 14px 'Space Grotesk',system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.4)}
#botchat .bc-tab b{color:#F08A3C}
#botchat .bc-box{display:flex;flex-direction:column;max-height:min(480px,calc(100vh - 32px));background:#121C26;border:1px solid #2E4052;border-radius:14px;overflow:hidden;box-shadow:0 10px 40px rgba(0,0,0,.5)}
#botchat [hidden]{display:none!important}
#botchat .bc-head{display:flex;align-items:flex-start;gap:8px;padding:12px 12px 8px 14px;border-bottom:1px solid #2E4052}
#botchat .bc-who{flex:1}#botchat .bc-who strong{display:block;font:600 15px 'Space Grotesk',system-ui,sans-serif}#botchat .bc-who strong b{color:#F08A3C}
#botchat .bc-who small{display:block;color:#A9B7C4;font-size:12px}
#botchat button{font:600 12px 'IBM Plex Sans',system-ui,sans-serif;color:#F4F2EC;background:#16222E;border:1px solid #2E4052;border-radius:8px;padding:5px 9px;cursor:pointer}
#botchat .bc-log{flex:1;overflow:auto;padding:10px 12px;display:flex;flex-direction:column;gap:8px}
#botchat .bc-msg{max-width:88%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}
#botchat .bc-msg.claude{align-self:flex-start;background:rgba(255,255,255,.07)}
#botchat .bc-msg.claude::before{content:"Claude (AI)";display:block;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#F7C873;margin-bottom:2px}
#botchat .bc-msg.you{align-self:flex-end;background:#F08A3C;color:#111}
#botchat .bc-msg.note{align-self:stretch;max-width:none;border:1px dashed #2E4052;color:#A9B7C4;font-size:13px}
#botchat .bc-msg.note.bad{border-color:#F2787A;color:#F7B4B5}
#botchat form{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #2E4052}
#botchat input{flex:1;min-width:0;font:16px 'IBM Plex Sans',system-ui,sans-serif;color:#F4F2EC;background:#0E1720;border:1px solid #2E4052;border-radius:10px;padding:8px 10px}
#botchat form button{padding:8px 14px;background:#F08A3C;border-color:#F08A3C;color:#111;font-weight:800}
#botchat form button:disabled,#botchat input:disabled{opacity:.5;cursor:default}
#botchat input:focus-visible,#botchat button:focus-visible{outline:2px solid #F08A3C;outline-offset:2px}
.botchat-flash{outline:2px solid #F08A3C;outline-offset:6px;border-radius:10px;transition:outline-color 1.5s}
`;

  class BotChat {
    constructor(relay, voice) {
      this.relay = relay; this.voice = voice;
      this.history = []; this.busy = false; this.ready = false;
      this.restore();
      this.build();
    }
    restore() {
      let s = null;
      try { s = JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch (e) { /* not kept */ }
      this.history = s && Array.isArray(s.history) ? s.history : [];
      this.wasOpen = s ? s.open : null;
    }
    keep() { try { sessionStorage.setItem(KEY, JSON.stringify({ history: this.history, open: !this.box.hidden })); } catch (e) { /* not kept */ } }
    build() {
      const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
      const el = document.createElement('section');
      el.id = 'botchat'; el.setAttribute('aria-label', 'Ask about the bot');
      el.innerHTML =
        '<button type="button" class="bc-tab" hidden aria-expanded="false"><b>Ask</b> about the bot</button>' +
        '<div class="bc-box" hidden>' +
        '<div class="bc-head"><div class="bc-who"><strong><b>Claude</b>, about this bot</strong><small>An AI. It explains the bot; it gives no trading advice and changes nothing.</small></div>' +
        '<button type="button" class="bc-voice"></button><button type="button" class="bc-min" aria-label="Hide the chat">Hide</button></div>' +
        '<div class="bc-log" role="log" aria-live="polite"></div>' +
        '<form><label for="bc-in" style="position:absolute;left:-9999px">Your question</label>' +
        '<input id="bc-in" maxlength="600" autocomplete="off" placeholder="Ask about the bot" disabled>' +
        '<button type="submit" disabled>Send</button></form></div>';
      document.body.appendChild(el);
      this.el = el;
      this.tab = el.querySelector('.bc-tab'); this.box = el.querySelector('.bc-box'); this.log = el.querySelector('.bc-log');
      this.input = el.querySelector('input'); this.send = el.querySelector('form button'); this.voiceBtn = el.querySelector('.bc-voice');
      this.tab.addEventListener('click', () => this.open(true));
      el.querySelector('.bc-min').addEventListener('click', () => this.open(false));
      this.voiceBtn.hidden = !this.voice.available;
      this.voiceBtn.addEventListener('click', () => { this.voice.setOn(!this.voice.on); this.paintVoice(); });
      this.paintVoice();
      el.querySelector('form').addEventListener('submit', (e) => { e.preventDefault(); this.ask(); });
      el.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.open(false); });
      this.line('note', 'Ask about this bot: how to run it on paper, what it checks, what was fixed, the epics, the replay. Claude answers here and reads the answer aloud.');
      for (const t of this.history) this.line(t.role === 'user' ? 'you' : 'claude', t.text);
    }
    paintVoice() { this.voiceBtn.textContent = this.voice.on ? 'Voice on' : 'Voice off'; this.voiceBtn.setAttribute('aria-pressed', String(this.voice.on)); }
    open(yes) {
      this.box.hidden = !yes; this.tab.hidden = yes; this.tab.setAttribute('aria-expanded', String(yes));
      if (yes && this.ready && !this.busy) this.input.focus({ preventScroll: true });
      if (!yes) this.voice.stop();
      this.keep();
    }
    line(kind, text) {
      const p = document.createElement('div'); p.className = 'bc-msg ' + kind; p.textContent = text;
      this.log.appendChild(p); this.log.scrollTop = this.log.scrollHeight;
      return p;
    }
    setBusy(b) { this.busy = b; this.input.disabled = b || !this.ready; this.send.disabled = b || !this.ready; }
    page() {
      const at = decodeURIComponent(location.hash.slice(1));
      return { page: ON_EPICS ? 'epics' : 'bot', at: /^[A-Za-z0-9-]{1,20}$/.test(at) ? at : '' };
    }

    /* step 1: the panel opens and asks the relay whether the assistant is on */
    async start() {
      const wide = window.matchMedia('(min-width: 700px)').matches;
      this.open(this.wasOpen === null ? wide : this.wasOpen);
      const h = await this.relay.health();
      if (!h.ok) { this.line('note bad', h.say); return; }
      if (!h.ready) { this.line('note bad', 'The assistant is not switched on yet: its relay has no Claude key.'); return; }
      this.ready = true; this.setBusy(false);
    }

    /* steps 2-5: a question */
    async ask() {
      const q = this.input.value.trim();
      if (!q || this.busy || !this.ready) return;
      this.voice.stop();
      while (this.history.length > 13) this.history.splice(0, 2);
      this.history.push({ role: 'user', text: q });
      this.line('you', q);
      this.input.value = '';
      this.setBusy(true);
      const wait = this.line('note', 'Claude is thinking...');
      const r = await this.relay.chat(this.history, this.page());
      wait.remove();
      if (!r.ok) {
        this.history.pop();
        this.line('note bad', r.say);
        this.input.value = q;
      } else {
        this.history.push({ role: 'assistant', text: r.text || '(shows the page)' });
        if (r.text) { this.line('claude', r.text + (r.cut ? ' [cut short]' : '')); this.voice.say(r.text); }
        this.keep();
        for (const a of r.actions || []) this.show(a.part);
      }
      this.keep();
      this.setBusy(false);
      this.input.focus({ preventScroll: true });
    }

    /* step 5: the one action, on the bot's own two pages */
    show(part) {
      const here = ON_EPICS ? !BOT_PARTS.includes(part) : BOT_PARTS.includes(part);
      if (!here) { this.keep(); location.href = (ON_EPICS ? './' : 'epics.html') + '#' + encodeURIComponent(part); return; }
      const target = document.getElementById(part);
      if (!target) { this.line('note bad', 'This page has no part called ' + part + '.'); return; }
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('botchat-flash');
      setTimeout(() => target.classList.remove('botchat-flash'), 2200);
    }
  }

  const chat = new BotChat(new RelayClient(RELAY), new Voice());
  window.OPTIONS_BOT_CHAT = chat;              // for the page check and devtools
  chat.start();
})();
