// mood.js - the light of a level (MOOD_UC.md UC-L4, AAA gap 6: "a single sunny afternoon"). Each level of a campaign is lit at its
// own time of day: the sun's colour and strength, the sky's fill, the far air (haze), the sky overhead and the glare over the
// horizon, what the sea reflects, the exposure and the grade's warm and cool. Everything that reads these reads the ONE Mood's
// uniforms below (render/sky.js, render/board.js's sea, render/renderer.js's lights and post), so a level is never half one light
// and half another. The sun's DIRECTION stays the same at every time of day: the shadow box (renderer.fitSun), the clouds' shadows
// and the sea's glints are laid along it, and a lower sun would stretch every shadow across the squares the players aim at.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { MOODS, MOOD_ORDER, moodForLevel } from './moods.js';

export { MOODS, MOOD_ORDER, moodForLevel };


/** The uniforms every lit thing reads, and the lights they drive. set(mood) changes all of them at once. */
export class Mood {
  constructor() {
    const c = () => uniform(new THREE.Color());
    this.haze = c(); this.zenith = c(); this.glare = c(); this.seaHorizon = c(); this.seaZenith = c();
    this.cool = uniform(new THREE.Vector3()); this.warm = uniform(new THREE.Vector3());
    this.cloudShade = uniform(0);
    this.saturation = uniform(1);
    this.current = null;
    this.set(MOODS.noon);
  }

  /** Light the scene with `mood` (one of MOODS). The renderer applies the lights' and exposure's part (applyTo). */
  set(mood) {
    if (!mood || MOODS[mood.name] !== mood) throw new Error('mood.js: not one of MOODS: ' + (mood && mood.name));
    this.haze.value.set(mood.haze); this.zenith.value.set(mood.zenith); this.glare.value.set(mood.glare);
    this.seaHorizon.value.set(mood.seaHorizon); this.seaZenith.value.set(mood.seaZenith);
    this.cool.value.set(...mood.cool); this.warm.value.set(...mood.warm);
    this.cloudShade.value = mood.cloudShade;
    this.saturation.value = mood.saturation;
    this.current = mood;
  }

  /** The lights and the tone map follow the mood (the renderer's sun, its hemisphere fill and the WebGPU renderer's exposure). */
  applyTo(sun, hemi, gpu) {
    const m = this.current;
    sun.color.set(m.sun); sun.intensity = m.sunI;
    hemi.color.set(m.sky); hemi.groundColor.set(m.ground); hemi.intensity = m.skyI;
    gpu.toneMappingExposure = m.exposure;
  }
}
