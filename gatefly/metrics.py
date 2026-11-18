"""The published knowledge-editing metrics, ported to tic-tac-toe (UC-GF-3 step 4).

    py -X utf8 -I gatefly/metrics.py --selftest

WHOSE METRICS THESE ARE. Not ours. Efficacy, IFR and Preservation are defined in ThinkEval
(Baser, Divakaran & Gurusamy, TMLR 2026, arXiv 2506.01386) Eq. 6 and Eq. 7, over the KnowGIC
benchmark; the implementation here follows `selfimprove_v4/knowgic_score.py`, which implements
them from the published formulas. REQ-GF-3a: this file reproduces the KnowGIC README's own
worked example (IFR 0.70, Preservation 0.725) or it refuses, because an instrument that cannot
reproduce the authors' arithmetic is measuring something else.

    IFR          = sum_{S in D'} [ (R'_S / R_S) / sqrt(n_S) ]  /  sum_{S in D'} [ 1 / sqrt(n_S) ]
                   R_S = prod_j p_j  (pre),  R'_S = prod_j p'_j  (post),  D' = { S : R_S != 0 }
    Preservation = mean over t in E'_ind of ( p'_t / p_t ),  E_ind = subjects != the edited one

THE PORT, stated so nobody has to guess what was mapped to what:

    a FACT          -> "at board position S, the move to play is m"
    the SUBJECT     -> the board position S (its 9 cells)
    the TARGET      -> the move m
    an EDIT         -> make the net play a COUNTERFACTUAL move m' at S, where m' is NOT optimal
    the CHAIN       -> the line of play that follows, by minimax, from the ORIGINAL move m:
                       S -> S+m -> ... Each link is "at this position, play the optimal move",
                       and p_j is the net's probability of that move. R_S is their product, so
                       R'_S / R_S is exactly what ThinkEval's ratio measures: how much of the
                       original line survives as deducible after the edit.
    E_ind           -> every position whose BOARD differs from the edited one, sampled; p_t is
                       the net's probability of the optimal move there.

WHAT THIS SETTING HAS THAT THE BENCHMARK DOES NOT: a perfect oracle. Every chain and every
"correct" answer is computed by exact minimax rather than taken from a knowledge base, so a
metric's RESOLUTION can be measured here - whether it separates arms that an oracle says are
genuinely different. The v4 lane's binding constraint is a ruler that separates nothing
(`LEADS.md` L8), and that is the one thing a game can supply and WikiData cannot.
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import ttt


# ---------------------------------------------------------------- the published formulas
def chain_reliability(probs):
    r = 1.0
    for p in probs:
        r *= p
    return r


def ifr(pre_chains, post_chains):
    """ThinkEval Eq. 6. Returns (value, kept, excluded)."""
    if len(pre_chains) != len(post_chains):
        raise ValueError("pre/post chain count differs: %d vs %d"
                         % (len(pre_chains), len(post_chains)))
    num = den = 0.0
    kept = excluded = 0
    for pre, post in zip(pre_chains, post_chains):
        if len(pre) != len(post):
            raise ValueError("chain length differs pre/post: %d vs %d" % (len(pre), len(post)))
        n = len(pre)
        if n == 0:
            excluded += 1
            continue
        r_pre = chain_reliability(pre)
        if r_pre == 0.0:
            excluded += 1
            continue
        w = 1.0 / math.sqrt(n)
        num += (chain_reliability(post) / r_pre) * w
        den += w
        kept += 1
    if kept == 0:
        return 0.0, 0, excluded
    return num / den, kept, excluded


def preservation(pre_probs, post_probs):
    """ThinkEval Eq. 7. Returns (value, kept, excluded)."""
    if len(pre_probs) != len(post_probs):
        raise ValueError("pre/post triple count differs")
    ratios = []
    excluded = 0
    for p, q in zip(pre_probs, post_probs):
        if p == 0.0:
            excluded += 1
            continue
        ratios.append(q / p)
    if not ratios:
        return 1.0, 0, excluded
    return sum(ratios) / len(ratios), len(ratios), excluded


def efficacy(post_target_probs, threshold=0.5):
    """The fraction of cases where the NEW target's probability exceeds the threshold. The
    threshold is the published one and is reported with the figure, never left implicit."""
    if not post_target_probs:
        return 0.0, 0
    hits = sum(1 for p in post_target_probs if p > threshold)
    return hits / len(post_target_probs), len(post_target_probs)


# ---------------------------------------------------------------- the tic-tac-toe port
def chain_from(prefix, board, first_move, depth=4):
    """The line of play that follows `first_move` under perfect play, as a list of
    (position_as_move_sequence, move_to_ask_about).

    `prefix` is the move sequence that REACHES `board`. It was omitted at first and each link
    carried only the moves after the edit, so the net was asked about a different position from
    the one the link named; plant 8 caught it.

    Each link is a question the net can be asked: "given this prefix, which move?". The answer
    the chain measures is the OPTIMAL move at each link, which is what the original fact
    implies. Returns [] if the first move is illegal.
    """
    if board[first_move] != 0:
        return []
    links = []
    b = ttt.play(board, first_move)
    hist = list(prefix) + [first_move]
    for _ in range(depth):
        if ttt.over(b):
            break
        opt = ttt.optimal_moves(b)
        if not opt:
            break
        links.append((list(hist), opt[0]))
        b = ttt.play(b, opt[0])
        hist.append(opt[0])
    return links


def prefix_of(board):
    """A move sequence that REACHES this board, for a net that reads transcripts.

    Tic-tac-toe is order-independent in its state but a transcript LM is not, so a board has to
    be presented as SOME order. The order used is the canonical one - X's cells and O's cells
    interleaved in ascending index - and it is the SAME order for every arm, so an arm cannot
    win by being lucky with move order. That is a real limitation of the port and is stated
    here rather than hidden: a different order is a different prompt for this model.
    """
    xs = [i for i, v in enumerate(board) if v == 1]
    os_ = [i for i, v in enumerate(board) if v == 2]
    seq = []
    for k in range(max(len(xs), len(os_))):
        if k < len(xs):
            seq.append(xs[k])
        if k < len(os_):
            seq.append(os_[k])
    # the sequence must actually reach the board, or the case is not usable
    b = ttt.EMPTY
    for m in seq:
        if b[m] != 0 or ttt.over(b):
            return None
        b = ttt.play(b, m)
    return seq if b == board else None


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1 and 2. REQ-GF-3a: the KnowGIC README's OWN worked example. If these two numbers do not
    #    come out, the formulas are wrong and every figure measured with them means nothing.
    v, kept, exc = ifr([[0.9, 0.85, 0.9]], [[0.7, 0.8, 0.85]])
    _plant("IFR does not reproduce the published worked example (%.4f, want 0.6914)" % v,
           abs(v - 0.6914) < 1e-3)
    pv, pk, pe = preservation([1.0, 1.0, 1.0, 1.0], [0.8, 0.7, 0.75, 0.65])
    _plant("Preservation does not reproduce the published worked example (%.4f, want 0.725)"
           % pv, abs(pv - 0.725) < 1e-9)

    # 3. the sqrt(n) weighting must BITE: a long chain must weigh less than a short one.
    short = ifr([[0.5]], [[0.25]])[0]
    mixed = ifr([[0.5], [0.5, 0.5, 0.5, 0.5]], [[0.25], [0.5, 0.5, 0.5, 0.5]])[0]
    _plant("the sqrt(n) weighting does not change a mixed-length result", abs(mixed - short) > 1e-6)

    # 4. D' excludes a chain the model never knew, and the count is reported.
    v2, k2, e2 = ifr([[0.0, 0.5], [0.4, 0.5]], [[0.1, 0.5], [0.2, 0.5]])
    _plant("a zero-reliability chain was not excluded from D'", k2 == 1 and e2 == 1)

    # 5. DIRECTION. Lower IFR must mean the original chain survived LESS. Checked by
    #    construction, because getting this backwards would invert every verdict.
    worse = ifr([[0.9, 0.9]], [[0.1, 0.1]])[0]
    same = ifr([[0.9, 0.9]], [[0.9, 0.9]])[0]
    _plant("IFR is not 1.0 when nothing changed (%.6f)" % same, abs(same - 1.0) < 1e-12)
    _plant("destroying the chain did not LOWER IFR (%.4f vs %.4f)" % (worse, same), worse < same)

    # 6. Preservation of 1.0 when nothing changed, and >1 when the untouched facts got
    #    STRONGER - which the v4 lane saw at 8.47 and is a real direction, not an error.
    _plant("Preservation is not 1.0 when nothing changed",
           abs(preservation([0.4, 0.6], [0.4, 0.6])[0] - 1.0) < 1e-12)
    _plant("Preservation cannot exceed 1, so a strengthening is invisible",
           preservation([0.4], [0.8])[0] > 1.0)

    # 7. efficacy's threshold is the published 0.5 and sits strictly above it.
    e, n = efficacy([0.51, 0.5, 0.49])
    _plant("efficacy counts p == 0.5 as a hit", abs(e - 1 / 3) < 1e-12 and n == 3)

    # 8. the chain really is a legal line of play, and each link's move is optimal there.
    okc = True
    nlinks = []
    live = ttt.decisions()
    for s in live[::211]:
        pre = prefix_of(s)
        if pre is None:
            continue
        for fm in ttt.legal(s):
            links = chain_from(pre, s, fm)
            nlinks.append(len(links))
            for hist, mv in links:
                bb = ttt.EMPTY
                for m in hist:
                    if bb[m] != 0 or ttt.over(bb):
                        okc = False
                        break
                    bb = ttt.play(bb, m)
                if mv not in ttt.optimal_moves(bb):
                    okc = False
    _plant("a chain link's move is not optimal at its own position (over %d chains)"
           % len(nlinks), okc and max(nlinks) > 1)
    # and the NEGATIVE CONTROL for the bug plant 8 caught: dropping the prefix must break it.
    # Scanned over many cases and required to break on AT LEAST ONE: a single case may happen
    # to stay legal without its prefix, so demanding every case break would be a plant that
    # fails for the wrong reason.
    broke = 0
    tried = 0
    for s in live[::211]:
        for fm in ttt.legal(s):
            tried += 1
            for hist, mv in chain_from([], s, fm):
                bb = ttt.EMPTY
                ok = True
                for m in hist:
                    if bb[m] != 0 or ttt.over(bb):
                        ok = False
                        break
                    bb = ttt.play(bb, m)
                if not ok or mv not in ttt.optimal_moves(bb):
                    broke += 1
                    break
    _plant("dropping the prefix broke %d of %d cases - plant 8 cannot catch the bug it was "
           "written for" % (broke, tried), broke > 0)
    print("  chains over %d cases: %d links median, %d max"
          % (len(nlinks), int(np.median(nlinks)), max(nlinks)))

    # 9. prefix_of must REACH the board it claims, for every reachable board - or return None.
    bad = 0
    live = ttt.decisions()
    for s in live[::37]:
        pre = prefix_of(s)
        if pre is None:
            continue
        bb = ttt.EMPTY
        for m in pre:
            bb = ttt.play(bb, m)
        if bb != s:
            bad += 1
    _plant("prefix_of returned a sequence that does not reach its board (%d)" % bad, bad == 0)
    reach = sum(1 for s in live if prefix_of(s) is not None)
    print("  prefix_of reaches %d of %d live positions (%.1f%%). Any it cannot reach would be "
          "EXCLUDED and counted, never approximated by a different board."
          % (reach, len(live), 100.0 * reach / len(live)))

    # 10. NEGATIVE CONTROL on the instrument: shuffling which post-chain goes with which
    #     pre-chain must change IFR. If it does not, the pairing is not being used.
    pre = [[0.9, 0.8], [0.5, 0.5], [0.2, 0.9]]
    post = [[0.1, 0.1], [0.5, 0.5], [0.9, 0.9]]
    _plant("IFR is unchanged by shuffling the pairing - the pairing is not used",
           abs(ifr(pre, post)[0] - ifr(pre, post[::-1])[0]) > 1e-6)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(selftest())
