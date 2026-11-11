// Reads core.js and writes two things into index.html: a class diagram (inline SVG) and the body of
// Game.step(), the main loop. Both are read out of the source, so the page cannot describe classes,
// methods or an order the code does not have. test/diagram.test.js fails when the page is out of date.
//
//   node tools/class_diagram.js           rewrite the two blocks in index.html
//   node tools/class_diagram.js --check   exit 1 if either block differs from what core.js gives now
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(dirname(fileURLToPath(import.meta.url)));
export const CORE = join(HERE, 'core.js');
export const PAGE = join(HERE, 'index.html');

// ---- reading the source ------------------------------------------------------------------------

// Every exported class: its name, what it extends, its fields (this.x = ... in the constructor), its
// getters, and its methods, each under the "// ---- name ----" section heading it sits below.
export function readClasses(source) {
  const lines = source.split(/\r?\n/);
  const classes = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^export class (\w+)(?: extends (\w+))? \{/);
    if (!head) continue;
    const cls = { name: head[1], parent: head[2] || null, line: i + 1, fields: [], getters: [], sections: [] };
    let section = { title: null, methods: [] };
    cls.sections.push(section);
    let inConstructor = false;
    for (i++; i < lines.length && lines[i] !== '}'; i++) {
      const line = lines[i];
      const heading = line.match(/^ {2}\/\/ -+ (.+?) -+$/);
      if (heading) {
        section = { title: heading[1], methods: [] };
        cls.sections.push(section);
        continue;
      }
      if (/^ {2}constructor\(/.test(line)) { inConstructor = true; continue; }
      if (inConstructor && line === '  }') { inConstructor = false; continue; }
      const field = inConstructor && line.match(/^ {4}this\.(\w+) = (.+?);/);
      if (field) { cls.fields.push({ name: field[1], type: typeOf(field[2]) }); continue; }
      const member = line.match(/^ {2}(?:(static|get) )?(\w+)\(([^)]*)\)? \{/) || line.match(/^ {2}(?:(static|get) )?(\w+)\((.*)$/);
      if (!member || inConstructor) continue;
      const [, kind, name, args] = member;
      if (kind === 'get') cls.getters.push(name);
      else section.methods.push(`${kind === 'static' ? 'static ' : ''}${name}(${argNames(args)})`);
    }
    cls.sections = cls.sections.filter(s => s.methods.length > 0);
    classes.push(cls);
  }
  return classes;
}

// The type a field is given, when the source names a class: new Field(...) is a Field, and a pool made
// with () => new Rock() is a Pool<Rock>. Plain values are left untyped.
function typeOf(expression) {
  const pool = expression.match(/^new Pool\([\w.]+, \(\) => new (\w+)\(\)\)/);
  if (pool) return `Pool<${pool[1]}>`;
  const made = expression.match(/^new (\w+)\(/);
  return made ? made[1] : null;
}

function argNames(args) {
  if (!args || !args.trim()) return '';
  if (args.trim().startsWith('{')) return '{…}';
  return args.split(',').map(a => a.split('=')[0].trim()).filter(Boolean).join(', ');
}

// The exported functions that are not methods: small pure rules.
export function readFunctions(source) {
  return [...source.matchAll(/^export function (\w+)\(([^)]*)\)/gm)].map(m => `${m[1]}(${argNames(m[2])})`);
}

// The lines of Game.step(), as written.
export function readStep(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex(l => /^ {2}step\(input = 0\) \{$/.test(l));
  if (start < 0) throw new Error('Game.step(input = 0) not found in core.js');
  const end = lines.indexOf('  }', start);
  return lines.slice(start, end + 1).map(l => l.slice(2)).join('\n');
}

// ---- drawing -----------------------------------------------------------------------------------

const WIDTH = 980;     // the diagram's width; a phone scrolls it sideways inside its own box
const CHAR = 7.4;      // width of one character of 12 px monospace, a little generous
const LINE = 17;       // line height
const PAD = 10;
const GAP = 18;

// A box: name, then fields and getters (a getter is a derived value, written /name), then the methods,
// grouped under their section headings. Text wraps at maxChars.
function boxFor(cls, maxChars) {
  const rows = [];
  const values = [...cls.fields.map(f => (f.type ? `${f.name}: ${f.type}` : f.name)), ...cls.getters.map(g => `/${g}`)];
  if (values.length) rows.push({ kind: 'part' }, ...wrapList(values, maxChars).map(text => ({ kind: 'member', text })));
  for (const section of cls.sections) {
    rows.push({ kind: 'part' });
    if (section.title) rows.push({ kind: 'section', text: section.title });
    rows.push(...wrapList(section.methods, maxChars).map(text => ({ kind: 'member', text })));
  }
  return sized({ name: cls.name, line: cls.line, rows });
}

function sized(box) {
  const longest = Math.max(box.name.length * 1.2, ...box.rows.filter(r => r.text).map(r => r.text.length));
  box.width = Math.ceil(longest * CHAR + PAD * 2);
  box.height = 30 + box.rows.reduce((h, r) => h + (r.kind === 'part' ? 7 : LINE), 0) + 6;
  return box;
}

// Items joined with commas, in lines of at most max characters. An item longer than a line breaks
// after one of its own commas and carries on, indented.
function wrapList(items, max) {
  const pieces = [];
  for (const item of items) {
    if (item.length <= max) { pieces.push(item); continue; }
    let rest = item;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(', ', max - 1);
      if (cut <= 0) break;
      pieces.push({ text: rest.slice(0, cut + 1), joined: true });
      rest = `  ${rest.slice(cut + 2)}`;
    }
    pieces.push(rest);
  }
  const lines = [];
  let line = '';
  for (const piece of pieces) {
    if (typeof piece === 'object') { if (line) lines.push(`${line},`); lines.push(piece.text); line = ''; continue; }
    if (line && piece.startsWith('  ')) { lines.push(line); line = piece; continue; }
    const next = line ? `${line}, ${piece}` : piece;
    if (next.length > max && line) { lines.push(`${line},`); line = piece; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Where a class's box takes the reader: its own line of core.js, as published (the line is read from the source)
export const SOURCE_URL = 'https://github.com/rj45Thompson/anchor-demo/blob/main/shatterbelt/core.js';

function drawBox(box, extraClass = '') {
  if (box.line) {
    const open = `<a href="${SOURCE_URL}#L${box.line}" target="_blank" rel="noopener"><title>${esc(box.name)}: core.js line ${box.line}</title>`;
    return open + drawInside(box, extraClass) + '</a>';
  }
  return drawInside(box, extraClass);
}

function drawInside(box, extraClass) {
  const { x, y, width } = box;
  const out = [`<g class="cls${extraClass}">`,
    `<rect x="${x}" y="${y}" width="${width}" height="${box.height}" rx="8"/>`,
    `<text class="name" x="${x + width / 2}" y="${y + 20}" text-anchor="middle">${esc(box.name)}</text>`];
  let cy = y + 30;
  for (const row of box.rows) {
    if (row.kind === 'part') {
      out.push(`<line x1="${x}" y1="${cy}" x2="${x + width}" y2="${cy}"/>`);
      cy += 7;
      continue;
    }
    cy += LINE;
    out.push(`<text class="${row.kind === 'section' ? 'sec' : 'mem'}" x="${x + PAD}" y="${cy - 4}" xml:space="preserve">${esc(row.text)}</text>`);
  }
  out.push('</g>');
  return out.join('');
}

// Boxes in rows no wider than the diagram, each row centred. Returns the y below the last row.
function flow(boxes, top) {
  const rows = [[]];
  let used = 0;
  for (const box of boxes) {
    if (rows.at(-1).length && used + GAP + box.width > WIDTH - 32) { rows.push([]); used = 0; }
    used += (rows.at(-1).length ? GAP : 0) + box.width;
    rows.at(-1).push(box);
  }
  let y = top;
  for (const row of rows) {
    const span = row.reduce((w, b) => w + b.width, 0) + GAP * (row.length - 1);
    let x = (WIDTH - span) / 2;
    for (const box of row) { box.x = Math.round(x); box.y = y; x += box.width + GAP; }
    y += Math.max(...row.map(b => b.height)) + GAP;
  }
  return y;
}

// Layout, top to bottom: Game (it owns the rest), the base class, the classes that extend it, then the
// helper classes and the free functions. Arrows run from a class to the one it extends.
export function drawDiagram(classes, functions) {
  const narrow = 27;
  const game = boxFor(classes.find(c => c.name === 'Game'), Math.floor((WIDTH - 32 - PAD * 2) / CHAR));
  const base = classes.find(c => classes.some(d => d.parent === c.name));
  const baseBox = boxFor(base, narrow);
  const children = classes.filter(c => c.parent === base.name).map(c => boxFor(c, narrow));
  const helpers = classes.filter(c => c !== base && !c.parent && c.name !== 'Game').map(c => boxFor(c, narrow));
  const fnBox = sized({ name: 'functions in core.js', rows: [{ kind: 'part' }, ...functions.map(text => ({ kind: 'member', text }))] });

  let y = flow([game], 16) + GAP;
  y = flow([baseBox], y) + GAP * 1.5;
  const childrenTop = y;
  y = flow(children, y) + GAP;
  y = flow([...helpers, fnBox], y);

  const parts = [];
  const busY = childrenTop - GAP * 1.2;
  const apex = { x: baseBox.x + baseBox.width / 2, y: baseBox.y + baseBox.height };
  const centres = children.map(c => c.x + c.width / 2);
  parts.push(`<path class="inh" d="M${apex.x} ${apex.y + 12} V${busY} M${Math.min(...centres)} ${busY} H${Math.max(...centres)}"/>`);
  for (const c of children) parts.push(`<path class="inh" d="M${c.x + c.width / 2} ${c.y} V${busY}"/>`);
  parts.push(`<path class="head" d="M${apex.x} ${apex.y} l-8 12 h16 z"/>`);
  for (const box of [game, baseBox, ...children, ...helpers]) parts.push(drawBox(box));
  parts.push(drawBox(fnBox, ' fn'));

  const height = Math.ceil(y);
  return [`<svg class="uml" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${height}" width="${WIDTH}" height="${height}" `,
    `role="img" aria-label="Class diagram of core.js: ${classes.map(c => c.name).join(', ')}">`, ...parts, '</svg>'].join('');
}

// ---- the page ----------------------------------------------------------------------------------

export function blocks(source) {
  const classes = readClasses(source);
  const step = readStep(source);
  return {
    diagram: drawDiagram(classes, readFunctions(source)),
    step: `<pre class="code"><code>${esc(step)}</code></pre>`,
  };
}

// Line endings follow the page's own: a Windows checkout may have turned it to CRLF.
export function stamp(page, name, content) {
  if (page.includes('\r\n')) content = content.replace(/\r?\n/g, '\r\n');
  const open = `<!--gen:${name}-->`;
  const close = `<!--/gen:${name}-->`;
  const at = page.indexOf(open);
  const end = page.indexOf(close);
  if (at < 0 || end < at) throw new Error(`index.html has no ${open} ... ${close} block`);
  return page.slice(0, at + open.length) + content + page.slice(end);
}

export function between(page, name) {
  const open = `<!--gen:${name}-->`;
  const at = page.indexOf(open);
  const end = page.indexOf(`<!--/gen:${name}-->`);
  if (at < 0 || end < at) throw new Error(`index.html has no ${open} block`);
  return page.slice(at + open.length, end).replace(/\r\n/g, '\n');
}

function main() {
  const source = readFileSync(CORE, 'utf8');
  const page = readFileSync(PAGE, 'utf8');
  const made = blocks(source);
  if (process.argv.includes('--check')) {
    const stale = Object.keys(made).filter(name => between(page, name) !== made[name]);
    console.log(stale.length ? `out of date: ${stale.join(', ')} (run node tools/class_diagram.js)` : 'class diagram and main loop match core.js');
    process.exit(stale.length ? 1 : 0);
  }
  let next = page;
  for (const [name, content] of Object.entries(made)) next = stamp(next, name, content);
  writeFileSync(PAGE, next);
  const classes = readClasses(source);
  console.log(`${classes.length} classes, ${classes.reduce((n, c) => n + c.sections.reduce((m, s) => m + s.methods.length, 0), 0)} methods, ` +
    `step() ${readStep(source).split('\n').length} lines: written into index.html`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
