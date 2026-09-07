#!/usr/bin/env python3
"""Audit every hand-written GLSL shader in the anchor-demo games.

    py tools/shader_audit.py              # audit and print
    py tools/shader_audit.py --json

It exists because of two bugs that cost most of a session, and BOTH were invisible on screen:

  * a duplicate `attribute vec3 color` next to `vertexColors: true` is a GLSL redefinition. The
    vertex shader fails to compile, the material draws NOTHING, and the only evidence anywhere is
    one line in the browser console. What you see is a planet with no surface.
  * a custom ShaderMaterial gets NO sRGB decode. three.js only injects one for the material chunks
    it owns, so texture2D returns sRGB bytes as linear light and the renderer encodes them again on
    output - every texture a full gamma step pale. What you see is "the art looks washed out", and
    the natural response is to fight it with tints, which is what happened for weeks.

Neither is catchable by looking at the picture, which is exactly why it is a script.

IT REPORTS WHAT IT EXAMINED. A shader auditor that prints "0 problems" without naming the shaders
it opened, the samplers it classified and the checks it ran is worth nothing - it cannot be
distinguished from one whose regex stopped matching. Every run prints the inventory first.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = [ROOT / "games" / "resume-arkanoid.html", ROOT / "games" / "planet_surface.js"]

# three.js declares all of these in its own ShaderMaterial prefix. Declaring one again is a
# redefinition and the shader will not compile.
BUILTIN_ATTRS = ["position", "normal", "uv", "uv2", "color", "tangent",
                 "instanceMatrix", "instanceColor", "skinIndex", "skinWeight"]
BUILTIN_UNIFORMS = ["modelMatrix", "modelViewMatrix", "projectionMatrix", "viewMatrix",
                    "normalMatrix", "cameraPosition", "isOrthographic"]

# A sampler whose name says it carries DATA, not colour. Those must NOT be gamma-decoded: a normal
# map decoded as sRGB gives wrong normals, which is a subtler bug than the one being fixed.
DATA_SAMPLER = re.compile(r"(norm|bump|rough|metal|height|disp|mask|depth|noise|data)", re.I)

# GLSL that needs an extension on WebGL1. three.js enables derivatives automatically only when the
# material uses flatShading, a bump/normal map or an envMapCubeUV - a hand-written shader that just
# calls fwidth gets nothing, and on a WebGL1 fallback the material silently draws nothing.
DERIV = re.compile(r"\b(fwidth|dFdx|dFdy)\s*\(")

# a GLSL template literal assigned to a name, or inline in a material
SHADER_DECL = re.compile(
    r"(?:const\s+(?P<cname>\w+)\s*=\s*|(?P<key>vertexShader|fragmentShader)\s*:\s*)`(?P<body>[^`]*)`",
    re.S)


def strip_comments(g: str) -> str:
    g = re.sub(r"/\*.*?\*/", " ", g, flags=re.S)
    return re.sub(r"//[^\n]*", " ", g)


def shaders_of(path: Path):
    """Every GLSL body in the file, with the name it is known by."""
    src = path.read_text(encoding="utf-8")
    out = []
    for m in SHADER_DECL.finditer(src):
        body = m.group("body")
        if "gl_Position" not in body and "gl_FragColor" not in body:
            continue                          # a template literal that is not a shader
        name = m.group("cname") or m.group("key")
        line = src.count("\n", 0, m.start()) + 1
        kind = "vertex" if "gl_Position" in body else "fragment"
        out.append({"file": path.name, "line": line, "name": name, "stage": kind, "glsl": body})
    # Whether the MATERIAL enables the derivatives extension is in the JS, not the GLSL, so a
    # body-only check can never see the fix and would warn forever - and a warning that cannot be
    # cleared is one people learn to scroll past. Resolve it across the whole tree: find every site
    # that hands this shader to a material and require `derivatives` inside that literal.
    for sh in out:
        sh["derivatives_on"] = derivatives_enabled_for(sh["name"])
    return out


def _all_source():
    return chr(10).join(f.read_text(encoding="utf-8") for f in FILES if f.is_file())


def derivatives_enabled_for(name: str) -> bool:
    """True when EVERY material built from this shader sets extensions.derivatives."""
    src = _all_source()
    # `fragmentShader: PLANET_FRAG` / `S.PLANET_FRAG` / an inline body assigned at this key
    sites = [m.start() for m in re.finditer(
        r"(?:vertex|fragment)Shader\s*:\s*(?:\w+\.)?" + re.escape(name) + r"\b", src)]
    if not sites:
        return False                       # inline shader: the literal is right here, see below
    for pos in sites:
        # the enclosing material literal, approximated by a window either side of the reference
        lo, hi = max(0, pos - 2500), min(len(src), pos + 2500)
        if "derivatives" not in src[lo:hi]:
            return False
    return True


def audit(sh: dict):
    """-> list of findings. Each names the shader, the line, and what was actually checked."""
    g = strip_comments(sh["glsl"])
    found = []

    def add(sev, check, detail):
        found.append({"severity": sev, "check": check, "detail": detail,
                      "shader": sh["name"], "file": sh["file"], "line": sh["line"]})

    for a in BUILTIN_ATTRS:
        if re.search(r"\battribute\s+\w+\s+" + a + r"\s*;", g):
            add("FATAL", "builtin-redefinition",
                f"declares `attribute ... {a}` - three.js declares it too; the shader will not "
                f"compile and the material draws NOTHING")
    for u in BUILTIN_UNIFORMS:
        if re.search(r"\buniform\s+\w+\s+" + u + r"\s*;", g):
            add("FATAL", "builtin-redefinition", f"declares `uniform ... {u}` - three.js declares it too")

    samplers = re.findall(r"uniform\s+sampler2D\s+(\w+)", g)
    for s in samplers:
        uses = re.findall(r"texture2D\s*\(\s*" + s + r"\s*,", g)
        if not uses:
            add("INFO", "unused-sampler", f"sampler2D {s} is declared but never sampled")
            continue
        if DATA_SAMPLER.search(s):
            # data map: decoding it would be the bug
            if re.search(r"pow\s*\(\s*texture2D\s*\(\s*" + s, g):
                add("FATAL", "srgb-decode-on-data-map",
                    f"{s} looks like a DATA map (normal/rough/height) and is being gamma-decoded - "
                    f"that corrupts the values it carries")
            continue
        # A decode is written two ways and the first version of this check only saw one:
        #     vec3 alb = pow(texture2D(uMap, vUv).rgb, vec3(2.2));       inline
        #     vec4 p = texture2D(map, vUv);  p.rgb = pow(p.rgb, ...);    through a variable
        # It reported PLATE_FRAG, which decodes correctly on the very next line, as undecoded.
        decoded = bool(re.search(r"pow\s*\(\s*texture2D\s*\(\s*" + s + r"\b[^;]*vec3\(\s*2\.2", g))
        if not decoded:
            for var in re.findall(r"\b(\w+)\s*=\s*texture2D\s*\(\s*" + s + r"\s*,", g):
                if re.search(r"\b" + var + r"(?:\.[rgba]+)?\s*=\s*pow\s*\([^;]*vec3\(\s*2\.2", g):
                    decoded = True
                    break
        if not decoded:
            add("WARN", "missing-srgb-decode",
                f"colour sampler {s} is read without pow(..., vec3(2.2)); a ShaderMaterial gets no "
                f"automatic decode, so its texture renders one gamma step pale")

    if DERIV.search(g) and not sh.get("derivatives_on"):
        add("WARN", "derivatives-need-extension",
            "calls fwidth/dFdx - core in WebGL2 but an EXTENSION in WebGL1. Set "
            "`extensions: { derivatives: true }` on the material or it will not compile on a "
            "WebGL1 fallback, and the material will draw nothing there")

    if sh["stage"] == "fragment":
        if "gl_FragColor" not in g:
            add("FATAL", "no-output", "fragment shader never writes gl_FragColor")
        if re.search(r"\bdiscard\b", g) and "gl_FragColor" in g:
            add("INFO", "discard",
                "uses discard - correct here, but it disables early-Z for the whole material")

    # a per-pixel sin/cos storm is the usual reason a "cool" shader is also the slow one
    trig = len(re.findall(r"\b(sin|cos|tan|pow|exp|log)\s*\(", g))
    if sh["stage"] == "fragment" and trig > 14:
        add("INFO", "transcendental-density", f"{trig} transcendental calls per pixel")

    return found, {"samplers": samplers, "varyings": re.findall(r"varying\s+\w+\s+(\w+)", g),
                   "uniforms": re.findall(r"uniform\s+\w+\s+(\w+)", g),
                   "lines": len([l for l in g.split("\n") if l.strip()]),
                   "trig": trig}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    shaders, findings, facts = [], [], {}
    for f in FILES:
        if not f.is_file():
            sys.exit(f"missing: {f}")
        for sh in shaders_of(f):
            shaders.append(sh)
            fs, info = audit(sh)
            findings += fs
            facts[sh["file"] + ":" + str(sh["line"])] = info

    if a.json:
        print(json.dumps({"shaders": [{k: v for k, v in s.items() if k != "glsl"} for s in shaders],
                          "facts": facts, "findings": findings}, indent=1))
        return 1 if any(f["severity"] == "FATAL" for f in findings) else 0

    print(f"SHADER AUDIT - {len(shaders)} hand-written GLSL bodies in {len(FILES)} files\n")
    print(f"  {'shader':<26} {'stage':<9} {'where':<34} lines  samplers")
    for s in shaders:
        i = facts[s["file"] + ":" + str(s["line"])]
        where = f'{s["file"]}:{s["line"]}'
        print(f"  {s['name']:<26} {s['stage']:<9} {where:<34} {i['lines']:>5}  "
              f"{','.join(i['samplers']) or '-'}")

    order = {"FATAL": 0, "WARN": 1, "INFO": 2}
    findings.sort(key=lambda f: order[f["severity"]])
    print(f"\n  checks run per shader: builtin-redefinition ({len(BUILTIN_ATTRS)} attributes, "
          f"{len(BUILTIN_UNIFORMS)} uniforms), missing-srgb-decode, srgb-decode-on-data-map,")
    print("  unused-sampler, derivatives-need-extension, no-output, discard, transcendental-density")
    if not findings:
        print("\n  nothing found.")
        return 0
    print(f"\n  {len(findings)} finding(s):\n")
    for f in findings:
        print(f"  [{f['severity']:<5}] {f['check']}")
        print(f"          {f['shader']}  ({f['file']}:{f['line']})")
        print(f"          {f['detail']}\n")
    return 1 if any(f["severity"] == "FATAL" for f in findings) else 0


if __name__ == "__main__":
    sys.exit(main())
