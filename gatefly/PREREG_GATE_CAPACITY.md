# Pre-registration: does changing the neuron set by the gate pattern move the published figures?

**Registered 2026-11-18, before any arm was run.** REQ-GF-5a, and the v4 lane's REQ-BURN-01: a
prediction written after the result is indistinguishable from one written before it. Nothing
below is edited after the run; the verdicts go in `gatefly/runs/ttt_big.retrain.json` and in the
report, beside these predictions.

## The claim being tested

RJ, 2026-11-18: *"Those figures can be adjusted better by removing or adding neurons based on the
gate patterns such that the math doesn't overlap dimensions. It might only work in limited
context?"*

The figures are the ones his table carries - Efficacy, Propagation, IFR, Preservation - which are
ThinkEval Eq. 6 and Eq. 7 over the KnowGIC benchmark, the ruler the v4 lane scores its arms by.

## The mechanism, stated so it can be wrong

The closed-form edit solves `W += R K^T (lambda C + K K^T)^-1`. What lands at key j is
`gate_j = g(a_j - c_j)`: the crowding `c_j` is what the other keys already span of key j's
direction, and it SUBTRACTS. So if the edit's keys overlap, each one gets less of its own write.

- **GROW** adds hidden neurons that fire on one case each. A new hidden neuron is a NEW
  COORDINATE of the key space, orthogonal to every existing one by construction, so each case
  gains a private direction: `a` rises, `c` does not. Output columns are zero, so the net's
  function is unchanged before the edit - any metric difference is the edit's, not the growth's.
- **PRUNE** removes the hidden dimensions carrying the most shared key mass across the cases,
  which is where the inter-case crowding flows. It lowers `c`, but it also lowers `a` and it
  changes the net's function, which is measured.

## The predictions

| arm | metric | predicted direction against `memit` / `retrain` | why |
|---|---|---|---|
| `*_grow` | Efficacy | **UP** | each key gets its own dimension, so more of each write lands |
| `*_grow` | IFR | **DOWN** (deeper) | a write that lands fully displaces more of the old line |
| `*_grow` | Preservation | **UP or unchanged** | private dimensions means less spill onto other keys |
| `*_grow` | measured mean c | **DOWN** | this is the mechanism; if c does not fall, the arm did not do what it claims |
| `*_prune` | Efficacy | **UP at small sizes only** | removing shared dimensions lowers c, but also lowers a, and a falls faster once many cases share everything |
| `*_prune` | Preservation | **DOWN** | pruning changes the function for every position, not only the edited ones |
| all | everything | **flat beyond some set size** | RJ's own "it might only work in limited context": with p keys in a key space of H dimensions, private coordinates run out |

**The size at which grow must stop helping, predicted before the run:** the growth adds one
coordinate per case, so it cannot run out on capacity grounds at these sizes. If a benefit at
n = 1 or 2 is gone by n = 16 or 32, the limit is NOT capacity and the "limited context" clause is
about something else - which would itself be the finding.

## What would REFUTE each arm

- `grow` is refuted if measured mean `c` does not fall, or if Efficacy does not rise while `c`
  does fall. The second is the sharper one: it would say the gate's subtraction is not what
  limits the edit.
- `prune` is refuted if Efficacy does not rise at ANY size.
- The whole hypothesis is refuted if no arm separates from `memit` by more than the control
  arms separate from each other.

## The null that makes the rest readable

`control` must give IFR exactly 1.0 and Preservation exactly 1.0. If doing nothing moves the
ruler, no other figure here means anything. This is checked as a plant and the run refuses
otherwise.

## What this cannot settle

One net, one game, one site, one seed family. Tic-tac-toe has a perfect oracle, which is why the
metrics' resolution can be measured here at all, but it is not a language model and nothing here
transfers to one without being measured there.
