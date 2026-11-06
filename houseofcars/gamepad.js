// gamepad.js - a gamepad drives the car with the bindings Unreal gives it (data/input.json, READ by tools/input_data.py from
// IMC_Vehicle_Default and DefaultInput.ini): the key -> Input Action map, each axis's dead zone, exponent, sensitivity and invert
// applied as UPlayerInput::MassageAxisInput does (PlayerInput.cpp:2186-2224). Unreal key names are matched to the browser's
// W3C "standard" gamepad layout (https://w3c.github.io/gamepad/#remapping); a pad without that layout is not guessed at, it is
// reported and ignored. Serves UC-7.5a.
const STANDARD = {                                     // Unreal FKey -> W3C standard mapping: ['b', button] or ['a', axis]
  Gamepad_FaceButton_Bottom: ['b', 0], Gamepad_FaceButton_Right: ['b', 1], Gamepad_FaceButton_Left: ['b', 2], Gamepad_FaceButton_Top: ['b', 3],
  Gamepad_LeftShoulder: ['b', 4], Gamepad_RightShoulder: ['b', 5], Gamepad_LeftTriggerAxis: ['b', 6], Gamepad_RightTriggerAxis: ['b', 7],
  Gamepad_Special_Left: ['b', 8], Gamepad_Special_Right: ['b', 9], Gamepad_LeftThumbstick: ['b', 10], Gamepad_RightThumbstick: ['b', 11],
  Gamepad_DPad_Up: ['b', 12], Gamepad_DPad_Down: ['b', 13], Gamepad_DPad_Left: ['b', 14], Gamepad_DPad_Right: ['b', 15],
  Gamepad_LeftX: ['a', 0], Gamepad_LeftY: ['a', 1], Gamepad_RightX: ['a', 2], Gamepad_RightY: ['a', 3],
};

export function massage(raw, p) {                      // UPlayerInput::MassageAxisInput, PlayerInput.cpp:2186-2224
  let v = raw;
  if (p.dead_zone > 0) v = v > 0 ? Math.max(0, v - p.dead_zone) / (1 - p.dead_zone) : -Math.max(0, -v - p.dead_zone) / (1 - p.dead_zone);
  if (p.exponent !== 1) v = Math.sign(v) * Math.pow(Math.abs(v), p.exponent);
  v *= p.sensitivity;
  if (p.invert) v = -v;
  return v;
}

export function makeGamepad(input) {
  const binds = {};
  for (const m of input.mappings.value) {
    if (!m.key.startsWith('Gamepad_')) continue;
    if (!STANDARD[m.key]) throw new Error('gamepad.js: no W3C standard slot for ' + m.key);
    if (m.modifiers.some((x) => x !== 'InputModifierNegate')) throw new Error('gamepad.js: modifier not ported on ' + m.key + ': ' + m.modifiers);
    (binds[m.action] = binds[m.action] || []).push({ key: m.key, slot: STANDARD[m.key], negate: m.modifiers.length % 2 === 1, axis: input.axis_config.value[m.key] || null });
  }
  return { binds, prev: {}, id: null, nonstandard: null };
}

// the first connected pad of the W3C standard layout, or null (the showroom reads its buttons directly)
export function readPadRaw() {
  const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
  return [...pads].find((p) => p && p.connected && p.mapping === 'standard') || null;
}

// the action values this frame from the first standard-layout pad: { throttle, brake, steering, handbrake, pressed: Set }
export function readGamepad(G) {
  const pads = (navigator.getGamepads ? navigator.getGamepads() : []) || [];
  const pad = [...pads].find((p) => p && p.connected && p.mapping === 'standard');
  const other = [...pads].find((p) => p && p.connected && p.mapping !== 'standard');
  G.nonstandard = !pad && other ? other.id : null;      // shown on the HUD, never remapped by guess
  if (!pad) { G.id = null; return null; }
  G.id = pad.id;
  const val = (b) => {
    const [kind, i] = b.slot;
    let v = kind === 'b' ? (pad.buttons[i] ? pad.buttons[i].value : 0) : (pad.axes[i] || 0);
    if (b.axis) v = massage(v, b.axis);
    return b.negate ? -v : v;
  };
  const action = (name) => (G.binds[name] || []).reduce((a, b) => { const v = val(b); return Math.abs(v) > Math.abs(a) ? v : a; }, 0);
  const out = { throttle: Math.max(0, action('IA_Throttle')), brake: Math.max(0, action('IA_Brake')), steering: Math.max(-1, Math.min(1, action('IA_Steering'))),
                handbrake: action('IA_Handbrake') > 0.5 ? 1 : 0, pressed: new Set() };
  for (const name of ['IA_Reset', 'IA_ToggleCamera']) {   // triggered on the press, as the IMC's default trigger fires
    const down = Math.abs(action(name)) > 0.5;
    if (down && !G.prev[name]) out.pressed.add(name);
    G.prev[name] = down;
  }
  return out;
}
