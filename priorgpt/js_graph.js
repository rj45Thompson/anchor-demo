// js_graph.js - JavaScript read into the node graph language (view/NGL.md), and printed back from it.
//
// A game whose rules are code becomes graphs here, one per function, method, getter, constructor and module declaration, and
// the same graphs print back as JavaScript. That is what lets the view play such a game on its graphs (REQ-BPV-28): the program
// that runs is the one printed from them. The graphs are trusted only while they round-trip (REQ-BPV-29): printed back, they
// must parse to the source's own syntax tree, compared node by node with positions left out. A construct the reader does not
// read stops it, naming the construct and its line (UC-BV5.3 alternate 1): nothing is written around it and nothing plays.
//
// One graph per callable, a node per statement. An expression is kept as the author wrote it, as a term, so the round trip
// is exact and the statement is what lights up when it runs. Comments ride along as `doc=` on a graph and `note=` on a node.
//
//   JsReader     source -> NGL text, refusing what it does not read
//   JsPrinter    NGL graphs (pl.js parse) -> JavaScript, optionally with a probe call before every statement (REQ-BPV-31)
//   sameTree     two syntax trees compared, positions left out: the first path where they part, or null
//   roundTrip    read, print back, parse both, compare: the gate
//
// Runs in node (require('./js_graph.js')) and in a page (window.JSGRAPH). Reading needs a parser handed in (acorn, vendored in
// ../vendor/acorn); printing needs none, so a page can print and run the graphs it was given.
(function (root) {
  'use strict';

  /** a value as NGL writes it: a plain term when it is one safe token, otherwise ~"json" */
  function val(s) {
    return /^[A-Za-z0-9_$.]+$/.test(s) && s !== '-' ? s : '~' + JSON.stringify(s);
  }
  const list = (xs) => '[' + xs.map((x) => (x === null ? '-' : val(x))).join(' ') + ']';
  const ids = (xs) => '[' + xs.join(' ') + ']';

  class JsReadError extends Error {}

  /** source -> NGL text. `parse` is acorn.parse (or one with its options and output). */
  class JsReader {
    constructor(source, file, parse) {
      this.src = source;
      this.file = file;
      this.comments = [];
      this.ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true, onComment: this.comments });
      this.out = [];
      this.names = new Set();
    }

    fail(n, what) {
      throw new JsReadError(this.file + ':' + n.loc.start.line + ':' + (n.loc.start.column + 1) + ': the JavaScript reader does not read '
        + what + ' yet, so it wrote nothing');
    }
    text(n) { return this.src.slice(n.start, n.end); }
    at(n) { return n.loc.start.line + ':' + (n.loc.start.column + 1); }

    /** the comments between `from` (an offset) and node n, and any that end n's last line, as one line of text */
    note(n, from, to) {
      const parts = this.comments.filter((c) => (c.start >= from && c.end <= n.start) || (c.start >= n.end && c.end <= to && c.loc.start.line === n.loc.end.line))
        .map((c) => c.value.replace(/^\s*\*?/gm, '').trim()).filter(Boolean);
      return parts.length ? parts.join(' ').replace(/\s+/g, ' ') : null;
    }

    unique(name, n) {
      let u = name;
      if (this.names.has(u)) u = name + '@' + n.loc.start.line;
      this.names.add(u);
      return u;
    }

    read() {
      const body = this.ast.body;
      this.out.push('# ' + this.file + ' - read by view/js_graph.js into the node graph language (view/NGL.md). Generated: never edit by hand.');
      let from = 0;
      for (let i = 0; i < body.length; i++) {
        const n = body[i];
        const to = i + 1 < body.length ? body[i + 1].start : this.src.length;
        this.top(n, this.note(n, from, to));
        from = n.end;
      }
      return this.out.join('\n') + '\n';
    }

    top(n, doc) {
      let mods = [];
      let d = n;
      if (n.type === 'ExportNamedDeclaration') {
        if (!n.declaration) return this.verbatim(n, 'export', doc);
        mods = ['export'];
        d = n.declaration;
      } else if (n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration') {
        return this.verbatim(n, n.type === 'ImportDeclaration' ? 'import' : 'export', doc);
      } else if (n.type === 'ExportDefaultDeclaration') {
        this.fail(n, 'a default export');
      }
      if (d.type === 'VariableDeclaration') return this.declaration(d, mods, doc);
      if (d.type === 'FunctionDeclaration') return this.callable(this.unique(d.id.name, d), 'function', d, d, mods, doc);
      if (d.type === 'ClassDeclaration') return this.klass(d, mods, doc);
      if (d.type === 'ExpressionStatement') {
        const g = this.begin(this.unique('statement', d) , 'statement', d, mods, doc);
        g.body = [this.stmt(g, d, 1, null)];
        return this.end(g);
      }
      this.fail(d, 'a ' + d.type + ' at the top of a module');
    }

    /** an import or export with no declaration, kept as the author wrote it */
    verbatim(n, kind, doc) {
      const g = this.begin(this.unique(kind, n), kind, n, [], doc);
      g.extra.push('text=' + val(this.text(n)));
      return this.end(g);
    }

    declaration(d, mods, doc) {
      const first = d.declarations[0].id;
      const g = this.begin(this.unique(first.type === 'Identifier' ? first.name : 'declaration', d), 'declaration', d, mods, doc);
      g.body = [this.stmt(g, d, 1, null)];
      return this.end(g);
    }

    klass(d, mods, doc) {
      const name = this.unique(d.id.name, d);
      const g = this.begin(name, 'class', d, mods, doc);
      if (d.superClass) g.extra.push('extends=' + val(this.text(d.superClass)));
      const members = [];
      const parts = [];
      const els = d.body.body;
      let from = d.body.start + 1;
      for (let i = 0; i < els.length; i++) {
        const m = els[i];
        const to = i + 1 < els.length ? els[i + 1].start : d.body.end;
        const mdoc = this.note(m, from, to);
        from = m.end;
        if (m.type !== 'MethodDefinition') this.fail(m, 'a class ' + (m.type === 'PropertyDefinition' ? 'field' : m.type));
        const mm = [];
        if (m.static) mm.push('static');
        let key;
        if (m.computed) key = null;
        else if (m.key.type === 'Identifier') key = m.key.name;
        else this.fail(m, 'a method named by a ' + m.key.type);
        const kind = m.kind === 'constructor' ? 'constructor' : m.kind === 'get' ? 'get' : m.kind === 'set' ? 'set' : 'method';
        const gname = this.unique(name + '.' + (key === null ? 'computed' : key), m);
        parts.push({ gname, m, mm, mdoc, kind });
        members.push(gname);
      }
      g.extra.push('members=' + list(members));
      this.end(g);
      for (const p of parts) {
        const extra = p.m.computed ? ['computed=' + val(this.text(p.m.key))] : [];
        this.callable(p.gname, p.kind, p.m, p.m.value, p.mm, p.mdoc, extra);
      }
    }

    callable(name, kind, n, fn, mods, doc, extra) {
      if (fn.async) this.fail(fn, 'an async function');
      const g = this.begin(name, kind, n, mods.concat(fn.generator ? ['generator'] : []), doc);
      if (extra) g.extra.push(...extra);
      g.extra.push('params=' + list(fn.params.map((p) => this.text(p))));
      if (fn.body.type !== 'BlockStatement') this.fail(fn, 'a function whose body is an expression');
      g.body = this.block(g, fn.body.body, fn.body.start + 1, fn.body.end, 1, null);
      return this.end(g);
    }

    begin(name, kind, n, mods, doc) {
      return { name, kind, n, mods, doc, extra: [], body: [], lines: [], s: 0, k: 0 };
    }
    end(g) {
      const head = ['graph ' + val(g.name), 'kind=' + g.kind, 'at=' + this.at(g.n)];
      if (g.mods.length) head.push('mods=' + list(g.mods));
      head.push(...g.extra);
      if (g.doc) head.push('doc=' + val(g.doc));
      if (g.kind !== 'class' && g.kind !== 'import' && g.kind !== 'export') head.push('body=' + ids(g.body));
      this.out.push(head.join(' '));
      this.out.push(...g.lines);
      this.out.push('end');
      return g;
    }

    /** a list of statements -> their ids, each with its note */
    block(g, stmts, from, to, depth, brk) {
      const out = [];
      for (let i = 0; i < stmts.length; i++) {
        const n = stmts[i];
        const next = i + 1 < stmts.length ? stmts[i + 1].start : to;
        out.push(this.stmt(g, n, depth, brk, this.note(n, from, next)));
        from = n.end;
      }
      return out;
    }

    /** a body that may be one statement with no braces: [ids, bare] */
    body(g, n, depth, brk) {
      if (n.type === 'BlockStatement') return [this.block(g, n.body, n.start + 1, n.end, depth, brk), false];
      return [[this.stmt(g, n, depth, brk, null)], true];
    }

    stmt(g, n, depth, brk, note) {
      const pad = '  '.repeat(depth);
      const t = (x) => this.text(x);
      const container = n.type === 'BlockStatement' || n.type === 'EmptyStatement';
      const id = container ? 'k' + (++g.k) : 's' + (++g.s);
      const line = { pad, id, kw: '', attrs: [] };
      g.lines.push(line);            // a node is written before the nodes under it: the file reads in source order
      const A = line.attrs;
      const bare = [];
      switch (n.type) {
        case 'VariableDeclaration':
          line.kw = 'set-local';
          A.push('decl=' + n.kind, 'vars=' + list(n.declarations.map((d) => t(d.id))), 'values=' + list(n.declarations.map((d) => (d.init ? t(d.init) : null))));
          break;
        case 'ExpressionStatement': {
          const e = n.expression;
          if (n.directive) { line.kw = 'evaluate'; A.push('value=' + val(t(e))); break; }
          // the attribute names are the C# reader's, so the view's Blueprint layout (pl.js bpNode) titles and pins these nodes as it does those
          if (e.type === 'AssignmentExpression' && e.operator === '=') { line.kw = 'set'; A.push('op==', 'target=' + val(t(e.left)), 'value=' + val(t(e.right))); }
          else if (e.type === 'AssignmentExpression') { line.kw = 'set-with-math'; A.push('op=' + val(e.operator), 'target=' + val(t(e.left)), 'value=' + val(t(e.right))); }
          else if (e.type === 'UpdateExpression') { line.kw = 'increment'; A.push('op=' + val(e.operator), 'a=' + val(t(e.argument)), 'prefix=' + e.prefix); }
          else if (e.type === 'CallExpression' && !e.optional && e.callee.type === 'MemberExpression' && !e.callee.computed && !e.callee.optional
            && e.callee.property.type === 'Identifier' && e.callee.object.type !== 'Super') {
            line.kw = 'call'; A.push('on=' + val(t(e.callee.object)), 'method=' + val(e.callee.property.name), 'args=' + list(e.arguments.map(t)));
          } else if (e.type === 'CallExpression' && !e.optional && e.callee.type === 'Identifier') {
            line.kw = 'call'; A.push('method=' + val(e.callee.name), 'args=' + list(e.arguments.map(t)));
          } else if (e.type === 'CallExpression' && e.callee.type === 'Super') {
            line.kw = 'call'; A.push('method=super', 'args=' + list(e.arguments.map(t)));
          } else if (e.type === 'YieldExpression') {
            line.kw = 'yield'; if (e.argument) A.push('value=' + val(t(e.argument))); if (e.delegate) A.push('delegate=true');
          } else { line.kw = 'evaluate'; A.push('value=' + val(t(e))); }
          break;
        }
        case 'IfStatement': {
          line.kw = 'branch';
          A.push('cond=' + val(t(n.test)));
          const [th, b1] = this.body(g, n.consequent, depth + 1, brk);
          A.push('then=' + ids(th));
          if (b1) bare.push('then');
          if (n.alternate) {
            const [el, b2] = this.body(g, n.alternate, depth + 1, brk);
            A.push('else=' + ids(el));
            if (b2) bare.push('else');
          }
          break;
        }
        case 'ForStatement': {
          line.kw = 'for-loop';
          A.push('init=' + (n.init ? val(t(n.init)) : '-'), 'cond=' + (n.test ? val(t(n.test)) : '-'), 'step=' + (n.update ? val(t(n.update)) : '-'));
          const [b, isBare] = this.body(g, n.body, depth + 1, 'loop');
          A.push('body=' + ids(b));
          if (isBare) bare.push('body');
          break;
        }
        case 'ForOfStatement':
        case 'ForInStatement': {
          if (n.await) this.fail(n, 'a for await loop');
          line.kw = n.type === 'ForOfStatement' ? 'for-each-loop' : 'for-in-loop';
          if (n.left.type === 'VariableDeclaration') {
            if (n.left.declarations.length !== 1) this.fail(n, 'a for-of loop declaring more than one name');
            A.push('decl=' + n.left.kind, 'var=' + val(t(n.left.declarations[0].id)));
          } else A.push('decl=-', 'var=' + val(t(n.left)));
          A.push('in=' + val(t(n.right)));
          const [b, isBare] = this.body(g, n.body, depth + 1, 'loop');
          A.push('body=' + ids(b));
          if (isBare) bare.push('body');
          break;
        }
        case 'WhileStatement':
        case 'DoWhileStatement': {
          line.kw = n.type === 'WhileStatement' ? 'while-loop' : 'do-while-loop';
          A.push('cond=' + val(t(n.test)));
          const [b, isBare] = this.body(g, n.body, depth + 1, 'loop');
          A.push('body=' + ids(b));
          if (isBare) bare.push('body');
          break;
        }
        case 'ReturnStatement': line.kw = 'return'; if (n.argument) A.push('value=' + val(t(n.argument))); break;
        case 'ThrowStatement': line.kw = 'throw'; A.push('value=' + val(t(n.argument))); break;
        case 'BreakStatement':
          if (n.label) this.fail(n, 'a labelled break');
          line.kw = brk === 'switch' ? 'section-break' : 'break';
          break;
        case 'ContinueStatement':
          if (n.label) this.fail(n, 'a labelled continue');
          line.kw = 'continue';
          break;
        case 'SwitchStatement': {
          line.kw = 'switch';
          A.push('on=' + val(t(n.discriminant)));
          const secs = [];
          for (const c of n.cases) {
            const k = 'k' + (++g.k);
            const sec = { pad: pad + '  ', id: k, kw: 'section', attrs: [] };
            sec.toString = () => sec.pad + sec.id + ' ' + sec.kw + ' ' + sec.attrs.join(' ');
            g.lines.push(sec);
            if (c.test) sec.attrs.push('case=' + val(t(c.test))); else sec.attrs.push('default=true');
            sec.attrs.push('body=' + ids(this.block(g, c.consequent, c.start, c.end, depth + 2, 'switch')));
            secs.push(k);
          }
          A.push('sections=' + ids(secs));
          break;
        }
        case 'BlockStatement':
          line.kw = 'block';
          A.push('body=' + ids(this.block(g, n.body, n.start + 1, n.end, depth + 1, brk)));
          break;
        case 'EmptyStatement': line.kw = 'empty'; break;
        default:
          this.fail(n, 'a ' + n.type);
      }
      if (bare.length) A.push('bare=' + list(bare));
      A.push('at=' + n.loc.start.line);
      if (note) A.push('note=' + val(note));
      line.toString = () => line.pad + line.id + ' ' + line.kw + (line.attrs.length ? ' ' + line.attrs.join(' ') : '');
      return id;
    }
  }

  // the lines were pushed as objects so a node's attributes could be finished after the nodes under it; write them as text
  const _end = JsReader.prototype.end;
  JsReader.prototype.end = function (g) { g.lines = g.lines.map(String); return _end.call(this, g); };

  /** source -> NGL text, or a JsReadError naming the first construct it does not read */
  function readModule(source, file, parse) { return new JsReader(source, file, parse).read(); }

  // ------------------------------------------------------------------------------------------------ printing
  function term(v) {
    if (!v) return null;
    if (v.none) return null;
    if ('term' in v) return v.term;
    if ('ref' in v) return '#' + v.ref;
    if ('str' in v) return v.str;
    throw new Error('js_graph: a value of a kind the printer does not print: ' + JSON.stringify(v));
  }
  function terms(v) {
    if (!v) return [];
    if (!v.list) throw new Error('js_graph: expected a list, got ' + JSON.stringify(v));
    return v.list.map(term);
  }
  // an expression statement that starts like a block, a function or a class must be wrapped, or it parses as one of those
  const wrap = (s) => (/^(\{|function\b|class\b|let\s*\[)/.test(s) ? '(' + s + ')' : s);

  /** NGL graphs -> JavaScript. opts.probe: a function name called before every statement with (graph index, node id). */
  class JsPrinter {
    constructor(graphs, opts) {
      this.graphs = graphs;
      this.probe = (opts && opts.probe) || null;
      this.index = new Map(graphs.map((g, i) => [g.name, i]));
      this.byName = new Map(graphs.map((g) => [g.name, g]));
      this.members = new Set();
      for (const g of graphs) if (term(g.attrs.kind) === 'class') for (const m of terms(g.attrs.members)) this.members.add(m);
    }

    print() {
      const out = [];
      if (this.probe) out.push('const ' + this.probe + ' = globalThis.' + this.probe + ';');
      for (const g of this.graphs) {
        if (this.members.has(g.name)) continue;
        out.push(this.top(g));
      }
      return out.join('\n') + '\n';
    }

    mods(g) { return terms(g.attrs.mods); }

    top(g) {
      const kind = term(g.attrs.kind);
      const mods = this.mods(g);
      const exp = mods.includes('export') ? 'export ' : '';
      if (kind === 'import' || kind === 'export') return term(g.attrs.text);
      if (kind === 'declaration') {
        // the probe is a statement of its own, so it goes before the export, which belongs to the declaration
        const lines = this.stmts(g, terms(g.attrs.body), 0);
        const i = this.probe ? lines.findIndex((l) => !l.startsWith(this.probe + '(')) : 0;
        lines[i] = exp + lines[i];
        return lines.join('\n');
      }
      if (kind === 'statement') return this.stmts(g, terms(g.attrs.body), 0).join('\n');
      if (kind === 'function') {
        return exp + 'function' + (mods.includes('generator') ? '*' : '') + ' ' + g.name.replace(/@\d+$/, '') + '(' + terms(g.attrs.params).join(', ') + ') {\n'
          + this.stmts(g, terms(g.attrs.body), 1).join('\n') + '\n}';
      }
      if (kind === 'class') {
        const ext = g.attrs.extends ? ' extends ' + term(g.attrs.extends) : '';
        const body = terms(g.attrs.members).map((m) => this.member(this.byName.get(m) || this.missing(m, g)));
        return exp + 'class ' + g.name.replace(/@\d+$/, '') + ext + ' {\n' + body.join('\n') + '\n}';
      }
      throw new Error('js_graph: graph ' + g.name + ' is of kind ' + kind + ', which the printer does not print at the top');
    }

    missing(m, g) { throw new Error('js_graph: class ' + g.name + ' names a member ' + m + ' that no graph holds'); }

    member(g) {
      const kind = term(g.attrs.kind);
      const mods = this.mods(g);
      const short = g.name.slice(g.name.lastIndexOf('.') + 1).replace(/@\d+$/, '');
      const key = g.attrs.computed ? '[' + term(g.attrs.computed) + ']' : short;
      const head = (mods.includes('static') ? 'static ' : '') + (kind === 'get' ? 'get ' : kind === 'set' ? 'set ' : '')
        + (mods.includes('generator') ? '*' : '') + (kind === 'constructor' ? 'constructor' : key);
      return '  ' + head + '(' + terms(g.attrs.params).join(', ') + ') {\n' + this.stmts(g, terms(g.attrs.body), 2).join('\n') + '\n  }';
    }

    stmts(g, idsList, depth) {
      const out = [];
      for (const id of idsList) out.push(...this.stmt(g, id, depth));
      return out;
    }

    /** a body: braces unless it was bare in the source and no probe goes in front of it */
    bodyOf(g, idsList, isBare, depth) {
      if (isBare && !this.probe) {
        if (idsList.length !== 1) throw new Error('js_graph: a bare body in ' + g.name + ' holds ' + idsList.length + ' statements');
        return { inline: this.stmt(g, idsList[0], depth).join('\n').trim() };
      }
      return { block: this.stmts(g, idsList, depth + 1) };
    }

    stmt(g, id, depth) {
      const n = g.nodes.get(id);
      if (!n) throw new Error('js_graph: graph ' + g.name + ' names a node ' + id + ' it does not hold');
      const A = n.attrs;
      const T = (k) => term(A[k]);
      const L = (k) => terms(A[k]);
      const pad = '  '.repeat(depth);
      const bare = A.bare ? terms(A.bare) : [];
      const out = [];
      if (this.probe && id[0] === 's') out.push(pad + this.probe + '(' + this.index.get(g.name) + ', ' + JSON.stringify(id) + ');');
      const join = (head, b, tail) => (b.inline !== undefined ? [pad + head + ' ' + b.inline + (tail || '')] : [pad + head + ' {', ...b.block, pad + '}' + (tail || '')]);
      switch (n.kw) {
        case 'set-local': {
          const vs = L('vars'), xs = L('values');
          out.push(pad + T('decl') + ' ' + vs.map((v, i) => (xs[i] === null || xs[i] === undefined ? v : v + ' = ' + xs[i])).join(', ') + ';');
          break;
        }
        case 'set': out.push(pad + wrap(T('target') + ' = ' + T('value')) + ';'); break;
        case 'set-with-math': out.push(pad + wrap(T('target') + ' ' + T('op') + ' ' + T('value')) + ';'); break;
        case 'increment': out.push(pad + (T('prefix') === 'true' ? T('op') + T('a') : T('a') + T('op')) + ';'); break;
        case 'call': {
          const args = '(' + L('args').join(', ') + ')';
          out.push(pad + (A.on ? wrap(T('on') + '.' + T('method') + args) : T('method') + args) + ';');
          break;
        }
        case 'evaluate': out.push(pad + wrap(T('value')) + ';'); break;
        case 'yield': out.push(pad + 'yield' + (T('delegate') === 'true' ? '*' : '') + (A.value ? ' ' + T('value') : '') + ';'); break;
        case 'return': out.push(pad + 'return' + (A.value ? ' ' + T('value') : '') + ';'); break;
        case 'throw': out.push(pad + 'throw ' + T('value') + ';'); break;
        case 'break': case 'section-break': out.push(pad + 'break;'); break;
        case 'continue': out.push(pad + 'continue;'); break;
        case 'branch': {
          const th = this.bodyOf(g, L('then'), bare.includes('then'), depth);
          if (!A.else) { out.push(...join('if (' + T('cond') + ')', th)); break; }
          const el = this.bodyOf(g, L('else'), bare.includes('else'), depth);
          const first = join('if (' + T('cond') + ')', th);
          const second = join('else', el);
          second[0] = second[0].trimStart();
          if (th.inline !== undefined) { out.push(first[0], pad + second[0], ...second.slice(1)); }
          else { first[first.length - 1] = first[first.length - 1] + ' ' + second[0]; out.push(...first, ...second.slice(1)); }
          break;
        }
        case 'for-loop': {
          const p = (k) => (A[k] && !A[k].none && T(k) !== null ? T(k) : '');
          out.push(...join('for (' + p('init') + '; ' + p('cond') + '; ' + p('step') + ')', this.bodyOf(g, L('body'), bare.includes('body'), depth)));
          break;
        }
        case 'for-each-loop': case 'for-in-loop': {
          const decl = T('decl');
          const head = 'for (' + (decl && decl !== '-' ? decl + ' ' : '') + T('var') + (n.kw === 'for-each-loop' ? ' of ' : ' in ') + T('in') + ')';
          out.push(...join(head, this.bodyOf(g, L('body'), bare.includes('body'), depth)));
          break;
        }
        case 'while-loop': out.push(...join('while (' + T('cond') + ')', this.bodyOf(g, L('body'), bare.includes('body'), depth))); break;
        case 'do-while-loop': out.push(...join('do', this.bodyOf(g, L('body'), bare.includes('body'), depth), ' while (' + T('cond') + ');')); break;
        case 'switch': {
          out.push(pad + 'switch (' + T('on') + ') {');
          for (const k of L('sections')) {
            const s = g.nodes.get(k);
            out.push(pad + '  ' + (s.attrs.case ? 'case ' + term(s.attrs.case) + ':' : 'default:'));
            out.push(...this.stmts(g, terms(s.attrs.body), depth + 2));
          }
          out.push(pad + '}');
          break;
        }
        case 'block': out.push(pad + '{', ...this.stmts(g, L('body'), depth + 1), pad + '}'); break;
        case 'empty': out.push(pad + ';'); break;
        default:
          throw new Error('js_graph: node ' + g.name + '#' + id + ' is a ' + n.kw + ', which the printer does not print');
      }
      return out;
    }
  }

  /** NGL graphs (from pl.js parse) -> JavaScript */
  function printModule(graphs, opts) { return new JsPrinter(graphs, opts).print(); }

  const SKIP = new Set(['start', 'end', 'loc', 'range']);
  /** the first path where two syntax trees part, positions left out, or null */
  function sameTree(a, b, path) {
    path = path || 'Program';
    if (a === b) return null;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return Object.is(a, b) ? null : { path, a, b };
    if (Array.isArray(a) !== Array.isArray(b)) return { path, a: 'array ' + Array.isArray(a), b: 'array ' + Array.isArray(b) };
    if (Array.isArray(a)) {
      if (a.length !== b.length) return { path: path + '.length', a: a.length, b: b.length };
      for (let i = 0; i < a.length; i++) { const d = sameTree(a[i], b[i], path + '[' + i + ']'); if (d) return d; }
      return null;
    }
    const ka = Object.keys(a).filter((k) => !SKIP.has(k)).sort(), kb = Object.keys(b).filter((k) => !SKIP.has(k)).sort();
    if (ka.join() !== kb.join()) return { path: path + ' keys', a: ka.join(), b: kb.join() };
    for (const k of ka) { const d = sameTree(a[k], b[k], path + '.' + k + (a.type ? '(' + a.type + ')' : '')); if (d) return d; }
    return null;
  }

  /** the gate: read, print back, parse both, compare. -> {ngl, printed, difference} */
  function roundTrip(source, file, parse, NGL) {
    const ngl = readModule(source, file, parse);
    const printed = printModule(NGL.parse(ngl, file));
    const opts = { ecmaVersion: 'latest', sourceType: 'module' };
    const difference = sameTree(parse(source, opts), parse(printed, opts));
    return { ngl, printed, difference };
  }

  const api = { JsReader, JsReadError, JsPrinter, readModule, printModule, sameTree, roundTrip, val };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.JSGRAPH = api;
})(typeof window !== 'undefined' ? window : globalThis);
