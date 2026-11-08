/* living-page.js - a page you can talk to, that can change itself. One script tag, on any page:
 *
 *   <script src="https://rj45thompson.github.io/anchor-demo/living-page/1/living-page.js"
 *           data-relay="https://living-page-relay.<account>.workers.dev" data-site="options-bot" data-page="bot"
 *           data-mount="#talk" data-index></script>
 *
 *   data-relay       the Living Page relay (relay/ in the package). It holds the Claude key; this file holds none.
 *   data-site        the site's id in the relay (relay/sites/<id>.json); data-page: this page's key there
 *   data-mount       where the chat sits on the page, as a CSS selector. Without it the chat is a tab in the corner.
 *   data-index       add the left-hand index that slides open and closed, built from the page's own headings
 *   data-chat="off"  the index alone
 *
 * THE PAGE'S SHAPE. The parts Claude may change are <section id> elements, each with an <h2>, directly inside
 * [data-lp-editable]; a section's text lives in its .lp-body when it has one. The index lists every <h2> that has an id, or
 * whose section has one. Links for the index's "Pages" list come from <nav data-lp-links>, which shows as a plain row of
 * links when this script does not run.
 *
 * WHAT CLAUDE MAY DO. show_part: scroll here, or open the site's page that has the part. change_page: rewrite, add, remove
 * or move a part, or set the accent colour and text size. A change is made from TEXT, never from markup: Renderer builds
 * every node with createElement and textContent, so no script, image, style or handler can come in through it. A change
 * is the visitor's own until the page's owner keeps it, with the owner key, held in the owner's browser only.
 *
 * NOTHING IS FAKED. Every state on the panel is the relay's own answer or the browser's own error. The greeting is the
 * site's own words, shown as a note, not as Claude.
 *
 * CLASSES  Relay (the calls) - Voice (speak, listen) - Renderer (text to nodes) - PageEditor (apply, undo) -
 *          SideIndex (the sliding index) - Chat (the panel) - LivingPage (wires them together)
 * Use cases: README.md, UC-1 a visitor asks, UC-2 a visitor changes the page, UC-3 the owner keeps it, UC-4 the index.
 */
(function () {
  'use strict';
  const VERSION = '1.0.0';
  const tag = document.currentScript;
  if (!tag) throw new Error('living-page.js must be loaded by a plain <script> tag, not as a module or injected later');
  const CFG = Object.freeze({
    relay: (tag.dataset.relay || '').replace(/\/+$/, ''), site: tag.dataset.site || '', page: tag.dataset.page || '',
    mount: tag.dataset.mount || '', index: tag.hasAttribute('data-index'), chat: tag.dataset.chat !== 'off',
  });
  const LIMIT = { title: 120, text: 1500, total: 13000 };   // under the relay's own (rules.LIMITS), so a page never sends too much
  const SAFE_HREF = /^(?:https:\/\/[^\s<>"'`]+|#[A-Za-z0-9._-]+|(?:\.\/)?[a-z0-9][a-z0-9_.-]*\.(?:html|py|md|txt|zip|json)(?:#[A-Za-z0-9._-]+)?)$/;
  const SCALE = { smaller: '0.92', normal: '1', larger: '1.12' };

  /* the browser's storage, which can be missing or refused (private windows): every read and write may fail quietly, and
     nothing here depends on it, it only remembers conveniences (the index open or shut, the voice, the chat for this tab) */
  const store = {
    get(k, tab) { try { return (tab ? sessionStorage : localStorage).getItem('livingpage.' + k); } catch (e) { return null; } },
    set(k, v, tab) { try { (tab ? sessionStorage : localStorage).setItem('livingpage.' + k, v); } catch (e) { /* not kept */ } },
    del(k, tab) { try { (tab ? sessionStorage : localStorage).removeItem('livingpage.' + k); } catch (e) { /* not kept */ } },
  };
  const el = (name, attrs, ...kids) => {
    const n = document.createElement(name);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) n.setAttribute(k, v);
    for (const c of kids) n.append(c);
    return n;
  };

  /* ---------------------------------------------------------------------------------------------- Relay: the calls */
  class Relay {
    constructor(base, site) { this.base = base; this.site = site; }
    async call(path, init) {
      if (!this.base || !this.site) return { ok: false, say: 'This page names no relay or site (data-relay, data-site on the living-page.js tag), so the assistant cannot start.' };
      let res;
      try { res = await fetch(this.base + path, init); } catch (e) { return { ok: false, say: 'The assistant could not be reached: ' + e.message + '.' }; }
      let body;
      try { body = await res.json(); } catch (e) { return { ok: false, say: 'The relay answered ' + res.status + ' with something that is not JSON.' }; }
      if (!body || typeof body.ok !== 'boolean') return { ok: false, say: 'The relay answered ' + res.status + ' without saying whether it worked.' };
      if (!body.ok && !body.say) return { ok: false, say: 'The relay refused (' + res.status + ') without a reason.' };
      return body;
    }
    q(extra) { return '?site=' + encodeURIComponent(this.site) + (extra || ''); }
    post(path, body, key) {
      const headers = { 'Content-Type': 'application/json' };
      if (key) headers['X-Owner-Key'] = key;
      return this.call(path, { method: 'POST', headers, body: JSON.stringify({ site: this.site, ...body }) });
    }
    health() { return this.call('/health' + this.q(), { method: 'GET' }); }
    kept(page) { return this.call('/page' + this.q('&page=' + encodeURIComponent(page)), { method: 'GET' }); }
    chat(history, where) { return this.post('/chat', { history, where }); }
    owner(key) { return this.post('/owner', {}, key); }
    keep(page, change, key) { return this.post('/page/keep', { page, summary: change.summary, edits: change.edits }, key); }
    reset(page, key) { return this.post('/page/reset', { page }, key); }
  }

  /* -------------------------------------------------------------------------------------- Voice: speak and listen */
  /* Browsers speak only after the visitor's first click or key, so a line said before then waits for that first gesture.
     Listening is the browser's own recognizer (Chrome and Edge send the audio to their speech service); one take ends at the
     first pause, which suits one question. A take that heard nothing says so. */
  const MIC = {
    'not-allowed': 'The microphone is blocked for this page. Allow it from the address bar, or type instead.',
    'service-not-allowed': 'This browser will not listen on this page. Type instead.',
    'no-speech': 'I did not hear anything. Press Talk and try again.',
    'audio-capture': 'No microphone was found. Type instead.',
    network: 'The browser\'s speech service could not be reached. Type instead.',
    aborted: 'Stopped listening.',
  };
  class Voice {
    constructor() {
      this.synth = window.speechSynthesis || null;
      this.Rec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
      this.on = store.get('voice') !== 'off';
      this.pending = null; this.voice = null; this.rec = null;
      if (!this.synth) return;
      const pick = () => {
        const all = this.synth.getVoices().filter((v) => /^en(-|_|$)/i.test(v.lang));
        const rank = (v) => (/natural|online|google/i.test(v.name) ? 0 : 2) + (/^en-CA/i.test(v.lang) ? 0 : /^en-US/i.test(v.lang) ? 0.5 : 1);
        this.voice = all.sort((a, b) => rank(a) - rank(b))[0] || null;
      };
      pick();
      this.synth.addEventListener('voiceschanged', pick);
      const wake = () => { if (this.pending) { const p = this.pending; this.pending = null; this.say(p.text).then(p.done); } };
      window.addEventListener('pointerdown', wake, true);
      window.addEventListener('keydown', wake, true);
    }
    get canSpeak() { return !!this.synth; }
    get canListen() { return !!this.Rec; }
    setOn(on) { this.on = on; store.set('voice', on ? 'on' : 'off'); if (!on) this.stop(); }
    stop() {
      this.pending = null;
      if (this.synth) this.synth.cancel();
      if (this.rec) { const r = this.rec; this.rec = null; try { r.abort(); } catch (e) { /* already ended */ } }
    }
    /* resolves when the line has been said, or at once when it will not be */
    say(text) {
      return new Promise((done) => {
        if (!this.synth || !this.on || !text) return done();
        const active = navigator.userActivation ? navigator.userActivation.hasBeenActive : true;
        if (!active) { this.pending = { text, done }; return; }
        this.synth.cancel();
        const u = new SpeechSynthesisUtterance(text);
        if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; } else u.lang = 'en-CA';
        u.rate = 1.02;
        // Chrome can drop an utterance's end event, which would leave Talk waiting forever: the wait ends by the time the
        // line must have been said (about 80 ms a character, measured on the en voices here, plus a margin)
        const limit = setTimeout(done, 2000 + text.length * 80);
        u.onend = () => { clearTimeout(limit); done(); };
        u.onerror = () => { clearTimeout(limit); done(); };
        this.synth.speak(u);
      });
    }
    /* one take: { ok, text } or { ok:false, why } */
    listen(onWords) {
      return new Promise((resolve) => {
        if (!this.Rec) return resolve({ ok: false, why: 'This browser cannot listen. Type your question instead.' });
        const rec = new this.Rec();
        this.rec = rec;
        let final = '', heard = '', settled = false;
        const end = (r) => { if (settled) return; settled = true; if (this.rec === rec) this.rec = null; resolve(r); };
        rec.lang = 'en-US'; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
        rec.onresult = (e) => {
          heard = '';
          for (let i = 0; i < e.results.length; i++) {
            if (e.results[i].isFinal) final += e.results[i][0].transcript; else heard += e.results[i][0].transcript;
          }
          if (onWords) onWords((final + heard).trim());
        };
        rec.onerror = (e) => end({ ok: false, why: MIC[e.error] || ('The microphone stopped: ' + e.error + '.') });
        rec.onend = () => { const t = (final || heard).trim(); end(t ? { ok: true, text: t } : { ok: false, why: MIC['no-speech'] }); };
        try { rec.start(); } catch (e) { end({ ok: false, why: 'The microphone could not start: ' + e.message }); }
      });
    }
  }

  /* -------------------------------------------------------------------------------------- Renderer: text to nodes */
  /* The little markdown a change may carry: a blank line between paragraphs, "- " bullet lines, "1. " numbered lines, **bold**,
     `code`, [words](href) with an href on SAFE_HREF. Anything else is shown as the text it is. */
  const Renderer = {
    blocks(text) {
      const frag = document.createDocumentFragment();
      for (const block of String(text).replace(/\r/g, '').split(/\n\s*\n/)) {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        if (!lines.length) continue;
        if (lines.every((l) => /^[-*] /.test(l))) frag.append(Renderer.list('ul', lines.map((l) => l.slice(2))));
        else if (lines.every((l) => /^\d{1,3}[.)] /.test(l))) frag.append(Renderer.list('ol', lines.map((l) => l.replace(/^\d{1,3}[.)] /, ''))));
        else { const p = el('p'); Renderer.inline(p, lines.join(' ')); frag.append(p); }
      }
      return frag;
    },
    list(name, items) {
      const list = el(name);
      for (const t of items) { const li = el('li'); Renderer.inline(li, t); list.append(li); }
      return list;
    },
    inline(parent, text) {
      const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
      let at = 0, m;
      while ((m = re.exec(text))) {
        if (m.index > at) parent.append(text.slice(at, m.index));
        if (m[1] !== undefined) parent.append(el('strong', null, m[1]));
        else if (m[2] !== undefined) parent.append(el('code', null, m[2]));
        else if (SAFE_HREF.test(m[4])) parent.append(el('a', { href: m[4], rel: /^https:/.test(m[4]) ? 'noopener noreferrer' : null }, m[3]));
        else parent.append(m[0]);
        at = re.lastIndex;
      }
      if (at < text.length) parent.append(text.slice(at));
    },
  };
  /* a node's words, with a space between its blocks (textContent runs "one</li><li>two" together) */
  function wordsOf(node) {
    if (!node) return '';
    const copy = node.cloneNode(true);
    for (const b of copy.querySelectorAll('p,li,h2,h3,h4,div,ol,ul,pre,tr')) b.append(' ');
    return copy.textContent.replace(/\s+/g, ' ').trim();
  }
  const clip = (s, n) => (s.length <= n ? s : s.slice(0, n - 3).replace(/\s+\S*$/, '') + '...');

  /* ------------------------------------------------------------------------------------ PageEditor: apply, undo */
  class PageEditor {
    constructor(root) { this.root = root; this.undos = []; }
    sections(root = this.root) { return [...root.children].filter((n) => n.tagName === 'SECTION' && n.id); }
    view() {   // UC-1 step 1: what the page says now, changes included, under the relay's limits (40 parts at most)
      const secs = this.sections().slice(0, 40);
      const each = Math.min(LIMIT.text, Math.floor(LIMIT.total / Math.max(1, secs.length)) - LIMIT.title);
      return secs.map((s) => {
        const h = s.querySelector(':scope > h2');
        return { id: s.id, title: clip(h ? h.textContent.trim() : s.id, LIMIT.title), text: clip(wordsOf(s.querySelector(':scope > .lp-body') || s), each) };
      });
    }
    snapshot() {
      const css = document.documentElement.style;
      return { root: this.root.cloneNode(true), accent: css.getPropertyValue('--accent'), scale: css.getPropertyValue('--lp-scale') };
    }
    restore(s) {
      this.root.replaceChildren(...[...s.root.childNodes]);
      const css = document.documentElement.style;
      for (const [k, v] of [['--accent', s.accent], ['--lp-scale', s.scale]]) { if (v) css.setProperty(k, v); else css.removeProperty(k); }
    }
    /* UC-2 step 3: every edit is tried on a copy first; the page changes only when all of them can be made */
    apply(change, undoable = true) {
      const work = this.root.cloneNode(true), theme = {};
      for (const e of change.edits) {
        const why = this.one(work, e, theme);
        if (why) return { ok: false, why };
      }
      if (undoable) { this.undos.push(this.snapshot()); if (this.undos.length > 20) this.undos.shift(); }
      this.root.replaceChildren(...[...work.childNodes]);
      if (theme.accent) document.documentElement.style.setProperty('--accent', theme.accent);
      if (theme.size) document.documentElement.style.setProperty('--lp-scale', SCALE[theme.size]);
      return { ok: true };
    }
    undo() { const s = this.undos.pop(); if (!s) return false; this.restore(s); return true; }
    one(root, e, theme) {
      const sec = (id) => this.sections(root).find((s) => s.id === id) || null;
      const heading = (s) => s.querySelector(':scope > h2') || s.insertBefore(el('h2'), s.firstChild);
      const body = (s) => {
        let b = s.querySelector(':scope > .lp-body');
        if (!b) { b = el('div', { class: 'lp-body' }); for (const n of [...s.childNodes]) if (n !== heading(s)) b.append(n); s.append(b); }
        return b;
      };
      const place = (s, after) => {
        if (after === 'top') { root.prepend(s); return null; }
        const a = sec(after);
        if (!a || a === s) return 'the page has no part ' + after + ' to put it after';
        a.after(s);
        return null;
      };
      switch (e.op) {
        case 'rewrite': {
          const s = sec(e.part);
          if (!s) return 'the page has no part ' + e.part;
          if (e.title) heading(s).textContent = e.title;
          if (e.body) body(s).replaceChildren(Renderer.blocks(e.body));
          return null;
        }
        case 'add': {
          if (document.getElementById(e.part) || sec(e.part)) return 'the page already has a part ' + e.part;
          const s = el('section', { id: e.part }, el('h2', null, e.title), el('div', { class: 'lp-body' }, Renderer.blocks(e.body)));
          return place(s, e.after);
        }
        case 'remove': {
          const s = sec(e.part);
          if (!s) return 'the page has no part ' + e.part;
          s.remove();
          return null;
        }
        case 'move': {
          const s = sec(e.part);
          if (!s) return 'the page has no part ' + e.part;
          return place(s, e.after);
        }
        case 'theme':
          if (e.accent && !/^#[0-9a-fA-F]{6}$/.test(e.accent)) return 'the accent is not a #rrggbb colour';
          if (e.size && !SCALE[e.size]) return 'the size is not smaller, normal or larger';
          if (e.accent) theme.accent = e.accent;
          if (e.size) theme.size = e.size;
          return null;
        default:
          return 'there is no edit called ' + e.op;
      }
    }
  }

  /* ------------------------------------------------------------------------------- SideIndex: the sliding index */
  /* UC-4. Built from the page's own headings, so it can only name parts the page has, and built again after every change. */
  class SideIndex {
    constructor(scope) {
      this.scope = scope;
      const html = document.documentElement;
      html.classList.add('lp-index-on');
      const title = document.querySelector('h1');
      this.list = el('ol', { class: 'lp-index-parts' });
      this.closer = el('button', { type: 'button', class: 'lp-index-close', 'aria-label': 'Close the index', title: 'Close the index' }, '‹');
      this.nav = el('nav', { id: 'lp-index', class: 'lp-index', 'aria-label': 'Index' },
        el('div', { class: 'lp-index-head' }, el('strong', null, title ? title.textContent.trim() : document.title), this.closer), this.list);
      const links = document.querySelector('nav[data-lp-links]');
      if (links && links.querySelector('a')) {
        const pages = el('ul', { class: 'lp-index-pages' });
        for (const a of [...links.querySelectorAll('a')]) pages.append(el('li', null, a));
        this.nav.append(el('p', { class: 'lp-index-label' }, 'Pages'), pages);
        links.classList.add('lp-moved');
      }
      this.opener = el('button', { type: 'button', class: 'lp-index-show', 'aria-controls': 'lp-index', 'aria-expanded': 'false' }, el('span', { 'aria-hidden': 'true' }, '☰'), ' Index');
      this.backdrop = el('div', { class: 'lp-index-backdrop', hidden: '' });
      document.body.append(this.opener, this.nav, this.backdrop);
      this.wide = window.matchMedia('(min-width: 1000px)');
      this.opener.addEventListener('click', () => this.setOpen(true, true));
      this.closer.addEventListener('click', () => this.setOpen(false, true));
      this.backdrop.addEventListener('click', () => this.setOpen(false, false));
      this.nav.addEventListener('click', (e) => { if (e.target.closest('a') && !this.wide.matches) this.setOpen(false, false); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.wide.matches && this.open) this.setOpen(false, false); });
      this.wide.addEventListener('change', () => this.setOpen(this.wanted(), false));
      this.setOpen(this.wanted(), false);
      this.rebuild();
    }
    wanted() { const s = store.get('index'); return s ? s === 'open' : this.wide.matches; }
    setOpen(open, remember) {
      this.open = open;
      document.documentElement.classList.toggle('lp-index-open', open);
      this.opener.setAttribute('aria-expanded', String(open));
      this.backdrop.hidden = !(open && !this.wide.matches);
      if (remember) store.set('index', open ? 'open' : 'closed');
    }
    heads() {
      return [...this.scope.querySelectorAll('h2')].map((h) => ({ h, id: h.id || (h.parentElement.tagName === 'SECTION' && h.parentElement.id) || '' })).filter((x) => x.id);
    }
    rebuild() {
      const heads = this.heads();
      this.list.replaceChildren(...heads.map(({ h, id }) => el('li', null, el('a', { href: '#' + id, 'data-part': id }, h.textContent.trim()))));
      if (this.watch) this.watch.disconnect();
      if (!('IntersectionObserver' in window)) return;
      this.watch = new IntersectionObserver((seen) => {
        for (const s of seen) if (s.isIntersecting) this.mark(s.target.dataset.lpPart);
      }, { rootMargin: '0px 0px -70% 0px' });
      for (const { h, id } of heads) { h.dataset.lpPart = id; this.watch.observe(h); }
    }
    mark(id) { this.at = id; for (const a of this.list.querySelectorAll('a')) a.classList.toggle('on', a.dataset.part === id); }
  }

  /* ------------------------------------------------------------------------------------------- Chat: the panel */
  const CSS = `
:root{--lp-panel:var(--panel,#121C26);--lp-line:var(--line,#2E4052);--lp-well:var(--well,#0E1720);--lp-fg:var(--fg,#F4F2EC);
  --lp-soft:var(--soft,#C9D3DC);--lp-muted:var(--muted,#A9B7C4);--lp-accent:var(--accent,#F08A3C);--lp-font:var(--sans,system-ui,sans-serif);--lp-head:var(--head,system-ui,sans-serif)}
[data-lp-editable]{zoom:var(--lp-scale,1)}
.lp-chat{background:var(--lp-panel);border:1px solid var(--lp-line);border-radius:16px;padding:14px;font:15px/1.5 var(--lp-font);color:var(--lp-fg)}
.lp-chat [hidden]{display:none!important}
.lp-chat-top{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}
.lp-talk{display:inline-flex;align-items:center;gap:10px;border:0;border-radius:999px;background:var(--lp-accent);color:#111;font:700 16px/1 var(--lp-head);padding:12px 20px;cursor:pointer}
.lp-talk:disabled{opacity:.55;cursor:default}
.lp-dot{width:10px;height:10px;border-radius:50%;background:#111;opacity:.75}
.lp-talk.listening .lp-dot{animation:lp-pulse 1s ease-in-out infinite}
@keyframes lp-pulse{50%{transform:scale(1.7);opacity:.25}}
.lp-about{flex:1 1 220px;margin:0;color:var(--lp-muted);font-size:13.5px}
.lp-log{display:flex;flex-direction:column;gap:8px;max-height:280px;overflow:auto;margin:12px 0 0}
.lp-log:empty{display:none}
.lp-msg{max-width:88%;padding:8px 11px;border-radius:12px;white-space:pre-wrap;overflow-wrap:anywhere}
.lp-msg.claude{align-self:flex-start;background:rgba(255,255,255,.06)}
.lp-msg.claude::before{content:"Claude (AI)";display:block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--lp-muted);margin-bottom:2px}
.lp-msg.you{align-self:flex-end;background:var(--lp-well);border:1px solid var(--lp-line)}
.lp-msg.note{align-self:stretch;max-width:none;color:var(--lp-muted);font-size:13.5px;padding:2px 2px}
.lp-msg.note.bad{color:#F7B4B5}
.lp-change{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:12px 0 0;padding:8px 10px;border-radius:10px;border:1px dashed var(--lp-line);font-size:14px;color:var(--lp-soft)}
.lp-change span{flex:1 1 200px}
.lp-chat button.lp-small{font:600 12.5px var(--lp-font);color:var(--lp-fg);background:var(--lp-well);border:1px solid var(--lp-line);border-radius:8px;padding:5px 10px;cursor:pointer}
.lp-form{display:flex;gap:8px;margin:12px 0 0}
.lp-form input{flex:1;min-width:0;font:16px var(--lp-font);color:var(--lp-fg);background:var(--lp-well);border:1px solid var(--lp-line);border-radius:10px;padding:9px 11px}
.lp-form button{font:700 14px var(--lp-font);color:#111;background:var(--lp-accent);border:0;border-radius:10px;padding:9px 14px;cursor:pointer}
.lp-form input:disabled,.lp-form button:disabled{opacity:.5;cursor:default}
.lp-foot{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:2px 10px;margin:8px 0 0}
.lp-foot button{background:none;border:0;color:var(--lp-muted);font:12.5px var(--lp-font);cursor:pointer;padding:2px}
.lp-foot button:hover{color:var(--lp-fg)}
.lp-chat :focus-visible,.lp-index :focus-visible,.lp-index-show:focus-visible{outline:2px solid var(--lp-accent);outline-offset:2px}
#lp-float{position:fixed;right:16px;bottom:16px;z-index:30;width:min(380px,calc(100vw - 32px));display:flex;flex-direction:column;align-items:flex-end}
#lp-float .lp-chat{width:100%;box-shadow:0 10px 40px rgba(0,0,0,.5)}
#lp-float .lp-log{max-height:min(300px,40vh)}
.lp-tab{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:999px;background:var(--lp-panel);border:1px solid var(--lp-line);color:var(--lp-fg);font:700 14px var(--lp-head);cursor:pointer;box-shadow:0 6px 24px rgba(0,0,0,.4)}
.lp-tab .lp-dot{background:var(--lp-accent);opacity:1}
.lp-hide{align-self:flex-end}
.lp-flash{outline:2px solid var(--lp-accent);outline-offset:6px;border-radius:10px}
.lp-index{position:fixed;top:0;left:0;bottom:0;width:250px;z-index:40;box-sizing:border-box;background:var(--lp-panel);border-right:1px solid var(--lp-line);
  padding:14px 10px 24px;overflow-y:auto;transform:translateX(-100%);visibility:hidden;transition:transform .22s ease,visibility .22s;font:14px/1.4 var(--lp-font)}
.lp-index-open .lp-index{transform:none;visibility:visible}
.lp-index ol,.lp-index ul{list-style:none;margin:0;padding:0}
.lp-index a{display:block;padding:6px 10px;border-radius:8px;color:var(--lp-soft);text-decoration:none}
.lp-index a:hover{background:var(--lp-well);color:var(--lp-fg)}
.lp-index a.on{color:var(--lp-fg);background:var(--lp-well);box-shadow:inset 2px 0 0 var(--lp-accent)}
.lp-index-head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:0 0 10px 10px;margin:0 0 8px;border-bottom:1px solid var(--lp-line)}
.lp-index-head strong{font:600 15px/1.25 var(--lp-head);color:var(--lp-fg)}
.lp-index-close{background:none;border:1px solid var(--lp-line);border-radius:8px;color:var(--lp-soft);font:18px/1 var(--lp-font);width:30px;height:30px;cursor:pointer;flex:none}
.lp-index-label{margin:18px 10px 4px;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--lp-muted)}
.lp-index-show{position:fixed;top:10px;left:10px;z-index:35;display:inline-flex;align-items:center;gap:6px;padding:7px 12px;border-radius:999px;background:var(--lp-panel);
  border:1px solid var(--lp-line);color:var(--lp-soft);font:600 13px var(--lp-font);cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.35)}
.lp-index-open .lp-index-show{display:none}
.lp-index-backdrop{position:fixed;inset:0;z-index:39;background:rgba(0,0,0,.5)}
nav[data-lp-links].lp-moved{display:none}
@media (min-width:1000px){html.lp-index-open body{padding-left:250px}body{transition:padding-left .22s ease}}
@media (max-width:999px){html.lp-index-on body{padding-top:40px}}
@media (prefers-reduced-motion:reduce){.lp-index,body{transition:none}.lp-talk.listening .lp-dot{animation:none}}
`;

  class Chat {
    constructor(app) {
      this.app = app; this.voice = app.voice; this.relay = app.relay;
      this.history = []; this.busy = false; this.ready = false; this.greeted = false; this.last = null;
      const kept = (() => { try { return JSON.parse(store.get('chat.' + CFG.site, true) || 'null'); } catch (e) { return null; } })();
      if (kept && Array.isArray(kept.history)) this.history = kept.history.filter((t) => t && (t.role === 'user' || t.role === 'assistant') && typeof t.text === 'string');
      this.greeted = !!(kept && kept.greeted);
      this.build();
    }
    build() {
      const mount = CFG.mount ? document.querySelector(CFG.mount) : null;
      if (CFG.mount && !mount) throw new Error('living-page.js: data-mount "' + CFG.mount + '" matches nothing on this page');
      this.talk = el('button', { type: 'button', class: 'lp-talk' }, el('span', { class: 'lp-dot', 'aria-hidden': 'true' }), el('span', { class: 'lp-talk-label' }, 'Talk to this page'));
      this.about = el('p', { class: 'lp-about' }, 'Claude, an AI, answers aloud. Ask about anything here.');
      this.log = el('div', { class: 'lp-log', role: 'log', 'aria-live': 'polite' });
      this.changeText = el('span');
      this.undoBtn = el('button', { type: 'button', class: 'lp-small' }, 'Undo');
      this.keepBtn = el('button', { type: 'button', class: 'lp-small', hidden: '' }, 'Keep for everyone');
      this.bar = el('div', { class: 'lp-change', hidden: '' }, this.changeText, this.undoBtn, this.keepBtn);
      this.input = el('input', { maxlength: '600', autocomplete: 'off', placeholder: 'Or type here', 'aria-label': 'Your question or change', disabled: '' });
      this.send = el('button', { type: 'submit', disabled: '' }, 'Send');
      this.form = el('form', { class: 'lp-form' }, this.input, this.send);
      this.voiceBtn = el('button', { type: 'button' });
      this.ownerBtn = el('button', { type: 'button' }, 'Owner');
      this.resetBtn = el('button', { type: 'button', hidden: '' }, 'Reset page for everyone');
      const foot = el('div', { class: 'lp-foot' }, this.voiceBtn, this.resetBtn, this.ownerBtn);
      this.box = el('div', { class: 'lp-chat' + (mount ? ' lp-hero' : '') }, el('div', { class: 'lp-chat-top' }, this.talk, this.about), this.log, this.bar, this.form, foot);
      if (mount) mount.append(this.box);
      else {
        this.tab = el('button', { type: 'button', class: 'lp-tab', 'aria-expanded': 'false' }, el('span', { class: 'lp-dot', 'aria-hidden': 'true' }), 'Talk to this page');
        const hide = el('button', { type: 'button', class: 'lp-small' }, 'Hide');
        this.box.querySelector('.lp-chat-top').append(hide);
        this.float = el('section', { id: 'lp-float', 'aria-label': 'Talk to this page' }, this.box, this.tab);
        document.body.append(this.float);
        this.tab.addEventListener('click', () => this.show(true));
        hide.addEventListener('click', () => this.show(false));
        this.show(store.get('float', true) === 'open');
      }
      this.voiceBtn.hidden = !this.voice.canSpeak;
      this.paintVoice();
      this.talk.addEventListener('click', () => this.onTalk());
      this.form.addEventListener('submit', (e) => { e.preventDefault(); const q = this.input.value.trim(); if (q) this.ask(q); });
      this.voiceBtn.addEventListener('click', () => { this.voice.setOn(!this.voice.on); this.paintVoice(); });
      this.undoBtn.addEventListener('click', () => this.undo());
      this.keepBtn.addEventListener('click', () => this.keep());
      this.ownerBtn.addEventListener('click', () => this.onOwner());
      this.resetBtn.addEventListener('click', () => this.reset());
      for (const t of this.history) this.line(t.role === 'user' ? 'you' : 'claude', t.text);
    }
    show(open) {
      if (!this.float) return;
      this.box.hidden = !open; this.tab.hidden = open; this.tab.setAttribute('aria-expanded', String(open));
      store.set('float', open ? 'open' : 'shut', true);
      if (!open) this.voice.stop();
    }
    paintVoice() { this.voiceBtn.textContent = this.voice.on ? 'Voice on' : 'Voice off'; this.voiceBtn.setAttribute('aria-pressed', String(this.voice.on)); }
    save() { store.set('chat.' + CFG.site, JSON.stringify({ history: this.history, greeted: this.greeted }), true); }
    line(kind, text) {
      const p = el('div', { class: 'lp-msg ' + kind }, text);
      this.log.append(p); this.log.scrollTop = this.log.scrollHeight;
      return p;
    }
    setBusy(b) {
      this.busy = b;
      this.input.disabled = b || !this.ready; this.send.disabled = b || !this.ready;
      this.talk.disabled = b && !this.listening;
    }
    owned() { return this.app.ownerKey && this.app.editable; }
    paintOwner() {
      this.ownerBtn.textContent = this.app.ownerKey ? 'Owner: on' : 'Owner';
      this.resetBtn.hidden = !this.owned();
      this.keepBtn.hidden = !(this.owned() && this.last);
    }

    /* UC-1 step 1: the panel asks the relay whether the assistant is on */
    async start(health) {
      this.site = health.ok ? health.site : null;
      this.paintOwner();
      if (this.site) {
        const pg = this.site.pages[CFG.page];
        if (pg && pg.edit) this.about.textContent = 'Claude, an AI, answers aloud. Ask about anything here, or tell it how to change this page.';
      }
      if (!health.ok) { this.line('note bad', health.say); return; }
      if (!health.ready) { this.line('note bad', 'The assistant is not switched on yet: its relay has no Claude key.'); return; }
      this.ready = true; this.setBusy(false); this.paintOwner();
    }
    /* UC-1 step 2: Talk. The site's greeting the first time in this tab, then one take of listening */
    async onTalk() {
      if (this.listening) { this.voice.stop(); return; }
      this.voice.stop();
      if (!this.greeted && this.site) {
        this.greeted = true; this.save();
        const pg = this.site.pages[CFG.page];
        const hello = this.site.greeting + (pg && pg.edit ? ' You can also tell me how to change this page.' : '');
        this.line('note', hello);
        await this.voice.say(hello);
      }
      if (!this.ready) {
        const why = this.site ? 'I am not switched on yet: my relay has no Claude key.' : 'I could not reach my relay.';
        this.line('note bad', why); await this.voice.say(why); return;
      }
      if (!this.voice.canListen) { this.line('note', 'This browser cannot listen. Type below instead.'); this.input.focus(); return; }
      this.listening = true; this.talk.classList.add('listening');
      this.talk.querySelector('.lp-talk-label').textContent = 'Listening... tap to stop';
      this.setBusy(true);
      const heard = await this.voice.listen((words) => { this.input.value = words; });
      this.listening = false; this.talk.classList.remove('listening');
      this.talk.querySelector('.lp-talk-label').textContent = 'Talk to this page';
      this.setBusy(false);
      if (!heard.ok) { this.input.value = ''; this.line('note', heard.why); this.voice.say(heard.why); return; }
      this.ask(heard.text);
    }
    /* where the visitor is: the part in view is named only when the relay will know it (the page's own parts, or one on
       the page now), since the relay refuses a question that names a part it does not know */
    where() {
      const parts = this.app.editable ? this.app.editor.view() : [];
      let at = this.app.index ? this.app.index.at || '' : '';
      if (at && !parts.some((p) => p.id === at) && !this.app.parts.has(at)) at = '';
      return { page: CFG.page, at, parts };
    }
    /* UC-1 steps 3 to 5 and UC-2: a question or a change */
    async ask(q) {
      if (this.busy || !this.ready) return;
      this.voice.stop();
      while (this.history.length > 13) this.history.splice(0, 2);
      this.history.push({ role: 'user', text: q });
      this.line('you', q);
      this.input.value = '';
      this.setBusy(true);
      const wait = this.line('note', 'Claude is thinking...');
      const r = await this.relay.chat(this.history, this.where());
      wait.remove();
      if (!r.ok) {
        this.history.pop();
        this.line('note bad', r.say);
        this.input.value = q;
        this.voice.say(r.say);
      } else {
        this.history.push({ role: 'assistant', text: r.text });
        this.line('claude', r.text + (r.cut ? ' [cut short]' : ''));
        this.voice.say(r.text);
        for (const a of r.actions || []) {
          if (a.name === 'show_part') this.showPart(a);
          else if (a.name === 'change_page') this.change(a);
        }
      }
      this.save();
      this.setBusy(false);
    }
    showPart(a) {
      if (a.page && a.page !== CFG.page && this.site && this.site.pages[a.page]) {
        this.save();
        location.href = this.site.pages[a.page].url + '#' + encodeURIComponent(a.part);
        return;
      }
      const target = document.getElementById(a.part);
      if (!target) { this.line('note bad', 'This page has no part called ' + a.part + '.'); return; }
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.classList.add('lp-flash');
      setTimeout(() => target.classList.remove('lp-flash'), 2200);
    }
    /* UC-2 step 3: the change, made at once for this visitor, with Undo */
    change(a) {
      if (!this.app.editable) { this.line('note bad', 'This page cannot be changed.'); return; }
      const done = this.app.editor.apply(a);
      if (!done.ok) { this.line('note bad', 'That change could not be made: ' + done.why + '.'); return; }
      if (this.app.index) this.app.index.rebuild();
      this.last = { summary: a.summary, edits: a.edits };
      this.changeText.textContent = 'Changed for you only: ' + a.summary;
      this.bar.hidden = false; this.undoBtn.hidden = false;
      this.paintOwner();
    }
    undo() {
      if (!this.app.editor.undo()) return;
      if (this.app.index) this.app.index.rebuild();
      this.last = null;
      this.bar.hidden = true;
      this.line('note', 'Undone.');
    }
    /* UC-3: the owner keeps the last change for everyone, or resets the page */
    async keep() {
      if (!this.last || !this.owned()) return;
      const r = await this.relay.keep(CFG.page, this.last, this.app.ownerKey);
      if (!r.ok) { this.line('note bad', r.say); return; }
      this.changeText.textContent = 'Kept for everyone: ' + this.last.summary;
      this.undoBtn.hidden = true; this.keepBtn.hidden = true; this.last = null;
      this.app.editor.undos = [];
    }
    async onOwner() {
      if (this.app.ownerKey) {
        if (window.confirm('Forget the owner key in this browser?')) { store.del('owner.' + CFG.site); this.app.ownerKey = ''; this.paintOwner(); this.line('note', 'Owner key forgotten here.'); }
        return;
      }
      const key = (window.prompt('Paste this site\'s owner key. It stays in this browser only.') || '').trim();
      if (!key) return;
      const r = await this.relay.owner(key);
      if (!r.ok) { this.line('note bad', r.say); return; }
      store.set('owner.' + CFG.site, key);
      this.app.ownerKey = key;
      this.paintOwner();
      this.line('note', this.app.editable ? 'Owner mode: you can keep a change for everyone, or reset the page.' : 'Owner mode is on. This page cannot be changed, so there is nothing to keep here.');
    }
    async reset() {
      if (!this.owned() || !window.confirm('Reset this page for everyone, back to its published version?')) return;
      const r = await this.relay.reset(CFG.page, this.app.ownerKey);
      if (!r.ok) { this.line('note bad', r.say); return; }
      location.reload();
    }
  }

  /* ------------------------------------------------------------------------------- LivingPage: wires them together */
  class LivingPage {
    constructor() {
      this.relay = new Relay(CFG.relay, CFG.site);
      this.voice = new Voice();
      this.ownerKey = store.get('owner.' + CFG.site) || '';
      this.root = document.querySelector('[data-lp-editable]');
      this.editor = this.root ? new PageEditor(this.root) : null;
      this.editable = false;
      this.parts = new Set();
      document.head.append(el('style', { id: 'living-page-css' }, CSS));
      this.index = CFG.index ? new SideIndex(document.querySelector('main') || document.body) : null;
      this.chat = CFG.chat ? new Chat(this) : null;
    }
    async start() {
      const health = await this.relay.health();
      const page = health.ok && health.site.pages[CFG.page];
      if (health.ok && !page) { if (this.chat) this.chat.line('note bad', 'The relay has no page called ' + CFG.page + ' for this site.'); return; }
      this.editable = !!(page && page.edit && this.editor);
      this.parts = new Set(page ? page.parts : []);
      // UC-3: the changes the owner kept, applied for every visitor before anything else; a kept change that no longer fits
      // the page is shown to the owner, never silently skipped
      if (this.editable) {
        const k = await this.relay.kept(CFG.page);
        if (!k.ok) { if (this.chat) this.chat.line('note bad', k.say); }
        else {
          const misfits = [];
          for (const c of k.changes) { const r = this.editor.apply(c, false); if (!r.ok) misfits.push(c.summary + ' (' + r.why + ')'); }
          if (misfits.length && this.ownerKey && this.chat) this.chat.line('note bad', misfits.length + ' kept change(s) no longer fit this page: ' + misfits.join('; '));
          if (this.index) this.index.rebuild();
        }
      }
      if (this.chat) await this.chat.start(health);
    }
  }

  const app = new LivingPage();
  window.LivingPage = { version: VERSION, app };
  app.start();
})();
