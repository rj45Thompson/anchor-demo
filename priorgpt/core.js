const __bpNode = globalThis.__bpNode;
import { attend, editDistance, halfToFloat, layerNorm, linear, sortSuffixes } from './kernels.js';
export { halfToFloat };
__bpNode(2, "s1");
export const Version = 'priorgpt 1';
__bpNode(3, "s1");
export const Status = Object.freeze({ Read: 'READ', Ambiguous: 'AMBIGUOUS', Absent: 'ABSENT', Refused: 'REFUSED' });
export class Vocab {
  constructor(chars) {
    __bpNode(5, "s1");
    this.chars = chars;
    __bpNode(5, "s2");
    this.ids = new Map();
    __bpNode(5, "s3");
    for (let i = 0; i < chars.length; i++) {
      __bpNode(5, "s4");
      this.ids.set(chars[i], i);
    }
  }
  has(c) {
    __bpNode(6, "s1");
    return this.ids.has(c);
  }
  encode(text) {
    __bpNode(7, "s1");
    const out = new Int32Array(text.length);
    __bpNode(7, "s2");
    for (let i = 0; i < text.length; i++) {
      __bpNode(7, "s3");
      const id = this.ids.get(text[i]);
      __bpNode(7, "s4");
      if (id === undefined) {
        __bpNode(7, "s5");
        throw new Error('the character ' + JSON.stringify(text[i]) + ' is not in the model\'s vocabulary');
      }
      __bpNode(7, "s6");
      out[i] = id;
    }
    __bpNode(7, "s7");
    return out;
  }
  decode(ids) {
    __bpNode(8, "s1");
    let s = '';
    __bpNode(8, "s2");
    for (let i = 0; i < ids.length; i++) {
      __bpNode(8, "s3");
      s += this.chars[ids[i]];
    }
    __bpNode(8, "s4");
    return s;
  }
}
export class Weights {
  constructor(manifest, floats) {
    __bpNode(10, "s1");
    this.byName = new Map();
    __bpNode(10, "s2");
    let total = 0;
    __bpNode(10, "s3");
    for (const w of manifest) {
      __bpNode(10, "s4");
      this.byName.set(w.name, { shape: w.shape, data: floats.subarray(w.offset, w.offset + w.count) });
      __bpNode(10, "s5");
      total += w.count;
    }
    __bpNode(10, "s6");
    if (total !== floats.length) {
      __bpNode(10, "s7");
      throw new Error('the weights hold ' + floats.length + ' floats but the manifest names ' + total);
    }
    __bpNode(10, "s8");
    this.count = total;
  }
  get(name) {
    __bpNode(11, "s1");
    const w = this.byName.get(name);
    __bpNode(11, "s2");
    if (!w) {
      __bpNode(11, "s3");
      throw new Error('no weight named ' + name);
    }
    __bpNode(11, "s4");
    return w.data;
  }
  shape(name) {
    __bpNode(12, "s1");
    return this.byName.get(name).shape;
  }
}
export class Gpt {
  constructor(weights, hyper, vocab) {
    __bpNode(14, "s1");
    this.w = weights;
    __bpNode(14, "s2");
    this.vocab = vocab;
    __bpNode(14, "s3");
    this.C = hyper.n_embed;
    __bpNode(14, "s4");
    this.H = hyper.n_heads;
    __bpNode(14, "s5");
    this.L = hyper.n_layers;
    __bpNode(14, "s6");
    this.T = hyper.block_size;
    __bpNode(14, "s7");
    this.V = vocab.chars.length;
    __bpNode(14, "s8");
    this.hs = this.C / this.H;
    __bpNode(14, "s9");
    this.scale = 1 / Math.sqrt(this.C);
    __bpNode(14, "s10");
    this.layers = [];
    __bpNode(14, "s11");
    for (let l = 0; l < this.L; l++) {
      __bpNode(14, "s12");
      const p = 'blocks.' + l + '.';
      __bpNode(14, "s13");
      const heads = [];
      __bpNode(14, "s14");
      for (let h = 0; h < this.H; h++) {
        __bpNode(14, "s15");
        const q = p + 'sa.heads.' + h + '.';
        __bpNode(14, "s16");
        heads.push({ key: weights.get(q + 'key.weight'), query: weights.get(q + 'query.weight'), value: weights.get(q + 'value.weight') });
      }
      __bpNode(14, "s17");
      this.layers.push({
        heads,
        proj: weights.get(p + 'sa.proj.weight'), projB: weights.get(p + 'sa.proj.bias'),
        ln1: weights.get(p + 'ln1.weight'), ln1B: weights.get(p + 'ln1.bias'),
        ln2: weights.get(p + 'ln2.weight'), ln2B: weights.get(p + 'ln2.bias'),
        ff1: weights.get(p + 'ff.net.0.weight'), ff1B: weights.get(p + 'ff.net.0.bias'),
        ff2: weights.get(p + 'ff.net.2.weight'), ff2B: weights.get(p + 'ff.net.2.bias'),
      });
    }
    __bpNode(14, "s18");
    this.tok = weights.get('token_embedding_table.weight');
    __bpNode(14, "s19");
    this.pos = weights.get('position_embedding_table.weight');
    __bpNode(14, "s20");
    this.lnf = weights.get('ln_f.weight');
    __bpNode(14, "s21");
    this.lnfB = weights.get('ln_f.bias');
    __bpNode(14, "s22");
    this.head = weights.get('lm_head.weight');
    __bpNode(14, "s23");
    this.headB = weights.get('lm_head.bias');
    __bpNode(14, "s24");
    this.keys = [];
    __bpNode(14, "s25");
    this.values = [];
    __bpNode(14, "s26");
    for (let l = 0; l < this.L; l++) {
      __bpNode(14, "s27");
      this.keys.push(new Float32Array(this.T * this.C));
      __bpNode(14, "s28");
      this.values.push(new Float32Array(this.T * this.C));
    }
    __bpNode(14, "s29");
    this.x = new Float32Array(this.C);
    __bpNode(14, "s30");
    this.h = new Float32Array(this.C);
    __bpNode(14, "s31");
    this.att = new Float32Array(this.C);
    __bpNode(14, "s32");
    this.o = new Float32Array(this.C);
    __bpNode(14, "s33");
    this.ff = new Float32Array(4 * this.C);
    __bpNode(14, "s34");
    this.wei = new Float32Array(this.T);
    __bpNode(14, "s35");
    this.q = new Float32Array(this.hs);
    __bpNode(14, "s36");
    this.logitsOut = new Float32Array(this.V);
    __bpNode(14, "s37");
    this.history = [];
    __bpNode(14, "s38");
    this.t = 0;
  }
  reset() {
    __bpNode(15, "s1");
    this.t = 0;
    __bpNode(15, "s2");
    this.history = [];
  }
  feed(id) {
    __bpNode(16, "s1");
    if (this.t === this.T) {
      __bpNode(16, "s2");
      const keep = this.history.slice(this.history.length - this.T + 1);
      __bpNode(16, "s3");
      this.reset();
      __bpNode(16, "s4");
      for (const k of keep) {
        __bpNode(16, "s5");
        this.step(k);
      }
    }
    __bpNode(16, "s6");
    return this.step(id);
  }
  step(id) {
    __bpNode(17, "s1");
    const C = this.C;
    __bpNode(17, "s2");
    const hs = this.hs;
    __bpNode(17, "s3");
    const t = this.t;
    __bpNode(17, "s4");
    const x = this.x;
    __bpNode(17, "s5");
    for (let i = 0; i < C; i++) {
      __bpNode(17, "s6");
      x[i] = this.tok[id * C + i] + this.pos[t * C + i];
    }
    __bpNode(17, "s7");
    for (let l = 0; l < this.L; l++) {
      __bpNode(17, "s8");
      const layer = this.layers[l];
      __bpNode(17, "s9");
      const K = this.keys[l];
      __bpNode(17, "s10");
      const Vv = this.values[l];
      __bpNode(17, "s11");
      layerNorm(x, layer.ln1, layer.ln1B, C, this.h);
      __bpNode(17, "s12");
      for (let hd = 0; hd < this.H; hd++) {
        __bpNode(17, "s13");
        const head = layer.heads[hd];
        __bpNode(17, "s14");
        const base = hd * hs;
        __bpNode(17, "s15");
        linear(head.query, null, this.h, C, hs, this.q);
        __bpNode(17, "s16");
        linear(head.key, null, this.h, C, hs, K.subarray(t * C + base, t * C + base + hs));
        __bpNode(17, "s17");
        linear(head.value, null, this.h, C, hs, Vv.subarray(t * C + base, t * C + base + hs));
        __bpNode(17, "s18");
        attend(this.q, K, Vv, t, C, base, hs, this.scale, this.wei, this.att);
      }
      __bpNode(17, "s19");
      linear(layer.proj, layer.projB, this.att, C, C, this.o);
      __bpNode(17, "s20");
      for (let i = 0; i < C; i++) {
        __bpNode(17, "s21");
        x[i] += this.o[i];
      }
      __bpNode(17, "s22");
      layerNorm(x, layer.ln2, layer.ln2B, C, this.h);
      __bpNode(17, "s23");
      linear(layer.ff1, layer.ff1B, this.h, C, 4 * C, this.ff);
      __bpNode(17, "s24");
      for (let i = 0; i < 4 * C; i++) {
        __bpNode(17, "s25");
        if (this.ff[i] < 0) {
          __bpNode(17, "s26");
          this.ff[i] = 0;
        }
      }
      __bpNode(17, "s27");
      linear(layer.ff2, layer.ff2B, this.ff, 4 * C, C, this.o);
      __bpNode(17, "s28");
      for (let i = 0; i < C; i++) {
        __bpNode(17, "s29");
        x[i] += this.o[i];
      }
    }
    __bpNode(17, "s30");
    layerNorm(x, this.lnf, this.lnfB, C, this.h);
    __bpNode(17, "s31");
    linear(this.head, this.headB, this.h, C, this.V, this.logitsOut);
    __bpNode(17, "s32");
    this.history.push(id);
    __bpNode(17, "s33");
    this.t += 1;
    __bpNode(17, "s34");
    return this.logitsOut;
  }
  read(text) {
    __bpNode(18, "s1");
    const ids = this.vocab.encode(text);
    __bpNode(18, "s2");
    let out = null;
    __bpNode(18, "s3");
    for (const id of ids) {
      __bpNode(18, "s4");
      out = this.feed(id);
    }
    __bpNode(18, "s5");
    return out;
  }
  score(context, continuation) {
    __bpNode(19, "s1");
    this.reset();
    __bpNode(19, "s2");
    let logits = this.read(context);
    __bpNode(19, "s3");
    const ids = this.vocab.encode(continuation);
    __bpNode(19, "s4");
    let total = 0;
    __bpNode(19, "s5");
    for (const id of ids) {
      __bpNode(19, "s6");
      total += logSoftmaxAt(logits, id);
      __bpNode(19, "s7");
      logits = this.feed(id);
    }
    __bpNode(19, "s8");
    return total;
  }
  greedyLines(context, lines, max) {
    __bpNode(20, "s1");
    this.reset();
    __bpNode(20, "s2");
    let logits = this.read(context);
    __bpNode(20, "s3");
    let out = '';
    __bpNode(20, "s4");
    let seen = 0;
    __bpNode(20, "s5");
    while (out.length < max) {
      __bpNode(20, "s6");
      const id = argmax(logits);
      __bpNode(20, "s7");
      const c = this.vocab.chars[id];
      __bpNode(20, "s8");
      if (c === '\n') {
        __bpNode(20, "s9");
        seen += 1;
        __bpNode(20, "s10");
        if (seen === lines) {
          __bpNode(20, "s11");
          break;
        }
      }
      __bpNode(20, "s12");
      out += c;
      __bpNode(20, "s13");
      logits = this.feed(id);
    }
    __bpNode(20, "s14");
    return out;
  }
  greedy(context, stop, max) {
    __bpNode(21, "s1");
    this.reset();
    __bpNode(21, "s2");
    let logits = this.read(context);
    __bpNode(21, "s3");
    let out = '';
    __bpNode(21, "s4");
    while (out.length < max) {
      __bpNode(21, "s5");
      const id = argmax(logits);
      __bpNode(21, "s6");
      const c = this.vocab.chars[id];
      __bpNode(21, "s7");
      if (c === stop) {
        __bpNode(21, "s8");
        break;
      }
      __bpNode(21, "s9");
      out += c;
      __bpNode(21, "s10");
      logits = this.feed(id);
    }
    __bpNode(21, "s11");
    return out;
  }
}
export function argmax(xs) {
  __bpNode(22, "s1");
  let best = 0;
  __bpNode(22, "s2");
  for (let i = 1; i < xs.length; i++) {
    __bpNode(22, "s3");
    if (xs[i] > xs[best]) {
      __bpNode(22, "s4");
      best = i;
    }
  }
  __bpNode(22, "s5");
  return best;
}
export function logSoftmaxAt(logits, id) {
  __bpNode(23, "s1");
  let max = -Infinity;
  __bpNode(23, "s2");
  for (let i = 0; i < logits.length; i++) {
    __bpNode(23, "s3");
    if (logits[i] > max) {
      __bpNode(23, "s4");
      max = logits[i];
    }
  }
  __bpNode(23, "s5");
  let sum = 0;
  __bpNode(23, "s6");
  for (let i = 0; i < logits.length; i++) {
    __bpNode(23, "s7");
    sum += Math.exp(logits[i] - max);
  }
  __bpNode(23, "s8");
  return logits[id] - max - Math.log(sum);
}
export function softmax(logits) {
  __bpNode(24, "s1");
  const out = new Float64Array(logits.length);
  __bpNode(24, "s2");
  let max = -Infinity;
  __bpNode(24, "s3");
  for (let i = 0; i < logits.length; i++) {
    __bpNode(24, "s4");
    if (logits[i] > max) {
      __bpNode(24, "s5");
      max = logits[i];
    }
  }
  __bpNode(24, "s6");
  let sum = 0;
  __bpNode(24, "s7");
  for (let i = 0; i < logits.length; i++) {
    __bpNode(24, "s8");
    out[i] = Math.exp(logits[i] - max);
    __bpNode(24, "s9");
    sum += out[i];
  }
  __bpNode(24, "s10");
  for (let i = 0; i < logits.length; i++) {
    __bpNode(24, "s11");
    out[i] /= sum;
  }
  __bpNode(24, "s12");
  return out;
}
export class SuffixArray {
  constructor(codes, alphabet) {
    __bpNode(26, "s1");
    this.s = codes;
    __bpNode(26, "s2");
    this.n = codes.length;
    __bpNode(26, "s3");
    this.sa = SuffixArray.build(codes, alphabet);
  }
  static build(s, alphabet) {
    __bpNode(27, "s1");
    return sortSuffixes(s, alphabet);
  }
  narrow(lo, hi, d, code) {
    __bpNode(28, "s1");
    const s = this.s;
    __bpNode(28, "s2");
    const sa = this.sa;
    __bpNode(28, "s3");
    const n = this.n;
    __bpNode(28, "s4");
    let a = lo;
    __bpNode(28, "s5");
    let b = hi;
    __bpNode(28, "s6");
    while (a < b) {
      __bpNode(28, "s7");
      const m = (a + b) >> 1;
      __bpNode(28, "s8");
      const p = sa[m] + d;
      __bpNode(28, "s9");
      const c = p < n ? s[p] : -1;
      __bpNode(28, "s10");
      if (c < code) {
        __bpNode(28, "s11");
        a = m + 1;
      } else {
        __bpNode(28, "s12");
        b = m;
      }
    }
    __bpNode(28, "s13");
    const first = a;
    __bpNode(28, "s14");
    b = hi;
    __bpNode(28, "s15");
    while (a < b) {
      __bpNode(28, "s16");
      const m = (a + b) >> 1;
      __bpNode(28, "s17");
      const p = sa[m] + d;
      __bpNode(28, "s18");
      const c = p < n ? s[p] : -1;
      __bpNode(28, "s19");
      if (c <= code) {
        __bpNode(28, "s20");
        a = m + 1;
      } else {
        __bpNode(28, "s21");
        b = m;
      }
    }
    __bpNode(28, "s22");
    return [first, a];
  }
  range(pattern) {
    __bpNode(29, "s1");
    let lo = 0;
    __bpNode(29, "s2");
    let hi = this.n;
    __bpNode(29, "s3");
    for (let d = 0; d < pattern.length && lo < hi; d++) {
      __bpNode(29, "s4");
      const r = this.narrow(lo, hi, d, pattern[d]);
      __bpNode(29, "s5");
      lo = r[0];
      __bpNode(29, "s6");
      hi = r[1];
    }
    __bpNode(29, "s7");
    return [lo, hi];
  }
  offsets(pattern) {
    __bpNode(30, "s1");
    const r = this.range(pattern);
    __bpNode(30, "s2");
    const out = Array.from(this.sa.subarray(r[0], r[1]));
    __bpNode(30, "s3");
    out.sort((a, b) => a - b);
    __bpNode(30, "s4");
    return out;
  }
}
export class Priors {
  constructor(text, vocab, source) {
    __bpNode(32, "s1");
    this.vocab = vocab;
    __bpNode(32, "s2");
    this.alphabet = vocab.chars.slice();
    __bpNode(32, "s3");
    this.codeOf = new Map(vocab.ids);
    __bpNode(32, "s4");
    this.docs = [];
    __bpNode(32, "s5");
    this.text = '';
    __bpNode(32, "s6");
    this.lines = [];
    __bpNode(32, "s7");
    this.speeches = [];
    __bpNode(32, "s8");
    this.speakers = new Map();
    __bpNode(32, "s9");
    this.words = new Map();
    __bpNode(32, "s10");
    this.add(text, source);
  }
  add(text, source) {
    __bpNode(33, "s1");
    const started = Date.now();
    __bpNode(33, "s2");
    if (this.text.length && !this.text.endsWith('\n')) {
      __bpNode(33, "s3");
      this.text += '\n';
    }
    __bpNode(33, "s4");
    const doc = { id: this.docs.length, source: source.name, licence: source.licence, url: source.url || null,
      start: this.text.length, end: this.text.length + text.length, firstLine: this.lines.length };
    __bpNode(33, "s5");
    this.text += text;
    __bpNode(33, "s6");
    for (const c of text) {
      __bpNode(33, "s7");
      if (!this.codeOf.has(c)) {
        __bpNode(33, "s8");
        this.codeOf.set(c, this.alphabet.length);
        __bpNode(33, "s9");
        this.alphabet.push(c);
      }
    }
    __bpNode(33, "s10");
    this.docs.push(doc);
    __bpNode(33, "s11");
    this.readStructure(doc);
    __bpNode(33, "s12");
    this.codes = this.encode(this.text);
    __bpNode(33, "s13");
    this.index = new SuffixArray(this.codes, this.alphabet.length);
    __bpNode(33, "s14");
    doc.lastLine = this.lines.length - 1;
    __bpNode(33, "s15");
    doc.ms = Date.now() - started;
    __bpNode(33, "s16");
    return doc;
  }
  readStructure(doc) {
    __bpNode(34, "s1");
    const text = this.text;
    __bpNode(34, "s2");
    let at = doc.start;
    __bpNode(34, "s3");
    let speech = null;
    __bpNode(34, "s4");
    let prevSpeech = this.speeches.length ? this.speeches[this.speeches.length - 1] : null;
    __bpNode(34, "s5");
    while (at < doc.end) {
      __bpNode(34, "s6");
      let end = text.indexOf('\n', at);
      __bpNode(34, "s7");
      if (end < 0 || end > doc.end) {
        __bpNode(34, "s8");
        end = doc.end;
      }
      __bpNode(34, "s9");
      const lineText = text.slice(at, end);
      __bpNode(34, "s10");
      const line = { id: this.lines.length, start: at, end, text: lineText, doc: doc.id, speech: -1 };
      __bpNode(34, "s11");
      this.lines.push(line);
      __bpNode(34, "s12");
      if (lineText === '') {
        __bpNode(34, "s13");
        speech = null;
      } else {
        __bpNode(34, "s14");
        if (speech === null) {
          __bpNode(34, "s15");
          const m = /^([A-Za-z][A-Za-z' ,.&-]*):$/.exec(lineText);
          __bpNode(34, "s16");
          speech = { id: this.speeches.length, speaker: m ? m[1] : null, nameLine: m ? line.id : -1, lines: [], doc: doc.id, prev: -1, next: -1 };
          __bpNode(34, "s17");
          if (prevSpeech && prevSpeech.doc === doc.id) {
            __bpNode(34, "s18");
            speech.prev = prevSpeech.id;
            __bpNode(34, "s19");
            prevSpeech.next = speech.id;
          }
          __bpNode(34, "s20");
          this.speeches.push(speech);
          __bpNode(34, "s21");
          prevSpeech = speech;
          __bpNode(34, "s22");
          if (speech.speaker !== null) {
            __bpNode(34, "s23");
            if (!this.speakers.has(speech.speaker)) {
              __bpNode(34, "s24");
              this.speakers.set(speech.speaker, []);
            }
            __bpNode(34, "s25");
            this.speakers.get(speech.speaker).push(speech.id);
          }
          __bpNode(34, "s26");
          line.speech = speech.id;
          __bpNode(34, "s27");
          if (speech.speaker === null) {
            __bpNode(34, "s28");
            speech.lines.push(line.id);
          }
        } else {
          __bpNode(34, "s29");
          line.speech = speech.id;
          __bpNode(34, "s30");
          speech.lines.push(line.id);
        }
      }
      __bpNode(34, "s31");
      if (line.speech >= 0 && line.id !== this.speeches[line.speech].nameLine) {
        __bpNode(34, "s32");
        for (const w of new Set(wordsOf(lineText))) {
          __bpNode(34, "s33");
          if (!this.words.has(w)) {
            __bpNode(34, "s34");
            this.words.set(w, []);
          }
          __bpNode(34, "s35");
          this.words.get(w).push(line.id);
        }
      }
      __bpNode(34, "s36");
      at = end + 1;
    }
  }
  lineAt(offset) {
    __bpNode(35, "s1");
    let lo = 0;
    __bpNode(35, "s2");
    let hi = this.lines.length - 1;
    __bpNode(35, "s3");
    while (lo < hi) {
      __bpNode(35, "s4");
      const m = (lo + hi + 1) >> 1;
      __bpNode(35, "s5");
      if (this.lines[m].start <= offset) {
        __bpNode(35, "s6");
        lo = m;
      } else {
        __bpNode(35, "s7");
        hi = m - 1;
      }
    }
    __bpNode(35, "s8");
    return this.lines[lo];
  }
  encode(text) {
    __bpNode(36, "s1");
    const out = new Int32Array(text.length);
    __bpNode(36, "s2");
    for (let i = 0; i < text.length; i++) {
      __bpNode(36, "s3");
      const c = this.codeOf.get(text[i]);
      __bpNode(36, "s4");
      out[i] = c === undefined ? -2 : c;
    }
    __bpNode(36, "s5");
    return out;
  }
  occurrences(text) {
    __bpNode(37, "s1");
    for (const c of text) {
      __bpNode(37, "s2");
      if (!this.codeOf.has(c)) {
        __bpNode(37, "s3");
        return [];
      }
    }
    __bpNode(37, "s4");
    return this.index.offsets(this.encode(text));
  }
  linesEqual(text) {
    __bpNode(38, "s1");
    const out = [];
    __bpNode(38, "s2");
    for (const at of this.occurrences(text)) {
      __bpNode(38, "s3");
      const line = this.lineAt(at);
      __bpNode(38, "s4");
      if (line.start === at && line.end === at + text.length && this.isSpoken(line)) {
        __bpNode(38, "s5");
        out.push(line.id);
      }
    }
    __bpNode(38, "s6");
    return out;
  }
  linesStarting(prefix) {
    __bpNode(39, "s1");
    const out = [];
    __bpNode(39, "s2");
    for (const at of this.occurrences(prefix)) {
      __bpNode(39, "s3");
      const line = this.lineAt(at);
      __bpNode(39, "s4");
      if (line.start === at && line.end > at + prefix.length && this.isSpoken(line)) {
        __bpNode(39, "s5");
        out.push(line.id);
      }
    }
    __bpNode(39, "s6");
    return out;
  }
  isSpoken(line) {
    __bpNode(40, "s1");
    return line.speech >= 0 && this.speeches[line.speech].nameLine !== line.id;
  }
  nearest(text, limit) {
    __bpNode(41, "s1");
    const counts = new Map();
    __bpNode(41, "s2");
    for (const w of new Set(wordsOf(text))) {
      __bpNode(41, "s3");
      const lines = this.words.get(w);
      __bpNode(41, "s4");
      if (!lines) {
        __bpNode(41, "s5");
        continue;
      }
      __bpNode(41, "s6");
      for (const id of lines) {
        __bpNode(41, "s7");
        counts.set(id, (counts.get(id) || 0) + 1);
      }
    }
    __bpNode(41, "s8");
    const pool = [...counts.entries()].filter((e) => e[1] >= 2);
    __bpNode(41, "s9");
    pool.sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    __bpNode(41, "s10");
    const scored = [];
    __bpNode(41, "s11");
    for (const e of pool.slice(0, 200)) {
      __bpNode(41, "s12");
      scored.push({ line: e[0], score: similarity(text, this.lines[e[0]].text), shared: e[1] });
    }
    __bpNode(41, "s13");
    scored.sort((a, b) => b.score - a.score || a.line - b.line);
    __bpNode(41, "s14");
    return scored.slice(0, limit);
  }
  longestSuffix(contextCodes, max, from) {
    __bpNode(42, "s1");
    const m = contextCodes.length;
    __bpNode(42, "s2");
    let L = Math.min(m, max, from === undefined ? max : from);
    __bpNode(42, "s3");
    while (L > 0) {
      __bpNode(42, "s4");
      const r = this.index.range(contextCodes.subarray(m - L, m));
      __bpNode(42, "s5");
      if (r[1] > r[0]) {
        __bpNode(42, "s6");
        const next = this.nextCounts(r, L);
        __bpNode(42, "s7");
        if (next.total > 0) {
          __bpNode(42, "s8");
          return { length: L, rows: r, counts: next.counts, total: next.total };
        }
      }
      __bpNode(42, "s9");
      L -= 1;
    }
    __bpNode(42, "s10");
    return { length: 0, rows: [0, this.index.n], counts: null, total: 0 };
  }
  nextCounts(r, L) {
    __bpNode(43, "s1");
    const V = this.alphabet.length;
    __bpNode(43, "s2");
    const counts = new Float64Array(V);
    __bpNode(43, "s3");
    let total = 0;
    __bpNode(43, "s4");
    let lo = r[0];
    __bpNode(43, "s5");
    for (let c = 0; c < V && lo < r[1]; c++) {
      __bpNode(43, "s6");
      const sub = this.index.narrow(lo, r[1], L, c);
      __bpNode(43, "s7");
      counts[c] = sub[1] - sub[0];
      __bpNode(43, "s8");
      total += counts[c];
      __bpNode(43, "s9");
      if (sub[1] > sub[0]) {
        __bpNode(43, "s10");
        lo = sub[1];
      }
    }
    __bpNode(43, "s11");
    return { counts, total };
  }
  nextShare(suf, V) {
    __bpNode(44, "s1");
    const out = new Float64Array(V);
    __bpNode(44, "s2");
    if (suf.total === 0) {
      __bpNode(44, "s3");
      return { share: out, total: 0 };
    }
    __bpNode(44, "s4");
    let total = 0;
    __bpNode(44, "s5");
    for (let i = 0; i < V; i++) {
      __bpNode(44, "s6");
      total += suf.counts[i];
    }
    __bpNode(44, "s7");
    if (total > 0) {
      __bpNode(44, "s8");
      for (let i = 0; i < V; i++) {
        __bpNode(44, "s9");
        out[i] = suf.counts[i] / total;
      }
    }
    __bpNode(44, "s10");
    return { share: out, total };
  }
  speakerOf(speechId) {
    __bpNode(45, "s1");
    return this.speeches[speechId].speaker;
  }
  neighbourhood(lineIds) {
    __bpNode(46, "s1");
    const nodes = [];
    __bpNode(46, "s2");
    const edges = [];
    __bpNode(46, "s3");
    const seen = new Set();
    __bpNode(46, "s4");
    const add = (id, kind, label) => {
      if (seen.has(id)) return;
      seen.add(id);
      nodes.push({ id, kind, label });
    };
    __bpNode(46, "s5");
    for (const lid of lineIds) {
      __bpNode(46, "s6");
      const line = this.lines[lid];
      __bpNode(46, "s7");
      add('L' + lid, 'line', 'line ' + (lid + 1) + ': ' + line.text);
      __bpNode(46, "s8");
      if (line.speech < 0) {
        __bpNode(46, "s9");
        continue;
      }
      __bpNode(46, "s10");
      const sp = this.speeches[line.speech];
      __bpNode(46, "s11");
      add('S' + sp.id, 'speech', 'speech ' + (sp.id + 1));
      __bpNode(46, "s12");
      edges.push({ from: 'L' + lid, to: 'S' + sp.id, kind: 'in' });
      __bpNode(46, "s13");
      if (sp.speaker !== null) {
        __bpNode(46, "s14");
        add('P' + sp.speaker, 'speaker', sp.speaker);
        __bpNode(46, "s15");
        edges.push({ from: 'S' + sp.id, to: 'P' + sp.speaker, kind: 'spoken by' });
      }
      __bpNode(46, "s16");
      if (sp.next >= 0) {
        __bpNode(46, "s17");
        add('S' + sp.next, 'speech', 'speech ' + (sp.next + 1));
        __bpNode(46, "s18");
        edges.push({ from: 'S' + sp.id, to: 'S' + sp.next, kind: 'followed by' });
      }
    }
    __bpNode(46, "s19");
    return { nodes, edges };
  }
  stats() {
    __bpNode(47, "s1");
    let edges = 0;
    __bpNode(47, "s2");
    for (const sp of this.speeches) {
      __bpNode(47, "s3");
      edges += sp.lines.length + (sp.speaker !== null ? 1 : 0) + (sp.next >= 0 ? 1 : 0);
    }
    __bpNode(47, "s4");
    return { characters: this.text.length, lines: this.lines.length, speeches: this.speeches.length,
      speakers: this.speakers.size, documents: this.docs.length, edges };
  }
}
export function wordsOf(text) {
  __bpNode(48, "s1");
  const out = [];
  __bpNode(48, "s2");
  const re = /[a-z']+/g;
  __bpNode(48, "s3");
  const low = text.toLowerCase();
  __bpNode(48, "s4");
  let m = re.exec(low);
  __bpNode(48, "s5");
  while (m !== null) {
    __bpNode(48, "s6");
    out.push(m[0]);
    __bpNode(48, "s7");
    m = re.exec(low);
  }
  __bpNode(48, "s8");
  return out;
}
export function similarity(a, b) {
  __bpNode(49, "s1");
  if (a === b) {
    __bpNode(49, "s2");
    return 1;
  }
  __bpNode(49, "s3");
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}
export class Derived {
  constructor() {
    __bpNode(51, "s1");
    this.facts = [];
    __bpNode(51, "s2");
    this.byQuestion = new Map();
  }
  keep(question, answer, priors) {
    __bpNode(52, "s1");
    if (answer.status !== Status.Read) {
      __bpNode(52, "s2");
      return null;
    }
    __bpNode(52, "s3");
    const lines = [];
    __bpNode(52, "s4");
    for (const hop of answer.chain) {
      __bpNode(52, "s5");
      if (!hop.evidence.length) {
        __bpNode(52, "s6");
        return null;
      }
      __bpNode(52, "s7");
      for (const l of hop.evidence) {
        __bpNode(52, "s8");
        if (lines.indexOf(l) < 0) {
          __bpNode(52, "s9");
          lines.push(l);
        }
      }
    }
    __bpNode(52, "s10");
    const fact = { id: this.facts.length, question, value: answer.value, restsOn: lines,
      texts: lines.map((n) => priors.lines[n - 1].text), kind: 'derived' };
    __bpNode(52, "s11");
    this.facts.push(fact);
    __bpNode(52, "s12");
    this.byQuestion.set(question, fact);
    __bpNode(52, "s13");
    return fact;
  }
  lookup(question) {
    __bpNode(53, "s1");
    return this.byQuestion.get(question) || null;
  }
  holds(fact, priors) {
    __bpNode(54, "s1");
    for (let k = 0; k < fact.restsOn.length; k++) {
      __bpNode(54, "s2");
      const line = priors.lines[fact.restsOn[k] - 1];
      __bpNode(54, "s3");
      if (!line || line.text !== fact.texts[k]) {
        __bpNode(54, "s4");
        return false;
      }
    }
    __bpNode(54, "s5");
    return true;
  }
}
__bpNode(55, "s1");
export const Forms = [
  { name: 'complete', pattern: /^Complete the line:\s*(.+)$/s, hops: ['find lines starting so', 'rank their endings', 'check the ending'],
    example: 'Complete the line: Now is the winter of' },
  { name: 'speaker', pattern: /^Who says:\s*(.+)$/s, hops: ['find the line', 'its speech', 'the speech\'s speaker'],
    example: 'Who says: O Romeo, Romeo! wherefore art thou Romeo?' },
  { name: 'answerer', pattern: /^Who answers ([A-Za-z][A-Za-z' ,.&-]*) after:\s*(.+)$/s,
    hops: ['find the line', 'its speech, spoken by the named speaker', 'the next speech', 'its speaker'],
    example: 'Who answers ROMEO after: O, wilt thou leave me so unsatisfied?' },
  { name: 'reply', pattern: /^What is the reply to ([A-Za-z][A-Za-z' ,.&-]*) after:\s*(.+)$/s,
    hops: ['find the line', 'its speech, spoken by the named speaker', 'the next speech', 'its first spoken line'],
    example: 'What is the reply to ROMEO after: O, wilt thou leave me so unsatisfied?' },
  { name: 'where', pattern: /^Where is:\s*(.+)$/s, hops: ['find every place'], example: 'Where is: A plague o\' both your houses' },
  { name: 'continue', pattern: /^Continue:\s*(.*)$/s, hops: ['write with the priors beside'], example: 'Continue: ROMEO:' },
];
export class Plan {
  constructor(form, args) {
    __bpNode(57, "s1");
    this.form = form;
    __bpNode(57, "s2");
    this.args = args;
    __bpNode(57, "s3");
    this.hops = form.hops.slice();
  }
}
export class Asker {
  static plan(question) {
    __bpNode(59, "s1");
    const q = question.trim();
    __bpNode(59, "s2");
    for (const form of Forms) {
      __bpNode(59, "s3");
      const m = form.pattern.exec(q);
      __bpNode(59, "s4");
      if (m) {
        __bpNode(59, "s5");
        return new Plan(form, m.slice(1).map((s) => s.trim()));
      }
    }
    __bpNode(59, "s6");
    return null;
  }
}
__bpNode(60, "s1");
export const Framing = Object.freeze({
  speaker: { context: () => '\n\n', candidate: (name, line) => name + ':\n' + line + '\n' },
  answerer: { context: (name, line) => name + ':\n' + line + '\n\n', candidate: (next) => next + ':\n' },
  complete: { context: (prefix) => '\n' + prefix, candidate: (ending) => ending + '\n' },
  reply: { context: (name, line) => name + ':\n' + line + '\n\n', candidate: (line) => line + '\n' },
});
export class GptProposer {
  constructor(gpt, speakers) {
    __bpNode(62, "s1");
    this.gpt = gpt;
    __bpNode(62, "s2");
    this.speakers = speakers;
  }
  propose(kind, args) {
    __bpNode(63, "s1");
    if (kind === 'speaker') {
      __bpNode(63, "s2");
      return this.best((n) => [Framing.speaker.context(), Framing.speaker.candidate(n, args[0])]);
    }
    __bpNode(63, "s3");
    if (kind === 'answerer') {
      __bpNode(63, "s4");
      return this.best((n) => [Framing.answerer.context(args[0], args[1]), Framing.answerer.candidate(n)]);
    }
    __bpNode(63, "s5");
    if (kind === 'complete') {
      __bpNode(63, "s6");
      return this.gpt.greedy(Framing.complete.context(args[0]), '\n', 200);
    }
    __bpNode(63, "s7");
    if (kind === 'reply') {
      __bpNode(63, "s8");
      return secondLine(this.gpt.greedyLines(Framing.reply.context(args[0], args[1]), 2, 240));
    }
    __bpNode(63, "s9");
    throw new Error('no proposal for ' + kind);
  }
  best(frame) {
    __bpNode(64, "s1");
    let top = null;
    __bpNode(64, "s2");
    let topScore = -Infinity;
    __bpNode(64, "s3");
    for (const n of this.speakers) {
      __bpNode(64, "s4");
      const pair = frame(n);
      __bpNode(64, "s5");
      const sc = this.gpt.score(pair[0], pair[1]);
      __bpNode(64, "s6");
      if (sc > topScore) {
        __bpNode(64, "s7");
        topScore = sc;
        __bpNode(64, "s8");
        top = n;
      }
    }
    __bpNode(64, "s9");
    return top;
  }
  speakerScore(kind, args, name) {
    __bpNode(65, "s1");
    if (kind === 'speaker') {
      __bpNode(65, "s2");
      return this.gpt.score(Framing.speaker.context(), Framing.speaker.candidate(name, args[0]));
    }
    __bpNode(65, "s3");
    if (kind === 'answerer') {
      __bpNode(65, "s4");
      return this.gpt.score(Framing.answerer.context(args[0], args[1]), Framing.answerer.candidate(name));
    }
    __bpNode(65, "s5");
    throw new Error('no speaker score for ' + kind);
  }
  rank(candidates, args, kind) {
    __bpNode(66, "s1");
    const scored = [];
    __bpNode(66, "s2");
    for (const c of candidates) {
      __bpNode(66, "s3");
      let pair = null;
      __bpNode(66, "s4");
      if (kind === 'speaker') {
        __bpNode(66, "s5");
        pair = [Framing.speaker.context(), Framing.speaker.candidate(c, args[0])];
      } else {
        __bpNode(66, "s6");
        if (kind === 'complete') {
          __bpNode(66, "s7");
          pair = [Framing.complete.context(args[0]), Framing.complete.candidate(c)];
        } else {
          __bpNode(66, "s8");
          if (kind === 'answerer') {
            __bpNode(66, "s9");
            pair = [Framing.answerer.context(args[0], args[1]), Framing.answerer.candidate(c)];
          } else {
            __bpNode(66, "s10");
            if (kind === 'reply') {
              __bpNode(66, "s11");
              pair = [Framing.reply.context(args[0], args[1]), Framing.reply.candidate(c)];
            } else {
              __bpNode(66, "s12");
              throw new Error('no ranking for ' + kind);
            }
          }
        }
      }
      __bpNode(66, "s13");
      scored.push({ c, s: this.gpt.score(pair[0], pair[1]) });
    }
    __bpNode(66, "s14");
    scored.sort((a, b) => b.s - a.s);
    __bpNode(66, "s15");
    return scored.map((x) => x.c);
  }
}
export function secondLine(text) {
  __bpNode(67, "s1");
  const lines = text.split('\n');
  __bpNode(67, "s2");
  return lines.length > 1 ? lines[1] : null;
}
function proposalWords(proposal, confirmed) {
  __bpNode(68, "s1");
  if (proposal === undefined) {
    __bpNode(68, "s2");
    return '; the plain model was not asked for its own answer';
  }
  __bpNode(68, "s3");
  if (confirmed) {
    __bpNode(68, "s4");
    return '; the model said ' + JSON.stringify(proposal) + ', which this backs';
  }
  __bpNode(68, "s5");
  return '; the model said ' + JSON.stringify(proposal) + ', which this does not back';
}
function hop(says, evidence) {
  __bpNode(69, "s1");
  return { says, evidence };
}
export class Answerer {
  constructor(priors, model, options) {
    __bpNode(71, "s1");
    this.priors = priors;
    __bpNode(71, "s2");
    this.model = model;
    __bpNode(71, "s3");
    this.nearMin = options.nearMin;
    __bpNode(71, "s4");
    this.derived = options.derived || null;
  }
  ask(question) {
    __bpNode(72, "s1");
    const plan = Asker.plan(question);
    __bpNode(72, "s2");
    if (plan === null) {
      __bpNode(72, "s3");
      return { status: Status.Refused, value: null, chain: [], proposal: null,
        why: 'not in a listed form: ' + Forms.map((f) => f.example).join(' | ') };
    }
    __bpNode(72, "s4");
    const fact = this.derived === null ? null : this.derived.lookup(question);
    __bpNode(72, "s5");
    if (fact !== null && this.derived.holds(fact, this.priors)) {
      __bpNode(72, "s6");
      return { status: Status.Read, value: fact.value, proposal: undefined, confirmed: false, alternatives: [], derived: fact.id,
        chain: [hop('from derived prior ' + (fact.id + 1) + ', kept from an earlier checked answer: derived, not training text', fact.restsOn),
          hop('each of the ' + fact.restsOn.length + ' training lines it rests on, read again now: unchanged', fact.restsOn)] };
    }
    __bpNode(72, "s7");
    return this.run(plan);
  }
  run(plan) {
    __bpNode(73, "s1");
    const f = plan.form.name;
    __bpNode(73, "s2");
    if (f === 'complete') {
      __bpNode(73, "s3");
      return this.complete(plan.args[0]);
    }
    __bpNode(73, "s4");
    if (f === 'speaker') {
      __bpNode(73, "s5");
      return this.speaker(plan.args[0]);
    }
    __bpNode(73, "s6");
    if (f === 'answerer') {
      __bpNode(73, "s7");
      return this.following(plan.args[0], plan.args[1], 'speaker');
    }
    __bpNode(73, "s8");
    if (f === 'reply') {
      __bpNode(73, "s9");
      return this.following(plan.args[0], plan.args[1], 'line');
    }
    __bpNode(73, "s10");
    if (f === 'where') {
      __bpNode(73, "s11");
      return this.where(plan.args[0]);
    }
    __bpNode(73, "s12");
    return { status: Status.Refused, value: null, chain: [], proposal: null, why: 'the form ' + f + ' is answered by the Mixer' };
  }
  findLine(quote) {
    __bpNode(74, "s1");
    const exact = this.priors.linesEqual(quote);
    __bpNode(74, "s2");
    if (exact.length) {
      __bpNode(74, "s3");
      return { lines: exact, how: 'word for word', score: 1 };
    }
    __bpNode(74, "s4");
    const near = this.priors.nearest(quote, 8);
    __bpNode(74, "s5");
    if (!near.length || near[0].score < this.nearMin) {
      __bpNode(74, "s6");
      return { lines: [], how: 'no line', score: near.length ? near[0].score : 0,
        best: near.length ? near[0].line : -1 };
    }
    __bpNode(74, "s7");
    const top = near.filter((x) => x.score === near[0].score).map((x) => x.line);
    __bpNode(74, "s8");
    return { lines: top, how: 'nearest by edit distance', score: near[0].score };
  }
  absent(why, chain, proposal) {
    __bpNode(75, "s1");
    return { status: Status.Absent, value: null, chain, proposal, why };
  }
  complete(prefix) {
    __bpNode(76, "s1");
    const proposal = this.model.propose('complete', [prefix]);
    __bpNode(76, "s2");
    const lines = this.priors.linesStarting(prefix);
    __bpNode(76, "s3");
    const chain = [hop('lines starting "' + prefix + '": ' + lines.length, lines.map((l) => l + 1))];
    __bpNode(76, "s4");
    if (!lines.length) {
      __bpNode(76, "s5");
      return this.absent('no training line starts with that text', chain, proposal);
    }
    __bpNode(76, "s6");
    const endings = [];
    __bpNode(76, "s7");
    for (const l of lines) {
      __bpNode(76, "s8");
      const rest = this.priors.lines[l].text.slice(prefix.length);
      __bpNode(76, "s9");
      if (endings.indexOf(rest) < 0) {
        __bpNode(76, "s10");
        endings.push(rest);
      }
    }
    __bpNode(76, "s11");
    const ranked = this.model.rank(endings, [prefix], 'complete');
    __bpNode(76, "s12");
    const value = ranked[0];
    __bpNode(76, "s13");
    const backing = lines.filter((l) => this.priors.lines[l].text.slice(prefix.length) === value);
    __bpNode(76, "s14");
    chain.push(hop(endings.length + ' different ending(s); the model ranks "' + value + '" first', backing.map((l) => l + 1)));
    __bpNode(76, "s15");
    const confirmed = proposal === value;
    __bpNode(76, "s16");
    chain.push(hop(confirmed ? 'the model\'s own ending is the training text\'s' : 'the model wrote "' + proposal + '", which the priors do not back', backing.map((l) => l + 1)));
    __bpNode(76, "s17");
    return { status: endings.length > 1 ? Status.Ambiguous : Status.Read, value, chain, proposal, confirmed, alternatives: endings };
  }
  speaker(quote) {
    __bpNode(77, "s1");
    const proposal = this.model.propose('speaker', [quote]);
    __bpNode(77, "s2");
    const found = this.findLine(quote);
    __bpNode(77, "s3");
    const chain = [hop(found.lines.length ? 'the line, ' + found.how + (found.score < 1 ? ' (score ' + found.score.toFixed(2) + ')' : '') : 'no training line matches (best score ' + found.score.toFixed(2) + ')', found.lines.map((l) => l + 1))];
    __bpNode(77, "s4");
    if (!found.lines.length) {
      __bpNode(77, "s5");
      return this.absent('no line in the priors says that', chain, proposal);
    }
    __bpNode(77, "s6");
    const speakers = [];
    __bpNode(77, "s7");
    const speechOf = new Map();
    __bpNode(77, "s8");
    for (const l of found.lines) {
      __bpNode(77, "s9");
      const sp = this.priors.lines[l].speech;
      __bpNode(77, "s10");
      const name = this.priors.speakerOf(sp);
      __bpNode(77, "s11");
      if (name !== null && speakers.indexOf(name) < 0) {
        __bpNode(77, "s12");
        speakers.push(name);
        __bpNode(77, "s13");
        speechOf.set(name, [l]);
      } else {
        __bpNode(77, "s14");
        if (name !== null) {
          __bpNode(77, "s15");
          speechOf.get(name).push(l);
        }
      }
    }
    __bpNode(77, "s16");
    chain.push(hop('in speech(es) ' + found.lines.map((l) => this.priors.lines[l].speech + 1).join(', '), found.lines.map((l) => l + 1)));
    __bpNode(77, "s17");
    if (!speakers.length) {
      __bpNode(77, "s18");
      return this.absent('the line is in no speech that names its speaker', chain, proposal);
    }
    __bpNode(77, "s19");
    const ranked = speakers.length > 1 ? this.model.rank(speakers, [quote], 'speaker') : speakers;
    __bpNode(77, "s20");
    const value = ranked[0];
    __bpNode(77, "s21");
    const confirmed = proposal !== undefined && speakers.indexOf(proposal) >= 0;
    __bpNode(77, "s22");
    const answer = confirmed ? proposal : value;
    __bpNode(77, "s23");
    chain.push(hop('spoken by ' + speakers.join(', ') + proposalWords(proposal, confirmed), speechOf.get(answer).map((l) => this.priors.speeches[this.priors.lines[l].speech].nameLine + 1)));
    __bpNode(77, "s24");
    return { status: speakers.length > 1 ? Status.Ambiguous : Status.Read, value: answer, chain, proposal, confirmed, alternatives: speakers };
  }
  following(name, quote, want) {
    __bpNode(78, "s1");
    const proposal = this.model.propose(want === 'speaker' ? 'answerer' : 'reply', [name, quote]);
    __bpNode(78, "s2");
    const found = this.findLine(quote);
    __bpNode(78, "s3");
    const chain = [hop(found.lines.length ? 'the line, ' + found.how : 'no training line matches (best score ' + found.score.toFixed(2) + ')', found.lines.map((l) => l + 1))];
    __bpNode(78, "s4");
    if (!found.lines.length) {
      __bpNode(78, "s5");
      return this.absent('no line in the priors says that', chain, proposal);
    }
    __bpNode(78, "s6");
    const mine = found.lines.filter((l) => this.priors.speakerOf(this.priors.lines[l].speech) === name);
    __bpNode(78, "s7");
    chain.push(hop(mine.length ? name + ' says it, in speech(es) ' + mine.map((l) => this.priors.lines[l].speech + 1).join(', ') : name + ' never says it', mine.map((l) => this.priors.speeches[this.priors.lines[l].speech].nameLine + 1)));
    __bpNode(78, "s8");
    if (!mine.length) {
      __bpNode(78, "s9");
      return this.absent(name + ' does not say that line in the priors', chain, proposal);
    }
    __bpNode(78, "s10");
    const values = [];
    __bpNode(78, "s11");
    const backing = new Map();
    __bpNode(78, "s12");
    for (const l of mine) {
      __bpNode(78, "s13");
      const sp = this.priors.speeches[this.priors.lines[l].speech];
      __bpNode(78, "s14");
      if (sp.next < 0) {
        __bpNode(78, "s15");
        continue;
      }
      __bpNode(78, "s16");
      const nx = this.priors.speeches[sp.next];
      __bpNode(78, "s17");
      const v = want === 'speaker' ? nx.speaker : (nx.lines.length ? this.priors.lines[nx.lines[0]].text : null);
      __bpNode(78, "s18");
      if (v === null) {
        __bpNode(78, "s19");
        continue;
      }
      __bpNode(78, "s20");
      if (values.indexOf(v) < 0) {
        __bpNode(78, "s21");
        values.push(v);
        __bpNode(78, "s22");
        backing.set(v, []);
      }
      __bpNode(78, "s23");
      backing.get(v).push(want === 'speaker' ? nx.nameLine + 1 : nx.lines[0] + 1);
    }
    __bpNode(78, "s24");
    chain.push(hop(values.length ? 'the next speech: ' + values.length + ' backed answer(s)' : 'no speech follows it in the priors', [].concat(...[...backing.values()])));
    __bpNode(78, "s25");
    if (!values.length) {
      __bpNode(78, "s26");
      return this.absent('nothing follows that speech in the priors', chain, proposal);
    }
    __bpNode(78, "s27");
    const ranked = values.length > 1 ? this.model.rank(values, [name, quote], want === 'speaker' ? 'answerer' : 'reply') : values;
    __bpNode(78, "s28");
    const confirmed = proposal !== undefined && values.indexOf(proposal) >= 0;
    __bpNode(78, "s29");
    const value = confirmed ? proposal : ranked[0];
    __bpNode(78, "s30");
    chain.push(hop((want === 'speaker' ? 'its speaker: ' : 'its first line: ') + value + proposalWords(proposal, confirmed), backing.get(value)));
    __bpNode(78, "s31");
    return { status: values.length > 1 ? Status.Ambiguous : Status.Read, value, chain, proposal, confirmed, alternatives: values };
  }
  where(text) {
    __bpNode(79, "s1");
    const at = this.priors.occurrences(text);
    __bpNode(79, "s2");
    const lines = [];
    __bpNode(79, "s3");
    for (const o of at) {
      __bpNode(79, "s4");
      const l = this.priors.lineAt(o).id;
      __bpNode(79, "s5");
      if (lines.indexOf(l) < 0) {
        __bpNode(79, "s6");
        lines.push(l);
      }
    }
    __bpNode(79, "s7");
    const chain = [hop(at.length + ' place(s) in the priors', lines.map((l) => l + 1))];
    __bpNode(79, "s8");
    if (!at.length) {
      __bpNode(79, "s9");
      return this.absent('the priors never hold that text', chain, null);
    }
    __bpNode(79, "s10");
    return { status: Status.Read, value: lines.map((l) => l + 1), chain, proposal: null, confirmed: true, alternatives: [] };
  }
}
export class Mixer {
  constructor(priors, lambdas, max) {
    __bpNode(81, "s1");
    this.priors = priors;
    __bpNode(81, "s2");
    this.lambdas = lambdas;
    __bpNode(81, "s3");
    this.max = max;
  }
  lambdaFor(length) {
    __bpNode(82, "s1");
    for (const b of this.lambdas) {
      __bpNode(82, "s2");
      if (length >= b.from && length <= b.to) {
        __bpNode(82, "s3");
        return b.lambda;
      }
    }
    __bpNode(82, "s4");
    throw new Error('no lambda for a stretch of length ' + length);
  }
  mix(logits, suf) {
    __bpNode(83, "s1");
    const p = softmax(logits);
    __bpNode(83, "s2");
    const next = this.priors.nextShare(suf, p.length);
    __bpNode(83, "s3");
    if (next.total === 0) {
      __bpNode(83, "s4");
      return { p, suffix: suf, lambda: 1 };
    }
    __bpNode(83, "s5");
    const lambda = this.lambdaFor(suf.length);
    __bpNode(83, "s6");
    for (let i = 0; i < p.length; i++) {
      __bpNode(83, "s7");
      p[i] = lambda * p[i] + (1 - lambda) * next.share[i];
    }
    __bpNode(83, "s8");
    return { p, suffix: suf, lambda };
  }
  write(gpt, prompt, count) {
    __bpNode(84, "s1");
    gpt.reset();
    __bpNode(84, "s2");
    const vocab = this.priors.vocab;
    __bpNode(84, "s3");
    const codes = Array.from(this.priors.encode(prompt));
    __bpNode(84, "s4");
    let logits = gpt.read(prompt);
    __bpNode(84, "s5");
    let suf = this.priors.longestSuffix(Int32Array.from(codes), this.max);
    __bpNode(84, "s6");
    const out = [];
    __bpNode(84, "s7");
    for (let k = 0; k < count; k++) {
      __bpNode(84, "s8");
      const m = this.mix(logits, suf);
      __bpNode(84, "s9");
      const id = argmax(m.p);
      __bpNode(84, "s10");
      codes.push(id);
      __bpNode(84, "s11");
      suf = this.priors.longestSuffix(Int32Array.from(codes), this.max, suf.length + 1);
      __bpNode(84, "s12");
      const where = suf.length ? this.priors.lineAt(this.priors.index.sa[suf.rows[0]]).id + 1 : 0;
      __bpNode(84, "s13");
      out.push({ char: vocab.chars[id], matched: suf.length, line: where, places: suf.rows[1] - suf.rows[0], lambda: m.lambda });
      __bpNode(84, "s14");
      logits = gpt.feed(id);
    }
    __bpNode(84, "s15");
    return out;
  }
}
