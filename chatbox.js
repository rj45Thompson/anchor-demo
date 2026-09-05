/* chatbox.js - a reusable help-chat control that degrades honestly.
 *
 * WHAT IT TALKS TO
 * agentbox/server.py, running on the site owner's own machine. That server holds a Claude Code
 * CLI agent with every tool denied: no shell, no files, no connectors, no network. Text in, text
 * out. See the header of server.py for why that is the layer that matters.
 *
 * THE HONEST-DEGRADATION RULE
 * A public page cannot assume the owner's desktop is switched on, and a chat box that spins
 * forever is worse than one that says it is closed. So this control probes /health first and
 * renders one of two states, never a fake one:
 *
 *   live     the agent answered the probe; questions go through
 *   offline  it did not; the box says so plainly and points at the resume and an email address
 *
 * It never invents an answer locally to paper over an unreachable backend. A canned reply dressed
 * as a live one is exactly the failure this whole site argues against.
 *
 * USE
 *   new ChatBox(hostEl, { endpoint: "http://127.0.0.1:8778" });
 */
(function (root) {
  "use strict";

  /* Where the agent lives depends on where the PAGE came from, and the difference is not
     cosmetic - one of the two addresses cannot work from the other context.

       page on loopback  ->  talk to loopback. The agent is on this very machine, so the tunnel
                             is a pointless round trip, and more importantly the browser applies
                             no local-network restriction to a loopback page.
       page anywhere else ->  the tunnel is the only route that exists for a visitor.

     This is what makes the site testable by its owner. From RJ's own machine the published
     https page CANNOT reach the tunnel: on the tailnet that hostname resolves to its 100.x
     CGNAT address, and a browser refuses to let an https page reach a "local" address, so the
     box correctly reports itself offline for the one person who wants to check it. Opening the
     same page over http://localhost sidesteps that entirely - and it is the same page, not a
     mock. */
  function defaultEndpoint() {
    var h = (typeof location !== "undefined" && location.hostname) || "";
    if (h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]") {
      return "http://127.0.0.1:8778";
    }
    return "https://rj-desk.tail0a7471.ts.net";
  }

  var CFG = {
    ENDPOINT:   defaultEndpoint(),
    // NOTE: a token in public page source is a speed bump, not authentication - anyone can read
    // it. It keeps drive-by scanners off the endpoint. The real protections are that the agent
    // has no tools at all, plus the per-IP and global rate caps on the server.
    TOKEN:      "ylAGE2xhVsH7oTOMkE38Q7pz44wS8KfG",
    MAX_CHARS:  600,          // must match MAX_QUESTION_CHARS on the server
    PROBE_MS:   2500,
    ASK_MS:     125000,       // a little over the server's own timeout
    PLACEHOLD:  "Ask about RJ's experience - engines, C++, shipped titles, availability"
  };

  var SUGGEST = [
    "What has he shipped?",
    "Does he know C++ engine work?",
    "What is his WPF experience?",
    "Is he available?"
  ];

  function el(t, c, h) {
    var d = document.createElement(t);
    if (c) d.className = c;
    if (h != null) d.innerHTML = h;
    return d;
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function ChatBox(host, opts) {
    if (!host) throw new Error("ChatBox: no host element");
    opts = opts || {};
    // Accept `endpoint` as well as `ENDPOINT`. Object.assign merges by exact key, so the
    // lowercase option every caller actually passes was landing as a SIBLING key and being
    // ignored by _probe/_ask. It only looked fine because the default and the passed URL
    // were the same string; changing the endpoint at a call site would have done nothing.
    this.opts = Object.assign({}, CFG, opts);
    if (opts.endpoint) this.opts.ENDPOINT = opts.endpoint;
    this.host = host;
    this.busy = false;
    this._build();
    this._probe();
  }

  ChatBox.prototype._build = function () {
    var self = this;
    this.host.classList.add("cb");
    this.host.innerHTML = "";

    var head = el("div", "cb-head");
    head.appendChild(el("span", "cb-title", "Ask about this CV"));
    this.dot = el("span", "cb-dot cb-checking");
    this.state = el("span", "cb-state", "checking the helper...");
    head.appendChild(this.dot);
    head.appendChild(this.state);
    this.host.appendChild(head);

    this.log = el("div", "cb-log");
    this.host.appendChild(this.log);

    var row = el("div", "cb-row");
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "cb-in";
    this.input.placeholder = this.opts.PLACEHOLD;
    this.input.maxLength = this.opts.MAX_CHARS;
    this.input.disabled = true;
    this.send = el("button", "cb-send", "Ask");
    this.send.disabled = true;
    row.appendChild(this.input);
    row.appendChild(this.send);
    this.host.appendChild(row);

    this.chips = el("div", "cb-chips");
    SUGGEST.forEach(function (q) {
      var c = el("button", "cb-chip", esc(q));
      c.addEventListener("click", function () {
        if (self.input.disabled) return;
        self.input.value = q;
        self._ask();
      });
      self.chips.appendChild(c);
    });
    this.host.appendChild(this.chips);

    // Deliberately does NOT name the model. It is Claude Code today and may be a local Qwen via
    // Ollama later; a hardcoded model name is a claim that silently goes stale. "An LLM on RJ's
    // own machine" stays true across that swap.
    this.foot = el("div", "cb-foot",
      "Runs an LLM on RJ's own machine with every tool switched off: no shell, no files, no " +
      "connectors, no internet. It reads the CV and replies in text, nothing else.");
    this.host.appendChild(this.foot);

    this.send.addEventListener("click", function () { self._ask(); });
    this.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") self._ask();
    });
  };

  ChatBox.prototype._setState = function (kind, text) {
    this.dot.className = "cb-dot cb-" + kind;
    this.state.textContent = text;
  };

  ChatBox.prototype._probe = function () {
    var self = this;
    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, this.opts.PROBE_MS);
    fetch(this.opts.ENDPOINT + "/health", { signal: ctl.signal })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("http " + r.status)); })
      .then(function (d) {
        clearTimeout(t);
        // HTTP 200 only proves the endpoint answered. The endpoint can take a question without
        // being able to ANSWER one - that half is a separate process on the same desktop - so it
        // reports both and we require both. Trusting the status code alone showed a "live" box
        // that accepted a question and hung for the full two minutes.
        if (!d || d.ok === false) return Promise.reject(new Error("responder down"));
        self.live = true;
        self._setState("live", "live - " + (d.toolsDenied || 0) + " tools denied");
        self.input.disabled = false;
        self.send.disabled = false;
      })
      .catch(function () {
        clearTimeout(t);
        self.live = false;
        // THIS IS A RESUME SITE. The agent runs on RJ's own desktop, so for every visitor who is
        // not sitting at it the probe fails - which is the normal case, not an error. Leaving a
        // greyed-out "offline" chat box at the top of the page makes a hiring manager's first
        // impression a broken control, so the whole thing removes itself instead. Everything it
        // would have said is already on the page: the CV tab, the PDF, and the email in the
        // footer. A control that cannot work should not occupy the best space on the page.
        if (self.opts.hideWhenOffline !== false) {
          if (self.host && self.host.parentNode) self.host.style.display = "none";
          return;
        }
        self._setState("off", "offline");
        self.chips.style.display = "none";
        // Say what is actually true rather than leaving a dead box on the page. This is the whole
        // point of probing: the reader gets a real route to the same information.
        self.log.innerHTML =
          '<div class="cb-msg cb-sys">The live helper is not running right now - it only answers ' +
          'while RJ\'s machine is on, by design, because it is a process on his desktop rather ' +
          'than a hosted service.<br><br>Everything it would tell you is on this page: the ' +
          '<a href="#resume">CV tab</a> has the full history, and the ' +
          '<a href="./games/RJ_Thompson_Resume.pdf" target="_blank" rel="noopener">PDF</a> is one ' +
          'click away. For anything else, <a href="mailto:RJ45Thompson@gmail.com">email him</a>.</div>';
        self.input.placeholder = "The helper is offline";
      });
  };

  ChatBox.prototype._add = function (cls, html) {
    var m = el("div", "cb-msg " + cls, html);
    this.log.appendChild(m);
    this.log.scrollTop = this.log.scrollHeight;
    return m;
  };

  ChatBox.prototype._ask = function () {
    var self = this;
    var q = (this.input.value || "").trim();
    if (!q || this.busy || !this.live) return;
    if (q.length > this.opts.MAX_CHARS) {
      this._add("cb-sys", "That is longer than " + this.opts.MAX_CHARS + " characters.");
      return;
    }
    this.busy = true;
    this.input.value = "";
    this.send.disabled = true;
    this._add("cb-you", esc(q));
    var pending = this._add("cb-bot cb-wait", "thinking...");

    var ctl = new AbortController();
    var t = setTimeout(function () { ctl.abort(); }, this.opts.ASK_MS);

    fetch(this.opts.ENDPOINT + "/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json",
                 "X-Agentbox-Token": this.opts.TOKEN },
      body: JSON.stringify({ q: q }),
      signal: ctl.signal
    })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        clearTimeout(t);
        pending.classList.remove("cb-wait");
        if (!res.ok) {
          // Surface the server's own reason. A rate limit and a dead backend are different
          // things and the reader deserves to know which one they hit.
          pending.className = "cb-msg cb-sys";
          pending.textContent = res.d && res.d.error ? res.d.error : "That did not go through.";
          return;
        }
        pending.textContent = res.d.answer || "(no answer came back)";
      })
      .catch(function () {
        clearTimeout(t);
        pending.className = "cb-msg cb-sys";
        pending.textContent = "The helper stopped responding. It runs on RJ's desktop, so it may " +
          "have gone offline mid-question.";
      })
      .then(function () {
        self.busy = false;
        self.send.disabled = false;
        self.input.focus();
      });
  };

  ChatBox.CFG = CFG;
  root.ChatBox = ChatBox;
})(typeof window !== "undefined" ? window : globalThis);
