// host.js - the page's host hook (SETTINGS_UC.md UC-DH1; desktop/PROPOSED_WEB_CHANGES.md 1-4). A program that runs this page (the
// desktop build) sets `window.tidewallHost` BEFORE app/main.js runs; main.js reads it once at boot through readHost(). With no host
// (the web build) nothing changes: storage is the browser's localStorage, QUIT goes back to the title, phones are offered.
//
// A host is checked whole when it is read. A member that is missing or of the wrong kind stops the page with its name: nothing is
// defaulted, and a host set after the page booted throws (the slot is read-only from then on) instead of being ignored.
//
//   storage  { getItem(key) -> string | null, setItem(key, text) }   every read and write of the page's saved values
//   footer   [{ id, text, bad }]   lines added to the title footer (id: a lower-case name, the line's data-host-line)
//   phones   { allowed: boolean, why: string }   false: CONTROLS is LOCAL only and the join screen says why (why is required then)
//   quit()   QUIT on the setup menu
//   event(e, who)   every match event the page presents; who = { demo (the bots' demo or the attract match: no person plays),
//                   isHuman(slot) }

export class HostError extends Error {
  constructor(why) { super("the page's host is " + why); this.name = 'HostError'; }
}

const LINE_ID = /^[a-z][a-z0-9-]*$/;

/** Checks a host object and returns a frozen copy of what the page uses. Throws HostError naming the first thing wrong. */
export function checkHost(h) {
  if (h === null || typeof h !== 'object') throw new HostError('not an object (' + h + ')');
  const fn = (o, k, where) => { if (typeof o[k] !== 'function') throw new HostError('missing ' + where + k + '() (it is ' + typeof o[k] + ')'); };
  if (h.storage === null || typeof h.storage !== 'object') throw new HostError('missing storage (it is ' + (h.storage === null ? 'null' : typeof h.storage) + ')');
  fn(h.storage, 'getItem', 'storage.'); fn(h.storage, 'setItem', 'storage.');
  if (!Array.isArray(h.footer)) throw new HostError('missing footer, a list of { id, text, bad } (it is ' + typeof h.footer + ')');
  const footer = h.footer.map((l, i) => {
    if (l === null || typeof l !== 'object') throw new HostError('footer[' + i + '] is not { id, text, bad }');
    if (typeof l.id !== 'string' || !LINE_ID.test(l.id)) throw new HostError('footer[' + i + '].id is ' + JSON.stringify(l.id) + ', want a lower-case name');
    if (typeof l.text !== 'string' || l.text.length === 0) throw new HostError('footer[' + i + '].text is ' + JSON.stringify(l.text) + ', want words');
    if (typeof l.bad !== 'boolean') throw new HostError('footer[' + i + '].bad is ' + l.bad + ', want true or false');
    return Object.freeze({ id: l.id, text: l.text, bad: l.bad });
  });
  if (h.phones === null || typeof h.phones !== 'object') throw new HostError('missing phones, { allowed, why }');
  if (typeof h.phones.allowed !== 'boolean') throw new HostError('phones.allowed is ' + h.phones.allowed + ', want true or false');
  if (!h.phones.allowed && (typeof h.phones.why !== 'string' || h.phones.why.length === 0)) throw new HostError('missing phones.why (phones are not allowed: the join screen must say why)');
  fn(h, 'quit', ''); fn(h, 'event', '');
  const storage = h.storage;
  return Object.freeze({
    storage: Object.freeze({ getItem: (k) => storage.getItem(k), setItem: (k, v) => storage.setItem(k, v) }),
    footer: Object.freeze(footer),
    phones: Object.freeze({ allowed: h.phones.allowed, why: h.phones.allowed ? '' : h.phones.why }),
    quit: () => h.quit(),
    event: (e, who) => h.event(e, who),
  });
}

/** The host `win` was given (checked), or null for none. The slot is made read-only, so a host set later throws where it is set. */
export function readHost(win) {
  const h = win.tidewallHost;
  const host = h === undefined ? null : checkHost(h);
  Object.defineProperty(win, 'tidewallHost', { value: h === undefined ? null : h, writable: false, configurable: false, enumerable: true });
  return host;
}
