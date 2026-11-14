// bricks.js - the castle's bricks as physics bodies (CASTLE_RISE_UC.md 5a, UC-L9; RJ 11-14: "use physics for each voxel like
// block", "leave them there", "maybe you blow them up"). One Rapier world a level (render/rise.js owns it): the ground, every wall,
// castle and risen column as fixed boxes, and each knocked-off brick a rigid box that tumbles, hits what is there and comes to rest.
// It only draws: the rules never see it (the rubble the bricks lie round is the rules', grid.js Occupant.Rubble).
import RAPIER from '@dimforge/rapier3d-compat';

// AUTHORED (UC-L9): gravity in squares/s^2 (the old scripted debris's pull: a brick off a 1.3-square crown is down in ~0.33 s, the
// pace of the walls' own drop); the fixed step and the most steps one frame may take (a slow frame does not run the world away);
// a brick's bounce and grip; how many bricks are kept at once; how long a brick may take to come to rest (R8); how long a going
// brick takes to sink away
// a brick at rest: slower than restSpeed (squares/s) and restSpin (rad/s) for restFor s is put to sleep (Rapier's own sleep never
// came at speeds of 0.001-0.004 with nothing waking them, measured 11-14: a fixed box made again 0 times in 3 s)
export const BRICK = Object.freeze({ g: 24, step: 1 / 60, maxSteps: 3, restitution: 0.12, friction: 0.85, cap: 400, settle: 4, fade: 0.35,
  restSpeed: 0.05, restSpin: 0.1, restFor: 0.5 });

const FIX_TOL = 0.05;                                       // AUTHORED: squares a fixed box's height may drift before it is made again
let lib = null;
/** Load the physics once (createRenderer awaits it with the models); a page that cannot load it stops there, as for a model. */
export async function loadBrickPhysics() {
  if (!lib) { await RAPIER.init(); lib = RAPIER; }
  return lib;
}

export class BrickWorld {
  constructor() {
    if (!lib) throw new Error('bricks.js: the physics was not loaded (createRenderer awaits loadBrickPhysics)');
    const R = lib;
    this.R = R;
    this.world = new R.World({ x: 0, y: -BRICK.g, z: 0 });
    this.world.timestep = BRICK.step;
    // the ground: one fixed slab with its top at y 0 (the land's relief is under 0.05, board.js heightOf)
    this.world.createCollider(R.ColliderDesc.cuboid(1000, 0.5, 1000).setTranslation(0, -0.5, 0).setFriction(BRICK.friction));
    this.fixed = new Map();      // key -> { collider, x, z, w, h }: what a brick can land on or hit
    this.acc = 0;
    this.made = 0;               // fixed boxes made so far (the page check reads it: a box made again wakes what rests on it)
  }

  /** A fixed box `w` across standing `h` tall on square-centre (x, z) under `key`; h <= 0 takes it away. */
  setFixed(key, x, z, w, h) {
    const f = this.fixed.get(key);
    // within FIX_TOL of what is there it stays: a castle's drawn top moves a little as it is animated, and a box made again every
    // frame wakes every brick resting on or beside it, so none ever comes to rest (R8, 11-14)
    if (f && Math.abs(f.h - h) < FIX_TOL && f.w === w && f.x === x && f.z === z) return;
    if (f) { this.world.removeCollider(f.collider, false); this.fixed.delete(key); }
    if (!(h > 0)) return;
    const c = this.world.createCollider(this.R.ColliderDesc.cuboid(w / 2, h / 2, w / 2).setTranslation(x, h / 2, z).setFriction(BRICK.friction));
    this.fixed.set(key, { collider: c, x, z, w, h }); this.made++;
  }

  /** A brick w x h x w, its centre at p, quaternion q, thrown at v (squares/s) spinning at av (rad/s). Returns its body. No CCD: a
   *  brick moves under 10 squares/s, 0.17 a step against boxes 0.3-1 square thick, and with it on they never came to rest (11-14). */
  addBrick(p, q, v, av, w, h) {
    const R = this.R;
    const body = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinvel(v.x, v.y, v.z).setAngvel({ x: av.x, y: av.y, z: av.z }));
    this.world.createCollider(R.ColliderDesc.cuboid(w / 2, h / 2, w / 2).setRestitution(BRICK.restitution).setFriction(BRICK.friction), body);
    return body;
  }

  /** A blast's kick on a brick at rest: wakes it and throws it (squares/s). */
  kick(body, v, av) { body.setLinvel(v, true); body.setAngvel(av, true); }

  /** How long body has been still, `still` s so far, after dt more: at BRICK.restFor it is put to sleep (a moving brick that touches it
   *  wakes it again). Returns the new still time. */
  rest(body, still, dt) {
    if (body.isSleeping()) return still;
    const v = body.linvel(), a = body.angvel();
    if (Math.hypot(v.x, v.y, v.z) > BRICK.restSpeed || Math.hypot(a.x, a.y, a.z) > BRICK.restSpin) return 0;
    still += dt;
    if (still >= BRICK.restFor) body.sleep();
    return still;
  }

  remove(body) { this.world.removeRigidBody(body); }

  /** Run the world for dt seconds of the board's clock in fixed steps (at most BRICK.maxSteps a frame). */
  step(dt) {
    this.acc += Math.max(0, dt);
    let n = 0;
    while (this.acc >= BRICK.step && n < BRICK.maxSteps) { this.world.step(); this.acc -= BRICK.step; n++; }
    if (n === BRICK.maxSteps) this.acc = 0;
  }

  dispose() { this.world.free(); this.fixed.clear(); }
}
