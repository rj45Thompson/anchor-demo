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

/** a code outside the alphabet has no bucket: a counting sort would misplace it and repeat other rows, so refuse it */
function checkCodes(s, alphabet) {
  for (let i = 0; i < s.length; i++) {
    if (!(s[i] >= 0 && s[i] < alphabet)) throw new Error('code ' + s[i] + ' at ' + i + ' is outside the alphabet of ' + alphabet);
  }
}

/**
 * every suffix of s (codes below alphabet), sorted in linear time: Nong, Zhang and Chan's induced sorting (SA-IS, 2009).
 * A suffix that is the start of another sorts first, as if the text ended in a code below every other. Measured 11-11:
 * prefix doubling (below) took 440 s on 64 MB of text with long repeats, since each repeat doubles the rounds.
 */
export function sortSuffixes(s, alphabet) {
  checkCodes(s, alphabet);
  return inducedSort(s, s.length, alphabet);
}

function inducedSort(s, n, K) {
  const sa = new Int32Array(n);
  if (n === 0) return sa;
  if (n === 1) return sa;
  // t[i] = 1 when suffix i is S-type (smaller than suffix i + 1); the empty suffix at n is S, so suffix n - 1 is L
  const t = new Uint8Array(n + 1);
  t[n] = 1;
  for (let i = n - 2; i >= 0; i--) t[i] = s[i] < s[i + 1] || (s[i] === s[i + 1] && t[i + 1] === 1) ? 1 : 0;
  const isLMS = (i) => i > 0 && t[i] === 1 && t[i - 1] === 0;
  const counts = new Int32Array(K);
  for (let i = 0; i < n; i++) counts[s[i]] += 1;
  const bkt = new Int32Array(K);
  const heads = () => {
    let sum = 0;
    for (let c = 0; c < K; c++) {
      bkt[c] = sum;
      sum += counts[c];
    }
  };
  const tails = () => {
    let sum = 0;
    for (let c = 0; c < K; c++) {
      sum += counts[c];
      bkt[c] = sum;
    }
  };
  const induce = () => {
    heads();
    // the empty suffix sorts first, so the suffix before it, n - 1 (L-type), heads its bucket
    sa[bkt[s[n - 1]]++] = n - 1;
    for (let i = 0; i < n; i++) {
      const j = sa[i] - 1;
      if (sa[i] > 0 && t[j] === 0) sa[bkt[s[j]]++] = j;
    }
    tails();
    for (let i = n - 1; i >= 0; i--) {
      const j = sa[i] - 1;
      if (sa[i] > 0 && t[j] === 1) sa[--bkt[s[j]]] = j;
    }
  };
  // 1. the LMS suffixes at their buckets' tails, the rest induced from them: the LMS substrings come out in order
  sa.fill(-1);
  tails();
  for (let i = 1; i < n; i++) if (isLMS(i)) sa[--bkt[s[i]]] = i;
  induce();
  // 2. name each LMS substring by its rank (equal substrings share a name) and sort the string of names, recursively
  let m = 0;
  for (let i = 0; i < n; i++) if (isLMS(sa[i])) sa[m++] = sa[i];
  sa.fill(-1, m);
  let name = 0;
  let prev = -1;
  for (let i = 0; i < m; i++) {
    const pos = sa[i];
    let diff = prev < 0;
    for (let d = 0; !diff; d++) {
      // the empty suffix at n is unique, so a substring reaching it equals no other
      if (pos + d === n || prev + d === n || s[pos + d] !== s[prev + d] || t[pos + d] !== t[prev + d]) diff = true;
      else if (d > 0 && (isLMS(pos + d) || isLMS(prev + d))) break;
    }
    if (diff) name += 1;
    prev = pos;
    // LMS positions are at least two apart, so pos >> 1 is a slot of its own past m
    sa[m + (pos >> 1)] = name - 1;
  }
  let j = n - 1;
  for (let i = n - 1; i >= m; i--) if (sa[i] >= 0) sa[j--] = sa[i];
  const names = sa.slice(n - m, n);
  let order;
  if (name < m) order = inducedSort(names, m, name);
  else {
    order = new Int32Array(m);
    for (let i = 0; i < m; i++) order[names[i]] = i;
  }
  // 3. the LMS suffixes in their sorted order at their buckets' tails, then everything induced from them
  const lms = new Int32Array(m);
  j = 0;
  for (let i = 1; i < n; i++) if (isLMS(i)) lms[j++] = i;
  sa.fill(-1);
  tails();
  for (let k = m - 1; k >= 0; k--) {
    const pos = lms[order[k]];
    sa[--bkt[s[pos]]] = pos;
  }
  induce();
  return sa;
}

/** the same order by Manber and Myers' prefix doubling with counting sorts: the old sort, kept as a second witness */
export function sortSuffixesByDoubling(s, alphabet) {
  checkCodes(s, alphabet);
  const n = s.length;
  const sa = new Int32Array(n);
  let rank = new Int32Array(n);
  let next = new Int32Array(n);
  const tmp = new Int32Array(n);
  const count = new Int32Array(Math.max(alphabet, n) + 1);
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
