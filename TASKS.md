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
  handler. **Caveat:** GammaCorrectionShader is 2.2-gamma, not the exact sRGB curve — for an exact
  colour match write a tiny sRGB-encode pass instead; threshold/strength are aesthetic knobs.
  Graph: `BX-bloom = no` (anchors 3, recipe recorded).

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
- **`antialias`** (graph: `BX-antialias = yes`) — already enabled: `WebGLRenderer({canvas, antialias:true,
  alpha:false})` at `:167`. MSAA is on; nothing to do.
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

- **Another lane commits to this exact file.** `env -u GIT_EXEC_PATH git fetch && git status --short`
  before EVERY edit; if `resume-arkanoid.html` has foreign uncommitted changes, do NOT edit — record
  the intended change here and take a different item. Stage the file by name, never `git add -A`.
- **Graph tool bug:** re-`claim`ing a subject with the *same* `--source` string crashes on a UNIQUE
  edge constraint and rolls back. Use a distinct source string (e.g. `file:line`) when updating.
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
