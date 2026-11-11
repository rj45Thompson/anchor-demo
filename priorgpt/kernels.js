// PriorGPT's plain arithmetic: the loops that run millions of times a character.
//
// These are kept off the Blueprint graphs on purpose. The debugger page puts a probe before every statement it runs from
// the graphs (core.js); here that would be ten million probes for each character the model reads, and nothing in these
// loops decides an answer. core.js calls them by name, so the graphs still show every call.

/** y = W x + b for a PyTorch Linear: W is (out, in) row-major, b may be null */
export function linear(W, b, x, nIn, nOut, y) {
  for (let o = 0; o < nOut; o++) {
    let s = b === null ? 0 : b[o];
    const row = o * nIn;
    for (let i = 0; i < nIn; i++) s += W[row + i] * x[i];
    y[o] = s;
  }
  return y;
}

/** PyTorch's LayerNorm over one vector, eps 1e-5 (its default) */
export function layerNorm(x, w, b, n, y) {
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) v += (x[i] - mean) * (x[i] - mean);
  const inv = 1 / Math.sqrt(v / n + 1e-5);
  for (let i = 0; i < n; i++) y[i] = (x[i] - mean) * inv * w[i] + b[i];
  return y;
}

/**
 * One head's attention for the newest position t: softmax(q . k_s * scale) over s <= t, then the weighted sum of v_s.
 * K and V hold every position's keys and values, width C, the head's slice starting at base. Writes hs values at out[base].
 */
export function attend(q, K, V, t, C, base, hs, scale, wei, out) {
  let max = -Infinity;
  for (let s = 0; s <= t; s++) {
    let d = 0;
    for (let i = 0; i < hs; i++) d += q[i] * K[s * C + base + i];
    d *= scale;
    wei[s] = d;
    if (d > max) max = d;
  }
  let sum = 0;
  for (let s = 0; s <= t; s++) {
    wei[s] = Math.exp(wei[s] - max);
    sum += wei[s];
  }
  for (let i = 0; i < hs; i++) {
    let a = 0;
    for (let s = 0; s <= t; s++) a += wei[s] * V[s * C + base + i];
    out[base + i] = a / sum;
  }
}

/** every suffix of s (codes below alphabet), sorted: Manber and Myers' prefix doubling with counting sorts */
export function sortSuffixes(s, alphabet) {
  const n = s.length;
  const sa = new Int32Array(n);
  let rank = new Int32Array(n);
  let next = new Int32Array(n);
  const tmp = new Int32Array(n);
  const count = new Int32Array(Math.max(alphabet, n) + 1);
  // a code outside the alphabet has no bucket: the counting sort would drop it and repeat other rows, so refuse it
  for (let i = 0; i < n; i++) {
    if (!(s[i] >= 0 && s[i] < alphabet)) throw new Error('code ' + s[i] + ' at ' + i + ' is outside the alphabet of ' + alphabet);
  }
  for (let i = 0; i < n; i++) count[s[i] + 1] += 1;
  for (let i = 1; i <= alphabet; i++) count[i] += count[i - 1];
  for (let i = 0; i < n; i++) {
    sa[count[s[i]]] = i;
    count[s[i]] += 1;
  }
  for (let i = 0; i < n; i++) rank[i] = s[i];
  let classes = alphabet;
  for (let k = 1; k < n; k *= 2) {
    // order by (rank[i], rank[i + k]): the second key's order comes from sa itself, the first by a stable counting sort
    let p = 0;
    for (let i = n - k; i < n; i++) {
      tmp[p] = i;
      p += 1;
    }
    for (let j = 0; j < n; j++) {
      if (sa[j] >= k) {
        tmp[p] = sa[j] - k;
        p += 1;
      }
    }
    count.fill(0, 0, classes + 1);
    for (let i = 0; i < n; i++) count[rank[i] + 1] += 1;
    for (let i = 1; i <= classes; i++) count[i] += count[i - 1];
    for (let j = 0; j < n; j++) {
      const i = tmp[j];
      sa[count[rank[i]]] = i;
      count[rank[i]] += 1;
    }
    next[sa[0]] = 0;
    let c = 0;
    for (let j = 1; j < n; j++) {
      const a = sa[j - 1];
      const b = sa[j];
      const ra = a + k < n ? rank[a + k] : -1;
      const rb = b + k < n ? rank[b + k] : -1;
      if (rank[a] !== rank[b] || ra !== rb) c += 1;
      next[b] = c;
    }
    const swap = rank;
    rank = next;
    next = swap;
    classes = c + 1;
    if (classes === n) break;
  }
  return sa;
}

/** Levenshtein edits between two texts (insert, delete, substitute, each 1) */
export function editDistance(a, b) {
  const n = a.length;
  const m = b.length;
  let prev = new Int32Array(m + 1);
  let cur = new Int32Array(m + 1);
  for (let j = 0; j <= m; j++) prev[j] = j;
  for (let i = 1; i <= n; i++) {
    cur[0] = i;
    for (let j = 1; j <= m; j++) {
      const sub = prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      cur[j] = Math.min(sub, prev[j] + 1, cur[j - 1] + 1);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[m];
}

/** IEEE half floats (the page's weight file) -> float32 */
export function halfToFloat(halves) {
  const out = new Float32Array(halves.length);
  for (let i = 0; i < halves.length; i++) {
    const h = halves[i];
    const sign = h & 0x8000 ? -1 : 1;
    const e = (h >> 10) & 0x1f;
    const m = h & 0x3ff;
    if (e === 0) out[i] = sign * m * Math.pow(2, -24);
    else if (e === 31) out[i] = m ? NaN : sign * Infinity;
    else out[i] = sign * (1 + m / 1024) * Math.pow(2, e - 15);
  }
  return out;
}
