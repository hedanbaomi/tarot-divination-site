"""Exercise printed LXXXI borders through reveal, interpretation and saved layouts."""
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
    with browser.new_context(viewport={"width": 360 if android else 1280, "height": 800}) as context:
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("**/*", lambda r: r.continue_() if r.request.url.startswith(base) else r.abort())
        page.goto(base + ("classic.html" if classic else "index.html?view=modern"))
        if page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()
        # Put the three exceptions first and keep Fisher-Yates in its identity order.
        # Deck selection, drawing, turning, saving and history still use the normal UI.
        page.evaluate("""() => {
            const first = [5, 6, 22, 1, 14, 27, 78];
            const rank = c => first.includes(c.number) ? first.indexOf(c.number) : c.number + first.length;
            lxxxiDeckFull.sort((a,b) => rank(a)-rank(b));
            Math.random = () => 0.99999;
            DivinationI18n.setLocale('en');
        }""")
        page.locator("#deckSelect").select_option("lxxxi", force=True)
        if free:
            page.locator("#layoutModeSelect").select_option("freeform", force=True)
        else:
            page.locator("#spreadSelect").select_option("three-card-horizontal", force=True)

        board = free and classic
        keys = ["underworld", "inner-underworld", "inner-physical"]
        if free:
            keys += ["divine", "inner", "physical", "underworld"]
        for _ in keys:
            page.locator("#freeBoardPile .free-board-pile-card" if board else "#deckSpread .deck-card").first.press("Enter")
        placed = page.locator(".free-board-card" if board else ".free-table-card" if free else "#spreadGrid .spread-card")
        expect(placed).to_have_count(len(keys))
        expect(page.locator("[data-lxxxi-border]")).to_have_count(0)
        page.locator("#freeBoardRevealAllBtn" if board else "#revealBtn").click()

        def check_edges(cards, face_selector=None):
            expect(cards).to_have_count(len(keys))
            for i, key in enumerate(keys):
                card = cards.nth(i)
                expect(card).to_have_attribute("data-lxxxi-border", key)
                face = card.locator(face_selector) if face_selector else card
                style = face.evaluate("""el => {
                    const s = getComputedStyle(el);
                    return [s.borderLeftWidth, s.backgroundImage, s.outlineStyle];
                }""")
                assert style[0] == "4px" and style[2] == "solid", (key, style)
                solid = {"underworld": "rgb(20, 21, 24)", "divine": "rgb(178, 59, 59)",
                         "inner": "rgb(54, 104, 168)", "physical": "rgb(60, 140, 91)"}
                if key in solid:
                    assert solid[key] in style[1], style
                if key == "inner-underworld":
                    assert "to right" in style[1] and "rgb(54, 104, 168)" in style[1] and "rgb(20, 21, 24)" in style[1], style
                if key == "inner-physical":
                    assert "to right" not in style[1] and "rgb(54, 104, 168)" in style[1] and "rgb(60, 140, 91)" in style[1], style

        for theme in page.evaluate("DivinationTheme.THEMES"):
            page.evaluate("t => DivinationTheme.setTheme(t)", theme)
            check_edges(placed, None if board else ".spread-card-front")
        if not board:
            check_edges(page.locator("#resultsList .result-card-image"))
            expect(page.locator("#resultsList")).to_contain_text("Inner Realm (black Underworld border)")
        if not free:
            placed.nth(2).locator(".spread-card-flip").press("Enter")
            panel = placed.nth(2).locator(".spread-card-meaning") if classic else page.locator("#cardMeaningPanel")
            expect(panel).to_contain_text("Inner Realm / Physical Realm")
        page.evaluate("DivinationI18n.setLocale('zh-CN')")
        if android:
            page.locator("#menuToggle").click()
        page.locator("#historyOpenBtn").click()
        page.locator(".history-record-open").first.click()
        expect(page.locator("#historyDetailBody")).to_contain_text("内在领域（地下世界黑框）")
        if free:
            summaries = page.locator(".history-free-board-card-summary")
            expect(summaries).to_have_count(len(keys))
            expect(summaries.nth(1)).to_contain_text("内在领域 / 死亡与地下世界")
            expect(summaries.nth(2)).to_contain_text("内在领域 / 物质领域")
        else:
            page.locator(".history-actual-layout-btn").click()
            check_edges(page.locator(".history-actual-layout .history-spread-card"), ".spread-card-front")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        assert not errors, errors
        print(f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} {'free' if free else 'preset'} passed", flush=True)


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
