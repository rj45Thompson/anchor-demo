"""play_check.py - plays Shatterbelt in headless Chromium the way a player would, and fails on anything wrong.

It serves the site from its root, opens shatterbelt/, and:
  title     waits for the title screen and takes a picture
  play      presses Enter, then fires and turns (and thrusts now and then) for 60 seconds of game time,
            taking a picture just after a rock breaks
  over      stops firing and flies on until the last ship is lost, then takes a picture of the game over screen
  replay    presses "Watch the replay" and waits for the page's own check that the replay ended in the same state
  hour      plays a game whose input log is already full (an hour of play recorded into it through its own
            record()), to the end: the game over screen must say there is no replay, and offer none
  pad       with a stand-in gamepad (navigator.getGamepads answers with an object the check presses buttons on):
            A starts, Start pauses, and Start again carries on
  phone     opens the page at 375 px wide as a touch phone: no sideways scroll, the touch buttons show in play
Every picture is checked for a blank game view (almost no variation in the pixels), and any console error or
uncaught exception fails the run.

Needs Playwright for Python and its Chromium (pip install playwright; playwright install chromium) and Pillow.

usage:  py shatterbelt/tools/play_check.py [out_dir] [--write]      (from the site root)
        --write puts the measured numbers into shatterbelt/index.html (the "In a real browser" block)
Exit 1 when any check fails.
"""
import functools, html, http.server, json, math, os, re, socketserver, statistics, sys, tempfile, threading, time
from PIL import Image
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.dirname(HERE)
OUT = next((a for a in sys.argv[1:] if not a.startswith("--")), None) or tempfile.mkdtemp(prefix="shatterbelt_play_")
os.makedirs(OUT, exist_ok=True)
results, problems = [], []


def check(name, ok, detail):
    results.append({"check": name, "pass": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + " :: " + str(detail))


def serve():
    class Quiet(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass
    handler = functools.partial(Quiet, directory=SITE)
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, "http://127.0.0.1:%d/shatterbelt/" % server.server_address[1]


def not_blank(path, box):
    """the game view in this picture has real content: enough spread in brightness and enough lit pixels"""
    img = Image.open(path).convert("L").crop(box)
    px = list(img.tobytes())  # one byte per pixel in L mode
    spread = statistics.pstdev(px)
    lit = sum(1 for p in px if p > 40) / len(px)
    return spread > 12 and lit > 0.02, "brightness spread %.1f, %.1f%% of pixels lit" % (spread, lit * 100)


def stage_box(page):
    r = page.evaluate("(()=>{const r=document.getElementById('stage').getBoundingClientRect();return [r.left,r.top,r.right,r.bottom]})()")
    return tuple(int(v) for v in r)


def shoot(page, name):
    path = os.path.join(OUT, name + ".png")
    page.screenshot(path=path)
    ok, detail = not_blank(path, stage_box(page))
    check("picture %s is not blank" % name, ok, "%s (%s)" % (detail, path))
    return path


def game(page, expr):
    return page.evaluate("(() => { const s = window.shatterbelt; const g = s.game; return %s; })()" % expr)


def listen(page, sink):
    page.on("console", lambda m: sink.append("[%s] %s" % (m.type, m.text)) if m.type in ("error", "warning") else None)
    page.on("pageerror", lambda e: sink.append("[pageerror] %s" % e))


def desktop(browser, base, msgs):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    listen(page, msgs)
    page.goto(base, wait_until="load")
    page.wait_for_function("window.shatterbelt && window.shatterbelt.mode === 'title'", timeout=60000)
    gpu = page.evaluate("""(()=>{const c=document.createElement('canvas').getContext('webgl'); const i=c&&c.getExtension('WEBGL_debug_renderer_info');
                           return i ? c.getParameter(i.UNMASKED_RENDERER_WEBGL) : 'unknown'})()""")
    page.wait_for_timeout(1500)
    shoot(page, "1_title")
    hud = page.evaluate("getComputedStyle(document.getElementById('hud')).display")
    check("the score bar is hidden on the title screen", hud == "none", "#hud display: %s" % hud)

    page.keyboard.press("Enter")
    page.wait_for_function("window.shatterbelt.mode === 'playing'")
    hud = page.evaluate("getComputedStyle(document.getElementById('hud')).display")
    check("the score bar shows in play", hud != "none", "#hud display: %s" % hud)
    wall0, frames0 = time.time(), game(page, "s.stats.frames")
    page.keyboard.down("Space")
    turn, mid_shot, last_broken = 0, None, 0
    while game(page, "g.time") < 60:
        key = "ArrowLeft" if turn % 4 < 3 else "ArrowRight"
        page.keyboard.down(key); page.wait_for_timeout(260); page.keyboard.up(key)
        if turn % 9 == 4:
            page.keyboard.down("ArrowUp"); page.wait_for_timeout(220); page.keyboard.up("ArrowUp")
        turn += 1
        broken = game(page, "s.stats.rocksBroken")
        if mid_shot is None and game(page, "g.time") > 8 and broken > last_broken and game(page, "g.ship.alive"):
            page.wait_for_timeout(90)
            mid_shot = shoot(page, "2_mid_play")
        last_broken = broken
        if game(page, "g.over"):
            break
    played = game(page, "({time: g.time, score: g.score, wave: g.wave, ships: g.ships, broken: s.stats.rocksBroken, explosions: s.stats.explosions})")
    fps = (game(page, "s.stats.frames") - frames0) / (time.time() - wall0)
    # this page's own CPU time per frame over the last 600 frames of play (main.js frameCost: steps + issuing draws)
    cost = sorted(game(page, "Array.from(s.frameCost)"))
    frame_cost = {"median": cost[len(cost) // 2], "p99": cost[min(len(cost) - 1, int(len(cost) * 0.99))], "max": cost[-1], "frames": len(cost)}
    check("a frame's own CPU time fits the 16.7 ms of a 60 Hz frame for 99 frames in 100", frame_cost["p99"] < 16.7,
          "median %.2f ms, 99th percentile %.2f ms, slowest %.2f ms, over the last %d frames" % (frame_cost["median"], frame_cost["p99"], frame_cost["max"], frame_cost["frames"]))
    page.keyboard.up("Space")
    check("played 60 s of game time with fire held", played["time"] >= 60 or played["ships"] == 0,
          "%.1f s of game time, score %d, wave %d, %d rocks broken, %d explosions" % (played["time"], played["score"], played["wave"], played["broken"], played["explosions"]))
    check("a mid-play picture was taken just after a rock broke", mid_shot is not None, mid_shot)
    check("rocks really broke", played["broken"] >= 10, "%d rocks broken" % played["broken"])

    # now fly into trouble until the last ship is gone
    page.keyboard.down("ArrowUp")
    deadline = game(page, "g.time") + 300
    while not game(page, "g.over") and game(page, "g.time") < deadline:
        page.keyboard.down("ArrowLeft"); page.wait_for_timeout(400); page.keyboard.up("ArrowLeft"); page.wait_for_timeout(300)
    page.keyboard.up("ArrowUp")
    page.wait_for_function("window.shatterbelt.mode === 'over'", timeout=20000)
    page.wait_for_timeout(600)
    over = game(page, "({time: g.time, score: g.score, steps: g.steps, text: document.getElementById('overScore').textContent})")
    check("game over screen shows the final score", over["text"].replace(",", "") == str(over["score"]), "screen says %s, game says %d" % (over["text"], over["score"]))
    shoot(page, "3_game_over")
    feel = game(page, "({banners: s.stats.banners.slice(), slowMos: s.stats.slowMos, lost: s.stats.shipsLost})")
    check("the last ship is announced before the game ends", "Last ship" in feel["banners"], "banners shown: %s" % feel["banners"])
    check("losing a ship slows time for a moment, every time", feel["lost"] > 0 and feel["slowMos"] == feel["lost"],
          "%s ships lost, %s slow-motion moments" % (feel["lost"], feel["slowMos"]))
    # the code on the page is read by people: no line hidden past a box's right edge, no box drawn round each line
    code = page.evaluate("""() => [...document.querySelectorAll('pre.code')].map((p, i) => ({i, over: p.scrollWidth - p.clientWidth,
        boxed: [...p.querySelectorAll('code')].some(c => parseFloat(getComputedStyle(c).borderTopWidth) > 0)}))""")
    hidden = [c for c in code if c["over"] > 1]
    check("every code block on the page fits its box at 1280 px", not hidden,
          "%d blocks, all fit" % len(code) if not hidden else "%d of %d overflow: %s" % (len(hidden), len(code), hidden))
    boxed = [c["i"] for c in code if c["boxed"]]
    check("code blocks have no box drawn round each line", not boxed, "none" if not boxed else "blocks %s" % boxed)
    best = page.evaluate("(()=>{try{return localStorage.getItem('shatterbelt.best')}catch(e){return 'blocked'}})()")
    check("best score saved", best is not None and int(best) >= over["score"], "localStorage best = %s" % best)

    check("a game within the hour offers its replay", page.is_visible("#replayBtn"), "Watch the replay is shown")
    page.click("#replayBtn")
    page.wait_for_function("window.shatterbelt.mode === 'over' && window.shatterbelt.stats.replayMatched !== null", timeout=240000)
    matched = game(page, "s.stats.replayMatched")
    check("the replay from seed + input log ends in exactly the same state", matched is True,
          document_text(page, "replayResult"))
    past_an_hour(page)
    ctx.close()
    return {"gpu": gpu, "fps": fps, "played": played, "over": over, "replay": matched, "frame_cost": frame_cost}


def past_an_hour(page):
    """a game longer than the input log's hour: the log stops recording, and the game over screen says there is no
    replay rather than offering one that would not match. The hour is recorded into the log through its own
    record() (216,000 steps in a moment), then the game is played on, unrecorded, to its end."""
    page.keyboard.press("Enter")
    page.wait_for_function("window.shatterbelt.mode === 'playing'")
    filled = page.evaluate("""(() => { const log = window.shatterbelt.log;
        while (log.length < log.bytes.length) log.record(0);
        return [log.length, log.bytes.length, log.dropped]; })()""")
    page.keyboard.down("ArrowUp")
    deadline = game(page, "g.time") + 300
    while not game(page, "g.over") and game(page, "g.time") < deadline:
        page.keyboard.down("ArrowLeft"); page.wait_for_timeout(400); page.keyboard.up("ArrowLeft"); page.wait_for_timeout(300)
    page.keyboard.up("ArrowUp")
    page.wait_for_function("window.shatterbelt.mode === 'over'", timeout=20000)
    page.wait_for_timeout(600)
    dropped = game(page, "s.log.dropped")
    offered = page.is_visible("#replayBtn")
    said = document_text(page, "replayResult")
    shoot(page, "8_over_past_an_hour")
    check("a game past the hour: the log stopped recording, and the over screen says there is no replay",
          filled[0] == filled[1] == 216000 and dropped > 0 and not offered and "No replay" in said,
          "log %d of %d steps, %d steps not recorded; replay button %s; says: %s" % (
              filled[0], filled[1], dropped, "shown" if offered else "hidden", said))


# A stand-in for the Gamepad API, so the check can press a pad's buttons: navigator.getGamepads() answers with one
# standard-layout pad whose buttons window.__pad.press(index, down) sets.
PAD_SCRIPT = """
window.__pad = { id: 'play_check stand-in pad', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
  press(i, down) { this.buttons[i] = { pressed: down, touched: down, value: down ? 1 : 0 }; } };
Object.defineProperty(Navigator.prototype, 'getGamepads', { value: () => [window.__pad], configurable: true });
"""


def gamepad(browser, base, msgs):
    """the pad: A starts a game, Start pauses it, and Start again carries on (the page reads the pad inside game
    steps, and none run while paused, so the second press needs reading outside them)"""
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ctx.add_init_script(PAD_SCRIPT)
    page = ctx.new_page()
    listen(page, msgs)
    page.goto(base, wait_until="load")
    page.wait_for_function("window.shatterbelt && window.shatterbelt.mode === 'title'", timeout=60000)
    page.wait_for_timeout(500)

    def press(button):
        page.evaluate("window.__pad.press(%d, true)" % button); page.wait_for_timeout(250)
        page.evaluate("window.__pad.press(%d, false)" % button); page.wait_for_timeout(400)
        return page.evaluate("window.shatterbelt.mode")

    after = {"A": press(0)}
    after["Start"] = press(9)
    steps = game(page, "g.steps")
    page.wait_for_timeout(500)
    held = game(page, "g.steps") == steps
    after["Start again"] = press(9)
    page.wait_for_timeout(300)
    moving = game(page, "g.steps") > steps
    check("gamepad: A starts, Start pauses, Start again carries on",
          after == {"A": "playing", "Start": "paused", "Start again": "playing"} and held and moving,
          "mode after A: %s, after Start: %s (game held still: %s), after Start again: %s (steps running: %s)" % (
              after["A"], after["Start"], held, after["Start again"], moving))
    ctx.close()


def document_text(page, id_):
    return page.evaluate("document.getElementById(%s).textContent" % json.dumps(id_))


def phone(browser, base, msgs):
    ctx = browser.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    listen(page, msgs)
    page.goto(base, wait_until="load")
    page.wait_for_function("window.shatterbelt && window.shatterbelt.mode === 'title'", timeout=60000)
    page.wait_for_timeout(1200)
    wide = page.evaluate("[document.documentElement.scrollWidth, document.documentElement.clientWidth]")
    check("phone 375: no sideways scroll", wide[0] <= wide[1], "scrollWidth %d, clientWidth %d" % tuple(wide))
    shoot(page, "4_phone_title")
    page.tap("#playBtn")
    page.wait_for_function("window.shatterbelt.mode === 'playing'")
    field = game(page, "[g.field.width, g.field.height]")
    check("phone 375: an upright phone gets an upright field", field[1] > field[0], "field %d x %d" % tuple(field))
    pad = page.evaluate("getComputedStyle(document.querySelector('.touchpad')).display")
    check("phone 375: the touch buttons show during play", pad == "flex", "touchpad display: %s" % pad)
    page.wait_for_timeout(400)   # let any scroll the start of play does settle
    check_buttons_on_screen(page, "phone 375x812")
    # a real held touch on Fire (through the browser's input layer), and one on Turn left at the same time
    cdp = ctx.new_cdp_session(page)
    fire = page.locator('[data-input="Fire"]').bounding_box()
    left = page.locator('[data-input="Left"]').bounding_box()
    points = [{"x": fire["x"] + fire["width"] / 2, "y": fire["y"] + fire["height"] / 2, "id": 1},
              {"x": left["x"] + left["width"] / 2, "y": left["y"] + left["height"] / 2, "id": 2}]
    # the rules wrap the ship's angle to within half a turn of 0, so how far it turned is summed a sample at a time,
    # each the short way (a 100 ms sample turns about 0.5 rad, well under a half turn)
    last = game(page, "g.ship.angle")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": points})
    fired, turned = 0, 0.0
    for _ in range(30):
        page.wait_for_timeout(100)
        fired = max(fired, game(page, "g.bullets.countAlive(b => b.fromShip)"))
        now = game(page, "g.ship.angle")
        turned += math.atan2(math.sin(now - last), math.cos(now - last))
        last = now
    shoot(page, "5_phone_play")
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    check("phone 375: holding Fire and Turn left together fires and turns", fired >= 3 and turned < -1,
          "up to %d shots in flight, turned %.2f rad" % (fired, turned))
    page.screenshot(path=os.path.join(OUT, "6_phone_full_page.png"), full_page=True)
    ctx.close()
    return {"field": field}


def check_buttons_on_screen(page, label):
    """every touch button sits wholly inside the visible screen: shown is not enough, it has to be reachable (tick 4:
    at 375x812 the left, right and Jump buttons were below the bottom edge while this file only checked display:flex)"""
    off = page.evaluate("""() => [...document.querySelectorAll('.pad button')].map(b => {
        const r = b.getBoundingClientRect();
        return {name: b.dataset.input, inside: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
                box: [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)]};
      }).filter(b => !b.inside)""")
    size = page.evaluate("[innerWidth, innerHeight]")
    check("%s: every touch button is on screen in play" % label, not off,
          "all inside %dx%d" % tuple(size) if not off else "off screen in %dx%d: %s" % (size[0], size[1], off))


def small_phone(browser, base, msgs):
    """a small phone (360x640): the same reachability check, where there is least room"""
    ctx = browser.new_context(viewport={"width": 360, "height": 640}, device_scale_factor=2, is_mobile=True, has_touch=True)
    page = ctx.new_page()
    listen(page, msgs)
    page.goto(base, wait_until="load")
    page.wait_for_function("window.shatterbelt && window.shatterbelt.mode === 'title'", timeout=60000)
    page.wait_for_timeout(800)
    page.tap("#playBtn")
    page.wait_for_function("window.shatterbelt.mode === 'playing'")
    page.wait_for_timeout(400)
    check_buttons_on_screen(page, "phone 360x640")
    shoot(page, "7_small_phone_play")
    ctx.close()


def gpu_name(renderer):
    """'ANGLE (NVIDIA, NVIDIA GeForce RTX 2080 (0x00001E87) Direct3D11 ...)' -> 'an NVIDIA GeForce RTX 2080'; software -> says so"""
    if "swiftshader" in renderer.lower():
        return "software rendering (SwiftShader, no GPU)"
    m = re.match(r"ANGLE \([^,]+, ([^(,]+?)\s*(\(0x[0-9A-Fa-f]+\))?\s*(Direct3D|OpenGL|Vulkan|Metal)", renderer)
    return ("an " + m.group(1).strip()) if m else renderer


def write_block(desk, ph, msgs):
    page_file = os.path.join(HERE, "index.html")
    text = open(page_file, encoding="utf-8").read()
    p = desk["played"]
    errors = [m for m in msgs if m.startswith("[error]") or m.startswith("[pageerror]")]
    block = ('<div class="stat"><div><b>%s s</b><span>of game time played with scripted keys</span></div>'
             '<div><b>%d</b><span>rocks broken, wave %d reached</span></div>'
             '<div><b class="%s">%d</b><span>console errors</span></div>'
             '<div><b class="%s">%s</b><span>the replay ended in the same state as the game</span></div></div>'
             '<p class="cap">Measured by <code>tools/play_check.py</code>: %d of %d checks passed, including no blank pictures and no sideways '
             'scroll at 375 px on an emulated phone (an upright %d x %d field). It drew %d frames a second in headless Chromium on %s.</p>') % (
        "{:.0f}".format(p["time"]), p["broken"], p["wave"], "bad" if errors else "ok", len(errors),
        "ok" if desk["replay"] else "bad", "Yes" if desk["replay"] else "No",
        sum(r["pass"] for r in results), len(results), ph["field"][0], ph["field"][1], round(desk["fps"]), html.escape(gpu_name(desk["gpu"])))
    fc = desk["frame_cost"]
    frame_block = ('<div class="stat"><div><b>%.2f ms</b><span>of this page&rsquo;s own CPU time in a typical frame</span></div>'
                   '<div><b>%.2f ms</b><span>for the slowest 1 frame in 100, of the 16.7 ms a 60 Hz frame has</span></div></div>'
                   '<p class="cap">Measured by <code>tools/play_check.py</code> during the play above: the time each frame spends in the game steps and '
                   'issuing the draw calls (main.js keeps it for the last %d frames). The GPU&rsquo;s own drawing time is not in it. The slowest frame took %.2f ms. '
                   'Headless Chromium on %s, one run.</p>') % (fc["median"], fc["p99"], fc["frames"], fc["max"], html.escape(gpu_name(desk["gpu"])))
    text = re.sub(r"(<!--gen:play-->).*?(<!--/gen:play-->)", lambda m: m.group(1) + block + m.group(2), text, flags=re.S)
    text = re.sub(r"(<!--gen:frame-->).*?(<!--/gen:frame-->)", lambda m: m.group(1) + frame_block + m.group(2), text, flags=re.S)
    open(page_file, "w", encoding="utf-8", newline="").write(text)
    print("written into index.html")


def main():
    server, base = serve()
    msgs = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(args=["--ignore-gpu-blocklist", "--enable-gpu", "--use-angle=d3d11"])
            desk = desktop(browser, base, msgs)
            gamepad(browser, base, msgs)
            ph = phone(browser, base, msgs)
            small_phone(browser, base, msgs)
            browser.close()
    finally:
        server.shutdown()
    errors = [m for m in msgs if m.startswith("[error]") or m.startswith("[pageerror]")]
    check("no console errors or uncaught exceptions", not errors, errors[:10] or "none (%d warnings: %s)" % (len(msgs), msgs[:5]))
    print("frames per second %.0f on %s" % (desk["fps"], desk["gpu"]))
    json.dump({"results": results, "desktop": desk, "phone": ph, "console": msgs}, open(os.path.join(OUT, "play_check.json"), "w"), indent=1, default=str)
    fails = [r for r in results if not r["pass"]]
    print("\n%d checks, %d failed. Pictures in %s" % (len(results), len(fails), OUT))
    if "--write" in sys.argv and not fails:
        write_block(desk, ph, msgs)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
