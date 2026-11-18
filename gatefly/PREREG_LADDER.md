# Pre-registration: what fall does CAPACITY predict, before the ladder reports?

**Written 2026-11-18 while `gatefly/ladder.py` is still running and before any rung above 3,3,3
has reported.** That timing is the whole value of this file; a version written afterwards would
be indistinguishable from a rationalisation. The run is `ladder2.log`, launched before this file
existed, and its output lands in `gatefly/runs/ladder.json`.

## Why this exists

The ratchet lane, 2026-11-18, on the ladder's design:

> "Holding the net shape and edit count fixed across rungs is right, and it means a fall is
> attributable to the task. But it also means the editor faces a fixed budget against a growing
> problem, so SOME fall is expected on capacity grounds alone and is not the editor breaking. If
> you can state in advance roughly what fall the capacity argument predicts, a break becomes
> 'worse than capacity explains' rather than 'it fell' - and if it never breaks, you will be able
> to say whether that is the editor being robust or the ladder never getting hard enough."

That is correct and the ladder as designed cannot distinguish those. This file fixes that by
committing to the distinction before the data exists.

## The mechanism capacity would act through, stated so it can be wrong

The edit solves `W += R K^T (lambda C + K K^T)^-1` at `blocks.3.ffwd.net.2.weight`, whose key
space has **H = 256** dimensions (4 x n_embed) and which writes into **E = 64**. The edit
installs **p = 16** keys, and the net shape and p are held fixed at every rung.

Capacity cannot press on the edit through p/H, which is 16/256 = 0.0625 at every rung and does
not move. It can only press through **the geometry of the keys themselves**. As the game grows,
the number of distinct positions the net must represent grows by orders of magnitude - roughly
4,520 live positions at 3,3,3 against far more at 4,4,4 - while the space available to represent
them does not. If the net responds by packing distinctions closer together, the 16 edit keys
become more aligned, their mutual **crowding `c` rises**, the per-key gate `g(a - c)` falls, and
less of each requested change lands. That is the capacity story, and it is the only route by
which it can operate here.

**The quantity that tracks it is already collected at every rung**: `mean_crowding_fraction`
(mean of `c/a` over the edit's keys), with `median_a` and `median_gate` beside it.

## The predictions, registered

| # | if this is observed | then |
|---|---|---|
| **P1** | Efficacy falls **and** `mean_crowding_fraction` rises materially with it | the fall is **EXPLAINED BY CAPACITY**. Not the editor breaking. Reported as the task outgrowing the representation, which is a fact about the net, not about the solve. |
| **P2** | Efficacy falls **while** `mean_crowding_fraction` stays flat | the fall is **NOT capacity**. This is the editor breaking for another reason, and it is the case worth the investigation RJ asked for. |
| **P3** | Efficacy stays 1.0 **and** `mean_crowding_fraction` stays flat | **THE LADDER NEVER GOT HARD ENOUGH.** Not a demonstration of robustness. The honest report is that the regime was not reached and a harder family is needed. |
| **P4** | Efficacy stays 1.0 **while** `mean_crowding_fraction` rises materially | **ROBUSTNESS, genuinely.** The editor absorbed rising interference without losing the target. This is the only branch where "it did not break" is a finding rather than an absence. |

**"Materially" is fixed here, before the data:** a rise of at least **0.05 absolute** in
`mean_crowding_fraction` between the easiest and hardest competent rung. The tic-tac-toe figure
for the same site and edit count is **0.0459 at n = 16** (`ttt_big.retrain.json`), so 0.05 is
about a doubling and is not a threshold tuned to whatever arrives.

## What this file does NOT let me claim

- It does not predict a NUMBER for the fall. The capacity argument gives a direction and a
  companion quantity, not a magnitude, and inventing a magnitude to look rigorous would be the
  guessing this repo forbids.
- `mean_crowding_fraction` rising is **consistent with** capacity pressure, not proof of it. A
  third thing could move both. What it rules out is the specific confusion the ratchet lane
  named: reading any fall as the editor breaking.
- The ladder measures **4 rungs on one net family with one seed**. P3 in particular is a
  statement about this ladder, not about editing.
- Key ALIGNMENT (mean pairwise cosine of the edit's keys) would be the more direct measure of
  the mechanism and is **not collected by the running job**. `c/a` is its consequence rather
  than the thing itself. If the result lands on P1 or P4, alignment should be measured before
  the explanation is believed.

## The competence guard, which is separate and already in the code

A rung whose net cannot PLAY the game is not a harder editing problem, it is a worse net. The
ladder measures holdout competence before any edit and marks any rung below 0.90. None of the
four predictions above apply to a rung that fails that bar; such a rung is excluded, and the
exclusion is reported rather than quietly dropping the row.

---

# AMENDMENT, 2026-11-18 — recorded AFTER the 4,4,3 row landed, and labelled as such

The four branches above are unedited. This section is added after seeing rungs 3,3,3 / 3,4,3 /
4,4,3 and before 4,4,4 reports, and it exists because the ratchet lane raised an objection that
the original file does not answer.

## The objection

> "P3 says crowding FLAT, but flat-to-four-decimals across a doubling of the position count is
> strong evidence that your key geometry is insensitive to position count in a way that may
> itself be a ceiling — 16 keys in 256 dimensions may simply be too sparse for packing to bite
> at ANY board size you can build. If that is so, P3 is not 'the ladder was too easy', it is
> 'this key budget cannot be made to crowd'."

It applies with more force to the branch that actually fired. The ladder did **not** land on P3:
at 4,4,3 Efficacy fell to 0.938 while crowding fell from 0.0540 to 0.0485, which is **P2 — not
capacity**. But P2's whole content is "crowding did not rise", and that is informative *only if
crowding is capable of rising*. If `mean_crowding_fraction` were pinned near 0.05 by the key
budget, P1 and P2 would be indistinguishable and the branch structure would be empty.

## The control, and what it says

`mean_crowding_fraction` at the same site and the same net shape (4 blocks, 4 heads, 64 wide),
sweeping the EDIT COUNT instead of the board, from `ttt_big.retrain.json`:

| n | 1 | 2 | 4 | 8 | 16 | 32 |
|---|---|---|---|---|---|---|
| mean c/a | 0.0000 | 0.0000 | 0.0032 | 0.0327 | **0.0459** | **0.1112** |

**The quantity moves, and moves hard: 2.4x from merely doubling the edit count at the same
budget the ladder uses.** So 16 keys in 256 dimensions is not too sparse for packing to bite;
packing bites readily when the keys are more numerous. The flatness across rungs (0.0540,
0.0540, 0.0485) is therefore a property of the BOARD axis, not a ceiling of the measure, and the
P1/P2 distinction holds.

**What this does NOT establish**, because the objection deserves the exact answer rather than a
reassuring one: these figures come from `ttt_big`, which shares the site and the net shape with
the ladder's nets but is a DIFFERENT CHECKPOINT, trained on the full enumeration rather than on
sampled games. The clean version measures the edit-count sweep on the ladder's own 4,4,3 net.
The ladder does not currently save its checkpoints, so that run is not yet possible; saving them
is the change, and until it is run this control is **suggestive and cross-checkpoint, not
same-net**.

## And the correction to the framing the lane offered

That lane argued P3 should be sent as "the mechanism did not engage, here is the number showing
it" rather than as "the ladder did not break", and that the identical-crowding figure is a
positive finding about the mechanism rather than an absence. That is right and the framing is
adopted — but it describes a branch that did not fire. The ladder broke. What carries over is
the standard: a flat companion quantity is reported as a measured property of the mechanism with
its number, never as a failed experiment.
