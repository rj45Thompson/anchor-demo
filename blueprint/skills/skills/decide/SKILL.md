---
name: decide
description: |
  Route a reasoning decision through the morphological reasoning matrix
  instead of asking the user. Use when you're about to ask "should I do
  A or B?" / "is X feasible?" / "is this in scope?" / "should I build
  infrastructure for this?" / "how deep to investigate?" — the matrix
  has 23 calibrated decision-shapes with recommended resolution
  strategies (try-it, prior-art, ask-user, cheap-llm, ...) and cost +
  reliability estimates per cell.

  Trigger phrases: /decide, "should I", "is X worth", "which of these",
  "build infrastructure", "ask the user about", "how should I approach".

  After running the lookup, take the recommended primary strategy. If
  the lookup returns no_match, that itself is signal — add the new
  shape to reasoning_matrix.json.
allowed-tools: Read, Bash
---

# /decide — reasoning-matrix lookup

When a decision can be routed through the matrix instead of asking
the user, do this:

```bash
py "<workspace>/Tools/Copilot pilot/copilot pilot/proof/neurogolf_2026/apply_reasoning_matrix.py" \
   --decision "<the decision shape, e.g. 'pick between N options'>"
```

Read the matched shape + primary strategy + fallback chain + cost +
reliability. Take the primary strategy.

## Common shapes and what to do

| Decision shape | Primary strategy | What I do |
|---|---|---|
| `pick_between_n_options` | `try_it` | write a small benchmark, run it, pick winner |
| `estimate_feasibility` | `try_it` | time-box a 10%-of-budget probe |
| `schema_design` | `prior_art` | look up Bertin / D3 / model-card patterns; build small instance |
| `detect_self_hallucination` | `try_it` | verify file exists / command works |
| `design_visualization` | `prior_art` | standard charts cover 90%; pick one; render |
| `estimate_generalization` | `try_it` | held-out test |
| `build_infrastructure_or_not` | `build_mvp` | if reuse expected ≥3 times, build; else one-shot |
| `evaluate_user_intent` | `ask_user` | matrix doesn't read minds; this one's correct |
| `add_feature_or_not` | `ask_user` | scope question |
| `decide_to_refactor` | `default_todo` | avoid yak-shaving |

## Outcome logging

After resolving a decision via the matrix, log the outcome so the
calibration stays honest:

```bash
py "<workspace>/Tools/Copilot pilot/copilot pilot/proof/neurogolf_2026/apply_reasoning_matrix.py" \
   --log <decision_id> <strategy_id> <0_or_1>
```

The 0/1 says whether the strategy actually got the right answer. After
N uses per cell, the reliability score in `reasoning_matrix.json` can
be recalibrated from the log.

## When the lookup returns no_match

That's important data, not failure. Add the new decision shape to
`reasoning_matrix.json` so the matrix grows:

```json
{"id": "<new_shape_id>",
 "name": "<short description>",
 "best_strategies": ["primary", "fallback", "..."],
 "fallback_chain": ["primary", "fallback", "..."],
 "notes": "<one-line context>"}
```

This is the matrix self-improving. Every "no_match" is a gap to fill.

## Composition with other matrices

The reasoning matrix sits one level above the AGI / morphological /
problem-space matrices. Its queries SEED their cells:

```
Decision: "is Opus useful for ToM?"
   → reasoning_matrix → strategy = try_it (probe, $0.05)
   → I run the probe
   → result fills agi_matrix.csv cell (T15 Opus × P11 ToM)
   → next iteration: graph similarity edges update
```

## Files

- `reasoning_matrix.json` — the cells
- `apply_reasoning_matrix.py` — lookup tool (always available)
- `REASONING_MATRIX.md` — the framework writeup
- `matrix_viz.html` — visual browser (run `py matrix_viz.py` to regen)
- `test_matrix_viz.py` — proof-of-correctness test
