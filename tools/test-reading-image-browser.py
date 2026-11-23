"""Exercise reading PNG export using isolated Chrome and only local assets.

Run: uv run --with playwright python tools/test-reading-image-browser.py [--android]
The Android bridge is a deterministic test double; no existing profile is used.
"""
import argparse
import base64
import hashlib
import struct
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from playwright.sync_api import expect, sync_playwright

MARKER = "PRIVATE-IMAGE-Q37"
QUESTION = MARKER + " " + "我该如何理解当前的方向与选择？" * 18
EDITED = MARKER + " edited historical question " + "未来与选择" * 20


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class Server(ThreadingHTTPServer):
    request_queue_size = 128


def fits(page, selector):
    assert page.locator(selector).evaluate(
        "e => e.getBoundingClientRect().right <= innerWidth + 1 && e.scrollWidth <= e.clientWidth + 1"
    ), selector


def png_info(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    assert data[12:16] == b"IHDR"
    width, height = struct.unpack(">II", data[16:24])
    assert 300 <= width <= 8192 and 300 <= height <= 16384, (width, height)
    assert len(data) > 5000, len(data)
    return width, height


def preview(page):
    image = page.locator("#readingImagePreview")
    expect(image).to_be_visible()
    page.wait_for_function("""() => {
        const i = document.querySelector('#readingImagePreview');
        return i && i.complete && i.naturalWidth && i.naturalHeight;
    }""", timeout=30000)
    result = image.evaluate("""async img => {
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const ctx = c.getContext('2d', {willReadFrequently:true});
        ctx.drawImage(img, 0, 0);
        const pixels = ctx.getImageData(0, 0, c.width, c.height).data;
        let colors = new Set(), opaque = 0;
        for (let y = 0; y < c.height; y += Math.max(1, Math.floor(c.height / 80))) {
          for (let x = 0; x < c.width; x += Math.max(1, Math.floor(c.width / 80))) {
            const i = (y * c.width + x) * 4;
            colors.add([pixels[i],pixels[i+1],pixels[i+2]].join(','));
            if (pixels[i+3]) opaque++;
          }
        }
        const blob = await (await fetch(img.src)).blob();
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = ''; for (const b of bytes) s += String.fromCharCode(b);
        return {width:c.width, height:c.height, colors:colors.size, opaque, data:btoa(s)};
    }""")
    data = base64.b64decode(result["data"])
    assert png_info(data) == (result["width"], result["height"])
    assert result["colors"] > 20 and result["opaque"] > 100, result
    return data


def open_image(page, selector):
    page.evaluate("window.renderedText = []; window.renderedImages = 0; window.realmEdges = []; window.artTransforms = []")
    page.locator(selector).click()
    expect(page.locator("#readingImageDialog")).to_be_visible()
    fits(page, "#readingImageDialog")
    return preview(page)


def save_image(page, android, outcome="success"):
    if android:
        page.evaluate("outcome => { window.testPng = null; window.pngCallbackDone = false; window.pngOutcome = outcome; }", outcome)
        page.locator("#readingImageSave").click()
        page.wait_for_function("window.testPng !== null", timeout=10000)
        page.wait_for_function("window.pngCallbackDone === true", timeout=10000)
        name, payload = page.evaluate("window.testPng")
        data = base64.b64decode(payload.split(",", 1)[-1])
    else:
        with page.expect_download(timeout=30000) as event:
            page.locator("#readingImageSave").click()
        name = event.value.suggested_filename
        data = Path(event.value.path()).read_bytes()
    png_info(data)
    assert name.isascii() and name.lower().endswith(".png") and MARKER not in name, name
    return data


def open_history(page, android):
    if android and page.locator("#menuToggle").is_visible():
        page.locator("#menuToggle").click()
    page.locator("#historyOpenBtn").click()
    page.locator(".history-record-open").first.click()
    expect(page.locator("#historyDetail")).to_be_visible()


def set_question(page, value):
    page.locator("#readingQuestionToggle").click()
    page.locator("#readingQuestion").fill(value)
    page.locator("#readingQuestionToggle").click()


def draw(page, classic, free, deck, question):
    if deck == "lxxxi":
        # Stable order includes one solid realm and two split realms.
        page.evaluate("""() => {
          const first = [5, 6, 22];
          lxxxiDeckFull.sort((a,b) => (first.includes(a.number) ? first.indexOf(a.number) : a.number+3)
                                  - (first.includes(b.number) ? first.indexOf(b.number) : b.number+3));
          Math.random = () => 0.99999;
        }""")
    page.locator("#deckSelect").select_option(deck, force=True)
    if deck == "tarot":
        page.locator("#modeSelect").select_option("mixed", force=True)
        page.evaluate("value => { Math.random = () => value; }", 0.99999 if classic and free else 0)
    if free:
        page.locator("#layoutModeSelect").select_option("freeform", force=True)
    set_question(page, question)
    card_selector = "#freeBoardPile .free-board-pile-card" if classic and free else "#deckSpread .deck-card"
    for _ in range(3):
        page.locator(card_selector).first.press("Enter")
    page.locator("#freeBoardRevealAllBtn" if classic and free else "#revealBtn").click()
    if deck == "lxxxi" and free and not classic:
        assert page.locator(".free-table-card").evaluate_all(
            "es => es.map(e => e.getAttribute('data-lxxxi-border'))"
        ) == ["underworld", "inner-underworld", "inner-physical"]
    if free:
        expect(page.locator("#freeBoardSaveStatus" if classic else "#historySaveStatus")).to_contain_text("保存到", timeout=15000)
    else:
        expect(page.locator("#historySaveStatus")).to_contain_text("已自动保存", timeout=15000)


def scenario(browser, base, android, classic, free, deck, width, remote_art=False, output=None):
    host_origin = "https://appassets.androidplatform.net" if android and remote_art else base
    context = browser.new_context(viewport={"width": width, "height": 860}, locale="zh-CN", accept_downloads=True)
    page = context.new_page()
    errors, leaks = [], []
    page.on("pageerror", lambda e: errors.append(str(e)))

    def route_local(route):
        request = route.request
        if MARKER in unquote(request.url + (request.post_data or "")):
            leaks.append(request.method)
        if remote_art and (request.url.startswith("https://assets.luotianyi.fun/tarot-divination-site/lxxxi/v1/cards/") or
                           request.url.startswith("https://appassets.androidplatform.net/_m/fixture/")):
            # A real decoded image under the trusted cross-origin URL, served by
            # the isolated test route with CORS headers; no live cloud calls.
            route.fulfill(path=str(Path(__file__).resolve().parents[1] / "assets/cards/major-00.jpeg"),
                          content_type="image/jpeg", headers={"Access-Control-Allow-Origin": "*"})
        elif android and remote_art and request.url.startswith(host_origin + "/"):
            response = route.fetch(url=base + request.url[len(host_origin):])
            route.fulfill(response=response)
        elif request.url.startswith(base + "/"):
            route.continue_()
        else:
            route.abort()

    context.route("**/*", route_local)
    page.add_init_script("""(() => {
      const text = CanvasRenderingContext2D.prototype.fillText;
      const image = CanvasRenderingContext2D.prototype.drawImage;
      const fill = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function(x, y, w, h) {
        const solid = this.fillStyle === getComputedStyle(document.documentElement).getPropertyValue('--lxxxi-underworld').trim();
        if (window.realmEdges && x < 0 && y < 0 && w === -2*x && h === -2*y &&
            (solid || this.fillStyle instanceof CanvasGradient)) {
          const m = this.getTransform();
          const point = (px,py) => {const p = new DOMPoint(px,py).matrixTransform(m); return [Math.round(p.x),Math.round(p.y)]};
          window.realmEdges.push([point(x+w*.015,0),point(-x-w*.015,0),point(0,y+h*.01),point(0,-y-h*.01)]);
        }
        return fill.apply(this, arguments);
      };
      CanvasRenderingContext2D.prototype.fillText = function(...args) {
        if (window.renderedText) window.renderedText.push(String(args[0]));
        return text.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.drawImage = function(...args) {
        if (window.renderedImages !== undefined) window.renderedImages++;
        if (window.artTransforms && args[0] instanceof ImageBitmap) {
          const m = this.getTransform();
          window.artTransforms.push([m.a,m.d]);
        }
        return image.apply(this, args);
      };
    })();""")
    if android:
        if remote_art:
            page.add_init_script("window.__qMediaBase = 'https://appassets.androidplatform.net/_m/fixture';")
        page.add_init_script("""window.androidHistoryExport = {
          savePng(content, name) {
            window.testPng = [name, content];
            const o = window.pngOutcome || 'success';
            setTimeout(() => {
              window.__quareiaHistoryExportResult(o === 'success'
                ? {ok:true, fileName:name} : o === 'cancel' ? {ok:false, cancelled:true} : {ok:false, cancelled:false});
              window.pngCallbackDone = true;
            }, 0);
            return true;
          }
        };""")
    try:
        page.goto(host_origin + ("/classic.html" if classic else "/index.html?view=modern"))
        if android and page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()
        page.evaluate("DivinationTheme.setTheme('grove')")
        question = "如何以更清晰的心看待眼前的选择？" if not android and not classic and not free else QUESTION
        draw(page, classic, free, deck, question)
        button = "#freeBoardImageBtn" if classic and free else "#readingImageBtn"
        current = open_image(page, button)
        text = "".join(page.evaluate("window.renderedText"))
        assert question in text, "question was truncated"
        assert "github.com/hedanbaomi/tarot-divination-site" in text and "quareia.com" in text, text
        assert ("非官方" in text or "Unofficial" in text), text
        if deck == "tarot":
            # Three actual local card images plus preview's own drawImage.
            assert page.evaluate("window.renderedImages") >= 4
            assert page.evaluate("window.artTransforms.some(([a,d]) => a < 0 && d < 0)"), "reversed artwork was not rotated"
        if deck == "lxxxi":
            assert (page.evaluate("window.renderedImages") >= 4) == remote_art
            page.locator("#readingImagePreview").evaluate("""img => {
              const canvas=document.createElement('canvas');
              canvas.width=img.naturalWidth; canvas.height=img.naturalHeight;
              const ctx=canvas.getContext('2d',{willReadFrequently:true});
              ctx.drawImage(img,0,0);
              const pixel=([x,y]) => '#' + [...ctx.getImageData(x,y,1,1).data].slice(0,3)
                .map(v=>v.toString(16).padStart(2,'0')).join('');
              const css=getComputedStyle(document.documentElement);
              const color=realm=>css.getPropertyValue('--lxxxi-'+realm).trim().toLowerCase();
              const edges=window.realmEdges.map(points=>points.map(pixel));
              // Gradient dithering can shift an individual output channel by one level.
              const matches=(actual,realm)=>[1,3,5].every(i=>
                Math.abs(parseInt(actual.slice(i,i+2),16)-parseInt(color(realm).slice(i,i+2),16))<=2);
              if (edges.length !== 3 || !edges[0].every(c=>matches(c,'underworld')) ||
                  !matches(edges[1][0],'inner') || !matches(edges[1][1],'underworld') ||
                  !matches(edges[2][2],'inner') || !matches(edges[2][3],'physical')) {
                throw Error('Exported PNG has incorrect realm edge pixels: '+JSON.stringify(edges));
              }
            }""")
        downloaded = save_image(page, android)
        assert downloaded == current, "saved PNG differs from preview"
        previous_src = page.locator("#readingImagePreview").get_attribute("src")
        page.locator('#readingImageAppearance input[value="parchment"]').check()
        page.wait_for_function("src => { const e = document.querySelector('#readingImagePreview'); return !e.hidden && e.src !== src && e.complete && e.naturalWidth; }", arg=previous_src, timeout=30000)
        paper = preview(page)
        assert hashlib.sha256(current).digest() != hashlib.sha256(paper).digest(), "appearance did not affect PNG"
        if output and not android and not classic and not free and deck == "tarot" and width == 360:
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(paper)
        if android:
            for outcome in ("cancel", "error"):
                save_image(page, True, outcome)
                expect(page.locator("#readingImageDialog")).to_be_visible()
                expect(page.locator("#readingImageStatus")).not_to_be_empty()
        page.locator("#readingImageClose").click()
        open_history(page, android)
        before_edit = open_image(page, "#historyImageBtn")
        page.locator("#readingImageClose").click()
        expect(page.locator("#historyDetail")).to_be_visible()
        page.locator("#historyEditQuestionBtn").click()
        page.locator("#historyQuestionInput").fill(EDITED)
        page.locator("#historySaveQuestionBtn").click()
        expect(page.locator("#historyQuestionText")).to_have_text(EDITED)
        historic = open_image(page, "#historyImageBtn")
        assert EDITED in "".join(page.evaluate("window.renderedText")), "historical question was truncated"
        assert hashlib.sha256(historic).digest() != hashlib.sha256(before_edit).digest(), "edited historical question missing from PNG"
        save_image(page, android)
        if android:
            assert page.evaluate("DivinationUiBack.handleBack()") is True
        else:
            page.locator("#readingImageClose").click()
        expect(page.locator("#readingImageDialog")).to_be_hidden()
        expect(page.locator("#historyDetail")).to_be_visible()
        assert not errors and not leaks, (errors, leaks)
        print(f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} {'free' if free else 'preset'} {deck} {width}px {'CORS fixture' if remote_art else 'offline'} passed", flush=True)
    finally:
        if errors:
            print("Page errors:", errors, flush=True)
        context.close()


def history_layout_checks(browser, base, android):
    context = browser.new_context(viewport={"width": 1280, "height": 900}, locale="en")
    context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.add_init_script("""(() => {
      window.painted = []; window.rotations = [];
      const text = CanvasRenderingContext2D.prototype.fillText;
      const rotate = CanvasRenderingContext2D.prototype.rotate;
      CanvasRenderingContext2D.prototype.fillText = function(...args) {
        window.painted.push(String(args[0])); return text.apply(this, args);
      };
      CanvasRenderingContext2D.prototype.rotate = function(angle) {
        window.rotations.push(angle); return rotate.call(this, angle);
      };
    })();""")
    try:
        page.goto(base + "/index.html?view=modern")
        if android and page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()
        page.evaluate("DivinationI18n.setLocale('en')")
        expected = page.evaluate("""async () => {
          const spread = getTarotSpread('overview');
          const major = tarotDeckFull.filter(c => c.arcana === 'major');
          const minor = tarotDeckFull.filter(c => c.arcana === 'minor');
          const entries = [];
          for (let i = 0; i < 13; i++) {
            entries.push({slotIndex:i, card:major[i], orientation:'upright', layer:'major'});
            entries.push({slotIndex:i, card:minor[i], orientation:'upright', layer:'minor'});
          }
          const record = DivinationHistoryRecords.buildReadingRecord({
            id:'image-overview-fixture', createdAt:'2020-01-01T00:00:00.000Z', deckType:'tarot', deckMode:'tarot',
            deckName:'RWS Tarot', spreadId:spread.id, spreadName:spread.name,
            orientationMode:'mixed', filterMode:'mixed', overviewMethod:'stacked', positions:spread.positions, entries
          });
          await DivinationHistoryStore.createStore().saveRecord(record);
          return entries.map(e => [spread.positions[e.slotIndex].nameEn, DivinationI18n.field(e.card, 'name')]);
        }""")
        open_history(page, android)
        page.evaluate("window.painted = []; window.rotations = []")
        open_image(page, "#historyImageBtn")
        lines = page.evaluate("window.painted")
        cursor = -1
        for position, name in expected:
            cursor = next((i for i in range(cursor + 1, len(lines)) if position in lines[i] and name in lines[i]), -1)
            assert cursor >= 0, (position, name, lines)
        page.locator("#readingImageClose").click()
        page.locator("#historyCloseBtn").click()

        page.evaluate("""async () => {
          const cards = tarotDeckFull.slice(0, 2).map((card, i) => ({
            cardId:card.id, cardNumber:card.number, cardName:card.name, arcana:card.arcana,
            suit:card.suit || '', orientation:'upright', revealed:true,
            x:i * 220, y:i * 80, boardRotation:0, z:i + 1, drawOrder:i + 1
          }));
          const record = DivinationHistoryRecords.buildFreeformRecord({
            id:'image-v3-fixture', createdAt:'2021-01-01T00:00:00.000Z',
            deckType:'tarot', deckMode:'tarot', deckName:'RWS Tarot', orientationMode:'mixed',
            filterMode:'mixed', overviewMethod:'not-applicable', cards
          });
          if (record.schemaVersion !== 3) throw new Error('expected v3 history');
          await DivinationHistoryStore.createStore().saveRecord(record);
        }""")
        open_history(page, android)
        page.evaluate("window.painted = []; window.rotations = []")
        open_image(page, "#historyImageBtn")
        assert "The Fool" in " ".join(page.evaluate("window.painted"))
        page.locator("#readingImageClose").click()
        page.locator("#historyCloseBtn").click()

        code = page.evaluate("""() => DivinationCustomSpreads.encode({
          name:'Crossed fixture', description:'Crossed custom history', columns:1, rows:1,
          deckScope:'tarot-only', tarotMode:'mixed', positions:[
            {name:'Foundation', meaning:'First', column:1, row:1},
            {name:'Crossing', meaning:'Second', column:1, row:1, stackOn:1, rotation:90}
          ]})""")
        page.locator("#customSpreadOpenBtn").dispatch_event("click")
        page.locator("#customSpreadImportTab").click()
        page.locator("#customSpreadImportCode").fill(code)
        page.locator("#customSpreadImportUseBtn").click()
        expect(page.locator("#spreadTitle")).to_have_text("Crossed fixture")
        for _ in range(2):
            page.locator("#deckSpread .deck-card").first.press("Enter")
        page.locator("#revealBtn").click()
        expect(page.locator("#historySaveStatus")).to_contain_text("saved automatically", timeout=15000)
        open_history(page, android)
        page.evaluate("window.painted = []; window.rotations = []")
        open_image(page, "#historyImageBtn")
        text = " ".join(page.evaluate("window.painted"))
        assert "Crossed fixture" in text and "Foundation" in text and "Crossing" in text
        assert page.evaluate("window.rotations.some(x => Math.abs(x - Math.PI / 2) < 0.00001)"), "custom crossing rotation missing"
        assert not errors, errors
        print(f"{'Android' if android else 'Web'} history 26-card stacked overview, v3 freeform and custom crossing passed", flush=True)
    finally:
        context.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--android", action="store_true")
    parser.add_argument("--output", type=Path, help="Optional path for the Tarot sample PNG")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.android:
        root /= "android-demo/app/src/main/assets/www"
    with Server(("127.0.0.1", 0), partial(QuietHandler, directory=str(root))) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw, pw.chromium.launch(channel="chrome") as browser:
                for classic, free, deck, width in [(False, False, "tarot", 360), (True, False, "mystagogus", 430),
                                                   (False, True, "lxxxi", 1440), (True, True, "tarot", 1280)]:
                    scenario(browser, f"http://127.0.0.1:{server.server_port}", args.android, classic, free, deck, width, output=args.output)
                scenario(browser, f"http://127.0.0.1:{server.server_port}", args.android, False, True, "lxxxi", 1440, remote_art=True)
                history_layout_checks(browser, f"http://127.0.0.1:{server.server_port}", args.android)
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
