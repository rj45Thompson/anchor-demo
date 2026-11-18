# UC_GATEFLY - the gated view of a net that plays a game

Written 2026-11-18 BEFORE the code, per `D:\code\Tami\CLAUDE.md`. Requirements link only to
steps; code links only to steps. Every step names an OBSERVABLE outcome, so a step that did not
happen cannot be reported as done.

**Actor:** RJ, at a browser, with the repo checked out.
**Goal:** fly around a net that actually plays a game, hover a neuron or a layer, and see the
gate value the ratchet lane's arithmetic says that neuron has.

**The gate, imported not invented.** For a set of write directions or keys `K`, a covariance `C`
and a ridge `lambda`: `A = K^T (lambda C)^-1 K`, `G = A (I + A)^-1`. Per address,
`gate_j = g(a_j - c_j)` with `g(x) = x/(1+x)`, `a_j = A_jj` (ADDRESSABILITY) and `c_j` the Schur
complement of j against the others (CROWDING). Derived and verified in
`D:\code\Tami\.opus-tools\closed_loop_lite\ratchet\gate_blueprint.py` and `effective_a.py`.
This lane RE-USES that arithmetic and PROVES agreement numerically (UC-GF-2 step 1); it does not
re-derive it.

---

## UC-GF-1 - A net that plays tic-tac-toe

1. Build the game exactly: legal moves, winner, and a PERFECT opponent by full minimax over the
   reachable states.
   *Observable:* the minimax value of the empty board is a DRAW, and a game between two perfect
   players draws every time over 1000 games.
2. Train a small net on optimal-play targets.
   *Observable:* a checkpoint file on disk with its shapes and parameter count printed.
3. Play the trained net against the perfect opponent and against a random opponent, both seats,
   many games.
   *Observable:* a win/draw/loss table with the game count, and an illegal-move count.

REQ-GF-1a: the opponent is EXACT minimax over the full game tree, never a heuristic, because a
near-perfect opponent would turn a loss into a measurement of the opponent. Serves 1, 3.
REQ-GF-1b: an illegal move is counted and reported, never masked by re-sampling. Serves 3.
REQ-GF-1c: both seats are played and reported separately; a net that only moves first has been
measured on half the game. Serves 3.

## UC-GF-2 - The gate network of that net, in the browser

1. Read every layer's write directions from the checkpoint and compute `a`, `c` and `gate` per
   neuron with the imported arithmetic.
   *Observable:* a JSON file with one row per neuron carrying `a`, `c`, `gate`, and the layer it
   belongs to.
2. Serve that file to a flythrough page and draw one node per neuron, placed by (layer, index).
   *Observable:* the page draws N nodes where N is the neuron count in the JSON, printed in the
   page's own HUD.
3. Hover a neuron.
   *Observable:* a tooltip showing that neuron's gate, `a` and `c` to 4 decimal places.
4. Hover a layer (its plate).
   *Observable:* a tooltip showing the layer's neuron count and its median gate.
5. Measure the frame time over a fixed number of frames with the camera moving.
   *Observable:* a median and 95th-percentile frame time in milliseconds, printed by the page.
6. Check one hovered number by hand against a direct computation from the checkpoint.
   *Observable:* two figures printed side by side and their absolute difference.

REQ-GF-2a: the number on screen is the number the maths gives, checked for at least one neuron
against a computation that does not share the viewer's code path. Serves 3, 6.
REQ-GF-2b: the gate quantities are the ratchet lane's, proven by a plant that recomputes them
with that lane's own functions and REFUSES on disagreement above 1e-9. Serves 1.
REQ-GF-2c: the frame time is MEASURED in the page and reported with its sample count, never
asserted as "interactive". Serves 5.
REQ-GF-2d: the viewer states its node and edge counts and what it DROPPED (an edge threshold is
a cap and says its number, per NO_TOYS rule 2). Serves 2.

## UC-GF-3 - A bigger net, retrained the way the v4 lane retrains

1. Train a bigger net the same way, and measure it as in UC-GF-1 step 3.
   *Observable:* the same win/draw/loss table for the bigger net.
2. Identify the set: the positions where the net's move is not optimal, by minimax.
   *Observable:* a count of such positions and the list on disk.
3. Retrain on the corrected set - the v4 lane's method, `STATE_OF_ENTAILMENT.md`: "retraining the
   corrected set yields a model consistent with the corrected data".
   *Observable:* a second checkpoint, and the post-retrain win/draw/loss table.
4. Score the intervention on the PUBLISHED metrics the v4 lane scores arms by - Efficacy,
   Propagation, IFR (ThinkEval Eq. 6) and Preservation (Eq. 7), implemented from
   `selfimprove_v4/knowgic_score.py`.
   *Observable:* a four-row table per arm, with each metric's denominator and exclusions.
5. Report the Amnesiac caveat as a measurement, not a disclaimer: compare the retrained net
   against one trained from scratch on the corrected data.
   *Observable:* a distance between the two nets' move distributions over all reachable positions.

REQ-GF-3a: the metrics are the published formulas, and the implementation reproduces the KnowGIC
README's own worked example (IFR 0.70, Preservation 0.725) or refuses. Serves 4.
REQ-GF-3b: observations are counted per DISTINCT INTERVENTION, not per game; games sharing a
position are not independent observations (the v4 lane's own clustering correction). Serves 4.
REQ-GF-3c: "the model one would have trained" is never claimed; the from-scratch comparison is
run and its distance reported. Serves 5.

## UC-GF-4 - Shrink it by the gates, and be able to tell easy from faithful

1. Order neurons by `a` descending, per the ratchet lane's budgeted-selection result, and cut to
   a budget k.
   *Observable:* neuron and layer counts before and after.
2. Measure the shrunk net as in UC-GF-1 step 3.
   *Observable:* the win/draw/loss table at each k.
3. NULL CONTROL: at the same k, cut at random over many seeds.
   *Observable:* the same table for random cuts, and the gap between a-ordering and random.
4. FAITHFULNESS, not outcome: measure the shrunk net's move distribution against the parent's
   over every reachable position, and over the subset where exactly one move is optimal.
   *Observable:* top-1 agreement and total-variation distance, on both sets.
5. THE GATE'S OWN PREDICTION: cut one neuron at a time and measure the damage. The gate predicts
   the ORDER of the damage.
   *Observable:* the rank correlation between gate value and measured damage, with its p-value.
6. Report whether the GPT-2 result transfers to this net.
   *Observable:* an explicit TRANSFERS / DOES NOT TRANSFER verdict with the number behind it.

REQ-GF-4a: no cut is reported as a success on game outcome alone. A shrunk net that still draws
every game has NOT been shown to copy the gates; steps 3 and 5 are what can show that, and both
are required before any claim. Serves 2, 3, 4, 5.
REQ-GF-4b: the random-cut control runs at every k that a-ordering runs at, so a null is visible
at the size where it happens rather than only on average. Serves 3.
REQ-GF-4c: a null is a result and is reported as one. Serves 6.

## UC-GF-5 - RJ's hypothesis: change the neuron set so the maths stops overlapping

RJ, 2026-11-18: *"Those figures can be adjusted better by removing or adding neurons based on the
gate patterns such that the math doesn't overlap dimensions. It might only work in limited
context?"*

1. Register the prediction BEFORE the run: lowering crowding `c` over the identified set's write
   directions improves the UC-GF-3 step 4 figures.
   *Observable:* the predicted direction per metric, on disk, dated, before the arm runs.
2. Arm PRUNE: remove the neurons most crowded with the identified set's directions, then retrain.
   *Observable:* the four metrics, and the mean `c` before and after.
3. Arm GROW: add neurons whose write directions are orthogonal to the existing ones (`c` = 0 by
   construction), then retrain.
   *Observable:* the four metrics, and the measured `c` of the added neurons.
4. Test the "limited context" clause: sweep the identified-set size.
   *Observable:* each metric as a function of set size, so a benefit that exists only at small
   sizes is visible as such.
5. Verdict per arm against the registered prediction.
   *Observable:* CONFIRMED / REFUTED / NO EFFECT per metric, with the measured figure.

REQ-GF-5a: the prediction is written before the arm runs and is never edited afterwards (the v4
lane's REQ-BURN-01). Serves 1, 5.
REQ-GF-5b: "it might only work in limited context" is MEASURED as a sweep, not settled by
argument. Serves 4.
REQ-GF-5c: the orthogonal-grow arm reports the MEASURED crowding of the neurons it added, because
"orthogonal by construction" is a claim about code and not about the result. Serves 3.

## UC-GF-6 - Pong, on a neural blueprint

1. Write down what a blueprint currently is and what specifically does not fit a net.
   *Observable:* a list of named fields in `blueprint/city/data/*_3d.js` that have no neural
   meaning, and the neural facts those files have nowhere to put.
2. Define the neural blueprint type and emit one for a net that plays pong.
   *Observable:* a file in that format, and a loader that reads it.
3. Train a net to play pong and measure it.
   *Observable:* rally length and score against a scripted opponent, over many episodes.
4. Fly the pong net with the game RUNNING, with the live activation and the static gate both
   visible.
   *Observable:* the frame time while the game steps, and a hovered neuron showing both numbers.

REQ-GF-6a: "does not fit" is a list of specific fields, never a judgement. Serves 1.
REQ-GF-6b: the pong net is measured playing, not asserted to play. Serves 3.
REQ-GF-6c: the live number and the gate are LABELLED as different quantities in the page, because
an activation is not a gate and the page is the only place a reader can be told. Serves 4.

---

## Alternate paths

- **ALT-1 (UC-GF-1 step 3): the net plays an illegal move.** Counted and reported as an illegal
  move; the game is scored as a loss. No re-sampling, no masking to the legal set at play time -
  that would measure a wrapper rather than the net.
- **ALT-2 (UC-GF-2 step 1): a layer's Gram is singular.** The gate is undefined there. The layer
  is reported as REFUSED with its condition number, not given a gate of 0.
- **ALT-3 (UC-GF-2 step 5): the frame time is above 33 ms.** Reported as not interactive, with
  the number. The page is not quietly reduced until the number looks good; any reduction says what
  it dropped.
- **ALT-4 (UC-GF-3 step 2): the identified set is empty** because the bigger net is already
  perfect. Then the retraining arms have nothing to act on; that is reported, and the identified
  set is taken from a DELIBERATELY damaged net instead, which is labelled as such.
- **ALT-5 (UC-GF-4 step 5): the rank correlation is not significant.** The gate did not predict
  the damage on this net. Reported as DOES NOT TRANSFER, with the correlation and n.
- **ALT-6 (UC-GF-5 step 3): the added neurons measure non-zero crowding.** The arm is reported
  with its measured crowding and the claim "orthogonal" is withdrawn for that run.
- **ALT-7 (UC-GF-6 step 3): the pong net does not play.** Steps 1, 2 and 4 are still delivered on
  the net as trained, and the playing standard is reported as it measured.
