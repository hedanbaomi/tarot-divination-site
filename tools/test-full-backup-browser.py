"""End-to-end Playwright verification for P1-C Unified Full Backup & Restore.

Exercises Web (modern + classic) and Android (modern + classic) at 360px and 1280px,
across dark (celestial) and light (parchment) themes, in zh-CN and en.

Run: uv run --with playwright python tools/test-full-backup-browser.py
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

SECRET_TRAP = "sk-SECRET-TRAP-NEVER-EXPORT-999"
NOTE_XSS = 'Full backup note <img src=x onerror="window.__xssFired=1"> & 中文笔记🌙'
QUESTION_TEXT = "全量备份测试问题：未来三个月重心在哪里？"
REFLECTION_TEXT = "事后复盘：关键转折确实发生在第二个月。"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass


class ThreadedServer(ThreadingHTTPServer):
    request_queue_size = 128


def assert_no_overflow(page, context_label):
    result = page.evaluate(
        """() => {
            const doc = document.documentElement;
            const dialog = document.getElementById("fullBackupDialog");
            const dialogRect = dialog && dialog.open ? dialog.getBoundingClientRect() : null;
            return {
                docOverflow: doc.scrollWidth > doc.clientWidth + 1,
                docScrollWidth: doc.scrollWidth,
                docClientWidth: doc.clientWidth,
                dialogOverflow: dialog && dialog.open ? dialog.scrollWidth > dialog.clientWidth + 1 : false,
                dialogScrollWidth: dialog && dialog.open ? dialog.scrollWidth : 0,
                dialogClientWidth: dialog && dialog.open ? dialog.clientWidth : 0,
                dialogOutsideRight: dialogRect ? dialogRect.right > window.innerWidth + 1 : false,
                dialogOutsideLeft: dialogRect ? dialogRect.left < -1 : false
            };
        }"""
    )
    assert not result["docOverflow"], (context_label, result)
    assert not result["dialogOverflow"], (context_label, result)
    assert not result["dialogOutsideRight"], (context_label, result)
    assert not result["dialogOutsideLeft"], (context_label, result)


def dismiss_android_telemetry(page):
    if page.locator("#telemetryDialog[open]").count():
        page.locator("#telemetryNoticeClose").click()
        expect(page.locator("#telemetryDialog")).to_be_hidden()


def open_backup_dialog(page, android, classic):
    if android:
        page.locator("#menuToggle").click()
        expect(page.locator("#appMenu")).to_have_class(re.compile(r"\bis-open\b"))
        page.locator("#fullBackupOpenBtn").click()
        expect(page.locator("#appMenu")).not_to_have_class(re.compile(r"\bis-open\b"))
    elif not classic:
        page.locator("#settingsOpenBtn").click()
        expect(page.locator("#settingsPanel")).to_be_visible()
        page.locator("#fullBackupOpenBtn").click()
        expect(page.locator("#settingsPanel")).to_be_hidden()
    else:
        page.locator("#fullBackupOpenBtn").click()
    expect(page.locator("#fullBackupDialog")).to_be_visible()
    expect(page.locator("#fullBackupLocalCounts li")).to_have_count(5)


def close_backup_dialog(page, android):
    if android:
        assert page.evaluate("window.DivinationUiBack.handleBack()") is True
        expect(page.locator("#fullBackupDialog")).to_be_hidden()
        assert page.evaluate("window.DivinationUiBack.handleBack()") is False
    else:
        page.keyboard.press("Escape")
        expect(page.locator("#fullBackupDialog")).to_be_hidden()


def seed_all_modules(page, android):
    page.evaluate(
        """async ({ secretTrap, noteXss, questionText, reflectionText, isAndroid }) => {
            // 1. Reading History with question & reflection
            const historyStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            const record = DivinationHistoryRecords.buildReadingRecord({
                id: "reading-full-backup-e2e-1",
                createdAt: "2026-11-28T05:00:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: questionText,
                reflection: reflectionText,
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[0] },
                    { slotIndex: 1, orientation: "reversed", layer: null, card: tarotDeckFull[1] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[2] }
                ]
            });
            await historyStore.saveRecord(record);

            // 2. Card Notes
            const notesStore = DivinationCardNotesStore.createStore({
                isKnownCard: (deck, id) => {
                    const list = deck === "tarot" ? tarotDeckFull : deck === "mystagogus" ? mystagogusDeckFull : lxxxiDeckFull;
                    return list.some(c => c.id === id);
                }
            });
            await notesStore.save("tarot", "major-00", noteXss, null);

            // 3. Custom Spreads via live DivinationCustomSpreadUi controller
            const spreadDef1 = {
                name: "全量备份测试牌阵",
                description: "测试跨设备导出恢复",
                columns: 2,
                rows: 1,
                deckScope: "any",
                tarotMode: "mixed",
                stackingMode: "single",
                positions: [
                    { name: "核心", meaning: "当下关键", column: 1, row: 1 },
                    { name: "方向", meaning: "下一步", column: 2, row: 1 }
                ]
            };
            DivinationCustomSpreadUi.importCode(DivinationCustomSpreads.encode(spreadDef1));
            if (!isAndroid) {
                const spreadDef2 = {
                    name: "第二会话测试牌阵",
                    description: "验证 Web 多牌阵全量导出与即时恢复",
                    columns: 1,
                    rows: 2,
                    deckScope: "any",
                    tarotMode: "mixed",
                    stackingMode: "single",
                    positions: [
                        { name: "上方", meaning: "显性趋势", column: 1, row: 1 },
                        { name: "下方", meaning: "隐性根源", column: 1, row: 2 }
                    ]
                };
                DivinationCustomSpreadUi.importCode(DivinationCustomSpreads.encode(spreadDef2));
            }

            // 4. AI Chats
            const aiStore = DivinationAiChatStore.createStore();
            await aiStore.createConversation({
                id: "chat-full-backup-e2e-1",
                title: "测试 AI 解牌对话",
                createdAt: 1795842000000,
                updatedAt: 1795842060000,
                archived: false,
                pinned: true,
                skillMode: "auto",
                readingIds: [record.id],
                readingSnapshots: [],
                messages: [
                    { id: "msg-1", role: "user", content: "请解读愚者正位", createdAt: 1795842000000 },
                    { id: "msg-2", role: "assistant", content: "愚者代表新的起点。", createdAt: 1795842050000 }
                ]
            });

            // 5. Plant fake API key secrets that MUST NEVER be exported
            localStorage.setItem("quareia-ai-config-v1", JSON.stringify({
                activeProfileId: "p1",
                profiles: [{ id: "p1", name: "Trap", apiKey: secretTrap, baseUrl: "https://secret.example/v1" }]
            }));
            localStorage.setItem("quareia-ai-config", JSON.stringify({ apiKey: secretTrap }));

            // 6. Preferences (parchment light theme + English locale)
            DivinationTheme.setTheme("parchment");
            DivinationI18n.setLocale("en");
        }""",
        {
            "secretTrap": SECRET_TRAP,
            "noteXss": NOTE_XSS,
            "questionText": QUESTION_TEXT,
            "reflectionText": REFLECTION_TEXT,
            "isAndroid": android,
        },
    )


def clear_all_modules(page, android):
    page.evaluate(
        """async () => {
            const historyStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            await historyStore.clearRecords();

            const notesStore = DivinationCardNotesStore.createStore({
                isKnownCard: (deck, id) => {
                    const list = deck === "tarot" ? tarotDeckFull : deck === "mystagogus" ? mystagogusDeckFull : lxxxiDeckFull;
                    return list.some(c => c.id === id);
                }
            });
            const notes = await notesStore.list();
            for (const row of notes) {
                await notesStore.save(row.deckType, row.cardId, "", row.text);
            }

            localStorage.removeItem("quareia-custom-spreads-v1");
            localStorage.removeItem("quareia-spread-selection-v1");

            const aiStore = DivinationAiChatStore.createStore();
            await aiStore.clearConversations();

            DivinationTheme.setTheme("celestial");
            DivinationI18n.setLocale("zh-CN");
        }"""
    )
    # Reload so DivinationCustomSpreadUi boots with a genuinely empty live controller.
    page.reload()
    if android:
        dismiss_android_telemetry(page)


def export_full_backup(page, android):
    if android:
        # Exercise cancelled and busy branches first, then success.
        page.evaluate(
            """() => {
                window.__testExportMode = "cancel";
                window.__testExportCapture = null;
            }"""
        )
        page.locator("#fullBackupExportBtn").click()
        expect(page.locator("#fullBackupStatus")).to_contain_text("cancelled")

        page.evaluate('() => { window.__testExportMode = "busy"; }')
        page.locator("#fullBackupExportBtn").click()
        expect(page.locator("#fullBackupStatus")).to_contain_text("Finish the current file export")

        page.evaluate('() => { window.__testExportMode = "ok"; }')
        page.locator("#fullBackupExportBtn").click()
        page.wait_for_function("window.__testExportCapture !== null")
        file_name, content = page.evaluate("window.__testExportCapture")
        expect(page.locator("#fullBackupStatus")).to_contain_text(file_name)
    else:
        with page.expect_download() as dl_info:
            page.locator("#fullBackupExportBtn").click()
        download = dl_info.value
        file_name = download.suggested_filename
        content = Path(download.path()).read_text(encoding="utf-8")
        expect(page.locator("#fullBackupStatus")).to_contain_text(file_name)

    assert re.match(r"^quareia-full-backup-\d{8}-\d{4}\.json$", file_name), file_name
    return file_name, content


def run_scenario(pw, base_url, android, classic, width):
    label = f"{'Android' if android else 'Web'} {'classic' if classic else 'modern'} {width}px"
    page_errors = []
    console_errors = []
    external_requests = []
    backup_phase = {"active": False, "requests": []}

    with TemporaryDirectory(prefix="quareia-full-backup-") as profile:
        context = pw.chromium.launch_persistent_context(
            profile,
            channel="chrome",
            headless=True,
            viewport={"width": width, "height": 860},
            locale="zh-CN",
            accept_downloads=True,
        )

        def handle_route(route):
            req = route.request
            payload = unquote(req.url + (req.post_data or ""))
            for marker in (SECRET_TRAP, QUESTION_TEXT, REFLECTION_TEXT, "FULL_BACKUP_XSS"):
                if marker in payload:
                    external_requests.append("DATA_LEAK:" + req.url)
            if backup_phase["active"]:
                backup_phase["requests"].append((req.method, req.url))
            if req.url.startswith(base_url + "/"):
                route.continue_()
            else:
                # Stub external origins offline so zero traffic leaves localhost
                # without generating synthetic net::ERR_FAILED console noise.
                route.fulfill(status=204, body="")

        context.route("**/*", handle_route)
        page = context.pages[0] if context.pages else context.new_page()
        page.set_default_timeout(10000)
        page.on("pageerror", lambda err: page_errors.append(str(err)))
        page.on(
            "console",
            lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
        )

        if android:
            page.add_init_script(
                """
                window.androidAiConfig = { load: () => JSON.stringify({ apiKey: "sk-SECRET-TRAP-NEVER-EXPORT-999" }) };
                window.__testExportMode = "ok";
                window.__testExportCapture = null;
                window.__testExportSaveCalls = 0;
                window.androidHistoryExport = {
                    save(content, name) {
                        window.__testExportSaveCalls += 1;
                        if (window.__testExportMode === "busy") return false;
                        if (window.__testExportMode === "cancel") {
                            setTimeout(() => window.__quareiaHistoryExportResult({ ok: false, cancelled: true }), 0);
                            return true;
                        }
                        window.__testExportCapture = [name, content];
                        setTimeout(() => window.__quareiaHistoryExportResult({ ok: true, fileName: name }), 0);
                        return true;
                    }
                };
                """
            )

        try:
            url = base_url + ("/classic.html" if classic else "/index.html?view=modern")
            page.goto(url)
            if android:
                dismiss_android_telemetry(page)

            # Verify existing 4 single-module backup buttons still exist.
            for selector in ("#historyExportBtn", "#historyImportInput", "#cardNotesExportBtn", "#cardNotesImportInput"):
                assert page.locator(selector).count() == 1, (label, selector)

            # Seed all 5 sections + API key traps + light theme + English.
            seed_all_modules(page, android)

            # Open dialog in light parchment theme + English and verify counts & layout.
            expected_spread_count = 1 if android else 2
            open_backup_dialog(page, android, classic)
            assert page.evaluate("document.documentElement.getAttribute('data-theme')") == "parchment"
            assert page.evaluate("document.documentElement.lang") == "en"
            assert page.locator("#fullBackupDialog select").count() == 0
            expect(page.locator("#fullBackupPrivacy")).to_contain_text("API keys")
            expect(page.locator('[data-backup-count-section="history"]')).to_contain_text("1")
            expect(page.locator('[data-backup-count-section="cardNotes"]')).to_contain_text("1")
            expect(page.locator('[data-backup-count-section="customSpreads"]')).to_contain_text(str(expected_spread_count))
            expect(page.locator('[data-backup-count-section="aiChats"]')).to_contain_text("1")
            expect(page.locator('[data-backup-count-section="preferences"]')).to_contain_text("Parchment")
            assert_no_overflow(page, label + " light/en export view")

            # Export with zero network activity.
            backup_phase["active"] = True
            file_name, exported_json = export_full_backup(page, android)
            backup_phase["active"] = False
            assert not backup_phase["requests"], (label, backup_phase["requests"])

            # Verify exported JSON integrity and ZERO API key leakage.
            assert SECRET_TRAP not in exported_json, "API key secret leaked into backup!"
            assert "apiKey" not in exported_json, "apiKey field leaked into backup!"
            assert "secret.example" not in exported_json, "endpoint leaked into backup!"
            envelope = json.loads(exported_json)
            assert envelope["format"] == "quareia-full-backup"
            assert envelope["version"] == 1
            assert set(envelope["sections"].keys()) == {"history", "cardNotes", "customSpreads", "aiChats", "preferences"}
            assert len(envelope["sections"]["history"]["records"]) == 1
            assert envelope["sections"]["history"]["records"][0]["question"] == QUESTION_TEXT
            assert envelope["sections"]["history"]["records"][0]["reflection"] == REFLECTION_TEXT
            assert len(envelope["sections"]["cardNotes"]["notes"]) == 1
            assert len(envelope["sections"]["customSpreads"]["codes"]) == expected_spread_count
            assert len(envelope["sections"]["aiChats"]["conversations"]) == 1
            assert envelope["sections"]["preferences"] == {"theme": "parchment", "locale": "en"}

            close_backup_dialog(page, android)
            if android:
                # Focus MUST return to #menuToggle, never inside #appMenu[aria-hidden="true"].
                assert page.evaluate("document.activeElement && document.activeElement.id") == "menuToggle", label

            # Clear all data & reload into dark celestial + zh-CN so live controllers boot empty.
            clear_all_modules(page, android)
            # Mount a live revealed-card marker for tarot/major-00 to verify instant marker sync on restore.
            page.evaluate(
                """() => {
                    const marker = document.createElement("div");
                    marker.id = "e2eCardNoteMarker";
                    DivinationCardNotes.markRevealedCard(marker, "tarot", "major-00");
                    document.body.appendChild(marker);
                }"""
            )
            assert page.evaluate("document.getElementById('e2eCardNoteMarker').classList.contains('has-card-note')") is False
            assert page.evaluate("DivinationCustomSpreadUi.list().length") == 0

            open_backup_dialog(page, android, classic)
            assert page.evaluate("document.documentElement.getAttribute('data-theme')") == "celestial"
            assert page.evaluate("document.documentElement.lang") == "zh-CN"
            expect(page.locator('[data-backup-count-section="history"]')).to_contain_text("0")
            expect(page.locator('[data-backup-count-section="cardNotes"]')).to_contain_text("0")
            expect(page.locator('[data-backup-count-section="customSpreads"]')).to_contain_text("0")
            expect(page.locator('[data-backup-count-section="aiChats"]')).to_contain_text("0")
            assert_no_overflow(page, label + " dark/zh empty view")

            # Security fail-closed check: tampered backup with apiKey / __proto__ is rejected.
            tampered = json.loads(exported_json)
            tampered["sections"]["preferences"]["apiKey"] = "sk-injected"
            page.locator("#fullBackupImportInput").set_input_files({
                "name": "tampered.json",
                "mimeType": "application/json",
                "buffer": json.dumps(tampered).encode("utf-8"),
            })
            expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-error\b"))
            expect(page.locator("#fullBackupPreview")).to_be_hidden()

            proto_payload = '{"format":"quareia-full-backup","version":1,"exportedAt":"2026-11-28T05:00:00.000Z","sections":{"__proto__":{"polluted":true}}}'
            page.locator("#fullBackupImportInput").set_input_files({
                "name": "proto.json",
                "mimeType": "application/json",
                "buffer": proto_payload.encode("utf-8"),
            })
            expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-error\b"))
            expect(page.locator("#fullBackupPreview")).to_be_hidden()

            # Upload valid backup -> preview appears without restoring silently -> cancel leaves 0 items.
            backup_phase["active"] = True
            page.locator("#fullBackupImportInput").set_input_files({
                "name": file_name,
                "mimeType": "application/json",
                "buffer": exported_json.encode("utf-8"),
            })
            expect(page.locator("#fullBackupPreview")).to_be_visible()
            expect(page.locator("#fullBackupPreviewList input[type='checkbox']")).to_have_count(5)
            assert_no_overflow(page, label + " dark/zh preview view")

            page.locator("#fullBackupCancelBtn").click()
            expect(page.locator("#fullBackupPreview")).to_be_hidden()
            expect(page.locator('[data-backup-count-section="history"]')).to_contain_text("0")

            # Upload valid backup -> uncheck preferences -> merge restore data modules only.
            page.locator("#fullBackupImportInput").set_input_files({
                "name": file_name,
                "mimeType": "application/json",
                "buffer": exported_json.encode("utf-8"),
            })
            expect(page.locator("#fullBackupPreview")).to_be_visible()
            page.locator('#fullBackupPreviewList input[data-backup-section="preferences"]').uncheck()
            page.locator("#fullBackupConfirmBtn").click()
            expect(page.locator("#fullBackupSummary")).to_be_visible()
            expect(page.locator("#fullBackupSummaryList li")).to_have_count(4)
            expect(page.locator('[data-backup-count-section="history"]')).to_contain_text("1")
            expect(page.locator('[data-backup-count-section="cardNotes"]')).to_contain_text("1")
            expect(page.locator('[data-backup-count-section="customSpreads"]')).to_contain_text(str(expected_spread_count))
            expect(page.locator('[data-backup-count-section="aiChats"]')).to_contain_text("1")
            # Preferences were unchecked so theme & locale stay celestial + zh-CN.
            assert page.evaluate("document.documentElement.getAttribute('data-theme')") == "celestial"
            assert page.evaluate("document.documentElement.lang") == "zh-CN"
            # Live UI sync without reloading: #spreadSelect options, #customSpreadLibrary, and revealed-card note marker update immediately!
            live_state = page.evaluate(
                """() => {
                    const options = Array.from(document.querySelectorAll("#spreadSelect option")).map(o => o.textContent || "");
                    const libText = (document.getElementById("customSpreadLibrary") || {}).textContent || "";
                    const markerHasNote = document.getElementById("e2eCardNoteMarker").classList.contains("has-card-note");
                    return {
                        options,
                        libText,
                        liveCount: DivinationCustomSpreadUi.list().length,
                        markerHasNote
                    };
                }"""
            )
            assert live_state["liveCount"] == expected_spread_count, (label, live_state)
            assert any("全量备份测试牌阵" in opt for opt in live_state["options"]), (label, live_state)
            assert "全量备份测试牌阵" in live_state["libText"], (label, live_state)
            if not android:
                assert any("第二会话测试牌阵" in opt for opt in live_state["options"]), (label, live_state)
                assert "第二会话测试牌阵" in live_state["libText"], (label, live_state)
            assert live_state["markerHasNote"] is True, (label, live_state)
            # Zero network requests occurred during preview, cancel, and 4-module data merge restore.
            backup_phase["active"] = False
            assert not backup_phase["requests"], (label, backup_phase["requests"])

            # Upload again -> restore ONLY preferences -> verify live theme & locale switch!
            page.locator("#fullBackupImportInput").set_input_files({
                "name": file_name,
                "mimeType": "application/json",
                "buffer": exported_json.encode("utf-8"),
            })
            expect(page.locator("#fullBackupPreview")).to_be_visible()
            for sec in ("history", "cardNotes", "customSpreads", "aiChats"):
                page.locator(f'#fullBackupPreviewList input[data-backup-section="{sec}"]').uncheck()
            page.locator("#fullBackupConfirmBtn").click()
            expect(page.locator("#fullBackupSummary")).to_be_visible()
            assert page.evaluate("document.documentElement.getAttribute('data-theme')") == "parchment"
            assert page.evaluate("document.documentElement.lang") == "en"
            expect(page.locator("#fullBackupDialogTitle")).to_have_text("Full Backup & Restore")
            assert_no_overflow(page, label + " light/en post-restore summary")

            # Verify zero XSS execution and proper focus return on close.
            assert page.evaluate("Boolean(window.__xssFired)") is False
            close_backup_dialog(page, android)
            if android:
                assert page.evaluate("document.activeElement && document.activeElement.id") == "menuToggle", label

                # Android no-clobber regression: create/import another spread WITHOUT reloading,
                # verify BOTH the restored spread and new spread coexist in live UI AND after reload!
                page.evaluate(
                    """() => {
                        const spreadDefB = {
                            name: "新建牌阵B",
                            description: "验证不覆盖已恢复牌阵",
                            columns: 1,
                            rows: 1,
                            deckScope: "any",
                            tarotMode: "mixed",
                            stackingMode: "single",
                            positions: [{ name: "核心", meaning: "提示", column: 1, row: 1 }]
                        };
                        DivinationCustomSpreadUi.importCode(DivinationCustomSpreads.encode(spreadDefB));
                    }"""
                )
                after_add = page.evaluate(
                    """() => ({
                        names: DivinationCustomSpreadUi.list().map(s => s.name),
                        options: Array.from(document.querySelectorAll("#spreadSelect option")).map(o => o.textContent || "")
                    })"""
                )
                assert set(after_add["names"]) == {"全量备份测试牌阵", "新建牌阵B"}, (label, after_add)
                assert any("全量备份测试牌阵" in o for o in after_add["options"]), (label, after_add)
                assert any("新建牌阵B" in o for o in after_add["options"]), (label, after_add)

            page.reload()
            if android:
                dismiss_android_telemetry(page)
            assert page.evaluate("document.documentElement.getAttribute('data-theme')") == "parchment"
            assert page.evaluate("document.documentElement.lang") == "en"

            persisted = page.evaluate(
                """async () => {
                    const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
                    const nStore = DivinationCardNotesStore.createStore({
                        isKnownCard: (deck, id) => {
                            const list = deck === "tarot" ? tarotDeckFull : deck === "mystagogus" ? mystagogusDeckFull : lxxxiDeckFull;
                            return list.some(c => c.id === id);
                        }
                    });
                    const aStore = DivinationAiChatStore.createStore();
                    const [readings, notes, chats] = await Promise.all([
                        hStore.listRecords("all"),
                        nStore.list(),
                        aStore.listConversations({ archived: "all" })
                    ]);
                    return {
                        readings: readings.length,
                        question: readings[0] && readings[0].question,
                        reflection: readings[0] && readings[0].reflection,
                        notes: notes.length,
                        noteText: notes[0] && notes[0].text,
                        spreadNames: DivinationCustomSpreadUi.list().map(s => s.name),
                        chats: chats.length
                    };
                }"""
            )
            assert persisted["readings"] == 1, (label, persisted)
            assert persisted["question"] == QUESTION_TEXT, (label, persisted)
            assert persisted["reflection"] == REFLECTION_TEXT, (label, persisted)
            assert persisted["notes"] == 1, (label, persisted)
            assert persisted["noteText"] == NOTE_XSS, (label, persisted)
            assert persisted["chats"] == 1, (label, persisted)
            if android:
                assert set(persisted["spreadNames"]) == {"全量备份测试牌阵", "新建牌阵B"}, (label, persisted)
            else:
                # Web custom spreads are session-only by design.
                assert persisted["spreadNames"] == [], (label, persisted)

            # Code-review regression checks:
            # 1) All-failed restore & retry; 2) Partial-failed restore & one-click retry;
            # 3) ID-collision history remap -> AI chat link rewrite + idempotent retry;
            # 4) export_too_large blocks download/save picker & names oversized module.
            verify_review_regressions(page, android, classic, label, exported_json, file_name)

            # Second-pass deep data-integrity & concurrency regressions (#17/#18):
            # 1) Out-of-range 1.8e18 timestamp rejected fail-closed;
            # 2) QuotaExceededError on preferences fails cleanly & retries;
            # 3) aiChats-only before colliding history + 5000-cap history failure defer aiChats;
            # 4) Two independent identical-content history IDs survive with both AI chat links;
            # 5) Real two-tab concurrent restore of ID-conflicting backup produces zero duplicates.
            verify_second_pass_regressions(page, context, url, android, classic, label, exported_json, file_name)

            # Final PR #52 edge-case regressions (#26/#27):
            # 1) Deleted-history aiChats collision detaches safely & preserves backup snapshot;
            # 2) historyStore read failure blocks aiChats-only restore (history_check_failed);
            # 3) Deleting original colliding local reading then re-restoring reuses reading-remap-* without duplicating.
            verify_final_edge_cases(page, android, classic, label)

            assert not page_errors, (label, page_errors)
            assert not console_errors, (label, console_errors)
            assert not external_requests, (label, external_requests)
            print(f"PASS {label}", flush=True)
        finally:
            context.close()


def verify_review_regressions(page, android, classic, label, exported_json, file_name):
    # Clear history + cardNotes + aiChats so regression assertions start clean.
    page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            await hStore.clearRecords();
            const nStore = DivinationCardNotesStore.createStore({
                isKnownCard: (deck, id) => {
                    const list = deck === "tarot" ? tarotDeckFull : deck === "mystagogus" ? mystagogusDeckFull : lxxxiDeckFull;
                    return list.some(c => c.id === id);
                }
            });
            for (const row of await nStore.list()) {
                await nStore.save(row.deckType, row.cardId, "", row.text);
            }
            const aStore = DivinationAiChatStore.createStore();
            await aStore.clearConversations();
        }"""
    )

    open_backup_dialog(page, android, classic)

    # 1) All-failed restore: force cardNotes store to fail -> error styling, preview stays open & retryable.
    page.evaluate(
        """() => {
            window.__origCardNotesCreateStore = DivinationCardNotesStore.createStore;
            DivinationCardNotesStore.createStore = () => ({
                async list() { throw new Error("Simulated IndexedDB open failure"); },
                async keys() { throw new Error("Simulated IndexedDB open failure"); },
                async importBackup() { throw new Error("Simulated IndexedDB open failure"); },
                async exportBackup() { throw new Error("Simulated IndexedDB open failure"); }
            });
        }"""
    )
    page.locator("#fullBackupImportInput").set_input_files({
        "name": file_name,
        "mimeType": "application/json",
        "buffer": exported_json.encode("utf-8"),
    })
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    for sec in ("history", "customSpreads", "aiChats", "preferences"):
        page.locator(f'#fullBackupPreviewList input[data-backup-section="{sec}"]').uncheck()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator("#fullBackupStatus")).not_to_have_class(re.compile(r"\bis-success\b"))
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    expect(page.locator('#fullBackupPreviewList input[data-backup-section="cardNotes"]')).to_be_checked()
    expect(page.locator("#fullBackupConfirmBtn")).to_be_enabled()
    expect(page.locator("#fullBackupSummary")).to_be_visible()
    expect(page.locator("#fullBackupSummary")).to_have_class(re.compile(r"\bis-error\b"))
    assert_no_overflow(page, label + " all-failed restore preview")

    # Restore real cardNotes store and click Confirm directly (without re-picking the file).
    page.evaluate("() => { DivinationCardNotesStore.createStore = window.__origCardNotesCreateStore; }")
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-success\b"))
    expect(page.locator("#fullBackupPreview")).to_be_hidden()
    expect(page.locator("#fullBackupSummary")).not_to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator('[data-backup-count-section="cardNotes"]')).to_contain_text("1")

    # 2) Partial-failed restore: clear notes again, fail cardNotes while history succeeds -> ONLY cardNotes stays checked!
    page.evaluate(
        """async () => {
            const nStore = DivinationCardNotesStore.createStore({
                isKnownCard: (deck, id) => {
                    const list = deck === "tarot" ? tarotDeckFull : deck === "mystagogus" ? mystagogusDeckFull : lxxxiDeckFull;
                    return list.some(c => c.id === id);
                }
            });
            for (const row of await nStore.list()) {
                await nStore.save(row.deckType, row.cardId, "", row.text);
            }
            DivinationCardNotesStore.createStore = () => ({
                async list() { throw new Error("Simulated notes quota error"); },
                async keys() { throw new Error("Simulated notes quota error"); },
                async importBackup() { throw new Error("Simulated notes quota error"); },
                async exportBackup() { throw new Error("Simulated notes quota error"); }
            });
        }"""
    )
    page.locator("#fullBackupImportInput").set_input_files({
        "name": file_name,
        "mimeType": "application/json",
        "buffer": exported_json.encode("utf-8"),
    })
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    for sec in ("customSpreads", "aiChats", "preferences"):
        page.locator(f'#fullBackupPreviewList input[data-backup-section="{sec}"]').uncheck()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator("#fullBackupStatus")).not_to_have_class(re.compile(r"\bis-success\b"))
    expect(page.locator("#fullBackupSummary")).to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator("#fullBackupSummaryList li")).to_have_count(2)
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    expect(page.locator('#fullBackupPreviewList input[data-backup-section="history"]')).not_to_be_checked()
    expect(page.locator('#fullBackupPreviewList input[data-backup-section="cardNotes"]')).to_be_checked()
    expect(page.locator('[data-backup-count-section="history"]')).to_contain_text("1")

    # One-click retry restores only the failed cardNotes section and closes preview cleanly.
    page.evaluate("() => { DivinationCardNotesStore.createStore = window.__origCardNotesCreateStore; }")
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-success\b"))
    expect(page.locator("#fullBackupPreview")).to_be_hidden()
    expect(page.locator('[data-backup-count-section="cardNotes"]')).to_contain_text("1")

    # 3) ID-collision history remap -> AI chat links rewritten to remapped ID, and retrying backup does NOT duplicate!
    collision_json = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            await hStore.clearRecords();
            const aStore = DivinationAiChatStore.createStore();
            await aStore.clearConversations();

            const backupRec = DivinationHistoryRecords.buildReadingRecord({
                id: "reading-collision-1",
                createdAt: "2026-11-28T06:00:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: "备份新记录：冲突测试",
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[0] },
                    { slotIndex: 1, orientation: "reversed", layer: null, card: tarotDeckFull[1] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[2] }
                ]
            });
            await hStore.saveRecord(backupRec);
            await aStore.createConversation({
                id: "chat-collision-1",
                title: "冲突重映射测试对话",
                createdAt: 1795842000000,
                updatedAt: 1795842060000,
                archived: false,
                pinned: false,
                skillMode: "auto",
                readingIds: ["reading-collision-1"],
                readingSnapshots: [{
                    id: "reading-collision-1",
                    layoutMode: "preset",
                    deckType: "tarot",
                    spreadId: "three-card-horizontal",
                    spreadName: "三张牌阵",
                    positionCount: 3,
                    orientationMode: "mixed",
                    filterMode: "mixed",
                    overviewMethod: "not-applicable",
                    createdAt: 1795842000000,
                    question: "备份新记录：冲突测试",
                    cards: [{
                        slotIndex: 0,
                        positionNumber: 1,
                        positionName: "过去",
                        cardId: tarotDeckFull[0].id,
                        cardName: tarotDeckFull[0].name,
                        orientation: "upright"
                    }]
                }],
                messages: [
                    { id: "mc-1", role: "user", content: "请解读冲突记录", createdAt: 1795842000000 },
                    { id: "mc-2", role: "assistant", content: "已解读备份记录。", createdAt: 1795842050000, interpretedReadingIds: ["reading-collision-1"] }
                ]
            });

            const exported = await DivinationFullBackup.collectBackup({
                historyStore: hStore,
                historyRecords: DivinationHistoryRecords,
                cardNotesStore: null,
                customSpreadsLibrary: null,
                aiChatStore: aStore,
                aiChatStoreApi: DivinationAiChatStore,
                themeApi: null,
                i18nApi: null
            });

            // Now replace local state with a DIFFERENT reading sharing the exact same ID "reading-collision-1".
            await hStore.clearRecords();
            await aStore.clearConversations();
            const localRec = DivinationHistoryRecords.buildReadingRecord({
                id: "reading-collision-1",
                createdAt: "2026-11-20T05:00:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: "本地原记录：冲突测试",
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[5] },
                    { slotIndex: 1, orientation: "upright", layer: null, card: tarotDeckFull[6] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[7] }
                ]
            });
            await hStore.saveRecord(localRec);
            return exported.json;
        }"""
    )

    page.locator("#fullBackupImportInput").set_input_files({
        "name": "collision-backup.json",
        "mimeType": "application/json",
        "buffer": collision_json.encode("utf-8"),
    })
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-success\b"))

    remap_state = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            const aStore = DivinationAiChatStore.createStore();
            const records = await hStore.listRecords("all");
            const chats = await aStore.listConversations({ archived: "all" });
            const localRec = records.find(r => r.id === "reading-collision-1");
            const importedRec = records.find(r => r.question === "备份新记录：冲突测试");
            const chat = chats.find(c => c.id === "chat-collision-1");
            return {
                recordCount: records.length,
                localQuestion: localRec && localRec.question,
                remappedId: importedRec && importedRec.id,
                chatReadingIds: chat && chat.readingIds,
                snapshotId: chat && chat.readingSnapshots && chat.readingSnapshots[0] && chat.readingSnapshots[0].id,
                interpretedIds: chat && chat.messages && chat.messages[1] && chat.messages[1].interpretedReadingIds
            };
        }"""
    )
    assert remap_state["recordCount"] == 2, (label, remap_state)
    assert remap_state["localQuestion"] == "本地原记录：冲突测试", (label, remap_state)
    remapped_id = remap_state["remappedId"]
    assert remapped_id and remapped_id != "reading-collision-1", (label, remap_state)
    assert remap_state["chatReadingIds"] == [remapped_id], (label, remap_state)
    assert remap_state["snapshotId"] == remapped_id, (label, remap_state)
    assert remap_state["interpretedIds"] == [remapped_id], (label, remap_state)

    # Retrying the same ID-conflicting backup must NOT duplicate the remapped reading.
    page.locator("#fullBackupImportInput").set_input_files({
        "name": "collision-backup.json",
        "mimeType": "application/json",
        "buffer": collision_json.encode("utf-8"),
    })
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-success\b"))
    retry_count = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            return (await hStore.listRecords("all")).length;
        }"""
    )
    assert retry_count == 2, (label, retry_count)

    # 4) export_too_large: create an >8 MiB aiChats store -> blocks download / Android save picker & names oversized module.
    page.evaluate(
        """async () => {
            const aStore = DivinationAiChatStore.createStore();
            const chunk = "x".repeat(500000);
            const messages = [];
            for (let i = 0; i < 18; i += 1) {
                messages.push({ id: "big-" + i, role: i % 2 === 0 ? "user" : "assistant", content: chunk, createdAt: 1795842000000 + i });
            }
            await aStore.createConversation({
                id: "chat-oversize-e2e",
                title: "Oversize chat",
                createdAt: 1795842000000,
                updatedAt: 1795842090000,
                archived: false,
                pinned: false,
                skillMode: "auto",
                readingIds: [],
                readingSnapshots: [],
                messages
            });
            window.__webObjectUrlCalls = 0;
            window.__origCreateObjectURL = URL.createObjectURL;
            URL.createObjectURL = function () {
                window.__webObjectUrlCalls += 1;
                return window.__origCreateObjectURL.apply(URL, arguments);
            };
            window.__testExportSaveCallsBeforeOversize = window.__testExportSaveCalls || 0;
        }"""
    )
    page.locator("#fullBackupExportBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator("#fullBackupStatus")).not_to_have_class(re.compile(r"\bis-success\b"))
    expect(page.locator("#fullBackupStatus")).to_contain_text("AI Chats")
    expect(page.locator("#fullBackupStatus")).to_contain_text("MiB")
    assert page.evaluate("window.__webObjectUrlCalls") == 0, label
    if android:
        assert page.evaluate("window.__testExportSaveCalls === window.__testExportSaveCallsBeforeOversize") is True, label
    assert_no_overflow(page, label + " export_too_large error")

    page.evaluate("() => { URL.createObjectURL = window.__origCreateObjectURL; }")
    close_backup_dialog(page, android)


def verify_second_pass_regressions(page, context, url, android, classic, label, exported_json, file_name):
    # Clean stores and remove the huge oversize chat from previous check.
    page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            await hStore.clearRecords();
            const aStore = DivinationAiChatStore.createStore();
            await aStore.clearConversations();
            DivinationTheme.setTheme("celestial");
            DivinationI18n.setLocale("zh-CN");
        }"""
    )

    open_backup_dialog(page, android, classic)

    # A) Out-of-range numeric timestamp (1.8e18) rejected fail-closed at parse/preview stage.
    bad_ts_bundle = json.loads(exported_json)
    bad_ts_bundle["sections"]["aiChats"]["conversations"][0]["updatedAt"] = 1.8e18
    bad_ts_bundle["sections"]["aiChats"]["conversations"][0]["messages"] = []
    page.locator("#fullBackupImportInput").set_input_files({
        "name": "bad-timestamp.json",
        "mimeType": "application/json",
        "buffer": json.dumps(bad_ts_bundle).encode("utf-8"),
    })
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator("#fullBackupPreview")).to_be_hidden()

    # B) QuotaExceededError on localStorage.setItem when restoring preferences -> error status, preview open, retries cleanly.
    page.evaluate(
        """() => {
            window.__origStorageSetItem = Storage.prototype.setItem;
            Storage.prototype.setItem = function (k, v) {
                if (k === "quareia-divination-theme" || k === "quareia-divination-locale") {
                    throw new DOMException("QuotaExceededError", "QuotaExceededError");
                }
                return window.__origStorageSetItem.call(this, k, v);
            };
        }"""
    )
    page.locator("#fullBackupImportInput").set_input_files({
        "name": file_name,
        "mimeType": "application/json",
        "buffer": exported_json.encode("utf-8"),
    })
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    for sec in ("history", "cardNotes", "customSpreads", "aiChats"):
        page.locator(f'#fullBackupPreviewList input[data-backup-section="{sec}"]').uncheck()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator("#fullBackupStatus")).not_to_have_class(re.compile(r"\bis-success\b"))
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    expect(page.locator('#fullBackupPreviewList input[data-backup-section="preferences"]')).to_be_checked()
    expect(page.locator("#fullBackupSummary")).to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator('#fullBackupSummaryList [data-backup-failure-code="preferences_persist_failed"]')).to_have_count(1)
    assert page.evaluate("localStorage.getItem('quareia-divination-theme')") == "celestial", label

    # Lift storage quota error and retry directly without re-picking file.
    page.evaluate("() => { Storage.prototype.setItem = window.__origStorageSetItem; }")
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-success\b"))
    expect(page.locator("#fullBackupPreview")).to_be_hidden()
    assert page.evaluate("localStorage.getItem('quareia-divination-theme')") == "parchment", label
    assert page.evaluate("localStorage.getItem('quareia-divination-locale')") == "en", label

    # C) Colliding history + AI chats dependency guard:
    #    C1) aiChats-only before colliding history -> history_dependency_required (0 chats written).
    #    C2) history + aiChats when MAX_RECORDS cap hit -> history fails & aiChats deferred (history_dependency_failed, 0 chats written).
    #    C3) Lift cap and click Confirm directly -> both succeed and chat links to remapped ID!
    dep_json = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            await hStore.clearRecords();
            const aStore = DivinationAiChatStore.createStore();
            await aStore.clearConversations();

            const backupRec = DivinationHistoryRecords.buildReadingRecord({
                id: "shared-dep-1",
                createdAt: "2026-11-28T07:00:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: "备份依赖测试记录",
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[0] },
                    { slotIndex: 1, orientation: "upright", layer: null, card: tarotDeckFull[1] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[2] }
                ]
            });
            await hStore.saveRecord(backupRec);
            await aStore.createConversation({
                id: "chat-dep-1",
                title: "依赖保护测试对话",
                createdAt: 1795842100000,
                updatedAt: 1795842160000,
                archived: false,
                pinned: false,
                skillMode: "auto",
                readingIds: ["shared-dep-1"],
                readingSnapshots: [{
                    id: "shared-dep-1",
                    layoutMode: "preset",
                    deckType: "tarot",
                    spreadId: "three-card-horizontal",
                    spreadName: "三张牌阵",
                    positionCount: 3,
                    orientationMode: "mixed",
                    filterMode: "mixed",
                    overviewMethod: "not-applicable",
                    createdAt: 1795842100000,
                    question: "备份依赖测试记录",
                    cards: [{
                        slotIndex: 0,
                        positionNumber: 1,
                        positionName: "过去",
                        cardId: tarotDeckFull[0].id,
                        cardName: tarotDeckFull[0].name,
                        orientation: "upright"
                    }]
                }],
                messages: [
                    { id: "md-1", role: "user", content: "依赖测试提问", createdAt: 1795842100000 },
                    { id: "md-2", role: "assistant", content: "依赖测试回答", createdAt: 1795842150000, interpretedReadingIds: ["shared-dep-1"] }
                ]
            });

            const exported = await DivinationFullBackup.collectBackup({
                historyStore: hStore,
                historyRecords: DivinationHistoryRecords,
                cardNotesStore: null,
                customSpreadsLibrary: null,
                aiChatStore: aStore,
                aiChatStoreApi: DivinationAiChatStore,
                themeApi: null,
                i18nApi: null
            });

            await hStore.clearRecords();
            await aStore.clearConversations();
            const localRec = DivinationHistoryRecords.buildReadingRecord({
                id: "shared-dep-1",
                createdAt: "2026-11-21T07:00:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: "本地已有冲突记录",
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[5] },
                    { slotIndex: 1, orientation: "upright", layer: null, card: tarotDeckFull[6] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[7] }
                ]
            });
            await hStore.saveRecord(localRec);
            return exported.json;
        }"""
    )

    # C1: aiChats-only before colliding history -> blocked with history_dependency_required
    page.locator("#fullBackupImportInput").set_input_files({
        "name": "dep-backup.json",
        "mimeType": "application/json",
        "buffer": dep_json.encode("utf-8"),
    })
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    page.locator('#fullBackupPreviewList input[data-backup-section="history"]').uncheck()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    expect(page.locator('#fullBackupSummaryList [data-backup-failure-code="history_dependency_required"]')).to_have_count(1)
    assert page.evaluate("async () => (await DivinationAiChatStore.createStore().listConversations({ archived: 'all' })).length") == 0, label

    # C2: check history too, but simulate hitting MAX_RECORDS cap -> history fails AND aiChats is deferred (history_dependency_failed)!
    page.evaluate(
        """() => {
            window.__origMaxRecords = DivinationHistoryRecords.MAX_RECORDS;
            DivinationHistoryRecords.MAX_RECORDS = 1;
        }"""
    )
    page.locator('#fullBackupPreviewList input[data-backup-section="history"]').check()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    expect(page.locator('#fullBackupPreviewList input[data-backup-section="history"]')).to_be_checked()
    expect(page.locator('#fullBackupPreviewList input[data-backup-section="aiChats"]')).to_be_checked()
    expect(page.locator('#fullBackupSummaryList [data-backup-failure-code="history_dependency_failed"]')).to_have_count(1)
    assert page.evaluate("async () => (await DivinationAiChatStore.createStore().listConversations({ archived: 'all' })).length") == 0, label

    # C3: restore MAX_RECORDS and retry directly -> both succeed with exact remapped ID!
    page.evaluate("() => { DivinationHistoryRecords.MAX_RECORDS = window.__origMaxRecords; }")
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-success\b"))
    expect(page.locator("#fullBackupPreview")).to_be_hidden()
    dep_after = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            const aStore = DivinationAiChatStore.createStore();
            const records = await hStore.listRecords("all");
            const chats = await aStore.listConversations({ archived: "all" });
            const imported = records.find(r => r.question === "备份依赖测试记录");
            const chat = chats.find(c => c.id === "chat-dep-1");
            return {
                count: records.length,
                remappedId: imported && imported.id,
                chatReadingIds: chat && chat.readingIds,
                snapshotId: chat && chat.readingSnapshots && chat.readingSnapshots[0] && chat.readingSnapshots[0].id,
                interpretedIds: chat && chat.messages && chat.messages[1] && chat.messages[1].interpretedReadingIds
            };
        }"""
    )
    assert dep_after["count"] == 2, (label, dep_after)
    assert dep_after["remappedId"] and dep_after["remappedId"] != "shared-dep-1", (label, dep_after)
    assert dep_after["chatReadingIds"] == [dep_after["remappedId"]], (label, dep_after)
    assert dep_after["snapshotId"] == dep_after["remappedId"], (label, dep_after)
    assert dep_after["interpretedIds"] == [dep_after["remappedId"]], (label, dep_after)

    # D) Two independent history IDs (r1, r2) with identical createdAt + cards attached to one AI chat:
    #    Restoring on a device holding r1 must keep BOTH r1 & r2 and BOTH AI chat attachments!
    twin_json = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            await hStore.clearRecords();
            const aStore = DivinationAiChatStore.createStore();
            await aStore.clearConversations();

            const common = {
                createdAt: "2026-11-28T07:30:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: "相同内容双独立ID",
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[2] },
                    { slotIndex: 1, orientation: "upright", layer: null, card: tarotDeckFull[3] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[4] }
                ]
            };
            const r1 = DivinationHistoryRecords.buildReadingRecord(Object.assign({ id: "twin-r1" }, common));
            const r2 = DivinationHistoryRecords.buildReadingRecord(Object.assign({ id: "twin-r2" }, common));
            await hStore.importRecords([r1, r2]);
            await aStore.createConversation({
                id: "chat-twin-1",
                title: "双附件对话",
                createdAt: 1795842200000,
                updatedAt: 1795842260000,
                archived: false,
                pinned: false,
                skillMode: "auto",
                readingIds: ["twin-r1", "twin-r2"],
                readingSnapshots: [
                    {
                        id: "twin-r1", layoutMode: "preset", deckType: "tarot",
                        spreadId: "three-card-horizontal", spreadName: "三张牌阵", positionCount: 3,
                        orientationMode: "mixed", filterMode: "mixed", overviewMethod: "not-applicable",
                        createdAt: 1795842200000, question: "相同内容双独立ID",
                        cards: [{ slotIndex: 0, positionNumber: 1, positionName: "过去", cardId: tarotDeckFull[2].id, cardName: tarotDeckFull[2].name, orientation: "upright" }]
                    },
                    {
                        id: "twin-r2", layoutMode: "preset", deckType: "tarot",
                        spreadId: "three-card-horizontal", spreadName: "三张牌阵", positionCount: 3,
                        orientationMode: "mixed", filterMode: "mixed", overviewMethod: "not-applicable",
                        createdAt: 1795842200000, question: "相同内容双独立ID",
                        cards: [{ slotIndex: 0, positionNumber: 1, positionName: "过去", cardId: tarotDeckFull[2].id, cardName: tarotDeckFull[2].name, orientation: "upright" }]
                    }
                ],
                messages: [
                    { id: "mt-1", role: "user", content: "对比这两条记录", createdAt: 1795842200000 },
                    { id: "mt-2", role: "assistant", content: "两条均保留。", createdAt: 1795842250000, interpretedReadingIds: ["twin-r1", "twin-r2"] }
                ]
            });

            const exported = await DivinationFullBackup.collectBackup({
                historyStore: hStore,
                historyRecords: DivinationHistoryRecords,
                cardNotesStore: null,
                customSpreadsLibrary: null,
                aiChatStore: aStore,
                aiChatStoreApi: DivinationAiChatStore,
                themeApi: null,
                i18nApi: null
            });

            // Device already holds ONLY twin-r1.
            await hStore.clearRecords();
            await aStore.clearConversations();
            await hStore.saveRecord(r1);
            return exported.json;
        }"""
    )
    page.locator("#fullBackupImportInput").set_input_files({
        "name": "twin-backup.json",
        "mimeType": "application/json",
        "buffer": twin_json.encode("utf-8"),
    })
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-success\b"))
    twin_after = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            const aStore = DivinationAiChatStore.createStore();
            const records = await hStore.listRecords("all");
            const chats = await aStore.listConversations({ archived: "all" });
            const chat = chats.find(c => c.id === "chat-twin-1");
            return {
                ids: records.map(r => r.id).sort(),
                chatReadingIds: chat && chat.readingIds.slice().sort(),
                snapshotIds: chat && chat.readingSnapshots.map(s => s.id).sort()
            };
        }"""
    )
    assert twin_after == {
        "ids": ["twin-r1", "twin-r2"],
        "chatReadingIds": ["twin-r1", "twin-r2"],
        "snapshotIds": ["twin-r1", "twin-r2"],
    }, (label, twin_after)

    close_backup_dialog(page, android)

    # E) Real two-tab concurrent restore of the same ID-conflicting backup -> exact 1 local + 1 remapped copy (ZERO duplicates)!
    race_json = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            await hStore.clearRecords();
            const backupRec = DivinationHistoryRecords.buildReadingRecord({
                id: "shared-race-1",
                createdAt: "2026-11-28T08:00:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: "双标签页并发恢复备份",
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[8] },
                    { slotIndex: 1, orientation: "upright", layer: null, card: tarotDeckFull[9] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[10] }
                ]
            });
            await hStore.saveRecord(backupRec);
            const exported = await DivinationFullBackup.collectBackup({
                historyStore: hStore,
                historyRecords: DivinationHistoryRecords,
                cardNotesStore: null,
                customSpreadsLibrary: null,
                aiChatStore: null,
                aiChatStoreApi: null,
                themeApi: null,
                i18nApi: null
            });
            await hStore.clearRecords();
            const localRec = DivinationHistoryRecords.buildReadingRecord({
                id: "shared-race-1",
                createdAt: "2026-11-22T08:00:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: "双标签页并发恢复本地",
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[11] },
                    { slotIndex: 1, orientation: "upright", layer: null, card: tarotDeckFull[12] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[13] }
                ]
            });
            await hStore.saveRecord(localRec);
            return exported.json;
        }"""
    )

    page2 = context.new_page()
    try:
        page2.set_default_timeout(10000)
        page2.goto(url)
        if android:
            dismiss_android_telemetry(page2)

        # Fire restore simultaneously from Tab 1 and Tab 2 against the same IndexedDB!
        page.evaluate(
            """(raw) => {
                const parsed = DivinationFullBackup.parseBackup(raw, { historyRecords: DivinationHistoryRecords });
                const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
                window.__tab1Restore = DivinationFullBackup.restoreBackup(parsed, ["history"], {
                    historyStore: hStore,
                    historyRecords: DivinationHistoryRecords
                });
            }""",
            race_json,
        )
        tab2_res = page2.evaluate(
            """async (raw) => {
                const parsed = DivinationFullBackup.parseBackup(raw, { historyRecords: DivinationHistoryRecords });
                const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
                return DivinationFullBackup.restoreBackup(parsed, ["history"], {
                    historyStore: hStore,
                    historyRecords: DivinationHistoryRecords
                });
            }""",
            race_json,
        )
        tab1_res = page.evaluate("async () => window.__tab1Restore")
        assert tab1_res["status"] == "ok", (label, tab1_res)
        assert tab2_res["status"] == "ok", (label, tab2_res)

        race_after = page.evaluate(
            """async () => {
                const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
                const records = await hStore.listRecords("all");
                return {
                    count: records.length,
                    questions: records.map(r => r.question).sort()
                };
            }"""
        )
        assert race_after == {
            "count": 2,
            "questions": ["双标签页并发恢复备份", "双标签页并发恢复本地"],
        }, (label, race_after)
    finally:
        page2.close()


def verify_final_edge_cases(page, android, classic, label):
    # 1) Deleted-history aiChats collision detaches safely (shows backup's major-00 snapshot, NOT local major-05)
    # 2) historyStore read failure blocks aiChats-only restore with history_check_failed
    detached_json = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            await hStore.clearRecords();
            const aStore = DivinationAiChatStore.createStore();
            await aStore.clearConversations();

            // Export ONLY aiChats referencing reading "deleted-shared-1" (with major-00 snapshot), NO history section!
            await aStore.createConversation({
                id: "chat-detached-1",
                title: "已删历史碰撞分离测试",
                createdAt: 1795842500000,
                updatedAt: 1795842560000,
                archived: false,
                pinned: false,
                skillMode: "auto",
                readingIds: ["deleted-shared-1"],
                readingSnapshots: [{
                    id: "deleted-shared-1",
                    layoutMode: "preset",
                    deckType: "tarot",
                    spreadId: "three-card-horizontal",
                    spreadName: "三张牌阵",
                    positionCount: 3,
                    orientationMode: "mixed",
                    filterMode: "mixed",
                    overviewMethod: "not-applicable",
                    createdAt: 1795842500000,
                    question: "备份已删历史：愚者",
                    cards: [{
                        slotIndex: 0,
                        positionNumber: 1,
                        positionName: "过去",
                        cardId: tarotDeckFull[0].id,
                        cardName: tarotDeckFull[0].name,
                        orientation: "upright"
                    }]
                }],
                messages: [
                    { id: "mdet-1", role: "user", content: "解读愚者", createdAt: 1795842500000 },
                    { id: "mdet-2", role: "assistant", content: "愚者代表全新起点。", createdAt: 1795842550000, interpretedReadingIds: ["deleted-shared-1"] }
                ]
            });

            const exported = await DivinationFullBackup.collectBackup({
                historyStore: null,
                historyRecords: DivinationHistoryRecords,
                cardNotesStore: null,
                customSpreadsLibrary: null,
                aiChatStore: aStore,
                aiChatStoreApi: DivinationAiChatStore,
                themeApi: null,
                i18nApi: null
            });

            // Now target device has a DIFFERENT local reading at id "deleted-shared-1" (major-05) and 0 chats.
            await aStore.clearConversations();
            const localRec = DivinationHistoryRecords.buildReadingRecord({
                id: "deleted-shared-1",
                createdAt: "2026-11-23T08:00:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: "本地不同历史：教皇",
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[5] },
                    { slotIndex: 1, orientation: "upright", layer: null, card: tarotDeckFull[6] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[7] }
                ]
            });
            await hStore.saveRecord(localRec);
            return exported.json;
        }"""
    )

    open_backup_dialog(page, android, classic)

    # First verify historyStore read failure blocks aiChats-only restore fail-closed with history_check_failed!
    page.evaluate(
        """() => {
            window.__origHistoryCreateStore = DivinationHistoryStore.createStore;
            DivinationHistoryStore.createStore = () => ({
                async listRecords() { throw new Error("Simulated history read failure"); },
                async mergeBackupRecords() { throw new Error("Simulated history read failure"); }
            });
        }"""
    )
    page.locator("#fullBackupImportInput").set_input_files({
        "name": "detached-aichats.json",
        "mimeType": "application/json",
        "buffer": detached_json.encode("utf-8"),
    })
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-error\b"))
    expect(page.locator("#fullBackupStatus")).not_to_have_class(re.compile(r"\bis-success\b"))
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    expect(page.locator('#fullBackupSummaryList [data-backup-failure-code="history_check_failed"]')).to_have_count(1)
    assert page.evaluate("async () => (await DivinationAiChatStore.createStore().listConversations({ archived: 'all' })).length") == 0, label

    # Restore real historyStore and click Confirm directly -> aiChats detaches safely from local major-05!
    page.evaluate("() => { DivinationHistoryStore.createStore = window.__origHistoryCreateStore; }")
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-success\b"))
    expect(page.locator("#fullBackupPreview")).to_be_hidden()

    detached_after = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            const aStore = DivinationAiChatStore.createStore();
            const records = await hStore.listRecords("all");
            const chats = await aStore.listConversations({ archived: "all" });
            const chat = chats.find(c => c.id === "chat-detached-1");
            const snap = chat && chat.readingSnapshots && chat.readingSnapshots[0];
            return {
                localIds: records.map(r => r.id),
                localCard0: records[0] && records[0].cards && records[0].cards[0] && records[0].cards[0].cardId,
                chatReadingIds: chat && chat.readingIds,
                snapshotId: snap && snap.id,
                snapshotCard0: snap && snap.cards && snap.cards[0] && snap.cards[0].cardId,
                interpretedIds: chat && chat.messages && chat.messages[1] && chat.messages[1].interpretedReadingIds
            };
        }"""
    )
    assert detached_after["localIds"] == ["deleted-shared-1"], (label, detached_after)
    assert detached_after["localCard0"] == "major-05", (label, detached_after)
    detached_id = detached_after["chatReadingIds"][0]
    assert detached_id and detached_id != "deleted-shared-1", (label, detached_after)
    assert detached_after["chatReadingIds"] == [detached_id], (label, detached_after)
    assert detached_after["snapshotId"] == detached_id, (label, detached_after)
    assert detached_after["snapshotCard0"] == "major-00", (label, detached_after)
    assert detached_after["interpretedIds"] == [detached_id], (label, detached_after)

    # 3) Delete original colliding local reading after remap, then re-restore history + aiChats -> reuses reading-remap-* with ZERO duplicates!
    del_remap_json = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            await hStore.clearRecords();
            const aStore = DivinationAiChatStore.createStore();
            await aStore.clearConversations();

            const backupRec = DivinationHistoryRecords.buildReadingRecord({
                id: "shared-del-1",
                createdAt: "2026-11-28T09:00:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: "删原记录后复用重映射",
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[0] },
                    { slotIndex: 1, orientation: "upright", layer: null, card: tarotDeckFull[1] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[2] }
                ]
            });
            await hStore.saveRecord(backupRec);
            await aStore.createConversation({
                id: "chat-del-1",
                title: "复用重映射对话",
                createdAt: 1795842600000,
                updatedAt: 1795842660000,
                archived: false,
                pinned: false,
                skillMode: "auto",
                readingIds: ["shared-del-1"],
                readingSnapshots: [{
                    id: "shared-del-1",
                    layoutMode: "preset",
                    deckType: "tarot",
                    spreadId: "three-card-horizontal",
                    spreadName: "三张牌阵",
                    positionCount: 3,
                    orientationMode: "mixed",
                    filterMode: "mixed",
                    overviewMethod: "not-applicable",
                    createdAt: 1795842600000,
                    question: "删原记录后复用重映射",
                    cards: [{
                        slotIndex: 0,
                        positionNumber: 1,
                        positionName: "过去",
                        cardId: tarotDeckFull[0].id,
                        cardName: tarotDeckFull[0].name,
                        orientation: "upright"
                    }]
                }],
                messages: [
                    { id: "mdel-1", role: "user", content: "提问", createdAt: 1795842600000 },
                    { id: "mdel-2", role: "assistant", content: "回答", createdAt: 1795842650000, interpretedReadingIds: ["shared-del-1"] }
                ]
            });

            const exported = await DivinationFullBackup.collectBackup({
                historyStore: hStore,
                historyRecords: DivinationHistoryRecords,
                cardNotesStore: null,
                customSpreadsLibrary: null,
                aiChatStore: aStore,
                aiChatStoreApi: DivinationAiChatStore,
                themeApi: null,
                i18nApi: null
            });

            // Seed colliding local reading at "shared-del-1" (major-05)
            await hStore.clearRecords();
            await aStore.clearConversations();
            const localRec = DivinationHistoryRecords.buildReadingRecord({
                id: "shared-del-1",
                createdAt: "2026-11-24T09:00:00.000Z",
                deckType: "tarot",
                deckMode: "tarot",
                deckName: "RWS 塔罗",
                spreadId: "three-card-horizontal",
                spreadName: "三张牌阵",
                orientationMode: "mixed",
                filterMode: "mixed",
                overviewMethod: "not-applicable",
                question: "稍后将被删除的本地记录",
                positions: [
                    { number: 1, name: "过去", nameEn: "Past" },
                    { number: 2, name: "现在", nameEn: "Present" },
                    { number: 3, name: "未来", nameEn: "Future" }
                ],
                entries: [
                    { slotIndex: 0, orientation: "upright", layer: null, card: tarotDeckFull[5] },
                    { slotIndex: 1, orientation: "upright", layer: null, card: tarotDeckFull[6] },
                    { slotIndex: 2, orientation: "upright", layer: null, card: tarotDeckFull[7] }
                ]
            });
            await hStore.saveRecord(localRec);
            return exported.json;
        }"""
    )

    # Restore #1: remaps backup "shared-del-1" -> reading-remap-*
    page.locator("#fullBackupImportInput").set_input_files({
        "name": "del-remap-backup.json",
        "mimeType": "application/json",
        "buffer": del_remap_json.encode("utf-8"),
    })
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-success\b"))

    first_remap_id = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            const aStore = DivinationAiChatStore.createStore();
            const records = await hStore.listRecords("all");
            const remapped = records.find(r => r.question === "删原记录后复用重映射");
            // Delete the original colliding local record AND clear chats!
            await hStore.deleteRecord("shared-del-1");
            await aStore.clearConversations();
            return remapped && remapped.id;
        }"""
    )
    assert first_remap_id and first_remap_id.startswith("reading-remap-"), (label, first_remap_id)

    # Restore #2: MUST recognize & reuse reading-remap-* (count stays 1, NO duplicate at "shared-del-1", chat links to reading-remap-*)!
    page.locator("#fullBackupImportInput").set_input_files({
        "name": "del-remap-backup.json",
        "mimeType": "application/json",
        "buffer": del_remap_json.encode("utf-8"),
    })
    expect(page.locator("#fullBackupPreview")).to_be_visible()
    page.locator("#fullBackupConfirmBtn").click()
    expect(page.locator("#fullBackupStatus")).to_have_class(re.compile(r"\bis-success\b"))

    after_second = page.evaluate(
        """async () => {
            const hStore = DivinationHistoryStore.createStore({ recordsApi: DivinationHistoryRecords });
            const aStore = DivinationAiChatStore.createStore();
            const records = await hStore.listRecords("all");
            const chats = await aStore.listConversations({ archived: "all" });
            const chat = chats.find(c => c.id === "chat-del-1");
            return {
                recordIds: records.map(r => r.id),
                chatReadingIds: chat && chat.readingIds,
                snapshotId: chat && chat.readingSnapshots && chat.readingSnapshots[0] && chat.readingSnapshots[0].id,
                interpretedIds: chat && chat.messages && chat.messages[1] && chat.messages[1].interpretedReadingIds
            };
        }"""
    )
    assert after_second == {
        "recordIds": [first_remap_id],
        "chatReadingIds": [first_remap_id],
        "snapshotId": first_remap_id,
        "interpretedIds": [first_remap_id],
    }, (label, after_second)

    close_backup_dialog(page, android)


def run_surface(pw, root_dir, android):
    with ThreadedServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(root_dir))) as server:
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_port}"
        try:
            for classic, width in ((False, 360), (False, 1280), (True, 360), (True, 1280)):
                run_scenario(pw, base, android, classic, width)
        finally:
            server.shutdown()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--web-only", action="store_true")
    parser.add_argument("--android-only", action="store_true")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[1]
    android_root = repo_root / "android-demo/app/src/main/assets/www"

    with sync_playwright() as pw:
        if not args.android_only:
            run_surface(pw, repo_root, android=False)
        if not args.web_only:
            run_surface(pw, android_root, android=True)


if __name__ == "__main__":
    main()
