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
    good = [r for r in rows if r["optimal_rate_4520_boards"] >= par_rate - 1e-12]
    if not good:
        print("no a-ordered budget matched the parent's %.6f; the smallest loss was %.6f"
              % (par_rate, max(r["optimal_rate_4520_boards"] for r in rows)))
        return 1
    pick = min(good, key=lambda r: r["budget"])
    k = pick["budget"]
    a_, c_, g_, lam = S.unit_gates(parent, layer)
    keep = sorted(np.argsort(-a_)[:k].tolist())
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
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_big")
    ap.add_argument("--out", default="ttt_shrunk")
    ap.add_argument("--games", type=int, default=500)
    ap.add_argument("--cpu", action="store_true")
    raise SystemExit(main(ap.parse_args()))
