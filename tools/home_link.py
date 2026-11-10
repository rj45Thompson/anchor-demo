"""home_link.py - every page a visitor can reach from the front page or the 3D view has a way back to the front page.

Asked 11-08: from every demo in the fly-through (u2ue and the rest) a visitor can go back up to the very main menu, the site's root.
About ten generators in two lanes write these pages (the closed loop's public_build.py and fly_manual.py, the Blueprint view's
showcase.py and build_deck.py, hand-made games), so the link is put in here, once, after they write, and test/home_page_check.py
fails the push while any reachable page has no link that lands on the site root. A rebuild that drops the link turns that check
red; run this again.

  reachable(root)   the site's own pages a visitor can reach, walking relative links from index.html, 3d/ and the 3D view's data
  root_link(f)      the first <a> on a page that lands on the site root (relative, or the hosted address), or None
  PLACES            where the link goes on each kind of page: inside the bar the page already has, else a small fixed button
  stamp(f)          puts the link in, or refreshes it, between <!--home-link--> and <!--/home-link--> so a re-run replaces it
  EXEMPT            pages the owner wants without one (with his words): never stamped, never counted as missing

usage:  py tools/home_link.py            stamp every reachable page with no root link of its own (a page already marked is left as it is)
        py tools/home_link.py --refresh  also re-stamp the pages this tool marked before, except KEEP (after a change to PLACES)
        py tools/home_link.py --check    list the reachable pages with no root link and exit 1 if there are any; change nothing
"""
import collections
import io
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOSTED = re.compile(r"https://rj45thompson\.github\.io/anchor-demo/?(#.*)?$", re.I)
HREF = re.compile(r'''href\s*=\s*\\?["']([^"'\\]*)''', re.I)
ANCHOR = re.compile(r'''<a\b[^>]*\bhref\s*=\s*["']([^"']*)["'][^>]*>''', re.I)
MARK = re.compile(r"<!--home-link-->.*?<!--/home-link-->", re.S)
TEXT = "&larr; All projects"
TIP = "All projects: back to the front page"

# where the link goes, first match wins: (what the page has, the pattern that holds it, what to put in, kept group first).
# Each bar's own links are styled by the page, so an inline link takes the bar's look. ALSO places are put in as well as the
# first match, wherever they occur: the fly-through hides its tree behind "Contents" on a phone, so its phone byline carries one too.
ALSO = [
    # its heading block lets taps through to the graph (#here {pointer-events:none}), so the link takes them back
    ("the fly-through's phone byline", r'(<p id="byPhone"><span>[^<]*</span>)',
     '<span aria-hidden="true"> &middot; </span><a href="{root}" title="{tip}" style="pointer-events:auto">{text}</a>'),
]
PLACES = [
    ("the fly-through's tree head", r'(<p class="by"><span>[^<]*</span>)',
     '<span aria-hidden="true"> &middot; </span><a href="{root}" title="{tip}">{text}</a>'),
    ("the closed loop's Key concepts bar", r'(<nav aria-label="Key concepts"[^>]*>)',
     '<a href="{root}" title="{tip}">{text}</a>'),
    ("the Blueprint view's site bar", r'(<nav class="sitebar"[^>]*>)',
     '<a href="{root}" title="{tip}">{text}</a><span class="sep"></span>'),
    ("the deck's top bar", r'(<header class="top"><h1>[^<]*</h1>)',
     '<span><a href="{root}" title="{tip}">{text}</a></span>'),
    ("the manual's header", r'(<header class="top" id="top">\s*)(?=<p class="eyebrow">)',
     '<p class="eyebrow"><a href="{root}" title="{tip}">{text}</a></p>\n'),
    # no bar: a small button fixed in the top right corner, clear of a phone's notch; dark and translucent so it reads on any page
    ("a fixed button", r'(<body\b[^>]*>)', None),
    # a page that leaves out <body> (HTML allows it; games/resume-arkanoid.html does): just before its first content element, never
    # before its <meta charset>, which must stay in the head
    ("a fixed button", r'()(?=<(?:div|main|section|canvas|header)\b)', None),
]
FIXED = ('<a href="{root}" title="{tip}" style="position:fixed;z-index:2147483000;top:max(10px,env(safe-area-inset-top,0px));'
         'right:max(10px,env(safe-area-inset-right,0px));padding:7px 12px;border-radius:999px;background:rgba(18,20,26,.84);'
         'border:1px solid rgba(255,255,255,.28);color:#fff;font:600 13px/1.2 system-ui,-apple-system,Segoe UI,sans-serif;'
         'text-decoration:none;letter-spacing:.01em;box-shadow:0 2px 10px rgba(0,0,0,.3)">{text}</a>')


# pages whose own link back exists but cannot be used from the top, measured by test/home_page_check.py's "home link" check on 11-08;
# they are stamped too. A page joins this list only with the measurement that put it here.
FORCE = {
    "harness/index.html": "its own link ('Anchor demo home') is the last line of the page, 3,800 px down at 1280 wide",
    "casement/index.html": "its own link sits in a side menu a phone does not show; at 390 wide the next one is 5,400 px down",
}


# pages whose block between the markers was placed by their own lane, never re-stamped (even by --refresh)
KEEP = {}


# pages the owner wants WITHOUT a link back: never stamped, and not counted as missing one. A page joins this list only with his words.
EXEMPT = {
    "tidewall/index.html": "the owner, 11-08 22:24 local: \"I don't want the go back to projects button on tidewal\" (relayed by the "
                           "Rampart session; its lane took the block out in bc3c1fc)",
}


def page_file(base, href):
    """the site page a relative link names (a folder means its index.html), or None"""
    path = href.split("#")[0].split("?")[0]
    if not path or re.match(r"(https?:|mailto:|javascript:|data:)", href):
        return None
    f = os.path.abspath(os.path.join(base, path))
    if os.path.isdir(f):
        f = os.path.join(f, "index.html")
    return f if f.startswith(ROOT) and f.endswith((".html", ".htm")) and os.path.isfile(f) else None


def reachable():
    """{page: the page that first links to it}, walking from the front page and the 3D view (whose links live in its data)"""
    start = [os.path.join(ROOT, "index.html"), os.path.join(ROOT, "3d", "index.html")]
    seen, todo = {}, collections.deque((s, None) for s in start)
    while todo:
        f, came = todo.popleft()
        if f in seen:
            continue
        seen[f] = came
        texts = [io.open(f, encoding="utf-8", errors="replace").read()]
        if f == start[1]:
            texts.append(io.open(os.path.join(ROOT, "3d", "data.json"), encoding="utf-8").read())
        for text in texts:
            for href in HREF.findall(text):
                g = page_file(os.path.dirname(f), href)
                if g and g not in seen:
                    todo.append((g, f))
    return seen


def root_link(f, text=None):
    """the first link on the page that lands on the site root, or None"""
    text = text if text is not None else io.open(f, encoding="utf-8", errors="replace").read()
    for href in ANCHOR.findall(text):
        if HOSTED.match(href):
            return href
        path = href.split("#")[0].split("?")[0]
        if not path or re.match(r"(https?:|mailto:|javascript:|data:)", href):
            continue
        if os.path.abspath(os.path.join(os.path.dirname(f), path)) in (ROOT, os.path.join(ROOT, "index.html")):
            return href
    return None


def rel(f):
    return os.path.relpath(f, ROOT).replace(os.sep, "/")


def in_progress():
    """pages another lane is writing right now: not committed yet, or changed and not by this tool. They are never stamped (11-08:
    this tool stamped a new tidewall/index.html 90 s after its lane began writing it); the push check still names them."""
    out = subprocess.run(["git", "-C", ROOT, "status", "--porcelain", "--untracked-files=all"], capture_output=True, text=True,
                         encoding="utf-8", check=True).stdout
    busy = set()
    for line in out.splitlines():
        f = os.path.abspath(os.path.join(ROOT, line[3:].strip().strip('"')))
        if not f.endswith((".html", ".htm")) or not os.path.isfile(f):
            continue
        if line.startswith("??"):
            busy.add(f)                    # not committed yet
        elif "<!--home-link-->" not in io.open(f, encoding="utf-8", errors="replace").read():
            busy.add(f)                    # changed, and the change is not this tool's
    return busy


def missing():
    """the reachable pages with no root link, the two start pages aside (the front page is the root; the 3D view links it) and the
    EXEMPT ones"""
    pages = reachable()
    return [(f, pages[f]) for f in sorted(pages) if pages[f] is not None and rel(f) not in EXEMPT and not root_link(f)]


def stamp(f):
    """put the link into the page at its first matching place; returns the place's name. A page stamped before is cleaned first."""
    text = io.open(f, encoding="utf-8", newline="").read()
    text = MARK.sub("", text)
    up = os.path.relpath(ROOT, os.path.dirname(f)).replace(os.sep, "/")
    href = "./" if up == "." else up + "/"
    def put(text, pattern, block):
        m = re.search(pattern, text)
        if not m:
            return text, False
        link = "<!--home-link-->" + (block or FIXED).format(root=href, tip=TIP, text=TEXT) + "<!--/home-link-->"
        return text[:m.end(1)] + link + text[m.end(1):], True
    also = []
    for name, pattern, block in ALSO:
        text, hit = put(text, pattern, block)
        also += [name] if hit else []
    for name, pattern, block in PLACES:
        text, hit = put(text, pattern, block)
        if hit:
            io.open(f, "w", encoding="utf-8", newline="").write(text)
            if not root_link(f):
                raise SystemExit("home_link: stamped %s at %s but the page still has no link to the root" % (rel(f), name))
            return ", ".join([name] + also)
    raise SystemExit("home_link: no place for the link on %s (no bar it knows, and no <body> tag)" % rel(f))


def main():
    if "--check" in sys.argv:
        bad = missing()
        print("%d reachable pages, %d with no link back to the front page" % (len(reachable()), len(bad)))
        for f, came in bad:
            print("  %s  (linked from %s)" % (rel(f), rel(came)))
        return 1 if bad else 0
    # a page that already carries a block is left as it is: its lane may have placed it by hand (KEEP). --refresh re-stamps the
    # rest, so a changed PLACES reaches every page this tool stamped
    refresh = "--refresh" in sys.argv
    pages = reachable()
    busy = in_progress()

    def wants(f):
        if rel(f) in EXEMPT:
            return False
        marked = "<!--home-link-->" in io.open(f, encoding="utf-8").read()
        if marked:
            return refresh and rel(f) not in KEEP
        return not root_link(f) or rel(f) in FORCE
    todo = [f for f in sorted(pages) if pages[f] is not None and wants(f)]
    for f in [f for f in todo if f in busy]:
        print("  %-40s left alone: another lane is writing it (uncommitted); stamp it once that lane commits" % rel(f))
    todo = [f for f in todo if f not in busy]
    for f in todo:
        print("  %-40s %s" % (rel(f), stamp(f)))
    left = missing()
    print("%d pages stamped; %d reachable pages still with no link back: %s" % (len(todo), len(left), [rel(f) for f, _ in left]))
    return 1 if left else 0


if __name__ == "__main__":
    sys.exit(main())
