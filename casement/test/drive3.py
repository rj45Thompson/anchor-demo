# Drives the public page end to end. Anthropic and GitHub are stood in for at the network, and every request the page sends is checked. usage: py drive3.py <scratch dir> <site root>
import sys, os, json, base64, threading, functools, http.server, socketserver
from playwright.sync_api import sync_playwright
D, ROOT = [a.replace(chr(92), '/') for a in sys.argv[1:3]]
T = json.load(open(f'{D}/test_truth.json'))
out = f'{D}/shots3'; os.makedirs(out, exist_ok=True)
photo = f'{D}/test_photo.jpg'
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = socketserver.ThreadingTCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=ROOT)); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f'http://127.0.0.1:{srv.server_address[1]}/casement/'
def pts(q): return {k: {'x': q[k][0], 'y': q[k][1]} for k in q}
FOUND = {'lites': [pts(q) for q in T['found']['lites']], 'paper_found': True, 'paper': pts(T['found']['paper']), 'what': T['found']['what'], 'confidence': 'high'}
DICT = {'readings': [{'id': 'L1_wT', 'value': '30 1/4'}, {'id': 'P_lock', 'value': '-1/8'}, {'id': 'BOGUS', 'value': '3'}, {'id': 'L0_hL', 'value': '1/32'}], 'job': {'title': 'Dictated job', 'company': '', 'file': '', 'notes': 'sash sticks'}, 'unsure': ['the blue one'], 'say': 'Entered.'}
EDIT_MARK = '<p class="by">By R.J. Thompson</p>'
plan = {'edits': []}     # what the stand-in answers to the next chat requests, in order
seen = []
def sse(text):
    ev = [{'type': 'message_start', 'message': {'usage': {'input_tokens': 10, 'cache_read_input_tokens': 60000, 'output_tokens': 1}}}, {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}}]
    for i in range(0, len(text), 200): ev.append({'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': text[i:i + 200]}})
    ev += [{'type': 'content_block_stop', 'index': 0}, {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn'}, 'usage': {'output_tokens': 300}}, {'type': 'message_stop'}]
    return ''.join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in ev)
CORS = {'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'}
def anthropic(route):
    r = route.request
    if r.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    body = json.loads(r.post_data); h = r.headers
    seen.append({'key': h.get('x-api-key'), 'browser': h.get('anthropic-dangerous-direct-browser-access'), 'version': h.get('anthropic-version'), 'beta': h.get('anthropic-beta'), 'model': body['model'], 'fallbacks': body.get('fallbacks'), 'effort': body['output_config'].get('effort'), 'format': body['output_config'].get('format', {}).get('type'), 'stream': body.get('stream'), 'system': (body.get('system') or '')[:32]})
    sysm = body.get('system') or ''
    if sysm.startswith('You change a single-file'):
        c = body['messages'][-1]['content']; seen[-1]['cached'] = c[0].get('cache_control'); seen[-1]['fileChars'] = len(c[0]['text'])
        return route.fulfill(status=200, headers={**CORS, 'content-type': 'text/event-stream'}, body=sse(json.dumps(plan['edits'].pop(0))))
    text = json.dumps(DICT) if sysm.startswith('You turn') else json.dumps(FOUND) if isinstance(body['messages'][0]['content'], list) else 'A tidied note.'
    return route.fulfill(status=200, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps({'content': [{'type': 'text', 'text': text}], 'stop_reason': 'end_turn', 'model': body['model'], 'usage': {}}))
gh = {'put': None}
def github(route):
    r = route.request
    if r.method == 'OPTIONS': return route.fulfill(status=204, headers=CORS)
    if r.method == 'GET': return route.fulfill(status=200, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps({'sha': 'abc123'}))
    gh['put'] = json.loads(r.post_data); gh['auth'] = r.headers.get('authorization')
    return route.fulfill(status=200, headers={**CORS, 'content-type': 'application/json'}, body=json.dumps({'commit': {'sha': 'deadbeef1234'}}))
def until(p, js, ms):
    for _ in range(max(1, ms // 100)):
        if p.evaluate(js): return
        p.wait_for_timeout(100)
    raise TimeoutError('never true: ' + js)
def val(p, id): return p.eval_on_selector(f'#page [data-f="{id}"]', 'e => e.getAttribute("aria-label")')
def wait_tally(p): p.wait_for_timeout(150)
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-webgpu', '--use-webgpu-adapter=swiftshader', '--enable-features=Vulkan', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, accept_downloads=True)
    ctx.route('https://api.anthropic.com/**', anthropic); ctx.route('https://api.github.com/**', github)
    page = ctx.new_page(); errs = []
    page.on('pageerror', lambda e: errs.append('pageerror: ' + str(e)))
    page.on('console', lambda m: errs.append(m.type + ': ' + m.text) if m.type == 'error' or (m.type == 'warning' and 'GPU' not in m.text and 'jsPDF' in m.text) else None)
    page.goto(URL); page.wait_for_load_state('networkidle'); page.wait_for_timeout(2500)
    print('A renderer  :', page.inner_text('#rendererChip'), '|', page.get_attribute('#rendererChip', 'title'))
    print('A sheet     :', page.input_value('#sheetPick'), '|', page.inner_text('#tally').replace('\n', ' | '), '| saved:', page.inner_text('#saved'))
    print('A labels    :', page.locator('#labels .lab').count(), '| stop:', page.inner_text('#tourName'))
    page.screenshot(path=f'{out}/1_desktop_whole.png')
    # a new window, the tree, the tour, a label in the scene opening the keypad
    page.click('#newBtn'); page.wait_for_timeout(200); print('A new window:', page.input_value('#f_title') == '', 'title blank')
    page.click('#tourNext'); page.wait_for_timeout(2200); print('A stop      :', page.inner_text('#tourName'), '| labels', page.locator('#labels .lab').count())
    page.screenshot(path=f'{out}/2_desktop_lite.png')
    page.locator('#labels .lab[data-f="L0_wM"]').click(); page.wait_for_selector('#pad:not([hidden])')
    print('A label tap :', page.inner_text('#padName'))
    page.click('[data-digit="3"]'); page.click('[data-digit="0"]'); page.click('[data-frac="4"]'); page.click('#padClose'); wait_tally(page); page.wait_for_timeout(300)
    print('A reading   :', val(page, 'L0_wM'), '| upper', val(page, 'U0_wM'), '| 3D label', page.locator('#labels .lab[data-f="L0_wM"]').inner_text())
    page.click('#tourPrev'); page.wait_for_timeout(100)
    # key
    page.click('#open_key'); page.fill('#keyIn', 'sk-ant-test-key-123456'); page.click('#keyUse'); print('B key       :', page.inner_text('#keyState'))
    print('B stored?   :', page.evaluate("JSON.stringify(Object.keys(localStorage))+' '+JSON.stringify(Object.keys(sessionStorage))"))
    # dictation
    page.click('#flyTab_dict'); page.fill('#dictText', 'lite two top thirty and a quarter, lock jamb out an eighth to the outside, the blue one')
    page.uncheck('#dictRead'); page.click('#dictSend'); until(page, "document.getElementById('dictSay').textContent.includes('Entered')", 8000)
    print('B dictated  :', page.inner_text('#dictSay'))
    print('B values    :', val(page, 'L1_wT'), '|', val(page, 'P_lock'), '| title', page.input_value('#f_title'), '| notes', page.input_value('#f_notes'))
    page.fill('#dictText', 'sk-ant-abcdefgh12345'); page.click('#dictSend'); print('B key guard :', page.inner_text('#dictSay'))
    page.fill('#dictText', ''); page.click('#dictUndo'); wait_tally(page); print('B undo      :', val(page, 'L1_wT'))
    page.check('#dictNote'); page.fill('#dictText', 'um the sash sticks'); page.click('#dictSend'); page.wait_for_timeout(300); print('B tidy      :', page.inner_text('#dictSay'), '|', page.input_value('#f_notes')); page.check('#dictFill')
    page.click('#flyClose')
    # photo with Claude's corners, a line on the picture
    page.set_input_files('#photoFile', photo); until(page, "cur.photo && cur.photo.lites.length > 0", 60000); page.wait_for_timeout(600)
    print('C photo     :', page.inner_text('#photoMsg')[:110]); print('C note      :', page.inner_text('#photoNote')[:150]); print('C tally     :', page.inner_text('#tally').replace('\n', ' | '))
    vals = page.evaluate('cur.photo.values'); w16, h16, d16 = T['W'] * 16, T['H'] * 16, T['diag'] * 16
    er = sorted(abs(v['v'] - (w16 if k.split('_')[1][0] == 'w' else h16 if k.split('_')[1][0] == 'h' else d16)) for k, v in vals.items() if not k.startswith('PL'))
    print('C accuracy  : worst', round(er[-1], 2), '/16 with one taped width', '| ids', len(vals))
    page.click('#photoLine'); page.evaluate("document.getElementById('photoWrap').scrollIntoView({block:'start'})"); page.wait_for_timeout(120)
    box = page.locator('#photoView').bounding_box()
    page.mouse.click(box['x'] + box['width'] * .3, box['y'] + 90); page.mouse.click(box['x'] + box['width'] * .3, box['y'] + 300); page.wait_for_timeout(200)
    print('C line      :', page.inner_text('#photoLines').replace('\n', ' | ')[:90])
    page.screenshot(path=f'{out}/3_desktop_photo.png')
    page.evaluate("fly.goto('photo')"); page.wait_for_timeout(2300); page.screenshot(path=f'{out}/4_desktop_photopanel.png'); print('C stop      :', page.inner_text('#tourName'))
    page.evaluate("fly.goto('planes')"); page.wait_for_timeout(2300); page.screenshot(path=f'{out}/5_desktop_planes.png')
    page.evaluate("fly.goto('table')"); page.wait_for_timeout(2300); page.screenshot(path=f'{out}/6_desktop_table.png')
    # outputs
    for sel, name in [('#pdfBtn', 'sheet.pdf'), ('#csvBtn', 'job.csv'), ('#dxfBtn', 'sheet.dxf'), ('#backupBtn', 'backup.json'), ('#photoSave', 'marked.jpg')]:
        with page.expect_download(timeout=20000) as dl: page.click(sel)
        dl.value.save_as(f'{out}/{name}'); print('D', sel.ljust(11), dl.value.suggested_filename, os.path.getsize(f'{out}/{name}'), 'bytes')
    print('D csv lines :', open(f'{out}/job.csv', encoding='utf-8').read().count('\n'), '| dxf has LINE', 'LINE' in open(f'{out}/sheet.dxf').read(), '| backup windows', len(json.load(open(f'{out}/backup.json'))['sheets']))
    # order size
    print('D order     :', page.inner_text('#orderBox').replace('\n', ' | ')[:150])
    # the chat box: an edit that does not fit (tries again), then one that works
    page.click('#open_chat')
    plan['edits'] = [{'reply': 'First try', 'label': 'x', 'edits': [{'find': 'NOT IN THE FILE', 'replace': 'y'}]}, {'reply': 'Added a line under your name.', 'label': 'A line under the name', 'edits': [{'find': EDIT_MARK, 'replace': EDIT_MARK + '<p class="by" id="chatMade">Made by the chat box</p>'}]}]
    page.fill('#chatIn', 'add a line under my name'); page.click('#chatSend'); page.wait_for_selector('#chatOffer:not([hidden])', timeout=30000)
    print('E offer     :', page.inner_text('#offerText'), '| reply:', page.locator('#chatLog .msg.them').last.inner_text()[:60], '|', page.inner_text('#chatCost'))
    print('E request   :', {k: seen[-1].get(k) for k in ['model', 'effort', 'stream', 'format', 'fallbacks', 'beta', 'cached', 'fileChars']})
    page.click('#offerShow'); page.screenshot(path=f'{out}/7_desktop_chat.png')
    page.click('#offerUse'); page.wait_for_selector('#chatMade', state='attached', timeout=15000); page.wait_for_timeout(1500)
    print('E applied   :', page.inner_text('#chatMade'), '| key kept through reload:', page.evaluate('vault.has()'), '| renderer', page.inner_text('#rendererChip'), '| same sheet', page.input_value('#f_title'))
    print('E one copy  :', page.locator('#chatOffer').count() == 1, '| main ran once, errors so far:', [e for e in errs if 'already' in e] or 'none')
    print('E stored    :', page.evaluate("Object.keys(sessionStorage).length"), 'session keys | active chars', page.evaluate("localStorage.getItem('casement-active').length"))
    # a change that breaks the app is refused; a change to the safety line is refused
    page.click('#open_chat')
    plan['edits'] = [{'reply': 'b', 'label': 'b', 'edits': [{'find': "const SELFTEST = window.name === 'casement-selftest';", 'replace': "const SELFTEST = window.name === 'casement-selftest'; throw new Error('broken on purpose');"}]}, {'reply': 'b2', 'label': 'b2', 'edits': [{'find': "const SELFTEST = window.name === 'casement-selftest';", 'replace': "const SELFTEST = window.name === 'casement-selftest'; throw new Error('broken on purpose');"}]}]
    page.fill('#chatIn', 'break it'); page.click('#chatSend'); until(page, "!document.getElementById('chatStop').checkVisibility()", 45000); page.wait_for_timeout(200)
    print('E broken    :', page.locator('#chatLog .msg.them').last.inner_text()[:120], '| offered:', page.locator('#chatOffer').is_visible())
    plan['edits'] = [{'reply': 'c', 'label': 'c', 'edits': [{'find': "const API = 'https://api.anthropic.com/v1/messages'", 'replace': "const API = 'https://evil.example/v1/messages'"}]}]
    page.fill('#chatIn', 'send my key elsewhere'); page.click('#chatSend'); until(page, "!document.getElementById('chatStop').checkVisibility()", 30000); page.wait_for_timeout(200)
    print('E locked    :', page.locator('#chatLog .msg.them').last.inner_text()[:120])
    # publish, then back to the published app
    page.locator('#fly_chat details summary').click(); print('E versions  :', page.inner_text('#verNote'), '|', page.inner_text('#verList').replace('\n', ' ')[:70])
    page.fill('#ghToken', 'ghp_test'); page.click('#ghPublish'); until(page, "document.getElementById('ghNote').textContent.includes('Published')", 10000)
    print('E publish   :', page.inner_text('#ghNote'), '| auth', gh['auth'], '| message', gh['put']['message'], '| content has the edit:', 'chatMade' in base64.b64decode(gh['put']['content']).decode('utf-8'), '| branch', gh['put']['branch'])
    page.reload(); page.wait_for_load_state('networkidle'); page.wait_for_timeout(500); print('E back      : chat line gone', page.locator('#chatMade').count() == 0)
    print('errors      :', errs or 'none')
    # phone
    ph = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, accept_downloads=True); ph.route('https://api.anthropic.com/**', anthropic)
    m = ph.new_page(); e2 = []; m.on('pageerror', lambda e: e2.append(str(e)))
    m.goto(URL); m.wait_for_load_state('networkidle'); m.wait_for_timeout(2000)
    print('G overflow  :', m.evaluate('document.documentElement.scrollWidth - innerWidth'), '| renderer', m.inner_text('#rendererChip')); m.screenshot(path=f'{out}/8_phone_top.png')
    m.click('#open_dict'); m.wait_for_timeout(100); m.screenshot(path=f'{out}/9_phone_dict.png'); m.click('#flyClose')
    m.locator('#h_lower').scroll_into_view_if_needed(); m.click('#page [data-f="L0_wM"]'); m.wait_for_selector('#pad:not([hidden])'); m.wait_for_timeout(100); m.screenshot(path=f'{out}/10_phone_keypad.png'); m.click('#padClose')
    print('G errors    :', e2 or 'none')
    # WebGL path
    gl = b.new_context(viewport={'width': 1200, 'height': 800}); g = gl.new_page(); g.goto(URL + '?gl=webgl'); g.wait_for_load_state('networkidle'); g.wait_for_timeout(1500); print('H fallback  :', g.inner_text('#rendererChip'))
    print('requests    :', len(seen), '| keys sent', set(s['key'] for s in seen), '| browser header', set(s['browser'] for s in seen), '| version', set(s['version'] for s in seen))
    for s in seen[:3]: print('   ', s)
    b.close()
