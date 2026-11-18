# Why you cannot perfectly edit — what this lane can answer, and what it cannot

RJ, 2026-11-18: *"I think you have enough information to answer why you can't perfectly edit. Do
you not? If not why not?"*

**Partly.** There is one part of the answer that is settled and is not going away, and a larger
part that is open. The tree says exactly which is which: 25 nodes, **4 settled or confirmed, 21
open**. Writing both halves down is the point of this file.

---

## The part that IS answered, and is arithmetic rather than engineering

**You cannot write more independent facts into a site than the site has directions, and well
before that limit interference takes a measurable, predictable fraction of every write.**

The write that lands at address *j* is `gate_j = g(a_j − c_j)` with `g(x) = x/(1+x)`, where
`a_j` is how reachable the address is and `c_j` is how much of its direction the *other* writes
already span. `a_j` depends on no other key. `c_j` is the interaction, so it rises with the
number of keys by construction. That is not a property of MEMIT or of any particular solve — it
is the geometry of writing p things into H directions.

**The degenerate limit, computed exactly:** n identical keys each receive `g(na)/n`.

| n identical keys | each receives | 1/n | ratio |
|---|---|---|---|
| 1 | 0.5000 | 1.0000 | 0.50 |
| 8 | 0.1111 | 0.1250 | 0.89 |
| 64 | 0.0154 | 0.0156 | 0.98 |
| 1024 | 0.000976 | 0.000977 | **0.999** |

So the share per edit falls as **1/n** and — this matters — **never reaches zero**. The honest
statement is not "the gate shuts" but "the gate divides". An edit does not become impossible; it
becomes a 1/n share of what you asked for.

**And it happens on a real net at the rate the arithmetic predicts.** Same site, same model,
varying only the number of simultaneous edits:

| n | 1 | 2 | 4 | 8 | 16 | 32 | 256 |
|---|---|---|---|---|---|---|---|
| mean c/a | 0.0000 | 0.0000 | 0.0032 | 0.0327 | 0.0459 | 0.1112 | **0.9354** |

At n = 256 keys into a 256-dimensional key space — the pigeonhole point, reached by construction
— Efficacy falls to **0.945** (242/256, 95% CI [0.9103, 0.9671], separated from a perfect
[0.9852, 1.0000]) and the model's competence falls from 0.9880 to **0.6967**.

**And making the TASK harder does not do this.** Across four board sizes, 9 cells to 16, crowding
went 0.0540, 0.0540, 0.0485, 0.0473 and Efficacy never left 1.0000. The pressure is the **edit
budget**, not the problem's difficulty — which was this lane's founding assumption and is
refuted on its own data.

### Every escape has a measured price

- **Grow capacity** — add a private dimension per edit. Drives crowding to **exactly 0.0000** at
  every set size and raises addressability 8.2x. The price: IFR moves from the plain edit's
  0.69–1.15 to **1.00–1.05**. A private channel is one nothing else reads, so the edit lands
  perfectly and **stops propagating**. It buys precision and spends depth. It is a dial, not a
  fix.
- **Retrain instead** — fails in both directions depending on mixing. Items only: Efficacy
  1.0000, competence **0.62–0.84**. Uniform corpus: competence 1.0000, Efficacy **0.0000**. The
  weighted middle works at small n and decays to Efficacy 0.63 by n = 32.
- **Spread over layers** — what MEMIT does. But editing one layer moves the next layer's keys by
  **1.799** against a key norm of 9.34, so a layer window is a sequence of different problems,
  not one problem solved in parts.
- **Prune the crowded units** — tried and **failed its own mechanism**: crowding moved 0.1112 to
  0.1096, a 1.4% reduction. Its metric effects were collateral damage, not reduced overlap.

---

## The part that is NOT answered, and why not

The capacity bound above is about **writing**. A perfect editor needs three other things, and
this lane has barely touched them. From the tree:

**E1 — SPECIFY (3 nodes, 0 settled).** You cannot name the change exactly. What *should* change
as a consequence is a closure nobody enumerates for real knowledge; what should *not* change is
an unbounded complement, so preservation is always measured on a sample. Measured here: a
Preservation of **1.1309** over an 800-probe sample for a model that had just lost 25.7% of its
competence. The sample said nothing was wrong.

**E2 — LOCATE (3 nodes, 0 settled).** The site is a free parameter. **Every number in this
document is from one weight matrix**, chosen to match a sibling lane's. Whether any of it is a
property of editing or of `blocks.N.ffwd.net.2.weight` is untested, and registered as
`site-sweep`.

**E3a.2 — the linear/nonlinear gap (open, nothing measured).** The solve is linear; the behaviour
it must produce is not. This lane measures what lands *at the key* and what changes *at sampled
positions* — **never the relation between them**. So "the gate says 94% of your write arrived"
and "the model now behaves correctly" are two numbers this lane has never connected. That is
arguably the largest hole, because the whole gate story is about the first and every user cares
about the second.

**E4.1 — the oracle exists only for games.** Everything above is checkable because minimax gives
the correct answer at all 4,520 positions exactly. That is what a knowledge benchmark cannot
supply and is why these results are offered to the benchmark lanes as *questions* rather than as
transfers.

---

## So: do I have enough?

**For one mechanism, at one site, on a system with an oracle — yes**, and the answer is the
capacity law above with its 1/n rate, its measured confirmation, and the price of each escape.

**For "a perfect editor" — no**, and the missing pieces are not vague. They are 21 named nodes,
of which the three that would change the answer most are: whether any of this survives a change
of site; whether what lands at the key predicts what changes in behaviour; and whether a
specification of "everything else" can be written down at all.

The thing worth saying plainly: **the capacity half is proven and will not be engineered away.**
It is pigeonhole plus an identity. The other three quarters of the tree are engineering, and
might be.
