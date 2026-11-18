"""How far up an m,n,k ladder does an EXACT oracle survive? (feasibility, before any training)

    py -X utf8 -I gatefly/ladder_probe.py --budget 90
    py -X utf8 -I gatefly/ladder_probe.py --selftest

WHY THIS RUNS FIRST. RJ, 2026-11-18: "instead of tic tac toe use go but the board expands
endlessly ... the complexity has to rise where memit fails to get near 1". The problem is real -
the closed-form edit installs with Efficacy 1.0000 at every set size this lane has tried, and
`headroom.py` reports "SATURATED - not a test" at n = 8, 32 and 64, so the regime where an
editor fails has never been reached.

But GO HAS NO EXACT ORACLE. It is unsolved beyond tiny boards, and the exact oracle is the only
thing this lane has that the knowledge-benchmark lanes do not: it is what lets a metric be
checked against a known answer rather than against another estimate. A ladder that gives it up
measures its own evaluator.

So this file measures the thing that decides the ladder, BEFORE anything is trained: for each
m,n,k-game, how many states are reachable and how long does solving it EXACTLY take. A rung that
cannot be solved exactly inside the budget is not on the ladder, and this file says so rather
than quietly approximating it.

m,n,k-games generalise tic-tac-toe (the 3,3,3 member), so the existing machinery extends instead
of being replaced, and the knob raises both the state count and the depth of reasoning.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from functools import lru_cache

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)


def lines_for(m, n, k):
    """Every k-in-a-row line on an m x n board, as cell-index tuples."""
    out = []
    for r in range(m):
        for c in range(n):
            for dr, dc in ((0, 1), (1, 0), (1, 1), (1, -1)):
                rr, cc = r + (k - 1) * dr, c + (k - 1) * dc
                if 0 <= rr < m and 0 <= cc < n:
                    out.append(tuple((r + i * dr) * n + (c + i * dc) for i in range(k)))
    return tuple(out)


class Game:
    """An m,n,k-game solved exactly by memoised minimax. Same contract as gatefly/ttt.py."""

    def __init__(self, m, n, k):
        self.m, self.n, self.k = m, n, k
        self.cells = m * n
        self.LINES = lines_for(m, n, k)
        self.EMPTY = (0,) * self.cells
        self._val = {}

    def winner(self, s):
        for ln in self.LINES:
            v = s[ln[0]]
            if v and all(s[i] == v for i in ln):
                return v
        return 0

    def legal(self, s):
        return tuple(i for i in range(self.cells) if s[i] == 0)

    def turn(self, s):
        x = sum(1 for v in s if v == 1)
        o = sum(1 for v in s if v == 2)
        return 1 if x == o else 2

    def play(self, s, i):
        t = list(s)
        t[i] = self.turn(s)
        return tuple(t)

    def over(self, s):
        return self.winner(s) != 0 or not self.legal(s)

    def value(self, s):
        got = self._val.get(s)
        if got is not None:
            return got
        w = self.winner(s)
        if w == 1:
            r = 1
        elif w == 2:
            r = -1
        else:
            ms = self.legal(s)
            if not ms:
                r = 0
            else:
                me = self.turn(s)
                best = -2 if me == 1 else 2
                for mv in ms:
                    v = self.value(self.play(s, mv))
                    best = max(best, v) if me == 1 else min(best, v)
                    if (me == 1 and best == 1) or (me == 2 and best == -1):
                        break          # a proven win cannot be improved on
                r = best
        self._val[s] = r
        return r

    def reachable(self, cap=None):
        """Every state reachable by legal play. Returns (set, hit_cap)."""
        seen = set()
        stack = [self.EMPTY]
        while stack:
            s = stack.pop()
            if s in seen:
                continue
            seen.add(s)
            if cap and len(seen) > cap:
                return seen, True
            if self.over(s):
                continue
            for mv in self.legal(s):
                stack.append(self.play(s, mv))
        return seen, False


def probe(m, n, k, budget_s, state_cap):
    g = Game(m, n, k)
    t0 = time.time()
    states, capped = g.reachable(cap=state_cap)
    t_enum = time.time() - t0
    row = {"m": m, "n": n, "k": k, "cells": m * n, "lines": len(g.LINES),
           "reachable_states": (None if capped else len(states)),
           "state_cap_hit": capped, "enumerate_seconds": round(t_enum, 2)}
    if capped:
        row["oracle"] = "NOT ESTABLISHED"
        row["why"] = ("enumeration passed the %d-state cap in %.1f s, so the reachable count "
                      "is unknown here and this rung is not on the ladder until it is measured "
                      "some other way" % (state_cap, t_enum))
        return row
    t1 = time.time()
    try:
        v = g.value(g.EMPTY)
        t_solve = time.time() - t1
        if t_solve > budget_s:
            row["oracle"] = "TOO SLOW"
            row["why"] = "solved, but in %.1f s against a %d s budget" % (t_solve, budget_s)
        else:
            row["oracle"] = "EXACT"
        row["empty_board_value"] = v
        row["empty_board_means"] = {1: "first player wins", 0: "draw",
                                    -1: "second player wins"}[v]
        row["solve_seconds"] = round(t_solve, 2)
        row["decisions"] = sum(1 for s in states if not g.over(s))
    except RecursionError:
        row["oracle"] = "NOT ESTABLISHED"
        row["why"] = "recursion limit reached while solving"
    return row


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    import ttt

    # 1. the 3,3,3 member must REPRODUCE gatefly/ttt.py exactly - same state count, same value,
    #    same optimal sets. If it does not, the generalisation is a different game.
    g = Game(3, 3, 3)
    states, capped = g.reachable()
    _plant("3,3,3 does not give the published 5478 reachable states: %d" % len(states),
           len(states) == 5478 and not capped)
    _plant("3,3,3 is not a draw under perfect play", g.value(g.EMPTY) == 0)
    _plant("3,3,3 has the wrong number of lines: %d" % len(g.LINES), len(g.LINES) == 8)
    same = 0
    diff = 0
    for s in list(states)[:1500]:
        if g.over(s):
            continue
        if g.value(s) == ttt.value(s):
            same += 1
        else:
            diff += 1
    _plant("3,3,3 disagrees with gatefly/ttt.py on %d of %d states" % (diff, same + diff),
           diff == 0 and same > 0)

    # 2. a known SMALLER result: 3x3 with k=2 is a first-player win (two in a row is trivial).
    _plant("3,3,2 is not a first-player win", Game(3, 3, 2).value(Game(3, 3, 2).EMPTY) == 1)

    # 3. a known LARGER result: 4,4,4 is a DRAW under perfect play, which is the standard
    #    published result for 4x4 tic-tac-toe. If this file says otherwise, it is wrong.
    g44 = Game(4, 4, 4)
    _plant("4,4,4 is not a draw, contradicting the published result",
           g44.value(g44.EMPTY) == 0)

    # 4. lines_for must not run off the board: every index is inside the grid.
    for (mm, nn, kk) in ((3, 4, 3), (4, 4, 4), (5, 4, 4)):
        L = lines_for(mm, nn, kk)
        bad = [ln for ln in L if any(i < 0 or i >= mm * nn for i in ln)]
        _plant("lines_for(%d,%d,%d) produced an off-board index" % (mm, nn, kk), not bad)
        _plant("lines_for(%d,%d,%d) produced a line of the wrong length" % (mm, nn, kk),
               all(len(ln) == kk for ln in L))

    # 5. THE CAP MUST FIRE, or "NOT ESTABLISHED" could never be reported and the file would
    #    always claim an oracle it had not got.
    r = probe(4, 4, 4, budget_s=600, state_cap=1000)
    _plant("the state cap did not fire on 4,4,4 with a 1000-state cap",
           r["state_cap_hit"] and r["oracle"] == "NOT ESTABLISHED")
    r2 = probe(3, 3, 3, budget_s=600, state_cap=100000)
    _plant("the cap fired on 3,3,3 where it should not", r2["oracle"] == "EXACT")

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget", type=float, default=90.0, help="seconds per rung")
    ap.add_argument("--state-cap", dest="state_cap", type=int, default=40000000)
    ap.add_argument("--rungs", default="3,3,3 3,4,3 4,4,3 4,4,4 5,4,4 5,5,4 4,5,5")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    sys.setrecursionlimit(100000)
    rows = []
    print("Does an EXACT oracle survive each rung? budget %.0f s, state cap %d"
          % (a.budget, a.state_cap))
    for spec in a.rungs.split():
        m, n, k = (int(x) for x in spec.split(","))
        r = probe(m, n, k, a.budget, a.state_cap)
        rows.append(r)
        print("  %-8s cells %2d lines %3d  states %-10s  %-16s %s"
              % (spec, r["cells"], r["lines"],
                 r["reachable_states"] if r["reachable_states"] is not None else "capped",
                 r["oracle"], r.get("empty_board_means", r.get("why", ""))))
        if r["oracle"] != "EXACT":
            print("    -> the ladder stops here; everything above is NOT on it until measured")
            break
    out = os.path.join(HERE, "runs", "ladder_probe.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        json.dump({"budget_seconds": a.budget, "state_cap": a.state_cap, "rungs": rows,
                   "why": "An m,n,k ladder keeps the EXACT oracle that a Go-like game would "
                          "give up. A rung without an exact solve is not on the ladder."}, f,
                  indent=1)
    print("wrote " + out)
    raise SystemExit(0)
