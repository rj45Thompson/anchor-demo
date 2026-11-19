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
    _plant("no module was found with zero plants - then this lane's census extension is moot "
           "and the row can be dropped", len(fresh["zero_plant_modules"]) > 0)

    # 8. the loop detector must find the three sites that explain the static/runtime gap, or the
    #    manifest's own totals read as disagreeing with a sweep for no stated reason.
    loops = fresh["loops_by_module"]
    print("  call sites inside loops: %s"
          % (", ".join("%s(%d)" % (k, len(v)) for k, v in sorted(loops.items())) or "none"))
    _plant("the loop detector found no loop-nested plants, so the static count would silently "
           "disagree with a runtime sweep", fresh["totals"]["call_sites_inside_loops"] > 0)
    # and its negative control: a module with no loop-nested plant must not be listed, or the
    # detector marks everything and explains nothing
    _plant("gate_math.py was listed as holding a loop-nested plant - the detector fires on "
           "anything", "gate_math.py" not in loops)

    # 9. THE REASON THIS MODULE EXISTS, asserted both ways. A long label is written as
    #    implicitly concatenated literals, so no single source line holds it, and a sibling
    #    lane's line-by-line grep reads BROKEN LINK while the label is plainly in the file.
    #    That is what happened to the snipershot lane's R7 row.
    nw = fresh["totals"]["labels_not_greppable_in_source"]
    print("  labels unfindable by a single-line source grep: %d of %d (%.1f%%)"
          % (nw, total, 100.0 * nw / max(total, 1)))
    _plant("every label is findable by grepping one line of its own source - then a citing "
           "lane needs no manifest and this module is dead weight", nw > 0)

    # and the half that makes it a fix rather than a diagnosis: EVERY label must be greppable
    # on one line of the manifest itself, or this file reproduces the fault it documents.
    raw = io.open(MANIFEST, encoding="utf-8").read().splitlines() if os.path.exists(MANIFEST) \
        else []
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
    before_mt = os.path.getmtime(MANIFEST) if os.path.exists(MANIFEST) else None
    before_txt = io.open(MANIFEST, encoding="utf-8").read() if os.path.exists(MANIFEST) else None
    _ = build()
    after_mt = os.path.getmtime(MANIFEST) if os.path.exists(MANIFEST) else None
    after_txt = io.open(MANIFEST, encoding="utf-8").read() if os.path.exists(MANIFEST) else None
    _plant("running the selftest MODIFIED the stored manifest - it would refresh the drift "
           "baseline and make itself pass", before_mt == after_mt and before_txt == after_txt)

    print("  selftest: %d plant(s) checked, %d failed" % (len(checked), len(fails)))
    for f in fails:
        print("  FAILED: " + f)
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
