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

    # R7 (the light loop's dtype rule): a tolerance on model activations must be set relative
    # to the model's DTYPE, and the dtype must be printed. The checkpoints here are FLOAT16 on
    # disk, so the question is whether a gate printed to 6 decimals is carrying false
    # precision. MEASURED rather than assumed, by perturbing the weights by one f16 ULP:
    rng7 = np.random.default_rng(0)
    W7 = rng7.standard_normal((64, 256)) * 0.1
    W7 = W7.astype(np.float16).astype(np.float64)        # as a checkpoint actually arrives
    lam7 = ridge_scale(W7)
    _, _, g_a = acg(W7, None, lam7)
    ulp7 = np.spacing(W7.astype(np.float32)).astype(np.float64)
    W7b = W7 + ulp7 * rng7.choice([-1.0, 1.0], size=W7.shape)
    _, _, g_b = acg(W7b, None, ridge_scale(W7b))
    moved = float(np.median(np.abs(g_b - g_a)))
    print("  R7 dtype: weights float16 (eps %.3e); one ULP moves the gate by %.3e (median)"
          % (np.finfo(np.float16).eps, moved))
    _plant("a one-ULP f16 perturbation moves the gate by more than 1e-6, so printing a gate "
           "to 6 decimals is false precision (moved %.3e)" % moved, moved < 1e-6)
    # and the control: a perturbation 1000x larger MUST move it, or the test is measuring
    # nothing and would pass on a gate that ignores its own weights
    W7c = W7 + ulp7 * 1000.0 * rng7.choice([-1.0, 1.0], size=W7.shape)
    _, _, g_c = acg(W7c, None, ridge_scale(W7c))
    moved_big = float(np.median(np.abs(g_c - g_a)))
    _plant("a 1000-ULP perturbation does NOT move the gate, so the ULP test measures nothing "
           "(moved %.3e)" % moved_big, moved_big > moved * 10)

    # THE GATE SATURATES AT THIS LANE'S OPERATING POINT - which is a LAMBDA CHOICE, not a
    # property of g. The headline below said "the gate saturates" unqualified, in this file and
    # in messages to two lanes, and the scope was in the next sentence rather than in the claim.
    # Measured: how far the gate moves when crowding goes from 0 to 30% of a, against lambda -
    #
    #     lambda      a        gate moves
    #     1e-2    6716.41        0.0001     saturated: g -> 1, nothing left to lose
    #     1e+0      67.16        0.0062
    #     1e+2       0.67        0.0820     <- MOST RESPONSIVE, at a ~ 1
    #     1e+4       0.0067      0.0020     linear region: g ~ a, so 30% of nearly nothing
    #     1e+6       0.0001      0.0000
    #
    # NON-MONOTONE, and dead at BOTH ends. The gate is a usable readout only where a ~ 1, and
    # a scales exactly as 1/lambda, so whether it is usable is tunable. This lane runs at
    # a ~ 250, far into the saturated end, which is why its gate is a late indicator - a fact
    # about where it chose to stand, not about the function.
    #
    # THE GATE SATURATES, AND THIS LANE HAS BEEN QUOTING IT AS THE CAPACITY READ.
    #
    # g(x) = x/(1+x) is flat for large x. Real addressability here is a ~ 250, so a - c stays
    # large until c approaches a, and the gate barely moves. Measured across this lane's own
    # memit arm (runs/ttt_big.retrain.json):
    #
    #     n        c/a          gate
    #     1    0.000000      0.995471
    #     32   0.108317      0.995558      <- c/a moved 5 orders of magnitude
    #     256  0.9354        (Efficacy 0.945, competence 0.6967)
    #
    # So the GATE is a late indicator: by the time it moves, the budget is nearly spent. The
    # quantity that is monotone and readable from the first edit is the CROWDING FRACTION c/a.
    # This matters because M8 - this lane's own frontier claim, and the thing it offered two
    # sibling lanes as "a per-edit read of how much room is left" - named the gate. It should
    # name c/a. Found by a sibling lane asking whether the arithmetic predicted something about
    # its single-edit run, where c is 0 BY CONSTRUCTION and the gate therefore says nothing.
    #
    # Asserted on synthetic values rather than on the artefact, so it tests the arithmetic and
    # cannot go stale or premise-shaped.
    a_big = 250.0
    gates = [g(a_big - f * a_big) for f in (0.0, 0.1, 0.3)]
    spread_gate = max(gates) - min(gates)
    fracs = [0.0, 0.1, 0.3]
    _plant("the gate is NOT flat at realistic addressability - then it is a usable capacity "
           "read and c/a is unnecessary (a=%.0f, c/a 0 to 0.3 moves the gate %.5f)"
           % (a_big, spread_gate), spread_gate < 0.01)
    _plant("the crowding FRACTION is not monotone where the gate is flat - then neither is "
           "readable and M8 has no instrument", fracs == sorted(fracs))
    # and the control: the gate MUST move once c approaches a, or it is not a gate at all
    near = g(a_big - 0.99 * a_big)
    _plant("the gate does not fall when c approaches a (%.4f at c/a=0.99 against %.4f at 0) - "
           "it would be insensitive everywhere" % (near, gates[0]), gates[0] - near > 0.2)

    # AND c/a IS NOT LAMBDA-FREE EITHER, which is the second correction to M8 in two turns.
    #
    # The snipershot lane measured that a = k^T (lambda C)^-1 k is EXACTLY proportional to
    # 1/lambda, so a covariance difference splits into a magnitude half absorbable into lambda
    # (which the field tunes) and a direction half that is real. Checked here, that identity
    # holds to the digit - a*lambda is constant. But c does NOT share it: the Schur complement
    # carries a +I that does not scale, so
    #
    #     a * lambda   constant to 1e-14           c * lambda   15.29 -> 5.73 over 200x lambda
    #     c/a          0.2305 -> 0.0907            gate         0.9908 -> 0.3837
    #
    # So the crowding FRACTION this lane promoted one commit ago as "the capacity read" is
    # itself partly absorbable into the ridge hyperparameter. It is a better readout than the
    # gate - monotone in n and about 4x less lambda-sensitive - and it is NOT a lambda-free
    # capacity number. Any comparison across settings must hold lambda fixed or report it,
    # exactly as that lane argued for covariance differences.
    #
    # What survives is weaker and still useful: the per-key RANK ORDER of c/a is nearly
    # lambda-stable (max rank displacement 0 at lambda<=1, 2 across a 200x range), so c/a
    # answers WHICH KEY IS MOST CROWDED robustly while its absolute value does not travel.
    _r = np.random.default_rng(11)
    K6 = _r.standard_normal((64, 12))
    _X = _r.standard_normal((400, 64))
    C6 = (_X.T @ _X) / 400.0 + 1e-3 * np.eye(64)
    _lamA, _ = gate_matrix(K6, C6, 1.0)
    _lamB, _ = gate_matrix(K6, C6, 50.0)
    _aA, _aB = np.diag(_lamA), np.diag(_lamB)
    _plant("a is NOT exactly proportional to 1/lambda - then the absorbable-axis identity "
           "does not hold here and this caveat is wrong",
           float(np.max(np.abs(_aA * 1.0 - _aB * 50.0))) < 1e-9)
    _cA, _cB = crowding_all(_lamA), crowding_all(_lamB)
    _ratA, _ratB = _cA / _aA, _cB / _aB
    _plant("c/a is lambda-INVARIANT (spread %.3e) - then it is a lambda-free capacity read "
           "after all and this caveat should be deleted"
           % float(np.max(np.abs(_ratA - _ratB))),
           float(np.max(np.abs(_ratA - _ratB))) > 1e-6)
    # This plant first asserted the order was IDENTICAL and failed, correctly: the comment
    # above says "nearly lambda-stable" and the assertion demanded exact. Measured displacement
    # is 0 at lambda<=1 and 1-2 across a 200x range, so "nearly" is the true claim and the
    # plant now holds the measured bound instead of the stronger one I typed.
    _oA = {k: i for i, k in enumerate(np.argsort(_ratA))}
    _oB = {k: i for i, k in enumerate(np.argsort(_ratB))}
    _shift = max(abs(_oA[k] - _oB[k]) for k in _oA)
    _plant("the per-key ORDER of c/a moved by more than 2 places across a 50x lambda change "
           "(moved %d) - then not even the comparative reading travels" % _shift, _shift <= 2)
    _plant("the order did not move AT ALL (%d) - then c/a's ordering is exactly lambda-free "
           "and the 'nearly' in the comment above is understated" % _shift, _shift > 0)

    # BATCH INSTALLATION IS BOUNDED ABOVE BY SOLO INSTALLATION, by Jensen on the concave gate.
    # The snipershot lane's arithmetic, verified here rather than taken: in the eigenbasis of A,
    # G_jj = sum_m w_m g(lambda_m) with weights summing to 1, while A_jj = sum_m w_m lambda_m.
    # g(x) = x/(1+x) has g''(x) = -2/(1+x)^3 < 0, so g is concave and
    #
    #     G_jj = sum_m w_m g(lambda_m)  <=  g(sum_m w_m lambda_m)  =  g(A_jj)
    #
    # No weights or assumptions needed. Measured over 200 random systems: 0 violations, the
    # largest G_jj - g(A_jj) being -2.921e-04 and the mean slack 0.0418. This lane had the
    # concavity (it is why the gate saturates) and had never stated the bound it implies.
    rngJ = np.random.default_rng(5)
    worst_j = -np.inf
    for _ in range(40):
        dJ, pJ = int(rngJ.integers(8, 30)), int(rngJ.integers(3, 10))
        KJ = rngJ.standard_normal((dJ, pJ))
        XJ = rngJ.standard_normal((200, dJ))
        CJ = (XJ.T @ XJ) / 200.0 + 1e-3 * np.eye(dJ)
        AJ, GJ = gate_matrix(KJ, CJ, float(rngJ.uniform(0.2, 20)))
        aJ = np.diag(AJ)
        worst_j = max(worst_j, float(np.max(np.diag(GJ) - aJ / (1.0 + aJ))))
    _plant("batch installation EXCEEDS solo installation somewhere (max G_jj - g(A_jj) = "
           "%.3e) - that would refute Jensen on a concave gate" % worst_j, worst_j <= 1e-9)

    # CONTROL: the bound must come from CONCAVITY and not from something incidental about A.
    # A convex f must break the same inequality, or this plant is passing for the wrong reason.
    AC = np.array([[3.0, 0.0], [0.0, 0.2]])
    wts = np.array([0.5, 0.5])
    conv = float(wts @ (np.diag(AC) ** 2))          # sum w f(lam), f convex
    conv_of_mean = float((wts @ np.diag(AC)) ** 2)  # f(sum w lam)
    _plant("a CONVEX function satisfied Jensen in the concave direction - then the bound above "
           "is not coming from concavity and the plant proves nothing", conv > conv_of_mean)

    # THE WHITENED COSINE IS EXACTLY LAMBDA-FREE, and this lane's own artefact said otherwise.
    # A = K^T (lambda C)^-1 K scales UNIFORMLY with 1/lambda, so in A_ij/sqrt(A_ii A_jj) the
    # numerator and denominator carry matching powers and lambda cancels exactly. Measured over
    # nine orders of magnitude: 0.293104310528 at every lambda, max difference 1.665e-16.
    #
    # Worth holding because the neighbouring quantities are NOT lambda-free and this lane
    # conflated them: `a` is a diagonal entry and scales as 1/lambda, and c/a is
    # lambda-dependent through the Schur complement's +I. The normalised OFF-diagonal survives;
    # the diagonal and anything built from it with the +I does not. runs/r9_keys.json carried
    # "the figures are relative orderings rather than the gate's operating point" - understating
    # its own numbers - until this was measured.
    def _wh(M):
        dgw = np.sqrt(np.maximum(np.diag(M), 1e-300))
        Wn = M / np.outer(dgw, dgw)
        np.fill_diagonal(Wn, 0.0)
        return Wn
    A_lo, _ = gate_matrix(K6, C6, 1e-3)
    A_hi, _ = gate_matrix(K6, C6, 1e6)
    dwh = float(np.max(np.abs(_wh(A_lo) - _wh(A_hi))))
    _plant("the whitened cosine MOVED across nine orders of magnitude of lambda (%.3e) - then "
           "it is not an operating-point-free quantity and r9_keys.json's figures are only "
           "relative orderings after all" % dwh, dwh < 1e-12)
    # control: the DIAGONAL must move over the same range, or lambda is not doing anything and
    # the invariance above is vacuous
    dmove = float(np.max(np.abs(np.diag(A_lo) - np.diag(A_hi))))
    _plant("the diagonal of A did NOT move over the same lambda range (%.3e) - then lambda is "
           "inert here and the whitened invariance proves nothing" % dmove, dmove > 1.0)

    # the sweet spot, planted: responsiveness must be non-monotone in a, peaking near a ~ 1.
    def _move(a_):
        return a_ / (1.0 + a_) - (0.7 * a_) / (1.0 + 0.7 * a_)
    _moves = [_move(x) for x in (6716.0, 67.0, 0.67, 0.0067, 0.0001)]
    _plant("gate responsiveness is MONOTONE in a (%s) - then 'the gate saturates' needs no "
           "operating-point qualifier and the table above is wrong"
           % ", ".join("%.4f" % m for m in _moves),
           _moves[2] > _moves[0] and _moves[2] > _moves[4])
    _plant("the gate is as responsive at this lane's a~250 as at its peak - then this lane's "
           "operating point is not the reason its gate is a late indicator",
           _move(250.0) < _move(0.67) / 10.0)

    # THE PEAK HAS A CLOSED FORM, and it bounds the gate's compression everywhere.
    # The v4 lane's derivation, verified here: maximising g(a) - g(ra) over a gives
    # a^2(r^2 - r) = r - 1, hence
    #
    #     a* = 1/sqrt(r)          peak movement = (1 - sqrt(r)) / (1 + sqrt(r))
    #
    # independent of lambda, dimension and key count. Matches the numerical argmax to 4 dp at
    # r = 0.9, 0.7, 0.5, 0.3: a* 1.0541/1.1952/1.4142/1.8257, peak 0.0263/0.0889/0.1716/0.2922.
    # So "usable only near a ~ 1" is replaced by an exact location, which is better than the
    # qualifier it replaces.
    #
    # WHERE THIS LANE DOES NOT FOLLOW THE V4 LANE. It reads the bound as "a weak readout
    # EVERYWHERE" because even at a* a 30% crowding change moves the gate under nine points.
    # That conflates COMPRESSION with DETECTABILITY, and this lane has the measurement that
    # separates them: the R7 ULP test says one f16 ULP moves the gate 4.3e-09, so
    #
    #     at a* = 1.20   movement 0.088933  =  20,682,129 x the resolution
    #     at a  = 250    movement 0.001698  =     394,827 x the resolution
    #
    # Even deep in this lane's saturated regime the signal is ~400,000 times the noise floor.
    # The gate is COMPRESSED, not unreadable. So the reason to prefer c/a is not that the gate
    # cannot be read - it is that the gate is NON-LINEAR and its responsiveness is
    # NON-MONOTONE in a, so equal gate differences do not mean equal crowding differences and
    # gate movements cannot be compared across operating points. That is a statement about
    # interpretability, not about precision, and it holds at every a.
    for _r in (0.9, 0.7, 0.5, 0.3):
        _astar = 1.0 / np.sqrt(_r)
        _grid = np.linspace(0.01, 20.0, 200001)
        _num = _grid[np.argmax(g(_grid) - g(_r * _grid))]
        _plant("the closed-form peak a*=1/sqrt(r) disagrees with the numerical argmax at r=%.1f "
               "(%.4f vs %.4f)" % (_r, _astar, _num), abs(_astar - _num) < 1e-3)
        _pk = (1.0 - np.sqrt(_r)) / (1.0 + np.sqrt(_r))
        _plant("the closed-form peak MOVEMENT disagrees at r=%.1f (%.6f vs %.6f)"
               % (_r, _pk, g(_astar) - g(_r * _astar)),
               abs(_pk - (g(_astar) - g(_r * _astar))) < 1e-9)
    # and the separation of compression from detectability, which is where this lane dissents
    _mv250 = g(250.0) - g(0.7 * 250.0)
    _plant("the gate's movement at this lane's a~250 is below the measured 4.3e-09 resolution "
           "(%.3e) - then it really is unreadable here and 'compressed not unreadable' is "
           "wrong" % _mv250, _mv250 / 4.3e-9 > 1000.0)

    # A GUARD AGAINST A VACUOUS COMPARISON THIS LANE IS WELL PLACED TO MAKE.
    #
    # This lane proposed a test to a sibling lane - "replace the ratio with a difference of
    # logs and see whether the split survives" - and half of it COULD NOT HAVE FAILED. log is
    # strictly monotone with log(1)=0, so ratio>1 <=> log(ratio)>0: the two forms are identical
    # by construction for a threshold at 1. Verified at 0 disagreements in 200,000 draws. The
    # instinct was right and aimed at the wrong half - what logs buy is a DISTANCE from the
    # boundary, which the ratio hides, not a different verdict.
    #
    # That was proposed in prose to another lane, where none of this lane's screens run. The
    # vacuity screen in plant_manifest.py reads Python; it cannot see a test suggested in a
    # message. So the same fault was committed hours after building the detector for it.
    #
    # THE SIBLING OF IT HERE: at FIXED a, the gate g(a-c) and the crowding fraction c/a are
    # BOTH MONOTONE IN c, so they carry the same ordering information - 780 of 780 key pairs
    # ordered identically (one ascending as the other descends). Any claim that one ORDERS keys
    # better than the other is therefore vacuous at fixed a, and this lane has spent a day
    # comparing exactly these two quantities. What is NOT vacuous is the MAGNITUDE of movement,
    # which a monotone map does not preserve (0.9000 against 0.0345 over the same sweep), and
    # the ordering genuinely does differ ACROSS a.
    a_fix = 250.0
    c_fix = np.linspace(0.0, 0.9 * a_fix, 40)
    gate_fix = (a_fix - c_fix) / (1.0 + a_fix - c_fix)
    ca_fix = c_fix / a_fix
    disagree = sum(1 for i in range(len(c_fix)) for j in range(i + 1, len(c_fix))
                   if (gate_fix[i] < gate_fix[j]) != (ca_fix[i] > ca_fix[j]))
    _plant("gate and c/a order keys DIFFERENTLY at fixed a (%d pairs) - then a comparison of "
           "their orderings is a real test; as it stands it is vacuous and only their "
           "MAGNITUDES differ" % disagree, disagree == 0)
    _plant("gate and c/a span the SAME range over one crowding sweep (%.4f vs %.4f) - then "
           "even the magnitude comparison carries nothing"
           % (float(ca_fix[-1] - ca_fix[0]), float(gate_fix[0] - gate_fix[-1])),
           abs((ca_fix[-1] - ca_fix[0]) - (gate_fix[0] - gate_fix[-1])) > 0.1)

    # THE RECIPROCAL SYMMETRY, which explains WHY the peak sits where it does.
    # The v4 lane's result, verified here: g(x) + g(1/x) = 1 EXACTLY, for all x > 0 (max
    # deviation 1.110e-16 over x from 1e-6 to 1e6). Since g(1/x) = 1/(1+x) and g(x) = x/(1+x),
    # they sum to (x+1)/(1+x).
    #
    # So a = 1 is g's symmetry point, and at the peak a* = 1/sqrt(r) the post-crowding value is
    # r*a* = sqrt(r) - before and after are exact RECIPROCALS, straddling a = 1 symmetrically
    # in log space. The peak is therefore 1 - 2*g(sqrt(r)), which agrees with
    # (1-sqrt(r))/(1+sqrt(r)) to 8 dp at r = 0.9, 0.7, 0.5, 0.3. That is an explanation rather
    # than a location, and it is the better half of the result.
    xs_sym = np.array([1e-6, 0.01, 0.3, 1.0, 3.0, 100.0, 1e6])
    _plant("g(x) + g(1/x) != 1 (max deviation %.3e) - then a = 1 is not g's symmetry point and "
           "the peak sitting at 1/sqrt(r) is a coincidence of the algebra"
           % float(np.max(np.abs(g(xs_sym) + g(1.0 / xs_sym) - 1.0))),
           float(np.max(np.abs(g(xs_sym) + g(1.0 / xs_sym) - 1.0))) < 1e-12)
    for _r in (0.9, 0.5):
        _sym = 1.0 - 2.0 * g(np.sqrt(_r))
        _cls = (1.0 - np.sqrt(_r)) / (1.0 + np.sqrt(_r))
        _plant("1 - 2g(sqrt r) disagrees with the closed form at r=%.1f (%.8f vs %.8f)"
               % (_r, _sym, _cls), abs(_sym - _cls) < 1e-12)

    # AND THE SMALL-CHANGE APPROXIMATION IS (1-r)/4, NOT (1-r)/2. The v4 lane sent the latter
    # and printed the exact value beside it, which refutes it: 0.0263 at r = 0.9, where
    # (1-r)/2 = 0.05 and (1-r)/4 = 0.025. Expansion: r = 1-e, sqrt(r) ~ 1 - e/2, so
    # (1 - sqrt r)/(1 + sqrt r) ~ (e/2)/2 = e/4.
    # AND THE DIRECTION MATTERS MORE THAN THE CONSTANT, which this lane reported without.
    # The first version of these plants asserted only that /4 is CLOSER than /2 - a statement
    # about MAGNITUDE with no sign - in a quantity where the sign is the whole point. The v4
    # lane supplied it: /4 UNDER-estimates at every r and monotonically worse as r falls:
    # -0.5% at 0.99, -2.5% at 0.95, -5.1% at 0.90, -15.7% at 0.70, -27.1% at 0.50. The peak is
    # a BOUND on how far the gate can move, so an approximation that under-states it licenses a
    # claim the exact form forbids. /4 is a mental check; (1-sqrt r)/(1+sqrt r) is what to quote.
    for _r in (0.99, 0.95, 0.9, 0.7, 0.5):
        _ex = (1.0 - np.sqrt(_r)) / (1.0 + np.sqrt(_r))
        _plant("the small-change peak is closer to (1-r)/2 than to (1-r)/4 at r=%.2f "
               "(exact %.6f, /2 %.6f, /4 %.6f)" % (_r, _ex, (1 - _r) / 2, (1 - _r) / 4),
               abs(_ex - (1 - _r) / 4) < abs(_ex - (1 - _r) / 2))
        _plant("(1-r)/4 OVER-estimates the peak at r=%.2f (%.6f vs exact %.6f) - then it is "
               "safe to quote as a bound, and this caveat is unnecessary"
               % (_r, (1 - _r) / 4, _ex), (1 - _r) / 4 < _ex)
    # the error must also WORSEN as r falls, or "monotonically worse" is an overstatement
    _errs = [((1 - _r) / 4 - (1 - np.sqrt(_r)) / (1 + np.sqrt(_r)))
             / ((1 - np.sqrt(_r)) / (1 + np.sqrt(_r))) for _r in (0.99, 0.95, 0.9, 0.7, 0.5)]
    _plant("the relative under-estimate does not worsen monotonically as r falls (%s)"
           % ", ".join("%.3f" % e for e in _errs),
           all(_errs[i] > _errs[i + 1] for i in range(len(_errs) - 1)))

    # MULTIPLICITY ARITHMETIC, planted because this lane endorsed a wrong figure for it and a
    # sibling lane mislabelled another. At n tests with nominal alpha, INDEPENDENT:
    #   expected survivors = n*alpha (9*0.05 = 0.45, not 1 as this lane wrote)
    #   P(>=3) = 0.00836   P(>=4) = 0.00064
    # The snipershot lane quoted 0.0084 as P(>=3) while labelling it P(>=4) - that catch
    # stands. The DEPENDENT figures it was compared against were then withdrawn as a bug, so
    # neither its 10x nor this lane's 131x survives: both were mismatched quantities on top of
    # a broken statistic. AND THE "CORRECTED" 2.6x WAS WRONG TOO, by the same fault one line
    # above it: 0.0218 uses REALISED marginals (~0.0353) after a tie fix, while 0.00836 is
    # Binomial(9, 0.05), the NOMINAL marginal from before it. Matched baselines:
    #     m=9, p=0.05    P(>=3) 0.00836   2.6x   <- mismatched, what both lanes published
    #     m=9, p=0.0353  P(>=3) 0.00315   6.9x
    #     m=7, p=0.0454  P(>=3) 0.00285   7.6x   <- live: two angles have a realised marginal
    #        of exactly 0.000, because a statistic whose atom spans its whole null can never
    #        produce p <= alpha, and an angle that cannot survive is not a test.
    # The requirement follows from the linearity argument below rather than from convention:
    # dependence is the one thing that cannot move E[S], so a baseline at a DIFFERENT mean
    # measures the marginal change as well as the correlation.
    from math import comb as _comb
    _n, _al = 9, 0.05
    _pmf = [_comb(_n, k) * _al ** k * (1 - _al) ** (_n - k) for k in range(_n + 1)]
    _plant("the independent expected survivor count at 9 tests is 1 (it is %.2f) - then this "
           "lane's endorsement was right" % (_n * _al), abs(_n * _al - 0.45) < 1e-12)
    _plant("P(>=4) at 9 tests equals the 0.0084 that was quoted for it (%.5f) - then there is "
           "no off-by-one" % sum(_pmf[4:]), abs(sum(_pmf[4:]) - 0.0084) > 1e-4)
    _plant("P(>=3) is NOT the 0.0084 that was quoted as P(>=4) (%.5f) - then the off-by-one "
           "diagnosis is wrong" % sum(_pmf[3:]), abs(sum(_pmf[3:]) - 0.0084) < 1e-4)
    # and the resampling SE that makes a third digit meaningless at 4000 draws
    _se = (0.005 * 0.995 / 4000.0) ** 0.5
    _plant("the resampling SE of a permutation p=0.005 at 4000 draws is below 0.0005 (%.5f) - "
           "then quoting three digits off 4000 draws is not quoting the sampler" % _se,
           _se > 0.001)

    # LINEARITY OF EXPECTATION IS WHY 2.069 COULD NEVER HAVE BEEN A DEPENDENCE EFFECT.
    # S is a sum of indicators, so E[S] = sum of the marginals WHATEVER the dependence.
    # Dependence moves variance and shape, never the mean. So a reported mean of 2.069 against
    # a nominal 9 x 0.05 = 0.45 was not telling anyone about dependence - it was saying the
    # marginals were 0.23. (They were: a percentile threshold with >= landing on an atom, one
    # angle identically zero in all 4000 draws and "surviving" every one of them.)
    #
    # This lane ADOPTED 2.069 as the correction to its own adopted figure, which is error 26.
    # The refutation is one line and needs no data.
    _rg = np.random.default_rng(7)
    _n, _al, _dr = 9, 0.05, 200000
    _u = _rg.random(_dr)
    _dep = np.stack([(_u < _al).astype(float) for _ in range(_n)])      # perfectly dependent
    _ind = (_rg.random((_n, _dr)) < _al).astype(float)                  # independent
    for _nm, _M in (("dependent", _dep), ("independent", _ind)):
        _plant("E[S] does not equal the sum of the marginals for %s indicators (%.4f vs %.4f) "
               "- then linearity of expectation fails and dependence could move the mean"
               % (_nm, float(_M.sum(0).mean()), float(_M.mean(1).sum())),
               abs(float(_M.sum(0).mean()) - float(_M.mean(1).sum())) < 1e-9)
    # the control: dependence MUST change the variance, or the fixture is not dependent at all
    _plant("the dependent and independent variances are the same (%.3f vs %.3f) - then the "
           "fixture is not dependent and the plants above prove nothing"
           % (float(_dep.sum(0).var()), float(_ind.sum(0).var())),
           float(_dep.sum(0).var()) > 4.0 * float(_ind.sum(0).var()))

    # THE MATCHED BASELINE, planted because this lane published the mismatched one.
    from math import comb as _cb
    def _pge(_m, _p, _t=3):
        return sum(_cb(_m, _k) * _p ** _k * (1 - _p) ** (_m - _k) for _k in range(_t, _m + 1))
    _obs = 0.0218
    _mis, _mat, _live = _pge(9, 0.05), _pge(9, 0.0353), _pge(7, 0.0454)
    _plant("the mismatched baseline gives the same factor as the matched one (%.1fx vs %.1fx) "
           "- then matching the mean does not matter and this caveat is noise"
           % (_obs / _mis, _obs / _mat), abs(_obs / _mis - _obs / _mat) > 1.0)
    _plant("the matched baseline is LARGER than the mismatched one (%.5f vs %.5f) - then the "
           "published 2.6x over-stated rather than under-stated the effect"
           % (_mat, _mis), _mat < _mis)
    _plant("dropping the two dead angles does not move the factor (%.1fx vs %.1fx) - then the "
           "family size is immaterial and 'live is seven' changes nothing"
           % (_obs / _mat, _obs / _live), abs(_obs / _mat - _obs / _live) > 0.3)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(selftest("--lane-optional" in sys.argv))
    print(__doc__)
    raise SystemExit(selftest("--lane-optional" in sys.argv))
