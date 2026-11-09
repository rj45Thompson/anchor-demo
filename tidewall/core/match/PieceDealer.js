// port of model/Match/PieceDealer.cs
import { GridModel, Fnv64 } from '../grid.js';

/** Random stream keys: one independent stream per (seed, purpose, index), so nothing random depends on the order other random
 *  things happened in. */
export const Streams = Object.freeze({
  key(seed, purpose, index) {
    const f = Fnv64.fromBigInt(GridModel.HashStart);
    f.mixHalves(0, seed >>> 0); f.mixHalves(0, purpose >>> 0); f.mixHalves(0, index >>> 0);   // (ulong)(uint)v
    return f.lo & 0x7FFFFFFF;
  },
});

/** One player's piece supply: a shuffled bag of every shape in the catalog, dealt one at a time, refilled when empty. Each bag
 *  is shuffled by its OWN random stream, keyed by (match seed, slot, bag number): what a player is dealt never depends on when
 *  another acted. The private model's bag can also grow through a map in its bigger ruleset; that is not ported (a normal bag
 *  always holds every shape). A catalog may weight shapes (PieceCatalog.withWeights, the Tidewall set): a bag then holds weightOf(id)
 *  copies of each, shuffled by the same stream, so a weight-1 shape is rare; the ported catalog's weights are all 1, so its bag is unchanged. Its binary snapshot (Write/Read) is not ported either: nothing here sends one. */
export class PieceDealer {
  /** random: the platform seam, a function from a stream key to a random source (key => new SeededRandom(key)). */
  constructor(catalog, random, seed, slot) {
    this._catalog = catalog; this._random = random; this._seed = seed; this._slot = slot;
    this._bag = new Int32Array(catalog.bagSize);
    this._bagLen = 0;
    this._next = 0;
    this._bagsDealt = 0;
    this._refill();
  }

  _refill() {
    const rng = this._random(Streams.key(this._seed, 1000 + this._slot, this._bagsDealt));
    this._bagLen = 0;
    for (let i = 0; i < this._catalog.count; i++) {      // weightOf is 1 for the ported catalog: one of every shape, as the C# bag
      const id = this._catalog.at(i).id;
      for (let k = this._catalog.weightOf(id); k > 0; k--) this._bag[this._bagLen++] = id;
    }
    for (let i = this._bagLen - 1; i > 0; i--) {                 // Fisher-Yates
      const j = rng.range(0, i + 1);
      const t = this._bag[i]; this._bag[i] = this._bag[j]; this._bag[j] = t;
    }
    this._next = 0; this._bagsDealt++;
  }

  /** The piece the player holds now (not consumed until take). */
  get current() { return this._bag[this._next]; }

  take() {
    this._next++;
    if (this._next >= this._bagLen) this._refill();
  }

  hashInto(f) {
    f.mix(this._bagsDealt); f.mix(this._next);
    for (let i = 0; i < this._bagLen; i++) f.mix(this._bag[i]);
    return f;
  }

  hash(h) { return this.hashInto(Fnv64.fromBigInt(h)).toBigInt(); }
}
