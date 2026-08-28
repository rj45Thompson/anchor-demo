/* graphview.js - a reusable three.js graph control.
 *
 * WHAT THIS IS FOR
 * A knowledge search produces a graph, and one 3D blob of it answers almost nothing. You cannot
 * see from a blob what the engine was SURE about, how far it wandered from the question, or which
 * routes actually completed. So this control renders the same graph through several ASPECTS, each
 * of which answers one question, plus a grid for reading the thing as data rather than as art.
 *
 *   structure  what is connected to what
 *   evidence   what it is sure about - shells by independent source count, certain at the core
 *   hops       how far it travelled - one plane per hop out from the question
 *   chains     which routes actually completed, as parallel paths
 *   grid       the same nodes as sortable rows, click one for its detail
 *
 * IT IS DELIBERATELY HOST-AGNOSTIC. It knows nothing about anchors, shards or this project. Feed
 * it {nodes, edges, chains}; it hands back selection events. Detail rendering is a callback, so
 * the host supplies whatever it actually knows about a node. That is what makes it reusable
 * rather than a piece of one page that happens to live in a file.
 *
 * DEPENDENCIES: three.js only, and only features present in r128 (no OrbitControls, no
 * post-processing, no external loaders). Orbit/zoom/pan are implemented here.
 *
 * USE
 *   const gv = new GraphView(hostEl, { THREE, renderDetail(node){ return html; } });
 *   gv.setData({ nodes:[{id,label,hop,k,role}], edges:[{a,b,rel,k}], chains:[[id,id,...]] });
 *   gv.on("select", n => ...);
 *   gv.setAspect("evidence");
 */
(function (root) {
  "use strict";

  /* ---- CONFIG ------------------------------------------------------------------------------
     Every tunable lives here rather than being sprinkled through the code as literals. */
  var CFG = {
    NODE_RADIUS:      0.42,
    NODE_SEGMENTS:    10,
    SHELL_GAP:        7.0,    // evidence aspect: distance between source-count shells
    HOP_GAP:          6.4,    // hops aspect: vertical distance between hop planes
    CHAIN_GAP:        3.1,    // chains aspect: vertical distance between chains
    CHAIN_STEP:       5.0,    // chains aspect: horizontal distance between hops on a chain
    LAYOUT_ITERS:     140,    // structure aspect: spring relaxation passes
    LAYOUT_SPREAD:    26,
    CAM_START:        [0, 6, 46],
    ZOOM_MIN:         8,
    ZOOM_MAX:         180,
    ROT_SPEED:        0.0052,
    ZOOM_SPEED:       0.0016,
    EASE:             0.12,   // position lerp when switching aspects
    GRID_PAGE:        250,    // rows rendered at once; the rest are one click away
    LABEL_MAX:        26      // how many labels can be on screen before it becomes soup
  };

  /* Deterministic pseudo-random. Math.random() would give a different layout every reload, which
     makes a graph impossible to talk about ("the node on the left" stops meaning anything) and
     makes any screenshot unreproducible. Seeded by node id, so a node lands in the same place
     every time for the same data. */
  function hash32(s) {
    var h = 0x811c9dc5, i;
    for (i = 0; i < s.length; i++) { h ^= s.charCodeAt(i) & 0xffff; h = (h * 0x01000193) >>> 0; }
    return h;
  }
  function rnd(seed) { var x = (seed * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; }

  var ASPECTS = [
    { id: "structure", label: "Structure", hint: "what is connected to what" },
    { id: "evidence",  label: "Evidence",  hint: "certain at the core, unsupported at the rim" },
    { id: "hops",      label: "Hops",      hint: "one plane per step away from the question" },
    { id: "chains",    label: "Chains",    hint: "routes that actually completed" },
    { id: "grid",      label: "Grid",      hint: "the same nodes as data" }
  ];

  /* Evidence colours. These are ORDINAL - the count of independent sources, 0..3+ - and never a
     continuous scale, because the underlying probability is a four-value lookup and drawing it as
     a gradient implies a precision that is not there. k=0 is deliberately the odd one out: it has
     no anchor at all, so it is grey rather than a dim version of the evidence colour. */
  var KCOL = { 0: 0x6b7a88, 1: 0xc9a227, 2: 0x4ea3d8, 3: 0x51c07a };
  function kOf(n) { return Math.max(0, Math.min(3, (n && n.k) | 0)); }
  function kColour(n) { return KCOL[kOf(n)]; }

  function el(tag, cls, html) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (html != null) d.innerHTML = html;
    return d;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /* ---- the control ------------------------------------------------------------------------- */
  function GraphView(host, opts) {
    if (!host) throw new Error("GraphView: no host element");
    opts = opts || {};
    var THREE = opts.THREE || root.THREE;
    if (!THREE) throw new Error("GraphView: three.js not available");

    this._T = THREE;
    this.host = host;
    this.opts = opts;
    this.data = { nodes: [], edges: [], chains: [] };
    this.byId = new Map();
    this.aspect = opts.aspect || "structure";
    this.selected = null;
    this._handlers = {};
    this._pos = new Map();     // id -> current rendered position
    this._target = new Map();  // id -> position the active aspect wants
    this._disposed = false;
    this._gridSort = { key: "k", dir: -1 };
    this._buildDom();
    this._buildScene();
    this._bind();
    this._loop();
  }

  GraphView.prototype.on = function (evt, fn) {
    (this._handlers[evt] || (this._handlers[evt] = [])).push(fn);
    return this;
  };
  GraphView.prototype._emit = function (evt, arg) {
    (this._handlers[evt] || []).forEach(function (f) { try { f(arg); } catch (e) {} });
  };

  /* ---- DOM --------------------------------------------------------------------------------- */
  GraphView.prototype._buildDom = function () {
    var self = this;
    this.host.classList.add("gv-host");

    this.tabs = el("div", "gv-tabs");
    ASPECTS.forEach(function (a) {
      var b = el("button", "gv-tab" + (a.id === self.aspect ? " on" : ""), esc(a.label));
      b.title = a.hint;
      b.dataset.aspect = a.id;
      b.addEventListener("click", function () { self.setAspect(a.id); });
      self.tabs.appendChild(b);
    });
    this.hint = el("span", "gv-hint", "");
    this.tabs.appendChild(this.hint);

    this.stage = el("div", "gv-stage");
    this.canvasWrap = el("div", "gv-canvas");
    this.gridWrap = el("div", "gv-grid");
    this.legend = el("div", "gv-legend");
    this.detail = el("div", "gv-detail", '<div class="gv-empty">Pick a node to see what is recorded about it.</div>');

    this.stage.appendChild(this.canvasWrap);
    this.stage.appendChild(this.gridWrap);
    this.canvasWrap.appendChild(this.legend);

    this.host.appendChild(this.tabs);
    this.host.appendChild(this.stage);
    this.host.appendChild(this.detail);
  };

  /* ---- scene ------------------------------------------------------------------------------- */
  GraphView.prototype._buildScene = function () {
    var T = this._T;
    this.scene = new T.Scene();
    this.camera = new T.PerspectiveCamera(52, 1, 0.1, 2000);
    this.camera.position.set(CFG.CAM_START[0], CFG.CAM_START[1], CFG.CAM_START[2]);

    this.renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.canvasWrap.appendChild(this.renderer.domElement);

    this.scene.add(new T.AmbientLight(0xffffff, 0.72));
    var key = new T.DirectionalLight(0xffffff, 0.55);
    key.position.set(4, 9, 7);
    this.scene.add(key);

    this.root3 = new T.Group();
    this.scene.add(this.root3);

    // orbit state - written here rather than pulled from OrbitControls, which r128's build does
    // not include and which would be an extra file to vendor for three behaviours.
    this.orbit = { yaw: 0.5, pitch: 0.28, dist: CFG.CAM_START[2], panX: 0, panY: 0 };

    this.ray = new T.Raycaster();
    this.mouse = new T.Vector2();
    this._resize();
  };

  GraphView.prototype._resize = function () {
    var w = this.canvasWrap.clientWidth || 1, h = this.canvasWrap.clientHeight || 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  };

  /* ---- data -------------------------------------------------------------------------------- */
  GraphView.prototype.setData = function (d) {
    var self = this;
    d = d || {};
    this.data = {
      nodes: (d.nodes || []).slice(),
      edges: (d.edges || []).slice(),
      chains: (d.chains || []).slice()
    };
    this.byId = new Map();
    this.data.nodes.forEach(function (n) { self.byId.set(n.id, n); });
    // drop edges whose endpoints are not in the node set, rather than letting them throw later
    this.data.edges = this.data.edges.filter(function (e) {
      return self.byId.has(e.a) && self.byId.has(e.b);
    });
    this._seedLayout();
    this._rebuild();
    this._applyAspect();
    return this;
  };

  /* A deterministic spring layout. Nodes start on a seeded sphere and relax: neighbours pull,
     everything pushes. Fixed iteration count so it always converges to the same picture. */
  GraphView.prototype._seedLayout = function () {
    var nodes = this.data.nodes, edges = this.data.edges, i, j, n;
    var P = this._base = new Map();
    nodes.forEach(function (nd) {
      var s = hash32(String(nd.id));
      var u = rnd(s) * 2 - 1, th = rnd(s + 7) * Math.PI * 2, r = CFG.LAYOUT_SPREAD * Math.cbrt(rnd(s + 13));
      var sq = Math.sqrt(Math.max(0, 1 - u * u));
      P.set(nd.id, { x: r * sq * Math.cos(th), y: r * u, z: r * sq * Math.sin(th) });
    });
    for (i = 0; i < CFG.LAYOUT_ITERS; i++) {
      var k = 1 - i / CFG.LAYOUT_ITERS;                       // cooling
      for (j = 0; j < edges.length; j++) {
        var a = P.get(edges[j].a), b = P.get(edges[j].b);
        var dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
        var dist = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
        var f = (dist - 6.5) * 0.02 * k;
        dx /= dist; dy /= dist; dz /= dist;
        a.x += dx * f; a.y += dy * f; a.z += dz * f;
        b.x -= dx * f; b.y -= dy * f; b.z -= dz * f;
      }
      // repulsion, sampled rather than all-pairs so this stays linear enough for big graphs
      for (j = 0; j < nodes.length; j++) {
        var pa = P.get(nodes[j].id);
        var other = nodes[(j * 7 + i * 13 + 1) % nodes.length];
        if (other.id === nodes[j].id) continue;
        var pb = P.get(other.id);
        var ex = pa.x - pb.x, ey = pa.y - pb.y, ez = pa.z - pb.z;
        var d2 = ex * ex + ey * ey + ez * ez + 0.01;
        var rf = Math.min(2.2, 26 / d2) * k;
        var dl = Math.sqrt(d2);
        pa.x += (ex / dl) * rf; pa.y += (ey / dl) * rf; pa.z += (ez / dl) * rf;
      }
    }
    nodes.forEach(function (nd) {
      if (!this._pos.has(nd.id)) this._pos.set(nd.id, Object.assign({}, P.get(nd.id)));
    }, this);
  };

  /* ---- meshes ------------------------------------------------------------------------------ */
  GraphView.prototype._rebuild = function () {
    var T = this._T, self = this;
    while (this.root3.children.length) {
      var c = this.root3.children.pop();
      if (c.geometry) c.geometry.dispose();
      if (c.material) (Array.isArray(c.material) ? c.material : [c.material]).forEach(function (m) { m.dispose(); });
    }
    var n = this.data.nodes.length;
    if (!n) { this.inst = null; this.lines = null; return; }

    var geo = new T.SphereGeometry(CFG.NODE_RADIUS, CFG.NODE_SEGMENTS, CFG.NODE_SEGMENTS);
    var mat = new T.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1 });
    this.inst = new T.InstancedMesh(geo, mat, n);
    this.inst.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.root3.add(this.inst);

    this._dummy = new T.Object3D();
    this.data.nodes.forEach(function (nd, i) {
      self.inst.setColorAt(i, new T.Color(kColour(nd)));
    });
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;

    var lg = new T.BufferGeometry();
    lg.setAttribute("position", new T.BufferAttribute(new Float32Array(this.data.edges.length * 6), 3));
    lg.setAttribute("color", new T.BufferAttribute(new Float32Array(this.data.edges.length * 6), 3));
    this.lines = new T.LineSegments(lg, new T.LineBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.34
    }));
    this.root3.add(this.lines);
  };

  /* ---- aspects ----------------------------------------------------------------------------- */
  GraphView.prototype.setAspect = function (id) {
    if (!ASPECTS.some(function (a) { return a.id === id; })) return this;
    this.aspect = id;
    Array.prototype.forEach.call(this.tabs.querySelectorAll(".gv-tab"), function (b) {
      b.classList.toggle("on", b.dataset.aspect === id);
    });
    var a = ASPECTS.filter(function (x) { return x.id === id; })[0];
    this.hint.textContent = a ? a.hint : "";
    var grid = id === "grid";
    this.gridWrap.style.display = grid ? "block" : "none";
    this.canvasWrap.style.display = grid ? "none" : "block";
    if (grid) this._renderGrid(); else { this._applyAspect(); this._resize(); }
    this._emit("aspect", id);
    return this;
  };

  GraphView.prototype._applyAspect = function () {
    var self = this, T = this._T;
    this._target = new Map();
    var a = this.aspect;

    if (a === "structure") {
      this.data.nodes.forEach(function (n) { self._target.set(n.id, self._base.get(n.id)); });
      this._setLegend([["structure", "position is the relaxed graph layout - neighbours pull together"]]);

    } else if (a === "evidence") {
      // Shells by source count. Certain at the core is the whole point: you can SEE how much of
      // the answer rests on one source by how much of the cloud is out at the rim.
      var buckets = { 0: [], 1: [], 2: [], 3: [] };
      this.data.nodes.forEach(function (n) { buckets[kOf(n)].push(n); });
      [3, 2, 1, 0].forEach(function (k, ring) {
        var list = buckets[k], R = (ring + 1) * CFG.SHELL_GAP, m = list.length || 1;
        list.forEach(function (n, i) {
          var u = m === 1 ? 0 : (i / (m - 1)) * 2 - 1;
          var th = i * 2.399963;                       // golden angle - even cover, no clumping
          var sq = Math.sqrt(Math.max(0, 1 - u * u));
          self._target.set(n.id, { x: R * sq * Math.cos(th), y: R * u * 0.72, z: R * sq * Math.sin(th) });
        });
      });
      this._setLegend([
        ["3+ sources", KCOL[3]], ["2 sources", KCOL[2]], ["1 source", KCOL[1]], ["no anchor", KCOL[0]]
      ], "inner shell = best corroborated");

    } else if (a === "hops") {
      var byHop = new Map();
      this.data.nodes.forEach(function (n) {
        var h = (n.hop | 0); (byHop.get(h) || byHop.set(h, []).get(h)).push(n);
      });
      Array.from(byHop.keys()).sort(function (x, y) { return x - y; }).forEach(function (h) {
        var list = byHop.get(h), m = list.length, R = 4 + Math.sqrt(m) * 2.4;
        list.forEach(function (n, i) {
          var th = (i / m) * Math.PI * 2;
          self._target.set(n.id, {
            x: Math.cos(th) * R, y: 12 - h * CFG.HOP_GAP, z: Math.sin(th) * R
          });
        });
      });
      this._setLegend([["hops", "each plane is one step further from the question; depth is drift"]]);

    } else if (a === "chains") {
      var placed = new Set();
      this.data.chains.forEach(function (chain, ci) {
        chain.forEach(function (id, hi) {
          if (!self.byId.has(id)) return;
          self._target.set(id, {
            x: (hi - (chain.length - 1) / 2) * CFG.CHAIN_STEP,
            y: ((self.data.chains.length - 1) / 2 - ci) * CFG.CHAIN_GAP,
            z: 0
          });
          placed.add(id);
        });
      });
      // everything not on a completed chain is pushed back and out of the way, not hidden - a
      // node being off-chain is information, and deleting it would overstate the answer
      this.data.nodes.forEach(function (n) {
        if (placed.has(n.id)) return;
        var b = self._base.get(n.id);
        self._target.set(n.id, { x: b.x * 1.5, y: b.y * 1.5, z: -34 + b.z * 0.4 });
      });
      this._setLegend([["chains", this.data.chains.length
        ? "each row is one completed route, left to right by hop; faded nodes were never on one"
        : "no chain completed - every node here was explored and rejected"]]);
    }
  };

  GraphView.prototype._setLegend = function (items, note) {
    var html = items.map(function (it) {
      return typeof it[1] === "number"
        ? '<span class="gv-lg"><i style="background:#' + it[1].toString(16).padStart(6, "0") + '"></i>' + esc(it[0]) + "</span>"
        : '<span class="gv-lgnote">' + esc(it[1]) + "</span>";
    }).join("");
    this.legend.innerHTML = html + (note ? '<span class="gv-lgnote">' + esc(note) + "</span>" : "");
  };

  /* ---- grid -------------------------------------------------------------------------------- */
  GraphView.prototype._renderGrid = function () {
    var self = this, s = this._gridSort;
    var cols = [
      { k: "label", t: "node", num: false },
      { k: "k",     t: "sources", num: true },
      { k: "hop",   t: "hop", num: true },
      { k: "deg",   t: "edges", num: true },
      { k: "role",  t: "role", num: false }
    ];
    var deg = new Map();
    this.data.edges.forEach(function (e) {
      deg.set(e.a, (deg.get(e.a) || 0) + 1);
      deg.set(e.b, (deg.get(e.b) || 0) + 1);
    });
    var rows = this.data.nodes.map(function (n) {
      return { n: n, label: n.label || n.id, k: kOf(n), hop: n.hop | 0, deg: deg.get(n.id) || 0, role: n.role || "" };
    });
    rows.sort(function (x, y) {
      var a = x[s.key], b = y[s.key];
      if (typeof a === "string") return s.dir * String(a).localeCompare(String(b));
      return s.dir * (a - b);
    });
    var shown = rows.slice(0, CFG.GRID_PAGE);

    var html = '<table class="gv-tbl"><thead><tr>' + cols.map(function (c) {
      return '<th data-k="' + c.k + '" class="' + (s.key === c.k ? "sorted" : "") + '">' +
        esc(c.t) + (s.key === c.k ? (s.dir < 0 ? " ▾" : " ▴") : "") + "</th>";
    }).join("") + "</tr></thead><tbody>" + shown.map(function (r) {
      return '<tr data-id="' + esc(r.n.id) + '"' + (self.selected === r.n.id ? ' class="on"' : "") + ">" +
        "<td>" + esc(r.label) + "</td>" +
        '<td class="num"><span class="gv-k gv-k' + r.k + '">' + r.k + "</span></td>" +
        '<td class="num">' + r.hop + "</td>" +
        '<td class="num">' + r.deg + "</td>" +
        "<td>" + esc(r.role) + "</td></tr>";
    }).join("") + "</tbody></table>";

    if (rows.length > shown.length) {
      html += '<div class="gv-more">showing ' + shown.length + " of " + rows.length +
        " nodes - sort to bring others to the top</div>";
    }
    this.gridWrap.innerHTML = html;

    Array.prototype.forEach.call(this.gridWrap.querySelectorAll("th"), function (th) {
      th.addEventListener("click", function () {
        var k = th.dataset.k;
        if (self._gridSort.key === k) self._gridSort.dir *= -1;
        else self._gridSort = { key: k, dir: k === "label" || k === "role" ? 1 : -1 };
        self._renderGrid();
      });
    });
    Array.prototype.forEach.call(this.gridWrap.querySelectorAll("tbody tr"), function (tr) {
      tr.addEventListener("click", function () { self.select(tr.dataset.id); });
    });
  };

  /* ---- selection --------------------------------------------------------------------------- */
  GraphView.prototype.select = function (id) {
    var n = this.byId.get(id);
    this.selected = n ? id : null;
    if (this.aspect === "grid") {
      Array.prototype.forEach.call(this.gridWrap.querySelectorAll("tbody tr"), function (tr) {
        tr.classList.toggle("on", tr.dataset.id === id);
      });
    }
    this._renderDetail(n);
    this._emit("select", n || null);
    return this;
  };

  GraphView.prototype._renderDetail = function (n) {
    if (!n) {
      this.detail.innerHTML = '<div class="gv-empty">Pick a node to see what is recorded about it.</div>';
      return;
    }
    if (typeof this.opts.renderDetail === "function") {
      var html = null;
      try { html = this.opts.renderDetail(n); } catch (e) { html = null; }
      if (html != null) { this.detail.innerHTML = html; return; }
    }
    // Fallback only. A host that knows more should supply renderDetail; this exists so the
    // control is never blank when used standalone.
    var k = kOf(n);
    this.detail.innerHTML =
      '<div class="gv-dh"><b>' + esc(n.label || n.id) + "</b>" +
      '<span class="gv-k gv-k' + k + '">' + k + " source" + (k === 1 ? "" : "s") + "</span></div>" +
      '<div class="gv-dgrid">' +
        "<div><b>" + (n.hop | 0) + "</b><span>hops from the question</span></div>" +
        "<div><b>" + esc(n.role || "-") + "</b><span>role in this search</span></div>" +
      "</div>";
  };

  /* ---- interaction ------------------------------------------------------------------------- */
  GraphView.prototype._bind = function () {
    var self = this, el0 = this.renderer.domElement, drag = null;

    el0.addEventListener("pointerdown", function (e) {
      drag = { x: e.clientX, y: e.clientY, pan: e.button === 2 || e.shiftKey, moved: 0 };
      el0.setPointerCapture(e.pointerId);
    });
    el0.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (drag.pan) {
        self.orbit.panX -= dx * 0.035;
        self.orbit.panY += dy * 0.035;
      } else {
        self.orbit.yaw -= dx * CFG.ROT_SPEED;
        self.orbit.pitch = Math.max(-1.45, Math.min(1.45, self.orbit.pitch - dy * CFG.ROT_SPEED));
      }
      drag.x = e.clientX; drag.y = e.clientY;
    });
    el0.addEventListener("pointerup", function (e) {
      // a click is a drag that went nowhere - otherwise every orbit ends by selecting something
      if (drag && drag.moved < 5) self._pick(e);
      drag = null;
    });
    el0.addEventListener("pointercancel", function () { drag = null; });
    el0.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    el0.addEventListener("wheel", function (e) {
      e.preventDefault();
      self.orbit.dist = Math.max(CFG.ZOOM_MIN,
        Math.min(CFG.ZOOM_MAX, self.orbit.dist * (1 + e.deltaY * CFG.ZOOM_SPEED)));
    }, { passive: false });

    this._ro = new ResizeObserver(function () { self._resize(); });
    this._ro.observe(this.canvasWrap);
  };

  GraphView.prototype._pick = function (e) {
    if (!this.inst) return;
    var r = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(this.mouse, this.camera);
    var hit = this.ray.intersectObject(this.inst, false);
    if (hit.length && hit[0].instanceId != null) {
      var n = this.data.nodes[hit[0].instanceId];
      if (n) this.select(n.id);
    }
  };

  /* ---- loop -------------------------------------------------------------------------------- */
  GraphView.prototype._loop = function () {
    var self = this;
    function frame() {
      if (self._disposed) return;
      requestAnimationFrame(frame);
      if (!self.canvasWrap.clientWidth || self.aspect === "grid") return;
      self._step();
      self.renderer.render(self.scene, self.camera);
    }
    requestAnimationFrame(frame);
  };

  GraphView.prototype._step = function () {
    var T = this._T, self = this;
    if (!this.inst) return;

    // ease every node toward what the active aspect wants, so switching tabs is a MOVE rather
    // than a cut - you can follow a node from one reading of the graph into the next
    var i, moved = false;
    this.data.nodes.forEach(function (n, idx) {
      var p = self._pos.get(n.id), t = self._target.get(n.id) || p;
      if (!p || !t) return;
      p.x += (t.x - p.x) * CFG.EASE;
      p.y += (t.y - p.y) * CFG.EASE;
      p.z += (t.z - p.z) * CFG.EASE;
      var sel = self.selected === n.id;
      var s = sel ? 2.1 : (1 + kOf(n) * 0.16);
      self._dummy.position.set(p.x, p.y, p.z);
      self._dummy.scale.setScalar(s);
      self._dummy.updateMatrix();
      self.inst.setMatrixAt(idx, self._dummy.matrix);
      moved = true;
    });
    if (moved) this.inst.instanceMatrix.needsUpdate = true;

    var pos = this.lines.geometry.attributes.position.array;
    var col = this.lines.geometry.attributes.color.array;
    this.data.edges.forEach(function (e, j) {
      var a = self._pos.get(e.a), b = self._pos.get(e.b);
      if (!a || !b) return;
      var o = j * 6;
      pos[o] = a.x; pos[o + 1] = a.y; pos[o + 2] = a.z;
      pos[o + 3] = b.x; pos[o + 4] = b.y; pos[o + 5] = b.z;
      var c = new T.Color(KCOL[Math.max(0, Math.min(3, (e.k | 0)))]);
      var lit = self.selected && (e.a === self.selected || e.b === self.selected);
      var f = lit ? 1 : 0.42;
      col[o] = col[o + 3] = c.r * f;
      col[o + 1] = col[o + 4] = c.g * f;
      col[o + 2] = col[o + 5] = c.b * f;
    });
    this.lines.geometry.attributes.position.needsUpdate = true;
    this.lines.geometry.attributes.color.needsUpdate = true;

    var o = this.orbit;
    var cp = Math.cos(o.pitch), sp = Math.sin(o.pitch);
    this.camera.position.set(
      o.panX + Math.sin(o.yaw) * cp * o.dist,
      o.panY + sp * o.dist,
      Math.cos(o.yaw) * cp * o.dist
    );
    this.camera.lookAt(o.panX, o.panY, 0);
  };

  GraphView.prototype.dispose = function () {
    this._disposed = true;
    if (this._ro) this._ro.disconnect();
    if (this.renderer) this.renderer.dispose();
    this.host.innerHTML = "";
  };

  GraphView.ASPECTS = ASPECTS;
  GraphView.CFG = CFG;
  root.GraphView = GraphView;
})(typeof window !== "undefined" ? window : globalThis);
