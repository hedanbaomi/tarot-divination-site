"""Check last-spread restoration using disposable Chrome profiles.

Run: uv run --with playwright python tools/test-spread-selection-browser.py
Add --android to exercise the APK assets, or --base-url URL to verify a deployed site. Only the selected site's assets
are reachable; no existing browser profile is used.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import threading

from playwright.sync_api import sync_playwright


KEY = "quareia-spread-selection-v1"


class Handler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *_):
        pass


class Server(ThreadingHTTPServer):
    # Chrome loads many local assets at once, especially after a profile restart.
    request_queue_size = 128


def check_freeform_controls(page):
    stage = page.locator(".table-stage")
    cards = page.locator("#freeDrawCards .free-table-card")
    page.locator("#layoutModeSelect").select_option("freeform", force=True)
    stage.press("ArrowRight")
    stage.press("End")
    page.wait_for_function("document.querySelector('#deckNextBtn').disabled")
    stage.press("Home")
    page.wait_for_function("document.querySelector('#deckPrevBtn').disabled")
    page.locator("#deckNextBtn").press("Enter")
    assert cards.count() == 0
    stage.press("Enter")
    page.wait_for_function("document.querySelectorAll('.free-table-card').length === 1")
    card = cards.first
    before = card.get_attribute("aria-label")
    assert card.locator("img.card-image").get_attribute("alt") == ""
    handle = card.element_handle()
    card.press("Space")
    assert handle.evaluate("e => e.isConnected && document.activeElement === e")
    label = card.get_attribute("aria-label")
    name = card.locator("img.card-image").get_attribute("alt")
    assert name and name in label and "1" in label and label != before
    page.set_viewport_size({"width": 1440, "height": 740})
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
    assert handle.evaluate("e => e.isConnected && document.activeElement === e")
    stage.press("Enter")
    page.wait_for_function("document.querySelectorAll('.free-table-card').length === 2")
    page.set_viewport_size({"width": 390, "height": 740})
    page.wait_for_function("""() => {
        const box = document.querySelector('#freeDrawCards').getBoundingClientRect();
        return [...document.querySelectorAll('.free-table-card')].every(card => {
            const r = card.getBoundingClientRect();
            return r.left >= box.left - 1 && r.right <= box.right + 1;
        });
    }""")
    page.locator("#revealBtn").dispatch_event("click")
    assert cards.evaluate_all("es => es.every(e => e.classList.contains('revealed'))")
    assert all(cards.nth(i).locator("img.card-image").get_attribute("alt") for i in range(2))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", help="Verify an existing deployment instead of a local server")
    parser.add_argument("--android", action="store_true", help="Use the bundled Android UI and its saved spread library")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.android:
        root /= "android-demo/app/src/main/assets/www"
    server = None
    if args.base_url:
        base = args.base_url.rstrip("/")
    else:
        server = Server(("127.0.0.1", 0), partial(Handler, directory=str(root)))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = "http://127.0.0.1:%d" % server.server_port
    errors = []
    results = []
    try:
        with sync_playwright() as pw:
            for surface in ["index.html?view=modern", "classic.html"]:
                with TemporaryDirectory(prefix="quareia-spread-test-") as profile:
                    def launch():
                        context = pw.chromium.launch_persistent_context(
                            profile, channel="chrome", headless=True,
                            viewport={"width": 1440, "height": 1000}, locale="zh-CN")
                        context.route("**/*", lambda route: route.continue_()
                                      if route.request.url.startswith(base + "/") else route.abort())
                        return context

                    def open_page(context, path=surface):
                        page = context.new_page()
                        page.on("pageerror", lambda error: errors.append(str(error)))
                        page.on("requestfailed", lambda request: print("Failed local request:", request.url, request.failure, flush=True)
                                if request.url.startswith(base + "/") and request.resource_type == "script" else None)
                        page.goto(base + "/" + path)
                        page.wait_for_function("document.querySelector('#spreadTitle').textContent.length > 0")
                        if args.android and page.locator("#telemetryDialog[open]").count():
                            page.locator("#telemetryNoticeClose").click()
                        return page

                    def selection(page):
                        if args.android and page.locator("#telemetryDialog[open]").count():
                            page.locator("#telemetryNoticeClose").click()
                        return page.evaluate("key => JSON.parse(localStorage.getItem(key))", KEY)

                    def expect_selection(page, spread, deck="tarot"):
                        try:
                            page.wait_for_function("([spread, deck]) => "
                                                   "document.querySelector('#spreadSelect').value === spread && "
                                                   "document.querySelector('#deckSelect').value === deck",
                                                   arg=[spread, deck], timeout=5000)
                        except Exception:
                            print(json.dumps({"url": page.url, "expected": [spread, deck],
                                  "actual": page.evaluate("[document.querySelector('#spreadSelect').value, document.querySelector('#deckSelect').value]"),
                                  "saved": selection(page), "pageErrors": errors, "completed": results}), flush=True)
                            raise
                        assert page.locator("#spreadTitle").inner_text().strip()

                    def change(page, selector, value):
                        page.locator(selector).select_option(value, force=True)

                    context = launch()
                    try:
                        page = open_page(context)
                        expect_selection(page, "three-card-horizontal")
                        if args.android:
                            page.evaluate("""() => {
                                window.chromeSignals = [];
                                window.androidThemeChrome = {set: color => window.chromeSignals.push(color)};
                                DivinationTheme.setTheme('grove');
                            }""")
                            classic = surface.startswith("classic")
                            assert page.evaluate("window.chromeSignals.at(-1)") == ("#31483c" if classic else "#0d1511")
                            assert page.locator('meta[name="theme-color"]').get_attribute("content") == "#31483c"
                            page.evaluate("DivinationTheme.setTheme('celestial')")
                            results.append(surface + ": native Grove palette and page theme color")
                            change(page, "#deckSelect", "lxxxi")
                            page.reload()
                            backs = page.locator("#deckSpread .deck-card img")
                            backs.first.wait_for(state="attached")
                            assert backs.first.get_attribute("src") == "lxxxi-back"
                            page.evaluate("""() => {
                                window.__qMediaBase = location.origin + '/fixture-art';
                                window.dispatchEvent(new Event('quareia:mediaready'));
                            }""")
                            assert backs.evaluate_all("""es => es.length === 81 && es.every(e =>
                                e.getAttribute('src') === location.origin + '/fixture-art/lxxxi-back')"""), (surface, backs.count(), backs.first.get_attribute('src'))
                            change(page, "#deckSelect", "tarot")
                            results.append(surface + ": restored LXXXI fan refreshes when the host supplies artwork")
                        change(page, "#spreadSelect", "overview")
                        change(page, "#overviewMethod", "stacked")
                        page.wait_for_function("key => JSON.parse(localStorage.getItem(key)).overviewMethod === 'stacked'", arg=KEY)
                        page.close()
                        page = open_page(context)
                        expect_selection(page, "overview")
                        assert page.locator("#overviewMethod").input_value() == "stacked"
                        assert page.locator("#spreadCount").inner_text() == "0 / 26"
                        results.append(surface + ": tab close/reopen and stacked overview")

                        change(page, "#deckSelect", "mystagogus")
                        native_spread = page.evaluate("mystagogusSpreads[0].id")
                        change(page, "#spreadSelect", native_spread)
                        context.close()
                        context = launch()
                        page = open_page(context)
                        expect_selection(page, native_spread, "mystagogus")
                        results.append(surface + ": browser restart with non-Tarot deck")

                        before = selection(page)
                        page.locator("#deckSpread .deck-card").first.dispatch_event("click", {"detail": 0})
                        change(page, "#spreadSelect", "overview")
                        page.locator("#confirmCancelBtn").click()
                        expect_selection(page, native_spread, "mystagogus")
                        assert selection(page) == before
                        page.reload()
                        expect_selection(page, native_spread, "mystagogus")
                        results.append(surface + ": cancelled switch does not persist")

                        code = page.evaluate("""() => DivinationCustomSpreads.encode({
                            name: 'Persistence fixture', description: 'Last opened custom spread',
                            columns: 2, rows: 1, deckScope: 'tarot-only', tarotMode: 'major-only',
                            positions: [
                              {name:'One', meaning:'First', column:1, row:1},
                              {name:'Two', meaning:'Second', column:2, row:1}
                            ]})""")
                        page.locator("#customSpreadOpenBtn").dispatch_event("click")
                        page.locator("#customSpreadImportTab").click()
                        page.locator("#customSpreadImportCode").fill(code)
                        page.locator("#customSpreadImportUseBtn").click()
                        page.wait_for_function("key => document.querySelector('#spreadTitle').textContent === 'Persistence fixture' "
                                               "&& JSON.parse(localStorage.getItem(key)).spreadId === document.querySelector('#spreadSelect').value",
                                               arg=KEY)
                        if args.android:
                            assert "customSpreadCode" not in selection(page)
                            assert page.evaluate("localStorage.getItem(DivinationCustomSpreads.STORAGE_KEY)")
                        custom_id = selection(page)["spreadId"]
                        expect_selection(page, custom_id)
                        context.close()
                        context = launch()
                        page = open_page(context)
                        expect_selection(page, custom_id)
                        assert page.locator("#spreadTitle").inner_text() == "Persistence fixture"
                        assert page.locator("#deckSpread .deck-card").count() == 22
                        assert page.locator("#positionGuideList li").count() == 2
                        results.append(surface + ": custom spread definition/deck/rules survive browser restart")

                        other = "classic.html" if surface.startswith("index") else "index.html?view=modern"
                        page.close()
                        page = open_page(context, other)
                        expect_selection(page, custom_id)
                        assert page.locator("#deckSpread .deck-card").count() == 22
                        page.close()
                        page = open_page(context)
                        results.append(surface + ": shared selection across page versions")

                        page.locator("#customSpreadOpenBtn").dispatch_event("click")
                        page.locator("#customSpreadLibrary .history-danger-btn").click()
                        page.locator("#confirmProceedBtn").click()
                        expect_selection(page, "three-card-horizontal")
                        assert selection(page).get("customSpreadCode") is None
                        page.reload()
                        expect_selection(page, "three-card-horizontal")
                        results.append(surface + ": deleted custom spread is not resurrected")

                        fixtures = [
                            "{broken", "null", "[]",
                            json.dumps({"deckType": "unknown", "spreadId": "overview"}),
                            json.dumps({"deckType": "tarot", "spreadId": "removed-custom", "customSpreadCode": "invalid"}),
                            json.dumps({"deckType": "tarot", "spreadId": 42}),
                        ]
                        for raw in fixtures:
                            page.evaluate("([key, raw]) => localStorage.setItem(key, raw)", [KEY, raw])
                            page.reload()
                            expect_selection(page, "three-card-horizontal")
                        page.evaluate("([key, spread, code]) => localStorage.setItem(key, JSON.stringify({"
                                      "deckType:'mystagogus', spreadId:spread, customSpreadCode:code}))", [KEY, custom_id, code])
                        page.reload()
                        expect_selection(page, native_spread, "mystagogus")
                        results.append(surface + ": invalid/missing/incompatible saved values fall back safely")

                        change(page, "#spreadSelect", "overview")
                        if surface.startswith("index"):
                            change(page, "#layoutModeSelect", "freeform")
                            page.wait_for_function("localStorage.getItem('quareia-divination-free-board-draft-v1') !== null")
                            page.reload()
                            assert page.locator("#layoutModeSelect").input_value() == "freeform"
                            change(page, "#layoutModeSelect", "preset")
                            expect_selection(page, "overview", "mystagogus")
                            results.append(surface + ": freeform draft retains its return spread")

                        page.add_init_script("""(() => {
                          for (const method of ['getItem', 'setItem']) {
                            const original = Storage.prototype[method];
                            Storage.prototype[method] = function(key, ...args) {
                              if (key === 'quareia-spread-selection-v1') throw new Error('storage disabled');
                              return original.call(this, key, ...args);
                            };
                          }
                        })();""")
                        page.reload()
                        expect_selection(page, "three-card-horizontal")
                        change(page, "#spreadSelect", "overview")
                        expect_selection(page, "overview")
                        assert page.locator("#deckSpread .deck-card").count() == 78
                        results.append(surface + ": unavailable storage leaves drawing functional")
                        if surface.startswith("index"):
                            check_freeform_controls(page)
                            results.append(surface + ": keyboard fan, in-place reveal, accessible names and resize")

                    finally:
                        context.close()
        assert not errors, errors
        print(json.dumps({"passed": len(results), "results": results, "pageErrors": errors}, indent=2))
    finally:
        if server:
            server.shutdown()
            server.server_close()


if __name__ == "__main__":
    main()
