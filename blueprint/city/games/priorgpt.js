// games/priorgpt.js - PriorGPT playing in the Blueprint City (UC-PG6 step 3): the model writes with its priors beside it, one
// character a frame, on the program printed from its graphs, and every statement that program runs lights its node in the city,
// the way Pong's nodes light while Pong plays. Written by priorgpt/city_data.mjs from priorgpt/city/game.js; never edit the copy.
//
// Before anything runs it prints the set's graphs again (js_graph.js) and compares the text with the PriorGPT page's core.js:
// a program that is not the one printed from these graphs is refused and nothing plays (UC-PG6 step 4, R1). The model, the
// priors and the writing are core.js's own (Mixer.begin and Mixer.next); this file only loads them, paces them and draws.
(function (root) {
  'use strict';
  // the PriorGPT page's folder: on the site it stands beside blueprint/ (anchor-demo/priorgpt/). Made absolute against the
  // page: fetch() reads a relative address from the page, but import() from this script's own folder (games/), which
  // missed by one level (measured 11-11: it asked for /blueprint/priorgpt/core.js)
  const SITE = new URL(root.PRIORGPT_SITE || '../../priorgpt/', root.document.baseURI).href;
  // AUTHORED here, every one: how fast it writes and how much before the next prompt
  const PACE = { perSecond: 30, perPrompt: 240, speakers: 12 };

  function script(src) {
    return new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = ok;
      s.onerror = () => no(new Error('could not load ' + src));
      document.head.append(s);
    });
  }

  // the running game's listener. The printed program reads globalThis.__bpNode once, when it loads (const __bpNode = ...),
  // so the probe set here is one that never changes and hands each statement to whichever game is running now (measured
  // 11-11: a second game's own listener heard nothing, because the program had kept the first one's)
  let listener = null;
  let names = null;

  async function load(state, graphs, onNode) {
    if (!root.JSGRAPH) await script(SITE + 'js_graph.js');
    const printed = root.JSGRAPH.printModule(graphs, { probe: '__bpNode' });
    const served = await fetch(SITE + 'core.js', { cache: 'no-store' }).then((r) => r.text());
    if (printed !== served) throw new Error('not started: the PriorGPT page\'s core.js (' + served.length + ' characters) is not the program printed from these graphs (' + printed.length + ')');
    // a statement's probe names its graph by its place in the printed order, the same order as these graphs
    names = graphs.map((g) => g.name);
    listener = onNode;
    // the City counts a graph's runs at its entry; every graph's body starts at s1 (city_data.mjs checks it), so s1's probe
    // is the graph being entered, once a call
    if (!root.__bpNode) {
      root.__bpNode = (g, id) => {
        if (!listener) return;
        if (id === 's1') listener(names[g], 'entry');
        listener(names[g], id);
      };
    }
    state.said = 'Loading the weights and the training text...';
    const core = await import(SITE + 'core.js');
    const get = (f) => fetch(SITE + 'data/' + f).then((r) => { if (!r.ok) throw new Error(f + ': HTTP ' + r.status); return r; });
    const [meta, report, half, text] = await Promise.all([get('meta.json').then((r) => r.json()), get('report.json').then((r) => r.json()),
      get('weights.f16').then((r) => r.arrayBuffer()), get('priors.txt').then((r) => r.text())]);
    const vocab = new core.Vocab(meta.chars);
    const gpt = new core.Gpt(new core.Weights(meta.weights, core.halfToFloat(new Uint16Array(half))), meta.hyper, vocab);
    const priors = new core.Priors(text, vocab, { name: meta.dataset + ', the notebook\'s training split', licence: meta.licence, url: meta.dataset_url });
    // the prompts: the speakers who speak most often in the priors, each as the training text names a speaker
    const speakers = [...priors.speakers].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1)).slice(0, PACE.speakers).map((e) => e[0]);
    return { core, gpt, priors, mixer: new core.Mixer(priors, report.lm.lambdas, report.lm.max), prompts: speakers.map((s) => '\n\n' + s + ':\n'), printed: printed.length };
  }

  /** create - PriorGPT writing on its graphs. opts: graphs (the City's parse of the set's core.ngl), onNode(graph, id) */
  function create(opts) {
    const state = { t: 0, said: 'Checking the program against the graphs...', error: null, written: [], prompt: '', count: 0, prompts: 0, hits: {}, goals: [0, 0], level: 'PriorGPT' };
    let eng = null;
    let writer = null;
    let wall = 0;
    load(state, opts.graphs, opts.onNode).then((e) => {
      eng = e;
      state.said = 'The program printed from ' + opts.graphs.length + ' graphs, checked: the same ' + e.printed + ' characters as the PriorGPT page\'s core.js.';
    }).catch((e) => { state.error = e.message; state.said = e.message; });

    function nextPrompt() {
      state.prompt = eng.prompts[state.prompts % eng.prompts.length];
      state.prompts += 1;
      state.written = [];
      writer = eng.mixer.begin(eng.gpt, state.prompt);
    }

    return {
      state,
      step(dt) {
        state.t += dt;
        if (!eng || state.error) return;
        // one character per frame at most: the City steps several times a frame to catch up, and a character is ~25 ms of model
        const now = performance.now();
        if (now - wall < 1000 / PACE.perSecond) return;
        wall = now;
        if (!writer || state.written.length >= PACE.perPrompt) nextPrompt();
        state.written.push(eng.mixer.next(writer));
        state.count += 1;
      },
      draw(ctx, w, h) { draw(ctx, w, h, state); },
      who() {
        if (state.error) return 'stopped: ' + state.error;
        if (!state.written.length) return state.said;
        const c = state.written[state.written.length - 1];
        return 'writing as ' + state.prompt.trim() + ' - ' + state.count + ' characters so far; the last ' + c.matched + ' occur '
          + (c.places === 1 ? 'once' : c.places + ' times') + ' in the training text' + (c.line ? ', one of them at line ' + c.line : '');
      },
    };
  }

  // ---------------------------------------------------------------- the picture: the text as it is written, shaded by its priors
  function draw(ctx, w, h, state) {
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, w, h);
    ctx.font = '13px "IBM Plex Mono", ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    const pad = 14;
    const lineH = 18;
    const cw = ctx.measureText('M').width;
    const cols = Math.max(10, Math.floor((w - 2 * pad) / cw));
    let x = 0;
    let y = 0;
    const put = (ch, bg, fg) => {
      if (ch === '\n' || x >= cols) { x = 0; y += 1; if (ch === '\n') return; }
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(pad + x * cw, pad + y * lineH - 2, cw + 0.5, lineH); }
      ctx.fillStyle = fg;
      ctx.fillText(ch, pad + x * cw, pad + y * lineH);
      x += 1;
    };
    for (const ch of state.prompt.replace(/^\n+/, '')) put(ch, null, '#93a4bf');
    for (const c of state.written) {
      // brighter where a longer stretch of the training text backs it, dark where the priors hold nothing ending there
      const k = Math.min(1, c.matched / 24);
      put(c.char, c.matched ? 'rgba(' + Math.round(43 + 63 * k) + ',' + Math.round(58 + 107 * k) + ',' + Math.round(74 + 48 * k) + ',0.9)' : 'rgba(43,58,74,0.35)', '#e4ebf5');
    }
    ctx.fillStyle = state.error ? '#ff8f6b' : '#93a4bf';
    ctx.fillText(state.error ? state.error : state.said, pad, h - pad - 14);
  }

  const authored = [
    'the pace: at most ' + PACE.perSecond + ' characters a second, one a frame, so the city keeps moving while the model computes',
    'the prompts: the ' + PACE.speakers + ' speakers who speak most often in the priors, ' + PACE.perPrompt + ' characters each, then the next',
    'everything written, and every node lit, is core.js\'s own: Mixer.begin and Mixer.next, the model and its priors',
  ];
  const api = { create, authored, title: 'PriorGPT', touch: () => [], keyset: [], pauseKey: ' ',
    keys: 'The model writes by itself, one character a frame; every statement it runs lights in the city. Space pauses. W A S D still fly.' };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else (root.CITY_GAMES = root.CITY_GAMES || {}).priorgpt = api;
})(typeof window !== 'undefined' ? window : globalThis);
