"""AI persistence/streaming browser regression against a loopback-only fake provider.

Requires Python 3.11+ and playwright with Chrome installed.
Run: python tools/test-ai-browser.py [--android] [--output /path/to/evidence]
     [--browser-executable /path/to/chrome]
Every scenario uses a disposable browser context. No real API key is used.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--android", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--browser-executable", type=Path)
    args = parser.parse_args(argv)
    root = Path(__file__).resolve().parents[1]
    if args.android:
        root /= "android-demo/app/src/main/assets/www"
    gate = threading.Event()
    seen = []
    bodies = []
    compatibility_bodies = []
    errors = []
    results = {}

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            data = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            model = data.get("model", "")
            if model in ("gpt-6.1-sol", "opaque-modern", "gpt-6.1-legacy", "opaque-nonstream", "opaque-policy-rejection"):
                compatibility_bodies.append(data)
                error = None
                if model in ("gpt-6.1-sol", "opaque-modern") and "max_tokens" in data:
                    error = {"code": "unsupported_parameter", "param": "max_tokens", "message": "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."}
                elif model == "opaque-modern" and "temperature" in data:
                    error = {"code": "unsupported_value", "param": "temperature", "message": "Unsupported value: 'temperature' does not support 0.4 with this model. Only the default (1) value is supported."}
                elif model == "gpt-6.1-legacy" and "max_completion_tokens" in data:
                    error = {"code": "unsupported_parameter", "param": "max_completion_tokens", "message": "Unsupported parameter: max_completion_tokens"}
                elif model == "opaque-nonstream" and "stream" in data:
                    error = {"code": "unsupported_parameter", "param": "stream", "message": "Unsupported parameter: stream"}
                elif model == "opaque-policy-rejection":
                    error = {"code": "content_policy_violation", "message": "Rejected user input: Unsupported parameter: max_tokens"}
                if error:
                    body = json.dumps({"error": error}).encode()
                    self.send_response(400)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                    return
            # Pending empty assistant messages are omitted from API requests,
            # so consecutive user turns may be joined with two newlines. Route
            # this fake service by the newest fixture prompt, but retain the
            # full request in bodies for assertions about the actual payload.
            question = data["messages"][-1]["content"].rsplit("\n\n", 1)[-1]
            seen.append(question)
            bodies.append(data)
            if model == "opaque-nonstream":
                body = json.dumps({"choices": [{"message": {"content": "answer " + question + " complete"}, "finish_reason": "stop"}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            slow = question.startswith("slow") and seen.count(question) == 1
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.end_headers()
            try:
                self.wfile.write(b"trace-id: local-fixture\r\n\r\n")
                chunks = ["answer " + question]
                if question != "interrupted-fixture":
                    chunks.append(" complete")
                # Fixture turns that represent a real interpretation name a card of
                # the attached record; the reading-state machine only counts a
                # reply as having read a record when it shows such evidence.
                reading_answers = {
                    "review-new-reading": "\n\n第一张是正位的愚者，落在现状位，说的是还没出发。",
                    "reading-fixture": "\n\n第一张是正位的愚者，落在现状位，说的是还没出发。",
                }
                clarification_answers = {
                    "clarify-fixture": "\n\n在看牌面之前，你想先聊哪件事？",
                }
                extra = reading_answers.get(question) or clarification_answers.get(question)
                if extra:
                    chunks.append(extra)
                for i, chunk in enumerate(chunks):
                    # Multiline CRLF SSE is valid even when split between CR and LF.
                    payload = json.dumps({"choices": [{"delta": {"content": chunk}}]})
                    frame = "data: {\r\ndata: " + payload[1:] + "\r\n\r\n"
                    for part in [frame[:7], frame[7:]]:
                        self.wfile.write(part.encode())
                        self.wfile.flush()
                    if slow and i == 0:
                        if not gate.wait(20):
                            raise TimeoutError("Test did not release slow provider")
                if question == "truncated-fixture":
                    ending = {"choices": [{"delta": {}, "finish_reason": "length"}]}
                    self.wfile.write(("data: " + json.dumps(ending) + "\r\n\r\n").encode())
                if question != "interrupted-fixture":
                    self.wfile.write(b"data: [DONE]\r\n\r\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass

    class Server(ThreadingHTTPServer):
        request_queue_size = 128

    server = Server(("127.0.0.1", 0), partial(Handler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    config = {"version": 1, "activeProfileId": "fixture", "profiles": [{
        "id": "fixture", "format": "openai-chat", "model": "fixture",
        "baseUrl": base + "/v1", "apiKey": "local-fixture-key", "contextWindow": 65536
    }]}
    read = """async () => (await DivinationAiChatStore.createStore()
        .listConversations({archived:'all'}))[0]"""

    def page(context):
        p = context.new_page()
        p.on("pageerror", lambda err: errors.append(str(err)))
        p.goto(base + "/ai.html")
        p.wait_for_function("document.querySelectorAll('.ai-chat-item').length > 0")
        return p

    def send(p, question):
        p.locator("#aiPromptInput").fill(question)
        p.locator("#aiSendBtn").click()
        p.wait_for_function(
            "(q) => document.querySelector('#aiMessages').textContent.includes('answer '+q)", arg=question)

    def done(p):
        p.locator("#aiStopBtn").wait_for(state="hidden")
        # A completed IDB transaction is the boundary, not merely the hidden button.
        p.wait_for_function("!document.querySelector('#aiPromptInput').disabled")

    def toggle_language(p):
        if args.android:
            p.locator("#menuToggle").click()
        p.locator("#languageToggle").click()
        if args.android:
            p.locator("#menuClose").click()

    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser_options = {"headless": True}
            if args.browser_executable:
                browser_options["executable_path"] = str(args.browser_executable)
            else:
                browser_options["channel"] = "chrome"
            browser = pw.chromium.launch(**browser_options)

            def context(cfg=None):
                gate.clear()
                seen.clear()
                bodies.clear()
                compatibility_bodies.clear()
                c = browser.new_context(viewport={"width": 1440, "height": 900}, locale="zh-CN")
                c.route("**/*", lambda route: route.continue_()
                        if route.request.url.startswith(base + "/") else route.abort())
                c.add_init_script("localStorage.setItem('quareia-ai-config-v1',"
                                  + json.dumps(json.dumps(cfg or config)) + ");")
                return c

            for model, expected_calls in [("gpt-6.1-sol", 1), ("opaque-modern", 3), ("gpt-6.1-legacy", 2), ("opaque-nonstream", 2), ("opaque-policy-rejection", 1)]:
                with context() as c:
                    a = page(c)
                    a.locator("#aiSettingsBtn").click()
                    a.locator("#aiProfileModel").fill(model)
                    a.locator("#aiProfileMaxTokens").fill("1024")
                    a.locator("#aiProfileTemperature").fill("0.4")
                    if model != "opaque-policy-rejection":
                        a.locator("#aiTestConnectionBtn").click()
                        a.wait_for_function("document.querySelector('#aiSettingsStatus').textContent.includes('连接成功')")
                        assert compatibility_bodies[-1].get("max_tokens", compatibility_bodies[-1].get("max_completion_tokens")) == 256
                    compatibility_bodies.clear()
                    a.locator("#aiSaveProfileBtn").click()
                    a.locator("#aiPromptInput").fill("compatibility-fixture")
                    a.locator("#aiSendBtn").click()
                    done(a)
                    assert len(compatibility_bodies) == expected_calls, (model, len(compatibility_bodies))
                    assert all(body["model"] == model for body in compatibility_bodies)
                    assert all(body.get("max_tokens", body.get("max_completion_tokens")) == 1024 for body in compatibility_bodies)
                    assert all(body["messages"] == compatibility_bodies[0]["messages"] for body in compatibility_bodies)
                    conversation = a.evaluate(read)
                    answers = [message for message in conversation["messages"] if message["role"] == "assistant"]
                    assert len(answers) == 1
                    if model == "opaque-policy-rejection":
                        assert "HTTP 400" in answers[0]["error"]
                    else:
                        assert answers[0]["content"] == "answer compatibility-fixture complete"
                        assert not answers[0]["error"]
                    assert a.evaluate("DivinationAiProviders.createConfigStore().getActiveProfile().maxTokens") == 1024
                    results["provider_compatibility_" + model] = "pass"

            with context() as c:
                a = page(c)
                assert a.locator("#aiStorageWarning").is_hidden()
                send(a, "slow-pin")
                a.locator(".ai-chat-item.is-active").get_by_role("button", name="置顶", exact=True).click()
                a.locator(".ai-chat-item.is-active").get_by_role("button", name="取消置顶", exact=True).wait_for()
                assert "answer slow-pin" in a.locator("#aiMessages").inner_text()
                gate.set()
                done(a)
                if args.output:
                    args.output.mkdir(parents=True, exist_ok=True)
                    a.screenshot(path=str(args.output / ("ai-android.png" if args.android else "ai-web.png")))
                saved = a.evaluate(read)
                assert saved["pinned"] and saved["messages"][1]["content"] == "answer slow-pin complete"
                a.reload()
                a.wait_for_function("document.querySelectorAll('.ai-msg').length === 2")
                assert "answer slow-pin complete" in a.locator("#aiMessages").inner_text()
                # Both click events happen before the first asynchronous save completes.
                a.locator("#aiPromptInput").fill("fast-double")
                a.evaluate("""() => {
                    document.querySelector('#aiSendBtn').click();
                    document.querySelector('#aiPromptInput').value='unexpected-double';
                    document.querySelector('#aiSendBtn').click();
                }""")
                a.wait_for_function("document.querySelector('#aiMessages').textContent.includes('answer fast-double complete')")
                done(a)
                assert seen.count("fast-double") == 1 and "unexpected-double" not in seen
                # Stop immediately, before the initial IndexedDB save resolves.
                a.locator("#aiPromptInput").fill("stop-before-persist")
                a.evaluate("""() => {
                    document.querySelector('#aiSendBtn').click();
                    document.querySelector('#aiStopBtn').click();
                }""")
                done(a)
                assert "stop-before-persist" not in seen
                assert a.evaluate(read)["messages"][-1]["error"] == "已停止生成。"
                results["pin_stream_reload_and_double_send"] = "pass"

            with context() as c:
                a = page(c)
                send(a, "slow-A")
                b = page(c)
                send(b, "B")
                done(b)
                assert bodies[-1]["messages"][-1]["content"] == "slow-A\n\nB"
                assert len(b.evaluate(read)["messages"]) == 4
                gate.set()
                done(a)
                current = b.evaluate(read)
                assert [m["content"] for m in current["messages"]] == [
                    "slow-A", "answer slow-A complete", "B", "answer B complete"]
                # B's in-memory A response was empty, so stale destructive regeneration must refuse.
                b.locator(".ai-msg").nth(1).get_by_role("button", name="重新生成", exact=True).click()
                b.get_by_text("对话已更新", exact=True).wait_for()
                assert seen == ["slow-A", "B"]
                assert b.evaluate(read)["messages"] == current["messages"]
                b.reload()
                b.wait_for_function("document.querySelectorAll('.ai-msg').length === 4")
                assert "answer slow-A complete" in b.locator("#aiMessages").inner_text()
                results["overlapping_tabs_and_stale_regenerate"] = "pass"

            with context() as c:
                a = page(c)
                send(a, "slow-regenerate")
                b = page(c)
                original = b.evaluate(read)["messages"][1]["id"]
                b.locator(".ai-msg").nth(1).get_by_role("button", name="重新生成", exact=True).click()
                b.wait_for_function("document.querySelector('#aiMessages').textContent.includes('complete')")
                done(b)
                replacement = b.evaluate(read)
                assert replacement["messages"][1]["id"] != original
                gate.set()
                done(a)
                assert b.evaluate(read)["messages"] == replacement["messages"]
                results["regenerate_during_other_tab_generation"] = "pass"

            with context() as c:
                a = page(c)
                send(a, "slow-delete")
                b = page(c)
                b.evaluate("""async () => {
                    const s=DivinationAiChatStore.createStore();
                    const conv=(await s.listConversations({archived:'all'}))[0];
                    await s.deleteConversation(conv.id);
                }""")
                gate.set()
                done(a)
                all_chats = b.evaluate("""async () => DivinationAiChatStore.createStore()
                    .listConversations({archived:'all'})""")
                assert all(not conv["messages"] for conv in all_chats)
                results["deleted_chat_not_revived_by_late_completion"] = "pass"

            with context() as c:
                a = page(c)
                a.evaluate("""async () => {
                    const definition = {
                        id:'custom-snapshot-regression',name:'Snapshot spread',
                        description:'snapshot-description',source:'snapshot-source',
                        positions:[
                            {number:1,name:'Cause',meaning:'snapshot-cause'},
                            {number:2,name:'Crossing',meaning:'snapshot-crossing',stackOn:1}
                        ]
                    };
                    const record=DivinationHistoryRecords.buildPresetRecord({
                        id:'snapshot-reading',deckType:'tarot',deckMode:'tarot',deckName:'Tarot',
                        spreadId:definition.id,spreadName:definition.name,
                        orientationMode:'mixed',filterMode:'mixed',overviewMethod:'not-applicable',
                        positions:definition.positions,
                        entries:[0,1].map(i=>({slotIndex:i,orientation:'upright',card:{
                            id:'major-0'+i,number:i,name:i===0?'愚者':'魔法师',arcana:'major',suit:''
                        }}))
                    });
                    await DivinationHistoryStore.createStore().saveRecord(record);
                    const snapshot=DivinationAiContext.buildReadingSnapshot(record,{
                        locale:'zh-CN',customLibrary:{getById:()=>definition}
                    });
                    const s=DivinationAiChatStore.createStore();
                    const conv=(await s.listConversations({archived:'all'}))[0];
                    await s.updateConversation(conv.id,{readingIds:[record.id],readingSnapshots:[snapshot]});
                }""")
                for question in ["snapshot-live", "snapshot-gone"]:
                    if question == "snapshot-gone":
                        a.evaluate("async () => DivinationHistoryStore.createStore().deleteRecord('snapshot-reading')")
                    a.reload()
                    a.wait_for_function("document.querySelectorAll('.ai-reading-card').length > 0")
                    send(a, question)
                    done(a)
                    system = bodies[-1]["messages"][0]["content"]
                    for expected in [
                        "snapshot-cause",
                        "snapshot-crossing",
                        "snapshot-description",
                        "snapshot-source",
                        "交叉叠放于第 1 位之上",
                        "零点空白、天真无防备",
                        "魔法师代表有工具",
                    ]:
                        assert expected in system, expected
                results["snapshot_context_with_and_without_original_record"] = "pass"

            with context() as c:
                a = page(c)
                snapshots = a.evaluate("""async () => {
                    const snapshots = ['review-r1', 'review-r2'].map(id =>
                        DivinationAiContext.buildReadingSnapshot({
                            id, layoutMode:'preset', deckType:'tarot', spreadId:'three-card-horizontal',
                            createdAt:Date.now(), cards:[
                                {cardId:'major-00', positionNumber:1, orientation:'upright'},
                                {cardId:'major-01', positionNumber:2, orientation:'upright'},
                                {cardId:'major-02', positionNumber:3, orientation:'upright'}
                            ]}, {locale:'zh-CN'}));
                    await DivinationAiChatStore.createStore().createConversation({
                        id:'review-race', title:'Review fixture', readingIds:snapshots.map(s=>s.id),
                        readingSnapshots:snapshots});
                    return snapshots;
                }""")
                a.reload()
                a.locator('[data-reading-id="review-r1"]').wait_for()
                b = page(c)
                a.locator('[data-reading-id="review-r1"] .ai-reading-question-add-btn').click()
                first_input = a.locator('[data-reading-id="review-r1"] .ai-reading-question-input')
                first_input.fill("First tab question")
                b.locator('[data-reading-id="review-r2"] .ai-reading-question-add-btn').click()
                b.locator('.ai-reading-question-input').fill("Second tab question")
                b.locator('.ai-reading-question-input').press("Enter")
                b.wait_for_function("""async () => (await DivinationAiChatStore.createStore()
                    .getConversation('review-race')).readingSnapshots.find(s=>s.id==='review-r2').question === 'Second tab question'""")
                first_input.press("Enter")
                a.wait_for_function("""async () => (await DivinationAiChatStore.createStore()
                    .getConversation('review-race')).readingSnapshots.find(s=>s.id==='review-r1').question === 'First tab question'""")
                questions = a.evaluate("""async () => (await DivinationAiChatStore.createStore()
                    .getConversation('review-race')).readingSnapshots.map(s=>s.question)""")
                assert questions == ["First tab question", "Second tab question"], questions
                results["two_tab_question_edits_preserve_each_other"] = "pass"

                # The second tab attaches a reading after the first tab sent its request.
                a.evaluate("""async () => {
                    const store=DivinationAiChatStore.createStore();
                    const conv=await store.getConversation('review-race');
                    await store.setAttachedReadings(conv.id,['review-r1'],
                        conv.readingSnapshots.filter(s=>s.id==='review-r1'));
                }""")
                a.reload()
                send(a, "slow-review-r1")
                b.evaluate("""async snapshot => {
                    const store=DivinationAiChatStore.createStore();
                    const conv=await store.getConversation('review-race');
                    await store.setAttachedReadings(conv.id,['review-r1','review-r2'],
                        conv.readingSnapshots.concat(snapshot));
                }""", snapshots[1])
                gate.set()
                done(a)
                assert "追问开窗深挖" not in a.locator("#aiActiveSkillsList").inner_text()
                send(a, "review-new-reading")
                done(a)
                assert "严禁重背全盘" not in bodies[-1]["messages"][0]["content"]
                assert "追问开窗深挖" in a.locator("#aiActiveSkillsList").inner_text()
                results["late_response_keeps_new_attachment_unread"] = "pass"

                b.evaluate("""async snapshot => {
                    const store=DivinationAiChatStore.createStore();
                    const conv=await store.getConversation('review-race');
                    await store.setAttachedReadings(conv.id,conv.readingIds.concat('review-r3'),
                        conv.readingSnapshots.concat({...snapshot,id:'review-r3'}));
                    await store.setReadingQuestion(conv.id,'review-r2','Latest question before remove');
                }""", snapshots[0])
                a.locator('[data-reading-id="review-r1"] .ai-chip-remove').click()
                a.wait_for_function("document.querySelector('[data-reading-id=\"review-r3\"]') !== null")
                after_remove = a.evaluate("""async () => {
                    const conv=await DivinationAiChatStore.createStore().getConversation('review-race');
                    return {ids:conv.readingIds, question:conv.readingSnapshots.find(s=>s.id==='review-r2').question};
                }""")
                assert after_remove == {"ids": ["review-r2", "review-r3"], "question": "Latest question before remove"}, after_remove
                results["remove_preserves_other_tab_question_and_attachment"] = "pass"


                for locale, expected in [("zh-CN", "免责声明"), ("en", "Disclaimer:")]:
                    if a.evaluate("DivinationI18n.getLocale()") != locale:
                        toggle_language(a)
                    for width in [1280, 390]:
                        a.set_viewport_size({"width": width, "height": 900 if width == 1280 else 844})
                        if width == 390:
                            if "is-open" in (a.locator("#aiSidebar").get_attribute("class") or "").split():
                                a.locator("#aiSidebarClose").click()
                            a.wait_for_function("document.querySelector('#aiSidebar').getBoundingClientRect().right <= 0")
                        disclaimer = a.locator("#aiDisclaimer")
                        a.locator("#aiMedicalNotice summary").scroll_into_view_if_needed()
                        assert disclaimer.is_visible()
                        assert expected in disclaimer.inner_text()
                        assert a.evaluate("document.documentElement.scrollWidth <= innerWidth")
                        assert a.evaluate("""() => document.querySelector('#aiDisclaimer').getBoundingClientRect().top >=
                            document.querySelector('#aiPromptInput').getBoundingClientRect().bottom""")
                        assert disclaimer.evaluate("""el => {
                            const r=el.getBoundingClientRect();
                            const hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
                            return hit===el || el.contains(hit);
                        }"""), "Disclaimer must not be covered by the mobile sidebar"
                        assert a.locator("#aiSendBtn").is_enabled()
                        medical_notice = a.locator("#aiMedicalNotice")
                        assert not medical_notice.evaluate("el => el.open")
                        assert a.locator("#aiMessages #aiMedicalNotice").count() == 0
                        summary_text = medical_notice.locator("summary").inner_text()
                        assert ("非 AI 回复" if locale == "zh-CN" else "not an AI response") in summary_text
                        if width == 390:
                            style = disclaimer.evaluate("el => { const s=getComputedStyle(el); return {size:s.fontSize,line:s.lineHeight,padding:s.paddingTop}; }")
                            assert style == {"size": "12px", "line": "17.04px", "padding": "6px"}, style
                            results["mobile_composer_height_" + locale] = a.locator(".ai-composer").evaluate("el => Math.round(el.getBoundingClientRect().height)")
                        if args.output:
                            a.screenshot(path=str(args.output / ("ai-disclaimer-" + locale + "-" + str(width) + ".png")))
                        medical_notice.locator("summary").click()
                        assert medical_notice.locator("p").is_visible()
                        assert ("不能确认疾病" if locale == "zh-CN" else "cannot confirm illness") in medical_notice.locator("p").inner_text()
                        medical_notice.locator("p").scroll_into_view_if_needed()
                        if args.output and width == 390:
                            a.screenshot(path=str(args.output / ("ai-medical-notice-" + locale + "-mobile.png")))
                        medical_notice.locator("summary").click()
                results["disclaimer_visible_bilingual_desktop_mobile"] = "pass"

                notice_text = a.locator("#aiMedicalNotice p").text_content().strip()
                assert notice_text, "Read the complete notice even while its details panel is collapsed"
                send(a, "medical-review: What about this illness and recovery?")
                done(a)
                request_text = json.dumps(bodies[-1], ensure_ascii=False)
                assert notice_text not in request_text
                assert "not an AI response" not in request_text
                stored_messages = a.evaluate("""async () => (await DivinationAiChatStore.createStore()
                    .getConversation('review-race')).messages.map(m=>m.content).join(' ')""")
                assert notice_text not in stored_messages
                assert "not an AI response" not in stored_messages
                results["medical_notice_stays_outside_prompt_and_chat_history"] = "pass"

                await_delete = b.evaluate("""async () => {
                    await DivinationAiChatStore.createStore().deleteConversation('review-race');
                    return true;
                }""")
                assert await_delete
                a.locator('[data-reading-id="review-r2"] .ai-chip-remove').click()
                a.wait_for_function("document.querySelector('[data-reading-id=\"review-r2\"]') === null")
                assert a.evaluate("async () => await DivinationAiChatStore.createStore().getConversation('review-race')") is None
                results["remove_from_deleted_chat_recovers_without_page_error"] = "pass"

            with context() as c:
                a = page(c)
                a.evaluate("""async () => {
                    const store = DivinationAiChatStore.createStore();
                    const snapshot = DivinationAiContext.buildReadingSnapshot({
                        id:'clarify-r1', layoutMode:'preset', deckType:'tarot', spreadId:'three-card-horizontal',
                        createdAt:Date.now(), cards:[
                            {cardId:'major-00', positionNumber:1, orientation:'upright'},
                            {cardId:'major-01', positionNumber:2, orientation:'upright'},
                            {cardId:'major-02', positionNumber:3, orientation:'upright'}
                        ]}, {locale:'zh-CN'});
                    const conv = await store.createConversation({id:'clarify-state', title:'Clarify fixture'});
                    await store.setAttachedReadings(conv.id, [snapshot.id], [snapshot]);
                }""")
                a.reload()
                a.locator('[data-reading-id="clarify-r1"]').wait_for()
                # (a) The reader only asks what to talk about first; mentioning
                # 牌面 is not an interpretation of the attached spread.
                send(a, "clarify-fixture")
                done(a)
                # Still nothing has been read out of the record, so the next
                # turn must not be treated as a follow-up.
                assert "追问开窗深挖" not in a.locator("#aiActiveSkillsList").inner_text()
                send(a, "reading-fixture")
                done(a)
                # The turn that reads the spread itself is not a follow-up.
                assert "严禁重背全盘" not in bodies[-1]["messages"][0]["content"]
                # (b) A short reply that names a card of the record does count, so
                # the following turn opens follow-up mode.
                send(a, "after-reading-fixture")
                done(a)
                assert "严禁重背全盘" in bodies[-1]["messages"][0]["content"]
                assert "追问开窗深挖" in a.locator("#aiActiveSkillsList").inner_text()
                results["clarification_does_not_start_follow_up"] = "pass"

            # A manual 4096-token window with the full persona prompt used to
            # trim the earlier turns away. The assembly now drops the persona
            # down to its compact form first, so all three short turns survive.
            small_config = json.loads(json.dumps(config))
            small_config["profiles"][0]["contextWindow"] = 4096
            with context(small_config) as c:
                a = page(c)
                send(a, "small-name")
                done(a)
                send(a, "small-ack")
                done(a)
                send(a, "small-ask")
                done(a)
                last = bodies[-1]
                system_prompt = last["messages"][0]["content"]
                joined = "\n".join(message["content"] for message in last["messages"])
                for expected in ["small-name", "small-ack", "small-ask"]:
                    assert expected in joined, (expected, [m["content"] for m in last["messages"]])
                assert "应用内运行规范（简版）" in system_prompt
                assert "## 三层模型" not in system_prompt
                assert "奥莉薇娅" in system_prompt
                results["small_context_keeps_recent_turns"] = "pass"

            with context() as c:
                a = page(c)
                tx_results = a.evaluate("""async () => {
                    const api=DivinationAiChatStore;
                    const s=api.createStore(), t=api.createStore();
                    const c=await s.createConversation({id:'atomic'});
                    await Promise.all(Array.from({length:40},(_,i)=>
                        (i%2?s:t).appendMessages(c.id,[{id:'m'+i,role:'user',content:String(i)}])));
                    const count=(await s.getConversation(c.id)).messages.length;
                    const original=IDBObjectStore.prototype.put;
                    IDBObjectStore.prototype.put=function(value) {
                        const tx=this.transaction, req=original.call(this,value);
                        req.addEventListener('success',()=>tx.abort());
                        return req;
                    };
                    let rejected=false;
                    try { await s.setPinned(c.id,true); } catch (_) { rejected=true; }
                    finally { IDBObjectStore.prototype.put=original; }
                    return {count,rejected,pinned:(await s.getConversation(c.id)).pinned};
                }""")
                assert tx_results == {"count": 40, "rejected": True, "pinned": False}, tx_results
                results["real_indexeddb_concurrency_and_abort"] = tx_results

            with context() as c:
                c.add_init_script("""const original = indexedDB.open.bind(indexedDB);
                    indexedDB.open = function(name, ...rest) {
                        if (name === 'quareia-divination-ai-chats') {
                            throw new DOMException('Fixture storage failure', 'InvalidStateError');
                        }
                        return original(name, ...rest);
                    };""")
                a = page(c)
                warning = a.locator("#aiStorageWarning")
                warning.wait_for(state="visible")
                assert "刷新或离开页面会丢失" in warning.inner_text()
                send(a, "memory-export")
                done(a)
                with a.expect_download() as downloaded:
                    a.locator("#aiStorageExportBtn").click()
                payload = json.loads(Path(downloaded.value.path()).read_text(encoding="utf-8"))
                assert payload["conversations"][0]["messages"][-1]["content"] == "answer memory-export complete"
                assert "local-fixture-key" not in json.dumps(payload)
                toggle_language(a)
                assert "only in memory" in warning.inner_text()
                toggle_language(a)
                if args.output:
                    a.screenshot(path=str(args.output / "ai-memory-warning.png"))
                    a.set_viewport_size({"width": 390, "height": 844})
                    assert a.evaluate("document.documentElement.scrollWidth <= innerWidth")
                    a.screenshot(path=str(args.output / "ai-memory-warning-mobile.png"))
                a.reload()
                warning.wait_for(state="visible")
                assert "answer memory-export" not in a.locator("#aiMessages").inner_text()
                results["memory_fallback_warning_and_backup"] = "pass"

            with context() as c:
                a = page(c)
                a.evaluate("""() => {
                    window.fixtureFileRead = false;
                    const input = document.querySelector('#aiImportFileInput');
                    Object.defineProperty(input, 'files', {configurable:true, value:[{
                        name:'too-large.json', size:DivinationAiChatStore.MAX_BACKUP_BYTES + 1,
                        text() { window.fixtureFileRead=true; return Promise.resolve('{}'); }
                    }]});
                    input.dispatchEvent(new Event('change', {bubbles:true}));
                }""")
                a.get_by_text("AI 对话备份不能超过 8 MiB。请选择较小的备份文件。", exact=True).wait_for()
                assert a.evaluate("window.fixtureFileRead") is False
                assert not a.evaluate(read)["messages"]
                a.locator("#confirmCancelBtn").click()
                a.evaluate("delete document.querySelector('#aiImportFileInput').files")
                a.locator("#aiImportFileInput").set_input_files({
                    "name": "memory-backup.json", "mimeType": "application/json",
                    "buffer": json.dumps(payload, ensure_ascii=False).encode("utf-8")
                })
                a.get_by_text("导入完成", exact=True).wait_for()
                restored = a.evaluate("""async () => (await DivinationAiChatStore.createStore()
                    .listConversations({archived:'all'})).some(c =>
                    c.messages.some(m => m.content === 'answer memory-export complete'))""")
                assert restored
                results["oversize_backup_rejected_and_memory_backup_restored"] = "pass"

            with context() as c:
                a = page(c)
                a.locator("#aiRenameChatBtn").click()
                rename = a.locator("#aiRenameInput")
                rename.fill("正在选词")
                rename.dispatch_event("keydown", {"key":"Enter", "isComposing":True, "keyCode":229})
                assert a.locator("#aiRenameModal").is_visible()
                rename.dispatch_event("keydown", {"key":"Enter", "isComposing":False, "keyCode":229})
                assert a.locator("#aiRenameModal").is_visible()
                assert a.evaluate(read)["title"] != "正在选词"
                rename.press("Enter")
                a.wait_for_function("document.querySelector('#aiActiveChatTitle').textContent === '正在选词'")
                prompt = a.locator("#aiPromptInput")
                prompt.fill("候选词")
                prompt.dispatch_event("keydown", {"key":"Enter", "isComposing":False, "keyCode":229})
                assert prompt.input_value() == "候选词"
                assert not a.evaluate(read)["messages"]
                assert not seen
                results["ime_enter_does_not_submit"] = "pass"

            with context() as c:
                a = page(c)
                send(a, "truncated-fixture")
                done(a)
                saved = a.evaluate(read)
                assert saved["messages"][-1]["content"] == "answer truncated-fixture complete"
                assert "输出上限" in saved["messages"][-1]["error"]
                a.reload()
                a.wait_for_function("document.querySelector('#aiMessages').textContent.includes('输出上限')")
                assert "answer truncated-fixture complete" in a.locator("#aiMessages").inner_text()
                with a.expect_download() as downloaded:
                    a.locator("#aiExportMdBtn").click()
                markdown = Path(downloaded.value.path()).read_text(encoding="utf-8")
                assert "输出上限" in markdown and "answer truncated-fixture complete" in markdown
                results["truncated_answer_notice_persists_and_exports"] = "pass"

            with context() as c:
                a = page(c)
                send(a, "interrupted-fixture")
                done(a)
                saved = a.evaluate(read)["messages"][-1]
                assert saved["content"] == "answer interrupted-fixture"
                assert "连接在回答完成前结束" in saved["error"]
                assert "输出上限" not in saved["error"]
                a.reload()
                a.wait_for_function("document.querySelector('#aiMessages').textContent.includes('连接在回答完成前结束')")
                assert "answer interrupted-fixture" in a.locator("#aiMessages").inner_text()
                results["early_stream_eof_keeps_partial_with_distinct_notice"] = "pass"

            with context() as c:
                a = page(c)
                a.evaluate("""async () => {
                    await DivinationAiChatStore.createStore().createConversation({
                        id:'large-archive', title:'Large archive fixture', archived:true,
                        messages:[{role:'user',content:'ARCHIVE_BEGIN'+
                            'x'.repeat(DivinationAiChatStore.MAX_BACKUP_BYTES)+'ARCHIVE_END'}]
                    });
                }""")
                a.locator("#aiExportBackupBtn").click()
                a.get_by_text("备份超过导入上限", exact=True).wait_for()
                assert "Markdown 存档不能导入聊天列表" in a.locator("#confirmDialog").inner_text()
                downloads = []
                a.on("download", lambda download: downloads.append(download.suggested_filename))
                a.locator("#confirmCancelBtn").click()
                a.locator("#aiExportBackupBtn").click()
                a.get_by_text("备份超过导入上限", exact=True).wait_for()
                assert not downloads, "Cancelling the archive prompt must not download an unrestorable JSON file"
                with a.expect_download() as downloaded:
                    a.get_by_role("button", name="导出 Markdown 存档", exact=True).click()
                assert downloaded.value.suggested_filename.endswith(".md")
                archive = Path(downloaded.value.path()).read_text(encoding="utf-8")
                assert "ARCHIVE_BEGIN" in archive and "ARCHIVE_END" in archive
                assert len(archive) > 8 * 1024 * 1024
                assert "Large archive fixture" in archive
                results["oversize_export_offers_explicit_readable_archive"] = "pass"
            assert not errors, errors
            browser.close()
    finally:
        gate.set()
        server.shutdown()

    if args.output:
        args.output.mkdir(parents=True, exist_ok=True)
        report = args.output / ("browser-android.json" if args.android else "browser-web.json")
        report.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(results, ensure_ascii=False, indent=2))
    return results


if __name__ == "__main__":
    main()
