// actions.js - the ACTION BAR: a row of labelled buttons for the mouse and keyboard player, one per thing the player can DO in the
// phase they are in, each showing the keys that do it, each clickable. It exists because the mouse had no way to swap tool or to be
// ready (the swap was Tab or a middle click, and a laptop has no middle button), and because nothing on screen said the sword exists.
//
// ACTIONS is DATA. A new action (a later round's bombs: drop, pick up, defuse, throw) is one more entry here, with the PadInput field
// it sets (`field`) and a rule for when it is available (`enabled`); the bar, its greying, its labels and the camera cover rect need no
// other change. (The controller then needs the field and the model the command, as for any new input.)
//
// An entry: { id, field (the PadInput field a press sets), label(ctx), keys (what the button shows), enabled(ctx), tool(ctx) (optional:
// a second line naming the tool in hand, the highlighted state when `on(ctx)`), on(ctx) (optional: shown pressed in) }.
// ctx is what the page knows about the player now: { phase: 'Claim'|'Cannons'|'Battle'|'Repair'|..., sword, ready, cannonsLeft }.

const IN_PLAY = (c) => c.phase === 'Claim' || c.phase === 'Cannons' || c.phase === 'Battle' || c.phase === 'Repair';
const TOOL_PHASE = (c) => c.phase === 'Battle' || c.phase === 'Repair';

export const ACTIONS = Object.freeze([
  Object.freeze({
    id: 'place', field: 'confirm', keys: 'Space / click',
    label: (c) => (c.sword && TOOL_PHASE(c) ? 'Swing' : ({ Claim: 'Claim', Cannons: 'Place', Battle: 'Fire', Repair: 'Place' })[c.phase] || 'Place'),
    enabled: IN_PLAY,
  }),
  Object.freeze({ id: 'rotate', field: 'rotate', keys: 'R / right click', label: () => 'Rotate', enabled: (c) => c.phase === 'Repair' && !c.sword }),
  Object.freeze({
    id: 'swap', field: 'swap', keys: 'Tab / Q', label: () => 'Swap tool', enabled: TOOL_PHASE,
    on: (c) => c.sword && TOOL_PHASE(c),
    tool: (c) => (!TOOL_PHASE(c) ? '' : c.sword ? 'SWORD' : c.phase === 'Battle' ? 'CANNON' : 'PIECES'),
  }),
  Object.freeze({ id: 'ready', field: 'ready', keys: 'E / Enter', label: () => 'Ready', enabled: (c) => c.phase === 'Cannons' && !c.ready }),
]);

export class ActionBar {
  /** @param parent the element the bar is added to (document.body)  @param actions the list (ACTIONS) */
  constructor(parent, actions) {
    const el = document.createElement('div');
    el.className = 'abar'; el.dataset.nogame = '1'; el.hidden = true; el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', 'Actions');
    this.actions = actions; this.el = el; this.visible = false;
    this.edges = {}; this.buttons = new Map(); this.shown = new Map();
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ab'; b.dataset.action = a.id; b.dataset.nogame = '1'; b.tabIndex = -1;
      b.innerHTML = '<span class="al"></span><span class="at"></span><span class="ak"></span>';
      b.querySelector('.ak').textContent = a.keys;
      // pointerdown, as the touch controls do: the press is latched until the next game tick takes it. A greyed button latches nothing.
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (b.getAttribute('aria-disabled') === 'true') return;
        this.edges[a.field] = true;
        b.classList.add('down');
      });
      const up = () => b.classList.remove('down');
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
      el.appendChild(b); this.buttons.set(a.id, b);
    }
    parent.appendChild(el);
  }

  show(on) {
    if (on === this.visible) return;
    this.visible = on; this.el.hidden = !on;
    if (!on) this.edges = {};
  }

  /** Label, keys-state and greying from what the player can do now. Touches the DOM only where something changed. */
  update(ctx) {
    for (const a of this.actions) {
      const b = this.buttons.get(a.id);
      const state = { label: a.label(ctx), tool: a.tool ? a.tool(ctx) : '', enabled: !!a.enabled(ctx), on: a.on ? !!a.on(ctx) : false };
      const key = JSON.stringify(state);
      if (this.shown.get(a.id) === key) continue;
      this.shown.set(a.id, key);
      b.querySelector('.al').textContent = state.label;
      b.querySelector('.at').textContent = state.tool;
      b.setAttribute('aria-disabled', state.enabled ? 'false' : 'true');
      b.classList.toggle('off', !state.enabled);
      b.classList.toggle('on', state.on);
      b.setAttribute('aria-pressed', state.on ? 'true' : 'false');
    }
  }

  /** The bar sits `bottom` CSS px up from the window's foot (above the HUD's player cards). */
  place(bottom) { this.el.style.bottom = bottom + 'px'; }

  /** The bar's screen rect: one of the camera's cover rects while it is shown. */
  rect() { return this.el.getBoundingClientRect(); }

  /** The presses since the last call, by PadInput field (cleared). */
  take() {
    const out = Object.assign({ confirm: false, rotate: false, swap: false, ready: false }, this.edges);
    this.edges = {};
    return out;
  }
}
