"""Exercise reading questions and note downloads with an isolated local Chrome profile."""
import argparse
import json
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote

from playwright.sync_api import expect, sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


MARKER = 'PRIVATE-Q23'
QUESTION = MARKER + ' ' + '未决定' * 160 + '\n<draft> [[note]]'


def exported_file(page, trigger, extension, android):
    if android:
        page.evaluate("window.testExport = null")
        trigger.click()
        page.wait_for_function("window.testExport !== null")
        name, content = page.evaluate("window.testExport")
    else:
        with page.expect_download() as event:
            trigger.click()
        name = event.value.suggested_filename
        content = Path(event.value.path()).read_text(encoding='utf-8')
    assert name.isascii() and name.endswith(extension) and MARKER not in name, name
    return content


def assert_fits(page, selector):
    assert page.locator(selector).evaluate(
        "e => e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth + 1"
    ), selector


def scenario(context, base, android, classic, locale, width):
    page = context.new_page()
    page.set_default_timeout(8000)
    errors, leaked = [], []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def local_only(route):
        request = route.request
        if MARKER in unquote(request.url + (request.post_data or '')):
            leaked.append(request.method)
        if request.url.startswith(base + '/'):
            route.continue_()
        else:
            route.abort()

    context.route('**/*', local_only)
    if android:
        # Capture the same payload that the native document picker receives.
        page.add_init_script("""window.androidHistoryExport = { save(content, name) {
            window.testExport = [name, content];
            setTimeout(() => window.__quareiaHistoryExportResult({ok: true, fileName: name}), 0);
        }}""")
    page.goto(base + ('/classic.html' if classic else '/index.html?view=modern'))
    if android and page.locator('#telemetryDialog[open]').count():
        page.locator('#telemetryNoticeClose').click()
    page.evaluate('locale => DivinationI18n.setLocale(locale)', locale)
    q, toggle = page.locator('#readingQuestion'), page.locator('#readingQuestionToggle')
    expect(toggle).to_have_attribute('aria-expanded', 'false')
    toggle.click()
    q.fill('draft before reset')
    page.locator('#shuffleBtn').click()
    expect(q).to_have_value('')
    expect(toggle).to_have_attribute('aria-expanded', 'false')

    shuffling = page.locator("#deckSpread.is-shuffling")
    shuffling.wait_for(state="attached")
    shuffling.wait_for(state="detached", timeout=12000)
    for _ in range(3):
        page.locator('#deckSpread .deck-card').first.press('Enter')
    page.locator('#revealBtn').click()
    expect(page.locator('#historySaveStatus')).to_contain_text('saved' if locale == 'en' else '已自动保存')

    def open_history():
        if android:
            page.locator('#menuToggle').click()
        page.locator('#historyOpenBtn').click()
        page.locator('.history-record-open').first.wait_for()

    open_history()
    page.locator('.history-record-open').click()
    expect(page.locator('#historyQuestionText')).to_be_hidden()
    page.locator('#historyEditQuestionBtn').click()
    page.locator('#historyQuestionInput').fill(MARKER + ' later')
    page.locator('#historySaveQuestionBtn').click()
    expect(page.locator('#historyQuestionText')).to_have_text(MARKER + ' later')
    page.locator('#historyCloseBtn').click()

    page.locator('#layoutModeSelect').select_option('freeform', force=True)
    page.locator('#confirmProceedBtn').click()
    toggle.click()
    q.fill(QUESTION)
    toggle.click()
    expect(page.locator('#readingQuestionSummary')).to_have_text(QUESTION)
    for theme in (['parchment', 'grove'] if classic else ['parchment', 'grove-light', 'jade']):
        page.evaluate('theme => DivinationTheme.setTheme(theme)', theme)
        assert_fits(page, '.reading-question')
        assert_fits(page, 'html')
    if classic:
        page.locator('#freeBoardPile .free-board-pile-card').first.press('Enter')
        page.locator('#freeBoardRevealAllBtn').click()
    else:
        page.locator('.table-stage').press('Enter')
        page.locator('#revealBtn').click()
    expect(q).to_have_value('')

    open_history()
    search = page.locator('#historySearch')
    search.fill('未决定')
    rows = page.locator('.history-record-open')
    expect(rows).to_have_count(1)
    assert_fits(page, '.history-dialog-shell')
    rows.click()
    expect(page.locator('#historyQuestionText')).to_have_text(QUESTION)
    assert_fits(page, '.history-dialog-shell')
    note = exported_file(page, page.locator('#historyMarkdownBtn'), '.md', android)
    assert '&lt;draft&gt;' in note and '> ' + MARKER in note and MARKER + ' later' not in note
    page.locator('#historyBackBtn').click()
    page.locator('#historySelectBtn').click()
    checks = page.locator('.history-choice input')
    checks.check()
    batch = page.locator('#historyExportSelectedBtn')
    assert exported_file(page, batch, '.md', android) == note
    search.fill('later')
    checks.check()
    combined = exported_file(page, batch, '.md', android)
    assert combined.count('> ' + MARKER) == 2
    assert_fits(page, '.history-dialog-shell')

    # JSON remains a full backup even with an active selection and search.
    records = json.loads(exported_file(page, page.locator('#historyExportBtn'), '.json', android))['records']
    assert len(records) == 2 and {r['question'] for r in records} == {MARKER + ' later', QUESTION}
    for record in records:
        for card in record['cards']:
            full = page.evaluate("""c => DivinationI18n.field(tarotDeckFull.find(d => d.id === c.cardId),
                c.orientation === 'reversed' ? 'reversedMeaning' : 'uprightMeaning')""", card)
            assert full and full in combined and 'meaning' not in card
    assert not errors and not leaked, (errors, leaked)
    print(f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} {locale} {width}px passed")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--android', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.android:
        root /= 'android-demo/app/src/main/assets/www'
    with ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root))) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw, pw.chromium.launch(channel='chrome') as browser:
                for classic, locale, width in [(False, 'zh-CN', 360), (False, 'en', 1440),
                                              (True, 'en', 430), (True, 'zh-CN', 1280)]:
                    with browser.new_context(viewport={'width': width, 'height': 860}, locale=locale) as context:
                        scenario(context, 'http://127.0.0.1:%d' % server.server_port, args.android, classic, locale, width)
        finally:
            server.shutdown()


if __name__ == '__main__':
    main()
