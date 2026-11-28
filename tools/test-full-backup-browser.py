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
                window.androidHistoryExport = {
                    save(content, name) {
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

            assert not page_errors, (label, page_errors)
            assert not console_errors, (label, console_errors)
            assert not external_requests, (label, external_requests)
            print(f"PASS {label}", flush=True)
        finally:
            context.close()


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
