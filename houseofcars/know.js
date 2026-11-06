// know.js - "Know this car" on a car for sale's card (UC-14): what reviewers rated it, what owners report going wrong, its
// recalls from Transport Canada, and for the sports cars the common mods and the owners' clubs. Every line carries its
// source link; the summary is written by an AI from those sources and says so. Data: data/reviews.json (tools/reviews.py, from
// research/reviews/<key>.json) and data/recalls.json (tools/recalls.py). A car with no entry shows nothing here, never a guess.

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return u; } };
const link = (u, text) => '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(text || host(u)) + '</a>';
const sources = (list) => list.map((s) => link(s.url)).join(' · ');

// the recall block: Transport Canada's count for the model year, each recall's system and its own summary (UC-14.3)
function recallsHTML(rc) {
  if (!rc) return '';
  if (rc.kind !== 'READ') return '<details class="know"><summary>Recalls <span>not found</span></summary><p class="dimp">' + esc(rc.why) + '</p></details>';
  const items = rc.recalls.map((r) => '<li><b>' + esc(r.system || 'Recall') + '</b> <span class="tag">' + esc(r.kind || '') + '</span> ' +
    esc(r.summary.replace(/^Issue:\s*/i, '').split(/\s(?:Safety Risk|Corrective Actions?):/i)[0].slice(0, 260)) +
    ' <span class="dimp">(' + esc(r.number) + ', ' + esc(r.date) + ')</span></li>').join('');
  return '<details class="know"><summary>Recalls, ' + esc(rc.year) + ' ' + esc(rc.model_name.toLowerCase()) + ' <span>' + rc.count + '</span></summary>' +
    (rc.count ? '<ul>' + items + '</ul>' : '<p>None listed for the ' + esc(rc.year) + ' model year.</p>') +
    '<p class="dimp">' + esc(rc.covers) + '. ' + link(rc.site, 'Transport Canada recalls database') + '</p></details>';
}

// the factory figures of a car the lot has no listing for (the S7: research/reviews/audi_s7_specs.json), READ or ABSENT (UC-14.1)
export function knownSpecsHTML(key, REVIEWS) {
  const sp = REVIEWS && REVIEWS.cars[key] && REVIEWS.cars[key].specs;
  if (!sp || !sp.length) return '';
  return '<p class="kick" style="margin-top:12px">Factory figures</p><dl>' + sp.map((r) => '<dt>' + esc(r.label) + '</dt><dd>' + esc(r.value) +
    '<button class="src k-' + r.kind + '" title="' + esc(r.src) + '">' + r.kind + '</button></dd>').join('') + '</dl>';
}

export function knowHTML(key, REVIEWS, RECALLS) {
  const rv = REVIEWS && REVIEWS.cars[key], rc = RECALLS && RECALLS.cars[key];
  if (!rv && !rc) return '';
  let h = '<p class="kick" style="margin-top:12px">Know this car</p>';
  if (rv) {
    const ratings = rv.ratings.length ? '<div class="ratings">' + rv.ratings.map((r) => '<a class="rate" href="' + esc(r.url) + '" target="_blank" rel="noopener"><b>' +
      esc(r.value) + '</b><span>' + esc(r.by) + '</span></a>').join('') + '</div>' : '<p class="dimp">No published rating found for this year: ' + esc(rv.ratings_absent || 'see the searches in the record') + '</p>';
    h += '<details class="know" open><summary>Review <span>AI summary</span></summary>' + ratings +
      '<p>' + esc(rv.summary) + '</p>' + (rv.quote ? '<blockquote>"' + esc(rv.quote.text) + '" ' + link(rv.quote.url) + '</blockquote>' : '') +
      '<p class="dimp">Written by an AI from the linked reviews and owner reports; not the dealer\'s words. ' + sources(rv.summary_sources.map((u) => ({ url: u }))) + '</p></details>';
    if (rv.issues.length) h += '<details class="know"><summary>What owners report <span>' + rv.issues.length + '</span></summary><ul>' +
      rv.issues.map((i) => '<li>' + esc(i.issue) + ' <span class="dimp">(' + esc(i.years) + '; ' + i.sources.length + (i.sources.length > 1 ? ' sources' : ' source') + ': ' + sources(i.sources) + ')</span></li>').join('') + '</ul></details>';
  }
  h += recallsHTML(rc);
  if (rv && rv.mods && rv.mods.length) h += '<details class="know"><summary>Common mods <span>' + rv.mods.length + '</span></summary><ul>' +
    rv.mods.map((m) => '<li><b>' + esc(m.mod.replace(/[.:]\s*$/, '')) + '</b>: ' + esc(m.why) + (m.caveat ? ' <i>' + esc(m.caveat) + '</i>' : '') + ' <span class="dimp">' + sources(m.sources) + '</span></li>').join('') +
    '</ul><p class="dimp">What owners do, from their forums and tuners; a mod can affect the warranty, emissions and insurance.</p></details>';
  if (rv && rv.clubs.length) h += '<details class="know"><summary>Clubs and forums <span>' + rv.clubs.length + '</span></summary><ul>' +
    rv.clubs.map((c) => '<li>' + link(c.url, c.name) + ' <span class="dimp">' + esc(c.kind) + (c.where ? ', ' + esc(c.where) : '') + '</span></li>').join('') + '</ul></details>';
  return h;
}
