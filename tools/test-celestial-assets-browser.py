"""Verify cold-load requests and face gestures in Chrome against public local assets."""
from collections import Counter
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import urlsplit

from playwright.sync_api import expect, sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def scenario(browser, base, page_name, reduced):
    with browser.new_context(viewport={"width": 1280, "height": 850},
                             reduced_motion="reduce" if reduced else "no-preference") as context:
        page = context.new_page()
        requests = []
        errors = []

        def capture(request):
            name = urlsplit(request.url).path.rsplit("/", 1)[-1]
            if name.startswith(("parchment-sun", "sky-face-")):
                requests.append(name)

        page.on("request", capture)
        page.on("response", lambda r: errors.append(f"{r.status} {r.url}") if r.status >= 400 else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("requestfailed", lambda r: errors.append(f"{r.failure} {r.url}"))
        # The live announcement feed is independent of the public art under test.
        page.route("https://telemetry.luotianyi.fun/v1/announcements*", lambda route:
                   route.fulfill(json={"announcements": []}, headers={"Access-Control-Allow-Origin": "*"}))
        page.goto(base + page_name)
        moon = page.locator(".sky-moon")
        expect(page.locator("html")).to_have_attribute("data-theme", "celestial")
        expect(moon).to_have_attribute("data-face", "hidden")
        assert not requests and not moon.locator("img[src]").count(), requests
        if page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()
        classic = page_name == "classic.html"

        def switch(theme):
            if classic:
                swatch = page.locator(f'[data-theme-id="{theme}"]')
                if not swatch.is_visible():
                    page.locator("#settingsToggle").click()
                swatch.click()
            else:
                # The redesigned table cycles themes through the moon button.
                moon.press("Enter")
            expect(page.locator("html")).to_have_attribute("data-theme", theme)

        def hold(expected):
            page.wait_for_function('document.querySelector(".sky-moon").style.transform.startsWith("translate3d")')
            box = moon.bounding_box()
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.mouse.down()
            try:
                assert moon.evaluate("el => el.classList.contains('dragging')"), "moon did not receive pointerdown"
                expect(moon).to_have_attribute("data-face", expected, timeout=8500)
            finally:
                page.mouse.up()

        seen = set()

        def decoded(name):
            art = moon.locator(f'img[data-src$="/{name}.webp"]')
            assert art.evaluate("async el => { await el.decode(); return el.naturalWidth === 256 "
                                "&& getComputedStyle(el).display !== 'none' }"), name
            seen.add(name + ".webp")
            assert Counter(requests) == Counter(seen), (page_name, requests, seen)

        hold("shown")
        decoded("sky-face-celestial")
        switch("parchment")
        decoded("parchment-sun")
        hold("hidden")
        decoded("parchment-sun-blank")
        hold("shown")
        decoded("parchment-sun")

        faces = {"ember": "ember", "grove": "grove"}
        if not classic:
            faces.update({"grove-light": "grove", "jade": "celestial", "dusk": "celestial", "ash": "celestial"})
        for theme, face in faces.items():
            switch(theme)
            expect(moon).to_have_attribute("data-face", "hidden")
            assert Counter(requests) == Counter(seen), requests
            hold("shown")
            decoded("sky-face-" + face)
        if classic:
            # Returning to the default hidden state must also preserve the original ten-tap gesture.
            switch("celestial")
            box = moon.bounding_box()
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, click_count=10)
            expect(moon).to_have_attribute("data-face", "shown")
        assert not errors, errors
        print(f"{page_name} ({'reduced' if reduced else 'normal'} motion): cold=0, "
              f"decoded={len(seen)}, errors=0", flush=True)


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root))) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw, pw.chromium.launch(channel="chrome") as browser:
                for name, reduced in [("index.html", False), ("classic.html", True)]:
                    scenario(browser, f"http://127.0.0.1:{server.server_port}/", name, reduced)
        finally:
            server.shutdown()
