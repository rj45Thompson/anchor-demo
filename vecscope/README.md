# vecscope — the last-layer vector, and how it misses

A WebGPU viewer for one GPT-2 prompt's **final-layer residual at the last token**: the error direction that
makes the model answer wrongly, and the collateral damage a weight fold does to facts it was never taught.

```powershell
py -X utf8 .opus-tools\vecscope\dump_residual.py ; py -X utf8 .opus-tools\vecscope\serve.py
```

then open **http://127.0.0.1:7931/vecscope.html**. No build step, no npm install.
The use case description this is built to is [USE_CASES.md](USE_CASES.md) — read that first; it was written
before any code, and it is what the requirements link to.

---

## What is REAL and what is a presentation choice

The honest split, because the whole point of this page is that the picture can be trusted.

**Real, measured activations** — `openai-community/gpt2-medium`, CPU, float32, local HF cache, no network:

| | |
|---|---|
| `z` | `hidden_states[-1][0,-1]` — **already post-`ln_f`** in HuggingFace GPT-2. `W_U @ z` reproduces the model's own logits to **2.29e-05**, asserted per fact. So every dot product drawn IS a logit. |
| `h` | the raw pre-`ln_f` residual stream, from a forward hook on `ln_f`'s input. `hidden_states[-2]` is **not** this — it is block *n−1*'s **input** (see the indexing note below). |
| `W_U[true]`, `W_U[rival]` | real `lm_head` rows; top-10 logits with their token strings |
| `e` | the error vector, definition below |
| the fold | a real rank-one write to layer 8's `mlp.c_proj`, λ found by bisection |
| the damage | real re-measurements of 8 untaught facts against the folded weights |

**Presentation choices, all named on screen while they are active:**

- **The projection.** 1024 dims do not fit on a screen. Four orthonormal bases are switchable, and each one
  prints what it discards *for the selected vector*, as a number. Measured for the miss case's `z`:

  | basis | on screen | **not** drawn |
  |---|---|---|
  | decision plane (the two unembedding rows + z's remainder) | 278.9 | **0.0 %** — by construction; axis 3 *is* that vector's leftover |
  | PCA over this dump's z vectors | 271.7 | **22.6 %** |
  | random orthonormal (seed 20261125) — the control | 10.2 | **99.9 %** |
  | 3 raw highest-variance dimensions | 278.2 | **7.4 %** |

  The random basis is there to be compared against, not believed: if a picture looks structured *there*, the
  structure in the others is the basis, not the model. It hides 99.9 %, as it should.
- **Error magnification** (default ×60). ‖e‖ is **0.202 %** of ‖z‖ on the miss case — invisible at true scale.
  The factor and the true ratio are both printed.
- **Axis-3 compression** and the **world-unit scale**, both derived from the data and stated ("1 world unit on
  axes 1–2 = N residual units"). The residual puts ~276 units along axis 3 against ~32 in the plane where the
  decision is made; one scale for both would hide the decision inside a pixel.
- **Unembedding arrows at a fixed length.** Their own norms (~2–3) are a different quantity from the
  residual's (~279), so they are drawn as *directions* and their norms are printed in the readout instead.
- **Optional mean-z subtraction.** Useful with the PCA basis; it collapses the decision basis, which is
  visible immediately when you try it.

Nothing in that second list changes a measured number, and the page says so.

## The error vector, defined

```
d = W_U[rival] − W_U[true]              the decision direction in residual space
g = dot(z, d) = logit_rival − logit_true   the signed gap, in logit units
e = (g / dot(d, d)) · d                 the error vector,   ‖e‖ = |g| / ‖d‖
```

`e` is **both** (a) the component of `z` pointing toward the rival rather than the true answer and (b) the
negation of the minimum-norm change to `z` that would flip the answer. They are the same vector, which is why
this definition and no other is drawn. `z − e` ties the two answers exactly (planted and checked).

**`rival` = argmax over every token except the true one.** This is uniform on purpose. For a fact the model
gets *right*, "the wrong answer it produces" does not exist, and a definition that only works on a miss could
not compare a control fact before and after a fold. So a miss has `g > 0` and `e` points **at** the wrong
answer; a hit has `g < 0` and `e` points **away**, with `|g|` the margin. That sign is the visible difference
between a true-vs-wrong and a true-vs-true case — it is the arrow's colour in the 3D view (red / green), the
verdict box's colour, and which side of the drawn decision boundary `z` falls on.

This definition came out of a failure: the first version keyed on the model's argmax, and the selftest plant
refused it the moment a correct fact was passed in (`d` collapsed to zero). The plant found it, not review.

## What the two measured pictures show

**How it misses** — CounterFact row 1, `The official religion of Edwin of Northumbria is`. The model answers
` the`; the true object is ` Christianity`. `g = +1.978`, `‖e‖ = 0.565`, **0.202 % of ‖z‖ = 278.9**.
The miss is a hair's breadth: a correct 1024-dimensional vector and this one differ by two parts in a thousand
of its length. That ratio is the reason the error needs magnifying to be seen at all, and it is printed next
to the magnification so the two are never confused.

**What it damages** — taught `The mother tongue of Danielle Darrieux is`, **French → English**, by a rank-one
write to layer 8's `mlp.c_proj`, λ = 12.94 by bisection (the smallest λ that flips it), ‖Δ‖ = 12.94. The
taught key drifts **0.0** after the write, so the write is exact. Restoring the weights restores the original
answer, so every "after" number is attributable to the fold. Measured on 8 untaught facts:

- **6 of 8 moved toward their rival**; **0 crossed `g = 0`** at this minimal λ. The damage is real and
  one-directional but sub-threshold here — stated plainly rather than dressed up as a break.
- **The damage is RELATION-LOCAL.** I first wrote this up as "a rank-one fold moves untaught facts further
  than the fact it taught", which was the **maximum of eight read as a rule** — one untaught fact moves
  ‖5.32‖ against the taught fact's ‖2.78‖, and the other **seven move less**. A peer reproduced both numbers
  exactly and then showed the sentence does not survive the full table. It is gone from the page.
  What the same eight facts do support is a structure. Split by whether they share the taught fact's
  relation (P103, "mother tongue"):

  | | n | mean shift | values |
  |---|---|---|---|
  | taught fact | 1 | **2.7841** | — |
  | untaught, **same** relation | 4 | **2.7771** | 5.32, 2.43, 2.06, 1.29 |
  | untaught, other relations | 4 | **1.1911** | 1.39, 1.33, 1.21, 0.84 |

  A fact the fold never touched moves **as much as the fact being taught** — within 0.007 — provided it
  shares the relation, while an unrelated fact moves about half as much (ratio 2.33).
  **This is a shape, not a size:** n=4 vs n=4, one prompt, one fold, one layer. What would settle it is the
  same fold repeated across several taught relations with a balanced control set per fold. That has not
  been run, and the figure is not an effect size.
  It was only visible because the control set spans four relations; eight facts of one kind would have
  hidden the structure entirely and made the max-of-eight look like a general law.
- **The bleed** (the lane's "forced"): ` English` rose in facts it was never taught — row 5 (Dutch) `+1.99`
  logits, **rank 4 → 2**; row 34 (Russian) rank 2 → 1. A rank is the honest unit: a logit rise that changes no
  ordering changes no answer.
- Row 53's true answer *is* ` English`, and the fold made it **more** confident (`g` −0.35 → −0.79). The same
  push helps the one fact whose answer matches the taught object and hurts the ones whose answer differs.
- Each fact's perturbation is `Δ · dot(k_other, k_taught)/dot(k_taught, k_taught)` — the named mechanism,
  recorded per fact, not a delta inferred after the fact.

## The rule about not writing paths

`dump_residual.py` recorded the resolved location of its parquet in the manifest as `dataset_path`. On this
machine that string starts `C:/Users/<account>/…`, so it carried the owner's Windows account name, and a
sibling session published that JSON to a public Pages site where it was live for roughly twenty minutes
before their own sweep caught it. The field existed to make the data auditable; nobody intended it to carry
anything about a person.

**The fix is a refusal, not a redaction.** `provenance.py :: NoLocalPaths.require` walks the manifest and
raises *before the output file is opened* if any string looks like a local path — a drive letter, a UNC
share, a POSIX or mac home, or this machine's own home directory. Both dumpers call it, and both selftests
plant the exact field that leaked and fail if it is ever writable again. A redaction step before publishing
was considered and rejected: a step someone has to remember is one that is eventually forgotten, and
anything these dumpers write can end up on a public page.

What replaced it is better provenance, not less: `DatasetRef` records the **repo id and the snapshot
revision** (`azhx/counterfact @ c01c413f856e…`). The revision pins the exact bytes and is reproducible on
any machine; a filesystem location pins nothing and identifies a person. An unparseable path becomes
`ABSENT` with a reason rather than a raw path. The exception text deliberately names the offending *field*
and never the offending *value*, so the guard cannot itself repeat what it is protecting.

Scanned after the fix: `trace.json` never carried a path; `trace.bin` is exactly 1,024,000 bytes = 25 × 10 ×
1024 × 4, with no room for metadata.

## The rule about cosine

`memory/feedback_cosine_depth_rule`, and measured in this lane: cosine inverted 6 of 9 requirement-dependency
pairs and the top-scoring pair was a polarity flip — the failure is in the **ordering**, so no threshold
repairs it. The residual's magnitude is exactly what turns a direction into a logit, so **no cosine is used
anywhere in this tool**. Every comparison is a dot product or a norm, every angle on screen has both
magnitudes printed beside it, and every projection basis is orthonormal so a drawn coordinate is a real
length. `vector_depth.py --scan` is green (unchanged by this work).

> **Finding for whoever owns `vector_depth.py`** (not patched here — another lane's gate):
> `Scan.DIRS = ("autobot", "steps")`, so `vecscope/` is outside it. More importantly `Scan.check` sets
> `checked = True` for any file whose *text* contains the string `vector_depth` — so merely naming the tool in
> a comment exempts a file from the scan. This file's dumper would be exempt that way even though it never
> calls `DepthCheck`. Worth tightening to an import or a call.

## Verification — what was actually driven

- **WebGPU, not WebGL.** Measured in the browser used: Claude desktop browser pane, Chrome 156, adapter
  **nvidia / turing**, `requestDevice` OK, canvas context OK. There is **no WebGL fallback** — a second
  renderer would be a second thing to be silently wrong, and this project's iron law 2 forbids fallbacks. If
  WebGPU is missing the page refuses and names which step failed.
- **The GPU's projection is checked against a CPU one** computed in JS from the same JSON, every time the
  basis changes: **6.10e-06 relative** (4.77e-03 absolute on coordinates up to ~276). Above 1e-4 relative the
  page paints a failure instead of a picture.
- **Looked at mid-rotation, not just the first frame.** The view was orbited by dragging to three different
  angles and screenshotted at each; the page also idle-spins until first interaction. (This project's measured
  trap: a three.js instance scaled to zero renders black and reads as a broken shader —
  `memory/reference_three_zero_scale_instance_black`.)
- **A true-vs-wrong case is visibly different from a true-vs-true case**: red vs green error arrow, red vs
  green verdict, opposite side of the decision boundary, and in the control case the two unembedding arrows
  are nearly parallel where in the miss case they diverge.
- **The dumper's plants pass and two of them caught real faults** — the rival definition above, and a
  mis-built plant whose argmax was not under its own control. `py -X utf8 dump_residual.py --selftest`.

Two bugs the pictures caught that no assertion would have: an origin-anchored segment addressed `proj[0]`
instead of `extra[0]` (every vector drawn zero-length), and `lookAt`/`persp` were column-major while the
matrix multiply was row-major (a garbage MVP and an empty canvas). Both were invisible to every check except
looking at the screen.

## Not claimed

- **Not ROME/MEMIT.** The fold is a bare rank-one write with no covariance pre-conditioning, so its collateral
  damage is an **upper bound** on a ROME-style edit's, not an estimate of it.
- **The lane's 294/148/208 and 611/650 are not reproduced here.** Searched `D:/code` on 2026-11-25
  (`grep -rl -iE "counterfact"`, 0 hits) — that code is not on this drive. Nothing in this tool displays them.
- Layer 8 is an **authored** hyperparameter (a mid-network MLP in a 24-layer model), declared as such in the
  dump, never presented as a ported value.
- 8 control facts and one taught fact is a demo-sized sample, not a retention study.

## vecflight — fly the forward pass (UC-VS-02)

```powershell
py -X utf8 .opus-toolsecscope\dump_trace.py ; py -X utf8 .opus-toolsecscope\serve.py
```

then **http://127.0.0.1:7931/vecflight.html**. Built to UC-VS-02 after the owner expanded the spec: fly through the
network, replay the pass, rewind it, and find the layer where it went wrong.

**Record once in Python, replay in WebGPU.** No inference runs in the browser. `dump_trace.py` writes a
uniform stack of RAW pre-`ln_f` residuals — `(25 entries, 10 tokens, 1024) float32 = 0.98 MB` — and the page
scrubs it, so "real time" and "rewind" are the same mechanism and every frame is a measured activation.
The stack is uniform because entry 24 comes from the `ln_f` **hook**, not from `hidden_states[-1]`, which is
already post-`ln_f`; putting that entry in unchanged would leave exactly one layer normalised and the logit
lens would double-normalise it.

### What it found — the answer to "where are the errors"

The **logit lens**: at every layer, the last token's residual pushed through the final `ln_f` and `W_U`,
recording `gap = logit(" the") − logit(" Christianity")`. Prompt: *The official religion of Edwin of
Northumbria is*. Three crossings, **computed from the curves, never authored**:

| | gap | what happens |
|---|---|---|
| after 0 → 1 block | −3.61 → **+9.26** | **block 0** hands the lead to the wrong answer |
| after 16 → 17 blocks | +0.90 → **−3.73** | **block 16** hands it to ` Christianity`, which holds it |
| after 23 → 24 blocks | −0.03 → **+1.98** | **block 23, the last one, takes it back** |

**The model has the right answer from block 16 onwards — and loses it to an erosion, not to one block.**
My first headline here said "the final block threw it away". That was wrong, and a peer's independent
hook-based run caught it. Reading a *crossing* as an *attribution* is the mistake: the gap crosses zero
between the last two entries, so the last block looks guilty, while the per-block deltas say otherwise.

Computed from my own recording (`erosion` in `trace.json`, never authored):

| | change in gap | share of the swing |
|---|---|---|
| peak lead, after 20 blocks (output of block 19) | **−9.0137** | — |
| block 20 | +1.8869 | 17.2% |
| block 21 | +2.0107 | 18.3% |
| **block 22** | **+5.0876** | **46.3%** |
| block 23 (the last) | +2.0067 | 18.3% |

**Block 22 does nearly half the damage; the last block does 18%**, and by the time it acts the lead is
already down to −0.03 from −9.01, so it finishes something rather than causing it. The block I had been
presenting as the last healthy one is the one that destroys the most.

**Is that −0.03 real?** My first wording called it "a tie, not a lead". That was wrong in the opposite
direction, and a peer pushed back with the right instinct: the *sign* is measurable even though the lens's
interpretive error is not. Two different uncertainties were being conflated.

- The **lens's interpretive error** at intermediate entries — reading a mid-stack residual through the final
  layer's norm — is **not measured** here or anywhere else in this tool, and no figure is invented for it.
- The **pipeline's numeric spread** is measurable, and it is what decides whether a sign can be trusted.
  Recomputing every entry's gap in float64, in float32, and with the residual rounded to the 6 decimals the
  vector dumps ship: at entry 23 the spread is **6.02e-07**, so the gap of −0.028545 is **47,390× the
  noise**. Neither rounding nor float precision can flip that sign.

So it is a **real but negligible lead** — 0.3% of the peak lead of −9.01 — not a tie and not noise. The
interesting fact that "tie" would have hidden is that the stack arrives at the final block almost exactly
balanced. The figure is computed per run (`precision` in `trace.json`), not written into the page.

This is visible in space: the gap curve runs red above the plane, dives green through it at the block-16
marker, and climbs back; beside it a **per-block delta lane** draws how far each block moved the gap, and
the tallest bar is block 22, not block 23.

**Where the lens is exact and where it is not.** At the last entry the lens is not an approximation — it is
the model's own computation, and it matches the real logits to **4.78e-06** (asserted in the recorder; a
mismatch writes nothing). Layers 0..23 are read through the FINAL layer's norm, which is not the norm they
were trained to be read through, so their absolute logits are indicative. The UI carries that sentence
wherever a lens number appears, with the last-layer agreement beside it so the reader can see where the
approximation ends. Technique: the logit lens (nostalgebraist, 2020).

**Three independent checks, all shown in the page banner:** GPU projection vs the same sum in JS
**2.21e-07 rel**; lens at L24 vs the model's real logits **4.78e-06**; and `ln_f(trace's last residual)` vs
`vecscope.json`'s separately dumped `z` for the same row **6.28e-08 rel** — two recordings made by different
scripts agreeing, rather than one being trusted.

### The indexing, measured — and a correction

A peer disputed my first explanation of why the hook is needed and was right. Measured here with my own
hooks on gpt2-medium (block 23's output captured and snapshotted before any later call could re-fire the
hook):

```
hs[0]  vs block0 INPUT   : 0.0      hs[-2] vs block23 INPUT  : 0.0
hs[1]  vs block0 OUTPUT  : 0.0      hs[-2] vs block22 OUTPUT : 0.0
block23 OUTPUT == ln_f INPUT : 0.0  hs[-2] vs block23 OUTPUT : 1894.03
block23's OUTPUT appears at NO index of hidden_states  ->  []
```

So `hidden_states[k]` is the **input** to block *k* (identical to block *k−1*'s output), and **the last
block's output is in the tuple at no index at all**. I had written that `hidden_states[-2]` was block 23's
output. It is block 23's *input*. The recorded data was already correct, because entry 24 comes from the
hook and therefore *is* the missing last output — but the wrong reason would have misnumbered every curve
by one, and "which layer went wrong" is the one claim this view cannot afford to be off by one about.

**The convention, stated here, in the manifest, and in the UI:**

> **entry k = the residual stream AFTER k blocks have run.**
> Entry 0 is the embeddings, entry k (1…23) is `hidden_states[k]`, entry 24 is the `ln_f` hook.
> A change between entry k and entry k+1 is therefore the work of **block k**.

Under that convention the three crossings name a block rather than an ambiguous index: **block 0** hands the
lead to the wrong answer, **block 16** hands it to ` Christianity`, and **block 23 — the last one — takes it
back**. `trace.json` carries an `entry_source` string per entry naming the exact `hidden_states` index or
hook it came from, because that is the one thing a reader cannot recover from the picture.

### Verification, and one thing I could not verify

Driven in the browser pane: fly camera (WASD/QE + drag), orbit mode, scrub, play, the three crossing cards
("click to fly here"), all four projections, both toggles — no console errors, banner green. Screenshots were
taken **mid-flight and mid-animation** at several layers, not just the first frame: at L9 the error arrow is
red (gap +7.09, rival ahead), at L17 it is green (gap −3.73) — the colour is the measured sign of the gap.

**Not verified: the animation at a normal frame rate.** This session cannot show the Browser pane
(`show_pane` reports the session is not open in a window), so the page runs as a background page and
`requestAnimationFrame` was measured at **2 frames per second**. Playback is correct anyway because that
measurement forced a real fix: the replay is anchored to **wall-clock elapsed time**, not an accumulated
per-frame `dt` clamped to 50 ms, which under 2 fps would have run roughly 30× slow. Smoothness on a visible
pane is untested; correctness of the replay rate is not.

Two bugs the pictures caught again, neither of which raised a WebGPU validation error: the initial fly yaw
had the wrong sign and pointed the camera away from the stack (empty first frame), and the scrub readout
desynced from the panel when a crossing card moved the camera.

**One guard fired for real and was not loosened.** The GPU-vs-CPU check refused the page at **2.06e-04**
relative. The cause was computing the discarded part as `sqrt(|v|² − |c|²)`, which cancels catastrophically
when the basis captures nearly all of a large vector. Both the shader and the CPU check now take the norm of
the actual remainder `v − Σcᵢbᵢ`, and the disagreement fell to **2.21e-07**. The threshold stayed where it was.

## Files

| file | serves |
|---|---|
| `USE_CASES.md` | the use case description — written first; requirements link to its steps |
| `dump_residual.py` | steps 1–6: the measured data, with provenance per field and `--selftest` plants |
| `vecscope.html` | steps 7–8: the page, the projection switcher, the readout |
| `vecscope.wgsl` | steps 7–8: the 1024→3 projection on the GPU and screen-space line expansion. No analysis |
| `serve.py` | step 7: the static server (the page fetches, so `file://` will not work) |
| `provenance.py` | R-VS-NOPATH: the dataset reference that replaces a path, and the guard that refuses one |
| `data/vecscope.json` | the UC-VS-01 dump: 19 fact-states × 1024-d vectors, bases, manifest (1.3 MB) |
| `dump_trace.py` | UC-VS-02 steps 1-3, 8: the flight recorder and the logit lens, with `--selftest` plants |
| `vecflight.html` | UC-VS-02 steps 5-8: fly camera, timeline replay, crossings, the centrepiece |
| `vecflight.wgsl` | UC-VS-02 steps 5-7: projection, line expansion, node sprites. No analysis |
| `data/trace.bin` + `data/trace.json` | the recording: 25 × 10 × 1024 float32 (0.98 MB) + manifest |
