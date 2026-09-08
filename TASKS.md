# Résumé Breakout — graphics upgrade backlog

## Open - RJ rejected the letter plates (2026-09-07)

RJ, looking at the shipped plates: **"I don't like these letters, try again."**

The CONSTRAINT still holds - it is why plates were built in the first place. RJ's earlier words:
*"the letters are kind of important to read since it's a resume ... they're blocked letters and
they're never going to have the contrast."* So whatever replaces them must stay readable over a
BRIGHT planet, in every era of the reveal ladder, at the back of the field as well as the front.
Plates solved that by brute force - an opaque dark rectangle per glyph - and the cure is worse than
the disease. Do not simply restyle the plate; the rectangle itself is what he is rejecting.

Also load-bearing, from the same review: *"it looks like you just mapped the texture and didn't take
any of the mesh at all."* He notices and dislikes flat texture-on-a-quad where geometry belongs.
That is a strong hint that real extruded letterforms are worth trying.

⚠ **Judge against the FIXED shader, not old screenshots.** RJ himself committed `511f42d` ("Letters
from scratch: three styles, press L"), which (a) found and fixed a REAL bug — an ungated dissolve
ember (`CARD_FRAG` :758) painted a warm glow on ~1/5 of every intact glyph, forever — and (b) built
a **3-style cycler** already: `LETTER_STYLES` (:598), cycled by **L**, persisted to
`localStorage.bx_letter_style`. His three styles map onto this backlog: **OUTLINE** (:696) = L1b
STROKED; **NEON** (:706) = L1c EMISSIVE + L1d HALO; plus **PAGE** (a per-line card, the "just make
it readable" baseline). So L1a-L1e extend RJ's cycler rather than fighting it (directive: "do not
fight it"): the missing ones are **L1a EXTRUDED** (his three are all texture-on-a-card — the exact
thing he says "didn't take any of the mesh") and **L1e** (mine).

## Reference shot — PINNED (L1f, done 2026-09-07). All five treatment shots use EXACTLY this.

The only variable across the five is the **letter style**; everything else below is fixed so the
five are comparable rather than five different scenes.

- **World / planet skin: `glacier`** — the palest & brightest of the 6 worlds (measured mean-frame
  luma 77.9, the highest), i.e. the worst case for glyph contrast, which is the only case that
  matters. Pinned by seeding `Math.random` (LCG, **seed 6**) via Playwright `addInitScript` BEFORE
  page scripts run. This was the hidden reason old shots were never comparable: `resume-arkanoid.html:2292`
  picks the world with **unseeded `Math.random()`** every load, so each load drew a different planet.
- **Camera: rig 0 = CRAWL** (`CAM_MODES[0]`, the default gameplay shot), `camBlend=1` (fully settled).
- **Moment: crawl ≈ 12.05** — from a fresh play start, freeze rAF and `__bx.step(4,16.7)` until
  `crawl≥12`. At this moment **83 glyphs arrived**, ~6 résumé lines span the frame front-to-back
  (back line small at top → "R.J. THOMPSON" large at bottom), all over the bright planet.
- **Era: single/fixed** — the graphics-era ladder was removed in `511f42d` (`reveal=1`, `eraIdx=5`
  are consts, :890-891). "Era" is no longer a variable and drops out of the comparison. (The HUD
  still prints "1988 · 8-bit" but it is decorative/stale.)
- **Viewport 1280×800, deviceScaleFactor 1** (pixel ratio 1). Intro bypassed via
  `localStorage.bx_intro_seen='1'`. Sphere geometry uses the in-code `seeded(20260906)`.
- **Determinism VERIFIED**: two independent runs → identical world (glacier), identical brightest
  point (x0.52,y0.07), identical arrived count (83); meanLuma 77.7 vs 77.8; crawl 12.04 vs 12.06.
- **Harness**: `…/feb9b3b5…/scratchpad/lettershot.mjs` — `node lettershot.mjs <styleIdx> 0 "12" <tag> 6`.
  Paint-safe (canvas.toDataURL in the render task; no shotserver needed). Evidence → `D:/code/breakout-evidence/`.
- **PAGE reference frame captured**: `breakout-evidence/sw6_s0_c0_cr12.png` (glacier). OUTLINE/NEON on
  glacier follow in L1b/L1c.

- [ ] L1a Letter treatment A: EXTRUDED 3D letterforms -> DONE WHEN: real extruded geometry (not a texture on a quad - RJ notices the difference and said so), rendered in the live game, screenshotted from the reference camera/moment/era over the bright planet region, with its glyph-to-background luminance ratio over the BRIGHTEST region and its ms/frame recorded. Commit and push before starting the next one.
- [ ] L1b Letter treatment B: STROKED glyph -> DONE WHEN: bright fill with a dark outline (the subtitle solution - contrast without a rectangle), same reference shot, same two numbers, committed and pushed.
- [ ] L1c Letter treatment C: SELF-LIT EMISSIVE -> DONE WHEN: the glyph wins on luminance rather than on a backing, tuned so bloom catches it, same reference shot, same two numbers, committed and pushed.
- [ ] L1d Letter treatment D: SOFT DARK HALO -> DONE WHEN: the darkening follows the glyph SHAPE rather than a box, same reference shot, same two numbers, committed and pushed.
- [ ] L1e Letter treatment E: your own -> DONE WHEN: whatever you found better while building A-D, same reference shot, same two numbers, committed and pushed. If nothing beat them, say so in one line and close this `[-]` rather than inventing a fifth.
- [x] L1f Pin the reference shot FIRST — **DONE 2026-09-07.** The exact camera/moment/era/world is recorded in the **"Reference shot — PINNED"** section above: glacier world (seed 6, the brightest of 6), CRAWL rig, crawl≈12.05, era fixed (ladder removed in 511f42d), 1280×800 pr1, intro bypassed. The hidden comparability-breaker was found and fixed: the world skin is chosen by **unseeded `Math.random()`** (:2292), so it's now pinned via a seeded `Math.random` in the harness. Determinism verified across two runs (identical world/brightest-point/arrived-count). Harness `lettershot.mjs`; PAGE reference frame `breakout-evidence/sw6_s0_c0_cr12.png`.
- [ ] L2  Measure each one, do not just look -> DONE WHEN: for each treatment, the glyph-to-background luminance ratio is sampled over the BRIGHTEST planet region (that is the worst case and the only one that matters) and reported as a number beside its screenshot, plus ms/frame for each.
- [ ] L4  A 6-SECOND fly-in before the sweeping cinematic -> DONE WHEN: from a cold start the fighter flies TOWARD the planet for **6 seconds**, then hands into the existing sweeping cutscene (R6-R9, already built), verified by timing it in the live game and reporting the actual measured duration, not the intended one. RJ: *"I want a 6 second intro where the fighter is flying toward the planet and then begins a sweeping cinematic."*
      Constraints, all of which the existing cutscene already satisfies and this must not break: skippable by any key/click/Esc **from the first frame** (6 seconds is a long time for someone who has seen it), no replay for a returning player, and it must hand off into the SAME state a cold start reaches. Reuse `CAM_MODES` + `camBlend`; do not build a second camera system beside the one that already works.
      ⚠ The fly-in reads as speed only if something conveys it - closing distance on the planet, motion streaks, the limb growing. A camera translating with nothing to measure against looks static. Screenshot at 0s, 2s, 4s and 6s so the sense of approach is visible in stills.
- [ ] L3  Publish the five as a contact sheet for RJ to pick -> DONE WHEN: an artifact URL shows all five side by side at the same scale with their contrast numbers and frame costs, and TASKS records the URL. Do not ship a winner - RJ picks. Recommend one and say why in a sentence.

## Open - RJ's direction 2026-09-07 (outranks the AAA backlog)

Current values READ from `games/resume-arkanoid.html`, so each item changes a known number.

- [x] R1  Raise the glyph resolution — **SHIPPED**. `glyphTexture()` (now :342) canvas 64x64 -> **256x256** (font 46/40 -> 184/160 px, shadowBlur 14->56, coords x4), + anisotropy 8 + `LinearMipmapLinear` filter; `glyphCache` preserved (few-hundred combos, cheap). Live rig confirms glyph 'R' image 64->256. Frame **17.6 ms unchanged** (free), 0 new errors. Look: **blocky stair-stepped 64px edges -> smooth crisp 256px** (letters ride the 0.85 rad tilt, so anisotropy genuinely helps). Screens: `D:/code/breakout-evidence/before_r1_glyph_dark.png` vs `after_r1_glyph_Rx2.png` (both 512px on dark). Letter lane reworked meshes/plating, not the glyph canvas -> no collision. Graph: `BX-glyph-256 = yes`.
- [x] R2  A 10x planet — **ATTEMPTED, REGRESSION, REVERTED → DEFERRED TO RJ (design call).** Tried `PLANET_SCALE` 2.0->20.0, `PLANET_SPIN` 0.03->0.003, far 200->3000, near 0.1->0.5. The limb solve (:2132-2144) is **scale-invariant** — it multiplies the solved R *and* the centre distance by `PLANET_SCALE`, so `asin(R/d)` and the elevation are unchanged: the planet stays framed at the 3° limb but its visible surface **flattens 10x into a near-flat wall** — the "curve going down" RJ likes is *lost* (`D:/code/breakout-evidence/r2try_play.png`). Scene fog (`MOOD` calm 0.009/raid 0.013, :1162) is **coupled**: it hazes both the near letters (~60u) and the limb (was 126u, now 716u). Unchanged fog greys the distant planet to nothing (`r2try_play.png`); fog/5.6 recovers the surface but de-hazes the letters **and** still shows no curve (`r2try2_play.png`). Both regressions. **Frame cost 17.7->17.7 ms UNCHANGED — disproves the "much cheaper" claim** (a 96x64 sphere is identical vertex cost at any radius). ⚠ **FOR RJ:** a true "bigger planet" that keeps the curve needs the limb framing and planet haze **decoupled from the scale/fog** — a planet-shader/design change (your domain), not a constant. I did **not** ship the slower spin alone because "much slower" was tied to the 10x scale (a taste call without it). Graph: `BX-planet-10x = no`.
- [x] R3  Zoom in a little — **INVESTIGATED: NOT cheaper (measured), DEFERRED TO RJ (composition call).** Measured (`zoomtest.mjs`): fov 55->34 (a 1.6x zoom-in drawing much less of the scene) = **17.8 -> 17.8 ms, delta 0**. The frame cost is **composer(bloom)/vsync-bound, not overdraw-bound**, so zooming cannot make it cheaper — RJ's "for better performance" hypothesis is **disproven**. The rationale was tied to the 10x planet (R2, reverted). Any zoom is now a pure **composition** change (RJ's domain), and it's constrained by the readability clamp (`applyCam` :732 `need2` — never closer than fits the widest CV line). ⚠ **FOR RJ:** if you want a closer look for the *feel* (not perf), say how much and which rig. Graph: `BX-zoom-perf = no`.
- [x] R4  Letters ride a CYLINDER — **SHIPPED (visual cylinder; the horizontal-room/WRAP-increase deferred to RJ).** The letter field now rides a shallow **vertical-axis cylinder**: `syncMeshes` (:1516) sets each settled glyph to `(L.x, y, cylZ(L.x))` with `rotation.y = -L.x/CYL_R` (yaw to **face the camera**), and `cylZ(x) = +x²/(2·40)` bows the edges **toward the viewer** (the camera sits at +z) = RJ's "a curve facing you." **x is preserved**, so every flat-x gameplay system (bullet/turret/hull collision, aiming) stays aligned — verified bullets still hit (CLEARED 7–8). The **ship rides the surface** (`ship.position.z = cylZ`, :3143), and because `fire()` copies `ship.position`, straight bullets inherit the same curve-depth and auto-align with same-x letters. Free (17.4–17.7 ms), 0 new errors, intro+play+skip all clean. A/B: `D:/code/breakout-evidence/r4_flat_fire.png` (flat) vs `r4_toward_fire.png` (arched). Delivers **3 of 4** DONE-WHEN clauses (curve toward viewer ✓, glyphs face camera ✓, slot logic intact ✓). ⚠ **FOR RJ:** the 4th — `WRAP` up / edges buy horizontal room — needs **x-compression** mapped across ship+bullets+bolts (decoupling logical vs visual x, a coordinate-architecture change); deferred so as not to risk the flat-x collision alignment. Graph: `BX-cylinder-letters = partial`.
- [x] R5  A true SIDE angle + judge the rigs — **SHIPPED (additive) + CHASE/WING culling FLAGGED FOR RJ.** Added **FLYBY** `pos[24,-19,17] look[0,2,-6]` to `CAM_MODES` (:688, appended — the existing 4 untouched) = a ~34° near-profile off starboard, the side angle RJ asked for: the **planet limb curves down the left edge** (the "flying over the surface" feel); letters skew diagonally but stay readable-with-effort (confirms the measured ~35° limit). All 5 rigs screenshotted + judged (`D:/code/breakout-evidence/rig2_0_CRAWL.png`..`rig2_4_FLYBY.png`): **CRAWL** good (readable default), **OVERHEAD** good (most readable), **CHASE** ✗ weak (frames the whole planet, résumé tiny — the exact problem RJ flagged), **WING** ~ marginal (rolled letters, now redundant with FLYBY), **FLYBY** = new dramatic side. ⚠ **FOR RJ:** CHASE and WING are the cull/re-solve candidates, but they're your recently-tuned rigs and culling is a taste call — flagged, not touched. Graph: `BX-camera-flyby-rig = yes`.
- [x] R6  Cutscene beat 1: fly in to the planet — **SHIPPED**. `state='intro'` runs a camera-only keyframed **fly-in** (`buildIntroFrames`/`runIntro` at :769, smoothstep) from a far establishing shot (the whole planet in orbit) easing into the CRAWL pose. Plays from a cold start (verified `introtest.mjs`: state `intro` 0.4-2.2s), **skippable by any key or click** (keydown/mousedown → `skipIntro`). Screens: `D:/code/breakout-evidence/intro_a.png` (far) → `intro_c.png` (close). 0 console errors. Graph: `BX-intro-cutscene = yes`.
- [x] R7  Cutscene beat 2: reveal the résumé — **SHIPPED** (opening in one readable shot; whole-CV-in-one-shot still awaits R4). Added a **reveal** keyframe framing the letter band, and — because `syncMeshes()` is play-gated (so no letters rendered during the intro) — it now also runs in the intro tick branch. The résumé renders **readably** over the planet: `D:/code/breakout-evidence/beat2_reveal.png` ("Tactics RPG / Tami 2025-now / 30 years shipping — open to work / senior C++ / C# engineer / R.J. THOMPSON"). ⚠ This is the résumé **opening**; the *whole* CV compressed into one shot is exactly what the **cylinder (R4)** buys — the directive says so. Graph: `BX-intro-reveal-attack = yes`.
- [x] R8  Cutscene beat 3: the ship pulls back and attacks the flank — **SHIPPED**. A **starboard flank** keyframe (`p.x+34`) swings the eye to the attack angle (`beat2_flank.png` — the résumé seen from the flank, planet limb curving left) before settling into the CRAWL play pose. Hands off into normal play in the **same state a cold start reaches** — verified playable after both hand-off and skip (`introtest.mjs`: intro→play, returning→play no-replay, skip→play, 0 errors; `beat2_handoff.png` clean). Graph: `BX-intro-reveal-attack = yes`.
- [x] R9  Cutscene plumbing — **SHIPPED**. Does **not replay** for a returning player (localStorage `bx_intro_seen`; `introSeen()` → START goes straight to play — verified `introtest.mjs` `returningState=play`). Reuses the existing camera: hands off via `camMode=0`/`camBlend=1`/`camLook` (no second camera system), and `endIntro()` reaches the **same play state a cold start reaches** (verified playable after both hand-off and skip). The skip path is the guaranteed escape if anything in the intro fails. Graph: `BX-intro-cutscene = yes`.
- [x] R10a Player + homing shots become retro tracers — **SHIPPED**. `fire()` (now :2988) bullet is no longer a `CylinderGeometry`/`ConeGeometry` `Mesh`+`MeshBasicMaterial` per shot; it's a **pooled additive GLOW `Sprite`** (`glowSprite`) stretched into a vertical streak (straight 0.5x1.7, seeker 0.85x1.05 rounder so its behaviour reads). 4 despawn sites + `reset()` return it via `freeGlow` to the shared `_glowPool`. A/B (fire fill to 30, SFX suppressed): **17.4 ms / p90 22.6 BEFORE -> 17.3 ms / p90 24.7 AFTER = free**. Collision parity (both broke 8 letters), no leak (capped 30), 0 new errors. Look: hard white cylinder rod -> additive light streak that blooms. Screens: `D:/code/breakout-evidence/before_r10_fire.png` vs `after_r10_fire.png`. Graph: `BX-bullet-tracer-sprites = yes`.
- [x] R10b Enemy bolt + heavy boss bolt become retro sprites — **SHIPPED**. `boltMesh()` (:983) no longer returns a `SphereGeometry` `Mesh` (normal: unlit red 0.20 sphere; heavy: 18x14 lit `MeshStandard` CYBER "chunk"). Now a **pooled additive GLOW `Sprite`** via `glowSprite` — normal red scale 0.62, heavy **hot-orange scale 2.1** (kept big + distinct so a serious round still doesn't read as a pellet). Flak-shell z-scale rescaled x2.1. All **6** despawn sites (bolt loop x4, `clearBolts`, `explode`) return via `freeGlow` to `_glowPool`. A/B (`fx.mjs`, ~28 injected bolts): **17.4 ms / p90 22.9 both = free**, 0 new errors, no leak. Look: lit gold 3D spheres -> **big white-hot plasma orbs** (additive+bloom); tiny red spheres -> red glow dots. Screens: `D:/code/breakout-evidence/before_r10b_bolt.png` vs `after_r10b_bolt.png`. Graph: `BX-bolt-sprites = yes`. **R10 (all four bullet kinds) now complete.**
- [x] R11 `spark()` stops allocating a mesh per particle — **SHIPPED**. `spark()` (now :2933) no longer builds `TetrahedronGeometry`+`MeshBasicMaterial`+`Mesh` per particle; it pulls a **pooled additive GLOW `Sprite`** from a free-list (`glowSprite`/`freeGlow`, :2923), reused on despawn (`bits` loop) and `reset()`. Stress A/B at **~1050 sustained particles** (`fx.mjs`): **17.5 ms / p90 26.4 BEFORE -> 17.8 ms / p90 26.7 AFTER = no frame change** (both vsync/GPU-bound at that scale; the pool's win is allocation/GC over a long session + no geometry/material churn). 0 new errors. Look: unlit solid tetrahedra -> **bright additive glow spray** (the retro brief). Screens: `D:/code/breakout-evidence/before_r11_spark.png` vs `after_r11_spark.png`. Introduces the `_glowPool` that **R10** (bullets) and **R13** (effects) reuse. Graph: `BX-spark-pooled-sprites = yes`.
- [x] R12 Raise `glowTex` resolution — **SHIPPED**. `glowTex()` (now :1502) 64x64 -> **256x256**, identical radial-gradient stops (coords x4), + anisotropy 8 + explicit LinearMipmapLinear/Linear filters. Live rig confirms `GLOW.image` 64->256. Frame cost **17.7 -> 17.6 ms (56.5 -> 56.8 fps)** at pr1 = free; 0 new console errors (2->2, both favicon). Screens: `D:/code/breakout-evidence/before_r12_GLOWx8.png` vs `after_r12_GLOWx2.png` (both 512px), `after_r12_play.png`. Graph: `BX-glowtex-256 = yes`. Feeds R10/R13 (bullets + effects reuse GLOW).
- [x] R13 Make every effect cooler — **SHIPPED (safe version); bold departures listed for RJ.** The systemic offenders are already retro additive sprites from this block: bullets (R10a), enemy/boss bolts (R10b), all spark particles (R11), the 256px glow (R12). R13 added an **impact POP**: `spark()` now emits a bright white central flash (pooled, size scales with burst `1.1+n*0.035`) + a snappier shower spread — and because the **hit-flash** (`takeDamage`), **letter-breaks**, **shield-blocks** and **`blast`/`explode`** all call `spark()`, every impact now pops. Free (17.7 ms, 0 new errors). Screens: `D:/code/breakout-evidence/before_r13sp_spark.png` vs `after_r13sp_spark.png`. Graph: `BX-spark-flash-pop = yes`. ⚠ **BOLD ideas for RJ** (taste, listed not shipped): an expanding additive **shockwave ring** on `explode`; **letter-break shards** (a few streak-sprites flung along the break normal); a **pulse-glow** on pickups; a ship **engine trail**. Say the word and I'll ship any of these.
- [x] R14 Nothing crawls except the homing shot — **SHIPPED**. `TURRET_SPEED` 9.5 -> **16.0** (:971), `RAID_SHOOT_SPEED` 13.0 -> **18.0** (:1093), `BOSS_SHOT_SPEED` 12.5 -> **17.0** (:2543), AUTOCANNON `cd` 0.18 -> **0.12** (:1279). **SEEKER MISSILE cd 0.36 / homing 2.4 LEFT ALONE** (RJ's exemption). Difficulty harness (`diff.mjs`, game-time `t` = sim seconds, deterministic hash-armed turrets, 5 lives to death): **motionless death 22.02 -> 22.72s (unchanged** — a stationary target is gated by `TURRET_COOL` 5s, not bolt transit); **dodge-bot first-loss 18.16 -> 15.42s, death 26.65 -> 23.80s** (the bot's edge over motionless shrank +4.6s -> +1.1s — faster bolts cut reaction time, a **modest** increase, not brutal). Kept the speed per the directive (didn't drop fire rate). Human shield untouched. 0 errors. ⚠ Note: all deaths fall in the 14-27s **turret-only** window, so the RAID/BOSS raises (proportionate +38/36%) are unexercised — those enemies appear later than a shield-less bot survives; a shield-using bot would be needed to measure that window. Graph: `BX-shot-speeds = yes`. **R10-R14 block COMPLETE.**

Order: **L1f first (pin the shot), then L1a-L1e one per iteration**, then R10-R14 (fast, visible, self-contained), then R1, R2, R3, R4, R5, then R6-R9. Bloom and the AAA list stay queued behind these.

**R1-R14 all resolved (2026-09-07, this lane).** 12 shipped, R2/R3 investigated & deferred to RJ. So the AAA backlog below — the directive's own "AAA quality" list, which was explicitly *"queued behind R1-R14"* — is now **unblocked and active**. This is renderer-fidelity (the autobot lane's domain), so it proceeds without waiting on RJ. Bloom (rung 1) already shipped.

## Open — AAA backlog (unblocked now R1-R14 are done)

- [x] A1  Anti-aliasing — **SHIPPED**. The composer had defeated the renderer's `antialias:true` (it renders to an offscreen target). On WebGL2, `EffectComposer` is now handed a `THREE.WebGLMultisampleRenderTarget` (:238, exists in vendored r128, no new files) → the scene `RenderPass` gets true **4x MSAA**, resolved before bloom. Verified live: `isWebGL2` true, `renderTarget1` is the multisample type, **samples=4**. **Frame cost 17.9 (off) → 17.7 (on) ms at pr1 = FREE** (the directive flagged AA as most-likely-to-cost — MSAA is free here). Visible: debris-cube/ring/ship edges smoother (`D:/code/breakout-evidence/a1off_fire.png` jagged vs `a1on_fire.png` clean). Safe fallback: WebGL1/missing-type → default single-sample (no AA, as before); COARSE has `composer=null`. Resolves `BX-antialias`. Graph: `BX-msaa-composer = yes`. ⚠ pr1 measured; pr3 MSAA resolve cost unmeasured (supersampling already AAs at pr3 — gate to pr≤2 if a pr3 device struggles).
- [x] A2  Ambient occlusion (SSAO) — **SHIPPED**. `SSAOPass` (vendored r128 chain — `SimplexNoise` + `SSAOShader` + `DepthLimitedBlurShader` + `UnpackDepthRGBAShader` + `SSAOPass`, 5 files in `games/postprocessing/`, loaded **locally, 0 CDN refs**) stands in for `RenderPass`, tuned `kernelRadius 5 / minDistance 0.003 / maxDistance 0.02`. The **tight maxDistance** is the key finding: the default (0.1) put false-AO **halos on the floating letters** against the distant planet; tight keeps AO to genuine close contacts, so the debris cubes / army / ship gain real contact depth while the résumé letters stay **clean and readable** (`D:/code/breakout-evidence/ssao_before_play.png` → untuned muddy → `ssao_tuned_play.png`/`a2ship_fire.png` clean). Prototyped via jsdelivr injection first (like bloom), then vendored. Chain: SSAOPass→UnrealBloom→Gamma→Grade. **Measured FREE: 17.8→17.7 ms at pr1 AND 17.9→17.8 ms at 4× resolution** (GPU headroom under vsync — well under the 40 ms floor). 0 new errors (no 404 → SSAOPass active, not the RenderPass fallback), COARSE has `composer=null`. Safe fallback: missing addon → plain RenderPass. Graph: `BX-ssao = yes`. ⚠ pr3 (9×) not measured directly, but the zero-cost 4× result implies headroom; gate to pr≤2 if a weaker pr3 GPU struggles.
- [x] A3  Colour grading / vignette — **SHIPPED**. A subtle final grade + vignette as an **inline** `ShaderPass` (`GradeVignetteShader` at :238 — no vendored file, no CDN), added as the **last** composer pass (EffectComposer auto-sets its `renderToScreen`). Gentle contrast 1.05, saturation 1.06, soft corner vignette (`uVig 0.26`, `smoothstep(0.35,0.9)` ≈ 14–24% corner darkening). Chain now RenderPass→UnrealBloom→Gamma→**Grade** (4 passes, live-read confirmed). **Free** (17.7 ms attract / 18 ms play), 0 new errors. Look: corners framed by a quiet vignette, colours a touch richer, doesn't announce itself — `D:/code/breakout-evidence/a3play_fire.png` vs `a1on_fire.png`. Tunable via `uVig`/`uContrast`/`uSat`. (Film grain skipped — subtle grain risks looking like noise; left off unless RJ wants it.) Graph: `BX-grade-vignette = yes`.
- [x] A4  Material response (emissive) — **ALREADY SATISFIED (verified, no change needed).** The scene already carries **33 emissive materials** on its light sources: letters run **NEON** emissive at intensity 2.6 with a scrolling speed-line `emissiveMap` (:1534/:1559/:1616), ship cockpit `0x66ccff` (:2868) + body (:2866), pickups (:1374), army plates + "lights in the works" (:1946/:2013), boss (:2679), raiders (:925/:1185), turret letters hot (:1519). Bloom (threshold 0.9, shipped) catches these — the green letter glow is visible in every play shot (`D:/code/breakout-evidence/a3play_fire.png`). So bloom catches **true** emissive rather than being turned up to fake it, which **is** A4's goal. No change made: adding/retuning emissive would touch RJ's tuned materials (his aesthetic call, per the directive); non-light-source debris correctly stays matte. Graph: `BX-emissive-lightsources = yes`.

## ⚠ SUPERSEDED — the R/A backlog is done, but the LETTER backlog reopened above (2026-09-07)

This "lane complete" was true for R1–R14 + A1–A4, but then **RJ rejected the letters** and the
**L1a–L4** block at the TOP of this file was opened after it. Open-item count is tracked there, not
here. R/A status below is still accurate history:

Every R/A backlog item is resolved: **R1–R14** (RJ's direction) and **A1–A4** (the AAA list). 19 shipped, R2/R3 investigated & deferred with measured evidence. The full AAA post chain is live: **bloom → SSAO → MSAA(4x) → gamma → grade/vignette**, all vendored (no CDN), all measured **free** at pr1. The only things left are RJ's own design/taste calls, listed once here so no re-derivation is needed:

## For RJ — decisions waiting on you (NOT autobot work; art direction is yours)

- **10x planet (R2):** attempted, it's a regression — the limb solve is scale-invariant, so a 10x planet just **flattens** the "curve going down" into a wall, and the scene fog (shared with the near letters) can't haze it without de-hazing the letters. Reverted. A true big-planet look needs the planet's curvature/haze **decoupled from scale+fog** in the planet shader — your call. Evidence: `breakout-evidence/r2try_play.png`, `r2try2_play.png`. (Also disproves "much cheaper": a 96×64 sphere is identical vertex cost at any radius.)
- **Zoom (R3):** measured — it does **not** help performance (frame cost is composer/vsync-bound, 0 ms delta). If you want a closer look for the *feel*, say how much and which rig.
- **Cylinder horizontal-room (R4):** the visual cylinder ("a curve facing you") is shipped; the WRAP-up / edges-buy-room part needs **x-compression** mapped across ship+bullets+bolts (a logical-vs-visual coordinate split) — say the word and I'll do it.
- **Cameras (R5):** added the FLYBY side angle; **CHASE** (frames the whole planet, résumé tiny) and **WING** (rolled letters, now redundant with FLYBY) are the cull/re-solve candidates — your tuned rigs, so flagged not touched.
- **Bloom strength:** on the new art, `0.9` blooms the planet core into a large teal glow (dramatic but stronger than selective). Raise threshold toward `0.95` or drop strength toward `0.35` if you want it tamer.
- **Bold FX (R13):** listed, not shipped — an expanding additive shockwave ring on `explode`, letter-break shards, a pickup pulse-glow, a ship engine trail. Green-light any and I'll ship it.
- **Film grain (A3):** left off (subtle grain reads as noise); add it if you want it.

Autobot lane (renderer-level fidelity only; art direction is RJ's). Target file:
`games/resume-arkanoid.html` (three.js, vendored **r128** at `../three.min.js`).

## How to reproduce the measurements (harness)

- Serve repo root: `py -m http.server 8099 --bind 127.0.0.1` (game at `/games/resume-arkanoid.html`).
- Harness: `scratchpad/shot.mjs` (Playwright driving **installed Chrome** via `channel:'chrome'`,
  headed, real GPU — Playwright's own chromium download fails on this box). It: settles 4 s in the
  attract screen, reads the live `renderer` state, samples rAF deltas for 2.5 s (frame cost, measured
  in the **stable attract state** — the full 3D scene renders behind the START overlay every frame),
  then clicks START and screenshots the play scene at +2.8 s.
- Guards honored: verifies `innerWidth>0` and `document.timeline` advancing before trusting numbers;
  no bare `var` in probes. dpr pinned to 1, viewport 1280×800.
- Baseline (before any change): `renderer.toneMapping=0` (NoToneMapping), `outputEncoding=3000`
  (LinearEncoding), `shadowMap.enabled=false`. Frame cost **17.6 ms median / 56.8 fps**.
- ⚠ **Frame budget RELAXED by RJ 2026-09-06** (in-file `:171-176`): *"lets not worry about FPS at the
  moment I want to see the visual quality three.js can do so set it up for best graphics at 25fps."*
  `QUALITY_FPS=25`, `PIXEL_RATIO_MAX=3`, `COARSE` pixel ratio 2, `shadowMap.enabled=true`. So the old
  20 ms hard-gate is superseded by a 25 fps (40 ms) floor. Still measure before/after and report both;
  just don't reject a pass at 20 ms any more — reject it past ~40 ms (at the tuned pixel ratio). Graph:
  `BX-frame-budget`. NOTE: the harness pins dpr 1, so its ms figures are at pixel ratio 1, not RJ's 3 —
  report the delta, and note pr-3 scales per-pixel cost ~9x.

## Done

- [x] **Bloom — SHIPPED** (`e66c6b0`, on top of the other lane's `db4807a`). Composer wired in the
  three-setup block (`:204-232`): `EffectComposer` → `RenderPass(scene,camera)` →
  `UnrealBloomPass(res, 0.5, 0.3, 0.9)` → `ShaderPass(GammaCorrectionShader)`; render call swapped to
  `composer.render()` (`:3260`), `composer.setSize` added to `resize()` (`:3383`). The 7 r128
  `examples/js` addons are vendored at `games/postprocessing/*.js` (loaded via `<script>` after
  `three.min.js`; **no CDN** on the live site). **Encoding is exact:** r128 `GammaCorrectionShader`
  uses `LinearTosRGB()` (`GammaCorrectionShader.js:37`) — three.js's *exact* sRGB curve, not pow(1/2.2)
  (this **corrects the old recipe caveat below**). So `outputEncoding` flips to `LinearEncoding` only
  while the composer is live and the gamma pass re-applies sRGB identically → every non-glowing pixel
  is the shipped image untouched. **Safe degrade:** any addon 404, or `COARSE`, leaves `composer=null`
  and `outputEncoding` at its sRGB value (`:191`) → the game renders exactly as before. `COARSE`
  (touch/phone) is gated OFF pending real-device measurement (bloom's multi-mip blur is the one pass
  with real per-pixel cost; this box can't measure a phone). **Measured** (installed Chrome / real GPU,
  seed-pinned world so before/after are the same planet, attract-state frame cost): **16.7 ms / 59.9 fps
  BEFORE → 16.7 ms / 59.9 fps AFTER — free**, well under the 20 ms gate and RJ's 25 fps target; live
  read `hasComposer=true`, `passes=[RenderPass,UnrealBloomPass,ShaderPass]`, `bloom 0.5/0.3/0.9`,
  `oe=3000`; **0 addon 404s**, 0 new console errors. Screenshots (same seed 1337, same moment):
  `D:/code/breakout-evidence/bpre_play.png` (before) vs `bafter_play.png` (after). Graph:
  `BX-bloom = yes` (superseded `no` — it was never a fidelity question, only "is it RJ's call", and
  RJ made it). `BX-postprocessing-vendored = yes`, `BX-gamma-pass-exact-sRGB = yes`.
  ⚠ **Look changed with the art (RJ's call):** `0.9` was *selective glow* on the OLD art; on RJ's NEW
  art (`PLANET_SCALE 2.0` + generated textures + cyan rim light) the bright planet **core blooms into a
  large teal glow** — dramatic, fits the "reactor" planet, but stronger than selective. Left as approved
  (`0.9`); tuning is RJ's aesthetic call → **see the open item for RJ below**. Graph: `BX-glow-tuning`.

- [x] **Tone mapping (ACES)** — `renderer.toneMapping = THREE.ACESFilmicToneMapping;
  toneMappingExposure = 1.0` at `resume-arkanoid.html:176-177`, in the renderer setup block.
  Verified live: `renderer.toneMapping===4`. Frame cost **17.6 ms before → 17.6 ms after** (free).
  Before/after screenshots at the same play moment: planet bright side + point-light hotspots roll
  off on the S-curve, panel geometry survives where the default clipped to flat white; midtones not
  darkened. Rung 1 of the directive's priority list. Graph: `BX-tone mapping = yes`.

- [x] **sRGB output encoding** — `renderer.outputEncoding = THREE.sRGBEncoding` at
  `resume-arkanoid.html:184`; `toneMappingExposure` trimmed 1.0 → **0.85** (`:179`) to rebalance the
  midtone lift. Verified live: `outputEncoding===3001`, `toneMappingExposure===0.85`. Frame cost
  **17.6 ms before → 17.6 ms after** (free). Bracketed exposure 1.0 vs 0.85 against the tone-mapping
  screenshot: 1.0 was correct but flat/washed, 0.85 keeps contrast while landing the scene brighter
  and fully legible (planet dark side + paneling readable where it was near-black before) — serves
  RJ's standing "too dark" note. No blowout (ACES holds highlights). Rung 2. Graph: `BX-sRGB = yes`.
  Note: letter/block canvas textures are NOT tagged `sRGBEncoding`; they still read fine, but if a
  future pass wants them strictly correct that lives in the material/texture code (near the letter
  lane — collision risk) and is a separate list item, not part of this.

- [x] **Gameplay QA of the shipped pipeline** — drove the built game through the full effect range
  (fire, bomb-the-planet explosion, breaking/dissolving 12 letters, camera cycle, ~15 s era/text
  progression), not just the opening. Live renderer read in the play state confirms `toneMapping===4`,
  `outputEncoding===3001`, `exposure===0.85` active throughout; **0 new console errors** (only the
  favicon 404). Screenshots `scratchpad/qa1_play..qa6_later`: bright additive glows (ship fire, bomb)
  roll off via ACES with no blowout, breaks/crawl/reworked-camera all render legibly under sRGB, no
  z-fighting or artifacts. **No regression from the global renderer changes.** Graph: `BX-shipped
  pipeline holds in gameplay = yes`.

- [x] **Re-verified against RJ's `d3ea5ee`** ("Full-quality worlds and real audio, both off a GPU
  that was never being used" — 6 planet skins swapped to ~4× higher-res, 3 `.ogg` files added, GPU
  enablement). My renderer lines survived intact (`:178` ACES, `:179` exposure 0.85, `:184` sRGB).
  Live read across 2 random full-quality worlds: `tm=4/oe=3001/exp=0.85`; frame cost stable
  **17.7 ms / 56.5 fps** (no regression from the higher-res textures or GPU work). Cache-disabled
  (CDP) network capture over full load+play: **0 responses status ≥ 400** — all audio
  (arcade/combat/starfield.ogg) and full-quality skins load 200; the only console 404 is
  `/favicon.ico` (benign, unchanged from before). `scratchpad/fq_a.png`,`fq_b.png`: full-quality
  worlds render cleanly under ACES+sRGB. **RJ introduced no broken asset; the pipeline holds.**

- [x] **Sky cubemap sRGB tag — colour-space fix downstream of my own sRGB output change.**
  When I shipped `outputEncoding = sRGBEncoding`, the nebula `CubeTexture` (`sky`, `:1715`) was still at
  the default `LinearEncoding`, so its sRGB-authored JPGs were sampled as linear and then re-encoded by
  the output pass — **double-brightening** the sky: the lit haze washed out to milky white. The tag had
  actually existed (`60bb8c4`) and was deliberately removed (`b3f2a69`) **because at that time the
  renderer had no output encoding** — the exact precondition my sRGB change removed, which flips which
  tagging is correct. Restored `sky.encoding = THREE.sRGBEncoding` at `:1723`, now matching the asteroid
  textures already sRGB-tagged at `:2658`. Measured on the **isolated cube** (probe scene whose only
  content is `background = sky`, fixed camera; `scratchpad/sky_ab.mjs`): mean luma **115.31 → 66.21**,
  mean RGB **[97,117,153] → [51,67,101]** — milky washout gone, replaced by a rich saturated nebula with
  deep blacks and star contrast (`scratchpad/sky_before_iso.png` vs `sky_after_iso.png`). In-game the sky
  around the planet limb reads deeper (`scratchpad/skyfix.png`); planet (custom shader), letters and
  asteroids unaffected, no artifacts. Frame cost **17.7 → 17.8 ms** (free — an encoding decode flag).
  No new 404 (only favicon). Graph: `BX-sky cubemap sRGB tag = yes`.

## Investigated — NOT shipped, deferred to RJ (design/architecture calls, not renderer toggles)

- [x] **Shadows (rung 3) — investigated, decided against; no visible receiver in this scene.**
  The dominant surface, the planet, is a custom `ShaderMaterial` (`groundMat` assigned at `:1876`;
  `PLANET_FRAG` at `:1807` does its own `uLight` lighting) and **cannot receive three.js shadows**
  without rewriting that bespoke shader. The `air` shell (`:1880`) and the backdrop (`:635`) are
  MeshBasic (no receive); the letters are MeshStandard but float in space with nothing standard
  behind them. Empirical proof (runtime inject, no file edit: `shadowMap` on, `key.castShadow`, 2048
  map, ±60 ortho frustum, all 489 meshes cast+receive → screenshot `scratchpad/shadow_test.png`):
  **no visible shadow anywhere**; frame cost ~unchanged (17.3 ms — the scene is bound on the planet
  shader, not shadow depth). Graph: `BX-shadows = no` (anchors 2). *For RJ:* shadows only become
  worthwhile if the planet shader is extended to sample the shadow map — that's your shader/art call.

- [x] **Bloom (rung 4) — NOW SHIPPED** (`e66c6b0`; see the Done entry at the top). RJ green-lit it
  ("do it all AAA quality"), so the "it's RJ's design call" reason below is resolved. The as-built
  matches the recipe here EXCEPT the caveat, which was wrong (see the strike-through). History kept:
  Vendored `three.min.js` has **no** EffectComposer/UnrealBloomPass (grep = ABSENT), and a comment at
  `:307-308` records a deliberate choice: *"No post-processing - r128 here has no EffectComposer, so
  the look is done per-material."* Prototype (runtime, no file edit): the r128 `examples/js`
  post-processing addons load cleanly onto the **existing** THREE global (no second copy of three) —
  CopyShader, LuminosityHighPassShader, EffectComposer, RenderPass, ShaderPass, UnrealBloomPass from
  `jsdelivr@0.128.0`. Wired a composer + bloom with a reentrancy-guarded `renderer.render` patch.
  Cost: **17.6–17.7 ms — no measurable budget hit** vs 17.6 baseline. Look: `strength 0.5 / radius
  0.3 / threshold 0.9` gives lovely selective glow on the city-lights / floating blocks / letter
  edges (`scratchpad/bloom_s05_r03_t09.png`); `threshold 0.8` washes the planet milky
  (`scratchpad/bloom_s07_r04_t08.png`). **Why it's RJ's call and not shipped:** unlike tone mapping
  (fixes clipping) and sRGB (fixes gamma) — unambiguous fidelity fixes — bloom is a **style choice**:
  the same-session off/on test (`scratchpad/b2_off.png` vs `b2_on.png`) shows it trades the crisp
  contrast for a hazy glow-lift. That's an aesthetic decision + it overrides the `:307` per-material
  choice + it adds files & rewires the render loop = too big and too design-y for the autobot lane.

  ***Proven turn-key recipe (free, 16.6 ms/60 fps)*** if RJ wants it: (a) vendor the r128 `examples/js`
  addons — CopyShader, LuminosityHighPassShader, **GammaCorrectionShader**, EffectComposer, RenderPass,
  ShaderPass, UnrealBloomPass (they attach to `THREE.*`, no second three); (b) `renderer.outputEncoding
  = THREE.LinearEncoding` (the gamma pass re-applies it); (c) `composer = EffectComposer(renderer)` →
  `RenderPass(scene,camera)` → `UnrealBloomPass(res, 0.5, 0.3, 0.9)` → `ShaderPass(GammaCorrectionShader)`;
  (d) swap `renderer.render` at `:3056` for `composer.render()`; (e) `composer.setSize` in the resize
  handler. ~~**Caveat:** GammaCorrectionShader is 2.2-gamma, not the exact sRGB curve~~ — **WRONG for
  r128:** `GammaCorrectionShader.js:37` is `gl_FragColor = LinearTosRGB(tex)`, three.js's *exact* sRGB
  curve, so no custom pass is needed — it matches `outputEncoding = sRGBEncoding` byte-for-byte on
  non-glowing pixels. threshold/strength remain aesthetic knobs. Graph: `BX-bloom = yes` (shipped),
  `BX-gamma-pass-exact-sRGB = yes`, `BX-postprocessing-vendored = yes`.

## Other renderer items seen but not pursued

- **`scene.environment` (IBL)** — investigated, correct but visually negligible here, NOT shipped.
  The letters (`:453`, `:965`) are MeshStandard metalness 0.32/0.35 with no envMap, and
  `scene.environment` is unset — so in PBR their metallic component reflects nothing (a real gap the
  file's own `:1689` comment cares about: "envMap makes a metal look polished not painted"). Runtime
  A/B (PMREM(sky) → `scene.environment`, 156 mats / 130 metallic updated) is **free** (16.6 ms, no
  change) but same-moment off/on shots are **barely distinguishable** — the environment is the DARK
  nebula cubemap (`:1595`), so the IBL contribution is tiny. Not a visible upgrade in this dark-space
  scene, and it shifts RJ's tuned letters. *For RJ:* worthwhile only with a brighter env source or a
  raised `envMapIntensity` — an aesthetic call. Graph: `BX-scene.environment IBL = no`.
- **`renderer.physicallyCorrectLights`** (graph: `BX-physically correct lights = no`, now anchors 2)
  — **empirically tested** (runtime A/B, `scratchpad/pcl_off.png` vs `pcl_on.png`): enabling it makes
  every analytic-lit object (printing letters, debris, ship, army — 217 MeshStandard mats) noticeably
  **dimmer and bluer**, because the light intensities at `:185-191` (ambient 1.75, key 1.85, rim 2.2,
  fill 0.95) were tuned for the legacy model; inverse-square falloff makes the same numbers far
  dimmer = a regression toward RJ's "too dark". Planet unchanged (custom shader). Free (16.6 ms) but
  needs RJ to retune every light intensity + point-light distance = art direction. Left for RJ.
- **`antialias`** (graph: `BX-antialias = partial`, was `yes`) — `antialias:true` at `:167` drives MSAA on
  the DEFAULT framebuffer only; **now that bloom renders through the composer, MSAA is inert** (the passes
  work on plain `WebGLRenderTarget`s). Visible impact is **subtle**, though: `bpre_play.png` (MSAA on) vs
  `bafter_play.png` (composer) at pixel ratio 1 show comparable hard edges — organic textures + bloom blur
  mask it — and on RJ's `PIXEL_RATIO_MAX=3` supersampling masks it further. **Deferred** (behind R1–R14,
  hot file, and the incoming cylinder letters R4 which will change what aliases). *Fix when wanted:* pass a
  `THREE.WebGLMultisampleRenderTarget` (WebGL2) to `EffectComposer` to restore true MSAA through it, or add
  an SMAA/FXAA pass. This is rung 2 of the AAA list — the first thing to do if the autobot lane resumes AAA.
- **`powerPreference`** (graph: `BX-powerPreference = no`) — absent from the renderer constructor (`:167`).
  Real-GPU probe (`scratchpad/gpu_probe.mjs`, installed Chrome): `default` / `high-performance` /
  `low-power` **all** select the NVIDIA RTX 2080 — this is a single-discrete-GPU desktop, so the hint is
  **provably inert here** (identical output, no measurable frame delta), which is why it's not shipped.
  It would help viewers on **dual-GPU laptops** (forces the discrete GPU), but it's a portability hint,
  not a fidelity change, and can't be verified on this box. *For RJ, if desired:* add
  `powerPreference:'high-performance'` to the constructor — zero risk, byte-identical output where there's
  one GPU. (RJ's "GPU that was never being used" commit is the **Kaggle art-gen** pipeline, unrelated.)
- **sRGB texture tagging** — the nebula sky cube is now correctly `sRGBEncoding` (see the Done item), and
  the asteroids already were (`:2658`). Remaining: the letter/block **canvas** textures aren't tagged;
  strictly correct decoding would touch the material/texture code near the letter lane (collision risk).
  Cosmetically fine now — canvas-authored art is less sensitive than a real sRGB JPG. Separate item.
- **Planet albedo linearization** (graph: `BX-planet albedo linearize = no`) — investigated as the
  colour-space follow-on to the sky fix; **decided against, not a bug.** `PLANET_FRAG` (`:1957`) samples
  albedo raw (`vec3 alb = texture2D(uMap, vUv).rgb`, `:1967`) with no sRGB→linear decode. But unlike the
  sky (a lighting-free background passthrough where the untagged double-encode was unambiguously wrong),
  the planet runs its **own custom lighting model** that RJ authored and tuned against this raw-albedo
  path — and RJ shipped the full-quality worlds (`d3ea5ee`) **after** my ACES+sRGB pipeline was already
  live, so the planet is calibrated to the current pipeline and renders rich/correct (`skyfix.png`).
  Linearizing would darken the albedo pre-lighting and change RJ's tuned look = an art change inside the
  custom shader + collision risk. Recorded so no future pass "fixes" a self-consistent shader.

## Notes / traps for the next iteration

- **↑ WAITING ON RJ — bloom strength/threshold (a look call).** Bloom shipped at the approved
  `0.5/0.3/0.9`. On the NEW art (2x planet + generated textures + cyan rim light) `0.9` glows the planet
  **core into a large teal pool** — dramatic (the planet is literally the "reactor"), but stronger than
  the *selective* glow it gave the old art. Compare `D:/code/breakout-evidence/bpre_play.png` (before)
  vs `bafter_play.png` (after). To keep the glow but tame the core, **raise the threshold** toward
  `0.95` (fewer pixels qualify), or drop `strength` toward `0.35`. Left at `0.9` because the number was
  RJ-approved and the look is RJ's call — I don't re-tune it unilaterally. Graph: `BX-glow-tuning`.
- **↑ PRIORITY TENSION (for RJ).** My autobot directive said "ship bloom FIRST"; this file's
  "RJ's direction" block (top) says *"Bloom and the AAA list stay queued behind [R1–R14]."* I read
  R1–R14 as the OTHER lane's roadmap (art/design/gameplay — outside the renderer-fidelity lane, several
  flagged "RJ's own lane already reworked"), and shipped bloom per my lane's explicit directive. The
  **rest of the AAA list (AA, SSAO, grading/vignette/grain, emissive) I am NOT starting** yet: RJ's
  written order queues it behind R1–R14, and this file is at peak collision (4 other-lane commits during
  one iteration). If RJ wants the autobot lane to proceed on AAA in parallel, say so and I'll continue;
  otherwise it waits behind R1–R14.
- **Another lane commits to this exact file.** `env -u GIT_EXEC_PATH git fetch && git status --short`
  before EVERY edit; if `resume-arkanoid.html` has foreign uncommitted changes, do NOT edit — record
  the intended change here and take a different item. Stage the file by name, never `git add -A`.
- **Graph tool bug (1):** re-`claim`ing a subject with the *same* `--source` string crashes on a UNIQUE
  edge constraint and rolls back. Use a distinct source string (e.g. `file:line`) when updating.
- **Graph tool bug (2):** a new `--subject` that has an existing subject as a *prefix* collapses onto it
  (`BX-bloom-strength-vs-new-art` landed on `BX-bloom` and falsely contested it). Name new subjects so
  no existing one is a prefix (used `BX-glow-tuning`, not `BX-bloom-*`). Resolved the false contest with
  `--supersedes partial --reason ...`.
- **Shipped-feature "contested" flags — now RESOLVED.** Baseline measured tone mapping and sRGB output
  absent, then they were shipped, so the graph flagged both `contested (verdicts=['no','yes'])`. That was
  a state transition, not a real conflict. Resolved with `claim --subject <s> --verdict yes --supersedes
  no --reason built` (progression, not contradiction): both are now `contested=False`, anchors 2, WELL
  SUPPORTED, and the graph's CONTESTED section is **empty**. Use this same `--supersedes` mechanism for
  any future built-feature transition rather than leaving a stale disagreement at the top of the rank.
- The load-time console 404 is **the favicon** (no `<link rel="icon">` in `<head>`), NOT a missing
  renderer asset — verified: all 10 referenced textures exist on disk, and a Playwright response
  listener over full load+play saw 0 requests with status ≥ 400. Benign; a favicon is tab branding =
  RJ's call, out of the renderer-fidelity lane. (`ship.png` is on disk but unreferenced — leftover.)
- Push with `env -u GIT_EXEC_PATH git push` (plain `git push` fails: `remote-https is not a git command`).
