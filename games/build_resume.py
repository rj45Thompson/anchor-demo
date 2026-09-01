#!/usr/bin/env python3
"""Build RJ_Thompson_Resume.pdf - the file the site offers for download.

WHY THIS LIVES IN THE REPO
The previous builder was a throwaway in a session scratchpad. Scratchpads do not survive, so the
shipped PDF became a binary nobody could regenerate or diff, and it silently went stale while the
site around it changed. This script is the source of truth; the PDF is its output.

    py games/build_resume.py

WHAT IT FIXES vs the file it replaces
  * That PDF ran to TWO pages, and page two contained exactly one line: an orphaned URL. A
    recruiter printing it got a second, near-blank sheet. Widow control alone would not fix it,
    because the content genuinely did not fit; the layout is tightened instead.
  * It carried no Tami work and a truncated research section - the two things RJ actually spends
    his current time on.

EVERY LINE HERE IS CHECKABLE. Employers, dates and numbers come from the master .docx via
agentbox/resume_context.txt. The Tami and research entries describe artifacts that exist and are
public or on disk. Nothing is rounded up and nothing is inferred.
"""
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.enums import TA_CENTER

INK   = colors.HexColor("#1a1a1a")
MUTED = colors.HexColor("#5a5a5a")
RULE  = colors.HexColor("#b8b8b8")
HEAD  = colors.HexColor("#1f3b57")

S = dict(
    name=ParagraphStyle("n", fontName="Helvetica-Bold", fontSize=20, leading=23,
                        textColor=INK, spaceAfter=3),
    contact=ParagraphStyle("c", fontName="Helvetica", fontSize=8.2, leading=11.5,
                           textColor=MUTED, spaceAfter=1),
    summary=ParagraphStyle("s", fontName="Helvetica", fontSize=8.6, leading=11.4,
                           textColor=INK, spaceBefore=7, spaceAfter=2),
    section=ParagraphStyle("h", fontName="Helvetica-Bold", fontSize=8.6, leading=11,
                           textColor=HEAD, spaceBefore=9, spaceAfter=1),
    role=ParagraphStyle("r", fontName="Helvetica-Bold", fontSize=8.8, leading=11, textColor=INK),
    when=ParagraphStyle("w", fontName="Helvetica", fontSize=8.0, leading=11,
                        textColor=MUTED, alignment=2),
    body=ParagraphStyle("b", fontName="Helvetica", fontSize=8.3, leading=10.6,
                        textColor=INK, spaceAfter=3.4),
)

# --- experience: company, dates, one line of what was actually done ------------------------------
JOBS = [
    ("Utherverse", "2024-25",
     "Assistant to the Director of Development. Live virtual-world platform operations."),
    ("BioWare", "2023-24",
     "Shipped the dialogue and narrative system for <b>Dragon Age 4</b> on Frostbite."),
    ("Activision", "2022-23",
     "Call of Duty live-ops. Ported low-level networking and real-time voice chat to Nintendo Switch."),
    ("Sega / Relic", "2021-22",
     "<b>Company of Heroes 3</b>. Profiled and optimized a C++ system for a measured <b>7%</b> "
     "performance gain on the shipping title."),
    ("Electronic Arts", "2016-21",
     "Five years on Frostbite editor frameworks, cinematics and lighting. Wrote the blueprint / "
     "visual-scripting system used across the studio."),
    ("Unity (Finger Food)", "2014-16",
     "Development Team Lead across <b>Skylanders</b>, <b>Star Wars BB-8</b> and Call of Duty. "
     "Accelerated Skylanders asset-bundle loading by <b>200%</b>. Shipped Skylanders Imaginators "
     "on iOS and Android."),
    ("Industrial Alliance", "2013-14", "Architected Unification in .NET. WPF, WCF, MVVM."),
    ("Microsoft Big Park", "2012-13", "Real-time Lua UI for NFL, ESPN and UFC on Xbox."),
    ("Novadaq", "2012-13",
     "Lead architect, <b>SPY ELITE</b>. Regulated surgical fluorescence-imaging medical device."),
    ("FinancialCAD", "2010-12", "Lead architect, Silverlight / XNA presentation layer."),
    ("Neoteric", "2004-10", "Win32 / C++ UI libraries. Led a team of four."),
]
EARLIER = ("<b>Earlier:</b> Max Integration, project lead on a Win32 CRM (2004) &nbsp;&middot;&nbsp; "
           "RedHawk Gaming, subsystems and device drivers (2001-03) &nbsp;&middot;&nbsp; "
           "Infowave, QA lead of five (1997-01) &nbsp;&middot;&nbsp; "
           "Electronic Arts, QA on NHL 98, Need for Speed, Warcraft II (1996-97)")

CURRENT = [
    ("Tami - Unity tactics RPG, engine and tooling", "2025 - present",
     "A full tactics RPG built solo in Unity, and more tools than game: a terrain and tile editor "
     "with one runtime engine behind two front-ends, a type-driven UI catalogue with an HTTP "
     "bridge so panels can be inspected and screenshotted headlessly, an authoring tool for "
     "ability and item VFX, and a <b>1,039-test</b> EditMode suite run against an isolated clone "
     "rather than the live editor. Also wrote a Unity Shuriken to Unreal Niagara VFX converter "
     "when no off-the-shelf one existed: <b>65 of 65</b> emitters port structurally, and the "
     "honest finding is that the LOOK does not, because blend mode is a number in the source "
     "material rather than anything a shader name reveals."),
    ("Verification and calibration for AI systems", "2025 - present",
     "A knowledge engine with <b>no neural weights</b> over <b>66.4M facts</b>, running entirely "
     "in the browser: it reports a measured confidence per inference chain and abstains rather "
     "than guessing. Published with its own retraction - the headline result was withdrawn when a "
     "constant-guess baseline passed the same gate at 88.9%, and the corrected figure was "
     "re-measured on four orders of magnitude more evidence. Related public datasets: BossBench "
     "and WarShip on Hugging Face."),
]

SKILLS = [
    ("Languages", "C++ (11/14/17), C#, Python, Lua, JavaScript, SQL"),
    ("Engines", "Frostbite, Unity, Unreal, Havok, Essence"),
    ("Systems", "multithreading, memory management, real-time networking, profiling and optimization"),
    ("UI", "WPF / XAML, MVVM, Win32, custom editor frameworks"),
]


def rule(w=7.28 * inch):
    t = Table([[""]], colWidths=[w], rowHeights=[0.6])
    t.setStyle(TableStyle([("LINEBELOW", (0, 0), (-1, -1), 0.6, RULE),
                           ("TOPPADDING", (0, 0), (-1, -1), 0),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    return t


def entry(flow, title, when, text):
    """Title and dates on one row so a date can never widow onto its own line."""
    t = Table([[Paragraph(title, S["role"]), Paragraph(when, S["when"])]],
              colWidths=[5.55 * inch, 1.73 * inch])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "BOTTOM"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0),
                           ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                           ("TOPPADDING", (0, 0), (-1, -1), 1.5),
                           ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    flow.append(t)
    flow.append(Paragraph(text, S["body"]))


def build(path="games/RJ_Thompson_Resume.pdf"):
    doc = SimpleDocTemplate(path, pagesize=LETTER,
                            topMargin=0.44 * inch, bottomMargin=0.40 * inch,
                            leftMargin=0.61 * inch, rightMargin=0.61 * inch,
                            title="R.J. Thompson - Resume", author="R.J. Thompson",
                            subject="Senior C++ / C# engineer")
    F = []
    F.append(Paragraph("R.J. THOMPSON", S["name"]))
    F.append(Paragraph("236-518-2711 &nbsp;|&nbsp; RJ45Thompson@gmail.com &nbsp;|&nbsp; "
                       "Lac Ste. Anne, Alberta, Canada", S["contact"]))
    F.append(Paragraph("linkedin.com/in/r-j-thompson-9531588 &nbsp;|&nbsp; "
                       "github.com/rj45Thompson &nbsp;|&nbsp; "
                       "rj45thompson.github.io/anchor-demo", S["contact"]))
    F.append(Spacer(1, 5))
    F.append(rule())
    F.append(Paragraph(
        "Senior C++ / C# engineer. 30 years shipping real-time systems: game engines and tooling, "
        "low-level networking, and regulated medical-device software. Authorized to work in Canada, "
        "no sponsorship needed. Open to remote, relocation, or contract.", S["summary"]))

    F.append(Paragraph("CURRENT WORK", S["section"]))
    for a, b, c in CURRENT:
        entry(F, a, b, c)

    F.append(Paragraph("EXPERIENCE", S["section"]))
    for a, b, c in JOBS:
        entry(F, a, b, c)
    F.append(Paragraph(EARLIER, S["body"]))

    F.append(Paragraph("SKILLS", S["section"]))
    for k, v in SKILLS:
        F.append(Paragraph("<b>%s:</b> %s" % (k, v), S["body"]))

    doc.build(F)
    return path


if __name__ == "__main__":
    import os
    p = build()
    print("wrote %s (%d bytes)" % (p, os.path.getsize(p)))
