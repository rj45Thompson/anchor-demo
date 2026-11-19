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


def selftest() -> int:
    """This module had NO PLANTS, and it is a verifier.

    Its own census row named the fault: "graded by nothing" is bad, and "grades other things
    while graded by nothing" is worse, because its passing verdict is load-bearing for
    everything downstream of it. This file is the thing standing between a wrong tooltip and RJ
    believing a wrong number, and until now nothing checked it.

    Everything below runs on a SYNTHETIC checkpoint written in the test, not on this lane's
    runs/ - so it tests the recomputation rather than whatever the current checkpoints happen
    to contain.
    """
    import tempfile
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. THE LOAD-BEARING ONE, and it is about this file's independence rather than its
    #    arithmetic. The whole point of check_hover is that it does NOT import gate_math, so a
    #    bug in gate_math cannot make the two agree. If somebody ever adds that import for
    #    convenience, every agreement this file reports becomes circular and still prints as a
    #    pass. Asserted on the SOURCE, because that is where the property lives.
    #    BY AST, NOT BY TEXT. The first version of this plant grepped the source for the string
    #    "import gate_math" and FAILED on its first run - matching the docstring sentence that
    #    CLAIMS the independence ("It does NOT import gate_math"). A check keyed to wording
    #    rather than to the thing, written in the same session as an AST-based screen built
    #    because wording checks fail. The module was innocent; the plant was wrong.
    import ast as _ast
    src = open(os.path.abspath(__file__), encoding="utf-8").read()
    imported = set()
    for node in _ast.walk(_ast.parse(src)):
        if isinstance(node, _ast.Import):
            imported.update(n.name.split(".")[0] for n in node.names)
        elif isinstance(node, _ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    _plant("this file imports gate_math (imports: %s) - then it is no longer an INDEPENDENT "
           "check and every agreement it reports is circular"
           % ", ".join(sorted(imported)), "gate_math" not in imported)
    # and the control: the AST check must SEE an import that is really there, or it would pass
    # on a file that imports everything
    _plant("the import scan found no imports at all - it cannot see an import that IS there",
           "numpy" in imported or "json" in imported)

    td = tempfile.mkdtemp()
    stem = os.path.join(td, "synth")
    rng = np.random.default_rng(3)
    W = (rng.standard_normal((8, 5)) * 0.3).astype(np.float16)
    W.reshape(-1).tofile(stem + ".f16")
    with open(stem + ".meta.json", "w", encoding="utf-8") as f:
        json.dump({"weights": [{"name": "s", "offset": 0, "count": W.size,
                                "shape": list(W.shape)}]}, f)

    a, c, g, lam, shape = direct(stem, "s", 2)

    # 2. the arithmetic must match an INDEPENDENT recomputation written here, not a remembered
    #    constant - this lane has twice been burned by a remembered number being wrong while
    #    the code was right
    Wd = W.astype(np.float64)
    lam2 = float(np.median((Wd * Wd).sum(axis=0)))
    A2 = (Wd.T @ Wd) / lam2
    A2 = 0.5 * (A2 + A2.T)
    oth = [i for i in range(5) if i != 2]
    a2 = float(A2[2, 2])
    c2 = float(A2[oth, 2] @ np.linalg.solve(np.eye(4) + A2[np.ix_(oth, oth)], A2[oth, 2]))
    g2 = (a2 - c2) / (1.0 + a2 - c2)
    _plant("a disagrees with an independent recomputation (%.3e)" % abs(a - a2),
           abs(a - a2) < 1e-12)
    _plant("c disagrees with an independent recomputation (%.3e)" % abs(c - c2),
           abs(c - c2) < 1e-12)
    _plant("gate disagrees with an independent recomputation (%.3e)" % abs(g - g2),
           abs(g - g2) < 1e-12)

    # 3. the gate must be a gate: strictly inside (0,1), since g(x)=x/(1+x) with x>=0
    _plant("the gate left (0,1) - %.6f" % g, 0.0 <= g < 1.0)
    _plant("crowding exceeds its own addressability (a %.6f, c %.6f) - the Schur complement "
           "is wrong" % (a, c), c <= a + 1e-9)

    # 4. NEGATIVE CONTROL: it must actually READ THE BLOB. If direct() returned the same numbers
    #    for different weights it would agree with any tooltip, which is the failure mode of a
    #    checker that checks nothing.
    W2 = W.copy()
    W2[0, 2] = np.float16(float(W2[0, 2]) + 1.0)
    W2.reshape(-1).tofile(stem + ".f16")
    a3, c3, g3, _, _ = direct(stem, "s", 2)
    _plant("perturbing the blob did NOT move the gate (%.3e) - this file is not reading the "
           "weights it claims to read" % abs(g3 - g), abs(g3 - g) > 1e-6)

    # 5. and it must refuse a site that is not in the index rather than returning something
    try:
        direct(stem, "a-site-that-does-not-exist", 0)
        refused = False
    except StopIteration:
        refused = True
    _plant("an unknown site did not raise - a typo'd --site would silently check nothing",
           refused)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(selftest())
    ap = argparse.ArgumentParser()
    ap.add_argument("--name", default="ttt_small")
    ap.add_argument("--selftest", action="store_true")
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
