# vecscope — use case description

Written **before** any code, by standing rule on this project: the UML use case description comes first, and
requirements link only to STEPS. Code links only to steps too; the "serves" column at the bottom is that link.

The goal as it was given: see the last vector, after everything has collected on the final layer; see the error, how it misses, and the damage that miss causes.

---

## UC-VS-01 — See how a final-layer vector misses, and what the miss costs other facts

**Actor** — a researcher debugging the knowledge-editing lane: a fact is folded into GPT-2's MLP weights, and the
question is whether it lands as weights or as a per-prompt slot, and what it breaks that it was never taught.

**Secondary actor** — the model itself (`openai-community/gpt2-medium`, local HF cache, CPU). It is an actor
rather than a resource because the numbers on screen are its measured activations, not a simulation of them.

**Goal** — look at ONE prompt's final-layer residual vector at the last token, see the direction and the
MAGNITUDE by which it misses the true answer, and see that same miss appear on facts the fold never touched.

**Precondition** — `gpt2-medium` and `azhx/counterfact` resolve from `~/.cache/huggingface/hub` with no network.

**Postcondition** — a JSON file of measured vectors with provenance per field, and a page that draws them.

### Main success path

1. **Choose a fact the model gets WRONG and facts it gets RIGHT.**
   Read CounterFact rows; run each prompt; keep one row whose argmax ≠ the true object's first token (the MISS
   case) and 3 rows whose argmax == it (the CONTROL cases).
   *Observable:* the dump names each row's dataset index, its prompt, the true object, and the token the model
   actually produced. A run that cannot find a miss exits non-zero and says so — it never relabels a hit.

2. **Record the vector "after they all collect on the last layer".**
   Two different vectors live at that spot, and the distinction is load-bearing — measured 2026-11-25, not
   assumed, after the first assumption about it turned out wrong:
   - `z = hidden_states[-1][0, -1]` — in HuggingFace GPT-2 the LAST entry of `hidden_states` is already
     **post-`ln_f`**. `W_U @ z` reproduces the model's own logits to **2.3e-05**, so `z` is the vector the
     unembedding actually reads and every dot product drawn on the page IS a logit.
   - `h` — the raw pre-`ln_f` residual stream, reachable only by a forward hook on `ln_f`'s INPUT.
     `hidden_states[-2]` is NOT it (it is block 23's output, measured 181.4 away). ‖h‖=1007.9 vs ‖z‖=312.8 on
     the probe prompt, so the two are not interchangeable and the viewer labels which one it is showing.

   *Observable:* every vector carries `model_id`, `layer_index`, `n_layers`, `token_index`, `token_text`,
   `dataset_row`. The `W_U @ z` → logits agreement is asserted at < 1e-3 in the dumper, so the geometry on
   screen is the geometry that produced the answer.

3. **Record the two directions the decision is made between.**
   `W_U[T]` = the unembedding row for the TRUE answer's first token, `W_U[W]` = the row for the token the model
   actually produced. Plus the top-10 logits with their token strings.
   *Observable:* the top-10 list, its logits, and `||W_U[T]||`, `||W_U[W]||` printed beside each other.

4. **Record the ERROR vector, with its definition written into the file.**
   `d = W_U[W] - W_U[T]`; `g = dot(z, d)` = logit(wrong) − logit(true); `e = (g / ||d||²) · d`.
   This is simultaneously (a) the component of `z` along "wrong rather than true" and (b) the negated
   minimum-norm change to `z` that would flip the answer — the same vector, which is why it is the honest one
   to draw. `||e|| = g / ||d||`: logit gap divided by the decision direction's length.
   *Observable:* a MISS has `g > 0` and `e` pointing toward `W_U[W]`; a CONTROL has `g < 0` and `e` pointing the
   other way. The sign of `g` is the visible difference between a true-vs-wrong and a true-vs-true case.

5. **Fold a new fact into the weights and measure it, before and after.**
   Rank-one write to one layer's `mlp.c_proj`: key `k` = the measured mlp activation at the taught prompt's last
   token, so `k @ W' = k @ W + Δ` exactly; `Δ = λ · (W_U[new] − W_U[old])`; `λ` by bisection — the smallest value
   at which the taught object becomes argmax.
   *Observable:* the dump states λ, the layer, `||Δ||`, and that the taught prompt's argmax changed from the old
   object to the new one. If no λ in range flips it, the run exits non-zero rather than shipping a half-fold.

6. **Measure the damage on the untaught facts.**
   Re-run steps 2–4 for the 3 CONTROL facts against the folded weights.
   *Observable:* per control fact, `g` before and after, and whether its sign flipped — a fact the fold was never
   told about now answering wrongly. The perturbation each one receives is `Δ · dot(k', k)/dot(k, k)`, recorded
   per fact, so the damage has a named mechanism and not just a delta.

7. **Look at it.** Load the page; the final-layer vector is drawn with the two unembedding directions and the
   error between them; orbit it with the mouse.
   *Observable:* the page states which projection is active and what that projection discards, as a number
   (fraction of `||z||` not shown). Switching projection changes the picture and the stated discard.

8. **Read the miss and the damage off the page.**
   *Observable:* the MISS fact's error arrow points at the wrong-answer direction and its length is labelled in
   residual units; each CONTROL fact shows its before and after error, so a fact that was fine and is now broken
   is visible as an arrow that crossed the decision plane.

### Alternate paths

- **A1 — WebGPU unavailable.** `navigator.gpu` missing, `requestAdapter()` null, or `requestDevice()` throwing:
  the page REFUSES to render and says which of those happened, plus the user agent. It does NOT fall back to
  WebGL2 — this project's iron law 2 forbids fallbacks, and a second renderer with its own geometry code would
  be a second thing to be wrong, silently, in a demo whose whole purpose is that the picture can be trusted.
  *Observable:* the banner reads `WebGPU: <adapter>` on success, or `REFUSED — WebGPU unavailable: <which step
  failed>` with an empty canvas. Measured 2026-11-25 in the browser actually used (Claude desktop browser pane,
  Chrome 156): `navigator.gpu` present, adapter `nvidia / turing`, device OK, canvas context OK — so the
  refusal path is the alternate, not the normal one.
- **A1b — the GPU's projection disagrees with the CPU's.** The page recomputes every projected coordinate in
  JavaScript from the same JSON and compares. *Observable:* the banner carries `GPU vs CPU max diff: <n>`, and
  a disagreement above 1e-2 paints the banner as a failure instead of showing a picture that might be the
  shader's arithmetic rather than the model's (R-VS-BOTH: the data proves itself, then the picture confirms).
- **A2 — no miss in the sampled rows.** Step 1 exits non-zero naming how many rows it tried. Never relabel a hit
  as a miss to produce a picture.
- **A3 — the logit reconstruction check fails** (step 2's < 1e-3 assertion). The dumper raises. A viewer drawing
  a geometry that does not produce the model's own logits would be a lie about the model, so no data is written.
- **A4 — bisection finds no λ** that flips the taught fact within the search range. Exits non-zero with the range
  tried (step 5). No partial fold is dumped.
- **A5 — a field cannot be resolved.** It is written as `"ABSENT"` with a `reason`, never as a plausible number
  (project iron law 1).

### Rules this use case is held to

- **R-VS-DEPTH** (serves steps 3, 4, 7) — no cosine similarity anywhere a length carries meaning. The final-layer
  residual's magnitude is load-bearing: it is what turns a direction into a logit. Every comparison here is a dot
  product or a norm, and every angle shown on the page has the two magnitudes printed beside it.
  Measured precedent in this project: cosine inverted 6 of 9 requirement-dependency pairs and the highest-scoring
  pair was a polarity flip — the failure is in the ORDERING, so no threshold repairs it
  (`.opus-tools/autobot/vector_depth.py`, memory `feedback_cosine_depth_rule`).
- **R-VS-PROV** (serves steps 1–6) — every number is READ with a provenance string, or ABSENT with a reason.
- **R-VS-PROJ** (serves steps 7, 8) — the page names its projection and the fraction of the vector it discards.
  A viewer that hides its own projection choice is the failure mode this demo exists to avoid.
- **R-VS-BOTH** (serves step 8) — the data proves itself first; the picture and the numbers then CONFIRM. Neither
  diagnoses. A render that went black once scored BETTER on its own metric in this project.

### Which code serves which step

| Code | Serves |
|---|---|
| `dump_residual.py :: FactPick` | step 1 (and A2) |
| `dump_residual.py :: Residual` | step 2 (and A3) |
| `dump_residual.py :: Decision` | steps 3, 4 |
| `dump_residual.py :: RankOneFold` | step 5 (and A4) |
| `dump_residual.py :: Damage` | step 6 |
| `dump_residual.py :: Projections` | steps 7, 8 — bases computed in numpy, shipped in the JSON |
| `vecscope.html :: Banner/caps` | step 7, A1 |
| `vecscope.html :: orbit camera` | step 7 |
| `vecscope.wgsl` | steps 7, 8 — draws the vectors; carries no analysis |
| `vecscope.html :: readout panel` | steps 4, 6, 8 — the magnitudes beside the angles (R-VS-DEPTH) |

### What this demo is NOT

- Not ROME/MEMIT. Step 5's fold has no covariance pre-conditioning; it is the rank-one write mechanism alone, and
  the damage it does is therefore an upper bound on a ROME-style edit's, not an estimate of it.
- Not a claim about the lane's 294/148/208 numbers. Those were measured elsewhere (not on this drive — searched
  2026-11-25) and are not reproduced or displayed here.
