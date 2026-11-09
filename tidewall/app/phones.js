// phones.js - phones as controllers through PhonePad (a separate project: its host script and relay are loaded, never copied).
// The room opens only when the CONTROLS choice includes phones (app/controls.js) and a join screen shows; the join screen shows its
// QR code; choosing LOCAL closes it. Before that the page sends nothing to the relay. Each phone then appears in navigator.getGamepads() as a
// standard gamepad at index base + seat, and the input hub reads it like any pad: phone N plays as player N.
//
// When the relay cannot be reached or refuses the room, `state` becomes 'failed' and `reason` says why in words; the join screen
// shows it and keyboard and gamepads keep working (use case alternate path 2b). Nothing is retried behind the player's back.

/** The relay this page uses: ONE constant. The relay only accepts pages from the origins it lists (its HOST_ORIGINS). */
export const PHONEPAD_RELAY = 'https://phonepad-relay.tami-play.workers.dev';

export class Phones {
  constructor(seats) {
    this.seats = seats;
    this.state = 'off';          // 'off' | 'opening' | 'open' | 'failed'
    this.gen = 0;                // which open() is current: a close() while one is in flight retires it
    this.reason = '';
    this.pads = null;
    this.joined = new Set();     // phone seats connected now (PhonePad's own join and leave callbacks)
  }

  /** Open the room. Resolves either way; never throws - a failure is a state the join screen reports. */
  async open() {
    const gen = ++this.gen;
    this.state = 'opening'; this.reason = '';
    let mod;
    try {
      mod = await import(PHONEPAD_RELAY + '/phonepad-host.js');
    } catch (e) {
      if (gen !== this.gen) return this;
      this.state = 'failed';
      this.reason = 'the phone relay\'s script could not be loaded (' + (e && e.message ? e.message : String(e)) + ').';
      return this;
    }
    if (gen !== this.gen) return this;
    try {
      const pads = await mod.PhonePad.start({
        relay: PHONEPAD_RELAY, layout: 'pad', seats: this.seats,
        place: { right: '16px', top: '16px' },
        onJoin: (seat) => this.joined.add(seat),
        onLeave: (seat) => this.joined.delete(seat),
      });
      if (gen !== this.gen) { pads.close(); return this; }               // LOCAL was chosen while it opened
      this.pads = pads;
      this.state = 'open';
    } catch (e) {
      if (gen !== this.gen) return this;
      this.state = 'failed';
      this.reason = (this.pads && this.pads.error) || (e && e.message ? e.message : String(e));
    }
    return this;
  }

  /** Close the room (LOCAL chosen): the phones leave, the QR box goes, the relay is not spoken to again until a new open(). */
  close() {
    this.gen++;
    if (this.pads) this.pads.close();
    this.pads = null; this.shown = false; this.joined.clear();
    this.state = 'off'; this.reason = '';
  }

  /** The QR box: shown on the join screen only. */
  show(on) {
    if (!this.pads) return;
    if (on && !this.shown) { this.pads.show(); this.shown = true; }
    else if (!on && this.shown) { this.pads.hide(); this.shown = false; }
  }
}
