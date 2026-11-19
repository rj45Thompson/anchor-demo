"""Save the shrunk net the sweep chose, so it can be played and flown (UC-GF-4 steps 1 and 2).

    py -X utf8 -I gatefly/shrink_save.py --name ttt_big --out ttt_shrunk

Reads `<name>.shrink.json`, takes the SMALLEST a-ordered budget whose optimal rate over the
4,520 distinct boards equals the parent's, rebuilds that cut (a-ordering is deterministic, so
this is the same net the sweep measured, not a near one), measures it playing, and writes a
checkpoint plus the before/after counts.

Written as its own file rather than folded into shrink.py so the sweep's own run is not edited
while it is running and its json keeps one author.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import torch

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import net as N
import play as P
import shrink as S
import ttt

OUT = os.path.join(HERE, "runs")


def pick_budget(rows, par_rate, tol=1e-12):
    """The SMALLEST a-ordered budget whose rate matches the parent's. -> row or None.

    Pulled out of main() so it can be planted. It was inline and therefore untestable without
    a checkpoint, which is why this module had no plants at all - and it is a module whose
    whole job is choosing which net gets saved and flown.
    """
    good = [r for r in rows if r["optimal_rate_4520_boards"] >= par_rate - tol]
    if not good:
        return None
    return min(good, key=lambda r: r["budget"])


def keep_set(a_vals, k):
    """The a-ordered keep set: the k units with the largest addressability, sorted.

    Deterministic by construction - this is what lets the rebuilt cut BE the measured net
    rather than a near one, which main() then verifies by re-scoring.
    """
    return sorted(np.argsort(-np.asarray(a_vals))[:k].tolist())


def selftest() -> int:
    """This module had NO PLANTS and it decides which net is saved and flown.

    Its census row said so: the two zero-plant modules in this lane were check_hover.py and
    this one. The arithmetic here is pure selection, so it is plantable on synthetic rows with
    no checkpoint - which is exactly why having no plants was a choice rather than a constraint.
    """
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    R = [{"budget": 64, "optimal_rate_4520_boards": 1.0},
         {"budget": 32, "optimal_rate_4520_boards": 1.0},
         {"budget": 16, "optimal_rate_4520_boards": 0.93},
         {"budget": 48, "optimal_rate_4520_boards": 1.0}]

    # 1. the SMALLEST matching budget, not the first and not the best-scoring. Picking the
    #    best-scoring would silently save a bigger net than the sweep justified.
    _plant("pick_budget did not return the SMALLEST matching budget (got %s)"
           % (pick_budget(R, 1.0) or {}).get("budget"), pick_budget(R, 1.0)["budget"] == 32)

    # 2. it must REFUSE rather than fall back when nothing matches. A fallback here saves a net
    #    that loses to the parent while reporting success.
    _plant("pick_budget returned a row when NOTHING matched the parent's rate - it would save "
           "a net worse than the parent", pick_budget(R, 1.0 + 1e-6) is None)

    # 3. and it must not refuse when a match exists only within tolerance, or float noise in
    #    the sweep's json makes it refuse every time
    _plant("a match within tolerance was refused - float noise would block every run",
           pick_budget([{"budget": 8, "optimal_rate_4520_boards": 1.0 - 1e-15}], 1.0) is not None)

    # 4. the keep set must be the top-k by a, sorted, and DETERMINISTIC - that determinism is
    #    the whole argument that the rebuilt cut is the measured net rather than a near one
    av = [0.1, 0.9, 0.5, 0.7, 0.3]
    _plant("keep_set is not the top-k by addressability (got %s)" % keep_set(av, 3),
           keep_set(av, 3) == [1, 2, 3])
    _plant("keep_set is not sorted - cut_to would receive units in gate order and the saved "
           "net would depend on argsort's tie handling", keep_set(av, 3) == sorted(keep_set(av, 3)))
    _plant("keep_set is not deterministic across calls",
           keep_set(av, 3) == keep_set(av, 3) == keep_set(list(av), 3))

    # 5. NEGATIVE CONTROL: it must actually read the values. A keep_set ignoring a_vals would
    #    return [0,1,2] for everything and still look plausible.
    _plant("keep_set ignores the addressability values - it returns the first k regardless",
           keep_set([0.9, 0.1, 0.2, 0.3, 0.8], 2) == [0, 4])

    # 6. k = full width must keep everything, which is the null case: shrinking to the parent's
    #    own size must be the identity or the sweep's 'no loss at full budget' row is meaningless
    _plant("the full-width keep set is not every unit",
           keep_set(av, len(av)) == list(range(len(av))))

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


def main(a):
    dev = "cuda" if torch.cuda.is_available() and not a.cpu else "cpu"
    with open(os.path.join(OUT, a.name + ".shrink.json"), encoding="utf-8") as f:
        sw = json.load(f)
    parent, meta = N.load(os.path.join(OUT, a.name), dev)
    layer = sw["layer"]
    H = sw["hidden"]
    lp = S.live_prefixes()
    prefixes = [p for _, p in lp]
    parent_P = S.dists(parent, prefixes, dev)
    par_rate = float(np.mean([1.0 if (p < 9 and p in ttt.optimal_moves(s)) else 0.0
                              for p, (s, _) in zip(parent_P.argmax(1), lp)]))

    rows = [r for r in sw["budgets"] if r["rule"] == "a_order"]
    pick = pick_budget(rows, par_rate)
    if pick is None:
        print("no a-ordered budget matched the parent's %.6f; the smallest loss was %.6f"
              % (par_rate, max(r["optimal_rate_4520_boards"] for r in rows)))
        return 1
    k = pick["budget"]
    a_, c_, g_, lam = S.unit_gates(parent, layer)
    keep = keep_set(a_, k)
    child = S.cut_to(parent, layer, keep, dev)

    cp = S.dists(child, prefixes, dev)
    one_best = np.array([len(ttt.optimal_moves(s)) == 1 for s, _ in lp])
    ag = S.agreement(parent_P, cp, one_best)
    rate = float(np.mean([1.0 if (p < 9 and p in ttt.optimal_moves(s)) else 0.0
                          for p, (s, _) in zip(cp.argmax(1), lp)]))
    if abs(rate - pick["optimal_rate_4520_boards"]) > 1e-12:
        raise SystemExit("rebuilt cut scores %.10f, the sweep recorded %.10f - the a-ordering "
                         "is not reproducing and the saved net would not be the measured one"
                         % (rate, pick["optimal_rate_4520_boards"]))

    res = P.measure(child, dev, a.games)
    par_res = P.measure(parent, dev, a.games)
    stem = os.path.join(OUT, a.out)
    before_units = sum(p.numel() for p in parent.parameters())
    after_units = sum(p.numel() for p in child.parameters())
    info = {
        "cut_from": a.name, "layer": layer,
        "neurons_before": H, "neurons_after": k, "neurons_removed": H - k,
        "parameters_before": int(before_units), "parameters_after": int(after_units),
        "parameter_reduction": 1.0 - after_units / before_units,
        "layers_before": meta["hyper"]["n_layers"], "layers_after": meta["hyper"]["n_layers"],
        "layers_note": "the BLOCK count is unchanged: this cut removes neurons inside one "
                       "block's feed-forward, it does not remove a block. A block whose ffwd "
                       "went to zero would be a layer removal, and none did.",
        "rule": "a descending, the ratchet lane's budgeted-selection ordering",
        "kept_indices": keep,
        "optimal_rate_parent": par_rate, "optimal_rate_child": rate,
        "agreement_with_parent": ag,
        "play_child": res, "play_parent": par_res,
        "warning": "Playing to the same standard does NOT show the gates were copied. "
                   "Tic-tac-toe is easy. The random-cut null and the gate-versus-damage "
                   "correlation in the shrink json are what can show that.",
    }
    m2 = N.save(child, stem, extra={"shrunk": info, "trained_by": "gatefly/shrink_save.py"})
    print("%s -> %s" % (a.name, a.out))
    print("  neurons at blocks.%d.ffwd: %d -> %d (%d removed)" % (layer, H, k, H - k))
    print("  parameters: %d -> %d (%.1f%% fewer)"
          % (before_units, after_units, 100 * info["parameter_reduction"]))
    print("  blocks: %d -> %d (unchanged; this cut removes neurons, not blocks)"
          % (meta["hyper"]["n_layers"], meta["hyper"]["n_layers"]))
    print("  optimal move on %.6f of 4520 boards, parent %.6f" % (rate, par_rate))
    print("  top-1 agreement with the parent %.4f (on one-best positions %.4f), tv %.4f"
          % (ag["top1_agreement"], ag["top1_agreement_one_best_only"], ag["total_variation"]))
    print("  " + P.fmt(res).strip().replace("\n", "\n  "))
    return 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(selftest())
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_big")
    ap.add_argument("--out", default="ttt_shrunk")
    ap.add_argument("--games", type=int, default=500)
    ap.add_argument("--cpu", action="store_true")
    raise SystemExit(main(ap.parse_args()))
