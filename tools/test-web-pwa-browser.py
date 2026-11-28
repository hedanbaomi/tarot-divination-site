"""Run with uv run --with playwright python tools/test-web-pwa-browser.py."""
import re
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
CACHED_URLS = """async () => (await Promise.all((await caches.keys()).map(
  async name => (await (await caches.open(name)).keys()).map(request => request.url)
))).flat()"""
DECODE = """async path => {
  const img = new Image(); img.src = path; await img.decode();
  return [img.naturalWidth, img.naturalHeight];
}"""


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def do_GET(self):
        site = self.server
        path = unquote(urlsplit(self.path).path)
        if not path.startswith(site.scope):
            return self.send_error(404)
        relative = path[len(site.scope):] or "index.html"
        if not (relative in {"index.html", "classic.html", "ai.html", "manifest.webmanifest", "sw.js"}
                or relative.startswith(("js/", "css/", "assets/"))):
            return self.send_error(404)
        if not (ROOT / relative).resolve().is_relative_to(ROOT):
            return self.send_error(404)
        site.requests.append(relative)
        if site.offline:
            self.close_connection = True  # A worker with its own network stack also loses its upstream.
            return
        if relative == "sw.js" and site.new_worker:
            data = re.sub(r'const SHELL_VERSION = "[a-f0-9]+";', 'const SHELL_VERSION = "next-release";',
                          (ROOT / "sw.js").read_text(encoding="utf-8")).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.end_headers()
            self.wfile.write(data)
            return
        self.path = "/" + relative
        super().do_GET()

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)


def exercise(browser, server, prefix):
    server.scope, server.requests = prefix, []
    server.offline = server.new_worker = False
    base = f"http://127.0.0.1:{server.server_port}{prefix}"
    errors, protected = [], []
    with browser.new_context(viewport={"width": 390, "height": 844}) as context:
        def external(route):
            url = urlsplit(route.request.url)
            if not server.offline and url.hostname == "assets.luotianyi.fun":
                protected.append(route.request.url)
                route.fulfill(path=str(ROOT / "assets/icons/pwa-icon-192.png"), content_type="image/png",
                              headers={"Access-Control-Allow-Origin": "*"})
            elif not server.offline and url.hostname == "telemetry.luotianyi.fun" and url.path == "/v1/announcements":
                route.fulfill(json={"announcements": []}, headers={"Access-Control-Allow-Origin": "*"})
            else:
                errors.append("unexpected external request: " + url.hostname)
                route.abort()

        context.route(re.compile("^https://"), external)
        context.on("page", lambda p: p.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None))
        context.on("weberror", lambda event: errors.append(str(event.error)))
        page = context.new_page()
        page.goto(base + "index.html")
        page.wait_for_function("!!navigator.serviceWorker.controller")
        assert page.evaluate("async () => (await navigator.serviceWorker.ready).scope") == base
        assert not any(path.startswith("assets/cards/") for path in server.requests)
        installed = page.evaluate(CACHED_URLS)
        assert all(url.startswith(base) and "/assets/cards/" not in url for url in installed)
        assert base + "ai.html" in installed

        sizes = {}
        for card in ["assets/cards/major-00.jpeg", "assets/cards/m/m-01.jpeg"]:
            with page.expect_response(lambda r: r.url == base + card) as visited:
                sizes[card] = page.evaluate(DECODE, card)
            assert visited.value.from_service_worker and min(sizes[card]) > 100
            assert base + card in page.evaluate(CACHED_URLS)
        remote = page.evaluate("lxxxiDeckFull[0].image")
        with page.expect_response(lambda r: r.url == remote) as response:
            assert page.evaluate("async url => (await fetch(url)).ok", remote)
        assert protected == [remote] and not response.value.from_service_worker

        server.offline = True
        context.set_offline(True)
        assert page.reload().from_service_worker
        assert not page.evaluate("navigator.onLine")
        face = page.locator(".deck-card").first
        for _ in range(3):
            face.press("Enter")
        page.locator("#revealBtn").click()
        expect(page.locator("#historySaveStatus")).to_have_text(page.evaluate("DivinationI18n.t('history.saved')"))
        page.locator("#historyOpenBtn").click()
        expect(page.locator(".history-record-open")).to_have_count(1)
        page.locator("#historyTabStats").click()
        expect(page.locator(".history-stats-kpi-value").nth(0)).to_have_text("1")
        expect(page.locator(".history-stats-kpi-value").nth(1)).to_have_text("3")
        for card, size in sizes.items():
            assert page.evaluate(DECODE, card) == size
        assert page.evaluate("""[tarotDeckFull, mystagogusDeckFull, lxxxiDeckFull].every(
          deck => deck.length >= 78 && deck.every(card => !!card.uprightMeaning)) &&
          ['tarot', 'mystagogus', 'lxxxi'].every(deck => getSpreadsForDeck(deck).length > 0)""")
        page.evaluate("""async () => {
          const store = DivinationCardNotesStore.createStore({isKnownCard: () => true});
          await store.save('tarot', 'major-00', 'offline test', null);
        }""")
        assert page.goto(base + "ai.html").from_service_worker
        assert page.reload().from_service_worker
        expect(page.locator("#aiPromptInput")).to_be_visible()
        page.wait_for_function("document.querySelectorAll('.ai-chat-item').length > 0")
        assert page.goto(base + "classic.html").from_service_worker
        expect(page.locator("#deckSpread .deck-card").first).to_be_visible()
        assert page.evaluate("""async () => (await DivinationCardNotesStore.createStore({
          isKnownCard: () => true}).get('tarot', 'major-00')).text""") == "offline test"

        context.set_offline(False)
        server.offline = False
        server.new_worker = True
        page.evaluate("caches.open('unrelated-cache')")
        page.evaluate("async () => (await navigator.serviceWorker.ready).update()")
        page.wait_for_function("async () => !!(await navigator.serviceWorker.getRegistration()).waiting")
        assert page.url == base + "classic.html"
        page.close()
        page = context.new_page()
        page.goto(base + "ai.html")
        page.wait_for_function("""async () => { const n = await caches.keys();
          return n.includes('unrelated-cache') && n.filter(k => k.includes(':shell-')).length === 1 &&
                 n.some(k => k.endsWith(':shell-next-release')); }""")
        urls = page.evaluate(CACHED_URLS)
        assert all(url.startswith(base) for url in urls) and remote not in urls
        assert not errors, errors
        print(f"{prefix} passed: {len(installed)} install entries, 0 install card requests, offline reading and update passed")


if __name__ == "__main__":
    with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw, pw.chromium.launch(channel="chrome") as browser:
                for scope in ["/tarot-divination-site/", "/"]:
                    exercise(browser, server, scope)
        finally:
            server.shutdown()
