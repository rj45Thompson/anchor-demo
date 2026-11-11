#!/usr/bin/env python3
"""Publish the site's resume from the resumes RJ sends to employers, and refuse anything that drifted from them.

    py games/build_resume.py "C:/Users/r_jay/Desktop/Applications/2026-09-17 Baseline resumes"

WHY IT CHANGED (2026-11-11)
Until today this script typeset its own one-page resume. It went stale the way a second copy always does: the
two-page resumes were rebuilt on 2026-11-04 and checked line by line against LinkedIn, and this page kept the
09-17 version, with an old home address (RJ, 11-04: no address on the resume, he relocates to the job), role
titles LinkedIn does not use, and a sponsorship line the applications answer differently for US roles. The
Breakout game's bricks had drifted further (BioWare "2023-24" for May to Aug 2024, EA "2016-21" for Oct 2016 to
Sep 2020). So there is now ONE source: the folder of two-page builds (build_2page.py there). This script copies
its Lead class to games/RJ_Thompson_Resume.pdf, writes agentbox/resume_context.txt (the chat box's only facts)
from all five classes, and checks the game's ROWS against the same text. Its older typesetting is in git history.

The project and studio of the current role stay unnamed on every public page (RJ, 2026-09-17: "I don't want to
tell my employer just yet"); the two-page builds already leave them out, and the check below refuses a name.
"""
import re
import shutil
import sys
from pathlib import Path

import pypdf

SITE = Path(__file__).resolve().parent.parent
CLASSES = ["Lead", "AI", "Games", "Cpp", "DotNet"]
PUBLIC_CLASS = "Lead"
# words that must never reach a public resume: the old home address and the current project's names
REFUSED = ["Lac Ste", "Lac Ste.", "Port Moody", "Surrey", "Tami", "Elami", "tactics RPG"]

HEADER = """R.J. Thompson: software engineer and engineering lead, 30 years in software (since 1996).
Canadian citizen. Authorized to work in Canada with no sponsorship needed there. Relocates to the job at his own expense.
RJ45Thompson@gmail.com | 236-518-2711 | linkedin.com/in/r-j-thompson-9531588 | github.com/rj45Thompson
Sample work and experiments: https://rj45thompson.github.io/anchor-demo/
Below are his current resumes, one per kind of role, as he sends them. They are the only facts to answer from.
"""


def text_of(pdf):
    return "\n".join(p.extract_text() for p in pypdf.PdfReader(str(pdf)).pages)


def bullets(text):
    """A resume's lines with wrapped bullets joined back into one line each."""
    out = []
    for line in text.splitlines():
        line = line.strip()
        if not line or re.fullmatch(r"R\.J\. Thompson \| page \d of \d", line.replace("  ", " ")):
            continue
        if out and not line.startswith("•") and out[-1].startswith("•") and not re.search(r"(19|20)\d\d|present", line):
            out[-1] += " " + line
        else:
            out.append(line)
    return out


def refuse(why):
    sys.exit("build_resume: REFUSED: " + why)


def game_rows():
    src = (SITE / "games" / "resume-arkanoid.html").read_text(encoding="utf-8")
    block = src[src.index("const ROWS = ["):src.index("const TONES")]
    return re.findall(r'\["([^"]+)","([^"]+)","([^"]+)"\]', block)


def main(folder):
    folder = Path(folder)
    texts = {}
    for c in CLASSES:
        pdf = folder / ("RJ_Thompson_Resume_%s_2page.pdf" % c)
        if not pdf.exists():
            refuse("missing %s" % pdf)
        r = pypdf.PdfReader(str(pdf))
        if len(r.pages) != 2:
            refuse("%s has %d pages, not 2" % (pdf.name, len(r.pages)))
        texts[c] = text_of(pdf)
        for w in REFUSED:
            if w.lower() in texts[c].lower():
                refuse("%s names %r" % (pdf.name, w))

    every = "\n".join(texts.values())
    bad = []
    for name, years, line in game_rows():
        for w in REFUSED:
            if w.lower() in (name + line).lower():
                bad.append("game row %r names %r" % (name, w))
        employer = name.split(",")[0]          # exactly as the resume writes it, so "Unity (Finger Food)" cannot pass
        near = [m.start() for m in re.finditer(re.escape(employer), every, re.I)]
        if not near:
            bad.append("game row %r: %r is not on any resume" % (name, employer))
            continue
        m = re.fullmatch(r"(\d{4})(?:-(\d{2}|now))?", years)
        if not m:
            bad.append("game row %r: years %r are not YYYY, YYYY-YY or YYYY-now" % (name, years))
            continue
        start, end = m.group(1), m.group(2)
        # the dates sit on the line under "Title, Employer", or in brackets on the Earlier line: "(2014-15)"
        if end is None or end == "now":
            wants = [start] + ([] if end is None else ["present"])
        else:                                   # "1997-01" ends in 2001, not 1901
            century = int(start[:2]) + (1 if int(end) < int(start[2:]) else 0)
            wants = [start, "%d%s" % (century, end), "-" + end + ")"]
        def beside(i):
            win = every[max(0, i - 120):i + 160]
            return start in win and (end is None or any(w in win for w in wants[1:]))
        if not any(beside(i) for i in near):
            bad.append("game row %r %s: those years are not beside %r on any resume" % (name, years, employer))
    if bad:
        refuse("the Breakout game's ROWS drifted from the resumes:\n  " + "\n  ".join(bad))

    shutil.copyfile(folder / ("RJ_Thompson_Resume_%s_2page.pdf" % PUBLIC_CLASS), SITE / "games" / "RJ_Thompson_Resume.pdf")

    seen, parts = set(), [HEADER]
    for c in CLASSES:
        keep = [b for b in bullets(texts[c]) if b not in seen]
        seen.update(keep)
        parts.append("=== %s resume%s ===\n%s\n" % (c, "" if c == PUBLIC_CLASS else " (only what the resumes above do not already say)",
                                                    "\n".join(keep)))
    (SITE / "agentbox" / "resume_context.txt").write_text("\n".join(parts), encoding="utf-8", newline="\n")
    print("build_resume: games/RJ_Thompson_Resume.pdf = the %s class; agentbox/resume_context.txt from %d classes; "
          "%d game rows agree" % (PUBLIC_CLASS, len(CLASSES), len(game_rows())))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
