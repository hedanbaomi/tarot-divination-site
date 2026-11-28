"""Reading flow regression in disposable Chrome contexts and local public assets.

Run: uv run --with playwright python tools/test-reading-flow-browser.py
No provider requests, real Android picker, or existing browser profile are used.
"""
import argparse
import itertools
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
QUESTION = "Reading-flow fixture question"
REFLECTION = "Reading-flow reflection: one concrete next step."


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


def local_only(route, base):
    if route.request.url.startswith(base + "/"):
        route.continue_()
    else:
        # Do not contact remote services; a successful empty response avoids
        # manufacturing console errors from intentionally aborted requests.
        route.fulfill(status=204, headers={"Access-Control-Allow-Origin": "*"}, body="")


def assert_fits(page, selector):
    el = page.locator(selector)
    if el.is_visible():
        assert el.evaluate("e => e.scrollWidth <= e.clientWidth + 1"), selector
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth"), selector


def open_history(page, android):
    if android:
        page.locator("#menuToggle").click()
    page.locator("#historyOpenBtn").click()
    expect(page.locator("#historyDialog")).to_be_visible()


def export_markdown(page, android, selector="#readingMarkdownBtn"):
    if android:
        page.evaluate("window.testExport = null")
        page.locator(selector).click()
        page.wait_for_function("window.testExport !== null")
        name, content = page.evaluate("window.testExport")
    else:
        with page.expect_download() as event:
            page.locator(selector).click()
        download = event.value
        name = download.suggested_filename
        content = Path(download.path()).read_text(encoding="utf-8")
    assert name.endswith(".md") and name.isascii(), name
    assert QUESTION in content, "question missing from exported Markdown"
    return content


def scenario(browser, base, android, classic, width, locale, theme):
    label = f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} {width}px {locale} {theme}"
    errors = []
    context = browser.new_context(viewport={"width": width, "height": 860}, locale=locale, accept_downloads=True)
    context.route("**/*", lambda route: local_only(route, base))
    if android:
        context.add_init_script("""window.androidHistoryExport = {
          save(content, name) {
            window.testExport = [name, content];
            setTimeout(() => window.__quareiaHistoryExportResult({ok:true, fileName:name}), 0);
            return true;
          },
          savePng(content, name) {
            window.testPng = [name, content];
            setTimeout(() => window.__quareiaHistoryExportResult({ok:true, fileName:name}), 0);
            return true;
          }
        };""")
    page = context.new_page()
    page.on("pageerror", lambda error: errors.append("pageerror: " + str(error)))
    page.on("console", lambda message: errors.append("console: " + message.text) if message.type == "error" else None)
    page.set_default_timeout(10000)
    try:
        page.goto(base + ("/classic.html" if classic else "/index.html?view=modern"))
        if page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()
        page.evaluate("([locale, theme]) => { DivinationI18n.setLocale(locale); DivinationTheme.setTheme(theme); }", [locale, theme])
        assert page.evaluate("DivinationI18n.getLocale()") == locale
        assert page.evaluate("DivinationTheme.getTheme()") == theme
        assert page.locator("html").get_attribute("data-theme") == theme
        page.locator("#readingQuestionToggle").click()
        page.locator("#readingQuestion").fill(QUESTION)
        page.locator("#readingQuestionToggle").click()
        for _ in range(3):
            page.locator("#deckSpread .deck-card").first.press("Enter")
        page.locator("#revealBtn").click()
        expect(page.locator("#historySaveStatus")).to_contain_text("saved" if locale == "en" else "已自动保存", timeout=15000)
        records = page.evaluate("async () => DivinationHistoryStore.createStore().listRecords('all')")
        assert len(records) == 1 and records[0]["question"] == QUESTION, records
        record = records[0]
        assert len(record["cards"]) == 3
        assert_fits(page, ".reading-actions")
        assert page.locator(".reading-actions").evaluate("e => { const r=e.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; }")

        # All three current-reading actions must correspond to the saved record.
        ai = page.locator("#readingAiBtn")
        expect(ai).to_be_visible()
        expect(ai).to_be_enabled()
        markdown = export_markdown(page, android)
        names = page.evaluate("ids => ids.map(id => DivinationI18n.field(tarotDeckFull.find(c => c.id === id), 'name'))", [c["cardId"] for c in record["cards"]])
        assert all(name in markdown for name in names), (names, markdown)
        page.locator("#readingImageBtn").click()
        expect(page.locator("#readingImageDialog")).to_be_visible()
        page.wait_for_function("""() => { const i = document.querySelector('#readingImagePreview');
          return i && i.complete && i.naturalWidth && i.naturalHeight; }""", timeout=30000)
        assert_fits(page, "#readingImageDialog")
        if android:
            page.evaluate("window.testPng = null")
            page.locator("#readingImageSave").click()
            page.wait_for_function("window.testPng !== null")
            name, payload = page.evaluate("window.testPng")
            assert name.endswith(".png") and len(payload) > 5000
        else:
            with page.expect_download(timeout=30000) as event:
                page.locator("#readingImageSave").click()
            assert Path(event.value.path()).read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
        page.locator("#readingImageClose").click()

        # The actual AI page consumes the query and removes it from the URL;
        # inspect the navigation request and then its attached reading card.
        with page.expect_request(lambda request: urlparse(request.url).path.endswith('/ai.html')) as event:
            ai.click()
        assert parse_qs(urlparse(event.value.url).query).get("readingId") == [record["id"]]
        attached = page.locator(f".ai-reading-card[data-reading-id='{record['id']}']")
        expect(attached).to_be_visible(timeout=15000)
        expect(attached).to_contain_text(QUESTION)
        page.go_back()

        # A disjoint older fixture proves that the statistics shortcut scopes
        # the list rather than merely switching tabs.
        page.evaluate("""async original => {
          const selected = new Set(original.cards.map(c => c.cardId));
          const cards = tarotDeckFull.filter(c => !selected.has(c.id)).slice(0, 3);
          const spread = getSpreadById('tarot', 'three-card-horizontal');
          const fixture = DivinationHistoryRecords.buildPresetRecord({
            id:'reading-flow-other', createdAt:'2020-01-01T00:00:00.000Z',
            deckType:'tarot', deckMode:'tarot', deckName:'RWS Tarot',
            spreadId:spread.id, spreadName:spread.name, positions:spread.positions,
            orientationMode:'mixed', filterMode:'mixed', overviewMethod:'single',
            entries:cards.map((card, slotIndex) => ({slotIndex, card, orientation:'upright', layer:null}))
          });
          await DivinationHistoryStore.createStore().saveRecord(fixture);
        }""", record)
        open_history(page, android)
        expect(page.locator(".history-record-open")).to_have_count(2)
        page.locator(".history-record-open").first.click()
        page.locator("#historyEditReflection").click()
        page.locator("#historyReflectionInput").fill(REFLECTION)
        page.locator("#historySaveReflection").click()
        expect(page.locator("#historyReflectionText")).to_have_text(REFLECTION)
        assert_fits(page, ".history-dialog-shell")
        page.reload()
        if page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()
        open_history(page, android)
        page.locator(".history-record-open").first.click()
        expect(page.locator("#historyReflectionText")).to_have_text(REFLECTION)
        page.locator("#historyBackBtn").click()
        page.locator("#historySearch").fill("concrete next step")
        expect(page.locator(".history-record-open")).to_have_count(1)
        expect(page.locator(".history-reflection-badge")).to_be_visible()
        page.locator("#historyTabStats").click()
        expect(page.locator("#historyStatsView")).to_be_visible()
        page.locator(f"[data-view-card-records='{record['cards'][0]['cardId']}']").click()
        expect(page.locator("#historyListView")).to_be_visible()
        expect(page.locator(".history-record-open")).to_have_count(1)
        expect(page.locator("#historyCardFilter")).to_be_visible()
        assert_fits(page, ".history-dialog-shell")
        page.locator("#historyCardFilter").click()
        expect(page.locator("#historyCardFilter")).to_be_hidden()
        expect(page.locator(".history-record-open")).to_have_count(2)

        page.locator("#historyTabStats").click()
        page.locator('[data-stats-period="30d"]').click()
        page.locator(f"[data-view-card-records='{record['cards'][0]['cardId']}']").click()
        expect(page.locator("#historyCardFilter")).to_contain_text("30")
        expect(page.locator("#historyDeckFilterTrigger")).to_contain_text("Tarot" if locale == "en" else "塔罗")
        page.locator("#historyDeckFilter").select_option("mystagogus", force=True)
        expect(page.locator("#historyCardFilter")).to_be_hidden()
        expect(page.locator(".history-record-open")).to_have_count(0)
        page.locator("#historyDeckFilter").select_option("all", force=True)
        page.locator(".history-record-open").first.click()
        page.locator("#historyEditReflection").click()
        page.locator("#historyClearReflection").click()
        expect(page.locator("#historyReflectionText")).to_be_hidden()
        expect(page.locator("#historyReflectionEditor")).to_be_hidden()
        assert not page.evaluate("async id => 'reflection' in await DivinationHistoryStore.createStore().getRecord(id)", record["id"])
        assert not errors, (label, errors)
        print(label + " passed", flush=True)
    finally:
        if errors:
            print(label, "browser errors:", errors, flush=True)
        context.close()


def freeform_scenario(browser, base, android, classic):
    """Exercise a real free board, whose result actions differ from presets."""
    errors = []
    with browser.new_context(viewport={"width": 360, "height": 860}, locale="en", accept_downloads=True) as context:
        context.route("**/*", lambda route: local_only(route, base))
        if android:
            context.add_init_script("""window.androidHistoryExport = {save(content, name) {
              window.testExport = [name, content];
              setTimeout(() => window.__quareiaHistoryExportResult({ok:true, fileName:name}), 0);
              return true;
            }};""")
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append("pageerror: " + str(error)))
        page.on("console", lambda message: errors.append("console: " + message.text) if message.type == "error" else None)
        page.goto(base + ("/classic.html" if classic else "/index.html?view=modern"))
        if page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()
        page.evaluate("DivinationI18n.setLocale('en')")
        page.locator("#layoutModeSelect").select_option("freeform", force=True)
        page.locator("#readingQuestionToggle").click()
        page.locator("#readingQuestion").fill(QUESTION)
        page.locator("#readingQuestionToggle").click()
        card = "#freeBoardPile .free-board-pile-card" if classic else "#deckSpread .deck-card"
        page.locator(card).first.press("Enter")
        page.locator("#freeBoardRevealAllBtn" if classic else "#revealBtn").click()
        expect(page.locator("#freeBoardSaveStatus" if classic else "#historySaveStatus")).to_contain_text("sav", timeout=15000, ignore_case=True)
        button = "#freeBoardMarkdownBtn" if classic else "#readingMarkdownBtn"
        expect(page.locator(button)).to_be_visible()
        if not classic:
            expect(page.locator("#readingAiBtn")).to_be_hidden()
        export_markdown(page, android, button)
        assert_fits(page, "html")
        assert not errors, errors
        print(f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} freeform passed", flush=True)


def deck_change_scenario(browser, base, android, classic):
    errors = []
    with browser.new_context(viewport={"width": 360, "height": 860}) as context:
        context.route("**/*", lambda route: local_only(route, base))
        page = context.new_page()
        page.on("pageerror", lambda error: errors.append("pageerror: " + str(error)))
        page.on("console", lambda message: errors.append("console: " + message.text) if message.type == "error" else None)
        page.goto(base + ("/classic.html" if classic else "/index.html?view=modern"))
        if page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()
        for _ in range(3):
            page.locator("#deckSpread .deck-card").first.press("Enter")
        page.locator("#revealBtn").click()
        expect(page.locator("#readingAiBtn")).to_be_enabled(timeout=15000)
        page.locator("#deckSelect").select_option("mystagogus", force=True)
        expect(page.locator("#confirmDialog")).to_be_visible()
        page.locator("#confirmProceedBtn").click()
        expect(page.locator("#deckSelect")).to_have_value("mystagogus")
        expect(page.locator("#resultsSection")).to_be_hidden()
        for selector in ("#readingAiBtn", "#readingMarkdownBtn", "#readingImageBtn"):
            expect(page.locator(selector)).to_be_hidden()
        assert not errors, errors
        print(f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} deck change clears actions", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--android", action="store_true", help="only test Android bundled public assets")
    parser.add_argument("--web", action="store_true", help="only test Web public assets")
    parser.add_argument("--smoke", action="store_true", help="one case per selected public asset tree")
    parser.add_argument("--deck-change-only", action="store_true", help="run just the deck-change checks")
    args = parser.parse_args()
    assert not (args.android and args.web), "choose at most one asset tree"
    trees = [True] if args.android else [False] if args.web else [False, True]
    with sync_playwright() as pw, pw.chromium.launch(channel="chrome") as browser:
        for android in trees:
            root = ROOT / "android-demo/app/src/main/assets/www" if android else ROOT
            with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root))) as server:
                threading.Thread(target=server.serve_forever, daemon=True).start()
                try:
                    base = f"http://127.0.0.1:{server.server_port}"
                    if not args.deck_change_only:
                        cases = itertools.product((False, True), (360, 1280), ("en", "zh-CN"), ("celestial", "parchment"))
                        for classic, width, locale, theme in itertools.islice(cases, 1 if args.smoke else None):
                            scenario(browser, base, android, classic, width, locale, theme)
                    if not args.smoke or args.deck_change_only:
                        for classic in (False, True):
                            if not args.deck_change_only:
                                freeform_scenario(browser, base, android, classic)
                            deck_change_scenario(browser, base, android, classic)
                finally:
                    server.shutdown()


if __name__ == "__main__":
    main()
