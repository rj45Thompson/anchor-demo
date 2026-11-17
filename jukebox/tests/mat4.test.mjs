//   node jukebox/tests/mat4.test.mjs
import { suite } from "./harness.mjs";
import { cross, dot, identity, length, lookAt, multiply, normalize, perspective, transform, viewProjection } from "../js/mat4.js";

const t = suite("mat4");
const close = (a, b, tol = 1e-5) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tol);

t.check("identity is identity", close([...identity()], [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]));
t.check("identity times identity", close([...multiply(identity(), identity())], [...identity()]));
t.check("identity leaves a point alone", close(transform(identity(), [3, -4, 5]), [3, -4, 5, 1]));

// A translation built by hand, to pin the column-major layout down.
const translate = (x, y, z) => new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]);
t.check("translation moves a point", close(transform(translate(1, 2, 3), [0, 0, 0]), [1, 2, 3, 1]));
t.check("translations compose", close(transform(multiply(translate(1,0,0), translate(0,2,0)), [0,0,0]), [1, 2, 0, 1]));
t.check("a translation does not move a direction", close(transform(translate(5,5,5), [1,0,0,0]), [1,0,0,0]));

t.check("cross of x and y is z", close(cross([1,0,0],[0,1,0]), [0,0,1]));
t.check("cross of y and x is -z", close(cross([0,1,0],[1,0,0]), [0,0,-1]));
t.eq("dot of perpendiculars", dot([1,0,0],[0,1,0]), 0);
t.eq("dot of a unit with itself", dot([0,0,1],[0,0,1]), 1);
t.near("length", length([3,4,0]), 5, 1e-9);
t.near("normalize gives unit length", length(normalize([3,4,5])), 1, 1e-6);
t.check("normalize of zero is zero", close(normalize([0,0,0]), [0,0,0]));

// --- lookAt ------------------------------------------------------------------
{
  // Standing at +Z looking at the origin: the target lands dead centre, down -Z.
  const v = lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0]);
  const o = transform(v, [0, 0, 0]);
  t.check("the target is straight ahead", close([o[0], o[1]], [0, 0]));
  t.near("and 5 away down -z", o[2], -5, 1e-5);
  // A point to the world's right stays on the viewer's right.
  t.check("right stays right", transform(v, [1, 0, 0])[0] > 0);
  t.check("up stays up", transform(v, [0, 1, 0])[1] > 0);
}
{
  // The highway camera: behind and above the hit line, looking down the track.
  const v = lookAt([0, 3, 6], [0, 0, -8], [0, 1, 0]);
  const near = transform(v, [0, 0, 0]);
  const far = transform(v, [0, 0, -20]);
  t.check("a nearer point is nearer the camera", Math.abs(far[2]) > Math.abs(near[2]));
}

// --- perspective -------------------------------------------------------------
{
  const near = 0.1, far = 100;
  for (const depth01 of [true, false]) {
    const p = perspective(Math.PI / 3, 16 / 9, near, far, depth01);
    // A point on the near plane and one on the far plane, in view space.
    const n = transform(p, [0, 0, -near]);
    const f = transform(p, [0, 0, -far]);
    t.near(`w is the view depth (depth01=${depth01})`, n[3], near, 1e-5);
    t.near(`near maps to ${depth01 ? 0 : -1}`, n[2] / n[3], depth01 ? 0 : -1, 1e-4);
    t.near(`far maps to 1 (depth01=${depth01})`, f[2] / f[3], 1, 1e-4);
  }
}
{
  // Aspect: a wider viewport squeezes x, so the same point sits nearer the middle.
  const wide = transform(perspective(Math.PI / 3, 2, 0.1, 100, true), [1, 0, -2]);
  const tall = transform(perspective(Math.PI / 3, 0.5, 0.1, 100, true), [1, 0, -2]);
  t.check("a wider aspect brings x inward", Math.abs(wide[0] / wide[3]) < Math.abs(tall[0] / tall[3]));
}
{
  // The field of view: at the top edge of a 90 degree view, y/w is 1.
  const p = perspective(Math.PI / 2, 1, 0.1, 100, true);
  const edge = transform(p, [0, 2, -2]);
  t.near("the top edge of the frustum is at 1", edge[1] / edge[3], 1, 1e-5);
}

// --- the combined matrix -----------------------------------------------------
{
  const vp = viewProjection([0, 3, 6], [0, 0, -8], [0, 1, 0], Math.PI / 3, 16 / 9, 0.1, 200, true);
  const hit = transform(vp, [0, 0, 0]);          // the hit line, in front of the camera
  t.check("the hit line is in front of the camera", hit[3] > 0);
  t.check("and inside the frustum", Math.abs(hit[0] / hit[3]) <= 1 && Math.abs(hit[1] / hit[3]) <= 1);
  const behind = transform(vp, [0, 0, 20]);      // well behind the camera
  t.check("a point behind the camera has w <= 0", behind[3] <= 0);
  // Lanes left and right of centre land left and right on screen.
  t.check("lane order is kept on screen",
    transform(vp, [-2, 0, 0])[0] < transform(vp, [2, 0, 0])[0]);
  // The same scene in the WebGL depth range still puts the hit line on screen.
  const vpGl = viewProjection([0, 3, 6], [0, 0, -8], [0, 1, 0], Math.PI / 3, 16 / 9, 0.1, 200, false);
  const hitGl = transform(vpGl, [0, 0, 0]);
  t.check("the WebGL matrix agrees on x and y",
    close([hitGl[0] / hitGl[3], hitGl[1] / hitGl[3]], [hit[0] / hit[3], hit[1] / hit[3]], 1e-5));
}

t.done();
