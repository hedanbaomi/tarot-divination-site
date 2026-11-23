"""Exercise local card notes with isolated Chrome profiles.

Run: uv run --with playwright python tools/test-card-notes-browser.py [--android]
"""
import argparse
import json
import re
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import unquote

from playwright.sync_api import expect, sync_playwright

MARKER = "PRIVATE-CARD-NOTE-22"
TEXTS = {deck: f"{MARKER} {deck} " + "牌义长文本🌙" * 180 + "\n<script>unsafe()</script> & [[笔记]]"
         for deck in ("tarot", "mystagogus", "lxxxi")}


class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class Server(ThreadingHTTPServer):
    request_queue_size = 128


def fit(page, selector):
    assert page.locator(selector).evaluate("e => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth + 1"), selector


def go_back(page, android, method):
    if method == "native":
        # The Android dispatcher must consume this event synchronously.
        assert android and page.evaluate("DivinationUiBack.handleBack()") is True
    elif method == "escape":
        page.keyboard.press("Escape")
    else:
        page.locator("#cardNotesBackBtn").click()


def open_library(page, android):
    if android and page.locator("#menuToggle").is_visible():
        page.locator("#menuToggle").click()
    page.locator("#cardNotesOpenBtn").click()
    expect(page.locator("#cardNotesDialog")).to_be_visible()
    page.locator("#cardNotesList [data-note-deck][data-note-card]").first.wait_for()


def open_entry(page, entry):
    deck, card = entry.get_attribute("data-note-deck"), entry.get_attribute("data-note-card")
    entry.click()
    expect(page.locator("#cardNotesText")).to_be_visible()
    return deck, card


def export_file(page, android, selector, suffix):
    button = page.locator(selector)
    if android:
        page.evaluate("window.testExport = null")
        button.click()
        page.wait_for_function("window.testExport !== null")
        name, content = page.evaluate("window.testExport")
    else:
        with page.expect_download() as download:
            button.click()
        name = download.value.suggested_filename
        content = Path(download.value.path()).read_text(encoding="utf-8")
    assert name.isascii() and name.endswith(suffix) and MARKER not in name, name
    return content


def library_checks(page, android):
    open_library(page, android)
    fit(page, "#cardNotesDialog")
    saved = {}
    for deck, text in TEXTS.items():
        entry = page.locator(f'#cardNotesList [data-note-deck="{deck}"]').first
        entry.wait_for()
        key = open_entry(page, entry)
        page.locator("#cardNotesText").fill(text)
        if deck == "tarot":
            expect(page.locator("#cardNotesStatus")).to_contain_text("已保存到本机")
        go_back(page, android, "button")  # Back flushes pending autosave.
        page.locator("#cardNotesList").wait_for(state="visible")
        saved[key] = text
    backup = json.loads(export_file(page, android, "#cardNotesExportBtn", ".json"))
    assert backup["format"] == "divination-card-notes" and backup["version"] == 1
    actual = {(str(n["deckType"]), str(n["cardId"])): n["text"] for n in backup["notes"]}
    assert all(actual.get(key) == text for key, text in saved.items())
    assert all(set(n) == {"deckType", "cardId", "text"} for n in backup["notes"])
    page.locator("#cardNotesOnlySaved").check()
    expect(page.locator("#cardNotesList [data-note-deck][data-note-card]")).to_have_count(3)
    page.locator("#cardNotesSearch").fill("mystagogus")
    expect(page.locator("#cardNotesList [data-note-deck][data-note-card]")).to_have_count(1)
    page.locator("#cardNotesSearch").fill("")
    page.locator("#cardNotesOnlySaved").uncheck()
    page.reload()
    if android and page.locator("#telemetryDialog[open]").count():
        page.locator("#telemetryNoticeClose").click()
    open_library(page, android)
    for (deck, card), text in saved.items():
        entry = page.locator(f'#cardNotesList [data-note-deck="{deck}"][data-note-card="{card}"]')
        open_entry(page, entry)
        expect(page.locator("#cardNotesText")).to_have_value(text)
        assert page.locator("#cardNotesDialog script").count() == 0
        go_back(page, android, "button")
    # Import the actual exported JSON after clearing one entry.
    (deck, card), text = next(iter(saved.items()))
    open_entry(page, page.locator(f'#cardNotesList [data-note-deck="{deck}"][data-note-card="{card}"]'))
    page.locator("#cardNotesText").fill("")
    go_back(page, android, "button")
    page.locator("#cardNotesImportInput").set_input_files({
        "name": "notes.json", "mimeType": "application/json",
        "buffer": json.dumps(backup, ensure_ascii=False).encode("utf-8")})
    expect(page.locator("#cardNotesStatus")).to_contain_text("已导入")
    open_entry(page, page.locator(f'#cardNotesList [data-note-deck="{deck}"][data-note-card="{card}"]'))
    expect(page.locator("#cardNotesText")).to_have_value(text)
    go_back(page, android, "button")
    return saved


def draw_preset(page, classic):
    page.locator("#shuffleBtn").click()
    if not classic:
        ring = page.locator(".deck-ring.is-shuffling")
        ring.wait_for(state="attached")
        ring.wait_for(state="detached", timeout=12000)
    for _ in range(3):
        page.locator("#deckSpread .deck-card").first.press("Enter")
    page.locator("#revealBtn").click()
    expect(page.locator("#historySaveStatus")).to_contain_text("已自动保存")


def exercise_board(page, android, classic):
    draw_preset(page, classic)
    links = page.locator("#resultsList .card-note-link")
    expect(links).to_have_count(3)
    before = links.count()
    deck, card = open_entry(page, links.first)
    text = MARKER + " board <img src=x onerror=unsafe()>"
    page.locator("#cardNotesText").fill(text)
    go_back(page, android, "native" if android else "escape")
    expect(page.locator("#cardNotesDialog")).to_be_hidden()
    assert page.locator("#resultsList .card-note-link").count() == before
    result_link = page.locator(f'#resultsList .card-note-link[data-note-deck="{deck}"][data-note-card="{card}"]').first
    expect(result_link).to_have_class(re.compile(r"\bhas-note\b"))
    open_entry(page, result_link)
    expect(page.locator("#cardNotesText")).to_have_value(text)
    go_back(page, android, "button")
    if not classic:
        page.locator(".spread-card.revealed .spread-card-flip").first.click()
        expect(page.locator("#cardMeaningPanel")).to_be_visible()
        panel = page.locator("#cardMeaningPanel .card-note-link")
        panel.wait_for()
        panel_key = (panel.get_attribute("data-note-deck"), panel.get_attribute("data-note-card"))
        open_entry(page, panel)
        assert panel_key == (deck, card), (panel_key, (deck, card))
        expect(page.locator("#cardNotesText")).to_have_value(text)
        go_back(page, android, "native" if android else "escape")
        expect(page.locator("#cardMeaningPanel")).to_be_visible()
        page.locator("#cardMeaningClose").click()
    else:
        first = page.locator("#spreadGrid .spread-card.revealed").first
        first.locator(".spread-card-flip").click()
        open_entry(page, first.locator(".card-note-link"))
        expect(page.locator("#cardNotesText")).to_have_value(text)
        go_back(page, android, "native" if android else "escape")
        expect(first).to_have_class(re.compile(r"\bmeaning-visible\b"))
    return (deck, card), text


def history_checks(page, android, key, text):
    if android and page.locator("#menuToggle").is_visible():
        page.locator("#menuToggle").click()
    page.locator("#historyOpenBtn").click()
    page.locator(".history-record-open").first.click()
    detail = page.locator("#historyDetail")
    expect(detail).to_be_visible()
    deck, card = key
    entry = page.locator(f'#historyDetail .card-note-link[data-note-deck="{deck}"][data-note-card="{card}"]:visible').first
    open_entry(page, entry)
    expect(page.locator("#cardNotesText")).to_have_value(text)
    go_back(page, android, "native" if android else "escape")
    expect(detail).to_be_visible()
    assert MARKER not in export_file(page, android, "#historyMarkdownBtn", ".md")
    page.locator("#historyBackBtn").click()
    assert MARKER not in export_file(page, android, "#historyExportBtn", ".json")
    page.locator("#historyClearBtn").click()
    page.locator("#confirmProceedBtn").click()
    expect(page.locator(".history-record-open")).to_have_count(0)
    page.locator("#historyCloseBtn").click()
    open_library(page, android)
    open_entry(page, page.locator(f'#cardNotesList [data-note-deck="{deck}"][data-note-card="{card}"]'))
    expect(page.locator("#cardNotesText")).to_have_value(text)
    go_back(page, android, "button")


def freeform_checks(page, android, classic):
    page.locator("#layoutModeSelect").select_option("freeform", force=True)
    if page.locator("#confirmDialog[open]").count():
        page.locator("#confirmProceedBtn").click()
    if classic:
        page.locator("#freeBoardPile .free-board-pile-card").first.press("Enter")
        cards = page.locator(".free-board-card")
    else:
        page.locator(".table-stage").press("Enter")
        cards = page.locator(".free-table-card")
    expect(cards).to_have_count(1)
    assert cards.first.locator(".card-note-link").count() == 0
    page.locator("#freeBoardRevealAllBtn" if classic else "#revealBtn").click()
    link = cards.first.locator(".card-note-link")
    link.wait_for()
    state = cards.evaluate_all("es => es.map(e => [e.getAttribute('data-card-id'), e.className, e.getAttribute('style')])")
    key = open_entry(page, link)
    text = MARKER + " freeform"
    page.locator("#cardNotesText").fill(text)
    go_back(page, android, "native" if android else "escape")
    expect(page.locator("#cardNotesDialog")).to_be_hidden()
    assert cards.evaluate_all("es => es.map(e => [e.getAttribute('data-card-id'), e.className, e.getAttribute('style')])") == state
    open_entry(page, cards.first.locator(".card-note-link"))
    expect(page.locator("#cardNotesText")).to_have_value(text)
    go_back(page, android, "button")
    return key, text, state


def scenario(pw, base, android, classic, width):
    errors, leaks = [], []
    with TemporaryDirectory(prefix="quareia-card-notes-") as profile:
        context = pw.chromium.launch_persistent_context(profile, channel="chrome", headless=True,
                    viewport={"width": width, "height": 860}, locale="zh-CN", accept_downloads=True)
        def route_local(route):
            request = route.request
            if MARKER in unquote(request.url + (request.post_data or "")):
                leaks.append(request.method)
            if request.url.startswith(base + "/"):
                route.continue_()
            else:
                route.abort()
        context.route("**/*", route_local)
        page = context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(8000)
        page.on("pageerror", lambda error: errors.append(str(error)))
        if android:
            page.add_init_script("""window.androidHistoryExport = {save(content, name) {
                window.testExport = [name, content];
                setTimeout(() => window.__quareiaHistoryExportResult({ok: true, fileName: name}), 0);
            }}""")
        try:
            page.goto(base + ("/classic.html" if classic else "/index.html?view=modern"))
            if android and page.locator("#telemetryDialog[open]").count():
                page.locator("#telemetryNoticeClose").click()
            library_checks(page, android)
            go_back(page, android, "escape")
            expect(page.locator("#cardNotesDialog")).to_be_hidden()
            key, text = exercise_board(page, android, classic)
            history_checks(page, android, key, text)
            go_back(page, android, "escape")
            free_key, free_text, state = freeform_checks(page, android, classic)
            history_checks(page, android, free_key, free_text)
            go_back(page, android, "escape")
            cards = page.locator(".free-board-card" if classic else ".free-table-card")
            assert cards.evaluate_all("es => es.map(e => [e.getAttribute('data-card-id'), e.className, e.getAttribute('style')])") == state
            assert not errors and not leaks, (errors, leaks)
            print(f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} {width}px passed", flush=True)
        finally:
            context.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--android", action="store_true")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.android:
        root /= "android-demo/app/src/main/assets/www"
    with Server(("127.0.0.1", 0), partial(Handler, directory=str(root))) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw:
                for classic, width in ((False, 360), (False, 1440), (True, 430), (True, 1280)):
                    scenario(pw, f"http://127.0.0.1:{server.server_port}", args.android, classic, width)
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
