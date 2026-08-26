// econ_vec.js — SPACE BENCH pillar P4: ECONOMY. Learn to arbitrage a BLACK-BOX market from OBSERVED prices only.
// Iron law: the price function is NOT given; the agent knows only prices at planets it has VISITED (no omniscient
// global table); it LEARNS a price/route model as (s,r,o) vector-triples and plans arbitrage from it. The market is
// ORGANIC (prices emerge from supply/demand: buying raises, selling lowers; no hardcoded schedule).
// GIVEN: an organic market + the prices the agent has actually observed + fuel/travel cost.
// LEARNED: which planet sells a good cheap / buys it dear, and which routes profit. Ships only if it survives the audit.
'use strict';
const CFG = { PLANETS: 6, GOODS: 4, BASE: [10, 15, 9, 22], ELAST: 0.6, EQ: 60, REVERT: 0.2, HI: 1.6, LO: 0.55,
  TRADE_QTY: 12, TRAVEL_COST: 1.6, TRIPS: 220, OBS_HALFLIFE: 40 };
function stockTarget(p,g){ return p.makes[g]?CFG.EQ*CFG.HI:(p.needs[g]?CFG.EQ*CFG.LO:CFG.EQ); }   // producer stock high (cheap), consumer low (dear)
function mulberry32(seed){ let a=seed>>>0; return ()=>{ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return((t^t>>>14)>>>0)/4294967296; }; }
function clamp(x,a,b){ return x<a?a:(x>b?b:x); }

// ---- the BLACK-BOX ORGANIC MARKET (the agent is NOT given priceOf or the planet types) ----
function makeMarket(seed){ const rng=mulberry32(seed), planets=[];
  for(let i=0;i<CFG.PLANETS;i++){ const makes={}, needs={}, stock={};
    for(let g=0;g<CFG.GOODS;g++){ stock[g]=CFG.EQ; makes[g]=0; needs[g]=0; }
    // hidden type: each planet strongly PRODUCES one good (cheap) and CONSUMES another (dear)
    const mk=Math.floor(rng()*CFG.GOODS); let nd=Math.floor(rng()*CFG.GOODS); if(nd===mk) nd=(nd+1)%CFG.GOODS;
    makes[mk]=1; needs[nd]=1; const p={ id:i, makes, needs, stock, mk, nd, pos:[rng()*100,rng()*100] };
    for(let g=0;g<CFG.GOODS;g++) stock[g]=stockTarget(p,g);   // start at the stable target (producer cheap, consumer dear)
    planets.push(p); }
  return { planets }; }
function priceOf(p,g){ const ratio=CFG.EQ/Math.max(1,p.stock[g]); return CFG.BASE[g]*clamp(Math.pow(ratio,CFG.ELAST),0.3,3.5); }  // HIDDEN function
function marketStep(m){ for(const p of m.planets) for(let g=0;g<CFG.GOODS;g++){ p.stock[g]+=CFG.REVERT*(stockTarget(p,g)-p.stock[g]); p.stock[g]=Math.max(1,p.stock[g]); } }   // mean-revert -> stable modest spreads (trades perturb, revert restores)
function buy(m,p,g,qty){ const price=priceOf(p,g), n=Math.min(qty,Math.max(0,p.stock[g]-2)); p.stock[g]-=n; return {n, cost:price*n}; }   // buying drains stock -> price rises
function sell(m,p,g,qty){ const price=priceOf(p,g); p.stock[g]+=qty; return price*qty; }                                            // selling adds stock -> price falls
function travelCost(a,b){ return CFG.TRAVEL_COST*Math.hypot(a.pos[0]-b.pos[0],a.pos[1]-b.pos[1])/100; }

// ---- the LEARNING TRADER: observes only visited prices -> triples -> plans arbitrage ----
function makeTrader(){ return { obs:{}, credits:0, at:0 }; }   // obs[planet][good] = {price, t}
function observe(tr,m,pid,t){ const p=m.planets[pid]; if(!tr.obs[pid]) tr.obs[pid]={}; for(let g=0;g<CFG.GOODS;g++) tr.obs[pid][g]={price:priceOf(p,g), t}; }  // ONLY here does it read prices — at a visited planet
function obsPrice(tr,pid,g,t){ const o=tr.obs[pid]&&tr.obs[pid][g]; if(!o) return null; const w=Math.pow(0.5,(t-o.t)/CFG.OBS_HALFLIFE); return {price:o.price, conf:w}; }
// LEARNED knowledge as triples: (planet, sells_cheap|buys_dear, good) and (route a->b, yields, +profit)
function traderTriples(tr,m,t){ const T=[]; for(const pid in tr.obs) for(let g=0;g<CFG.GOODS;g++){ const o=obsPrice(tr,+pid,g,t); if(!o) continue;
    const rel=o.price<CFG.BASE[g]*0.85?'sells_cheap':(o.price>CFG.BASE[g]*1.15?'buys_dear':'fair'); T.push({s:'planet'+pid, r:rel, o:'good'+g+'@'+o.price.toFixed(1)}); } return T; }
function planRoute(tr,m,t,random){ const P=m.planets; let best=null;
  for(let a=0;a<P.length;a++) for(let g=0;g<CFG.GOODS;g++) for(let b=0;b<P.length;b++){ if(b===a) continue;
    const buyO=obsPrice(tr,a,g,t), sellO=obsPrice(tr,b,g,t); if(!buyO||!sellO) continue;                       // NO-OMNISCIENCE: only visited prices
    const spread=(sellO.price-buyO.price)*CFG.TRADE_QTY - travelCost(P[a],P[b]) - travelCost(P[tr.at],P[a]);
    const score=random?Math.random():spread*buyO.conf*sellO.conf;
    if(!best||score>best.score) best={a,b,g,score,spread}; }
  return best; }
function runTrader(m,seed,random){ const rng=mulberry32(seed), tr=makeTrader(); let t=0;
  for(let i=0;i<CFG.PLANETS;i++){ observe(tr,m,i,t); }                                                          // startup: it has SEEN the planets once (fair for both arms)
  for(let trip=0; trip<CFG.TRIPS; trip++){ marketStep(m); t++;
    const r = random ? {a:Math.floor(rng()*CFG.PLANETS), b:Math.floor(rng()*CFG.PLANETS), g:Math.floor(rng()*CFG.GOODS)} : planRoute(tr,m,t,false);
    if(!r || r.a===r.b) { tr.at=Math.floor(rng()*CFG.PLANETS); continue; }
    tr.credits -= travelCost(m.planets[tr.at], m.planets[r.a]); tr.at=r.a; observe(tr,m,r.a,t);               // travel to buy-planet, observe
    const b=buy(m,m.planets[r.a],r.g,CFG.TRADE_QTY); tr.credits-=b.cost;
    tr.credits -= travelCost(m.planets[r.a], m.planets[r.b]); tr.at=r.b; observe(tr,m,r.b,t);                 // travel to sell-planet, observe
    tr.credits += sell(m,m.planets[r.b],r.g,b.n); }
  return tr; }

// ---- HONEST AUDIT (ships only if it survives) ----
if (typeof require!=='undefined' && require.main===module){
  const seeds=[1,2,3,4,5]; let learnedTot=0, randomTot=0;
  for(const s of seeds){ learnedTot += runTrader(makeMarket(s), s, false).credits; randomTot += runTrader(makeMarket(s), s, true).credits; }
  const learned=learnedTot/seeds.length, random=randomTot/seeds.length;
  // organic check: buying raises price, selling lowers
  const m=makeMarket(9), p=m.planets[0], g=p.mk, p0=priceOf(p,g); buy(m,p,g,20); const pUp=priceOf(p,g); sell(m,p,g,40); const pDn=priceOf(p,g);
  // mutation: shuffle which planet is cheap/dear -> a trader trained on the OLD market, run on the NEW, should do worse; re-learning recovers
  const trOld=runTrader(makeMarket(3),3,false);
  function mutate(mm){ for(const p of mm.planets){ const tmp=p.mk; p.mk=p.nd; p.nd=tmp; for(let gg=0;gg<CFG.GOODS;gg++){p.makes[gg]=0;p.needs[gg]=0;} p.makes[p.mk]=1; p.needs[p.nd]=1; } return mm; }
  const stale=runTraderWithFrozenObs(mutate(makeMarket(3)), trOld.obs);       // old model, new market, no re-observe -> poor
  const reLearned=runTrader(mutate(makeMarket(3)), 3, false).credits;         // fresh learner on the mutated market -> recovers
  const t=CFG.TRIPS;
  console.log(JSON.stringify({
    learned_avg_profit:+learned.toFixed(0), random_avg_profit:+random.toFixed(0),
    learned_beats_random: learned>random+50,
    organic_market: (pUp>p0 && pDn<pUp),  // buy raised, sell lowered
    no_omniscience:'by construction — planRoute reads only tr.obs (visited), never priceOf directly',
    mutation_stale_profit:+stale.toFixed(0), mutation_relearned_profit:+reLearned.toFixed(0),
    mutation_passes: reLearned>stale+50,
    sample_learned_triples: traderTriples(runTrader(makeMarket(1),1,false), makeMarket(1), t).filter(x=>x.r!=='fair').slice(0,3).map(x=>`(${x.s}, ${x.r}, ${x.o})`)
  }, null, 1));
}
// a trader that plans on FROZEN (stale) observations of the old market, executed on the new market
function runTraderWithFrozenObs(m, frozenObs){ const rng=mulberry32(99); const tr={obs:JSON.parse(JSON.stringify(frozenObs)), credits:0, at:0}; let t=999999;   // huge t -> obs are stale but still the only knowledge
  for(let trip=0; trip<CFG.TRIPS; trip++){ marketStep(m);
    const r=planRoute(tr,m,t,false); if(!r||r.a===r.b){ continue; }
    tr.credits -= travelCost(m.planets[tr.at], m.planets[r.a]); tr.at=r.a;                                    // NOTE: does NOT re-observe -> stuck on stale model
    const b=buy(m,m.planets[r.a],r.g,CFG.TRADE_QTY); tr.credits-=b.cost;
    tr.credits -= travelCost(m.planets[r.a], m.planets[r.b]); tr.at=r.b;
    tr.credits += sell(m,m.planets[r.b],r.g,b.n); }
  return tr.credits; }
if (typeof module!=='undefined') module.exports = { CFG, makeMarket, priceOf, marketStep, buy, sell, makeTrader, runTrader, traderTriples };
