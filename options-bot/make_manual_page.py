"""Writes manual.html: README.md as a page, so the bot page can stay short and link here for anything that needs
explaining. The README stays the one source (it is also the light loop's spec and what the chat reads); nothing on
this page is written by hand.

    py make_manual_page.py OUT_DIR
"""
import argparse
import html
import pathlib
import re
import sys

import markdown

ROOT = pathlib.Path(__file__).resolve().parent
E = html.escape


def github_slug(value, separator):
    """The id GitHub gives the same heading, so a link into the manual means the same section on GitHub too."""
    return re.sub(r"[^\w\- ]", "", value.strip().lower()).replace(" ", separator)


class Manual:
    """The README rendered by Python-Markdown, every heading carrying its GitHub id. ids() is what publish.py's
    dead-link check holds the bot page's 'more' links to."""

    def __init__(self, text):
        md = markdown.Markdown(extensions=["toc", "sane_lists"],
                               extension_configs={"toc": {"slugify": github_slug, "toc_depth": "2-2"}})
        body = md.convert(text)
        head, sep, rest = body.partition("</h1>")
        if not sep:
            raise ValueError("README.md has no '# ' title line: the manual would have no heading")
        self.title, self.body = head + sep, rest
        self.sections = [(t["id"], t["name"]) for t in md.toc_tokens]
        if not self.sections:
            raise ValueError("README.md has no '## ' sections: the manual would have no contents")

    def ids(self):
        return set(re.findall(r'\sid="([^"]+)"', self.title + self.body))

    def render(self):
        nav = "".join(f'<a href="#{E(i)}">{n}</a>' for i, n in self.sections)
        return TEMPLATE.format(title=self.title, nav=nav, body=self.body)


TEMPLATE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Options Bot Manual</title>
<meta name="description" content="The options trader bot's manual: how to run it, every step and what can go wrong, what changed from the original, how it was checked and tested, and how others do the same.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400..700&family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root{{--bg:#0B1219;--panel:#121C26;--line:#2E4052;--well:#0E1720;--fg:#F4F2EC;--soft:#C9D3DC;--muted:#A9B7C4;--accent:#F08A3C;--blue:#7FB2E5;
  --sans:'IBM Plex Sans',system-ui,sans-serif;--head:'Space Grotesk',system-ui,sans-serif;--mono:'JetBrains Mono',ui-monospace,Consolas,monospace;color-scheme:dark}}
*{{box-sizing:border-box}}html{{-webkit-text-size-adjust:100%;text-size-adjust:100%;scroll-behavior:smooth}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15.5px/1.65 var(--sans)}}
main{{max-width:820px;margin:0 auto;padding:22px 16px 48px}}a{{color:var(--blue)}}
.crumb{{font-size:13.5px;color:var(--muted);margin:0 0 18px}}.crumb a{{color:var(--muted)}}
h1{{font:700 clamp(26px,4.6vw,36px)/1.2 var(--head);margin:0 0 12px}}
h2{{font:600 22px/1.25 var(--head);margin:40px 0 10px;padding-top:14px;border-top:1px solid var(--line)}}
h3{{font:600 16.5px/1.3 var(--head);margin:24px 0 6px}}
h2,h3{{scroll-margin-top:12px}}
p{{margin:0 0 14px;color:var(--soft)}}strong{{color:var(--fg)}}
ol,ul{{color:var(--soft);padding-left:22px;margin:0 0 14px}}li{{margin:5px 0}}
code{{font:13px var(--mono);background:var(--well);border:1px solid var(--line);border-radius:6px;padding:1px 5px;color:var(--fg);white-space:nowrap;font-variant-ligatures:none}}
pre{{background:var(--well);border:1px solid var(--line);border-radius:12px;padding:14px;font:12.5px/1.55 var(--mono);white-space:pre-wrap;overflow-wrap:anywhere}}
pre code{{border:0;padding:0;background:none}}
hr{{border:0;border-top:1px solid var(--line);margin:30px 0 16px}}
.nav{{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0 10px}}.nav a{{font-size:13px;text-decoration:none;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:4px 10px;color:var(--soft)}}
.nav a:hover{{border-color:var(--accent)}}
.lp-index-on .nav{{display:none}}
footer{{margin-top:30px;padding-top:14px;border-top:1px solid var(--line);font-size:13.5px;color:var(--muted)}}footer p{{color:var(--muted)}}
</style>
</head>
<body>
<main>
<p class="crumb"><a href="../">anchor-demo</a> / <a href="./">options trader bot</a> / manual</p>
{title}
<nav class="nav">{nav}</nav>
{body}
<footer>
<p>This is the bot's <a href="README.md">README.md</a>, also in the download. <a href="./">Back to the options trader bot</a>.</p>
</footer>
</main>
<script src="../living-page/1/living-page.js" data-relay="https://living-page-relay.tami-play.workers.dev" data-site="options-bot" data-page="manual" data-index></script>
</body>
</html>
"""


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("out")
    a = ap.parse_args()
    out = pathlib.Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    manual = Manual((ROOT / "README.md").read_text(encoding="utf-8"))
    (out / "manual.html").write_text(manual.render(), encoding="utf-8", newline="\n")
    print(f"wrote {out / 'manual.html'}: {len(manual.sections)} sections")
    return 0


if __name__ == "__main__":
    sys.exit(main())
