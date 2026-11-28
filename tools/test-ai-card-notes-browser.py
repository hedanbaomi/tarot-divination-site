"""Run with uv run --with playwright python tools/test-ai-card-notes-browser.py."""
import json
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
SITE = "https://hedanbaomi.github.io/tarot-divination-site/"
PROVIDER = "https://provider.invalid/v1"
FIRST = "personal-fixture-first"
SECOND = "personal-fixture-second"
UPDATED = "personal-fixture-revised"
UNRELATED = "personal-fixture-unattached"

SEED_READING = """async () => {
  const spread = getSpreadById('tarot', 'three-card-horizontal');
  const record = DivinationHistoryRecords.buildPresetRecord({
    id: 'notes-reading', deckType: 'tarot', deckMode: 'tarot', deckName: 'Tarot',
    spreadId: spread.id, spreadName: spread.name, positions: spread.positions,
    orientationMode: 'mixed', filterMode: 'mixed', overviewMethod: 'not-applicable',
    entries: tarotDeckFull.slice(0, 3).map((card, slotIndex) => ({card, slotIndex, orientation:'upright'}))
  });
  await DivinationHistoryStore.createStore().saveRecord(record);
}"""
NOTES_STORE = "DivinationCardNotesStore.createStore({isKnownCard: () => true})"


def run(browser, android, locale):
    folder = ROOT / 'android-demo/app/src/main/assets/www' if android else ROOT
    bodies, telemetry, errors = [], [], []
    config = {"version": 1, "activeProfileId": "fixture", "profiles": [{
        "id": "fixture", "format": "openai-chat", "model": "fixture", "baseUrl": PROVIDER,
        "apiKey": "fixture-only", "contextWindow": 65536
    }]}

    def intercept(route):
        url = route.request.url
        if url.startswith(SITE):
            relative = unquote(urlparse(url).path).removeprefix("/tarot-divination-site/")
            path = (folder / relative).resolve()
            assert path.is_relative_to(folder) and path.is_file(), relative
            route.fulfill(path=str(path))
        elif url.startswith(PROVIDER) and route.request.method == "POST":
            bodies.append(route.request.post_data_json)
            data = {"choices": [{"delta": {"content": "Fixture reply"}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 120, "completion_tokens": 10, "total_tokens": 130}}
            route.fulfill(content_type="text/event-stream", body="data: " + json.dumps(data) + "\n\ndata: [DONE]\n\n")
        elif url == "https://static.cloudflareinsights.com/beacon.min.js":
            route.fulfill(content_type="text/javascript", body="export {};")
        elif url == "https://telemetry.luotianyi.fun/v1/events":
            if route.request.method == "POST":
                telemetry.append(route.request.post_data or "")
            route.fulfill(status=204, headers={"Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*"})
        elif url.startswith(PROVIDER) and route.request.method in ("GET", "OPTIONS"):
            route.fulfill(content_type="application/json", body='{"data":[]}')
        else:
            raise AssertionError(f"Unexpected request to {urlparse(url).netloc}")

    with browser.new_context(viewport={"width": 360, "height": 860}, locale=locale) as ctx:
        ctx.route("**/*", intercept)
        ctx.add_init_script("localStorage.setItem('quareia-ai-config-v1'," + json.dumps(json.dumps(config)) +
                            "); localStorage.setItem('quareia-divination-locale'," + json.dumps(locale) + ");")
        ctx.add_init_script("""if (sessionStorage.getItem('block-notes')) {
          const open = IDBFactory.prototype.open;
          IDBFactory.prototype.open = function(name, ...args) {
            if (name === 'divination-card-notes') throw new Error('fixture denies notes storage');
            return open.call(this, name, ...args);
          };
        }""")
        if android:
            ctx.add_init_script("""window.fixtureUsage = []; window.androidTelemetry = {
              isEnabled: () => true, beginAiUsage: () => 'fixture', logAiUsage: (...args) => fixtureUsage.push(args)
            };""")
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.goto(SITE + "ai.html")
        page.evaluate(SEED_READING)
        page.goto(SITE + "ai.html?readingId=notes-reading")
        expect(page.locator(".ai-reading-card")).to_be_visible()
        toggle = page.locator("#aiIncludeCardNotes")
        matches = page.locator("#aiCardNotesMatches")
        expect(toggle).not_to_be_checked()
        expect(matches).to_be_hidden()

        def hit(count):
            expect(matches).to_have_text(page.evaluate("n => DivinationI18n.t('ai.cardNotesMatches', {count:n})", count))
            expect(matches).to_be_visible()

        def send(text):
            previous = len(bodies)
            page.locator("#aiPromptInput").fill(text)
            page.locator("#aiSendBtn").click()
            expect(page.locator("#aiMessages")).to_contain_text(text)
            expect(page.locator("#aiStopBtn")).to_be_hidden()
            expect(page.locator("#aiPromptInput")).to_be_enabled()
            assert len(bodies) == previous + 1
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
            payload = bodies[-1]["messages"]
            assert UNRELATED not in json.dumps(payload)
            return payload[0]["content"]

        # Reading a never-created notes store must leave it absent.
        toggle.check()
        hit(0)
        assert not page.evaluate("async () => (await indexedDB.databases()).some(db => db.name === 'divination-card-notes')")
        toggle.uncheck()
        writer = ctx.new_page()
        writer.goto(SITE + "ai.html")
        write = "async ([id,text,prior]) => " + NOTES_STORE + ".save('tarot',id,text,prior)"
        for card_id, note in [("major-00", FIRST), ("major-01", SECOND), ("major-04", UNRELATED)]:
            writer.evaluate(write, [card_id, note, None])
        assert "personal-fixture-" not in send("off")
        toggle.check()
        hit(2)
        page.reload()
        expect(toggle).to_be_checked()
        hit(2)
        prompt = send("on")
        assert FIRST in prompt and SECOND in prompt
        assert ("subjective" if locale == "en" else "主观笔记") in prompt
        writer.evaluate(write, ["major-00", UPDATED, FIRST])
        writer.evaluate(write, ["major-01", "", SECOND])
        hit(1)
        prompt = send("edited")
        assert UPDATED in prompt and FIRST not in prompt and SECOND not in prompt
        assert "personal-fixture-" not in page.evaluate("async () => JSON.stringify(await DivinationAiChatStore.createStore().exportBackup())")
        # Hold a real read/write transaction on the notes store. Revoke consent
        # from the other tab after Send but before the queued note reads finish.
        writer.evaluate("""() => new Promise((held, reject) => {
          const open = indexedDB.open(DivinationCardNotesStore.DB_NAME);
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(DivinationCardNotesStore.STORE_NAME, 'readwrite');
            const store = tx.objectStore(DivinationCardNotesStore.STORE_NAME);
            let locked = true;
            window.releaseNotes = () => { locked = false; };
            tx.oncomplete = () => db.close();
            function keepLock() {
              store.get(['tarot','major-00']).onsuccess = () => {
                held();
                if (locked) keepLock();
              };
            }
            keepLock();
          };
        })""")
        page.locator("#aiPromptInput").fill("revoke while reading")
        page.locator("#aiSendBtn").click()
        expect(page.locator("#aiStopBtn")).to_be_visible()
        writer.locator("#aiIncludeCardNotes").uncheck()
        expect(toggle).not_to_be_checked()
        writer.evaluate("releaseNotes()")
        expect(page.locator("#aiStopBtn")).to_be_hidden()
        assert len(bodies) == 4 and "personal-fixture-" not in json.dumps(bodies[-1]["messages"])
        assert "personal-fixture-" not in send("off again")
        if android:
            telemetry.extend(page.evaluate("fixtureUsage.map(args => JSON.stringify(args))"))
        assert telemetry and (android or any(json.loads(item).get("event") == "ai_usage" for item in telemetry))
        assert all("personal-fixture-" not in item for item in telemetry)
        page.evaluate("sessionStorage.setItem('block-notes','1')")
        page.reload()
        expect(toggle).not_to_be_checked()
        toggle.check()
        hit(0)
        assert "personal-fixture-" not in send("notes store unavailable")
        assert not errors, errors
        print(f"{'Android' if android else 'Web'} {locale}, 360px: six intercepted requests passed", flush=True)


if __name__ == "__main__":
    with sync_playwright() as pw, pw.chromium.launch(channel="chrome") as browser:
        for platform in (False, True):
            for language in ("zh-CN", "en"):
                run(browser, platform, language)
