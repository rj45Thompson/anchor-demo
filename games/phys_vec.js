// phys_vec.js — SLICE 1 of the honest black-box controller (iron-law: no-toy embodiment).
// Faithful JS port of phys_agent_vec.py's body + babble + least-squares decode. The Starfighter ship
// IS A VECTOR (heading h); K UNLABELED black-box wires mix unknown-ly into torque(3)+thrust(1). The agent
// NEVER told which wire does what — it BABBLES, records proprioception, and DECODES the forces into
// (subject, relation, object) VECTOR-TRIPLES. Verified by force-recovery + a mutation test (rewire → break → re-decode).
// GIVEN: the black box exists + noisy proprioception. LEARNED: every force triple. No aimAt, no handed physics.
'use strict';
const CFG = { K: 6, BABBLE: 1500, NOISE: 0.02, LIN_DRAG: 0.90, ANG_DRAG: 0.85, G: [0, 0, -0.12] };

// ---- tiny linear algebra (no numpy) ----
function matmulVec(M, x){ return M.map(r => r.reduce((a, v, i) => a + v * x[i], 0)); }
function cross(a, b){ return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function norm3(h){ const n = Math.hypot(h[0],h[1],h[2]); return n>1e-9 ? [h[0]/n,h[1]/n,h[2]/n] : [1,0,0]; }
function randn(rng){ // Box-Muller
  let u=0,v=0; while(u===0)u=rng(); while(v===0)v=rng(); return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v); }
function mulberry32(seed){ let a=seed>>>0; return function(){ a|=0; a=a+0x6D2B79F5|0; let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t; return((t^t>>>14)>>>0)/4294967296; }; }
// least squares: solve (X^T X) B = X^T Y for each output column, via Gaussian elimination.
function lstsq(X, Y){ const n=X.length, d=X[0].length, m=Y[0].length;
  const A=Array.from({length:d},()=>new Array(d).fill(0)), C=Array.from({length:d},()=>new Array(m).fill(0));
  for(let r=0;r<n;r++){ const xr=X[r], yr=Y[r]; for(let i=0;i<d;i++){ const xi=xr[i]; for(let j=0;j<d;j++) A[i][j]+=xi*xr[j]; for(let k=0;k<m;k++) C[i][k]+=xi*yr[k]; } }
  for(let i=0;i<d;i++) A[i][i]+=1e-6;                     // ridge for stability
  // Gaussian elimination on [A | C]
  for(let col=0;col<d;col++){ let piv=col; for(let r=col+1;r<d;r++) if(Math.abs(A[r][col])>Math.abs(A[piv][col])) piv=r;
    [A[col],A[piv]]=[A[piv],A[col]]; [C[col],C[piv]]=[C[piv],C[col]];
    const pv=A[col][col]||1e-9; for(let j=col;j<d;j++) A[col][j]/=pv; for(let k=0;k<m;k++) C[col][k]/=pv;
    for(let r=0;r<d;r++){ if(r===col) continue; const f=A[r][col]; if(!f) continue; for(let j=col;j<d;j++) A[r][j]-=f*A[col][j]; for(let k=0;k<m;k++) C[r][k]-=f*C[col][k]; } }
  return C; // B: d x m  (rows = features, cols = outputs)
}

// ---- the BLACK-BOX BODY (hidden truth the agent must decode) ----
function makeBody(seed){ const rng=mulberry32(seed);
  const B_tau=[[0,0,0,0,0,0],[0,0,0,0,0,0],[0,0,0,0,0,0]];   // 3 x K wire->torque (hidden)
  for(let i=0;i<3;i++) for(let k=0;k<CFG.K;k++) B_tau[i][k]=rng()*1.0-0.5;
  const b_f=[]; for(let k=0;k<CFG.K;k++) b_f.push(rng()*2-1);  // K wire->thrust (hidden)
  return { B_tau, b_f, g:CFG.G, lin_drag:CFG.LIN_DRAG, ang_drag:CFG.ANG_DRAG };
}
// physics-as-triples (this is what the DECODE must recover — the agent is NOT given this)
function bodyTriples(body){ const t=[{s:'angvel',r:'scaled_by',o:body.ang_drag},{s:'velocity',r:'scaled_by',o:body.lin_drag},{s:'body',r:'accelerated_by',o:body.g.slice()}];
  for(let k=0;k<CFG.K;k++){ t.push({s:'wire'+k,r:'torques',o:[body.B_tau[0][k],body.B_tau[1][k],body.B_tau[2][k]]}); t.push({s:'wire'+k,r:'thrusts',o:body.b_f[k]}); } return t; }
// one true step: torque spins w, w rotates heading h, thrust pushes v along h
function stepTrue(body, v, h, w, u, rng){
  let w2 = w.map((wi,i)=> body.ang_drag*wi + body.B_tau[i].reduce((a,b,k)=>a+b*u[k],0) + (rng?CFG.NOISE*randn(rng):0));
  let h2 = norm3([h[0]+ (w2[1]*h[2]-w2[2]*h[1]), h[1]+(w2[2]*h[0]-w2[0]*h[2]), h[2]+(w2[0]*h[1]-w2[1]*h[0])]);
  const thrust = body.b_f.reduce((a,b,k)=>a+b*u[k],0);
  let v2 = v.map((vi,i)=> body.lin_drag*vi + body.g[i] + thrust*h2[i] + (rng?CFG.NOISE*randn(rng):0));
  return { v:v2, h:h2, w:w2 };
}

// ---- BABBLE: flail with random wire outputs, record proprioceptive transitions ----
function babble(body, n, seed){ const rng=mulberry32(seed); const V=[],H=[],W=[],U=[],Vn=[],Wn=[];
  let v=[0,0,0], w=[0,0,0], h=norm3([randn(rng),randn(rng),randn(rng)]);
  for(let i=0;i<n;i++){ const u=[]; for(let k=0;k<CFG.K;k++) u.push(rng()*2-1);
    const nx=stepTrue(body,v,h,w,u,rng); V.push(v); H.push(nx.h); W.push(w); U.push(u); Vn.push(nx.v); Wn.push(nx.w); v=nx.v; w=nx.w; h=nx.h; }
  return {V,H,W,U,Vn,Wn}; }
// features
function afeat(W,U){ return W.map((wr,i)=>[...wr, ...U[i], 1]); }                                  // [w, u, 1]
function vfeat(V,H,U){ return V.map((vr,i)=>{ const outer=[]; for(let a=0;a<3;a++) for(let k=0;k<CFG.K;k++) outer.push(H[i][a]*U[i][k]); return [...vr, ...outer, 1]; }); } // [v, h⊗u, 1]
// DECODE: least-squares fit angular + linear sub-models → recovered forces
function decode(data){ const Ca=lstsq(afeat(data.W,data.U), data.Wn); const Cv=lstsq(vfeat(data.V,data.H,data.U), data.Vn); return {Ca,Cv}; }
// pull the learned forces back out as recovered B_tau / b_f
function recovered(m){ const Btau=[[],[],[]]; for(let i=0;i<3;i++) for(let k=0;k<CFG.K;k++) Btau[i][k]=m.Ca[3+k][i];  // Ca rows: [w(3), u(K), 1] ; cols = w' axis
  const bf=[]; for(let k=0;k<CFG.K;k++){ let s=0; for(let a=0;a<3;a++) s+=m.Cv[3+a*CFG.K+k][a]; bf.push(s/3); }        // Cv bilinear block h_a*u_k, diagonal a==out
  return {Btau,bf}; }
function relErr(A,B){ let num=0,den=0; const fa=[].concat(...(Array.isArray(A[0])?A:[A])), fb=[].concat(...(Array.isArray(B[0])?B:[B])); for(let i=0;i<fa.length;i++){ num+=(fa[i]-fb[i])**2; den+=fb[i]**2; } return Math.sqrt(num/Math.max(1e-9,den)); }
// learned forces AS TRIPLES (the shared vector-triple representation)
function learnedTriples(m){ const r=recovered(m); const t=[]; for(let k=0;k<CFG.K;k++){ t.push({s:'wire'+k,r:'torques',o:[r.Btau[0][k],r.Btau[1][k],r.Btau[2][k]]}); t.push({s:'wire'+k,r:'thrusts',o:r.bf[k]}); } return t; }

// ---- SELF-TEST (the honest audit): recovery near noise floor + MUTATION (rewire → break → re-decode) ----
if (typeof require!=='undefined' && require.main===module){
  const body=makeBody(7);
  const m=decode(babble(body,CFG.BABBLE,1)); const rec=recovered(m);
  const tauErr=relErr(rec.Btau, body.B_tau), thrErr=relErr(rec.bf, body.b_f);
  // MUTATION: rewire the body's torque map; the OLD model must now be wrong; re-babble must recover again.
  const body2=makeBody(7); for(let i=0;i<3;i++) for(let k=0;k<CFG.K;k++) body2.B_tau[i][k]=body.B_tau[2-i>=0?2-i:0][(k+3)%CFG.K]; // scramble wiring
  const staleErr=relErr(recovered(m).Btau, body2.B_tau);                 // old model vs new body = should be BAD
  const m2=decode(babble(body2,CFG.BABBLE,2)); const reErr=relErr(recovered(m2).Btau, body2.B_tau);  // re-decode = good again
  console.log(JSON.stringify({
    decode_torque_relErr:+tauErr.toFixed(3), decode_thrust_relErr:+thrErr.toFixed(3),
    recovered_ok: tauErr<0.15 && thrErr<0.2,
    mutation_stale_model_relErr:+staleErr.toFixed(3), mutation_redecoded_relErr:+reErr.toFixed(3),
    mutation_test_passes: staleErr>0.5 && reErr<0.15,
    sample_learned_triples: learnedTriples(m).slice(0,3).map(t=>`(${t.s}, ${t.r}, ${Array.isArray(t.o)?'['+t.o.map(x=>+x.toFixed(2)).join(',')+']':(+t.o).toFixed(2)})`)
  }, null, 1));
}
if (typeof module!=='undefined') module.exports = { CFG, makeBody, bodyTriples, stepTrue, babble, decode, recovered, learnedTriples, relErr };
