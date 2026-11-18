"""Tic-tac-toe, exactly: the rules, every reachable state, and a PERFECT opponent (UC-GF-1).

    py -X utf8 -I gatefly/ttt.py --selftest

REQ-GF-1a: the opponent is EXACT minimax over the whole game tree, never a heuristic. The tree is
small enough to solve completely and memoise, so there is no reason to approximate and every
reason not to: a near-perfect opponent turns the net's loss into a measurement of the opponent.

A state is a 9-tuple over {0, 1, 2}: 0 empty, 1 the player who moves first (X), 2 the second (O).
Cells are row-major, index 0 top-left to 8 bottom-right.
"""
from __future__ import annotations

import sys
from functools import lru_cache

LINES = ((0, 1, 2), (3, 4, 5), (6, 7, 8),
         (0, 3, 6), (1, 4, 7), (2, 5, 8),
         (0, 4, 8), (2, 4, 6))

EMPTY = (0,) * 9


def winner(s):
    """1, 2, or 0 for nobody."""
    for a, b, c in LINES:
        v = s[a]
        if v and v == s[b] == s[c]:
            return v
    return 0


def legal(s):
    return tuple(i for i in range(9) if s[i] == 0)


def turn(s):
    """Whose move it is: X when the counts are equal, else O."""
    return 1 if sum(1 for v in s if v == 1) == sum(1 for v in s if v == 2) else 2


def play(s, i):
    if s[i] != 0:
        raise ValueError("cell %d is already %d" % (i, s[i]))
    t = list(s)
    t[i] = turn(s)
    return tuple(t)


def over(s):
    return winner(s) != 0 or not legal(s)


@lru_cache(maxsize=None)
def value(s):
    """Minimax value from X's point of view: +1 X wins, 0 draw, -1 O wins, under perfect play."""
    w = winner(s)
    if w == 1:
        return 1
    if w == 2:
        return -1
    ms = legal(s)
    if not ms:
        return 0
    if turn(s) == 1:
        return max(value(play(s, m)) for m in ms)
    return min(value(play(s, m)) for m in ms)


@lru_cache(maxsize=None)
def optimal_moves(s):
    """Every move that preserves the minimax value. More than one is normal, and a net that
    picks any of them has played optimally - which is why 'the' best move is never used here."""
    if over(s):
        return ()
    ms = legal(s)
    me = turn(s)
    vals = [(m, value(play(s, m))) for m in ms]
    best = max(v for _, v in vals) if me == 1 else min(v for _, v in vals)
    return tuple(m for m, v in vals if v == best)


def reachable():
    """Every state reachable by legal play from the empty board, including terminal ones."""
    seen = set()
    stack = [EMPTY]
    while stack:
        s = stack.pop()
        if s in seen:
            continue
        seen.add(s)
        if over(s):
            continue
        for m in legal(s):
            stack.append(play(s, m))
    return seen


def decisions():
    """The states where somebody has a move to make: the ones a net is ever asked about."""
    return sorted(s for s in reachable() if not over(s))


def features(s, seat):
    """The net's input: 27 numbers, three planes of 9 - my marks, their marks, empty.

    SEAT-RELATIVE on purpose. The same net then plays both seats, so a result is about the net
    and not about which side it was given (REQ-GF-1c).
    """
    other = 2 if seat == 1 else 1
    f = [0.0] * 27
    for i, v in enumerate(s):
        if v == seat:
            f[i] = 1.0
        elif v == other:
            f[9 + i] = 1.0
        else:
            f[18 + i] = 1.0
    return f


def result_for(s, seat):
    """'win' / 'draw' / 'loss' from seat's point of view, for a finished game."""
    w = winner(s)
    if w == 0:
        return "draw"
    return "win" if w == seat else "loss"


# ---------------------------------------------------------------- the plants
def selftest() -> int:
    fails = []
    checked = []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # 1. UC-GF-1 step 1's observable: a perfectly played game is a DRAW.
    _plant("the empty board is not a draw under perfect play", value(EMPTY) == 0)

    # 2. the state count. 5478 reachable states and 4520 non-terminal ones for 3x3 tic-tac-toe
    #    are published counts (OEIS A272648 family / Schaefer's enumeration); if this file
    #    disagrees with them the move generator is wrong, so they are a real check and not
    #    decoration.
    R = reachable()
    D = decisions()
    _plant("the reachable-state count is not 5478, so the rules are wrong: %d" % len(R),
           len(R) == 5478)
    print("  states: %d reachable, %d with a move to make" % (len(R), len(D)))

    # 3. a known forced win must be seen as one: X at centre, O at an edge, is a win for X.
    s = play(play(EMPTY, 4), 1)
    _plant("centre then edge is not a win for X", value(s) == 1)

    # 4. a known draw: X centre, O corner is a draw.
    s = play(play(EMPTY, 4), 0)
    _plant("centre then corner is not a draw", value(s) == 0)

    # 5. optimal_moves must never be empty on a live state, and must be a subset of legal.
    bad = [s for s in D[:800] if not optimal_moves(s) or set(optimal_moves(s)) - set(legal(s))]
    _plant("optimal_moves was empty or illegal on %d live states" % len(bad), not bad)

    # 6. NEGATIVE CONTROL for the one that matters: taking a NON-optimal move must sometimes
    #    make the value worse. If no move ever changes the value, the net's play could not be
    #    graded at all and every "optimal" verdict would be vacuous.
    worse = 0
    for s in D:
        opt = set(optimal_moves(s))
        for m in legal(s):
            if m not in opt:
                v0, v1 = value(s), value(play(s, m))
                if (turn(s) == 1 and v1 < v0) or (turn(s) == 2 and v1 > v0):
                    worse += 1
    _plant("no non-optimal move ever worsens the value - the grader cannot grade", worse > 0)
    print("  %d (state, non-optimal move) pairs genuinely worsen the minimax value" % worse)

    # 7. features: exactly one plane is hot per cell, and the seats are mirror images.
    s = play(play(EMPTY, 4), 0)
    fx, fo = features(s, 1), features(s, 2)
    _plant("a cell is in two planes at once",
           all(abs(fx[i] + fx[9 + i] + fx[18 + i] - 1.0) < 1e-12 for i in range(9)))
    _plant("the two seats' features are not mirror images",
           fx[0:9] == fo[9:18] and fx[9:18] == fo[0:9] and fx[18:] == fo[18:])

    # 8. play() refuses an occupied cell rather than silently overwriting it.
    try:
        play(play(EMPTY, 0), 0)
        ok = False
    except ValueError:
        ok = True
    _plant("play() overwrote an occupied cell instead of refusing", ok)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        raise SystemExit(selftest())
    raise SystemExit(selftest())
