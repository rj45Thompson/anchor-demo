// ground_holes.js - the landscape's HOLES (the two tunnel mouths), READ from Unreal's game collision (tools/ue_holes.py ->
// data/ground_holes.bin, one byte per landscape quad, 1 = hole), applied to world.js's traces.
//
// Why: data/ground_height.bin was traced on the Visibility channel in the editor world, where an editor-only heightfield answers
// Visibility queries (Landscape/Private/LandscapeCollision.cpp:442-466), so it has a height everywhere. The game heightfield gives
// every quad painted with the Visibility layer the hole material (LandscapeCollision.cpp:1252-1255) and Chaos raycasts skip hole
// cells (Chaos/Private/Chaos/HeightField.cpp:83). Without the holes the landscape closes the tunnel mouth across the whole road
// (measured: 1.5 m to 3.3 m above the road 582 m into the lap) and no car can drive the lap the way Unreal's can.
// withHoles(world, holes) returns a world with the same interface whose trace lets a ray through a hole quad. Pure; browser + node.
// Serves UC-2.2 and UC-9.2.
export const AUTHORED = [
  'a trace that meets the landscape inside a hole quad goes on from 0.01 cm past that point to the same end (its distance kept from the original start); world.js then treats the rest of the ray as starting under the landscape, so it finds the road or the tunnel below',
  'a hole is the whole quad whose centre Unreal\'s game-channel trace missed (Chaos holes are per quad); between quads nothing is interpolated',
];

const EPS = 0.01;   // cm past the landscape hit (see AUTHORED)

export function makeHoles(meta, bytes, groundGrid) {
  const g = meta.grid;
  if (!g || !meta.holes) throw new Error('ground_holes: the meta has no grid or holes');
  for (const k of ['step_cm', 'nx', 'ny']) if (g[k] !== groundGrid[k]) throw new Error('ground_holes: grid ' + k + ' ' + g[k] + ' is not the ground grid\'s ' + groundGrid[k]);
  if (g.origin_cm[0] !== groundGrid.origin_cm[0] || g.origin_cm[1] !== groundGrid.origin_cm[1]) throw new Error('ground_holes: grid origin differs from the ground grid');
  const cx = g.nx - 1, cy = g.ny - 1;
  if (bytes.length !== cx * cy) throw new Error('ground_holes: ' + bytes.length + ' bytes for ' + cx + ' x ' + cy + ' quads');
  let n = 0; for (const b of bytes) { if (b > 1) throw new Error('ground_holes: byte ' + b + ' is neither 0 nor 1'); n += b; }
  if (n !== meta.holes.count) throw new Error('ground_holes: ' + n + ' holes in the file, the meta says ' + meta.holes.count);
  const [ox, oy] = g.origin_cm, step = g.step_cm;
  return {
    count: n, src: meta.holes.src,
    isHole(x, y) {
      const i = Math.floor((x - ox) / step), j = Math.floor((y - oy) / step);
      return i >= 0 && j >= 0 && i < cx && j < cy && bytes[j * cx + i] === 1;
    },
  };
}

export function withHoles(world, holes) {
  if (!world || typeof world.trace !== 'function' || !holes || typeof holes.isHole !== 'function') throw new Error('ground_holes: withHoles(world, holes) needs both');
  function trace(start, end) {
    const hit = world.trace(start, end);
    if (!hit || hit.kind !== 'landscape' || !holes.isHole(hit.point[0], hit.point[1])) return hit;
    const d = [end[0] - start[0], end[1] - start[1], end[2] - start[2]], L = Math.hypot(d[0], d[1], d[2]);
    const t = Math.min(1, (hit.distance + EPS) / L);
    if (t >= 1) return null;
    const s2 = [start[0] + d[0] * t, start[1] + d[1] * t, start[2] + d[2] * t];
    const next = trace(s2, end);
    return next ? { ...next, distance: next.distance + t * L } : null;
  }
  const ground = (x, y) => (holes.isHole(x, y) ? null : world.ground(x, y));
  return { ...world, trace, ground, holes };
}

// the holes from the page's data files (browser: fetch; node: a reader passed in); groundGrid = track.json ground.grid
export async function loadHoles(read, readJson, groundGrid) {
  const meta = await readJson('ground_holes.json');
  return makeHoles(meta, new Uint8Array(await read(meta.holes.file)), groundGrid);
}
