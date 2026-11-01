// Pure-logic checks against the numbers printed on the sheet. usage: node test_core.js <html>
const fs = require('fs'), assert = require('assert');
const html = fs.readFileSync(process.argv[2], 'utf8');
const core = html.split('/*CORE*/')[1].split('/*END CORE*/')[0];
const api = new Function(core + '; return {SECTIONS,ROWS,COLS,fmt,parseMeasure,blankSheet,offsetsOf,enumerate,labelOf,resolve,counts,checks};')();
const { fmt, parseMeasure, blankSheet, resolve, counts, checks, enumerate, labelOf } = api;
const I = (w, n = 0) => w * 16 + n;
let ok = 0; const t = (name, f) => { f(); ok++; console.log('ok  ', name); };

t('fmt reduces and signs', () => {
  assert.equal(fmt(I(10, 4)), '10 1/4'); assert.equal(fmt(I(6, 11)), '6 11/16'); assert.equal(fmt(13), '13/16');
  assert.equal(fmt(0), '0'); assert.equal(fmt(-2), '−1/8'); assert.equal(fmt(2, true), '+1/8'); assert.equal(fmt(I(12)), '12');
});
t('parser takes the ways a tape reading gets written', () => {
  for (const [a, b] of [['10 1/4', 164], ['10-1/4', 164], ['10 1/4"', 164], ['10.25', 164], ['1/4', 4], ['10', 160], ['.5', 8], ['-1/8', -2], ['+1/8', 2], ['6 11/16', 107]]) assert.equal(parseMeasure(a).v, b, a);
  assert.ok(parseMeasure('1/32').error); assert.ok(parseMeasure('5/4').error); assert.ok(parseMeasure('abc').error); assert.ok(parseMeasure('').error);
  assert.equal(parseMeasure('10.3').snapped, true); assert.equal(parseMeasure('10.3').v, 165);
});
const printed = () => { const s = blankSheet('x', '2026-10-31'); s.values = { L0_wM: I(6, 11), L0_hC: I(7, 5) }; return s; };
t('one width + one height reproduces the printed upper drawing', () => {
  const r = resolve(printed());
  for (const id of ['U0_wT', 'U0_wM', 'U0_wB', 'U1_wT', 'U1_wM', 'U1_wB']) assert.equal(fmt(r[id].v), '10 1/4', id);
  for (const id of ['U_hL', 'U0_hC', 'U_m0', 'U1_hC', 'U_hR']) assert.equal(fmt(r[id].v), '11', id);
  for (const id of ['U0_d1', 'U0_d2', 'U1_d1', 'U1_d2']) assert.equal(fmt(r[id].v), '15 1/16', id);
});
t('and fills the lower drawing, measured stays measured', () => {
  const r = resolve(printed());
  for (const id of ['L0_wT', 'L0_wB', 'L1_wT', 'L1_wM', 'L1_wB']) assert.equal(fmt(r[id].v), '6 11/16', id);
  for (const id of ['L0_hL', 'L0_hR', 'L1_hL', 'L1_hC', 'L1_hR']) assert.equal(fmt(r[id].v), '7 5/16', id);
  assert.equal(r.L0_wM.src, 'measured'); assert.equal(r.L1_wM.src, 'calc');
  assert.equal(fmt(r.L0_d1.v), '9 15/16');      // the sheet prints 9 7/8: CAD rounded from unrounded sides. Reported, not hidden.
});
t('reverse: upper measured fills lower', () => {
  const s = blankSheet('x'); s.values = { U0_wM: I(10, 4), U0_hC: I(11) };
  const r = resolve(s); assert.equal(fmt(r.L0_wM.v), '6 11/16'); assert.equal(fmt(r.L0_hC.v), '7 5/16');
});
t('a calculated value never overwrites a measured one', () => {
  const s = printed(); s.values.U0_wT = I(10, 5); const r = resolve(s);
  assert.equal(fmt(r.U0_wT.v), '10 5/16'); assert.equal(r.U0_wT.src, 'measured');
});
t('table column: A alone fills all seven rows with the printed offsets', () => {
  const s = blankSheet('x'); s.values = { T_scr_C: I(20) }; const r = resolve(s), v = k => fmt(r['T_' + k + '_C'].v);
  assert.equal(v('gls'), '20'); assert.equal(r.T_gls_C.src, 'calc'); assert.equal(r.T_gls_C.why, 'Sheet rule: A = B');
  assert.equal(v('kpr'), '20 13/16'); assert.equal(v('sash'), '23 3/16'); assert.equal(v('op'), '22 3/8'); assert.equal(v('hng'), '23 9/16'); assert.equal(v('nose'), '23 11/16');
  assert.equal(r.T_scr_D, undefined);          // other columns stay blank
});
t('table: measured B drives keeper and sash, A drives the rest', () => {
  const s = blankSheet('x'); s.values = { T_scr_A: I(20), T_gls_A: I(20, 2) }; const r = resolve(s);
  assert.equal(fmt(r.T_kpr_A.v), '20 15/16'); assert.equal(fmt(r.T_op_A.v), '22 3/8');
});
t('left section: keeper stays blank until entered, others change', () => {
  const s = blankSheet('x'); s.section = 'left'; s.values = { T_scr_A: I(20) }; let r = resolve(s);
  assert.equal(r.T_kpr_A, undefined); assert.equal(fmt(r.T_nose_A.v), '23 3/4');
  s.offsetEdits = { left: { kpr: 13 } }; r = resolve(s); assert.equal(fmt(r.T_kpr_A.v), '20 13/16');
});
t('tolerance: unset gives a difference, set gives pass or fail', () => {
  const s = blankSheet('x'); s.values = { T_scr_A: I(20), T_gls_A: I(20, 2) };
  assert.equal(checks(s)[0].level, 'diff');
  s.tolerance = 2; assert.equal(checks(s)[0].level, 'pass'); s.tolerance = 1; assert.equal(checks(s)[0].level, 'fail');
});
t('checks catch a bowed width, a racked opening, a plane off its offset', () => {
  const s = blankSheet('x'); s.values = { L0_wT: I(30), L0_wM: I(30, 2), L0_d1: I(40), L0_d2: I(40, 3), T_scr_B: I(20), T_nose_B: I(24) };
  const txt = checks(s).map(x => x.text).join('\n');
  assert.match(txt, /widths differ by 1\/8/); assert.match(txt, /out of square, diagonals differ by 3\/16/); assert.match(txt, /Frame nose plane is 24, the offset gives 23 11\/16 \(\+5\/16\)/);
});
t('plumb and seals are never calculated', () => {
  const r = resolve(printed()); for (const id of ['P_hinge', 'P_lock', 'P_frame', 'P_sash', 'X_primary', 'X_mid', 'X_kheight', 'X_kreach', 'L_oL', 'L_oR']) assert.equal(r[id], undefined, id);
});
t('every blank has a label and an id only once, for 1 to 4 lites', () => {
  for (const n of [1, 2, 3, 4]) { const s = blankSheet('x'); s.lites = n; const ids = enumerate(s); assert.equal(new Set(ids).size, ids.length, 'dupes at ' + n); ids.forEach(id => assert.ok(labelOf(id) && !labelOf(id).includes('undefined'), id)); }
  const s = blankSheet('x'); console.log('      twin sheet has', enumerate(s).length, 'blanks');
});
console.log(ok, 'groups passed'); const c = counts(printed(), resolve(printed())); console.log('2 measurements ->', c);
