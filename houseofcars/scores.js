// scores.js - the shared high-score boards (UC-24, UC-25): the loading game's rocks and every car's quarter mile, with the names
// people enter. The rows live on a server (data/scores.json "endpoint": a Google Apps Script web app over a sheet the owner keeps,
// tools/scores_server.gs); the page keeps none of them itself, so a board that cannot be reached SAYS so (UC-24.4a, UC-25.3a)
// and is never stood in for by this device's own scores. Every board also shows the house row the page works out itself
// (R.J.Thompson, the owner's ask 11-07): the server never holds it, and nobody else may enter under that name.
export const HOUSE_NAME = 'R.J.Thompson';
export const TOP = 10;                                     // rows a board shows (an arcade board's ten)
export const NAME_MAX = 16;                                // AUTHORED: room for "R.J.Thompson" and most first-and-last names
const NAME_CHARS = /^[A-Za-z0-9 .'_-]+$/;
// AUTHORED: a public board on a dealer's page; words that never belong on one, matched in the name with its spaces and marks
// taken out. The server (tools/scores_server.gs) holds the same list, so a page that skips this check gets the same answer
const BLOCKED = ['fuck', 'shit', 'cunt', 'nigg', 'fag', 'bitch', 'whore', 'slut', 'rape', 'nazi', 'hitler', 'kike', 'chink', 'retard', 'porn', 'kkk'];
const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** a name as entered: { ok, name } or { ok: false, why } in words for the box */
export function checkName(raw) {
  const name = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!name) return { ok: false, why: 'Type a name first.' };
  if (name.length > NAME_MAX) return { ok: false, why: 'At most ' + NAME_MAX + ' characters.' };
  if (!NAME_CHARS.test(name)) return { ok: false, why: "Letters, digits, spaces and . - ' _ only." };
  if (squash(name) === squash(HOUSE_NAME)) return { ok: false, why: 'That name is the house’s. Pick your own.' };
  if (BLOCKED.some((w) => squash(name).includes(w))) return { ok: false, why: 'Pick another name.' };
  return { ok: true, name };
}

// UC-46 an email for the coffee, as entered: { ok, email } or { ok: false, why }. The server (tools/scores_server.gs) holds the same rule
export const EMAIL_MAX = 120;                             // AUTHORED: room for any real address
const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[A-Za-z]{2,}$/;
export function checkEmail(raw) {
  const email = String(raw || '').trim();
  if (!email) return { ok: false, why: 'Type your email first.' };
  if (email.length > EMAIL_MAX || !EMAIL.test(email)) return { ok: false, why: 'That does not look like an email address.' };
  return { ok: true, email };
}

/** one board's rows with the house row among them, best first, the top TOP; lower: true where a lower score wins (a time) */
export function ranked(rows, house, lower) {
  const all = rows.concat(house ? [Object.assign({ house: true }, house)] : []);
  all.sort((a, b) => (lower ? a.score - b.score : b.score - a.score) || String(a.at || '').localeCompare(String(b.at || '')));
  return all.slice(0, TOP);
}
/** would this score make the board's top TOP (the house row counted) */
export function qualifies(rows, house, lower, score) {
  const r = ranked(rows, house, lower);
  return r.length < TOP || (lower ? score < r[r.length - 1].score : score > r[r.length - 1].score);
}

/** the shared boards on the server named in data/scores.json; every call either answers or throws with the reason in words */
export class ScoreBoard {
  constructor(cfg) {
    if (!cfg || !('endpoint' in cfg)) throw new Error('data/scores.json has no "endpoint"');
    this.endpoint = cfg.endpoint; this.why = cfg.why || '';
  }
  get ready() { return !!this.endpoint; }
  notReady() { return new Error('The shared board is not set up yet' + (this.why ? ' (' + this.why + ')' : '')); }
  /** the board's stored rows: [{ name, score, kmh?, at }] */
  async top(board) { return (await this.board(board)).rows; }
  /** the board's rows, and whether its first place can claim the coffee (UC-46): { rows, claims } */
  async board(board) {
    if (!this.ready) throw this.notReady();
    const r = await fetch(this.endpoint + '?board=' + encodeURIComponent(board), { cache: 'no-store' });
    const j = await this.read(r);
    return { rows: j.rows, claims: j.claims === true };
  }
  /** UC-46.3 a first place claims the coffee: c { name, score, kmh, email, tape }; answers the board's rows, or throws the reason */
  async claim(board, c) {
    if (!this.ready) throw this.notReady();
    const r = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ claim: true, board }, c)) });
    const j = await this.read(r);
    if (j.claimed !== true) throw new Error('The shared board did not take the claim');
    return j.rows;
  }
  /** store one row; answers the board's rows after it */
  async submit(board, entry) {
    if (!this.ready) throw this.notReady();
    // text/plain keeps it a simple request: an Apps Script web app answers no CORS preflight
    const r = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(Object.assign({ board }, entry)) });
    return this.answer(r);
  }
  async answer(r) { return (await this.read(r)).rows; }
  async read(r) {                                         // the server's answer, checked: { rows, ... } or the reason, thrown
    if (!r.ok) throw new Error('The shared board answered HTTP ' + r.status);
    let j; try { j = await r.json(); } catch (e) { throw new Error('The shared board sent something that is not a board'); }
    if (j.error) throw new Error('The shared board said: ' + j.error);
    if (!Array.isArray(j.rows)) throw new Error('The shared board sent no rows');
    return j;
  }
}

/** the last name this device entered, to fill the box next time (a convenience; the board keeps the rows) */
export function lastName() { try { return localStorage.getItem('hoc.name') || ''; } catch (e) { return ''; } }
export function keepName(n) { try { localStorage.setItem('hoc.name', n); } catch (e) { /* a private window keeps none */ } }

/** a board as HTML: rank, name, score; the house row and the row just saved marked (by name and score: the server stamps its own time) */
export function boardHTML(rows, fmt, mine) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return '<ol class="hiscores">' + rows.map((r, i) => '<li class="' + (r.house ? 'house' : '') + (mine && !r.house && r.name === mine.name && r.score === mine.score ? ' me' : '') + '">' +
    '<span class="n">' + (i + 1) + '</span><span class="nm">' + esc(r.name) + '</span><b>' + esc(fmt(r)) + '</b></li>').join('') + '</ol>';
}
