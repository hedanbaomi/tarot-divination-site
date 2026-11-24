"""End-to-end browser verification for History Draw Statistics (Issue #26)."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from playwright.sync_api import expect, sync_playwright


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def scenario(browser, base, android, classic, width, locale, capture_dir=None):
    with browser.new_context(viewport={"width": width, "height": 844}, device_scale_factor=2 if capture_dir else 1) as context:
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("**/*", lambda r: r.continue_() if r.request.url.startswith(base) else r.abort())
        page.goto(base + ("classic.html" if classic else "index.html?view=modern"))
        if page.locator("#telemetryDialog[open]").count():
            page.locator("#telemetryNoticeClose").click()

        page.evaluate("""async (locale) => {
            DivinationI18n.setLocale(locale);
            const store = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            await store.open();
            await store.clearRecords();

            const now = Date.now();
            const daysAgo = d => new Date(now - d * 24 * 60 * 60 * 1000).toISOString();
            const threeSpread = getSpreadById("tarot", "three-card-horizontal");
            const findCard = (deck, id) => deck.find(c => c.id === id);

            const makePreset = (id, createdAt, deckType, deck, orientationMode, picks) =>
                DivinationHistoryRecords.buildPresetRecord({
                    id,
                    createdAt,
                    deckType,
                    deckMode: deckType,
                    deckName: deckType === "tarot" ? "RWS 塔罗" : deckType === "mystagogus" ? "Mystagogus" : "LXXXI",
                    spreadId: threeSpread.id,
                    spreadName: threeSpread.name,
                    positions: threeSpread.positions,
                    orientationMode,
                    filterMode: deckType === "tarot" ? "mixed" : "not-applicable",
                    overviewMethod: deckType === "tarot" ? "single" : "not-applicable",
                    entries: picks.map(([cardId, orientation], slotIndex) => ({
                        slotIndex,
                        card: findCard(deck, cardId),
                        orientation: orientation || "upright",
                        layer: null
                    }))
                });

            const tarotRecent1 = makePreset("stat-t1", daysAgo(2), "tarot", tarotDeckFull, "mixed", [
                ["major-00", "upright"], ["minor-wands-ace", "reversed"], ["minor-cups-two", "upright"]
            ]);
            const tarotRecent2 = makePreset("stat-t2", daysAgo(5), "tarot", tarotDeckFull, "mixed", [
                ["major-00", "reversed"], ["minor-wands-ace", "upright"], ["minor-swords-three", "upright"]
            ]);
            const mystagogusFree = DivinationHistoryRecords.buildFreeformLayoutRecord({
                id: "stat-m1",
                createdAt: daysAgo(4),
                deckType: "mystagogus",
                deckMode: "mystagogus",
                deckName: "Mystagogus",
                orientationMode: "upright-only",
                filterMode: "not-applicable",
                overviewMethod: "not-applicable",
                cards: [
                    ["m-01", true, 0], ["m-33", true, 100], ["m-49", true, 200], ["m-78", false, 300]
                ].map(([cardId, revealed, x], idx) => {
                    const card = findCard(mystagogusDeckFull, cardId);
                    return {
                        drawOrder: idx + 1,
                        cardId: card.id,
                        card,
                        cardName: card.name,
                        orientation: "upright",
                        revealed,
                        meaningVisible: false,
                        x, y: 0, z: idx + 1, boardRotation: 0
                    };
                })
            });
            const lxxxiRecent = makePreset("stat-l1", daysAgo(3), "lxxxi", lxxxiDeckFull, "upright-only", [
                ["lxxxi-01"], ["lxxxi-06"], ["lxxxi-22"]
            ]);
            const lxxxiOld1 = makePreset("stat-l2", daysAgo(120), "lxxxi", lxxxiDeckFull, "upright-only", [
                ["lxxxi-78"], ["lxxxi-27"], ["lxxxi-81"]
            ]);
            const lxxxiOld2 = makePreset("stat-l3", daysAgo(125), "lxxxi", lxxxiDeckFull, "upright-only", [
                ["lxxxi-78"], ["lxxxi-05"], ["lxxxi-28"]
            ]);

            for (const rec of [tarotRecent1, tarotRecent2, mystagogusFree, lxxxiRecent, lxxxiOld1, lxxxiOld2]) {
                await store.saveRecord(rec);
            }
        }""", locale)

        if android:
            page.locator("#menuToggle").click()
        page.locator("#historyOpenBtn").click()
        expect(page.locator("#historyList .history-list-item")).to_have_count(6)

        page.locator("#historyTabStats").click()
        expect(page.locator("#historyStatsView")).to_be_visible()
        expect(page.locator("#historyListView")).to_be_hidden()

        # Default view is All decks combined (6 readings, 18 revealed draws across 3 decks)
        expect(page.locator('[data-stats-deck="all"]')).to_have_attribute("aria-pressed", "true")
        expect(page.locator(".history-stats-kpis")).to_contain_text("18")
        expect(page.locator(".history-stats-cat-row")).to_have_count(3)
        if capture_dir:
            page.locator("#historyDialog").screenshot(path=str(capture_dir / "stats-preview-all-celestial.png"))

        # Filter All-decks card list by clicking the Mystagogus deck bar, then clear
        page.locator('[data-stats-category="mystagogus"]').click()
        expect(page.locator(".history-stats-card-row")).to_have_count(3)
        page.locator(".history-stats-filter-tag button").click()

        # Switch to Tarot stats (2 readings, 6 draws, Major/Minor + 5 suits + orientation)
        page.locator('[data-stats-deck="tarot"]').click()
        expect(page.locator(".history-stats-kpis")).to_contain_text("6")
        expect(page.locator(".history-stats-arcana")).to_be_visible()
        expect(page.locator(".history-stats-cat-row")).to_have_count(5)
        expect(page.locator(".history-stats-card-row").first).to_contain_text("The Fool" if locale == "en" else "愚者")

        # Click Wands category to filter most-drawn cards, then reset
        page.locator('[data-stats-category="wands"]').click()
        expect(page.locator(".history-stats-card-row")).to_have_count(1)
        expect(page.locator(".history-stats-card-row").first).to_contain_text("Ace of Wands" if locale == "en" else "权杖王牌")
        page.locator(".history-stats-filter-tag button").click()
        expect(page.locator(".history-stats-card-row")).to_have_count(4)

        if capture_dir:
            page.locator("#historyDialog").screenshot(path=str(capture_dir / "stats-preview-tarot-celestial.png"))

        # Switch to Mystagogus: 7 official chapters, unrevealed 4th freeform card excluded -> 3 draws
        page.locator('[data-stats-deck="mystagogus"]').click()
        expect(page.locator(".history-stats-cat-row")).to_have_count(7)
        expect(page.locator(".history-stats-card-row")).to_have_count(3)
        expect(page.locator("#historyStatsBody")).to_contain_text("The Core Fate Powers" if locale == "en" else "核心命运力量")
        expect(page.locator("#historyStatsBody")).to_contain_text("Structures" if locale == "en" else "结构与场域")
        expect(page.locator("#historyStatsBody")).not_to_contain_text("Empty Vessel" if locale == "en" else "空容器")

        # Switch to LXXXI: 4 realms + period filtering (30d excludes 120d-old Underworld readings)
        page.locator('[data-stats-deck="lxxxi"]').click()
        expect(page.locator(".history-stats-cat-row")).to_have_count(4)
        expect(page.locator(".history-stats-kpis")).to_contain_text("9")
        expect(page.locator(".history-stats-card-row").first).to_contain_text("Underworld" if locale == "en" else "地下世界森林")

        if capture_dir:
            page.evaluate("DivinationTheme.setTheme('parchment')")
            page.wait_for_timeout(150)
            page.locator("#historyDialog").screenshot(path=str(capture_dir / "stats-preview-lxxxi-parchment.png"))
            page.evaluate("DivinationTheme.setTheme('celestial')")

        page.locator('[data-stats-period="30d"]').click()
        expect(page.locator(".history-stats-kpis")).to_contain_text("3")
        expect(page.locator("#historyStatsBody")).to_contain_text("Chariot" if locale == "en" else "战车")

        # Verify zero horizontal overflow across dark & light themes
        for theme in ("celestial", "parchment", "jade"):
            page.evaluate("t => DivinationTheme.setTheme(t)", theme)
            overflow = page.evaluate("""() => {
                const shell = document.querySelector('.history-dialog-shell');
                return {
                    doc: document.documentElement.scrollWidth - window.innerWidth,
                    dialog: shell.scrollWidth - shell.clientWidth
                };
            }""")
            assert overflow["doc"] <= 1 and overflow["dialog"] <= 1, (theme, overflow)

        # Switch back to Readings tab cleanly
        page.locator("#historyTabList").click()
        expect(page.locator("#historyListView")).to_be_visible()
        expect(page.locator("#historyStatsView")).to_be_hidden()

        assert not errors, errors
        print(f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} {locale} {width}px passed", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--android", action="store_true")
    parser.add_argument("--capture-dir", default="")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.android:
        root /= "android-demo/app/src/main/assets/www"
    capture_dir = Path(args.capture_dir) if args.capture_dir else None
    with ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root))) as server:
        Thread(target=server.serve_forever, daemon=True).start()
        try:
            with sync_playwright() as pw, pw.chromium.launch(channel="chrome") as browser:
                cases = [
                    (False, 360, "zh-CN", capture_dir),
                    (False, 1280, "en", None),
                    (True, 430, "en", None),
                    (True, 1280, "zh-CN", None),
                ]
                for classic, width, locale, cdir in cases:
                    scenario(browser, f"http://127.0.0.1:{server.server_port}/", args.android, classic, width, locale, cdir)
        finally:
            server.shutdown()


if __name__ == "__main__":
    main()
