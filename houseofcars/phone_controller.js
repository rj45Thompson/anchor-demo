// phone_controller.js - a visitor's phone as the car's controller (PhonePad, D:/_phonepad; another session's file, like
// sales_chat.js). A "Phone controller" button opens a PhonePad room in the "drive" layout and shows its QR code; the phone
// then IS a W3C standard gamepad, so gamepad.js drives the car with it exactly as with a real pad (nothing in app.js changes).
// The phone's layout follows the car's own bindings, READ from data/input.json (Unreal's IMC_Vehicle_Default):
//   pedals = the trigger axes (IA_Throttle on Gamepad_RightTriggerAxis = button 7, IA_Brake on Gamepad_LeftTriggerAxis = 6),
//   steering = Gamepad_LeftX (axis 0, tilt or the on-screen slider), and one button per other action bound to a W3C button.
// Load: <script src="phone_controller.js" data-relay="https://phonepad-relay.tami-play.workers.dev"></script>
//   data-button="none" hides the default button; call window.HOC_PHONE.start() from your own instead.
//   data-brake-label="Brake / clutch" names the left pedal (at most 16 characters), when the page uses it for more than braking.
(() => {
  const me = document.currentScript;
  const relay = me && me.dataset.relay;
  if (!relay) throw new Error('phone_controller.js: data-relay (the PhonePad relay address) is missing');
  const BUTTON = {                                // Unreal FKey -> W3C standard button, as gamepad.js STANDARD
    Gamepad_FaceButton_Bottom: 0, Gamepad_FaceButton_Right: 1, Gamepad_FaceButton_Left: 2, Gamepad_FaceButton_Top: 3,
    Gamepad_LeftShoulder: 4, Gamepad_RightShoulder: 5, Gamepad_LeftTriggerAxis: 6, Gamepad_RightTriggerAxis: 7,
    Gamepad_Special_Left: 8, Gamepad_Special_Right: 9, Gamepad_LeftThumbstick: 10, Gamepad_RightThumbstick: 11,
    Gamepad_DPad_Up: 12, Gamepad_DPad_Down: 13, Gamepad_DPad_Left: 14, Gamepad_DPad_Right: 15,
  };
  const words = (action) => action.replace(/^IA_/, '').replace(/([a-z])([A-Z])/g, '$1 $2');   // IA_ToggleCamera -> Toggle Camera

  async function labelsFromBindings() {           // the phone shows the car's actions, never a guessed set
    const input = await (await fetch('data/input.json')).json();
    const pedals = new Set(input.mappings.value.filter((m) => m.key === 'Gamepad_RightTriggerAxis' || m.key === 'Gamepad_LeftTriggerAxis').map((m) => m.action));
    const labels = {};
    for (const m of input.mappings.value) {
      const b = BUTTON[m.key];
      if (b === undefined || b === 6 || b === 7 || pedals.has(m.action)) continue;   // the pedals already carry those actions
      labels['b' + b] = words(m.action);
    }
    // the drag strip's shift buttons have no Unreal binding: they are the page's own, app.js tickDrag (RB = 5 up, Y = 3 down)
    for (const [b, name] of [[5, 'Shift up'], [3, 'Shift down']]) {
      if (labels['b' + b]) throw new Error('phone_controller.js: button ' + b + ' is bound to ' + labels['b' + b] + ' and to the drag strip\'s ' + name);
      labels['b' + b] = name;
    }
    // the left pedal's name, when the page gives it one (data-brake-label, e.g. "Brake / clutch" once the strip's clutch mode
    // reads button 6): the page states what its pedal does, so the phone never names a control the page does not have yet
    if (me.dataset.brakeLabel) labels.b6 = me.dataset.brakeLabel;
    return labels;
  }

  let pads = null;
  async function start() {
    if (pads) { pads.show(); return pads; }
    const { PhonePad } = await import(relay.replace(/\/$/, '') + '/phonepad-host.js');
    pads = await PhonePad.start({ relay, layout: 'drive', seats: 1, labels: await labelsFromBindings(),
      place: { left: '16px', bottom: '100px' } });   // left: the sales chat sits on the right
    pads.show();
    return pads;
  }
  function stop() { if (pads) { pads.close(); pads = null; } }
  window.HOC_PHONE = { start, stop, get pads() { return pads; } };

  if (me.dataset.button === 'none') return;
  const go = () => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Phone controller';
    b.setAttribute('data-phone-controller', '');
    b.style.cssText = 'position:fixed;left:16px;bottom:56px;z-index:2147482000;padding:8px 14px;border-radius:10px;border:1px solid #2a3040;' +
      'background:#141824;color:#e9edf5;font:600 13px/1 system-ui,sans-serif;cursor:pointer';
    b.addEventListener('click', () => {
      if (pads) { stop(); b.textContent = 'Phone controller'; return; }
      b.textContent = 'Opening...';
      start().then(() => { b.textContent = 'Close phone controller'; })
        .catch((e) => { b.textContent = 'Phone controller'; alert('Phone controller: ' + e.message); });
    });
    document.body.append(b);
  };
  if (document.body) go(); else document.addEventListener('DOMContentLoaded', go);
})();
