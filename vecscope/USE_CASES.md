# vecscope — use case description

Written **before** any code, by standing rule on this project: the UML use case description comes first, and
requirements link only to STEPS. Code links only to steps too; the "serves" column at the bottom is that link.

The goal as it was given: see the last vector, after everything has collected on the final layer; see the error, how it misses, and the damage it causes.

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
     `hidden_states[-2]` is NOT it. Measured with hooks 2026-11-25, correcting an earlier wrong claim of
     mine: `hidden_states[k]` is the INPUT to block k (identical to block k-1's output, difference 0.0), and
     the LAST block's output appears at no index of `hidden_states` at all. ‖h‖=1007.9 vs ‖z‖=312.8 on the
     probe prompt, so the two are not interchangeable and the viewer labels which one it is showing.

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

---

## UC-VS-02 — Fly through the forward pass, rewind it, and find the layer where it went wrong

Added after the spec was expanded: fly through the stack as it runs, rewind it, and see the last vector that chooses the next token.

**Actor** — the same researcher. **Goal** — move a camera through the whole network while a recorded forward pass
replays, scrub it backwards and forwards, and SEE the layer at which the wrong answer takes over.

**Architecture decision, taken before any code and stated here because it is what makes the picture honest:**
**record once in Python, replay in WebGPU.** No inference runs in the browser. Every frame on screen is then a
measured activation rather than an approximation of one, and "real time" and "rewind" become the same
mechanism — scrubbing a recorded array. Measured cost for the demo prompt: the raw residual stack is
`(25 layers, 10 tokens, 1024) float32 = 0.977 MB`. This is already how UC-VS-01 works, so it is a
continuation, not a change of direction.

### Main success path

1. **Record the whole pass, not just its end.** One CPU forward with `output_hidden_states=True`, plus the
   `ln_f` input hook, giving a UNIFORM stack of RAW pre-`ln_f` residuals at every layer and every token.
   *Observable:* `trace.bin` is exactly `(n_layers+1) × n_tokens × d_model × 4` bytes and the manifest states
   that shape. The stack is uniform because entry 24 is taken from the HOOK, not from `hidden_states[-1]` —
   that entry is already post-`ln_f` and putting it in the stack unchanged would double-normalise one layer.
   The HOOK is also the only source for that entry at all: measured, the last block's output is at no index
   of `hidden_states`.
   *Observable:* the manifest carries an `entry_source` string PER ENTRY naming the exact `hidden_states`
   index or hook it came from, and states the convention **entry k = the residual after k blocks have run**,
   so that a change between entry k and k+1 is the work of BLOCK k. Without that, every curve is one index
   away from being mislabelled and the view would name the wrong layer as the place it went wrong.

2. **Read every layer through the unembedding — the logit lens.** At each layer L, push that layer's residual
   at the LAST token through the final `ln_f` and `W_U`, and record the logit of the TRUE answer token and of
   the token the model finally produces, plus the per-layer argmax.
   *Observable, measured 2026-11-25 on `The official religion of Edwin of Northumbria is`:*
   the gap `logit(wrong) − logit(true)` runs **+9.3 after 1 block**, crosses to **−3.7 after 17** (the work
   of BLOCK 16) where ` Christianity` takes the lead, peaks at **−9.01 after 20 blocks**, and is back to
   **+1.98 after 24**. Those crossings are real and are what this step records.

   *Observable (step 8 does the attribution, and it is a SEPARATE measurement):* a crossing says where the
   lead changed hands, never who did the work. Reading one as the other is how this lane's first headline
   named the wrong block. The per-block deltas must therefore be recorded too, and the UI must show them.

3. **Prove the lens where it can be proved.** At the LAST layer the lens is not an approximation: it is the
   model's own computation. *Observable:* lens logits at layer 24 equal the model's `logits` to **2.29e-05**,
   asserted in the recorder. If that assertion fails, nothing is written.

4. **Say that the intermediate layers ARE an approximation.** Layers 0..23 are read through the FINAL layer's
   norm, which is not the norm they were trained to be read through.
   *Observable:* the UI carries that sentence wherever a lens number is shown, and the layer-24 agreement
   above is shown beside it so the reader can see where the approximation ends.

5. **Lay the network out in space and fly through it.** Layers along one axis, token positions across it;
   each node is one recorded residual. A free camera (WASD/QE + mouse look) moves through the stack; an orbit
   camera is also available. *Observable:* the camera can be placed between two layers and the two logit-lens
   curves read against each other from inside the stack; frames mid-flight differ from the first frame.

6. **Replay it, and rewind it.** A timeline over layer depth with play / pause / speed and a scrub handle.
   *Observable:* the wavefront position is a layer index shown numerically; dragging it backwards shows
   earlier layers' state, and the readout at every position is the recorded value for that layer, not an
   interpolation of the endpoints. Interpolation between layers is a PRESENTATION choice and is labelled.

7. **Keep the last vector as the centrepiece.** At the scrub position, the last token's residual is drawn
   against the two unembedding directions with the error between them, as in UC-VS-01.
   *Observable:* at layer 24 the vector, the gap and the top-k match `data/vecscope.json` exactly — the two
   pages agree because they read the same measurement.

8. **Attribute the damage to a BLOCK, which is not the same as marking a crossing.**
   `delta[k] = gap(after k+1 blocks) − gap(after k blocks)` is the work of block k. From the peak of the
   true answer's lead, record every block's contribution and its share of the total swing.
   *Observable:* the UI names the BLOCK responsible for each sign change (entry k -> k+1 is block k), not a
   bare index, AND draws the per-block delta beside the curve, so the largest mover is visible rather than
   inferred. Measured here: the lead peaks after 20 blocks at −9.01 and is eroded by four blocks —
   17.2% / 18.3% / **46.3%** / 18.3% — so **block 22**, not the last block, does most of the damage.
   *Observable:* a |gap| far below the peak is reported as a TIE, not a lead, because the lens has no error
   bar at intermediate entries.
   *Alternate (A9):* if the gap never recovers after its strongest point there is no erosion to attribute,
   and the UI says that instead of naming a block.

### Alternate paths

- **A6 — no crossing exists** (the wrong answer leads at every layer). The UI says so explicitly rather than
  drawing a marker at an arbitrary layer. A prompt whose error was never a near miss is a real outcome.
- **A7 — the lens disagrees with the model at the last layer** (step 3). The recorder raises; no trace is
  written. A viewer whose curve does not end at the model's own answer would be a lie about the model.
- **A8 — the trace is too large to fetch.** The manifest carries the byte count; the page states the size it
  loaded. No silent downsampling — if a prompt is too long, the recorder says so and refuses.
- Paths A1, A1b and A5 from UC-VS-01 apply unchanged (WebGPU refusal, GPU-vs-CPU check, ABSENT with a reason).

### Rules this use case is held to

All of UC-VS-01's rules carry over unchanged. R-VS-DEPTH especially: the logit-lens curves are DOT PRODUCTS
(`W_U[t] · ln_f(resid)`), never cosines, and the residual norm per layer is plotted beside them because the
norm grows by more than an order of magnitude across the stack and a direction-only view would hide that.

### Which code serves which step

| Code | Serves |
|---|---|
| `dump_trace.py :: Trace` | step 1 (and A8) |
| `dump_trace.py :: LogitLens` | steps 2, 3, 4 (and A7) |
| `dump_trace.py :: Crossings` | step 8 (and A6) |
| `dump_trace.py :: Erosion` | step 8 — the per-block attribution (and A9) |
| `vecflight.html :: layout/nodes` | step 5 |
| `vecflight.html :: FlyCamera` | step 5 |
| `vecflight.html :: Timeline` | step 6 |
| `vecflight.html :: centrepiece` | step 7 |
| `vecflight.wgsl` | steps 5-7 — projection and drawing only; no analysis |
