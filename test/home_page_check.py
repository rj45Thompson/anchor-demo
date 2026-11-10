"""home_page_check.py - drive the site's front page (index.html) the way a visitor would, and
report what actually happened.

Every check prints PASS or FAIL with the value it measured, never a bare "ok":

  ids       the head script's OWN list matches the page's real section ids, both ways; no
            doubled ids; every menu entry has a target.
  desktop   at 1440 px: no sideways scroll; every image loads once scrolled to; every menu entry
            scrolls its section to the top and lights its own row; the filter narrows the menu;
            no console errors (CSP violations included).
  phone     at 390 px (viewport emulation): no sideways scroll and the widest element ends inside
            the screen; the drawer opens, a menu tap closes it and lands on the section, Escape
            and the scrim close it.
  iframe    at 390 and 360 px inside an iframe, the independent measure of the same thing
            (headless Chrome's own window cannot be narrower than about 500 px).
  routes    the previous page's deep links (#think, #reqs, ...) open engine.html on the same tab;
            the names that became cards here (#resume, #space, ...) open those cards;
            ?view=games opens the Games group.
  static    read from the files, no browser: every relative link lands on a file of the site, and
            every link into u2ue's page on an id it holds; the u2ue chapter list is that page's
            manual exactly (every chapter, in its order, under its own title); every figure the
            front page quotes from u2ue's page (data-from="u2ue") is on that page word for word;
            every share picture (og:image) a page names is a file of the site; every page a visitor can
            reach from the front page or the 3D view has a link back to the front page (tools/home_link.py).
  home link at 1280 and 390 px, every one of those pages opened: its link back is on screen and
            nothing covers it (elementFromPoint at its centre is the link), so it can really be clicked.

Needs Playwright for Python and its Chromium (pip install playwright; playwright install chromium).

usage:  py -m http.server 8840            (from the site root, in another terminal)
        py test/home_page_check.py http://127.0.0.1:8840/ [out_dir]
Exit 1 when any check fails. Screenshots go to out_dir (default: a temp folder, printed).
"""
import html, io, json, os, re, sys, tempfile, time
from urllib.parse import unquote
from playwright.sync_api import sync_playwright

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

BASE = sys.argv[1].rstrip("/") + "/" if len(sys.argv) > 1 else "http://127.0.0.1:8840/"
OUT = sys.argv[2] if len(sys.argv) > 2 else tempfile.mkdtemp(prefix="home_check_")
os.makedirs(OUT, exist_ok=True)
results = []

WIDEST = """()=>{const de=document.documentElement; let widest=0, who='';
  for(const el of document.querySelectorAll('body *')){ const cs=getComputedStyle(el);
    if(cs.position==='fixed' || el.closest('#menu')) continue; const r=el.getBoundingClientRect();
    if(r.width===0||r.height===0) continue; if(r.right>widest){widest=r.right; who=el.tagName+(el.id?'#'+el.id:'')+'.'+el.className;}}
  return {inner:innerWidth, sw:de.scrollWidth, cw:de.clientWidth, widest:Math.round(widest*10)/10, who:who}}"""


def check(name, ok, detail):
    results.append({"check": name, "pass": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + " :: " + str(detail))


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def text_of(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def site_file(path):
    """the file of the site a relative link path names (a folder means its index.html), or None. A .html page with no file of
    its own but a .md beside it is served by GitHub Pages, which builds every Markdown file in the repository with Jekyll
    (the site has no .nojekyll); WHITEPAPER.html is that page."""
    f = os.path.join(ROOT, *[p for p in path.split("/") if p])
    if path == "" or path.endswith("/"):
        f = os.path.join(f, "index.html")
    if os.path.isfile(f):
        return f
    if f.endswith(".html") and os.path.isfile(f[:-5] + ".md") and not os.path.exists(os.path.join(ROOT, ".nojekyll")):
        return f[:-5] + ".md"
    return None


def static():
    front = io.open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    u2 = io.open(os.path.join(ROOT, "u2ue", "index.html"), encoding="utf-8").read()
    u2ids = set(re.findall(r'\sid="([^"]+)"', u2))
    hrefs = sorted(set(re.findall(r'href="([^"]+)"', front)))
    dead, n = [], 0
    for href in hrefs:
        if re.match(r"(https?:|mailto:|data:|#)", href):
            continue
        n += 1
        path, _, frag = href.partition("#")
        path = path.split("?")[0]
        if not site_file(path):
            dead.append(href)
        elif frag and path in ("u2ue/", "./u2ue/") and unquote(frag) not in u2ids:
            dead.append(href)
    check("static every relative link lands", n and not dead, "%d relative links, dead: %s" % (n, dead))
    # the chapter list against the manual's own chapters: u2ue's page gives each chapter an <h1 id>
    chapters = [(m.group(1), text_of(m.group(2))) for m in re.finditer(r'<h1[^>]*\sid="([^"]+)"[^>]*>(.*?)</h1>', u2, re.S)]
    box = front.split('<div id="u2ue-chapters"', 1)[-1].split('<article id="blueprint"', 1)[0] if 'id="u2ue-chapters"' in front else ""
    listed = [(m.group(1), text_of(m.group(3))) for m in
              re.finditer(r'<a href="u2ue/#([^"]+)"><span class="cn">([^<]*)</span>(.*?)</a>', box)]
    def bare(t):
        return re.sub(r"^(Appendix [A-Z]\s*\.\s*|\d+\s*\.\s*)", "", t)     # the heading's own number, which the list shows apart
    want = [(i, bare(t)) for i, t in chapters]
    check("static the chapter list is the manual's, in order", listed == want and len(want) > 0,
          "%d chapters on u2ue's page, %d listed; first difference: %s" % (len(want), len(listed),
          next(((a, b) for a, b in zip(listed + [None] * len(want), want) if a != b), None)))
    # what the front page quotes from u2ue's page must be on it, word for word
    u2text = text_of(u2)
    quoted = re.findall(r'<a[^>]*data-from="u2ue"[^>]*>(.*?)</a>', front, re.S)
    missing = [part for q in quoted for part in [text_of(p) for p in re.findall(r"<(?:b|span)>(.*?)</(?:b|span)>", q, re.S)]
               if part not in u2text]
    check("static every quoted u2ue figure is on u2ue's page", quoted and not missing,
          "%d quoted blocks, not on the page: %s" % (len(quoted), missing))
    three = io.open(os.path.join(ROOT, "3d", "index.html"), encoding="utf-8").read()
    pics, bad = 0, []
    for name, src in (("index.html", front), ("u2ue/index.html", u2), ("3d/index.html", three)):
        for url in re.findall(r'<meta property="og:image" content="([^"]+)"', src):
            pics += 1
            rel = url.split("/anchor-demo/", 1)[-1] if "/anchor-demo/" in url else None
            if not rel or not site_file(rel):
                bad.append("%s: %s" % (name, url))
    check("static every share picture is in the site", pics >= 3 and not bad, "%d named, missing: %s" % (pics, bad))
    three_d(front)
    pages = home_link.reachable()
    left = home_link.missing()
    check("static every page reachable from here links back to it", len(pages) > 30 and not left,
          "%d reachable pages, with no link to the front page: %s (tools/home_link.py puts it in); without one by the owner's "
          "choice (home_link.EXEMPT): %s" % (len(pages), [home_link.rel(f) for f, _ in left], sorted(home_link.EXEMPT)))


sys.path.insert(0, os.path.join(ROOT, "tools"))
import home_link  # noqa: E402 - the walk of the site's pages and what counts as a link to its front page

# the link back is on screen at the top of the page and nothing covers it: a link drawn under a layer that lets clicks through to a
# canvas, or hidden in a closed drawer, is in the HTML and still cannot be clicked (the fly-through's phone heading did exactly that)
HOME_HIT = """(rootPath)=>{const out=[];
  for(const a of document.querySelectorAll('a[href]')){ let u; try{u=new URL(a.href)}catch(e){continue}
    if(u.origin!==location.origin || (u.pathname!==rootPath && u.pathname!==rootPath+'index.html')) continue;
    const r=a.getBoundingClientRect(); if(!r.width||!r.height) continue;
    const x=r.left+r.width/2, y=r.top+r.height/2; const on=x>=0&&y>=0&&x<=innerWidth&&y<=innerHeight;
    const top=on?document.elementFromPoint(x,y):null; const hit=!!top&&(top===a||a.contains(top));
    out.push({text:a.textContent.trim().slice(0,30), x:Math.round(x), y:Math.round(y), on:on, hit:hit,
              over: hit||!top ? '' : top.tagName+(top.id?'#'+top.id:'')});}
  return out}"""


def home_links(b):
    root_path = re.sub(r"^https?://[^/]+", "", BASE)
    for w, h in ((1280, 800), (390, 844)):
        ctx = b.new_context(viewport={"width": w, "height": h})
        page = ctx.new_page()
        bad, n, left = [], 0, []
        for f in sorted(home_link.reachable()):
            name = home_link.rel(f)
            if name in ("index.html", "3d/index.html") or name in home_link.EXEMPT:
                continue
            n += 1
            try:
                page.goto(BASE + name, wait_until="load", timeout=30000)
            except Exception as e:
                bad.append("%s: did not load (%s)" % (name, str(e).splitlines()[0][:60]))
                continue
            page.wait_for_timeout(400)
            try:
                links = page.evaluate(HOME_HIT, root_path)
            except Exception as e:
                # games/tami/ asks where the game is served and then goes there, a moment after it loads; only that is waited out
                if "Execution context was destroyed" not in str(e):
                    raise
                page.wait_for_load_state("load", timeout=30000)
                links = page.evaluate(HOME_HIT, root_path) if page.url.startswith(BASE) else None
            if not page.url.startswith(BASE):
                left.append("%s -> %s" % (name, page.url.split("/")[2]))     # a page whose job is to send you elsewhere
                continue
            if not any(l["on"] and l["hit"] for l in links):
                bad.append("%s: %s" % (name, [(l["text"], l["x"], l["y"], "covered by " + l["over"] if l["on"] else "off screen")
                                             for l in links] or "no link"))
        check("home link %d: on every reachable page, on screen and clickable" % w, n > 30 and not bad,
              "%d pages; failing: %s; left the site at once (not shown): %s; not checked, without a link by the owner's choice: %s"
              % (n, bad, left, sorted(home_link.EXEMPT)))
        ctx.close()


def three_d(front):
    """the 3D view (3d/, built from this page by the fly-through builder) against this page: the same cards, groups, shelves, chapters,
    documents and repositories, both ways; every link of its pages lands; every slide it stands up has its two pictures"""
    data = json.load(io.open(os.path.join(ROOT, "3d", "data.json"), encoding="utf-8"))
    items = data["items"]
    kinds = {}
    for iid, it in items.items():
        kinds.setdefault(it["kind"], set()).add(iid)
    body = front.split('<main', 1)[-1]
    want = {"card": set(re.findall(r'<article id="([^"]+)" class="card', body)),
            "group": set(re.findall(r'<section id="([^"]+)" class="group', body)),
            "shelf": set(re.findall(r'<section id="([^"]+)" class="shelf', body))}
    for kind, ids in want.items():
        check("static 3D the same %ss as the page" % kind, ids and ids == kinds.get(kind, set()),
              "%d on the page, %d in 3D; only on the page: %s; only in 3D: %s" % (len(ids), len(kinds.get(kind, ())), sorted(ids - kinds.get(kind, set())), sorted(kinds.get(kind, set()) - ids)))
    box = front.split('<div id="u2ue-chapters"', 1)[-1].split('<article id="blueprint"', 1)[0]
    chapters = set(re.findall(r'<a href="u2ue/#([^"]+)"><span class="cn">', box))
    in_3d = {items[i]["anchor"] for i in kinds.get("chapter", ())}
    check("static 3D every chapter of the manual, and no other", chapters and chapters == in_3d,
          "%d on the page, %d in 3D; missing: %s; extra: %s" % (len(chapters), len(in_3d), sorted(chapters - in_3d), sorted(in_3d - chapters)))
    docs = 0
    for shelf in re.findall(r'<section id="docs-[^"]+" class="shelf.*?</section>', body, re.S):
        docs += len(re.findall(r'class="docrow"', shelf))
        for chips in re.findall(r'<ul class="chips">(.*?)</ul>', shelf, re.S):
            docs += len(re.findall(r"<a\s", chips))
    repos = len(re.findall(r'<a class="item"', body.split('<section id="repos"', 1)[1].split("</section>", 1)[0]))
    check("static 3D every document and repository", docs == len(kinds.get("doc", ())) and repos == len(kinds.get("repo", ())),
          "documents %d on the page, %d in 3D; repositories %d, %d" % (docs, len(kinds.get("doc", ())), repos, len(kinds.get("repo", ()))))
    dead, n = [], 0
    for iid, page in data["pages"].items():
        for href in re.findall(r'href="([^"]+)"', page["head"] + page["foot"]):
            n += 1
            if href.startswith("#"):
                if href[1:] not in items:
                    dead.append("%s: %s" % (iid, href))
            elif href.startswith("../"):
                path = href[3:].split("#")[0].split("?")[0]
                if not site_file(path):
                    dead.append("%s: %s" % (iid, href))
            elif not re.match(r"(https?:|mailto:)", href):
                dead.append("%s: %s (neither ../ nor an item)" % (iid, href))
    for iid, it in items.items():
        n += 1
        path = it["pageView"][3:].split("#")[0] if it["pageView"].startswith("../") else None
        if path is None or not site_file(path):
            dead.append("%s: page view %s" % (iid, it["pageView"]))
    check("static 3D every link of its pages lands", n and not dead, "%d links, dead: %s" % (n, dead[:8]))
    missing = [s for s in data["stops"] for ext in (".webp", ".thumb.webp") if not os.path.isfile(os.path.join(ROOT, "3d", "slides", s + ext))]
    check("static 3D every slide has both its pictures", data["stops"] and not missing, "%d slides, missing: %s" % (len(data["stops"]), missing))


def collect(page, sink):
    page.on("console", lambda m: sink.append("[%s] %s" % (m.type, m.text)) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: sink.append("[pageerror] %s" % e))


def settle(page, limit=5.0):
    """wait until a smooth scroll has stopped: the position unchanged for 300 ms"""
    end, last, still = time.time() + limit, None, 0.0
    while time.time() < end:
        y = page.evaluate("scrollY")
        if y == last:
            still += 0.1
            if still >= 0.3:
                return
        else:
            still, last = 0.0, y
        time.sleep(0.1)


def scroll_all(page):
    """walk the page so lazy images load, the way a reader's scroll would"""
    y, h = 0, page.evaluate("document.documentElement.scrollHeight")
    while y < h:
        page.evaluate("window.scrollTo({top:%d,behavior:'instant'})" % y)
        time.sleep(0.12)
        y += 500
        h = page.evaluate("document.documentElement.scrollHeight")
    time.sleep(0.8)
    page.evaluate("window.scrollTo({top:0,behavior:'instant'})")
    time.sleep(0.3)


def menu_targets(page):
    return page.evaluate("[...document.querySelectorAll('#tree a.row')].map(a=>a.getAttribute('href').slice(1))")


def ids(b):
    ctx = b.new_context()
    page = ctx.new_page()
    page.goto(BASE, wait_until="load")
    own = json.loads(re.search(r"var OWN = (\[.*?\]);", page.content(), re.S).group(1).replace("\n", ""))
    real = page.evaluate("[...document.querySelectorAll('section[id], article[id], footer[id], main[id]')].map(e=>e.id)")
    missing = [i for i in own if not page.evaluate("(i)=>!!document.getElementById(i)", i)]
    check("OWN ids all exist", not missing, "missing: %s" % missing)
    check("every section id is in OWN", not [i for i in real if i not in own], "unlisted: %s" % [i for i in real if i not in own])
    menu = menu_targets(page)
    check("every menu entry has a target", all(page.evaluate("(i)=>!!document.getElementById(i)", t) for t in menu), menu)
    dup = page.evaluate("(()=>{const s={};[...document.querySelectorAll('[id]')].forEach(e=>s[e.id]=(s[e.id]||0)+1);return Object.keys(s).filter(k=>s[k]>1)})()")
    check("no doubled ids", not dup, dup)
    ctx.close()


def desktop(b):
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    page = ctx.new_page()
    msgs = []
    collect(page, msgs)
    page.goto(BASE, wait_until="load")
    time.sleep(1.5)
    page.screenshot(path=os.path.join(OUT, "desktop_1440_top.png"))
    sw = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
    check("desktop no sideways scroll", sw[0] <= sw[1], "scrollWidth %d, clientWidth %d" % tuple(sw))
    scroll_all(page)
    imgs = page.evaluate("[...document.images].map(i=>({src:i.getAttribute('src'), ok:i.complete && i.naturalWidth>0}))")
    bad = [i for i in imgs if not i["ok"]]
    check("desktop every image loads after scrolling", imgs and not bad, "%d images, failed: %s" % (len(imgs), bad))
    page.screenshot(path=os.path.join(OUT, "desktop_1440_full.png"), full_page=True)
    for t in menu_targets(page):
        page.evaluate("window.scrollTo({top:0,behavior:'instant'})")
        time.sleep(0.2)
        page.click('#tree a.row[href="#%s"]' % t)
        settle(page)
        time.sleep(0.15)
        info = page.evaluate("""(id)=>{const el=document.getElementById(id); const r=el.getBoundingClientRect();
            const cur=document.querySelector('#tree .row[aria-current="true"]');
            return {top:Math.round(r.top), hash:location.hash, cur:cur?cur.getAttribute('href'):null,
                    bottom:innerHeight+scrollY>=document.documentElement.scrollHeight-4}}""", t)
        landed = (-2 <= info["top"] <= 40) or (info["bottom"] and 0 <= info["top"] < 900)
        check("desktop menu -> #%s" % t, landed and info["hash"] == "#" + t and info["cur"] == "#" + t,
              "top %spx, hash %s, lit row %s%s" % (info["top"], info["hash"], info["cur"], " (page bottom)" if info["bottom"] else ""))
        if t in ("fly", "engine", "repos"):
            page.screenshot(path=os.path.join(OUT, "desktop_1440_at_%s.png" % t))
    page.fill("#filter", "unreal")
    time.sleep(0.3)
    vis = page.evaluate("[...document.querySelectorAll('#tree li.gr li.leaf')].filter(li=>!li.hidden).map(li=>li.querySelector('a').getAttribute('href'))")
    check("desktop filter 'unreal'", set(vis) >= {"#u2ue-kit", "#u2ue-chapters", "#blueprint", "#bpgames", "#docs-u2ue"} and "#starfighter" not in vis,
          "shown %s, says %r" % (vis, page.inner_text("#found")))
    page.screenshot(path=os.path.join(OUT, "desktop_1440_filter.png"))
    page.fill("#filter", "")
    # the map: one node per card and one per group, and a click on a node goes to its card
    page.evaluate("window.scrollTo({top:0,behavior:'instant'})")
    time.sleep(0.6)
    nodes = page.evaluate("document.getElementById('map').mapNodes()")
    cards = page.evaluate("[...document.querySelectorAll('.card')].map(c=>c.dataset.node)")
    groups = page.evaluate("[...document.querySelectorAll('section[data-map]')].map(s=>s.dataset.map)")
    got_p = sorted(n["label"] for n in nodes if n["kind"] == "p")
    got_h = sorted(n["label"] for n in nodes if n["kind"] == "h")
    check("desktop map has every card and group, nothing else", got_p == sorted(cards) and got_h == sorted(groups),
          "%d project nodes for %d cards, %d group nodes for %s" % (len(got_p), len(cards), len(got_h), groups))
    front = sorted([n for n in nodes if n["kind"] == "p"], key=lambda n: n["z"])[0]
    page.mouse.move(front["x"], front["y"])
    time.sleep(0.2)
    live = [n for n in page.evaluate("document.getElementById('map').mapNodes()") if n["label"] == front["label"]][0]
    page.mouse.move(live["x"], live["y"])
    time.sleep(0.15)
    cursor = page.evaluate("document.getElementById('map').style.cursor")
    page.mouse.click(live["x"], live["y"])
    settle(page)
    got = page.evaluate("location.hash")
    check("desktop map click goes to its card", got == live["href"] and cursor == "pointer",
          "clicked %r at (%d,%d), cursor %s, hash now %s" % (live["label"], live["x"], live["y"], cursor, got))
    check("desktop console clean", not msgs, msgs[:8])
    ctx.close()


def phone(b, w=390, h=844):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    msgs = []
    collect(page, msgs)
    page.goto(BASE, wait_until="load")
    time.sleep(1.5)
    st0 = page.evaluate("""()=>({open:document.body.classList.contains('menuOpen'), x:Math.round(document.getElementById('menu').getBoundingClientRect().left),
        first:(document.querySelector('#tree > ul > li.gr > .rowwrap .l') || {}).textContent})""")
    check("phone %d contents open with the page, Highlights the first group" % w, st0["open"] and st0["x"] >= 0 and st0["first"] == "Highlights",
          "drawer open %(open)s, left edge %(x)s, first group %(first)r" % st0)
    page.screenshot(path=os.path.join(OUT, "phone_%d_opened.png" % w))
    page.keyboard.press("Escape")
    time.sleep(0.5)
    page.screenshot(path=os.path.join(OUT, "phone_%d_top.png" % w))
    m = page.evaluate(WIDEST)
    check("phone %d viewport no sideways scroll" % w, m["sw"] <= m["cw"] and m["widest"] <= m["cw"],
          "innerWidth %(inner)s, scrollWidth %(sw)s, clientWidth %(cw)s, widest right edge %(widest)s (%(who)s)" % m)
    scroll_all(page)
    page.screenshot(path=os.path.join(OUT, "phone_%d_full.png" % w), full_page=True)
    closed = page.evaluate("document.getElementById('menu').getBoundingClientRect().right")
    page.click("#menuBtn")
    time.sleep(0.5)
    st = page.evaluate("""()=>({x:document.getElementById('menu').getBoundingClientRect().left, open:document.body.classList.contains('menuOpen'),
        exp:document.getElementById('menuBtn').getAttribute('aria-expanded'), vis:getComputedStyle(document.getElementById('menu')).visibility,
        focus:document.activeElement && (document.activeElement.getAttribute('href')||document.activeElement.id)})""")
    check("phone %d drawer opens" % w, closed <= 0 and st["open"] and st["exp"] == "true" and st["x"] >= 0 and st["vis"] == "visible",
          "closed right edge %.1f, open left %s, aria-expanded %s, visibility %s, focus on %s" % (closed, st["x"], st["exp"], st["vis"], st["focus"]))
    page.screenshot(path=os.path.join(OUT, "phone_%d_drawer.png" % w))
    page.click('#tree a.row[href="#bossbench"]')
    settle(page)
    st2 = page.evaluate("""()=>({open:document.body.classList.contains('menuOpen'), top:Math.round(document.getElementById('bossbench').getBoundingClientRect().top),
        bar:Math.round(document.getElementById('bar').getBoundingClientRect().bottom), hash:location.hash,
        sub:document.getElementById('barSub').textContent, lit:(document.querySelector('#tree .row[aria-current="true"]')||{}).textContent})""")
    check("phone %d menu tap closes drawer and lands" % w,
          (not st2["open"]) and st2["hash"] == "#bossbench" and st2["bar"] <= st2["top"] <= 90 and st2["lit"] == "BossBench",
          "drawer open %(open)s, card top %(top)spx under a %(bar)spx bar, hash %(hash)s, bar says %(sub)r, lit %(lit)r" % st2)
    page.screenshot(path=os.path.join(OUT, "phone_%d_at_bossbench.png" % w))
    page.click("#menuBtn")
    time.sleep(0.4)
    page.keyboard.press("Escape")
    time.sleep(0.4)
    esc = page.evaluate("[document.body.classList.contains('menuOpen'), document.activeElement && document.activeElement.id]")
    check("phone %d Escape closes drawer" % w, esc[0] is False and esc[1] == "menuBtn", "open %s, focus back on %s" % tuple(esc))
    page.click("#menuBtn")
    time.sleep(0.4)
    page.mouse.click(w - 10, h // 2)
    time.sleep(0.4)
    sc = page.evaluate("document.body.classList.contains('menuOpen')")
    check("phone %d scrim tap closes drawer" % w, sc is False, "open after tap: %s" % sc)
    deep = ctx.new_page()
    collect(deep, msgs)
    deep.goto(BASE + "#bossbench", wait_until="load")
    settle(deep)       # the page scrolls to the card smoothly: measured mid-scroll it reads 161 to 232 px, settled 64 px under a 52 px bar
    dl = deep.evaluate("[document.body.classList.contains('menuOpen'), Math.round(document.getElementById('bossbench').getBoundingClientRect().top), Math.round(document.getElementById('bar').getBoundingClientRect().bottom)]")
    check("phone %d a link to one card opens on the card, the contents shut" % w, dl[0] is False and dl[2] <= dl[1] <= 120,
          "drawer open %s, card top %spx under a %spx bar" % tuple(dl))
    deep.close()
    check("phone %d console clean" % w, not msgs, msgs[:8])
    ctx.close()


def iframe_measure(b):
    for w in (390, 360):
        ctx = b.new_context(viewport={"width": 900, "height": 900})
        page = ctx.new_page()
        page.set_content('<html><body style="margin:0;background:#333"><iframe id="f" src="%s" width="%d" height="860" style="border:0"></iframe></body></html>' % (BASE, w))
        page.wait_for_timeout(3500)
        frame = [f for f in page.frames if f.url.startswith(BASE)][0]
        m = frame.evaluate(WIDEST)
        check("iframe %d no sideways scroll" % w, m["inner"] == w and m["sw"] <= m["cw"] and m["widest"] <= m["cw"],
              "innerWidth %(inner)s, scrollWidth %(sw)s, clientWidth %(cw)s, widest right edge %(widest)s (%(who)s)" % m)
        page.screenshot(path=os.path.join(OUT, "iframe_%d.png" % w))
        ctx.close()


def routes(b):
    cases = [
        ("#reqs", "engine.html#reqs"), ("#think", "engine.html#think"), ("#law", "engine.html#law"),
        ("#audit", "engine.html#audit"), ("#papers", "engine.html#papers"), ("#inv", "engine.html#inv"),
        ("#resume", "#breakout"), ("#space", "#starfighter"), ("#projects", "#u2ue"), ("#bench", "#bossbench"),
        ("#u2ue-manual", "u2ue/#manual"), ("#fly", "#fly"), ("#u2ue", "#u2ue"), ("?view=games", "#games"),
        ("#manual", "#u2ue-chapters"), ("#documentation", "#docs"), ("#docs-blueprint", "#docs-blueprint"),
        ("?view=games#space", "#starfighter"), ("#nonsense-name", "engine.html#nonsense-name"),
    ]
    for suffix, want in cases:
        ctx = b.new_context(viewport={"width": 1280, "height": 800})   # a fresh tab: a real visitor's first load
        page = ctx.new_page()
        page.goto(BASE + suffix, wait_until="load")
        time.sleep(0.8)
        page.wait_for_load_state("load")
        href = page.evaluate("location.href")
        rel = href[len(BASE):] if href.startswith(BASE) else href
        extra = ""
        if want.startswith("engine.html#"):
            on = page.evaluate("""()=>{const x=document.querySelector('.tab.on'); const s=document.querySelector('#invTabs .subtab.on');
                                   return {tab:x?x.dataset.p:null, sub:s?s.dataset.s:null}}""")
            extra = ", that page shows tab %s, sub-tab %s" % (on["tab"], on["sub"])
        check("route %s" % suffix, rel == want, "landed on %s%s" % (rel, extra))
        ctx.close()


static()
with sync_playwright() as p:
    b = p.chromium.launch(args=["--ignore-gpu-blocklist"])
    ids(b)
    desktop(b)
    phone(b, 390, 844)
    iframe_measure(b)
    routes(b)
    home_links(b)
    b.close()

json.dump(results, open(os.path.join(OUT, "results.json"), "w", encoding="utf-8"), indent=1, ensure_ascii=False)
fails = [r for r in results if not r["pass"]]
print("\n%d checks, %d failed. Screenshots in %s" % (len(results), len(fails), OUT))
sys.exit(1 if fails else 0)
