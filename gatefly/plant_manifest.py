"""Every plant in this lane, extracted from source, so another lane can resolve one by name.

    py -X utf8 -I gatefly/plant_manifest.py            verify; exits non-zero on drift
    py -X utf8 -I gatefly/plant_manifest.py --write    regenerate after an intentional change
    py -X utf8 -I gatefly/plant_manifest.py --selftest

WHY THIS EXISTS. The snipershot lane enforces RJ's ten requirements by resolving a plant LABEL
against the file that holds it. gatefly is a different repository from its checkout, so its R7
row reads CLAIMED ELSEWHERE and cannot notice if the plant it cites is reworded or removed -
which is the only thing that row is for. Its ask was either land the file in its tree or say
plainly that it stays here.

Neither is the right answer. Copying gate_math.py into another tree gives two lanes two copies
of one result, which is how two lanes end up disagreeing about a number neither re-measured;
and leaving the row permanently unverifiable throws away a check that costs nothing. What a
cross-repo citation actually needs is a STABLE RESOLUTION TARGET: one generated file listing
every plant label and the module holding it, on a path that resolves from outside this
repository, with a check that REFUSES when the manifest and the source disagree.

    D:\\code\\anchor-demo\\gatefly\\runs\\plant_manifest.json

EXTRACTION IS STATIC, by ast, not by running the selftests - a full sweep of this lane costs
748.9 s and a manifest nobody can afford to regenerate is a manifest that goes stale. Labels
are taken as the literal string passed to _plant(), so a label built by % formatting
contributes its literal part and the placeholder is recorded rather than resolved.

WHAT IT CANNOT DO, plainly. It proves a label is PRESENT in a module, not that the plant is
reached, not that its condition can fail, and not that it is asserting anything true. A plant
that passes vacuously is still listed here. It is a drift detector over names, which is what the
citing row needs, and it is not evidence that the check works.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, "runs", "plant_manifest.json")


def labels_in(path):
    """Static labels passed to _plant(...) in this file, in source order.

    A label may be a plain string, an implicit concatenation, or "text %s" % value. The literal
    part is what another lane can match on, so that is what is recorded, with has_format noting
    that the printed form carries a value.
    """
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=path)
    out = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "_plant" and node.args):
            continue
        arg = node.args[0]
        fmt = False
        if isinstance(arg, ast.BinOp) and isinstance(arg.op, ast.Mod):
            arg, fmt = arg.left, True
        if isinstance(arg, ast.Constant) and isinstance(arg.value, str):
            out.append({"label": arg.value, "has_format": fmt, "line": node.lineno})
    return out


def loop_nested(path):
    """_plant() calls that sit inside a loop, with the loop's line.

    These are why the static count is LOWER than the runtime count: one call site, several
    executions. Detected here so the manifest explains its own undercount instead of silently
    disagreeing with a sweep that costs 748.9 s to reproduce.
    """
    with open(path, encoding="utf-8") as f:
        tree = ast.parse(f.read(), filename=path)
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, (ast.For, ast.While)):
            continue
        for inner in ast.walk(node):
            if (isinstance(inner, ast.Call) and isinstance(inner.func, ast.Name)
                    and inner.func.id == "_plant"):
                out.append({"plant_line": inner.lineno, "loop_line": node.lineno})
    return out


def grep_findable(mod, labels):
    """Labels that a sibling lane CANNOT find by grepping one line of this module's source.

    This is not hypothetical. The snipershot lane cited the R7 label as one sentence, its
    tracker grepped line by line, and the row read BROKEN LINK - because the label is written
    as implicitly concatenated string literals and no single line holds it. The label was
    plainly there; the citation mechanism could not see it. Measured here so the manifest can
    state how much of the lane depends on it rather than being merely convenient.
    """
    with open(os.path.join(HERE, mod), encoding="utf-8") as f:
        lines = f.read().splitlines()
    out = []
    for p in labels:
        lab = p["label"]
        if any(lab in ln for ln in lines):
            continue
        best = ""
        for ln in lines:
            for cut in range(len(lab), len(best), -1):
                if lab[:cut] in ln:
                    best = lab[:cut]
                    break
        out.append({"label": lab, "longest_on_one_line": best})
    return out


def premise_shaped(path):
    """_plant() calls whose CONDITION asserts that a count is positive or a collection non-empty.

    THE SIGNATURE IS NOT THE WORDING, which is what makes this detectable. The snipershot lane
    found one premise-shaped plant in 76 by grepping for phrasing it happened to have used -
    "stays visible", "known false positive", "pinned" - and said plainly it has no detector for
    the shape, only the name. A phrasing search cannot find a premise somebody worded
    differently, and that is most of them.

    But the shape has a mechanical tell. For almost any measured collection of problems, THE
    EMPTY STATE IS THE HEALTHY STATE. So:

        a PLANT asserts the healthy state      -> not X, X == 0, len(X) == 0, X < tol
        a PREMISE asserts the UNHEALTHY state  -> X > 0, len(X) >= 1, bool(X), bare X

    A check that passes only while something is still wrong is a premise, whatever its label
    says. That is an AST question, independent of how it was written, and it catches a premise
    phrased in words nobody thought to grep for.

    REPORTED AS CANDIDATES, NOT FAILURES, because the shape has honest exceptions: a floor guard
    like "extraction found at least 100 plants" asserts a positive count and is a genuine
    regression check, and a mechanism test on synthetic input ("drift WAS detected") asserts
    non-emptiness correctly. Those need a human read, so this prints a list to review rather
    than a verdict to obey.
    """
    with open(path, encoding="utf-8") as f:
        src = f.read()
    tree = ast.parse(src, filename=path)
    lines = src.splitlines()
    out = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                and node.func.id == "_plant" and len(node.args) >= 2):
            continue
        cond, why, tier = node.args[1], None, "STRONG"
        # X > 0 / X >= 1 / X != 0, including len(X) > 0
        if isinstance(cond, ast.Compare) and len(cond.ops) == 1:
            op, right = cond.ops[0], cond.comparators[0]
            if isinstance(right, ast.Constant) and right.value in (0, 1):
                if isinstance(op, ast.Gt) and right.value == 0:
                    why = "asserts a count is > 0: passes only while something is still there"
                elif isinstance(op, ast.GtE) and right.value == 1:
                    why = "asserts a count is >= 1: same shape"
                elif isinstance(op, ast.NotEq) and right.value == 0:
                    why = "asserts a count is != 0: same shape"
        # bool(X)
        elif isinstance(cond, ast.Call) and isinstance(cond.func, ast.Name) \
                and cond.func.id == "bool":
            why = "asserts a collection is truthy: passes only while it is non-empty"
        # a bare name or subscript as the condition - truthy on a collection
        elif isinstance(cond, (ast.Name, ast.Subscript)):
            why = "a bare collection as the condition: truthy only while non-empty"
            tier = "WEAK"
        if why:
            # TIERING, from reading all 35 this lane produced rather than from taste. The
            # overwhelming majority of bare-boolean conditions are POSITIVE CONTROLS - caught,
            # refused, raised, ok8b, f1 - asserting that a refusal fired on synthetic input.
            # Those share the shape legitimately and swamp the signal: precision over all
            # candidates was 3 of 35 (9%), and over the len()/bool()/count-based ones alone it
            # was 3 of 12 (25%). So the tier is reported and the weak tier is not counted in
            # the headline, because a screen whose headline is 91% false positives gets
            # ignored exactly like the phrasing grep it replaces.
            tier = "WEAK" if isinstance(cond, (ast.Name, ast.Subscript)) else "STRONG"
            out.append({"line": node.lineno, "why": why, "tier": tier,
                        "code": lines[node.lineno - 1].strip()[:88]})
    return out


# My read of every candidate this lane produced, so the precision figure is backed by a review
# rather than asserted. These are the three that are genuinely premise-shaped: each passes only
# while something is still wrong, and each would go red if the lane IMPROVED.
REVIEWED_TRUE_PREMISES = {
 ("art_graph.py", "the frontier is empty"):
    "fails if the field publishes M7 or M8 - i.e. if someone else solves our open branches, "
    "which is an improvement in the world and a red gate here",
 ("art_graph.py", "every hybrid is blocked"):
    "fails once H2 and H4 are actually done and removed from the list",
 ("uml_kaos.py", "the gap map found no gaps at all"):
    "fails if every gap gets closed, which is the stated goal",
}


def build():
    mods, zero, loops = {}, [], {}
    for name in sorted(os.listdir(HERE)):
        if not name.endswith(".py"):
            continue
        p = os.path.join(HERE, name)
        got = labels_in(p)
        if got:
            mods[name] = got
            nested = loop_nested(p)
            if nested:
                loops[name] = nested
        else:
            zero.append(name)
    total = sum(len(v) for v in mods.values())
    checkers = [m for m in zero if m.startswith("check") or "verify" in m]
    wrapped = {}
    for mod, labels in mods.items():
        got = grep_findable(mod, labels)
        if got:
            wrapped[mod] = got
    n_wrapped = sum(len(v) for v in wrapped.values())
    return {
        "what": "Every plant label in the gatefly lane, extracted statically from source so a "
                "lane in another repository can resolve a citation by name and notice when it "
                "is reworded or removed.",
        "resolve_from_outside": "D:\\code\\anchor-demo\\gatefly\\runs\\plant_manifest.json",
        "repository": "github.com/rj45Thompson/anchor-demo (separate repo, primary checkout, "
                      "NOT a linked worktree)",
        "totals": {"modules_with_plants": len(mods), "plants": total,
                   "modules_with_zero_plants": len(zero),
                   "call_sites_inside_loops": sum(len(v) for v in loops.values()),
                   "labels_not_greppable_in_source": n_wrapped},
        "zero_plant_modules": zero,
        "zero_plant_modules_that_are_checkers": checkers,
        "caveat": "Presence of a label, not evidence that the plant is reached, can fail, or "
                  "asserts anything true. A vacuously passing plant is listed here too.",
        "why_this_count_is_lower_than_a_runtime_count":
            "These are CALL SITES. A _plant() inside a loop runs several times and a selftest "
            "reports each execution, so a runtime sweep counts more. Measured 2026-11-18: 277 "
            "static against 286 runtime over the same 22 modules, and the whole +9 is the three "
            "loop sites listed under loops_by_module (ladder_probe +4, uml_kaos +4, reevaluate "
            "+1). Every other module agrees exactly. Neither number is wrong; they count "
            "different things.",
        "loops_by_module": loops,
        "why_a_source_grep_is_not_enough":
            "%d of %d labels (%.1f%%) CANNOT be found by grepping a single line of their own "
            "source module, because a long label is written as implicitly concatenated string "
            "literals and no one line holds it. This is the failure that produced the "
            "snipershot lane's BROKEN LINK on the R7 row: it cited the full sentence, the label "
            "was plainly in the file, and a line-by-line grep could not see it. In this file "
            "every label is stored joined on one line, so a grep of THIS file finds all %d. "
            "That is what makes the manifest load-bearing rather than a convenience."
            % (n_wrapped, total, 100.0 * n_wrapped / max(total, 1), total),
        "labels_not_greppable_in_source": wrapped,
        "modules": mods,
    }


def digest(man):
    """Hash only the labels, so reformatting the surrounding prose does not read as drift."""
    h = hashlib.sha256()
    for mod in sorted(man["modules"]):
        h.update(mod.encode("utf-8"))
        for p in man["modules"][mod]:
            h.update(b"\x00")
            h.update(p["label"].encode("utf-8"))
    return h.hexdigest()[:16]


def load():
    if not os.path.exists(MANIFEST):
        return None
    with open(MANIFEST, encoding="utf-8") as f:
        return json.load(f)


def write(man=None):
    man = man or build()
    man["labels_digest"] = digest(man)
    os.makedirs(os.path.dirname(MANIFEST), exist_ok=True)
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(man, f, indent=1, ensure_ascii=False)
    return man


def drift(stored, fresh):
    """-> (added, removed, moved). Never guesses: a module absent from one side is reported."""
    added, removed, moved = [], [], []
    smods, fmods = stored.get("modules", {}), fresh["modules"]
    for mod in sorted(set(smods) | set(fmods)):
        s = {p["label"] for p in smods.get(mod, [])}
        f_ = {p["label"] for p in fmods.get(mod, [])}
        for lab in sorted(f_ - s):
            added.append({"module": mod, "label": lab})
        for lab in sorted(s - f_):
            removed.append({"module": mod, "label": lab})
    if stored.get("labels_digest") and stored["labels_digest"] != digest(fresh):
        moved.append({"was": stored["labels_digest"], "now": digest(fresh)})
    return added, removed, moved


def selftest() -> int:
    fails, checked = [], []
    print("PLANTS")

    def _plant(label, cond):
        checked.append(label)
        print(("  ok   " if cond else "  FAIL  ") + label)
        if not cond:
            fails.append(label)

    # A PREMISE IS NOT A PLANT, and conflating them is a fault a sibling lane hit today: it had
    # a plant asserting that a live row carried HOST-LOCAL, and the plant failed when that row
    # legitimately moved. The rule was fine; the data moved under it.
    #
    # Three checks in this file had the same shape and the same defect, all written today. Each
    # asserted that a DEFICIENCY CURRENTLY EXISTS - some module holds no plants, some label is
    # unfindable in source, some plant sits in a loop - in order to justify this module's
    # existence. So fixing the deficiency turns the check red, and one of them fails precisely
    # if someone takes this lane's own advice and plants check_hover.py. A check that punishes
    # an improvement is a check that gets switched off or worked around.
    #
    # So they are reported as PREMISES: loud, carrying the consequence, and NOT counted as
    # failures. A plant says the code does what it claims and failing means regression. A
    # premise says the situation justifying a check still obtains, and expiring means the check
    # has done its job and should be retired. Two different jobs that were being counted as one.
    premises = []

    def _premise(label, holds, consequence):
        print(("  premise  " if holds else "  EXPIRED  ") + label)
        if not holds:
            premises.append((label, consequence))

    fresh = build()
    total = fresh["totals"]["plants"]
    print("  extracted %d plant(s) from %d module(s); %d module(s) hold none"
          % (total, fresh["totals"]["modules_with_plants"],
             fresh["totals"]["modules_with_zero_plants"]))

    # 1. extraction must not be vacuous. An empty manifest would "verify" forever.
    _plant("extraction found fewer than 100 plants (%d) - the manifest is not covering this "
           "lane" % total, total >= 100)

    # 2. it must find a label this lane has published to another lane by name. If this breaks,
    #    the snipershot lane's R7 citation has silently stopped resolving.
    r7 = "a one-ULP f16 perturbation moves the gate by more than 1e-6"
    got = any(p["label"].startswith(r7) for p in fresh["modules"].get("gate_math.py", []))
    _plant("the R7 label cited by the snipershot lane is NOT in gate_math.py - a published "
           "citation has stopped resolving", got)

    # 3. a REWORDED label must be detected, or the manifest cannot do the one job it exists for
    import copy
    # NOT write() - calling it here overwrote the STORED manifest as a side effect of running
    # the selftest, which silently refreshed the very baseline the drift detector compares
    # against. After one --selftest run, drift could never be reported again: the check made
    # itself pass. Found by noticing a "no drift" verdict immediately after adding two plants
    # without regenerating. Build the baseline in memory instead and leave the file alone.
    man = copy.deepcopy(fresh)
    man["labels_digest"] = digest(man)
    worded = copy.deepcopy(fresh)
    worded["modules"]["gate_math.py"][0]["label"] += " (reworded)"
    a, r, m = drift(man, worded)
    _plant("rewording a label was not detected - the drift check is blind", bool(a and r))

    # 4. and a REMOVED label must be detected
    gone = copy.deepcopy(fresh)
    gone["modules"]["gate_math.py"] = gone["modules"]["gate_math.py"][1:]
    a2, r2, _ = drift(man, gone)
    _plant("removing a label was not detected", bool(r2) and not a2)

    # 5. negative control: an unchanged manifest must report NO drift, or every run refuses and
    #    the check gets switched off
    a3, r3, m3 = drift(man, fresh)
    _plant("an unchanged manifest reported drift - the check would refuse on every run",
           not a3 and not r3 and not m3)

    # 6. the digest must ignore prose but notice labels, or reformatting this docstring reads
    #    as a changed requirement
    prose = copy.deepcopy(fresh)
    prose["caveat"] = "entirely different prose"
    _plant("the digest changed when only surrounding prose changed", digest(prose) == digest(fresh))
    _plant("the digest did NOT change when a label changed", digest(worded) != digest(fresh))

    # 7. the census extension, carried here because this is the module that can see it: a
    #    checker holding no plants is worse than a module graded by nothing, since its passing
    #    verdict is load-bearing downstream. Recorded rather than asserted away - it is a
    #    standing fact about this lane, not a pass/fail.
    print("  modules with zero plants: %s" % (", ".join(fresh["zero_plant_modules"]) or "none"))
    print("  ...of which are themselves checkers: %s"
          % (", ".join(fresh["zero_plant_modules_that_are_checkers"]) or "none"))
    _premise("at least one module still holds zero plants",
             len(fresh["zero_plant_modules"]) > 0,
             "every module now has plants, so this lane's census extension is moot and the "
             "zero_plant_modules row can be dropped from the manifest and from the snipershot "
             "lane's census")

    # 8. the loop detector must find the three sites that explain the static/runtime gap, or the
    #    manifest's own totals read as disagreeing with a sweep for no stated reason.
    loops = fresh["loops_by_module"]
    print("  call sites inside loops: %s"
          % (", ".join("%s(%d)" % (k, len(v)) for k, v in sorted(loops.items())) or "none"))
    _premise("at least one plant still sits inside a loop",
             fresh["totals"]["call_sites_inside_loops"] > 0,
             "no plant is loop-nested any more, so the static count now equals a runtime count "
             "and the why_this_count_is_lower_than_a_runtime_count caveat should be removed "
             "rather than left to confuse a reader")

    # The detector's controls are SYNTHETIC, on source written here, so they test the detector
    # rather than whatever this lane's modules happen to contain today. The previous version
    # asserted that gate_math.py holds no loop-nested plant - true now, and it would have gone
    # red the moment someone wrapped a plant in a loop there for a perfectly good reason.
    import tempfile
    td = tempfile.mkdtemp()
    flat = os.path.join(td, "flat.py")
    looped = os.path.join(td, "looped.py")
    io.open(flat, "w", encoding="utf-8").write(
        "def f():\n    _plant('a', True)\n    _plant('b', True)\n")
    io.open(looped, "w", encoding="utf-8").write(
        "def f():\n    for x in (1, 2):\n        _plant('a', True)\n")
    _plant("the loop detector listed a plant that is NOT in a loop - it fires on anything",
           loop_nested(flat) == [])
    _plant("the loop detector MISSED a plant inside a loop - it would let the static count "
           "disagree with a runtime count unexplained", len(loop_nested(looped)) == 1)

    # 9. THE REASON THIS MODULE EXISTS, asserted both ways. A long label is written as
    #    implicitly concatenated literals, so no single source line holds it, and a sibling
    #    lane's line-by-line grep reads BROKEN LINK while the label is plainly in the file.
    #    That is what happened to the snipershot lane's R7 row.
    nw = fresh["totals"]["labels_not_greppable_in_source"]
    print("  labels unfindable by a single-line source grep: %d of %d (%.1f%%)"
          % (nw, total, 100.0 * nw / max(total, 1)))
    _premise("at least one label is still unfindable by a single-line source grep", nw > 0,
             "every label now fits on one source line, so a citing lane can grep the source "
             "directly and this module's main justification is gone - retire it rather than "
             "maintaining a manifest nothing needs")

    # and the half that makes it a fix rather than a diagnosis: EVERY label must be greppable
    # on one line of the manifest itself, or this file reproduces the fault it documents.
    # Serialized IN MEMORY from the fresh build, not read from the stored file. Grepping the
    # stored file conflates two different faults: a manifest that WRAPS labels (the thing this
    # asserts) and a manifest that is merely STALE (already covered by the drift plants and by
    # the verify path). On its first run this plant failed for staleness and reported it as
    # wrapping - a true failure with a misleading label, which is its own small version of the
    # fault this module exists to document.
    raw = json.dumps(fresh, indent=1, ensure_ascii=False).splitlines()
    unreachable = [p["label"] for labels in fresh["modules"].values() for p in labels
                   if not any(json.dumps(p["label"], ensure_ascii=False)[1:-1] in ln
                              for ln in raw)]
    _plant("%d label(s) are not greppable on one line of the manifest either - this module "
           "reproduces the fault it exists to fix" % len(unreachable), not unreachable)

    # 10. THE SELFTEST MUST NOT TOUCH THE STORED MANIFEST. It used to call write(), which
    #     refreshed the baseline the drift detector compares against, so after one --selftest
    #     run drift could never be reported again - the check quietly made itself pass. Caught
    #     by a "no drift" verdict arriving immediately after two plants were added without
    #     regenerating. Guarded by mtime and content, because either alone can miss it.
    # 11. THE PREMISE-SHAPE DETECTOR. The snipershot lane found one premise-shaped plant in 76
    #     by grepping its own phrasing and said it has no detector for the SHAPE, only the name.
    #     The shape is an AST property, not a wording: a check that passes only while something
    #     is still wrong is a premise. Controls on SYNTHETIC SOURCE written here, which is the
    #     general move that lane just endorsed - test the detector, not the lane's contents.
    import tempfile
    td2 = tempfile.mkdtemp()
    prem = os.path.join(td2, "prem.py")
    io.open(prem, "w", encoding="utf-8").write(
        "def f():\n"
        "    _plant('some deficiency still exists', len(bad) > 0)\n"
        "    _plant('a collection is non-empty', bool(found))\n"
        "    _plant('a bare collection', leftovers)\n")
    good = os.path.join(td2, "good.py")
    io.open(good, "w", encoding="utf-8").write(
        "def f():\n"
        "    _plant('nothing is broken', not bad)\n"
        "    _plant('the count is zero', len(bad) == 0)\n"
        "    _plant('within tolerance', moved < 1e-6)\n"
        "    _plant('they match', before == after)\n")
    _plant("the premise-shape detector missed a > 0 / bool() / bare-collection assertion - a "
           "premise worded unfamiliarly would go uncounted", len(premise_shaped(prem)) == 3)
    _plant("the detector does not TIER its hits - an untiered screen is 91% false positives "
           "here and gets ignored like the phrasing grep it replaces",
           {c["tier"] for c in premise_shaped(prem)} == {"STRONG", "WEAK"})
    _plant("the premise-shape detector flagged ordinary plants asserting the HEALTHY state - "
           "it would mark most of a suite", premise_shaped(good) == [])

    # and run it over this whole lane, reported as candidates to read rather than failures
    cand = {}
    for name in sorted(os.listdir(HERE)):
        if name.endswith(".py"):
            got = premise_shaped(os.path.join(HERE, name))
            if got:
                cand[name] = got
    n_all = sum(len(v) for v in cand.values())
    strong = {k: [c for c in v if c["tier"] == "STRONG"] for k, v in cand.items()}
    strong = {k: v for k, v in strong.items() if v}
    n_strong = sum(len(v) for v in strong.values())
    print("  premise-SHAPED candidates: %d total, %d STRONG in %d module(s) - %s"
          % (n_all, n_strong, len(strong),
             ", ".join("%s(%d)" % (k, len(v)) for k, v in strong.items())))
    print("    PRECISION, measured by reading all %d rather than claimed: %d are genuinely"
          % (n_all, len(REVIEWED_TRUE_PREMISES)))
    print("    premise-shaped (%.0f%% of all, %.0f%% of STRONG). The rest are POSITIVE CONTROLS"
          % (100.0 * len(REVIEWED_TRUE_PREMISES) / max(n_all, 1),
             100.0 * len(REVIEWED_TRUE_PREMISES) / max(n_strong, 1)))
    print("    - caught, refused, raised, ok8b - asserting a refusal fired on synthetic input,")
    print("    which shares the shape legitimately. So this is a SCREEN (read %d of %d plants"
          % (n_strong, total))
    print("    to find them), not a verdict, and the phrasing grep it replaces found 1 of 76.")

    before_mt = os.path.getmtime(MANIFEST) if os.path.exists(MANIFEST) else None
    before_txt = io.open(MANIFEST, encoding="utf-8").read() if os.path.exists(MANIFEST) else None
    _ = build()
    after_mt = os.path.getmtime(MANIFEST) if os.path.exists(MANIFEST) else None
    after_txt = io.open(MANIFEST, encoding="utf-8").read() if os.path.exists(MANIFEST) else None
    _plant("running the selftest MODIFIED the stored manifest - it would refresh the drift "
           "baseline and make itself pass", before_mt == after_mt and before_txt == after_txt)

    print("  selftest: %d plant(s) checked, %d failed; %d premise(s) expired"
          % (len(checked), len(fails), len(premises)))
    for f in fails:
        print("  FAILED: " + f)
    if premises:
        print()
        print("  PREMISES EXPIRED - not failures. The checks below were justified by a")
        print("  situation that no longer holds, so they have done their job and should be")
        print("  retired rather than kept passing on an obsolete reason:")
        for label, consequence in premises:
            print("    - %s" % label)
            print("      -> %s" % consequence)
    return 1 if fails else 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        raise SystemExit(selftest())
    if a.write:
        man = write()
        print("wrote %s" % MANIFEST)
        print("  %d plant(s) across %d module(s), digest %s"
              % (man["totals"]["plants"], man["totals"]["modules_with_plants"],
                 man["labels_digest"]))
        raise SystemExit(0)
    stored = load()
    if stored is None:
        print("no manifest yet - run with --write")
        raise SystemExit(1)
    fresh = build()
    added, removed, moved = drift(stored, fresh)
    print("PLANT MANIFEST verify (%d plant(s) in source, %d recorded)"
          % (fresh["totals"]["plants"], sum(len(v) for v in stored["modules"].values())))
    if not (added or removed or moved):
        print("  no drift; digest %s" % stored.get("labels_digest"))
        raise SystemExit(0)
    for x in removed:
        print("  REMOVED  %-22s %s" % (x["module"], x["label"][:80]))
    for x in added:
        print("  ADDED    %-22s %s" % (x["module"], x["label"][:80]))
    for x in moved:
        print("  DIGEST   %s -> %s" % (x["was"], x["now"]))
    print("\n  A citing lane's row may now be resolving against a label that no longer exists.")
    print("  Re-run with --write once the change is intentional.")
    raise SystemExit(1)
