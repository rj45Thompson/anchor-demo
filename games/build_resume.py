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
# CORRECTED 2026-09-17. This list had drifted away from the resumes actually being sent to
# employers, and a recruiter who followed the link from an application got a different document
# about the same person. Six dates were wrong and one employer was wrong:
#   * Activision was listed as an employer. It was not. That work was done at EDEN INDUSTRIES,
#     which held the contracts with Activision, Kabam and the Operation Tango team. Eden is the
#     employer; those are the clients. RJ confirmed this 2026-09-17 from his own older resumes.
#   * EA read "2016-21 / five years". It is Oct 2016 - Sep 2020, which is FOUR years.
#   * Microsoft Big Park and Novadaq were both dated 2012-13, which is impossible.
#   * Utherverse, BioWare, Finger Food, Industrial Alliance and Neoteric were all off by a year
#     or more against LinkedIn and the master resume.
# Every date below matches the baseline resumes of 2026-09-17 and RJ's LinkedIn.
JOBS = [
    ("Utherverse", "Jan - May 2025",
     "Assistant to Lead Developer on a four-month contract. Live virtual-world platform "
     "operations, plus hiring, training and departmental planning."),
    ("BioWare", "May - Aug 2024",
     "Shipped the dialog and narrative system for <b>Dragon Age: The Veilguard</b> on Frostbite. "
     "Mentored developers on the Frosted cinematic and narrative system."),
    ("Eden Industries", "Feb 2022 - Dec 2023",
     "Client work in C++ and Unity. <b>Activision, Call of Duty</b>: shipped a new live ops "
     "system. <b>Operation Tango</b>: ported low-level networking and real-time voice chat to "
     "<b>Nintendo Switch</b>. <b>Kabam, Disney Mirrorverse</b>: fixed difficult low-level "
     "threading and networking faults."),
    ("Sega / Relic", "Jan 2021 - Jan 2022",
     "<b>Company of Heroes 3</b>. Profiled and optimized a C++ system for a measured <b>7%</b> "
     "performance gain on the shipping title, and wrote build tools for Perforce and the "
     "pipeline's hot reload."),
    ("Electronic Arts", "Oct 2016 - Sep 2020",
     "Four years on the Frostbite editor: editor frameworks, cinematics, schematics and lighting "
     "workflows. Architected MVVM upgrades to the legacy visual coding diagram library, wrote a "
     "crash control and recovery application, added Azure telemetry, and helped architect the "
     "keyframe editor."),
    ("Unity (Finger Food)", "Apr 2015 - Sep 2016",
     "Development Team Lead across <b>Skylanders</b>, <b>Star Wars BB-8</b> and Call of Duty. "
     "Accelerated Skylanders asset-bundle loading by <b>200%</b>. Shipped Skylanders Imaginators "
     "on iOS and Android."),
    ("Industrial Alliance", "Aug 2014 - Feb 2015", "Architected Unification in .NET. WPF, WCF, MVVM."),
    ("Microsoft Big Park", "Apr 2013 - Aug 2014", "Real-time Lua UI for NFL, ESPN and UFC on Xbox."),
    ("Novadaq", "Apr 2012 - Apr 2013",
     "Lead architect, <b>SPY ELITE</b>. Regulated surgical fluorescence-imaging medical device."),
    ("FinancialCAD", "Sep 2010 - Apr 2012", "Lead architect, Silverlight / XNA presentation layer."),
    ("Neoteric", "Jul 2004 - Jun 2010",
     "Win32 / C++ UI libraries. Led a team of four, with hiring and training."),
]
EARLIER = ("<b>Earlier:</b> Max Integration, project lead on a Win32 CRM (2004) &nbsp;&middot;&nbsp; "
           "RedHawk Gaming, subsystems and device drivers (2001-03) &nbsp;&middot;&nbsp; "
           "Infowave, QA lead of five (1997-01) &nbsp;&middot;&nbsp; "
           "Electronic Arts, QA on NHL 98, Need for Speed, Warcraft II (1996-97)")

CURRENT = [
    # Rewritten 2026-09-06 (RJ: "it's odd as fuck"). The old entry was a devlog paragraph - it
    # led with genre comparisons, and spent its words on asides a hiring manager cannot use.
    # This one leads with the role, names the tools built, and keeps only checkable numbers.
    # RJ 2026-09-06: lead with the SHIPPING PRODUCT, not the engineering hygiene. A test count is
    # not a reason to hire someone; a console title with a date on it is.
    #
    # CORRECTED 2026-09-07, RJ: "tami work is not solo, it's a small indie team, full team." The
    # entry had said "solo design and development", which was wrong and was going out to employers.
    # It is an indie studio and his part in it is the engine and tooling - which is also the part
    # that transfers to another job, so the shorter true version is the stronger one.
    #
    # Then, same day: "don't talk too much about it, make it super short - indie game for startup
    # company, tactics game for Switch, should be done December." Cut from eleven lines to three.
    # Dropped in that cut, recoverable if wanted: the Wandering Sword scope comparison, the
    # 18-element synergy system, the VFX authoring tool, and the 65/65 Shuriken-to-Niagara port.
    #
    # The 33,000 lines is COUNTED, not estimated: 92 product files under Assets/Media/Scripts/
    # BlockPainter/ plus BlockTilePainter*.cs and LevelBrush*.cs, excluding *Tests.cs. wc -l over
    # those is 54,028; 33,202 of those lines are neither blank nor comment, and that stricter
    # figure is the one quoted, because it is the one that survives being checked. The 19,496
    # lines of tests for it are deliberately not counted here or mentioned anywhere.
    # UNNAMED from 2026-09-17. RJ: "You can name it if you want but I don't want to tell my
    # employer just yet." The studio, the title, the platform and the ship date all came out of
    # this entry, because this page is public and his current client can find it by searching his
    # name. Applications and interviews may still name it; a browsable portfolio may not. The
    # engineering below is unchanged and still checkable.
    ("Lead developer, tactics RPG in development", "2025 - present",
     "Contract lead developer at a small independent studio. I build the engine and tooling: a "
     "<b>33,000-line</b> level and terrain authoring tool that replaces the Unity interface, a "
     "<b>132-route</b> HTTP bridge that lets scripts and agents drive the editor headlessly, the "
     "tactics camera and battle cinematics, and a Unity to <b>Unreal Engine 5</b> VFX converter "
     "that moved all <b>65</b> particle emitters into Niagara."),
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
        "low-level networking, and regulated medical-device software. Canadian citizen working "
        "remotely from Alberta: no visa, sponsorship or petition needed to engage me.", S["summary"]))

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
