// port of runtime/Platform.cs (IRandomSource, SeededRandom)
//
// SeededRandom wraps .NET's seeded System.Random, whose algorithm (the "Net5CompatSeedImpl", Knuth's subtractive generator as
// .NET has always shipped it for a seeded Random) is ported here exactly. Proof: test/parity/traces/random.json holds draws the
// .NET runtime made, and run.mjs compares this port against them draw for draw.
//
// IRandomSource (the platform seam) is an interface in C#: here it is any object with value(), range(minInclusive, maxExclusive)
// for whole numbers and rangeFloat(minInclusive, maxInclusive) for floats (C# overloads Range on int/float; JS cannot).

const INT_MAX = 2147483647;
const MSEED = 161803398;

/** The .NET seeded generator (CompatPrng). C# int arithmetic: every sum is cut to 32 bits (`| 0`) exactly where the C# wraps
 *  (a seed near int.MaxValue leaves a negative entry in the table, and the subtractions then overflow). */
class CompatPrng {
  constructor(seed) {
    if (!Number.isInteger(seed) || seed < -2147483648 || seed > INT_MAX) throw new RangeError('a seed is a 32-bit int, got ' + seed);
    const seedArray = new Int32Array(56);
    const subtraction = seed === -2147483648 ? INT_MAX : Math.abs(seed);
    let mj = MSEED - subtraction;
    seedArray[55] = mj;
    let mk = 1;
    let ii = 0;
    for (let i = 1; i < 55; i++) {
      if ((ii += 21) >= 55) ii -= 55;
      seedArray[ii] = mk;
      mk = (mj - mk) | 0;                    // C# int arithmetic wraps: every step below is cut to 32 bits as the C# is
      if (mk < 0) mk = (mk + INT_MAX) | 0;
      mj = seedArray[ii];
    }
    for (let k = 1; k < 5; k++) {
      for (let i = 1; i < 56; i++) {
        let n = i + 30;
        if (n >= 55) n -= 55;
        let v = (seedArray[i] - seedArray[1 + n]) | 0;
        if (v < 0) v = (v + INT_MAX) | 0;
        seedArray[i] = v;
      }
    }
    this._seedArray = seedArray;
    this._inext = 0;
    this._inextp = 21;
  }

  internalSample() {
    let locINext = this._inext;
    if (++locINext >= 56) locINext = 1;
    let locINextp = this._inextp;
    if (++locINextp >= 56) locINextp = 1;
    const a = this._seedArray;
    let retVal = (a[locINext] - a[locINextp]) | 0;
    if (retVal === INT_MAX) retVal--;
    if (retVal < 0) retVal = (retVal + INT_MAX) | 0;
    a[locINext] = retVal;
    this._inext = locINext;
    this._inextp = locINextp;
    return retVal;
  }

  /** C#: InternalSample() * (1.0 / int.MaxValue) - a multiply by the reciprocal, not a division (the last bit differs). */
  sample() { return this.internalSample() * (1.0 / INT_MAX); }

  sampleForLargeRange() {
    let result = this.internalSample();
    const negative = this.internalSample() % 2 === 0;
    if (negative) result = -result | 0;
    let d = result;
    d += INT_MAX - 1;
    d /= 4294967293;   // C#: 2 * (uint)int.MaxValue - 1
    return d;
  }

  /** System.Random.Next(minValue, maxValue) for minValue < maxValue (the caller checks). */
  next(minValue, maxValue) {
    const range = maxValue - minValue;
    if (range <= INT_MAX) return Math.trunc(this.sample() * range) + minValue;
    return Math.trunc(Math.trunc(this.sampleForLargeRange() * range) + minValue);
  }
}

/** A seeded IRandomSource on the .NET generator: one seed, one sequence, the same as the C# model's on every runtime. */
export class SeededRandom {
  /** A float draw is k / Steps for k in [0, Steps]: both ends reachable, as Unity's are. */
  static Steps = 1 << 23;

  constructor(seed) { this._rng = new CompatPrng(seed); }

  /** C#: _rng.Next(0, Steps + 1) / (float)Steps - exact in float (k <= 2^23). */
  value() { return Math.fround(this._rng.next(0, SeededRandom.Steps + 1) / SeededRandom.Steps); }

  /** Whole numbers, upper bound exclusive; an empty range answers its lower bound without drawing (as the C# does). */
  range(minInclusive, maxExclusive) {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) throw new TypeError('range() takes whole numbers; use rangeFloat for floats');
    if (maxExclusive <= minInclusive) return minInclusive;
    const r = this._rng.next(minInclusive, maxExclusive);
    if (r < minInclusive || r >= maxExclusive) throw new Error('random draw ' + r + ' outside [' + minInclusive + ', ' + maxExclusive + '): the generator is broken');
    return r;
  }

  /** C# Range(float, float): minInclusive + Value() * (maxInclusive - minInclusive), in float arithmetic. */
  rangeFloat(minInclusive, maxInclusive) {
    const lo = Math.fround(minInclusive), hi = Math.fround(maxInclusive);
    return Math.fround(lo + Math.fround(this.value() * Math.fround(hi - lo)));
  }
}
