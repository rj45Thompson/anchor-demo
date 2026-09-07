# Résumé Breakout — graphics upgrade backlog

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

## Done

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

- [x] **Bloom (rung 4) — investigated, feasible + affordable + looks good, but it's a design change.**
  Vendored `three.min.js` has **no** EffectComposer/UnrealBloomPass (grep = ABSENT), and a comment at
  `:307-308` records a deliberate choice: *"No post-processing - r128 here has no EffectComposer, so
  the look is done per-material."* Prototype (runtime, no file edit): the r128 `examples/js`
  post-processing addons load cleanly onto the **existing** THREE global (no second copy of three) —
  CopyShader, LuminosityHighPassShader, EffectComposer, RenderPass, ShaderPass, UnrealBloomPass from
  `jsdelivr@0.128.0`. Wired a composer + bloom with a reentrancy-guarded `renderer.render` patch.
  Cost: **17.6–17.7 ms — no measurable budget hit** vs 17.6 baseline. Look: `strength 0.5 / radius
  0.3 / threshold 0.9` gives lovely selective glow on the city-lights / floating blocks / letter
  edges (`scratchpad/bloom_s05_r03_t09.png`); `threshold 0.8` washes the planet milky
  (`scratchpad/bloom_s07_r04_t08.png`). *For RJ, if you want it:* (a) vendor those 6 addon files
  (they attach to `THREE.*`), (b) build the composer in the renderer block, (c) swap `renderer.render`
  at `:3056` for `composer.render()`, (d) drive `composer.setSize` from the resize handler, (e) add a
  final sRGB **output pass** — the composer's intermediate targets are Linear, so `outputEncoding`
  is not applied through it (the prototype shows a slight brightness lift from this). It overrides the
  `:307` per-material-glow decision, and the glow amount is your aesthetic call. Graph: `BX-bloom = no`
  (anchors 2, feasibility recorded).

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
- **`renderer.physicallyCorrectLights`** (graph: `BX-physically correct lights = no`) — changes light
  falloff to inverse-square; every existing light intensity/distance was tuned WITHOUT it, so turning
  it on would need all of RJ's light numbers retuned. Disruptive, art-adjacent — leave for RJ.
- **sRGB texture tagging** — the letter/block canvas textures aren't tagged `sRGBEncoding`; strictly
  correct decoding would touch the material/texture code near the letter lane. Cosmetically fine now.

## Notes / traps for the next iteration

- **Another lane commits to this exact file.** `env -u GIT_EXEC_PATH git fetch && git status --short`
  before EVERY edit; if `resume-arkanoid.html` has foreign uncommitted changes, do NOT edit — record
  the intended change here and take a different item. Stage the file by name, never `git add -A`.
- **Graph tool bug:** re-`claim`ing a subject with the *same* `--source` string crashes on a UNIQUE
  edge constraint and rolls back. Use a distinct source string (e.g. `file:line`) when updating.
- **Shipped features read as `contested`** in the graph (baseline measured them absent, then they
  were shipped). That is a state transition, not a real conflict — do not re-investigate; follow this
  list's priority order.
- Pre-existing: one console 404 on load (a missing resource, not from this work).
- Push with `env -u GIT_EXEC_PATH git push` (plain `git push` fails: `remote-https is not a git command`).
