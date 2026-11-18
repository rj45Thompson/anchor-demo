"""m,n,k-games solved exactly, with sampling, so complexity can rise without losing the oracle.

    py -X utf8 -I gatefly/mnk.py --selftest

RJ, 2026-11-18: "the complexity has to rise where memit fails to get near 1, then isolate that
fault." The closed-form edit installs with Efficacy 1.0000 at every set size this lane has tried
and `headroom.py` reports NOT TESTABLE - saturated at n = 8, 32, 64 and 128 - so the regime
where an editor fails has never been reached on tic-tac-toe.

Tic-tac-toe is the 3,3,3 member of the m,n,k family (board m by n, win with k in a row), so this
module GENERALISES `gatefly/ttt.py` rather than replacing it, and a plant checks the two agree
on 3,3,3. The knob raises both the state count and the depth of reasoning while an EXACT oracle
survives - which Go would not, and which is the whole reason this lane can check a metric
against a known answer instead of against another estimate.

TWO THINGS THAT DO NOT SCALE FROM ttt.py, and what replaces them:
  * ENUMERATING every reachable state. 3,3,3 has 5,478; four cells more and it is millions.
    Replaced by SAMPLING play-outs and solving each sampled position exactly, so the oracle
    stays exact while the denominator becomes a stated sample rather than the whole space.
  * ENUMERATING every legal game as a transcript. Replaced by sampled games.
Both changes alter what a reported fraction is OVER, and every figure this module produces
carries its own denominator for that reason.
"""
from __future__ import annotations

import argparse
import os
import sys

import numpy as np


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


class MNK:
    """An m,n,k-game. Same contract as gatefly/ttt.py, generalised.

    A state is a tuple over {0,1,2} of length m*n, row-major. Token BOS is `cells`.
    """

    def __init__(self, m, n, k):
        self.m, self.n, self.k = m, n, k
        self.cells = m * n
        self.LINES = lines_for(m, n, k)
        # which lines touch each cell: a win can only be made through the cell just played,
        # which turns the winner check from O(lines) into O(lines through one cell)
        self.BY_CELL = tuple(tuple(ln for ln in self.LINES if i in ln) for i in range(self.cells))
        self.EMPTY = (0,) * self.cells
        self.BOS = self.cells
        self.VOCAB = self.cells + 1
        self.BLOCK = self.cells + 1
        self._val = {}
        self._opt = {}

    # ---------------------------------------------------------------- rules
    def winner(self, s):
        for ln in self.LINES:
            v = s[ln[0]]
            if v and all(s[i] == v for i in ln):
                return v
        return 0

    def winner_after(self, s, i):
        """Did the move just played at i win? Only lines through i can have changed."""
        v = s[i]
        if not v:
            return 0
        for ln in self.BY_CELL[i]:
            if all(s[j] == v for j in ln):
                return v
        return 0

    def legal(self, s):
        return tuple(i for i in range(self.cells) if s[i] == 0)

    def turn(self, s):
        x = o = 0
        for v in s:
            if v == 1:
                x += 1
            elif v == 2:
                o += 1
        return 1 if x == o else 2

    def play(self, s, i):
        if s[i] != 0:
            raise ValueError("cell %d is already %d" % (i, s[i]))
        t = list(s)
        t[i] = self.turn(s)
        return tuple(t)

    def over(self, s):
        return self.winner(s) != 0 or not self.legal(s)

    # ---------------------------------------------------------------- the oracle
    def value(self, s):
        """Minimax value from the first player's point of view: +1, 0, -1. Memoised, with a
        cutoff on a proven best - the cutoff cannot change a value, only the work."""
        got = self._val.get(s)
        if got is not None:
            return got
        w = self.winner(s)
        if w:
            r = 1 if w == 1 else -1
        else:
            ms = self.legal(s)
            if not ms:
                r = 0
            else:
                me = self.turn(s)
                best = -2 if me == 1 else 2
                for mv in ms:
                    t = self.play(s, mv)
                    v = (1 if me == 1 else -1) if self.winner_after(t, mv) else self.value(t)
                    if me == 1:
                        if v > best:
                            best = v
                        if best == 1:
                            break
                    else:
                        if v < best:
                            best = v
                        if best == -1:
                            break
                r = best
        self._val[s] = r
        return r

    def optimal_moves(self, s):
        """Every move preserving the minimax value. Several is normal, and a net picking any of
        them has played optimally - which is why 'the' best move is never used here."""
        got = self._opt.get(s)
        if got is not None:
            return got
        if self.over(s):
            out = ()
        else:
            me = self.turn(s)
            vals = []
            for mv in self.legal(s):
                t = self.play(s, mv)
                v = (1 if me == 1 else -1) if self.winner_after(t, mv) else self.value(t)
                vals.append((mv, v))
            best = max(v for _, v in vals) if me == 1 else min(v for _, v in vals)
            out = tuple(mv for mv, v in vals if v == best)
        self._opt[s] = out
        return out

    # ---------------------------------------------------------------- sampling
    def sample_games(self, n_games, rng, policy="mixed"):
        """Play n_games to the end and return their move sequences.

        `policy` decides HOW positions are reached, which decides what the net ever sees:
          random   both sides uniform over legal moves
          optimal  both sides uniform over OPTIMAL moves
          mixed    each game picks a per-side probability of playing optimally
        `mixed` is the default because a net trained only on optimal lines never sees the
        positions a weak opponent creates, and a net trained only on random lines never sees
        the end of a well-played game. The choice is a modelling decision and is reported.
        """
        games = []
        for _ in range(n_games):
            s = self.EMPTY
            moves = []
            p = (rng.uniform(0.2, 1.0), rng.uniform(0.2, 1.0)) if policy == "mixed" else None
            while not self.over(s):
                ms = self.legal(s)
                if policy == "optimal":
                    pool = self.optimal_moves(s)
                elif policy == "random":
                    pool = ms
                else:
                    pool = self.optimal_moves(s) if rng.random() < p[self.turn(s) - 1] else ms
                mv = int(rng.choice(pool if pool else ms))
                s = self.play(s, mv)
                moves.append(mv)
            games.append(moves)
        return games

    def positions_from(self, games):
        """Every DISTINCT prefix of those games that still has a move to make.

        Returns a dict prefix_tuple -> (board, optimal_moves). Distinct PREFIXES, because the
        net reads a transcript and a different move order is a different prompt for it.
        """
        out = {}
        for mv in games:
            s = self.EMPTY
            for t in range(len(mv)):
                key = tuple(mv[:t])
                if key not in out and not self.over(s):
                    out[key] = (s, self.optimal_moves(s))
                if self.over(s):
                    break
                s = self.play(s, mv[t])
        return out


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    HERE = os.path.dirname(os.path.abspath(__file__))
    if HERE not in sys.path:
        sys.path.insert(0, HERE)
    import ttt

    g = MNK(3, 3, 3)

    # 1. THE GENERALISATION MUST BE THE SAME GAME at 3,3,3 - same value and the same OPTIMAL
    #    SET, not merely the same winner. If the optimal sets differ, every target this lane
    #    builds would differ too.
    live = ttt.decisions()
    bad_v = bad_o = 0
    for s in live[::7]:
        if g.value(s) != ttt.value(s):
            bad_v += 1
        if set(g.optimal_moves(s)) != set(ttt.optimal_moves(s)):
            bad_o += 1
    _plant("3,3,3 disagrees with gatefly/ttt.py on %d values" % bad_v, bad_v == 0)
    _plant("3,3,3 disagrees with gatefly/ttt.py on %d optimal SETS" % bad_o, bad_o == 0)
    print("  checked %d positions against ttt.py" % len(live[::7]))

    # 2. winner_after must agree with the full winner check - it is a speed-up and a speed-up
    #    that changes an answer is a bug.
    rng = np.random.default_rng(3)
    mism = 0
    for _ in range(400):
        s = g.EMPTY
        while not g.over(s):
            mv = int(rng.choice(g.legal(s)))
            s = g.play(s, mv)
            if (g.winner_after(s, mv) != 0) != (g.winner(s) != 0):
                mism += 1
    _plant("winner_after disagrees with winner on %d moves" % mism, mism == 0)

    # 3. published values at other rungs, so the generalisation is checked where ttt cannot
    #    check it. 4,4,4 is a draw; 3,3,2 is a first-player win.
    _plant("4,4,4 is not a draw, contradicting the published result",
           MNK(4, 4, 4).value(MNK(4, 4, 4).EMPTY) == 0)
    _plant("3,3,2 is not a first-player win", MNK(3, 3, 2).value(MNK(3, 3, 2).EMPTY) == 1)
    g34 = MNK(3, 4, 3)
    v34 = g34.value(g34.EMPTY)
    print("  3,4,3 empty-board value %+d (%s)"
          % (v34, {1: "first player wins", 0: "draw", -1: "second wins"}[v34]))

    # 4. optimal_moves is never empty on a live state and is always legal.
    bad = 0
    for s in live[::31]:
        o = g.optimal_moves(s)
        if not o or set(o) - set(g.legal(s)):
            bad += 1
    _plant("optimal_moves was empty or illegal on %d live states" % bad, bad == 0)

    # 5. SAMPLING must reach positions, and the three policies must reach DIFFERENT ones -
    #    otherwise the policy argument is decorative and the training distribution is not what
    #    it says it is.
    r1 = np.random.default_rng(1)
    pr = g.positions_from(g.sample_games(300, r1, "random"))
    po = g.positions_from(g.sample_games(300, np.random.default_rng(1), "optimal"))
    pm = g.positions_from(g.sample_games(300, np.random.default_rng(1), "mixed"))
    _plant("a sampling policy reached no positions",
           len(pr) > 50 and len(po) > 5 and len(pm) > 50)
    _plant("optimal-only sampling reached as many positions as random - the policy does nothing",
           len(po) < len(pr))
    print("  positions reached from 300 games: random %d, optimal %d, mixed %d"
          % (len(pr), len(po), len(pm)))

    # 6. every sampled position's stored optimal set must match a fresh computation, so the
    #    sampling cannot silently carry a stale answer.
    bad = 0
    for key, (board, opt) in list(pm.items())[:300]:
        if set(opt) != set(g.optimal_moves(board)):
            bad += 1
    _plant("a sampled position carries an optimal set that does not recompute (%d)" % bad,
           bad == 0)

    # 7. and the prefix must REACH the board it is stored against.
    bad = 0
    for key, (board, opt) in list(pm.items())[:300]:
        s = g.EMPTY
        ok = True
        for mv in key:
            if s[mv] != 0 or g.over(s):
                ok = False
                break
            s = g.play(s, mv)
        if not ok or s != board:
            bad += 1
    _plant("a stored prefix does not reach its own board (%d)" % bad, bad == 0)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    sys.setrecursionlimit(100000)
    raise SystemExit(selftest())
