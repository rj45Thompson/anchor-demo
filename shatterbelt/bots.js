// Players that are not people. The title screen's demo plays with one, and the node tools use the same ones
// (tools/parity.js records their games for the C++ comparison, tools/difficulty.js measures how hard the game is).
// A bot reads the game and returns one byte of Input bits for the next step, exactly as the keys would.
import { Trig, Input } from './core.js';

const { Left, Right, Fire, Hyperspace } = Input;

// Turns toward the nearest rock or hunter, fires when it faces it, and jumps to hyperspace when
// something is about to hit it.
export function aimer() {
  return game => {
    const { ship, field } = game;
    if (!ship.alive || ship.jumping > 0) return 0;
    let target = null;
    let best = Infinity;
    for (const pool of [game.rocks, game.hunters]) {
      for (const e of pool.live) {
        const d = e.alive ? field.distanceSquared(ship, e) : Infinity;
        if (d < best) { best = d; target = e; }
      }
    }
    if (!target) return 0;
    const want = Trig.atan2(field.dy(ship, target), field.dx(ship, target));
    const off = Trig.atan2(Trig.sin(want - ship.angle), Trig.cos(want - ship.angle));
    let input = Math.abs(off) > 0.06 ? (off > 0 ? Right : Left) : 0;
    if (Math.abs(off) < 0.2) input |= Fire;
    const reach = ship.radius + target.radius + 30;
    if (best < reach * reach && ship.invulnerable <= 0) input |= Hyperspace;
    return input;
  };
}
