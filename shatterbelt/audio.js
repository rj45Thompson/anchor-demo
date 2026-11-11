// audio.js: plays the game's events as sound, with Web Audio.
//
// Browsers only allow sound after the player has pressed something, so nothing is created until
// unlock() is called from a click or a key press. Every sound is a file from Star Fighter.
const FILES = {
  shot: 'assets/sound/weapon_player.wav',
  hunterShot: 'assets/sound/weapon_enemy.wav',
  rock: 'assets/sound/explosion_asteroid.wav',
  hunter: 'assets/sound/explosion_enemy.wav',
  ship: 'assets/sound/explosion_player.wav',
  warp: 'assets/sound/warp.ogg',
  extra: 'assets/sound/pickup.ogg',
};
const MUSIC = '../games/assets/audio/arcade.ogg'; // shared with Résumé Breakout

const MAX_VOICES = 6; // per sound: a held fire button must not stack up dozens of copies

export class Sound {
  constructor({ muted = false, music = true } = {}) {
    this.muted = muted;
    this.musicOn = music;
    this.context = null;
    this.buffers = {};
    this.voices = {};
    this.problems = [];   // files this browser could not play, by name, shown on the page
  }

  // Call from a user gesture. Loads every file once; a file that cannot be decoded is named in problems.
  async unlock() {
    if (this.context) {
      if (this.context.state === 'suspended') await this.context.resume();
      return;
    }
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) { this.problems.push('this browser has no Web Audio'); return; }
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(this.context.destination);
    this.musicGain = this.context.createGain();
    this.musicGain.gain.value = this.musicOn ? 0.32 : 0;
    this.musicGain.connect(this.master);
    const load = async (name, url) => {
      try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.buffers[name] = await this.context.decodeAudioData(await response.arrayBuffer());
      } catch (error) {
        this.problems.push(`${url.split('/').pop()}: ${error.message || error}`);
        console.warn(`Shatterbelt: cannot play ${url} here (${error.message || error})`);
      }
    };
    await Promise.all([...Object.entries(FILES).map(([name, url]) => load(name, url)), load('music', MUSIC)]);
    if (this.buffers.music) this.startMusic();
  }

  startMusic() {
    const source = this.context.createBufferSource();
    source.buffer = this.buffers.music;
    source.loop = true;
    source.connect(this.musicGain);
    source.start();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.context.currentTime, 0.03);
  }

  setMusic(on) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.setTargetAtTime(on ? 0.32 : 0, this.context.currentTime, 0.1);
  }

  // pan: -1 left to 1 right; rate: 1 is the file's own pitch
  play(name, { gain = 1, rate = 1, pan = 0 } = {}) {
    if (!this.context || this.muted || !this.buffers[name]) return;
    const playing = (this.voices[name] = (this.voices[name] || []).filter(v => v.endsAt > this.context.currentTime));
    if (playing.length >= MAX_VOICES) return;
    const source = this.context.createBufferSource();
    source.buffer = this.buffers[name];
    source.playbackRate.value = rate;
    const level = this.context.createGain();
    level.gain.value = gain;
    const panner = this.context.createStereoPanner ? this.context.createStereoPanner() : null;
    if (panner) { panner.pan.value = Math.max(-1, Math.min(1, pan)); source.connect(level).connect(panner).connect(this.master); }
    else source.connect(level).connect(this.master);
    source.start();
    playing.push({ endsAt: this.context.currentTime + source.buffer.duration / rate });
  }

  // One step's events, as sound. fieldWidth turns x into left-right pan.
  onEvents(events, fieldWidth) {
    for (const e of events) {
      const pan = (e.x / fieldWidth) * 1.4 - 0.7;
      switch (e.type) {
        case 'shot': this.play(e.fromShip ? 'shot' : 'hunterShot', { gain: e.fromShip ? 0.35 : 0.4, rate: 0.95 + Math.random() * 0.1, pan }); break;
        case 'rockBroken': this.play('rock', { gain: { Large: 0.9, Medium: 0.7, Small: 0.55 }[e.size], rate: { Large: 0.8, Medium: 1, Small: 1.25 }[e.size], pan }); break;
        case 'hunterDestroyed': this.play('hunter', { gain: 0.9, pan }); break;
        case 'shipDestroyed': this.play('ship', { gain: 1, pan }); break;
        case 'hyperspaceOut': case 'hyperspaceIn': this.play('warp', { gain: 0.6, rate: e.type === 'hyperspaceOut' ? 1.15 : 0.85, pan }); break;
        case 'hunterArrived': this.play('warp', { gain: 0.35, rate: 0.6, pan }); break;
        case 'extraShip': this.play('extra', { gain: 0.8 }); break;
        default: break;
      }
    }
  }
}
