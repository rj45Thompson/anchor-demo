"""The oracle, upgraded: every move's value, how far from the end, and how SHARP a position is.

    py -X utf8 -I gatefly/oracle.py --selftest
    py -X utf8 -I gatefly/oracle.py --rung 4,4,3 --sample 2000

WHY UPGRADE IT. The old oracle (`ttt.py`, `mnk.py`) answers two questions: what is this position
worth, and which moves preserve that. Everything this lane measures is built on those two, and
they are BINARY - a move is optimal or it is not. That binary is why the editing experiments
keep saturating: a counterfactual target is just "some non-optimal move", they are all equally
non-optimal to the instrument, and the closed-form edit installs every one of them at Efficacy
1.0000 whatever the board size.

The measured fact that forced this: board size does NOT move the edit's key geometry. Crowding
across four rungs, 9 cells to 16, was 0.0540, 0.0540, 0.0485, 0.0473. The ladder's whole premise
- that a harder GAME is a harder EDIT - is refuted on its own data. So a difficulty axis has to
come from somewhere other than the board, and the oracle is the only thing here that knows what
"harder" means exactly.

WHAT IT NOW ANSWERS, each exact and none of it estimated:
  move_values(s)   the minimax value of EVERY legal move, not just the best set
  depth_to_end(s)  plies to termination under optimal play - a win in 1 and a win in 7 are not
                   the same position, and the old oracle could not tell them apart
  sharpness(s)     how much value the BEST MISTAKE throws away: 0 where many moves are equally
                   fine, 2 where one move wins and another loses. This is a per-position
                   difficulty that has nothing to do with board size.
  cost_of(s, mv)   how much a specific move throws away - so a counterfactual target can be
                   chosen by HOW WRONG IT IS rather than merely by being wrong.

That last one is the point. It turns "install a non-optimal move" into a graded axis the editor
can be pushed along, on a board small enough to stay exactly solvable.

SYMMETRY. Positions equivalent under the board's symmetry group have equal value, so the solver
canonicalises its memo key: D4 (8 elements) on a square board, D2 (4) on a rectangle, since a
transpose is only a symmetry when m == n. A plant checks the symmetric and non-symmetric solvers
agree EXACTLY on every position tested - a speed-up that changes an answer is a bug, and this one
is load-bearing because every figure downstream rests on it.
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

from mnk import MNK, lines_for

WIN, DRAW, LOSS = 1, 0, -1


class Oracle(MNK):
    """MNK plus a graded reading of every position. Values are from the FIRST player's point of
    view throughout, as in ttt.py; `cost_of` converts to the mover's own point of view and says
    so, because that sign is the easiest thing in this file to get backwards."""

    def __init__(self, m, n, k, use_symmetry=True):
        super().__init__(m, n, k)
        self.use_symmetry = use_symmetry
        self._depth = {}
        self._maps = self._symmetry_maps()
        self._canon = {}

    # ---------------------------------------------------------------- symmetry
    def _symmetry_maps(self):
        """Index permutations that map the board to itself and preserve k-in-a-row.

        A transpose is only such a map when m == n, so a 3x4 board gets 4 symmetries and a 4x4
        gets 8. Each map is verified against the LINE SET rather than assumed: a permutation is
        kept only if it sends every winning line to a winning line.
        """
        m, n = self.m, self.n
        def idx(r, c):
            return r * n + c
        cand = []
        for flip_r in (False, True):
            for flip_c in (False, True):
                cand.append(tuple(idx(m - 1 - r if flip_r else r,
                                      n - 1 - c if flip_c else c)
                                  for r in range(m) for c in range(n)))
        if m == n:
            for flip_r in (False, True):
                for flip_c in (False, True):
                    cand.append(tuple(idx(n - 1 - c if flip_c else c,
                                          m - 1 - r if flip_r else r)
                                      for r in range(m) for c in range(n)))
        lines = set(tuple(sorted(l)) for l in self.LINES)
        good = []
        for p in cand:
            if all(tuple(sorted(p[i] for i in l)) in lines for l in self.LINES):
                good.append(p)
        return tuple(dict.fromkeys(good))        # de-duplicated, order preserved

    def canon(self, s):
        """The smallest image of s under the symmetry group - one key per equivalence class."""
        if not self.use_symmetry:
            return s
        got = self._canon.get(s)
        if got is not None:
            return got
        best = min(tuple(s[p[i]] for i in range(self.cells)) for p in self._maps)
        self._canon[s] = best
        return best

    # ---------------------------------------------------------------- values
    def value(self, s):
        key = self.canon(s)
        got = self._val.get(key)
        if got is not None:
            return got
        w = self.winner(s)
        if w:
            r = WIN if w == 1 else LOSS
        else:
            ms = self.legal(s)
            if not ms:
                r = DRAW
            else:
                me = self.turn(s)
                best = -2 if me == 1 else 2
                for mv in ms:
                    t = self.play(s, mv)
                    v = (WIN if me == 1 else LOSS) if self.winner_after(t, mv) else self.value(t)
                    if me == 1:
                        best = max(best, v)
                        if best == WIN:
                            break
                    else:
                        best = min(best, v)
                        if best == LOSS:
                            break
                r = best
        self._val[key] = r
        return r

    def move_values(self, s):
        """-> {move: value} for EVERY legal move, first-player point of view."""
        out = {}
        for mv in self.legal(s):
            t = self.play(s, mv)
            out[mv] = ((WIN if self.turn(s) == 1 else LOSS)
                       if self.winner_after(t, mv) else self.value(t))
        return out

    def optimal_moves(self, s):
        got = self._opt.get(s)
        if got is not None:
            return got
        if self.over(s):
            out = ()
        else:
            mv = self.move_values(s)
            best = max(mv.values()) if self.turn(s) == 1 else min(mv.values())
            out = tuple(sorted(m for m, v in mv.items() if v == best))
        self._opt[s] = out
        return out

    # ---------------------------------------------------------------- grading
    def cost_of(self, s, mv):
        """How much playing `mv` throws away, FROM THE MOVER'S OWN POINT OF VIEW, so it is
        always >= 0: 0 for an optimal move, 1 for turning a win into a draw or a draw into a
        loss, 2 for turning a win straight into a loss."""
        vals = self.move_values(s)
        if mv not in vals:
            raise ValueError("move %d is not legal here" % mv)
        me = self.turn(s)
        best = max(vals.values()) if me == 1 else min(vals.values())
        return abs(best - vals[mv])

    def sharpness(self, s):
        """The cost of the BEST MISTAKE: 0 where every legal move is equally good, up to 2 where
        a move exists that turns a win into a loss. A per-position difficulty with no dependence
        on board size, which is what makes it usable as a ladder axis."""
        if self.over(s):
            return 0
        vals = self.move_values(s)
        me = self.turn(s)
        best = max(vals.values()) if me == 1 else min(vals.values())
        worst = min(vals.values()) if me == 1 else max(vals.values())
        return abs(best - worst)

    def depth_to_end(self, s):
        """Plies to termination under optimal play by BOTH sides. A win in 1 and a win in 7 are
        different positions and the old oracle could not tell them apart."""
        key = self.canon(s)
        got = self._depth.get(key)
        if got is not None:
            return got
        if self.over(s):
            self._depth[key] = 0
            return 0
        opt = self.optimal_moves(s)
        d = 1 + min(self.depth_to_end(self.play(s, mv)) for mv in opt)
        self._depth[key] = d
        return d

    def grade(self, s):
        """Everything the upgraded oracle knows about one position, in one call."""
        vals = self.move_values(s)
        opt = self.optimal_moves(s)
        return {"value": self.value(s), "turn": self.turn(s),
                "legal": len(vals), "n_optimal": len(opt),
                "optimal": list(opt), "move_values": {int(k): int(v) for k, v in vals.items()},
                "sharpness": self.sharpness(s), "depth_to_end": self.depth_to_end(s),
                "costs": {int(m): int(self.cost_of(s, m)) for m in vals}}


# ---------------------------------------------------------------- the plants
def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    import ttt

    o = Oracle(3, 3, 3)

    # 1. the upgrade must not change the ANSWERS the old oracle gave. Value and optimal SET on
    #    every live tic-tac-toe position, not a sample - this is the whole foundation.
    live = ttt.decisions()
    bv = bo = 0
    for s in live:
        if o.value(s) != ttt.value(s):
            bv += 1
        if set(o.optimal_moves(s)) != set(ttt.optimal_moves(s)):
            bo += 1
    _plant("the upgraded oracle disagrees with ttt.py on %d values of %d" % (bv, len(live)),
           bv == 0)
    _plant("it disagrees with ttt.py on %d optimal SETS" % bo, bo == 0)

    # 2. SYMMETRY IS A SPEED-UP AND MUST NOT CHANGE AN ANSWER. Solve the same positions with it
    #    off and require exact agreement. A fast wrong oracle would invalidate everything here.
    plain = Oracle(3, 3, 3, use_symmetry=False)
    bad = sum(1 for s in live if plain.value(s) != o.value(s))
    _plant("symmetry reduction changed %d values" % bad, bad == 0)
    _plant("symmetry found no maps at all on a 3x3 board (%d)" % len(o._maps),
           len(o._maps) == 8)
    _plant("a 3x4 board was given transpose symmetries it does not have (%d)"
           % len(Oracle(3, 4, 3)._maps), len(Oracle(3, 4, 3)._maps) == 4)

    # 3. move_values must cover every legal move and agree with optimal_moves.
    bad = 0
    for s in live[::29]:
        mv = o.move_values(s)
        if set(mv) != set(o.legal(s)):
            bad += 1
            continue
        me = o.turn(s)
        best = max(mv.values()) if me == 1 else min(mv.values())
        if set(m for m, v in mv.items() if v == best) != set(o.optimal_moves(s)):
            bad += 1
    _plant("move_values disagrees with optimal_moves or misses a legal move (%d)" % bad,
           bad == 0)

    # 4. COST is from the MOVER'S point of view and is never negative - the sign is the easiest
    #    thing here to get backwards, and it would silently invert every graded target.
    neg = badopt = 0
    for s in live[::17]:
        for m in o.legal(s):
            c = o.cost_of(s, m)
            if c < 0:
                neg += 1
            if (c == 0) != (m in o.optimal_moves(s)):
                badopt += 1
    _plant("a move cost came out negative (%d)" % neg, neg == 0)
    _plant("cost 0 and 'is optimal' disagree on %d moves" % badopt, badopt == 0)

    # 5. SHARPNESS must span its range, or it is useless as a difficulty axis. Checked by
    #    finding real positions at each level rather than by asserting it.
    hist = {}
    for s in live:
        hist[o.sharpness(s)] = hist.get(o.sharpness(s), 0) + 1
    _plant("sharpness never reaches 2 (one move wins, another loses): %s" % hist,
           hist.get(2, 0) > 0)
    _plant("sharpness is never 0 (no position where every move is equally good): %s" % hist,
           hist.get(0, 0) > 0)
    print("  sharpness over all %d live positions: %s" % (len(live), dict(sorted(hist.items()))))

    # 6. DEPTH must be 0 at a terminal, 1 where a win is available immediately, and must never
    #    exceed the empty cells.
    bad = 0
    for s in live[::13]:
        d = o.depth_to_end(s)
        if d < 1 or d > len(o.legal(s)):
            bad += 1
    _plant("depth_to_end left [1, empty cells] on %d positions" % bad, bad == 0)
    # a position with an immediate win must have depth 1
    s_win = (1, 1, 0, 2, 2, 0, 0, 0, 0)       # X to move, X wins at cell 2
    _plant("an immediate win is not depth 1 (got %d)" % o.depth_to_end(s_win),
           o.depth_to_end(s_win) == 1)
    _plant("that immediate win is not sharp (got %d)" % o.sharpness(s_win),
           o.sharpness(s_win) == 2)

    # 7. the empty board's known facts, as a last anchor.
    _plant("the empty board is not a draw", o.value(o.EMPTY) == DRAW)
    _plant("the empty board is not dull (every opening is optimal in tic-tac-toe)",
           o.sharpness(o.EMPTY) == 0 and len(o.optimal_moves(o.EMPTY)) == 9)
    print("  empty board: depth to end %d under optimal play" % o.depth_to_end(o.EMPTY))

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--rung", default="3,3,3")
    ap.add_argument("--sample", type=int, default=0)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    sys.setrecursionlimit(100000)
    if a.selftest or not a.sample:
        raise SystemExit(selftest())
    m, n, k = (int(x) for x in a.rung.split(","))
    o = Oracle(m, n, k)
    rng = np.random.default_rng(7)
    pos = o.positions_from(o.sample_games(a.sample, rng, "mixed"))
    sharp = {}
    depth = {}
    for key, (board, opt) in pos.items():
        sharp[o.sharpness(board)] = sharp.get(o.sharpness(board), 0) + 1
        d = o.depth_to_end(board)
        depth[d] = depth.get(d, 0) + 1
    out = {"rung": a.rung, "positions": len(pos), "symmetries": len(o._maps),
           "sharpness_histogram": {str(k_): v for k_, v in sorted(sharp.items())},
           "depth_histogram": {str(k_): v for k_, v in sorted(depth.items())},
           "why": "sharpness is a per-position difficulty with no dependence on board size, "
                  "which is what the ladder needs after board size was measured inert "
                  "(crowding 0.0540, 0.0540, 0.0485, 0.0473 across four rungs)"}
    p = os.path.join(HERE, "runs", "oracle_%s.json" % a.rung.replace(",", "x"))
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1)
    print("%s: %d positions, %d symmetries" % (a.rung, len(pos), len(o._maps)))
    print("  sharpness: %s" % dict(sorted(sharp.items())))
    print("  depth:     %s" % dict(sorted(depth.items())))
    print("wrote " + p)
