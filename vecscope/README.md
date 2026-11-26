# vecscope — the last-layer vector, and how it misses

A WebGPU viewer for one GPT-2 prompt's **final-layer residual at the last token**: the error direction that
makes the model answer wrongly, and the collateral damage a weight fold does to facts it was never taught.

**It is running here: [vecscope.html](vecscope.html).** It needs a browser with WebGPU; there is no WebGL
fallback, because a fallback that silently draws something else is the one thing this page must not do.

To re-measure the data rather than take it on trust, run the dumper yourself and serve the page locally —
no build step, no npm install:

```powershell
py -X utf8 .opus-tools\vecscope\dump_residual.py ; py -X utf8 .opus-tools\vecscope\serve.py
```

then open **http://127.0.0.1:7931/vecscope.html**.
The use case description this is built to is [USE_CASES.md](USE_CASES.md) — read that first; it was written
before any code, and it is what the requirements link to.

---

## What is REAL and what is a presentation choice

The honest split, because the whole point of this page is that the picture can be trusted.

**Real, measured activations** — `openai-community/gpt2-medium`, CPU, float32, local HF cache, no network:

| | |
|---|---|
| `z` | `hidden_states[-1][0,-1]` — **already post-`ln_f`** in HuggingFace GPT-2. `W_U @ z` reproduces the model's own logits to **2.29e-05**, asserted per fact. So every dot product drawn IS a logit. |
| `h` | the raw pre-`ln_f` residual stream, from a forward hook on `ln_f`'s input. `hidden_states[-2]` is **not** this (measured 181.4 away). |
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
- **The taught fact's own final-layer vector moved ‖2.78‖; one untaught fact moved ‖5.32‖** — further than the
  fact the edit was for. The edit is not localised to what it was taught.
- **The bleed** (the lane's "forced"): ` English` rose in facts it was never taught — row 5 (Dutch) `+1.99`
  logits, **rank 4 → 2**; row 34 (Russian) rank 2 → 1. A rank is the honest unit: a logit rise that changes no
  ordering changes no answer.
- Row 53's true answer *is* ` English`, and the fold made it **more** confident (`g` −0.35 → −0.79). The same
  push helps the one fact whose answer matches the taught object and hurts the ones whose answer differs.
- Each fact's perturbation is `Δ · dot(k_other, k_taught)/dot(k_taught, k_taught)` — the named mechanism,
  recorded per fact, not a delta inferred after the fact.

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

## Files

| file | serves |
|---|---|
| `USE_CASES.md` | the use case description — written first; requirements link to its steps |
| `dump_residual.py` | steps 1–6: the measured data, with provenance per field and `--selftest` plants |
| `vecscope.html` | steps 7–8: the page, the projection switcher, the readout |
| `vecscope.wgsl` | steps 7–8: the 1024→3 projection on the GPU and screen-space line expansion. No analysis |
| `serve.py` | step 7: the static server (the page fetches, so `file://` will not work) |
| `data/vecscope.json` | the dump: 19 fact-states × 1024-d vectors, bases, manifest (1.3 MB) |
