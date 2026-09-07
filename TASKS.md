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

## Todo (directive priority order)
- [ ] **Shadows** — `renderer.shadowMap.enabled=true`, `castShadow` on the key DirectionalLight,
  `receiveShadow` on ground/board. 2 DirectionalLight + 4 PointLight already exist (only the key
  should cast, to stay in budget). Watch the frame cost — this is the expensive one. Rung 3.
- [ ] **Bloom** — only if 1–3 land and budget survives. r128 has no post-processing wired
  (`renderer.render` at :3056 is a single bare call, no composer). Needs EffectComposer +
  UnrealBloomPass; **verify those exist in the vendored `../three.min.js` before planning** (they are
  in separate example files, not guaranteed vendored). Rung 4.

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
