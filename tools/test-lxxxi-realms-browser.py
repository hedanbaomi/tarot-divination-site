"""Verify LXXXI frames in Chrome. Requires Playwright and Pillow.
Optionally pass --art-dir (the public WebP thumbnails) and --screenshots DIR
to retain the unscaled phone captures used for visual inspection.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from PIL import Image
from playwright.sync_api import expect, sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


CARDS = [(5, "underworld"), (6, "inner-underworld"), (22, "inner-physical"),
         (1, "divine"), (14, "inner"), (27, "physical"), (78, "underworld")]


def rgb(css_hex):
    return tuple(bytes.fromhex(css_hex.lstrip("#")))


def contrast(a, b):
    def luminance(color):
        linear = [v / 3294.6 if v <= 10 else ((v / 255 + .055) / 1.055) ** 2.4 for v in color]
        return sum(v * w for v, w in zip(linear, (.2126, .7152, .0722)))
    lo, hi = sorted([luminance(a), luminance(b)])
    return (hi + .05) / (lo + .05)


def matches(pixel, expected, tolerance=4):
    return all(abs(a - b) <= tolerance for a, b in zip(pixel, expected))


def check_phone_pixels(page, groups, theme, screenshots):
    # Capture the actual table and result images together. Keep the adjoining
    # table and artwork in each crop so both edges of the band can be sampled.
    dpr = page.evaluate("devicePixelRatio")
    boxes = []
    for label, locator in groups:
        rects = locator.evaluate_all("""els => els.map(el => {
            const r = el.getBoundingClientRect(), s = getComputedStyle(el);
            const token = name => s.getPropertyValue('--lxxxi-' + name).trim();
            return {x:r.x+scrollX, y:r.y+scrollY, w:r.width, h:r.height,
                outer:token('keyline'), lining:token('lining'),
                colors:Object.fromEntries(['divine','inner','physical','underworld'].map(k=>[k,token(k)]))};
        })""")
        boxes.append((label, rects))
    capture = page.screenshot(full_page=True)
    if screenshots:
        screenshots.mkdir(parents=True, exist_ok=True)
        (screenshots / f"{theme}-page.png").write_bytes(capture)
    shot = Image.open(BytesIO(capture)).convert("RGB")
    for label, rects in boxes:
        for (number, kind), rect in zip(CARDS, rects, strict=True):
            def at(x, y):
                return shot.getpixel((int((rect["x"] + x) * dpr), int((rect["y"] + y) * dpr)))

            w, h = rect["w"], rect["h"]
            colors = rect["colors"]
            if kind == "inner-physical":
                samples = [(w * .63, 2.5, "inner"), (w * .63, h - 2.5, "physical")]
            else:
                left, right = kind.split("-") if "-" in kind else (kind, kind)
                samples = [(2.5, h * .43, left), (w - 2.5, h * .43, right)]
            for x, y, color in samples:
                observed, target = at(x, y), rgb(colors[color])
                assert matches(observed, target), (theme, label, number, observed, target)
                # Catch accidentally assigning two realms the same hue in the palette.
                if color != "underworld":
                    channel = {"divine": 0, "physical": 1, "inner": 2}[color]
                    assert observed[channel] >= max(v for i, v in enumerate(observed) if i != channel) + 20, (
                        theme, label, number, color, observed
                    )

            if kind in ("underworld", "inner-underworld"):
                # The right edge is black on both cards. At 2x DPR, allow for
                # subpixel centering; check the visible stroke on either side.
                y = h * .43
                band = rgb(colors["underworld"])
                assert max(band) <= 40
                assert all(matches(at(w - d, y), band) for d in (1, 2, 3, 4)), (theme, label, number)
                for token, distance in [("outer", -.75), ("lining", 5.25)]:
                    line = rgb(rect[token])
                    pixels = [at(w - distance - step, y) for step in (0, .25, .5)]
                    assert contrast(band, line) >= 4.5, (theme, token, band, line)
                    assert any(matches(pixel, line, 14) for pixel in pixels), (theme, label, number, token, pixels, line)

            if screenshots:
                margin = 4
                bounds = (rect["x"] - margin, rect["y"] - margin, rect["x"] + w + margin, rect["y"] + h + margin)
                crop = shot.crop(tuple(round(n * dpr) for n in bounds))
                crop.save(screenshots / f"{theme}-{label}-{number:02d}.png")


def scenario(browser, base, android, classic, free, width, art_dir, screenshots=None):
    with browser.new_context(viewport={"width": width, "height": 820}, device_scale_factor=2 if width < 500 else 1,
                             reduced_motion="reduce") as context:
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        card_images = {f"lxxxi-{n:02d}" for n, _ in CARDS}
        fallback = Path(__file__).resolve().parents[1] / "assets/cards/m/m-back.jpeg"

        def route_asset(route):
            # Bundled Android uses logical keys outside the native host. Resolve
            # both asset routes to offline images, including for unclipped pixel tests.
            name = Path(urlsplit(route.request.url).path).stem
            if route.request.resource_type == "image" and name in card_images:
                route.fulfill(path=art_dir / (name + ".webp") if art_dir else fallback)
            elif route.request.url.startswith(base):
                route.continue_()
            else:
                route.abort()

        page.route("**/*", route_asset)
        page.goto(base + ("classic.html" if classic else "index.html?view=modern"))
        if page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()
        # Put the three exceptions first and keep Fisher-Yates in its identity order.
        # Deck selection, drawing, turning, saving and history still use the normal UI.
        page.evaluate("""first => {
            const rank = c => first.includes(c.number) ? first.indexOf(c.number) : c.number + first.length;
            lxxxiDeckFull.sort((a,b) => rank(a)-rank(b));
            Math.random = () => 0.99999;
            DivinationI18n.setLocale('en');
        }""", [number for number, _ in CARDS])
        page.locator("#deckSelect").select_option("lxxxi", force=True)
        if free:
            page.locator("#layoutModeSelect").select_option("freeform", force=True)
        else:
            page.locator("#spreadSelect").select_option("event", force=True)

        board = free and classic
        keys = [key for _, key in CARDS]
        for _ in keys:
            page.locator("#freeBoardPile .free-board-pile-card" if board else "#deckSpread .deck-card").first.press("Enter")
        placed = page.locator(".free-board-card" if board else ".free-table-card" if free else "#spreadGrid .spread-card")
        expect(placed).to_have_count(len(keys))
        expect(page.locator("[data-lxxxi-border]")).to_have_count(0)
        # Layout coordinates exclude reveal animations and the board's pan/zoom transform.
        measure = "els => els.map(el => [el.offsetLeft, el.offsetTop, el.offsetWidth, el.offsetHeight])"
        before_reveal = placed.evaluate_all(measure)
        page.locator("#freeBoardRevealAllBtn" if board else "#revealBtn").click()

        def check_edges(cards, face_selector=None):
            expect(cards).to_have_count(len(keys))
            frames = cards.evaluate_all("""(els, face) => els.map(card => {
                const s = getComputedStyle(face ? card.querySelector(face) : card);
                return [card.dataset.lxxxiBorder, s.borderLeftWidth, s.paddingLeft,
                        s.outlineStyle, s.backgroundClip, s.backgroundImage];
            })""", face_selector)
            for key, frame in zip(keys, frames, strict=True):
                assert frame[:5] == [key, "5px", "1px", "solid", "content-box, padding-box, border-box"], frame
                if key == "inner-underworld":
                    assert "to right" in frame[5], frame
                if key == "inner-physical":
                    assert "to right" not in frame[5], frame

        thumbs = page.locator("#resultsList .result-card-image")
        expect(placed.last).to_have_attribute("data-lxxxi-border", keys[-1])
        assert placed.evaluate_all(measure) == before_reveal
        phone_spread = not classic and not free and width < 500
        if phone_spread:
            page.evaluate("""async () => {
                const images = document.querySelectorAll('#spreadGrid .card-image, #resultsList .result-card-image');
                await Promise.all(Array.from(images, img => {img.loading = 'eager'; return img.decode()}));
                await Promise.all(document.getAnimations().filter(a =>
                    a.effect.getTiming().iterations !== Infinity && a.playState === 'running'
                ).map(a => a.finished.catch(() => {})));
                window.scrollTo({top:0,behavior:"instant"});
            }""")
        for theme in page.evaluate("DivinationTheme.THEMES"):
            page.evaluate("t => DivinationTheme.setTheme(t)", theme)
            check_edges(placed, None if board else ".spread-card-front")
            if not board:
                check_edges(thumbs)
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), theme
            if phone_spread:
                check_phone_pixels(page, [("spread", placed.locator(".spread-card-front")), ("thumb", thumbs)],
                                   theme, screenshots)
        if not board:
            expect(page.locator("#resultsList")).to_contain_text("Inner Realm (black Underworld border)")
        if not free:
            placed.nth(2).locator(".spread-card-flip").press("Enter")
            panel = placed.nth(2).locator(".spread-card-meaning") if classic else page.locator("#cardMeaningPanel")
            expect(panel).to_contain_text("Inner Realm / Physical Realm")
            if classic:
                expect(placed.nth(2).locator(".spread-card-back")).to_have_css("padding-left", "1px")
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
            saved = page.locator(".history-actual-layout .history-spread-card")
            check_edges(saved, ".spread-card-front")
            saved.first.locator(".spread-card-flip").press("Enter")
            expect(saved.first.locator(".spread-card-meaning")).to_be_visible()
            expect(saved.first.locator(".spread-card-back")).to_have_css("border-left-width", "5px")
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
        assert not errors, errors
        print(f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} "
              f"{'free' if free else 'preset'} at {width}px passed", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--android", action="store_true")
    parser.add_argument("--art-dir", type=Path, help="Directory of public lxxxi-NN.webp thumbnails")
    parser.add_argument("--screenshots", type=Path, help="Save phone page captures and card crops by theme")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.android:
        root /= "android-demo/app/src/main/assets/www"
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root))) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw, pw.chromium.launch(channel="chrome") as browser:
                base = f"http://127.0.0.1:{server.server_port}/"
                for classic in (False, True):
                    for free in (False, True):
                        width = 430 if free else (360 if args.android else 390)
                        scenario(browser, base, args.android, classic, free, width, args.art_dir, args.screenshots)
                if not args.android:
                    scenario(browser, base, False, False, False, 1280, args.art_dir)
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
