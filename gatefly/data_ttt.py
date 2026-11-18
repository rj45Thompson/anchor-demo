"""Every legal tic-tac-toe game as a transcript, with the optimal move at each step.

    py -X utf8 -I gatefly/data_ttt.py              build and cache
    py -X utf8 -I gatefly/data_ttt.py --selftest

THE TRAINING SET IS THE WHOLE INPUT SPACE, which NO_TOYS rule 1 asks for by a different route:
there are no curated examples to hide behind because every legal game is in here. The honest
consequence, stated rather than buried: generalisation is NOT what this measures. A net that
plays perfectly has fitted a complete map; the question this lane asks of it is what its gate
structure looks like and what survives shrinking, not whether it extrapolates.

TOKENS. 0-8 are the cells, 9 is BOS. A transcript is BOS then the moves in order, so position t
of the sequence predicts the t-th move. Padding token is 9 as well and is MASKED, never scored.

TARGETS. At each step the target is UNIFORM OVER THE OPTIMAL MOVES (`ttt.optimal_moves`), not a
single move: more than one move is often optimal, and scoring against an arbitrary one of them
would mark correct play wrong. Stored as a 9-bit mask so the target distribution is rebuilt on
the GPU rather than stored as 23 M floats.

WEIGHTING, stated because it is a modelling choice and not a fact: training over complete GAMES
means a prefix is seen once per game that passes through it, so early positions are seen far more
often than late ones. The alternative - one row per distinct prefix - is also built here
(`prefix_*`) and used by the measurement code, so no figure in this lane depends on the choice.
"""
from __future__ import annotations

import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import ttt

BOS = 9
VOCAB = 10
BLOCK = 10          # BOS + 9 moves
CACHE = os.path.join(HERE, "data", "ttt_games.npz")


def build():
    """-> dict of arrays.

    games   int8  (G, 10)  BOS then the moves of one complete game, padded with BOS
    gmask   bool  (G, 9)   step t of that game is a real decision
    gopt    int16 (G, 9)   bitmask of the optimal moves at step t
    prefix  int8  (P, 10)  one row per DISTINCT prefix, padded
    plen    int8  (P,)     how many moves the prefix holds
    popt    int16 (P,)     bitmask of the optimal moves after that prefix
    pboard  int8  (P, 9)   the board that prefix reaches
    """
    games, gmask, gopt = [], [], []
    prefixes = {}

    def walk(board, moves):
        if ttt.over(board):
            seq = [BOS] + list(moves) + [BOS] * (9 - len(moves))
            games.append(seq)
            m = [0] * 9
            o = [0] * 9
            for t in range(len(moves)):
                m[t] = 1
                o[t] = opt_of[t]
            gmask.append(m)
            gopt.append(o)
            return
        key = tuple(moves)
        if key not in prefixes:
            mask = 0
            for mv in ttt.optimal_moves(board):
                mask |= 1 << mv
            prefixes[key] = (mask, board)
        opt_of.append(prefixes[key][0])
        for mv in ttt.legal(board):
            moves.append(mv)
            walk(ttt.play(board, mv), moves)
            moves.pop()
        opt_of.pop()

    opt_of = []
    walk(ttt.EMPTY, [])

    pk = sorted(prefixes)
    prefix = np.full((len(pk), BLOCK), BOS, dtype=np.int8)
    plen = np.zeros(len(pk), dtype=np.int8)
    popt = np.zeros(len(pk), dtype=np.int16)
    pboard = np.zeros((len(pk), 9), dtype=np.int8)
    for i, k in enumerate(pk):
        prefix[i, 0] = BOS
        for j, mv in enumerate(k):
            prefix[i, 1 + j] = mv
        plen[i] = len(k)
        popt[i] = prefixes[k][0]
        pboard[i] = np.array(prefixes[k][1], dtype=np.int8)

    return {"games": np.array(games, dtype=np.int8),
            "gmask": np.array(gmask, dtype=bool),
            "gopt": np.array(gopt, dtype=np.int16),
            "prefix": prefix, "plen": plen, "popt": popt, "pboard": pboard}


def load(rebuild=False):
    if not rebuild and os.path.exists(CACHE):
        z = np.load(CACHE)
        return {k: z[k] for k in z.files}
    d = build()
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    np.savez_compressed(CACHE, **d)
    return d


def mask_to_list(m):
    return [i for i in range(9) if (int(m) >> i) & 1]


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    d = load(rebuild=True)
    G = d["games"].shape[0]
    P = d["prefix"].shape[0]
    print("  %d complete games, %d distinct prefixes with a move to make" % (G, P))

    # 1. the published game count. 255,168 complete games is the standard enumeration; if this
    #    is wrong, the walk is wrong.
    _plant("the complete-game count is not 255168: %d" % G, G == 255168)

    # 2. every distinct non-terminal prefix: the game-sequence tree's internal nodes. Checked
    #    against an independent count - the number of distinct move sequences reaching a live
    #    board - computed here a second way.
    seen = set()
    stack = [((), ttt.EMPTY)]
    while stack:
        mv, b = stack.pop()
        if ttt.over(b):
            continue
        seen.add(mv)
        for m in ttt.legal(b):
            stack.append((mv + (m,), ttt.play(b, m)))
    _plant("the distinct-prefix count disagrees with an independent walk: %d vs %d"
           % (P, len(seen)), P == len(seen))

    # 3. every target is non-empty and legal on its own board.
    bad = 0
    for i in range(0, P, 97):
        board = tuple(int(x) for x in d["pboard"][i])
        got = set(mask_to_list(d["popt"][i]))
        if not got or got - set(ttt.legal(board)) or got != set(ttt.optimal_moves(board)):
            bad += 1
    _plant("a stored target is empty, illegal, or not the optimal set (%d bad)" % bad, bad == 0)

    # 4. the game arrays agree with the prefix arrays where they overlap: the same prefix must
    #    carry the same target in both. This is the plant that would catch the off-by-one in the
    #    opt_of stack, which is the easiest thing to get wrong in the walk.
    pix = {tuple(int(x) for x in d["prefix"][i, 1:1 + int(d["plen"][i])]): i for i in range(P)}
    bad = 0
    for gi in range(0, G, 701):
        row, m, o = d["games"][gi], d["gmask"][gi], d["gopt"][gi]
        for t in range(9):
            if not m[t]:
                continue
            key = tuple(int(x) for x in row[1:1 + t])
            if int(o[t]) != int(d["popt"][pix[key]]):
                bad += 1
    _plant("game-step targets disagree with prefix targets (%d bad)" % bad, bad == 0)

    # 5. masks: a game's mask length is its move count, and the padding is never scored.
    n_moves = [int(m.sum()) for m in d["gmask"][:5000]]
    lens = []
    for gi in range(5000):
        row = d["games"][gi]
        k = 0
        b = ttt.EMPTY
        for t in range(1, 10):
            if k >= 9 or ttt.over(b):
                break
            b = ttt.play(b, int(row[t]))
            k += 1
        lens.append(k)
    _plant("the mask does not count the game's own moves", n_moves == lens)

    # 6. NEGATIVE CONTROL: a shifted target must FAIL plant 4's comparison, so that plant is
    #    known to be sensitive to the off-by-one it exists to catch.
    shifted = np.roll(d["gopt"][:200], 1, axis=1)
    diff = sum(1 for gi in range(200) for t in range(9)
               if d["gmask"][gi, t] and int(shifted[gi, t]) != int(d["gopt"][gi, t]))
    _plant("rolling the targets changed nothing - plant 4 could not detect an off-by-one",
           diff > 0)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(selftest())
    d = load(rebuild=True)
    print("built %s" % CACHE)
    for k, v in d.items():
        print("  %-8s %-14s %s" % (k, v.shape, v.dtype))
    raise SystemExit(0)
