# The gated view of a net that plays a game - what was built and what it measured

RJ asked for five things, each ending in something to look at. This is what each one measured.
Written 2026-11-18. Every figure here is READ from a run file named beside it; nothing is
quoted from memory. Where something is not verified it says so.

**Open this first:** `harness/gatefly/index.html` - serve the repo root and go to
`http://localhost:8777/harness/gatefly/index.html` (`?net=pong` for the other one).

---

## The arithmetic is the ratchet lane's, proven not assumed

`gatefly/gate_math.py --selftest` carries 16 plants. One of them recomputes `A`, `G` and the
crowding term with the ratchet lane's OWN functions (`closed_loop_lite/ratchet/gate_blueprint.py`
and `effective_a.py`) and refuses on any disagreement above 1e-9.

    agreement: max|dA| 0.000e+00  max|dG| 0.000e+00  max|dc| 0.000e+00

Bit-identical. If that lane is unreadable the plant reports ABSENT with the path it searched and
the selftest fails, unless `--lane-optional` is passed.

---

## Step 1 - a net that plays tic-tac-toe

`gatefly/ttt.py`, `gatefly/data_ttt.py`, `gatefly/train_ttt.py`, `gatefly/play.py`

The game is solved exactly: 5,478 reachable states (the published count), 4,520 with a move to
make, 255,168 complete games (the published count), 294,778 distinct transcript prefixes. The
opponent is full minimax, never a heuristic. A plant checks that a random player loses to it and
never beats it, so "did not lose" is not vacuous.

The model is a nanoGPT in **priorgpt's own shape and checkpoint format**. priorgpt has no trainer
in this repo to reuse - its weights came from Kaggle notebooks
(`.opus-tools/priorgpt/kaggle/original.ipynb`, `chat/kaggle/*/notebook.ipynb`) trained off this
machine on Shakespeare, and what ships here is browser-side inference - so what is reused is the
model shape (Karpathy's lecture nanoGPT, priorgpt's exact tensor names) and the checkpoint format
(one flat f16 blob plus a `meta.json` index in elements). Training is local, in torch.

| | `ttt_small` | `ttt_big` |
|---|---|---|
| shape | 2 blocks, 2 heads, 32 wide | 4 blocks, 4 heads, 64 wide |
| parameters | 26,250 | 201,226 |
| optimal move on the 294,778 distinct live positions | **1.0000000000** | **1.0000000000** |
| illegal argmax | **0** | **0** |
| vs perfect, moving first | 0W **1D** 0L | 0W **1D** 0L |
| vs perfect, moving second (every opening) | 0W **9D** 0L | 0W **9D** 0L |
| vs random, moving first (500 games) | 498W 2D **0L** | 478W 22D **0L** |
| vs random, moving second (500 games) | 406W 94D **0L** | 418W 82D **0L** |

Read from `gatefly/runs/ttt_small.play.json` and `ttt_big.play.json`.

Two things worth saying plainly:

- **Every opening in tic-tac-toe is optimal**, so the "every legal opening" sweep and the
  "optimal openings" sweep are the same nine games. They are reported separately anyway because
  the code does not know that in advance.
- The **small net wins MORE against a random opponent** (498 against 478 as first player). Both
  are optimal against perfect play; optimal play does not maximise exploitation of a weak
  opponent, and a bigger net is not better at this.
- The training set is the WHOLE input space, so this measures capacity and fitting, not
  generalisation. Said here rather than left to be inferred.

---

## Step 2 - the gates in a fly-through

`gatefly/gate_read.py` emits a `neural-blueprint v1` file; `harness/gatefly/index.html` flies it.

For every weight matrix (out, in), its INPUT units are writers into its OUTPUT space, so
`K = W` with one column per writer, `A = K^T (lambda C)^-1 K` with `C = I` and lambda the median
squared column norm (the ratchet lane's `neuron_gates.py` convention), `a = diag(A)`, `c` the
Schur complement, `gate = g(a - c)`.

`blocks.N.ffwd.net.2.weight` is the lane's own site: its columns are the feed-forward neurons'
write directions into the residual stream, the same object as GPT-2's `mlp.c_proj` rows.

**What it drew** (`ttt_small`): 800 units over 19 sites, 0 refused, 2,304 wires drawn and
**14,912 of 17,216 NOT drawn**, which the page states. `ttt_big`: 4,672 units over 61 sites,
6,144 wires drawn, 128,640 not drawn. `pong`: 134 units over 3 sites.

**Frame time, measured.** The Browser pane was hidden for this session, and a hidden page has its
rAF throttled - the page showed a 36 ms median and a 1,015 ms p95 for that reason, which is a
fact about the tab and not about the scene. So the scene's own cost is measured directly, timed
around `gl.finish()` in batches of 20 draws at 1280x960 device pixels:

| net | units | wires | median draw | p95 |
|---|---|---|---|---|
| `ttt_small` | 800 | 2,304 | **0.015 ms** | 0.05 ms |
| `ttt_big` | 4,672 | 6,144 | **0.015 ms** | 0.065 ms |
| `pong` | 134 | 576 | **0.025 ms** | 0.06 ms |

A 60 Hz frame is 16.7 ms, so the draw is about a thousandth of the budget. **Not verified:** the
rAF-observed frame rate with the pane actually on screen - the pane stayed hidden, so that number
could not honestly be taken. The HUD now labels both and flags a throttled reading.

**The hovered number is the right number.** Hovering a unit gave, on screen:

    attention head 15 of 32  gate 0.4110  a (addressability) 1.9463  c (crowding) 1.2485
    c/a 0.6415  site blocks.1.sa.heads.0.key.weight  writes into 16 dimensions, with 31 others

`gatefly/check_hover.py` recomputed that unit from the f16 blob with plain numpy, importing
nothing from `gate_math`:

| | gate | a | c |
|---|---|---|---|
| the screen | 0.4110150039 | 1.9463369846 | 1.2485020161 |
| the direct sum | 0.4110148136 | 1.9463371975 | 1.2485016271 |
| difference | **1.9e-07** | 2.1e-07 | 3.9e-07 |

The bar is 1e-5 because the page works in float32 and the blueprint rounds to 6 decimals; said
out loud rather than chosen quietly. The blueprint file also carries its own `checks.hand_check`,
which agrees to **8.3e-17** in float64.

**The page RUNS the net.** It loads the f16 checkpoint beside the blueprint and does the forward
pass in JS, so the game plays while you fly it. Checked against torch on five sequences - `[]`,
`[4]`, `[4,0]`, `[0,4,8]`, `[0,1,2]` - argmax 2, 8, 6, 5, 4 from both. In the page `ttt_small`
played 6 games, 6 draws, 0 losses, 0 illegal.

**What the gates say about these nets**, which is the thing worth looking at:

| site | units -> dims | median gate | median c/a |
|---|---|---|---|
| `ttt_small` `blocks.0.ffwd.net.0` | 32 -> 128 | 0.4582 | **0.158** |
| `ttt_small` `blocks.0.ffwd.net.2` | 128 -> 32 | 0.1771 | **0.788** |
| `ttt_big` `blocks.0.ffwd.net.2` | 256 -> 64 | 0.1824 | 0.777 |
| `ttt_big` `blocks.3.ffwd.net.2` | 256 -> 64 | 0.1454 | **0.834** |
| `pong` `layers.0` | 6 -> 64 | 0.4927 | **0.029** |
| `pong` `layers.2` | 64 -> **1** | **0.0035** | **0.9965** |

Crowding tracks how over-complete the site is, and it RISES WITH DEPTH in `ttt_big` (0.777,
0.782, 0.794, 0.834 across the four blocks). Pong's output layer is the clean extreme: 64
neurons writing into one dimension have almost nothing left, which is the collinear law
(`n` keys sharing `g(na)/n`) showing up in a trained net rather than in a synthetic example.

---

## Step 3 - the bigger net, retrained the v4 lane's way, on the v4 lane's own ruler

`gatefly/retrain.py`, `gatefly/metrics.py`, `gatefly/PREREG_GATE_CAPACITY.md`

**The bigger net plays at least as well** (step 3's own bar): `ttt_big`, 201,226 parameters
against `ttt_small`'s 26,250, is optimal on the same **1.0000000000** of 294,778 positions with
0 illegal and 0 losses. It wins slightly LESS against a random opponent (478 against 498 as first
player), because optimal play does not maximise exploitation of a weak one.

**ALT-4 fired.** The use case anticipated an empty identified set, and it is empty: both nets are
already perfect, so there are no errors to retrain away. The arms therefore install
COUNTERFACTUALS - "at this board, play a move minimax says is wrong" - which is exactly what the
knowledge-editing benchmarks do (they install counterfactual facts into a model that was right
before), so the port is the benchmark's own shape and not a workaround.

**The metrics are the published ones** - ThinkEval Eq. 6 and Eq. 7, implemented from
`selfimprove_v4/knowgic_score.py`, and `gatefly/metrics.py` reproduces the KnowGIC README's own
worked example (IFR **0.6914**, Preservation **0.7250**) or refuses. The port is written out in
that file: subject = board, target = move, chain = the line of play the ORIGINAL move implies,
`E_ind` = positions whose board differs.

### What the published ruler misses, which a game can show and a benchmark cannot

The thing this setting has that the benchmark does not is a **perfect oracle**: minimax gives the
correct answer at every one of the 4,520 live boards, so competence is known completely and a
metric's resolution can be checked against it. The v4 lane names ruler resolution as its binding
constraint (`LEADS.md` L8); this is the one thing a game can supply.

Retraining the identified items alone - the literal reading of `STATE_OF_ENTAILMENT.md`'s
*"retraining the corrected set yields a model consistent with the corrected data"* - at n = 1,
**one** edited position:

| | value |
|---|---|
| Efficacy (p > 0.5 on the new target) | 1.0000 |
| **Preservation (Eq. 7)** | **1.1309** - better than untouched |
| **optimal move over all 4,520 boards, oracle-checked** | **0.7429**, down from 1.0000 |

**Preservation reads 1.13 for a model that has just lost 25.7% of its competence**, and moved in
the wrong direction while it happened. The do-nothing control reads exactly 1.0000 and the
matched control 1.0041, so the instrument's null case is clean - it is specifically blind to this
damage.

### And NEITHER would a median have caught it - a correction to this lane's own first answer

The first version of this write-up said a median of the ratios "would have caught it". The v4
lane ran the mechanism over its own record and reported that a median catches nothing on its five
weight-edit arms (mean/median 0.89 to 1.02), because the fault there is CANCELLATION rather than
skew. That prompted the same test here, and it is worse than they knew - the median fails on THIS
lane's data too. `gatefly/preservation_shape.py`, the same E_ind, n = 800 probes:

| arm | Eq.7 mean | median | p10 | frac < 0.9 | **changed-argmax** | competence (oracle) |
|---|---|---|---|---|---|---|
| `control` | 1.0000 | 1.0000 | 1.0000 | 0.00 | **0.0000** | 1.0000 |
| `memit` | 1.0094 | 1.0000 | 0.9561 | 0.06 | **0.1250** | 0.9998 |
| **`retrain`** | **1.1156** | **0.9906** | **0.0041** | **0.43** | **0.5050** | **0.7429** |
| `corpus_w` | 1.0020 | 1.0000 | 0.9806 | 0.00 | **0.1412** | 0.9998 |

**The median reads 0.9906 - within one percent of untouched - for the arm that destroyed a
quarter of the model.** So "a median would have caught it" was wrong, and wrong on the data it
was written from. What does catch it: the tenth percentile (0.0041), the fraction below 0.9
(0.43), and above all the **count of movement**, which separates `retrain` from `memit` by 4x
(0.5050 against 0.1250) where the median separates them by 0.9%.

**One honest limit on the movement count**: `memit` moves 12.5% of argmaxes while costing 0.02%
of competence, because many tic-tac-toe positions have SEVERAL optimal moves and swapping
between them is not damage. So a changed-argmax fraction is an UPPER BOUND on damage, not a
measure of it.

### The fix, and a transfer claim of this lane's that was WRONG

This lane sent that limit to the v4 lane with a prescription attached - "count movement against
the known answer rather than the model's own previous one" - and a claim that it would not
matter to them: *"on a knowledge benchmark with one correct object per probe the two coincide."*

**Both were wrong, and that lane checked rather than accepting either.** It reports that 11 of
its 46 distinct broader-context prompts carry genuinely different correct answers - not
paraphrases, but things like a parent with four children - and that those prompts carry 60% of
the probes it scores, with 82% of answers multi-word so an argmax is not even defined for them.
So the tie structure is not a quirk of a game; the benchmark has it too, and the limit applies
there MORE strongly than this lane assumed. Its figures are its own and are not reproduced here.

And the prescription was the same fault one step along: picking ONE of four correct children as
"the" known answer makes the other three look like damage. The correct form is to count against
the **SET** of correct answers, not one of them.

**Measured here, where the oracle knows the whole set exactly** (`preservation_shape.py`, same
800 indirect probes):

| arm | moved at all | **left the correct SET** | swapped WITHIN it | competence |
|---|---|---|---|---|
| `control` | 0.0000 | **0.0000** | 0.0000 | 1.0000 |
| `memit` | 0.1250 | **0.0000** | 0.1250 | 0.9998 |
| **`retrain`** | 0.5050 | **0.2412** | 0.2637 | 0.7429 |
| `corpus_w` | 0.1412 | **0.0000** | 0.1412 | 0.9998 |

**Every single movement by the two surgical arms was a swap between equally correct answers -
real damage exactly 0.0000 in both cases.** The naive count over-reported by 100% of its own
value there. On the destructive arm it over-reported by 52% (0.5050 against 0.2412), and the
set-valued figure lands on the independently measured competence drop (0.2412 against 0.2571
over the full board set, the gap being that `E_ind` is an 800-probe sample that excludes the
edited positions).

So the set-valued form is not a refinement. It is the difference between a measure that flags
12.5% of false damage on an arm that damaged nothing, and one that flags none - and between a
4x separation of the destructive arm from the surgical one and a total one.

### "Retraining the corrected set" is not one method - it is a spectrum, and the ends fail oppositely

| arm | Efficacy | competence after (oracle) |
|---|---|---|
| `retrain` - the identified items alone | 1.0000 | **0.7429** |
| `corpus` - the whole corrected distribution, uniform | **0.0000** | 1.0000 |
| `corpus_w` - the same, corrected games at 25% of each batch | **1.0000** | **0.9998** |
| `memit` - the closed-form ridge edit | **1.0000** | **0.9998** |

(n = 1; the full sweep over n = 1 to 32 is in `gatefly/runs/ttt_big.retrain.json`.)

The identified items alone install perfectly and destroy the model. The uniform corpus preserves
perfectly and installs nothing - a handful of corrected steps among 2.3 million is diluted to
nothing at that budget. **The middle works**, and matches the closed-form edit on both axes. So
the v4 lane's conclusion survives, narrowed: retraining IS reliable, for the reading that keeps
the corpus, and the mixing weight is the whole story. Its sentence does not say which reading.

Written up for that lane in the shared notes as
`FOR_V4_the_ruler_misses_catastrophic_damage.md`.

### The full spectrum, over all six set sizes

Efficacy, and competence over the 4,520 boards (the oracle measure no published metric asks):

| arm | n=1 | 2 | 4 | 8 | 16 | 32 |
|---|---|---|---|---|---|---|
| `memit` Efficacy | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| `memit` competence | .9998 | .9996 | .9991 | .9982 | .9965 | .9920 |
| `retrain` Efficacy | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 | 1.00 |
| **`retrain` competence** | **.7429** | **.8407** | **.7600** | **.6381** | **.6246** | **.7073** |
| `corpus` Efficacy | 0.00 | 0.00 | 0.25 | 0.38 | 0.38 | 0.34 |
| `corpus` competence | 1.0000 | 1.0000 | .9998 | .9993 | .9987 | .9976 |
| `corpus_w` Efficacy | 1.00 | 1.00 | 1.00 | 1.00 | **0.75** | **0.63** |
| `corpus_w` competence | .9998 | .9996 | .9991 | .9982 | .9971 | .9951 |

Three things this settles:

- **`retrain` is catastrophic at every size**, not just at n = 1: competence sits between 0.62
  and 0.84 throughout while Efficacy stays at 1.00. Fine-tuning the identified items alone is
  not a viable reading of "retrain the corrected set".
- **`corpus_w` degrades as the set grows** - Efficacy falls to 0.63 by n = 32 - while the
  closed-form edit holds 1.00 at every size. At this budget, retraining scales worse than
  editing in the thing editing is supposed to be bad at.
- **`control` is exactly 1.0000 / 1.0000 / 1.0000 on competence, IFR and Preservation at every
  size.** The instrument's null case is clean, so the rest of the table is readable.

### RJ's hypothesis: the figures DO move, and not all in the good direction

*"Those figures can be adjusted better by removing or adding neurons based on the gate patterns
such that the math doesn't overlap dimensions."*

The mechanism was registered before the run. **GROW** adds feed-forward neurons that fire on one
case each, with ZERO output columns so the net's function is bit-identical before the edit (a
plant checks that, and a second plant checks that a growth with non-zero columns WOULD change
it). Each new neuron is a new coordinate of the key space, orthogonal to the existing ones, so
the edit gets private dimensions: `a` rises, `c` does not. **PRUNE** removes the dimensions
carrying the most shared key mass across the cases.

#### First: did the arms do what they claim? MEASURED, not asserted (REQ-GF-5c)

The mean crowding fraction `c/a` of the EDIT'S OWN KEYS, and the median `a`:

| | n=1 | 2 | 4 | 8 | 16 | 32 |
|---|---|---|---|---|---|---|
| `memit` mean c/a | 0.0000 | 0.0000 | 0.0032 | 0.0327 | 0.0459 | **0.1112** |
| **`memit_grow` mean c/a** | 0.0000 | 0.0000 | **0.0001** | **0.0000** | **0.0000** | **0.0000** |
| `memit_prune` mean c/a | 0.0000 | 0.0006 | 0.0055 | 0.0253 | 0.0485 | **0.1096** |
| `memit` median `a` | 220 | 254 | 268 | 250 | 250 | 250 |
| **`memit_grow` median `a`** | 420 | 597 | 917 | 1834 | 1894 | **2014** |

- **GROW does exactly what it claims.** Crowding is driven to **0.0000 at every size**, while
  `memit`'s own crowding RISES with n to 0.1112. Median `a` goes up **8.2x**. The grown
  coordinates measure as perfectly one-hot across cases: mean own coordinate 1.659, mean largest
  OTHER coordinate **exactly 0.0**. That is measured after the fact, not inferred from the code.
- **PRUNE DOES NOT.** Removing the 16 dimensions with the most shared key mass moved the edit's
  crowding from **0.1112 to 0.1096** - a 1.4% reduction, essentially nothing. The arm failed at
  its stated mechanism. Everything `memit_prune` does to the metrics is therefore attributable
  to the collateral function change, **not** to reduced overlap, and must not be read as evidence
  about crowding.

#### Then: what the working arm bought

| | `memit` | `memit_grow` | `memit_prune` |
|---|---|---|---|
| IFR across n = 4,8,16,32 | 0.8181, 0.6943, 1.1496, 1.0786 | **1.0495, 1.0265, 1.0006, 1.0124** | 0.8899, 0.8169, 0.5846, 0.8428 |
| **IFR spread** | **0.4554** | **0.0489** | 0.3053 |
| mean \|Preservation − 1\| | 0.0155 | **0.0034** | **0.0808** |
| Efficacy, every size | 1.0000 | 1.0000 | 1.0000 |
| competence at n=32 | 0.9920 | **0.9929** | 0.9909 |

**Against the registered predictions:**

| prediction | verdict |
|---|---|
| grow: mean `c` DOWN | **CONFIRMED** - to exactly 0.0000 at every size |
| grow: Efficacy UP | **NOT TESTABLE** - `memit` is already 1.0000 at every size. No headroom |
| grow: IFR DOWN (deeper) | **REFUTED** - it goes UP, to 1.0 |
| grow: Preservation UP or unchanged | **CONFIRMED** - 4.6x closer to 1.0 on average |
| prune: Preservation DOWN | **CONFIRMED** - 5x further from 1.0 - but for the wrong reason |
| prune: Efficacy UP at small sizes | **NOT TESTABLE** - saturated at 1.0000 |

**What growing actually does is make the edit PREDICTABLE.** Its IFR spread is **9.3x smaller**
than the plain edit's: pinned at 1.00-1.05 at every size, against 0.69-1.15. A private dimension
is a channel nothing else reads, so the edit lands on its target and disturbs nothing - which is
full Efficacy, Preservation at 1.0, and the original line of play left **exactly as deducible as
before**. **Reducing the overlap buys precision and spends depth.** It is a dial between the two,
not an improvement in both, and RJ's framing - "so the math doesn't overlap dimensions" - names
the dial correctly even though the direction was not the one predicted.

The Efficacy row is worth dwelling on: there was nothing to win, because the closed-form solve
already prices in the interference and reaches 1.0000 unaided. That is the same shape as the
ratchet lane's own headroom result - the joint solve already pays for cross-talk optimally - now
seen from the capacity side.

#### "It might only work in limited context?" - NO, and the measurement says why

The benefit does not fade with set size; if anything it **grows**, because `memit`'s own crowding
rises with n (0.0000 to 0.1112) so there is more for growing to remove. At n = 32 the grow arm
still drives crowding to 0.0000, still pins IFR at 1.0124, still holds Preservation at exactly
1.0000, and is the only arm whose competence BEATS the plain edit (0.9929 against 0.9920).

**The honest limit on that answer:** the key space is 256-dimensional and the largest set tested
is 32, so there is ample room for 32 private coordinates. The capacity argument says the limit
must appear as n approaches the hidden width, and **n = 32 of 256 did not reach it**. "Not
limited at these sizes" is what was measured; "never limited" is not.

#### The thing that nearly hid itself, and what it says

Growing also helps the retraining arm: `corpus_w_grow` beats `corpus_w` on Efficacy at the two
sizes where `corpus_w` starts to fail (0.8125 against 0.7500 at n = 16; 0.6562 against 0.6250 at
n = 32), at identical competence. Small, consistent, and in the direction the mechanism predicts.

### The crash that was the mechanism

The first full run **crashed** at n = 16 with `LinAlgError: Singular matrix`. The cause is the
mechanism itself: a neuron grown to fire on ONE case has exactly zero mass in a covariance taken
over a corpus that does not contain that case, so `lambda C` acquires a zero eigenvalue. That is
not a nuisance - it is RJ's hypothesis stated in the arithmetic. **A dimension almost nothing
uses gets almost no ridge, so it is cheap to write to**, and in the limit the ridge vanishes and
the solve is undefined. The fix is a correctness fix, not a workaround: the covariance for a
grown net is taken over a corpus that includes the edited positions, because a C that excludes
every position where a dimension is alive is the wrong C for that net. The refusal path is kept
and planted, so a genuinely singular ridge is REFUSED rather than quietly pseudo-inverted.

---

## Step 4 - shrink it, and tell "faithful" apart from "the game is easy"

`gatefly/shrink.py`, `gatefly/shrink_save.py`, read from `gatefly/runs/ttt_big.shrink.json`

Cutting `blocks.3.ffwd` of `ttt_big` from 256 neurons, by `a` descending (the ratchet lane's
budgeted-selection rule), against **gate-ordering** and against **random cuts over 8 seeds at
every budget**.

| budget k | a-order | gate-order | random mean | random BEST of 8 | a beats best random? |
|---|---|---|---|---|---|
| 224 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | tie |
| 192 | 1.0000 | 1.0000 | 0.9999 | 1.0000 | tie |
| 160 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | tie |
| 128 | 0.9996 | 0.9998 | 0.9988 | 0.9996 | tie |
| **96** | 0.9982 | 0.9991 | 0.9941 | 0.9980 | **yes** |
| **64** | 0.9980 | 0.9987 | 0.9906 | 0.9960 | **yes** |
| **48** | 0.9962 | 0.9969 | 0.9917 | 0.9960 | **yes** |
| **32** | 0.9958 | 0.9892 | 0.9916 | 0.9949 | **yes** |
| 16 | 0.9825 | 0.9841 | 0.9881 | 0.9947 | **no - random wins** |
| 8 | 0.9843 | 0.9887 | 0.9887 | 0.9925 | **no - random wins** |

(optimal move over the 4,520 distinct live boards)

### The verdict: it PARTIALLY transfers, and the part that does not is specific

- **`a`-ordering beats the best of eight random cuts at k = 96, 64, 48 and 32**, and the margin
  over the random MEAN is 1.8 to 2.4 standard deviations there. The GPT-2 budgeted-selection
  result holds in that range.
- **At k = 16 and 8 random wins.** The claim "ranking by `a` picks the best available subset at
  EVERY size" does NOT hold here. Reported as it measured.

  **And that claim was weaker than this lane was told.** It arrived in this lane's brief as an
  established result. After seeing the k = 16 and 8 rows the ratchet lane went and checked its
  own provenance and reported, unprompted, that the phrase came from **15 subsets of FOUR keys
  at one GPT-2 layer** - four addresses being read as a law. So this is not a solid result that
  failed to transfer; it is an over-general claim meeting the sizes where it breaks. The lane
  has narrowed it in RJ's scorecard with the range it does hold over. Recorded here because the
  difference matters: "partially transfers" and "was always narrower than stated" are not the
  same finding, and the second one is the true one.
- **At k >= 128 nothing separates** because the game is too easy at that budget - which is the
  failure mode this was designed to expose, visible as a row of ties rather than as a success.
- **Gate-ordering beats `a`-ordering in the middle and collapses at k = 32** (0.9892 against
  0.9958), which is the background's "crowding orders backwards at small sizes" showing up here.

### The gate's own prediction: REFUTED, and the reason is exact

Every one of the 256 neurons removed on its own, with the damage measured as the mean total
variation of the move distribution over all 4,520 boards (damage range 0.00166 to 0.03390,
median 0.00971).

> **Which quantity this is, because two lanes measure cost differently.** This is a mean TOTAL
> VARIATION over positions: `0.5 * sum_m |P_parent(m) - P_child(m)|`, bounded in [0, 1], linear
> in the probability gap. The ratchet lane measures edit cost as a **KL at the read position**,
> which is unbounded and punishes a child that puts near-zero mass where the parent was
> confident. **A TV and a KL are not the same number and must never be read as one.** The same
> 256 removals are therefore scored both ways below, so the verdict can be seen to be about the
> gate rather than about the choice of divergence.

| predictor | Spearman rho | p | n |
|---|---|---|---|
| **gate = g(a - c)** | **0.1210** | **0.0532** | 256 |
| `a` alone (addressability) | **0.3344** | **4.19e-08** | 256 |
| `c` alone (crowding) | **0.3459** | **1.31e-08** | 256 |

### That verdict was an artefact of the damage measure, and the ratchet lane's question caught it

The ratchet lane asked for one line distinguishing this lane's mean TOTAL VARIATION from the KL
at the read position that it uses. Measuring it instead of writing the line **flipped the
headline null.** The same 256 removals, scored both ways:

| predictor | vs mean TV | vs KL at the read position |
|---|---|---|
| **gate = g(a - c)** | rho 0.1210, **p 0.0532** | rho 0.3321, **p 5.25e-08** |
| `a` alone | rho 0.3344, p 4.19e-08 | rho 0.6125, p 9.37e-28 |
| `c` alone | rho 0.3459, p 1.31e-08 | rho 0.6234, p 5.75e-29 |

and TV and KL agree with each other at **rho 0.9060** (p 8.09e-97). So the two measures rank the
removals almost identically, and yet the gate's verdict flips across the pre-registered 0.05 bar
depending on which one is used. **"DOES NOT TRANSFER" is withdrawn as stated.** It was a fact
about a choice of divergence that no reader of the original table could see.

What survives both measures, and is the real finding: **`a` and `c` each predict removal damage
about twice as strongly as the composite gate** - 0.61 and 0.62 against 0.33 under KL, 0.33 and
0.35 against 0.12 under TV. So "for predicting what a removal costs, use the two halves rather
than the combination" holds; "the gate predicts nothing" does not.

The code was changed, not just the prose: `shrink.py`'s verdict now names the measure it rests
on and reports **MEASURE-DEPENDENT** - refusing to conclude - when the two disagree, with a plant
proving all three outcomes are reachable. A label that flips on a choice the reader cannot see is
worse than no label.

---

**The mechanism behind the gap is unchanged and holds under both measures:** the composite gate
predicts worse than its parts because `a` and `c` both correlate POSITIVELY with damage and the
gate SUBTRACTS them, so the subtraction cancels signal. What does not survive is the stronger
conclusion drawn from TV alone. The usable result for the ratchet lane is the narrower one: for
predicting what a removal costs, use `a` and `c` separately, not `g(a - c)`.

### The faithfulness check that outcome alone cannot give

Game outcome says nothing here - every budget down to k = 8 still scores above 0.98 and still
never loses. What separates them is the agreement with the PARENT on the 2,406 positions where
exactly one move is optimal:

| k | top-1 agreement (all 4,520) | top-1 on the 2,406 ONE-BEST positions | tv there |
|---|---|---|---|
| 224 | 0.7155 | **1.0000** | 0.0004 |
| 160 | 0.7223 | **1.0000** | 0.0028 |
| 128 | 0.7139 | 0.9996 | 0.0083 |
| 96 | 0.7066 | 0.9971 | 0.0168 |
| 64 | 0.7150 | 0.9967 | 0.0245 |
| 32 | 0.7131 | 0.9925 | 0.0391 |
| 16 | 0.6982 | 0.9701 | 0.0766 |

The overall top-1 agreement sits near 0.71 at EVERY budget, including the ones that lose nothing:
that is because most positions have several optimal moves and the child picks a different one,
which is not a defect. The one-best column is the honest measure and it degrades smoothly, which
is what tells a faithful cut from a lucky one.

### The net that was saved

`gatefly/runs/ttt_shrunk.*`, flyable at `?net=ttt_shrunk`.

| | before | after |
|---|---|---|
| neurons at `blocks.3.ffwd` | **256** | **160** (96 removed) |
| transformer blocks | 4 | 4 - **unchanged**; this cut removes neurons, not layers |
| parameters | 201,226 | 188,842 (6.2% fewer) |
| optimal on the 4,520 boards | 1.000000 | **1.000000** |
| top-1 on one-best positions | - | **1.0000**, identical to its parent on all 2,406 |
| vs perfect | 10 games, 10 draws | **10 games, 10 draws, 0 losses** |
| vs random (1,000 games both seats) | 896W 104D 0L | 882W 118D **0L** |

And the gate arithmetic predicted its own consequence: with 96 of 256 writers gone from the same
64 dimensions, the site's median crowding fell from **0.8335 to 0.7928** and its median gate rose
from **0.1454 to 0.1779**. Fewer writers, more of each write arrives.

**No layer was removed.** The premise was "reduce the layers to the minimum set that copies the
action of the gates"; what this measured is that the reducible thing here is NEURONS WITHIN a
block, and that no block's feed-forward could be taken to zero without the net losing positions.
Saying that plainly is better than reporting a layer count that did not move.

---

## Step 5 - pong, on a new kind of blueprint

`gatefly/pong.py`, `gatefly/NEURAL_BLUEPRINT.md`

**What a blueprint is here, and what does not fit.** `blueprint/city/data/pong_3d.js` holds
`window.BPV3D` with `bp2d[i].model = { nodes, wires, comments, box, notes }`; a node is
`{ name, cls, x, y, w, h, title, sub, compact, pill, knot, color, pins, delegate, refs }`, a pin
is `{ id, name, dir, exec, color, label, def, linked, x, y }`, a wire is
`{ from, to, exec, color, a, b }`. Pong's `BP_Ball` is 23 nodes and 30 wires.
`NEURAL_BLUEPRINT.md` lists field by field what a net cannot use - authored `x/y/w/h`, named
`pins`, the `exec` channel, `cls`/`title`/`refs` - and the three things a net needs that have no
field at all: a per-unit measured scalar, a live channel, and a stated edge cap.

**The pong net.** The game is exact and seeded; the teacher is the closed-form interception
point, checked against simulating the ball forward (they agree to 0.0121 of a court height). A
plant shows two oracle paddles rally 20,000 steps without conceding, and that a motionless paddle
concedes 276 times in 20,000 - so the game can be lost and the rally figures mean something.

| | measured |
|---|---|
| parameters | **4,673** (6 -> 64 -> 64 -> 1) |
| vs perfect interception, 120 games | median rally **84.5**, mean 81.7, max 117, conceded 8 |
| vs a lagging opponent | median rally 87.5, conceded 12 |
| vs a random opponent | scored 119, conceded 1 |

Read from `gatefly/runs/pong.meta.json`. The page plays it live with a drawn court.

**Why an MLP and not a GPT:** pong's input is a fixed 6-number state, not a sequence, so a causal
transformer's attention would have nothing to attend to. The blueprint format carries both kinds,
which is the point - `gate_read.py` branches on the checkpoint's own `kind`, never on a filename.

---

## What is NOT verified

Said plainly, because the house rule asks for it.

1. **The rAF frame rate with the page on screen.** The Browser pane stayed hidden for this whole
   session, which throttles `requestAnimationFrame`, so the only honest frame number is the draw
   cost timed around `gl.finish()` (0.015 ms median). Whether the page holds 60 Hz in front of a
   person has not been checked by a person. It is a 0.015 ms draw, so it should; "should" is not
   a measurement.
2. **Nothing here is a language model.** Tic-tac-toe and pong have perfect oracles, which is what
   makes every verdict checkable, and is also exactly what a knowledge benchmark does not have.
   No result transfers to GPT-2 without being measured there.
3. **One site, one seed family.** Every edit and every cut is at one feed-forward down-projection
   (`blocks.3.ffwd.net.2.weight` for `ttt_big`), with one case-selection seed.
4. **The training set is the whole input space.** These nets memorise a complete map; nothing
   here measures generalisation, and the shrinking results are about a fitted function.
5. **A transcript model has an order.** A board is presented to the net through ONE canonical
   move order (`metrics.prefix_of`); a different order is a different prompt for this model. The
   same order is used for every arm, so no arm gains from it, but the figures are order-specific.
6. **The IFR denominator is small at small n.** At n = 1 and n = 2 the chain set `D'` holds 0 or
   1 chains, and the published formula returns 0.0 for an empty `D'`. Those IFR cells are not
   informative and the denominator is printed beside every one of them rather than left out.
7. **`a`-ordering at k = 16 and 8 loses to random, and I did not chase why.** It is reported as
   it measured.
8. **The grow arm's limit was not reached.** 32 private coordinates in a 256-dimensional key
   space is not a capacity test. Whether the benefit survives as the set size approaches the
   hidden width is UNMEASURED.
9. **The prune arm failed its own mechanism** (crowding 0.1112 -> 0.1096) and I did not design a
   second pruning rule that works. Its metric movements say nothing about crowding.
10. **Efficacy had no headroom on this system.** The closed-form edit reaches 1.0000 at every
   size unaided, so no arm could be shown to improve it here. A system where editing fails more
   often would be needed to test that half of the prediction.

## The files to open

| what | where |
|---|---|
| **the fly-through** | `harness/gatefly/index.html` (`?net=ttt_big`, `?net=ttt_shrunk`, `?net=pong`) |
| how to run it | `harness/gatefly/README.md` |
| the use case, written before the code | `gatefly/UC_GATEFLY.md` |
| the prediction, registered before the arms ran | `gatefly/PREREG_GATE_CAPACITY.md` |
| what a blueprint is and what does not fit a net | `gatefly/NEURAL_BLUEPRINT.md` |
| the gate arithmetic and its agreement plant | `gatefly/gate_math.py` |
| play records | `gatefly/runs/ttt_small.play.json`, `ttt_big.play.json` |
| the shrink sweep and the damage correlation | `gatefly/runs/ttt_big.shrink.json` |
| the retraining arms | `gatefly/runs/ttt_big.retrain.json` |
| the shrunk net | `gatefly/runs/ttt_shrunk.*` |

Every module runs its own plants with `--selftest`:

```bash
for m in gate_math ttt data_ttt net train_ttt play gate_read metrics shrink retrain pong; do py -X utf8 -I gatefly/$m.py --selftest; done
```
