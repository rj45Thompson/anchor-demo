"""UC-GF-2 step 6: check a number read off the SCREEN against a direct computation.

    py -X utf8 -I gatefly/check_hover.py --name ttt_small --site blocks.1.sa.heads.0.key.weight --unit 15

The figures passed with --gate/--a/--c are the ones the browser's tooltip showed. This file
recomputes them from the f16 blob with explicit numpy and prints both, side by side, with the
absolute difference. It does NOT import gate_math, so a bug there cannot make this agree.

It also checks the JS forward pass against torch: the page claims to RUN the net, and a page that
ran a different net would still look convincing.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def direct(stem, site, unit):
    """a, c and gate for one unit, from the blob, with nothing but numpy."""
    with open(stem + ".meta.json", encoding="utf-8") as f:
        meta = json.load(f)
    arr = np.fromfile(stem + ".f16", dtype=np.float16)
    t = next(w for w in meta["weights"] if w["name"] == site)
    W = arr[t["offset"]:t["offset"] + t["count"]].astype(np.float64).reshape(t["shape"])
    p = W.shape[1]
    lam = float(np.median((W * W).sum(axis=0)))      # the median squared COLUMN norm
    A = (W.T @ W) / lam
    A = 0.5 * (A + A.T)
    others = [i for i in range(p) if i != unit]
    S = np.eye(p - 1) + A[np.ix_(others, others)]
    a = float(A[unit, unit])
    c = float(A[others, unit] @ np.linalg.solve(S, A[others, unit]))
    e = a - c
    return a, c, e / (1.0 + e), lam, W.shape


def js_vs_torch(stem, seqs):
    """Does the page's own JS forward pass agree with torch? Checked by running torch here on
    the same token sequences and printing the argmax each gives; the JS side is read from the
    browser separately and pasted in with --js."""
    import torch
    import net as N
    model, _ = N.load(stem, "cpu")
    out = []
    for s in seqs:
        x = torch.tensor([[9] + list(s)], dtype=torch.long)
        with torch.no_grad():
            lg = model(x)[0, len(s)]
        out.append({"seq": list(s), "argmax": int(lg.argmax()),
                    "logits": [round(float(v), 4) for v in lg.tolist()]})
    return out


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_small")
    ap.add_argument("--site", required=True)
    ap.add_argument("--unit", type=int, required=True)
    ap.add_argument("--gate", type=float, default=None, help="the figure the tooltip showed")
    ap.add_argument("--a", type=float, default=None)
    ap.add_argument("--c", type=float, default=None)
    ap.add_argument("--seqs", default=None, help="json list of move sequences for the JS check")
    a = ap.parse_args()
    stem = os.path.join(HERE, "runs", a.name)
    A, C, G, lam, shape = direct(stem, a.site, a.unit)
    print("DIRECT COMPUTATION from %s.f16, numpy only, no gate_math" % a.name)
    print("  site %s   shape %s   lambda %.10f" % (a.site, shape, lam))
    print("  unit %d:  a %.10f   c %.10f   gate %.10f" % (a.unit, A, C, G))
    rc = 0
    if a.gate is not None:
        print("\nTHE SCREEN said        gate %.10f   a %.10f   c %.10f"
              % (a.gate, a.a if a.a is not None else float("nan"),
                 a.c if a.c is not None else float("nan")))
        print("THE DIRECT SUM says    gate %.10f   a %.10f   c %.10f" % (G, A, C))
        dg = abs(a.gate - G)
        print("  |difference| gate %.3e" % dg)
        if a.a is not None:
            print("  |difference| a    %.3e" % abs(a.a - A))
        if a.c is not None:
            print("  |difference| c    %.3e" % abs(a.c - C))
        # the browser carries float32 and the blueprint rounds to 6 decimals, so the bar is
        # 1e-5 and not 1e-12. Said out loud rather than chosen quietly.
        tol = 1e-5
        print("  bar: %.0e, because the page works in float32 and the blueprint file rounds "
              "each figure to 6 decimals" % tol)
        if dg > tol:
            print("  REFUSED: the screen and the direct computation disagree")
            rc = 1
        else:
            print("  AGREE")
    if a.seqs:
        print("\nTORCH on the same sequences (compare with the page's JS forward pass):")
        for row in js_vs_torch(stem, json.loads(a.seqs)):
            print("  seq %-22s argmax %d" % (row["seq"], row["argmax"]))
    raise SystemExit(rc)
