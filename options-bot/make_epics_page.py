"""Writes epics.html from the model (model/*.yaml), the step trace (model/step_trace.json) and the code's own line numbers,
so the page cannot say anything the model and the trace do not.

    py make_epics_page.py OUT_DIR [--checked "0 holes in the kit's 19 rules"]
"""
import argparse
import ast
import html
import json
import pathlib
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent
BLOB = "https://github.com/rj45Thompson/anchor-demo/blob/main/options-bot/"
E = html.escape


def load(name):
    return yaml.safe_load((ROOT / "model" / name).read_text(encoding="utf-8"))


def lines(rel):
    """{function name: line} for a file's top-level functions."""
    tree = ast.parse((ROOT / rel).read_text(encoding="utf-8"))
    return {n.name: n.lineno for n in tree.body if isinstance(n, ast.FunctionDef)}


def pathway_ids(uc):
    ids, seen = [], {}
    for e in uc.get("ext", []):
        letter = "abcdefghijklmnopqrstuvwxyz"[seen.get(e["at"], 0)]
        seen[e["at"]] = seen.get(e["at"], 0) + 1
        ids.append(f"{uc['id']}.{e['at']}{letter}")
    return ids


class Page:
    def __init__(self, checked):
        self.ucs = load("usecases.yaml")["usecases"]
        self.reqs = {r["id"]: r for r in load("requirements.yaml")["requirements"]}
        self.sources = {s["id"]: s for s in load("people.yaml")["sources"]}
        self.actors = {a["id"]: a for a in load("people.yaml")["actors"]}
        self.trace = json.loads((ROOT / "model" / "step_trace.json").read_text(encoding="utf-8"))["steps"]
        self.code_lines = {"zdt_autopilot.py": lines("zdt_autopilot.py")}
        self.test_lines = lines("tests/test_zdt_autopilot.py")
        self.checked = checked
        self.carried = {}
        for uc in self.ucs:
            for n, s in enumerate(uc.get("steps", []), 1):
                for r in s.get("reqs", []):
                    self.carried.setdefault(r, []).append(f"{uc['id']}.{n}")
            for pid, e in zip(pathway_ids(uc), uc.get("ext", [])):
                for r in e.get("reqs", []):
                    self.carried.setdefault(r, []).append(pid)

    def req_chips(self, ids):
        return "".join(f'<a class="chip req" href="#{E(r)}" title="{E(self.reqs[r]["text"])}">{E(r)}</a>' for r in ids)

    def code_chips(self, links, sid):
        out = []
        ran = set(self.trace.get(sid, {}).get("ran", []))
        for link in links:
            path, _, name = link.partition("::")
            if name and path in self.code_lines:
                url, label = f"{BLOB}{path}#L{self.code_lines[path][name]}", f"{name}()"
                tip = f"ran under this step's tests" if name in ran else "named by this step"
            else:
                url, label, tip = f"{BLOB}{path}", path, "a file of the project"
            out.append(f'<a class="chip code" href="{url}" title="{E(tip)}">{E(label)}</a>')
        return "".join(out)

    def test_list(self, sid):
        tests = self.trace.get(sid, {}).get("tests", [])
        if not tests:
            return ""
        items = "".join(f'<li><a href="{BLOB}tests/test_zdt_autopilot.py#L{self.test_lines[t]}">{E(t)}</a></li>' for t in tests)
        return f'<details class="tests"><summary>{len(tests)} test{"s" if len(tests) > 1 else ""}</summary><ul>{items}</ul></details>'

    @staticmethod
    def outcome(out):
        if out.startswith("rejoin"):
            return f"Back to step {out.split()[1]}."
        return "Ends: its goal is met." if out == "end success" else "Ends: nothing is left behind (the minimal guarantee)."

    def alternates(self, uc):
        rows = []
        for pid, e in zip(pathway_ids(uc), uc.get("ext", [])):
            does = " ".join(d[0].upper() + d[1:] + ("" if d.endswith(".") else ".") for d in e["do"])
            rows.append(f'<li id="{E(pid)}"><span class="pid">{E(pid.split(".", 1)[1])}</span> <b>When {E(e["when"])}:</b> {E(does)} '
                        f'<i>{self.outcome(e["out"])}</i><div class="chips">{self.req_chips(e.get("reqs", []))}</div>{self.test_list(pid)}</li>')
        return f'<h4>Alternate paths</h4><ul class="alts">{"".join(rows)}</ul>' if rows else ""

    def facts(self, uc):
        actor = self.actors[uc["actor"]]["name"]
        pairs = [("Actor", actor), ("Trigger", uc["trigger"]), ("Before", uc["pre"]), ("Succeeds when", uc["success"]),
                 ("At worst", uc["minimal"]), ("Why", uc["why"])]
        dl = "".join(f"<div><dt>{k}</dt><dd>{E(v)}</dd></div>" for k, v in pairs)
        g = uc.get("gulf", {})
        gulf = ""
        if g:
            gulf = (f'<div class="gulf"><p><b>How the {E(actor.lower())} acts:</b> {E(g["exec"]["text"])}</p>'
                    f'<p><b>How they see the result:</b> {E(g["eval"]["text"])}</p></div>')
        return f'<dl class="facts">{dl}</dl>{gulf}'

    def epic(self, uc, children):
        steps = []
        for n, s in enumerate(uc["steps"], 1):
            child = children.get(n)
            link = f' <a class="to" href="#{child["id"]}">{E(child["id"])}: {E(child["name"])}</a>' if child else ""
            steps.append(f'<li id="{E(uc["id"])}.{n}">{E(s["do"])}.{link}<div class="chips">{self.req_chips(s.get("reqs", []))}</div></li>')
        return (f'<section class="epic" id="{uc["id"]}"><p class="kicker">{E(uc["id"])} · epic</p><h2>{E(uc["name"])}</h2>'
                f'{self.facts(uc)}<h4>Steps, each a use case below</h4><ol class="steps">{"".join(steps)}</ol>{self.alternates(uc)}</section>')

    def usecase(self, uc, parent):
        steps = []
        for n, s in enumerate(uc["steps"], 1):
            sid = f"{uc['id']}.{n}"
            code = self.code_chips(s.get("code", []), sid)
            who = "" if code else '<span class="chip none">done by a person or by IB</span>'
            steps.append(f'<li id="{E(sid)}">{E(s["do"])}.<div class="chips">{self.req_chips(s.get("reqs", []))}{code}{who}</div>{self.test_list(sid)}</li>')
        return (f'<section class="uc" id="{uc["id"]}"><p class="kicker">{E(uc["id"])} · use case · <a href="#{parent["uc"]}">'
                f'{E(parent["uc"])}</a> step {parent["step"]}</p><h3>{E(uc["name"])}</h3>{self.facts(uc)}'
                f'<h4>Steps</h4><ol class="steps">{"".join(steps)}</ol>{self.alternates(uc)}</section>')

    def requirement(self, r):
        carried = "".join(f'<a class="chip step" href="#{E(p)}">{E(p)}</a>' for p in self.carried.get(r["id"], []))
        if r["kind"] == "authored":
            src = "".join(f'<p class="src">{E(self.sources[s]["cite"])}: <q>{E(self.sources[s]["text"])}</q></p>' for s in r["sources"])
        else:
            src = f'<p class="src"><b>Why it was added:</b> {E(r["why"])}</p>'
        return (f'<li id="{E(r["id"])}"><p><span class="pid">{E(r["id"])}</span> {E(r["text"])}</p>{src}'
                f'<p class="measure"><b>Checked by:</b> {E(r["measure"])}</p><div class="chips"><span class="lbl">Carried by</span>{carried}</div></li>')

    def render(self):
        kites = [u for u in self.ucs if u["level"] == "kite"]
        seas = [u for u in self.ucs if u["level"] == "sea"]
        n_steps = sum(len(u["steps"]) for u in self.ucs)
        n_alts = sum(len(u.get("ext", [])) for u in self.ucs)
        authored = [r for r in self.reqs.values() if r["kind"] == "authored"]
        inferred = [r for r in self.reqs.values() if r["kind"] == "inferred"]
        tests = {t for v in self.trace.values() for t in v["tests"]}
        body = []
        for k in kites:
            kids = {u["parent"]["step"]: u for u in seas if u["parent"]["uc"] == k["id"]}
            body.append(self.epic(k, kids))
            body.extend(self.usecase(u, u["parent"]) for u in seas if u["parent"]["uc"] == k["id"])
        checked = f'<div><b>0</b><span>{E(self.checked)}</span></div>' if self.checked else ""
        stats = (f'<div class="nums"><div><b>{len(kites)}</b><span>epics</span></div><div><b>{len(seas)}</b><span>use cases</span></div>'
                 f'<div><b>{n_steps}</b><span>steps</span></div><div><b>{n_alts}</b><span>alternate paths</span></div>'
                 f'<div><b>{len(self.reqs)}</b><span>requirements: {len(authored)} from the sources, {len(inferred)} open questions</span></div>'
                 f'<div><b>{len(self.trace)}</b><span>steps and paths run by {len(tests)} tests</span></div>{checked}</div>')
        nav = "".join(f'<a href="#{u["id"]}">{E(u["id"])} {E(u["name"])}</a>' for u in self.ucs)
        reqs = (f'<section id="requirements"><h2>Requirements</h2><p>Each one is carried by the steps listed under it; none names code. '
                f'The steps name the code.</p><h3>From the sources</h3><ul class="reqs">{"".join(self.requirement(r) for r in authored)}</ul>'
                f'<h3>Open questions for the owner</h3><p>Nobody wrote these down: finishing the bot needed them. Each is the bot\'s current '
                f'answer, waiting for the owner\'s yes or a different one.</p><ul class="reqs open">{"".join(self.requirement(r) for r in inferred)}</ul></section>')
        return TEMPLATE.format(stats=stats, nav=nav, body="".join(body), reqs=reqs)


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Options Bot Epics</title>
<meta name="description" content="The options trader bot as epics and use cases: every requirement carried by steps, every step tied to the code its tests ran.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400..700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{{--bg:#0B1219;--panel:#121C26;--panel2:#16222E;--line:#2E4052;--well:#0E1720;--fg:#F4F2EC;--soft:#C9D3DC;--muted:#A9B7C4;
  --accent:#F08A3C;--blue:#7FB2E5;--green:#47D1A0;--amber:#F7C873;--lav:#C3A8F5;
  --sans:'IBM Plex Sans',system-ui,sans-serif;--head:'Space Grotesk',system-ui,sans-serif;--mono:'JetBrains Mono',ui-monospace,Consolas,monospace;color-scheme:dark}}
*{{box-sizing:border-box}}html{{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15.5px/1.6 var(--sans)}}
main{{max-width:960px;margin:0 auto;padding:22px 16px 48px}}a{{color:var(--blue)}}
.crumb{{font-size:13.5px;color:var(--muted);margin:0 0 18px}}.crumb a{{color:var(--muted)}}
h1{{font:700 clamp(28px,5vw,40px)/1.15 var(--head);margin:0 0 10px}}h1 b{{color:var(--accent)}}
h2{{font:600 24px/1.25 var(--head);margin:6px 0 10px}}h3{{font:600 19px/1.3 var(--head);margin:4px 0 10px}}
h4{{font:600 14px/1.3 var(--head);margin:16px 0 6px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em}}
p{{margin:0 0 12px;color:var(--soft)}}.lede{{font-size:16.5px;max-width:780px}}
.nums{{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:18px 0}}
.nums div{{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}}
.nums b{{display:block;font:700 26px/1.1 var(--head);color:var(--green)}}.nums span{{color:var(--muted);font-size:13.5px}}
.nav{{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 26px}}.nav a{{font-size:13px;text-decoration:none;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:4px 10px;color:var(--soft)}}
section{{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:18px 18px 10px;margin:0 0 16px}}
section.epic{{border-color:var(--accent);background:linear-gradient(180deg,rgba(240,138,60,.08),var(--panel) 120px)}}
section.uc{{margin-left:14px}}
.kicker{{font:600 12px/1 var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin:0 0 8px}}.kicker a{{color:var(--muted)}}
.facts{{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:6px 18px;margin:0 0 8px}}
.facts div{{margin:0}}dt{{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}}dd{{margin:0 0 6px;color:var(--soft)}}
.gulf{{background:var(--well);border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin:8px 0}}.gulf p{{margin:0 0 4px}}
ol.steps,ul.alts,ul.reqs{{margin:0 0 10px;padding-left:22px;color:var(--soft)}}
ol.steps li,ul.alts li,ul.reqs li{{margin:0 0 12px}}ul.reqs{{list-style:none;padding-left:0}}
ul.reqs li{{background:var(--well);border:1px solid var(--line);border-radius:10px;padding:10px 12px}}ul.reqs.open li{{border-left:3px solid var(--amber)}}
.chips{{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}}
.chip{{font:12px/1.3 var(--mono);padding:2px 8px;border-radius:999px;border:1px solid var(--line);text-decoration:none;white-space:nowrap}}
.chip.req{{color:var(--amber);background:rgba(247,200,115,.08)}}.chip.code{{color:var(--green);background:rgba(71,209,160,.08)}}
.chip.step{{color:var(--lav);background:rgba(195,168,245,.08)}}.chip.none{{color:var(--muted)}}
.lbl{{font-size:12px;color:var(--muted);margin-right:2px;align-self:center}}
.pid{{font:600 12.5px var(--mono);color:var(--muted);margin-right:4px}}
.to{{font-size:14px;margin-left:4px}}i{{color:var(--muted)}}
details.tests{{margin-top:4px;font-size:13px;color:var(--muted)}}details.tests summary{{cursor:pointer}}details.tests ul{{margin:4px 0 0;padding-left:18px}}
details.tests a{{font-family:var(--mono);font-size:12px;overflow-wrap:anywhere}}
.src,.measure{{font-size:13.5px;color:var(--muted);margin:4px 0;overflow-wrap:anywhere}}q{{color:var(--soft);font-style:italic}}
.key{{display:flex;flex-wrap:wrap;gap:8px 16px;font-size:13.5px;color:var(--muted);margin:0 0 6px}}
footer{{margin-top:30px;padding-top:14px;border-top:1px solid var(--line);font-size:13.5px;color:var(--muted)}}footer p{{color:var(--muted)}}
@media (max-width:560px){{section{{padding:14px 12px 6px}}section.uc{{margin-left:0}}}}
</style>
</head>
<body>
<main>
<p class="crumb"><a href="../">anchor-demo</a> / <a href="./">options trader bot</a> / epics</p>
<h1>Epics and <b>use cases</b></h1>
<p class="lede">What the options trader bot does, written as two epics, each made of use cases told step by step: who acts, what
they see, what can go wrong at each step and where that leads. Every requirement is carried by steps, and only the steps name
code. The tests listed under a step were run under a tracer, and the code a step names is the code those tests ran.</p>
<p class="key"><span><span class="chip req">OB-1</span> a requirement</span><span><span class="chip code">connect()</span> code, opens the line on GitHub</span><span><span class="chip step">UC-1.2</span> a step that carries it</span></p>
{stats}
<nav class="nav">{nav}<a href="#requirements">Requirements</a></nav>
{body}
{reqs}
<footer>
<p>The model this page is made from: <a href="model/usecases.yaml">usecases.yaml</a>, <a href="model/requirements.yaml">requirements.yaml</a>,
<a href="model/people.yaml">people.yaml</a>, <a href="model/step_tests.yaml">step_tests.yaml</a> and <a href="model/step_trace.json">step_trace.json</a>.
It is checked by <code>usecase_model.py</code> from the <a href="https://github.com/rj45Thompson/closed-loop-kit">closed-loop kit</a> and by
<a href="tests/test_model.py">tests/test_model.py</a>.</p>
<p><a href="./">Back to the options trader bot</a>. Software, not financial advice.</p>
</footer>
</main>
<script src="../living-page/1/living-page.js" data-relay="https://living-page-relay.tami-play.workers.dev" data-site="options-bot" data-page="epics"></script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("out")
    ap.add_argument("--checked", default="")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / "epics.html").write_text(Page(a.checked).render(), encoding="utf-8", newline="\n")
    print(f"wrote {out / 'epics.html'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
