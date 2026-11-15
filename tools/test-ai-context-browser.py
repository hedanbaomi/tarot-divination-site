"""Context-window settings regression using disposable Chrome and local metadata only.
Run: python tools/test-ai-context-browser.py [--android] [--output DIR]
No real provider traffic, API keys, or existing browser profiles are used.
"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import threading
from urllib.parse import unquote, urlparse


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--android", action="store_true")
    parser.add_argument("--browser-executable", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    if args.android:
        root /= "android-demo/app/src/main/assets/www"
    gate = threading.Event()
    started = threading.Event()
    errors, results = [], {}

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_GET(self):
            path = unquote(urlparse(self.path).path)
            if not path.startswith("/v1/models"):
                return super().do_GET()
            model = path.rsplit("/", 1)[-1]
            if model == "slow-context-fixture":
                started.set()
                gate.wait(10)
            payload = {"id": model, "object": "model", "owned_by": "fixture"}
            if model == "models":
                payload = {"data": []}
            elif model in ("api-window-fixture", "slow-context-fixture"):
                payload["context_length"] = 524288
            body = json.dumps(payload).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(root)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = "http://127.0.0.1:%d" % server.server_port
    config = {"version": 1, "activeProfileId": "context-fixture", "profiles": [{
        "id": "context-fixture", "name": "Context fixture", "format": "openai-responses",
        "model": "gpt-6.1-terra", "baseUrl": base + "/v1", "apiKey": "local-fixture-only"
    }]}
    try:
        from playwright.sync_api import sync_playwright, expect
        with sync_playwright() as pw:
            options = {"headless": True}
            if args.browser_executable:
                options["executable_path"] = str(args.browser_executable)
            else:
                options["channel"] = "chrome"
            with pw.chromium.launch(**options) as browser:
                with browser.new_context(viewport={"width": 1100, "height": 950}, locale="zh-CN") as context:
                    context.route("**/*", lambda route: route.continue_() if route.request.url.startswith(base + "/") else route.abort())
                    context.add_init_script("if (!localStorage.getItem('quareia-ai-config-v1')) localStorage.setItem('quareia-ai-config-v1', " + json.dumps(json.dumps(config)) + ");")
                    page = context.new_page()
                    page.on("pageerror", lambda err: errors.append(str(err)))
                    page.goto(base + "/ai.html")
                    expect(page.locator("#aiContextMeter")).to_contain_text("1,050,000")
                    page.locator("#aiSettingsBtn").click()
                    model = page.locator("#aiProfileModel")
                    limit = page.locator("#aiFieldContextWindow")
                    status = page.locator("#aiSettingsStatus")
                    hint = page.locator("#aiContextWindowHint")
                    detect = page.locator("#aiDetectContextBtn")

                    def auto_detect():
                        detect.click()
                        expect(detect).to_be_enabled()

                    for name, tokens in [("gpt-6.1-terra", "1,050,000"), ("gpt-5.6-luna", "1,050,000"), ("claude-opus-5-5", "1,000,000"), ("gemini-4-carbon", "1,048,576")]:
                        model.fill(name)
                        auto_detect()
                        expect(hint).to_contain_text(tokens)
                        expect(status).to_contain_text("模型目录")
                    results["catalog_models"] = "pass"
                    model.fill("gpt-6.1-terra")
                    auto_detect()
                    if args.output:
                        args.output.mkdir(parents=True, exist_ok=True)
                        status.scroll_into_view_if_needed()
                        page.screenshot(path=str(args.output / "context-catalog.png"))
                    page.locator("#aiSaveProfileBtn").click()
                    page.reload()
                    expect(page.locator("#aiContextMeter")).to_contain_text("1,050,000")
                    results["persisted_auto_terra"] = "pass"
                    page.locator("#aiSettingsBtn").click()
                    model.fill("unknown-context-fixture")
                    limit.fill("260000")
                    auto_detect()
                    expect(limit).to_have_value("260000")
                    expect(status).to_contain_text("未能识别")
                    expect(hint).to_contain_text("260,000")
                    limit.fill("")
                    auto_detect()
                    expect(status).to_contain_text("未能识别")
                    expect(hint).to_contain_text("32,768")
                    results["unknown_preserves_manual_and_reports_default"] = "pass"

                    model.fill("api-window-fixture")
                    auto_detect()
                    expect(hint).to_contain_text("524,288")
                    expect(status).to_contain_text("已从接口获取")
                    results["real_metadata_precedes_catalog"] = "pass"

                    model.fill("slow-context-fixture")
                    detect.click()
                    assert started.wait(3), "metadata request did not start"
                    model.fill("gpt-6.1-terra")
                    limit.fill("300000")
                    gate.set()
                    expect(detect).to_be_enabled()
                    expect(limit).to_have_value("300000")
                    expect(status).to_contain_text("配置已更改")
                    expect(hint).to_contain_text("300,000")
                    results["late_metadata_ignored_after_edit"] = "pass"

                    page.locator("#aiSettingsCloseBtn").click()
                    if args.android:
                        page.locator("#menuToggle").click()
                    page.locator("#languageToggle").click()
                    if args.android:
                        page.locator("#menuClose").click()
                    page.locator("#aiSettingsBtn").click()
                    model.fill("unknown-context-fixture")
                    auto_detect()
                    expect(status).to_contain_text("Could not identify")
                    model.fill("gpt-6.1-terra")
                    auto_detect()
                    expect(status).to_contain_text("model catalog")
                    results["english_status"] = "pass"
                    page.set_viewport_size({"width": 390, "height": 844})
                    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth")
                    expect(page.locator("#aiSaveProfileBtn")).to_be_visible()
                    results["mobile_settings_width"] = "pass"
                    if args.output:
                        status.scroll_into_view_if_needed()
                        page.screenshot(path=str(args.output / "context-mobile.png"))
                    assert not errors, errors
    finally:
        gate.set()
        server.shutdown()
    if args.output:
        (args.output / "context-browser.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
