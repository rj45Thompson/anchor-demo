// actions.js - the ACTION BAR: a row of labelled buttons for the mouse and keyboard player, one per thing the player can DO in the
// phase they are in, each showing the keys that do it, each clickable. It exists because the mouse had no way to swap tool or to be
// ready (the swap was Tab or a middle click, and a laptop has no middle button), and because nothing on screen said what the tool in
// hand is.
//
// ACTIONS is DATA. A new action is one more entry here, with the PadInput field it sets (`field`), the value it sets (`value`,
// default true: a shop button sets its ItemKind), whether it is a HOLD (`hold`: the field stays set while the button is down - the
// defuse), the row it sits in (`row` 0 or 1) and a rule for when it is available (`enabled`) and shown (`visible`); the bar, its
// greying, its labels and the camera cover rect need no other change. (The controller then needs the field and the model the command.)
//
// An entry: { id, field, value?, hold?, row?, label(ctx), keys (what the button shows; a string or keys(ctx)), enabled(ctx),
// visible(ctx)?, tool(ctx)? (a second line: the tool in hand, or the stock bought), on(ctx)? (shown pressed in), poor(ctx)? (the
// shop: the player cannot pay, the button is dim but still sends, so the refusal says why) }.
// ctx is what the page knows about the player now: { phase: 'Claim'|'Cannons'|'Battle'|'Repair'|..., sword (the tool flag: the bomb
// tool in the bomb rule set), ready, bombs (the rule set is on), carrying, bombsLeft, score, costs, items, key(action) (player 1's keys
// for a movable action now, core/controller/KeyBindings.js label: a rebind shows at once, UC-ST3), enterReady (Enter is READY too),
// full (the full rules are on), gun ('cannon' | 'mortar' | 'kite': what CANNONS places now under the full rules) }.

const IN_PLAY = (c) => c.phase === 'Claim' || c.phase === 'Cannons' || c.phase === 'Battle' || c.phase === 'Repair' || c.phase === 'Raid';
const TOOL_PHASE = (c) => c.phase === 'Battle' || c.phase === 'Repair';
const BOMBS = (c) => c.bombs;
// BOMBER_UC.md R3: the bombs are the RAID's, one tool a beat - its buttons show in the RAID alone, and no Swap tool shows with bombs on
const RAID = (c) => c.bombs && c.phase === 'Raid';
// BOMBER_UC R18: the shop row and Set trap are hidden in the RAID (a Bomberman beat shows bombs, fire and speed, not a shop)
const SHOP_SHOWN = (c) => c.bombs && c.phase !== 'Raid';
const SHOP = [['metal', 'Metal', 'piece, 6 hits'], ['trap', 'Trap', 'spikes'], ['bombPack', 'Bombs', '+1 at once'], ['bigBomb', 'Big bomb', 'next one']];

import { zoomOf } from './overlay.js';

export const ACTIONS = Object.freeze([
  Object.freeze({
    id: 'place', field: 'confirm', keys: (c) => c.key('confirm') + ' / click',
    label: (c) => (RAID(c) ? (c.carrying ? 'Throw' : 'Bomb') : c.sword && TOOL_PHASE(c) ? 'Swing' : c.phase === 'Cannons' && c.full ? 'Place ' + c.gun
      : ({ Claim: 'Claim', Cannons: 'Place', Battle: 'Fire', Repair: 'Place' })[c.phase] || 'Place'),
    tool: (c) => (RAID(c) ? 'x' + c.bombsLeft : ''),            // the RAID: how many more of its bombs the hero may light now
    enabled: IN_PLAY,
  }),
  // the full rules: in CANNONS rotate switches what is placed (cannon, mortar, kite), in BATTLE it aims the kite instead of a cannon
  Object.freeze({ id: 'rotate', field: 'rotate', keys: (c) => c.key('rotate') + ' / right click',
    label: (c) => (c.full && c.phase === 'Cannons' ? 'Switch' : c.full && c.phase === 'Battle' ? 'Kite aim' : 'Rotate'),
    visible: (c) => !RAID(c),
    enabled: (c) => !c.sword && (c.phase === 'Repair' || (c.full && (c.phase === 'Cannons' || c.phase === 'Battle'))) }),
  // the RAID's B (BOMBER_UC.md step 13): a tap picks up (or throws the bomb in hand), a hold puts one out
  Object.freeze({ id: 'pickup', field: 'pickUp', keys: (c) => c.key('grab') + ' / right click', label: (c) => (c.carrying ? 'Throw' : 'Pick up'), visible: RAID, enabled: RAID }),
  Object.freeze({ id: 'defuse', field: 'defuse', hold: true, keys: (c) => 'hold ' + c.key('grab') + ' / right', label: () => 'Defuse', visible: RAID, enabled: RAID }),
  Object.freeze({
    id: 'swap', field: 'swap', keys: (c) => c.key('swap'), label: () => 'Swap tool', enabled: TOOL_PHASE, visible: (c) => !c.bombs,
    on: (c) => c.sword && TOOL_PHASE(c),
    tool: (c) => (!TOOL_PHASE(c) ? '' : c.sword ? 'SWORD' : c.phase === 'Battle' ? 'CANNON' : 'PIECES'),
  }),
  Object.freeze({ id: 'ready', field: 'ready', keys: (c) => c.key('ready') + (c.enterReady ? ' / Enter' : ''), label: () => 'Ready', visible: (c) => !RAID(c), enabled: (c) => c.phase === 'Cannons' && !c.ready }),
  // the shop (REPAIR): one button per item with its price from rules.itemCosts, dim when the player cannot pay; the trap is then put down
  ...SHOP.map(([name, word, what], item) => Object.freeze({
    id: 'buy-' + name, field: 'buy', value: item, row: 1, keys: String(item + 1),
    label: (c) => word + ' ' + (c.costs ? c.costs[name] : ''),
    visible: SHOP_SHOWN, enabled: (c) => c.phase === 'Repair',
    poor: (c) => c.phase === 'Repair' && !!c.costs && c.score < c.costs[name],
    tool: (c) => (c.items && c.items[name] > 0 && name !== 'bombPack' ? 'own ' + c.items[name] : what),
  })),
  Object.freeze({
    id: 'trap', field: 'trap', row: 1, keys: 'T', label: () => 'Set trap', visible: SHOP_SHOWN, enabled: (c) => c.phase === 'Repair' && !!c.items && c.items.trap > 0,
    tool: (c) => (c.items ? 'x' + c.items.trap : ''),
  }),
]);

export class ActionBar {
  /** @param parent the element the bar is added to (document.body)  @param actions the list (ACTIONS) */
  constructor(parent, actions) {
    const el = document.createElement('div');
    el.className = 'abar'; el.dataset.nogame = '1'; el.hidden = true; el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', 'Actions');
    this.actions = actions; this.el = el; this.visible = false; this.compact = false;
    this.edges = {}; this.held = {}; this.buttons = new Map(); this.shown = new Map();
    const rows = [document.createElement('div'), document.createElement('div')];
    rows.forEach((r, i) => { r.className = 'abr abr' + i; el.appendChild(r); });
    this.score = document.createElement('div'); this.score.className = 'abscore'; this.score.dataset.nogame = '1';
    rows[1].appendChild(this.score);
    this.rows = rows;
    for (const a of actions) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ab'; b.dataset.action = a.id; b.dataset.nogame = '1'; b.tabIndex = -1;
      b.innerHTML = '<span class="al"></span><span class="at"></span><span class="ak"></span>';
      // pointerdown, as the touch controls do: the press is latched until the next game tick takes it. A greyed button latches nothing.
      // A hold stays set while the button is down.
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (b.getAttribute('aria-disabled') === 'true') return;
        if (a.hold) this.held[a.field] = true; else this.edges[a.field] = a.value === undefined ? true : a.value;
        b.classList.add('down');
      });
      const up = () => { b.classList.remove('down'); if (a.hold) this.held[a.field] = false; };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
      rows[a.row || 0].appendChild(b); this.buttons.set(a.id, b);
    }
    parent.appendChild(el);
  }

  show(on) {
    if (on === this.visible) return;
    this.visible = on; this.el.hidden = !on;
    if (!on) { this.edges = {}; this.held = {}; }
  }

  /** Compact: the shop row alone, small (a touch screen has its own stick and A / B / Y; the shop and the trap are what it lacks). */
  setCompact(on) { if (on !== this.compact) { this.compact = on; this.el.classList.toggle('compact', on); } }

  /** Label, keys-state and greying from what the player can do now. Touches the DOM only where something changed. */
  update(ctx) {
    for (const a of this.actions) {
      const b = this.buttons.get(a.id);
      const state = {
        label: a.label(ctx), keys: typeof a.keys === 'function' ? a.keys(ctx) : a.keys, tool: a.tool ? a.tool(ctx) : '', enabled: !!a.enabled(ctx),
        on: a.on ? !!a.on(ctx) : false, shown: a.visible ? !!a.visible(ctx) : true, poor: a.poor ? !!a.poor(ctx) : false,
      };
      const key = JSON.stringify(state);
      if (this.shown.get(a.id) === key) continue;
      this.shown.set(a.id, key);
      b.hidden = !state.shown;
      b.querySelector('.al').textContent = state.label;
      b.querySelector('.at').textContent = state.tool;
      b.querySelector('.ak').textContent = state.keys;
      b.setAttribute('aria-disabled', state.enabled ? 'false' : 'true');
      b.classList.toggle('off', !state.enabled);
      b.classList.toggle('poor', state.enabled && state.poor);
      b.classList.toggle('on', state.on);
      b.setAttribute('aria-pressed', state.on ? 'true' : 'false');
    }
    const showScore = !!ctx.bombs;
    this.score.hidden = !showScore;
    if (showScore) this.score.textContent = 'Score ' + ctx.score;
    this.rows[1].hidden = !ctx.bombs;
  }

  /** The bar sits `bottom` CSS px up from the window's foot (above the HUD's player cards). */
  place(bottom) { this.el.style.bottom = bottom / zoomOf(this.el) + 'px'; }   // the window's px (TEXT SIZE zooms the bar)

  /** The bar's screen rect: one of the camera's cover rects while it is shown. */
  rect() { return this.el.getBoundingClientRect(); }

  /** The presses since the last call (cleared) and the holds now, by PadInput field; buy is -1 when no shop button was pressed. */
  take() {
    const out = Object.assign({ confirm: false, rotate: false, swap: false, ready: false, drop: false, pickUp: false, defuse: false, trap: false, buy: -1 }, this.held, this.edges);
    this.edges = {};
    return out;
  }
}
