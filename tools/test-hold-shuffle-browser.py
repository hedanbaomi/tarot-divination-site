"""Run the hold gesture against all four layouts using local assets and a fresh Chrome profile."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def scenario(browser, base, android, classic, free):
    mobile = free
    width = (360 if classic else 430) if mobile else 1200
    with browser.new_context(viewport={"width": width, "height": 820}, has_touch=mobile,
                             reduced_motion="reduce" if mobile else "no-preference") as context:
        page = context.new_page()
        page.set_default_timeout(8000)
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("**/*", lambda r: r.continue_() if r.request.url.startswith(base) else r.abort())
        event = "quareia:board-shuffle" if classic and free else "quareia:shuffled"
        page.add_init_script(f"window.shuffleCount = 0; addEventListener('{event}', () => ++window.shuffleCount)")
        page.goto(base + ("classic.html" if classic else "index.html?view=modern"))
        if page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()
        if free:
            page.locator("#layoutModeSelect").select_option("freeform", force=True)

        board = classic and free
        button = page.locator("#freeBoardShuffleBtn" if board else "#shuffleBtn")
        pile = page.locator("#freeBoardPile" if board else "#deckSpread")
        pile_card = pile.locator(".free-board-pile-card" if board else ".deck-card").first
        placed = page.locator("#freeBoardWorld .free-board-card" if board else
                              ".free-table-card" if free else "#spreadGrid .spread-card-flip")
        overlay = page.locator(".shuffle-layer")
        dialog = page.locator("#confirmDialog")
        cdp = context.new_cdp_session(page)

        def down():
            button.scroll_into_view_if_needed()
            b = button.bounding_box()
            x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
            if mobile:
                cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
            else:
                page.mouse.move(x, y)
                page.mouse.down()

        def up():
            if mobile:
                cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            else:
                page.mouse.up()

        def idle():
            expect(overlay).to_have_count(0)
            assert not button.evaluate("el => el.classList.contains('is-holding')")

        # Empty-table tap, including the classic Free Board's existing confirmation.
        down()
        expect(overlay).to_have_count(1)
        up()
        if board:
            page.locator("#confirmProceedBtn").click()
        idle()
        assert page.evaluate("shuffleCount") == 1

        if classic:
            pile_card.press("Enter")
        else:
            page.locator(".table-stage").press("Enter")
        expect(placed).to_have_count(1)
        placed.evaluate("el => window.originalPlaced = el")
        pile_card.evaluate("el => window.originalPileCard = el")
        down()
        assert button.evaluate("el => el.classList.contains('is-holding')")
        assert button.evaluate("el => !el.dispatchEvent(new MouseEvent('contextmenu', {cancelable:true}))")
        if mobile:
            assert overlay.evaluate("el => !el.getAnimations({subtree:true}).length")
        else:
            page.evaluate("window.firstRiffle = document.querySelector('.shuffle-clone').getAnimations().at(-1)")
            page.wait_for_timeout(31000 if not android and not classic else 1600)
            assert page.evaluate("""document.querySelector('.shuffle-clone').getAnimations().at(-1) !== firstRiffle
                && DivinationShuffle.isHolding()""")
        up()
        expect(dialog).to_be_visible()
        if not mobile and not android and not classic:
            page.wait_for_timeout(9500)
            expect(dialog).to_be_visible()
        expect(overlay).to_have_count(1)
        page.locator("#confirmCancelBtn").click()
        idle()
        assert placed.evaluate("el => el === originalPlaced")
        assert pile_card.evaluate("el => el === originalPileCard")
        assert page.evaluate("shuffleCount") == 1

        # Interrupt an actual press before releasing it. No dialog or reset may follow.
        for reason in ("blur", "pointercancel", "lostpointercapture", "visibilitychange"):
            button.evaluate("el => el.addEventListener('pointerdown', e => window.testPointer = e.pointerId, {once:true})")
            down()
            expect(overlay).to_have_count(1)
            if reason == "blur":
                page.evaluate("window.dispatchEvent(new Event('blur'))")
            elif reason == "visibilitychange":
                page.evaluate("""Object.defineProperty(document, 'hidden', {configurable:true, value:true});
                    document.dispatchEvent(new Event('visibilitychange')); delete document.hidden""")
            elif reason == "lostpointercapture":
                # Capture is pending until the next native pointer event. Move once
                # to acquire it, release, then move again to deliver capture loss.
                pos = button.bounding_box()
                x, y = pos["x"] + pos["width"] / 2, pos["y"] + pos["height"] / 2
                for delta in (-12, 12):
                    if mobile:
                        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + delta, "y": y}]})
                    else:
                        page.mouse.move(x + delta, y)
                    if delta < 0:
                        button.evaluate("el => el.releasePointerCapture(testPointer)")
            else:
                button.evaluate("el => el.dispatchEvent(new PointerEvent('pointercancel', {pointerId:testPointer}))")
            up()
            idle()
            expect(dialog).not_to_be_visible()
            assert placed.evaluate("el => el === originalPlaced")

        down()
        up()
        page.locator("#confirmProceedBtn").click()
        expect(placed).to_have_count(0)
        if not mobile:
            # Fan-out staggers individual cards. A second down inside that phase must be rejected.
            pos = button.evaluate("""el => {el.scrollIntoView({block:'center',behavior:'instant'});
                const r=el.getBoundingClientRect(); return [r.x+r.width/2,r.y+r.height/2]}""")
            page.mouse.move(*pos)
            page.wait_for_function("""Array.from(document.querySelectorAll('.shuffle-clone'))
                .some(c => c.getAnimations().some(a => a.effect.getTiming().delay > 0))""")
            page.mouse.down()
            assert not button.evaluate("el => el.classList.contains('is-holding')")
            idle()
            up()
        idle()
        assert page.evaluate("shuffleCount") == 2
        button.press("Space")
        if board:
            page.locator("#confirmProceedBtn").click()
        idle()
        assert page.evaluate("shuffleCount") == 3
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        assert not errors, errors
        print(f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} "
              f"{'free' if free else 'preset'} {width}px passed", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--android", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.android:
        root /= "android-demo/app/src/main/assets/www"
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root))) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw, pw.chromium.launch(channel="chrome") as browser:
                for classic in (False, True):
                    for free in (False, True):
                        scenario(browser, f"http://127.0.0.1:{server.server_port}/", args.android, classic, free)
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
