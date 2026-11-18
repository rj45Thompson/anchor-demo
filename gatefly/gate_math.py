"""The gate arithmetic, RE-USED from the ratchet lane and proven to agree with it.

    py -X utf8 -I gatefly/gate_math.py --selftest

WHAT A GATE IS (UC-GF-2 step 1). For p write directions K (d x p), a covariance C (d x d) and a
ridge lambda:

    A = K^T (lambda C)^-1 K        G = A (I + A)^-1

diag(G) is the GATE at each address: the fraction of what you try to write there that arrives.
Per address there is an exact identity,

    gate_j = g(a_j - c_j),   g(x) = x / (1 + x)

with a_j = A_jj the ADDRESSABILITY and c_j = A_{j,-j} (I + A_{-j,-j})^-1 A_{-j,j} the CROWDING -
the Schur complement of j against the others.

NOT DERIVED HERE. Derived and verified in
    D:\\code\\Tami\\.opus-tools\\closed_loop_lite\\ratchet\\gate_blueprint.py   (gate_matrix)
    D:\\code\\Tami\\.opus-tools\\closed_loop_lite\\ratchet\\effective_a.py      (crowding_term)
This file carries its own copy so the repo stands alone, and REQ-GF-2b plants prove the copy
agrees with that lane's own functions to 1e-9 on random problems. A plant that cannot reach the
lane says ABSENT with the path it searched and the selftest REFUSES, unless --lane-optional is
passed; a silently skipped agreement check is indistinguishable from one that was never written.

A UNIT'S WRITE DIRECTION, for a plain MLP (UC-GF-2 step 1). torch nn.Linear(in, out) holds
weight (out, in). Unit i of a layer does not write into its own space - it writes into the NEXT
layer's pre-activation space, scaled by the column W_next[:, i]. So:

    write direction of unit i of layer L  =  W_{L+1}[:, i]

which is the same object as GPT-2's c_proj ROW (a neuron's direction into the residual stream)
that neuron_gates.py reads. The last layer's units are ADDRESSES, not writers: they have no next
weight matrix, so their gate is UNDEFINED and is reported as such, never as 0.
"""
from __future__ import annotations

import os
import sys

import numpy as np

RATCHET = os.path.join("D:", os.sep, "code", "Tami", ".opus-tools", "closed_loop_lite", "ratchet")


# ---------------------------------------------------------------- the arithmetic
def gate_matrix(K: np.ndarray, C: np.ndarray, lam: float):
    """A = K^T (lam C)^-1 K ; G = A (I+A)^-1. float64 throughout.

    K is (d, p): one COLUMN per address. Returns (A, G). G is symmetric by construction, so an
    asymmetry is this function's bug and never a property of the net.
    """
    K = np.asarray(K, dtype=np.float64)
    C = np.asarray(C, dtype=np.float64)
    p = K.shape[1]
    A = K.T @ np.linalg.solve(lam * C, K)
    A = 0.5 * (A + A.T)
    G = A @ np.linalg.inv(np.eye(p) + A)
    return A, G


def crowding_term(A: np.ndarray, j: int) -> float:
    """c_j = A_{j,-j} (I + A_{-j,-j})^-1 A_{-j,j}. Non-negative: a quadratic form in a
    positive-definite inverse."""
    A = np.asarray(A, dtype=np.float64)
    idx = [i for i in range(A.shape[0]) if i != j]
    if not idx:
        return 0.0
    S = np.eye(len(idx)) + A[np.ix_(idx, idx)]
    a = A[idx, j]
    return float(a @ np.linalg.solve(S, a))


def crowding_all(A: np.ndarray) -> np.ndarray:
    """Every c_j, by one factorisation per j. O(p^4) naively; this is the same loop the lane
    uses, kept so the quantity is literally theirs. p here is at most a few thousand."""
    A = np.asarray(A, dtype=np.float64)
    return np.array([crowding_term(A, j) for j in range(A.shape[0])])


def g(x):
    """The gate function. x may be an array."""
    return np.asarray(x, dtype=np.float64) / (1.0 + np.asarray(x, dtype=np.float64))


def lone_gate(a: float) -> float:
    """What a lone write at this address would get (Sherman-Morrison)."""
    return float(a) / (1.0 + float(a))


def collinear_share(a: float, n: int) -> float:
    """n identical directions each receive g(n a) / n."""
    return lone_gate(n * a) / n


def acg(K: np.ndarray, C=None, lam: float = 1.0):
    """-> (a, c, gate) for the columns of K. C defaults to the identity (pure geometry).

    The gate is computed from the IDENTITY g(a - c), and a plant checks it against diag(G) from
    the full matrix inverse, because the identity is the thing this lane leans on.
    """
    K = np.asarray(K, dtype=np.float64)
    d, p = K.shape
    if C is None:
        C = np.eye(d)
    A, _ = gate_matrix(K, C, lam)
    a = np.diag(A).copy()
    c = crowding_all(A)
    eff = a - c
    return a, c, g(eff)


def unit_write_directions(weights):
    """From a list of layer weight matrices [(out,in), ...] to the per-layer write directions.

    Returns a list, one entry per layer of UNITS, of (li, K) where K is (d, p): p units, each a
    COLUMN, living in the d-dimensional space they write into. weights[li] is already in that
    shape - (out, in), and h = W x means unit f contributes x_f * W[:, f] - so K is W itself and
    NOT its transpose. (Written as W.T first; plant 11 caught it.)

      columns of weights[0]   are the INPUT units, writing into layer 1's pre-activation space
      columns of weights[L]   are hidden layer L's units, writing into layer L+1's space

    The LAST weight matrix's OUTPUT units have no next matrix and are not included - they are
    addresses, not writers, and their gate is UNDEFINED rather than 0.
    """
    out = []
    for li, W in enumerate(weights):
        W = np.asarray(W, dtype=np.float64)
        out.append((li, W.copy()))
    return out


def ridge_scale(K: np.ndarray) -> float:
    """The lane's convention (neuron_gates.py): scale so a is O(1) at the small end, by the
    MEDIAN squared norm of the directions. The ratio c/a is scale-free so this cannot change a
    conclusion, and it is reported in every output file anyway."""
    K = np.asarray(K, dtype=np.float64)
    return float(np.median(np.einsum("ij,ij->j", K, K)))


# ---------------------------------------------------------------- the plants
def _lane():
    """Import the ratchet lane's own modules. Returns (module_gate_blueprint, crowding_term) or
    None with the path searched - ABSENT is reported, never papered over."""
    if not os.path.isdir(RATCHET):
        return None
    if RATCHET not in sys.path:
        sys.path.insert(0, RATCHET)
    try:
        import gate_blueprint as gb
        from effective_a import crowding_term as lane_c
        return gb, lane_c
    except Exception as ex:                       # the import itself failed: say which error
        print("  lane import failed: %r" % (ex,))
        return None


def selftest(lane_optional: bool = False) -> int:
    fails = []
    checked = []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    rng = np.random.default_rng(11)

    # 1. the closed form on an orthonormal basis with C = I: G = diag(a/(1+a)).
    d, p, lam = 48, 4, 3.0
    Q = np.linalg.qr(rng.standard_normal((d, d)))[0]
    s = np.array([1.5, 3.0, 6.0, 9.0])
    K = Q[:, :p] * s
    A, G = gate_matrix(K, np.eye(d), lam)
    want = np.diag([lone_gate(x * x / lam) for x in s])
    _plant("orthogonal C=I does not match the closed form", np.allclose(G, want, atol=1e-12))

    # 2. THE IDENTITY g(a - c) == diag(G). This is what the viewer prints, so if it drifts the
    #    number on screen stops being the number the maths gives.
    M = rng.standard_normal((30, 30))
    Cc = M @ M.T / 30 + np.eye(30) * 0.4
    Kk = rng.standard_normal((30, 7))
    A2, G2 = gate_matrix(Kk, Cc, 2.0)
    a2, c2, g2 = acg(Kk, Cc, 2.0)
    _plant("gate != g(a - c)", float(np.abs(g2 - np.diag(G2)).max()) < 1e-10)

    # 3. symmetry on a non-trivial C: fails if the formula is written in the wrong order.
    _plant("G is not symmetric", float(np.abs(G2 - G2.T).max()) < 1e-10)

    # 4. the Jensen gap: a joint gate never EXCEEDS the lone-write gain at that address.
    _plant("a joint gate exceeds its lone-write gain",
           all(G2[j, j] <= lone_gate(A2[j, j]) + 1e-12 for j in range(A2.shape[0])))

    # 5. the collinear law: n copies of one direction share g(na)/n - the 1/n split at the
    #    degenerate end, which is the whole reason crowding is not a metaphor here.
    n = 5
    k1 = rng.standard_normal((20, 1))
    Kn = np.repeat(k1, n, axis=1) + rng.standard_normal((20, n)) * 1e-9
    An, Gn = gate_matrix(Kn, np.eye(20) * 1.1, 2.0)
    a_one = float((k1.T @ np.linalg.solve(2.0 * np.eye(20) * 1.1, k1))[0, 0])
    _plant("collinear directions do not share g(na)/n",
           abs(Gn[0, 0] - collinear_share(a_one, n)) < 1e-6)

    # 6. NEGATIVE CONTROL: the plausible wrong form (I+A)^-1 must NOT equal A(I+A)^-1.
    _plant("the wrong form (I+A)^-1 agrees with A(I+A)^-1 - formula broken",
           float(np.abs(np.linalg.inv(np.eye(7) + A2) - G2).max()) > 1e-3)

    # 7. a gate is a fraction, strictly inside (0,1).
    _plant("a gate left (0,1)", bool((g2 > 0).all() and (g2 < 1).all()))

    # 8. orthonormal directions must show ZERO crowding: nobody shares a direction.
    Qo = np.linalg.qr(rng.standard_normal((40, 40)))[0][:, :10]
    _, co, _ = acg(Qo, None, 1.0)
    _plant("orthonormal directions show crowding", float(np.abs(co).max()) < 1e-10)

    # 9. MORE DIRECTIONS THAN DIMENSIONS must crowd, and the same COUNT in a roomy space must
    #    not - otherwise the statistic is measuring p and not geometry.
    tight = rng.standard_normal((8, 30))
    roomy = rng.standard_normal((2000, 30))
    at, ct, _ = acg(tight, None, 1.0)
    ar, cr, _ = acg(roomy, None, 1.0)
    _plant("30 directions in 8 dimensions show little crowding",
           float(np.median(ct / at)) > 0.3)
    _plant("30 directions in 2000 dimensions crowd like 30 in 8 - measuring p, not geometry",
           float(np.median(cr / ar)) < float(np.median(ct / at)) / 2)

    # 10. unit_write_directions: a unit's direction is the COLUMN of the next matrix, and the
    #     last layer's units are absent. Fails if the transpose is dropped.
    W1 = rng.standard_normal((5, 3))     # 3 inputs -> 5 hidden
    W2 = rng.standard_normal((2, 5))     # 5 hidden -> 2 out
    dirs = unit_write_directions([W1, W2])
    _plant("unit_write_directions gives the wrong count of layers", len(dirs) == 2)
    _plant("a unit's write direction is not the next matrix's column",
           dirs[0][1].shape == (5, 3) and np.allclose(dirs[0][1][:, 1], W1[:, 1]))
    # and the transposed form, which is what this was written as first, must NOT pass: a
    # negative control on the exact mistake plant 11 caught.
    _plant("the transposed form also satisfies plant 11 - the plant cannot tell them apart",
           not (dirs[0][1].shape == W1.T.shape and np.allclose(dirs[0][1], W1.T)))

    # 11. REQ-GF-2b: AGREEMENT WITH THE RATCHET LANE'S OWN FUNCTIONS.
    lane = _lane()
    if lane is None:
        print("  ABSENT  the ratchet lane is not readable at " + RATCHET)
        if not lane_optional:
            fails.append("ratchet lane absent and --lane-optional was not passed")
    else:
        gb, lane_c = lane
        dA, dG = gb.gate_matrix(Kk, Cc, 2.0)
        _plant("A disagrees with the ratchet lane's gate_matrix",
               float(np.abs(A2 - dA).max()) < 1e-9)
        _plant("G disagrees with the ratchet lane's gate_matrix",
               float(np.abs(G2 - dG).max()) < 1e-9)
        lc = np.array([lane_c(A2, j) for j in range(A2.shape[0])])
        _plant("crowding disagrees with the ratchet lane's crowding_term",
               float(np.abs(c2 - lc).max()) < 1e-9)
        print("  agreement: max|dA| %.3e  max|dG| %.3e  max|dc| %.3e"
              % (float(np.abs(A2 - dA).max()), float(np.abs(G2 - dG).max()),
                 float(np.abs(c2 - lc).max())))

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(selftest("--lane-optional" in sys.argv))
    print(__doc__)
    raise SystemExit(selftest("--lane-optional" in sys.argv))
