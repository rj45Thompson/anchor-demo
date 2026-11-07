// fight/rules.js - "Fight the manager for a deal" (UC-29), the joke brawl's rules: the moves, what a hit does, the made-up manager
// Doc Fee's dirty tricks, the fees each hit knocks off and the score. Pure: no DOM and no three, so node (test/fight.test.mjs) runs
// the same rules the page plays. A JOKE: Doc Fee and every fee here are made up; they are nobody's real staff or fees. Metres and
// seconds; x grows to the right. Every number is AUTHORED, for feel (a fighting game's frame data, scaled to seconds).
export const ARENA = { left: -9, right: 9 };
export const SPEED = { player: 3.2, manager: 1.6 };
// a move: wind-up, the window it can hit in, the recovery after; its reach in front of the fighter; damage; knock-back
export const MOVES = {
  punch: { startup: 0.12, active: 0.10, recover: 0.18, reach: 1.15, dmg: 7, push: 0.25 },
  kick: { startup: 0.20, active: 0.12, recover: 0.28, reach: 1.45, dmg: 11, push: 0.55 },
  special: { startup: 0.30, active: 0.25, recover: 0.45, reach: 3.2, dmg: 18, push: 1.4, cooldown: 4.0 },   // "Read the fine print"
  swing: { startup: 0.35, active: 0.12, recover: 0.5, reach: 1.25, dmg: 9, push: 0.5 },                    // Doc Fee's clipboard
};
export const HIT_STUN = 0.35, BLOCK_KEEP = 0.25;            // stunned after a hit; what share of a hit a block lets through
// what each landed hit knocks off the price, in turn (the joke: the junk a parody dealer piles on)
export const FEES = [
  { what: 'Doc fee', usd: 499 }, { what: 'Undercoating', usd: 1295 }, { what: 'Nitrogen in the tyres', usd: 399 },
  { what: 'VIN etching', usd: 799 }, { what: 'Paint protection', usd: 1495 }, { what: 'Extended warranty', usd: 2995 },
  { what: 'Fabric guard', usd: 595 }, { what: 'Market adjustment', usd: 3500 }, { what: 'Admin fee', usd: 650 }, { what: 'Wheel locks', usd: 249 },
];
export const LINES = {
  manager: ['Let me talk to my manager.', 'That price is for today only.', 'What would it take to put you in this car today?', 'I’m losing money on this deal!', 'Have you considered our extended warranty?', 'My hands are tied.'],
  sidekick: ['Sign THIS.', 'Read the fine print!', 'No undercoating!', 'We’re not paying for nitrogen.'],
};

export function makeFighter(x, facing, hp) { return { x, facing, hp, max: hp, state: 'idle', t: 0, move: null, hitDone: false, stun: 0, cool: 0, blocking: false }; }
export function makeFight() {
  return { t: 0, you: makeFighter(-3, 1, 100), boss: makeFighter(3, -1, 200), pal: makeFighter(-4.5, 1, 1), fees: [], papers: [], cloud: null,
           boss_ai: { next: 1.2, away: 0, said: null }, pal_ai: { next: 3.5, said: null }, over: null, events: [] };
}
const canAct = (f) => f.stun <= 0 && f.state !== 'down' && !f.move;

/** start a move if the fighter is free (special needs its cooldown) */
export function attack(f, name) {
  if (!canAct(f)) return false;
  if (name === 'special' && f.cool > 0) return false;
  f.move = { name, t: 0, ...MOVES[name] }; f.hitDone = false; f.state = name;
  if (name === 'special') f.cool = MOVES.special.cooldown;
  return true;
}
/** the move's phase now: 'startup' | 'active' | 'recover' | null when over */
export function phase(m) { return !m ? null : m.t < m.startup ? 'startup' : m.t < m.startup + m.active ? 'active' : m.t < m.startup + m.active + m.recover ? 'recover' : null; }
function landed(att, def) { const d = (def.x - att.x) * att.facing; return d > 0 && d <= att.move.reach; }
/** a hit: damage (less through a block), knock-back, stun; returns the damage dealt */
export function hit(def, dmg, push, dir) {
  if (def.state === 'down') return 0;
  const k = def.blocking ? BLOCK_KEEP : 1, d = Math.round(dmg * k);
  def.hp = Math.max(0, def.hp - d); def.x += push * k * dir; def.stun = def.blocking ? 0.08 : HIT_STUN;
  def.move = null; def.state = def.hp <= 0 ? 'down' : def.blocking ? 'block' : 'hit';
  return d;
}

/** one step. input: { left, right, block, punch, kick, special } (edges for the attacks, the player's own presses) */
export function step(F, input, dt) {
  if (F.over) return F;
  F.t += dt; F.events = [];
  const you = F.you, boss = F.boss, pal = F.pal;
  for (const f of [you, boss, pal]) { f.stun = Math.max(0, f.stun - dt); f.cool = Math.max(0, f.cool - dt); }
  // the player
  you.blocking = !!input.block && canAct(you);
  if (canAct(you) && !you.blocking) {
    const dir = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    you.x += dir * SPEED.player * dt; you.state = dir ? 'walk' : 'idle';
    if (dir) you.facing = dir;
  } else if (you.blocking) you.state = 'block';
  for (const a of ['punch', 'kick', 'special']) if (input[a] && attack(you, a)) F.events.push({ kind: 'swing', who: 'you', move: a });
  you.facing = boss.x >= you.x ? 1 : -1;                    // a fighter always faces the other
  // the manager's dirty tricks: walk in and swing, throw paperwork, go "talk to his manager", spray undercoating
  const ai = F.boss_ai;
  if (boss.state !== 'down') {
    boss.facing = you.x >= boss.x ? 1 : -1;
    if (ai.away > 0) {                                      // off to "talk to his manager": out of reach, healing a little
      ai.away -= dt; boss.x += (ARENA.right + 2 - boss.x) * Math.min(1, dt * 3); boss.state = 'walk'; boss.hp = Math.min(boss.max, boss.hp + 4 * dt);
      if (ai.away <= 0) { boss.x = ARENA.right; F.events.push({ kind: 'say', who: 'boss', text: 'OK, my manager says this is a GREAT deal.' }); }
    } else if (canAct(boss)) {
      ai.next -= dt;
      const gap = Math.abs(you.x - boss.x);
      if (gap > MOVES.swing.reach * 0.9) { boss.x += boss.facing * SPEED.manager * dt; boss.state = 'walk'; } else boss.state = 'idle';
      if (ai.next <= 0) {
        const roll = (F.t * 7.31) % 1;                      // the manager's whim: deterministic, so a test can replay a fight
        if (gap <= MOVES.swing.reach) { attack(boss, 'swing'); ai.next = 0.9; }
        else if (roll < 0.45) { F.papers.push({ x: boss.x, dir: boss.facing, t: 0 }); F.events.push({ kind: 'throw', what: 'Extended warranty' }); ai.next = 1.6; }
        else if (roll < 0.62 && boss.hp < boss.max * 0.7) { ai.away = 3; F.events.push({ kind: 'say', who: 'boss', text: LINES.manager[0] }); ai.next = 4; }
        else if (roll < 0.8 && !F.cloud) { F.cloud = { x: boss.x + boss.facing * 1.6, t: 0 }; F.events.push({ kind: 'throw', what: 'Undercoating' }); ai.next = 2.2; }
        else { F.events.push({ kind: 'say', who: 'boss', text: LINES.manager[1 + Math.floor(roll * 5) % 5] }); ai.next = 1.2; }
      }
    }
  }
  // the sidekick: steps in now and then with a kick, and says why
  const pa = F.pal_ai;
  pal.x += ((you.x - 1.4 * you.facing) - pal.x) * Math.min(1, dt * 2.5); pal.facing = you.facing;
  pa.next -= dt;
  if (pa.next <= 0 && boss.state !== 'down' && F.boss_ai.away <= 0) {
    pa.next = 5;
    if (Math.abs(boss.x - you.x) < 3) { const dmg = hit(boss, 6, 0.6, you.facing); if (dmg) fee(F, dmg); F.events.push({ kind: 'say', who: 'pal', text: LINES.sidekick[Math.floor(F.t) % LINES.sidekick.length] }); }
  }
  // moves in flight
  for (const [att, def, who] of [[you, boss, 'you'], [boss, you, 'boss']]) {
    if (!att.move) continue;
    att.move.t += dt;
    const ph = phase(att.move);
    if (ph === 'active' && !att.hitDone && landed(att, def)) {
      att.hitDone = true;
      const dmg = hit(def, att.move.dmg, att.move.push, att.facing);
      if (dmg) { F.events.push({ kind: 'hit', who, move: att.move.name, dmg }); if (who === 'you') fee(F, dmg); }
    }
    if (ph === null) { att.move = null; att.state = 'idle'; }
  }
  // the paperwork flies at the player; the undercoating hangs in the air a while
  for (const p of F.papers) { p.t += dt; p.x += p.dir * 6 * dt; if (!p.done && Math.abs(p.x - you.x) < 0.5) { p.done = true; hit(you, 8, 0.4, p.dir); F.events.push({ kind: 'hit', who: 'boss', move: 'paper', dmg: 8 }); } }
  F.papers = F.papers.filter((p) => !p.done && p.t < 4);
  if (F.cloud) { F.cloud.t += dt; if (Math.abs(F.cloud.x - you.x) < 1.2 && !you.blocking && F.cloud.t > 0.4) you.hp = Math.max(0, you.hp - 10 * dt); if (F.cloud.t > 3) F.cloud = null; }
  for (const f of [you, boss]) f.x = Math.max(ARENA.left, Math.min(ARENA.right + (f === boss && F.boss_ai.away > 0 ? 3 : 0), f.x));
  if (you.hp <= 0) { you.state = 'down'; F.over = { won: false, t: F.t }; }
  else if (boss.hp <= 0) { boss.state = 'down'; F.over = { won: true, t: F.t }; }
  return F;
}
/** a landed hit knocks the next fee off the price */
function fee(F, dmg) { const f = FEES[F.fees.length % FEES.length]; F.fees.push(f); F.events.push({ kind: 'fee', what: f.what, usd: f.usd, dmg }); }
/** the score: every dollar knocked off, and on a win a bonus for time left under two minutes and for health kept; rounded up to
 *  whole tens, as the shared board keeps points (tools/scores_server.gs) */
export function score(F) {
  const off = F.fees.reduce((a, f) => a + f.usd, 0);
  const raw = !F.over || !F.over.won ? off : off + Math.max(0, Math.round((120 - F.over.t) * 50)) + F.you.hp * 25;
  return Math.ceil(raw / 10) * 10;
}
export const discount = (F) => F.fees.reduce((a, f) => a + f.usd, 0);
