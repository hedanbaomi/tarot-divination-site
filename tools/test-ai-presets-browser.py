"""Offline quick-preset regression: fresh browser state, fake credentials, all requests intercepted."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse, unquote
from playwright.sync_api import sync_playwright, expect

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--android",action="store_true")
    parser.add_argument("--output",type=Path,required=True)
    parser.add_argument("--browser-executable",type=Path,required=True)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    if args.android: root/="android-demo/app/src/main/assets/www"
    root=root.resolve()
    site="https://hedanbaomi.github.io/tarot-divination-site/"
    pending,requests,errors=[],[],[]
    config={"version":1,"activeProfileId":"fixture","profiles":[{"id":"fixture","name":"Existing fixture","format":"openai-chat","baseUrl":"https://api.openai.com/v1","model":"gpt-6.1-terra","apiKey":"fixture-original-key","contextWindow":65536,"contextWindowSource":"manual"}]}
    def metadata(route,window=262144):
        route.fulfill(status=200,headers={"Access-Control-Allow-Origin":"*"},content_type="application/json",
            body=json.dumps({"data":[{"id":"deepseek-v4-pro","context_window":window},{"id":"deepseek-flash","context_window":window},{"id":"gpt-6.1-terra","context_window":8192}]}))
    def handle(route):
        request=route.request
        if request.url.startswith(site):
            path=(root/unquote(urlparse(request.url).path.removeprefix("/tarot-divination-site/"))).resolve()
            if path.is_relative_to(root) and path.is_file(): route.fulfill(path=str(path))
            else: route.fulfill(status=404,body="missing")
        elif "api.openai.com" in request.url:
            if request.method=="OPTIONS":
                route.fulfill(status=204,headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS"})
            else: pending.append(route)
        elif "gateway.invalid" in request.url:
            assert request.headers.get("authorization")=="Bearer fixture-gateway-key"
            pending.append(route)
        elif "api.deepseek.com" in request.url:
            if request.method=="OPTIONS":
                route.fulfill(status=204,headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS"})
            else:
                assert request.headers.get("authorization")=="Bearer fixture-deepseek-key", "Wrong endpoint credential"
                requests.append({"method":request.method,"model":(request.post_data_json or {}).get("model") if request.method=="POST" else None})
                if request.method=="GET": metadata(route)
                else:
                    route.fulfill(status=200,content_type="text/event-stream",headers={"Access-Control-Allow-Origin":"*"},
                        body='data: {"choices":[{"delta":{"content":"Offline preset test"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        elif request.url.startswith("https://telemetry.luotianyi.fun/"):
            route.fulfill(status=204,headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"POST,OPTIONS"})
        else: route.abort()
    args.output.mkdir(parents=True,exist_ok=True)
    with sync_playwright() as pw:
        with pw.chromium.launch(executable_path=str(args.browser_executable),headless=True) as browser:
            with browser.new_context(viewport={"width":1280,"height":900},locale="zh-CN") as context:
                context.route("**/*",handle)
                context.add_init_script("localStorage.setItem('quareia-ai-config-v1',"+json.dumps(json.dumps(config))+");")
                page=context.new_page()
                page.on("pageerror",lambda e:errors.append(str(e)))
                page.goto(site+"ai.html")
                page.locator("#aiSettingsBtn").click()
                original=page.evaluate("localStorage.getItem('quareia-ai-config-v1')")
                key=page.locator("#aiProfileApiKey")
                flash=page.locator('[data-preset="deepseek-flash"]')
                pro=page.locator('[data-preset="deepseek-v4-pro"]')
                with page.expect_request(lambda r:r.method=="GET" and "api.openai.com" in r.url):
                    page.locator("#aiDetectContextBtn").click()
                flash.click()
                expect(key).to_have_value("")
                expect(page.locator("#aiProfileModel")).to_have_value("deepseek-flash")
                expect(page.locator("#aiFieldContextWindow")).to_have_value("")
                expect(page.locator("#aiContextWindowHint")).to_contain_text("1,048,576")
                assert len(pending)==1
                metadata(pending.pop(),8192)
                expect(page.locator("#aiDetectContextBtn")).to_be_enabled()
                expect(page.locator("#aiContextWindowHint")).to_contain_text("1,048,576")
                assert page.evaluate("localStorage.getItem('quareia-ai-config-v1')")==original
                page.locator("#aiSettingsCloseBtn").click()
                page.locator("#aiSettingsBtn").click()
                expect(key).to_have_value("fixture-original-key")
                expect(page.locator("#aiProfileModel")).to_have_value("gpt-6.1-terra")
                with page.expect_request(lambda r:r.method=="GET" and "api.openai.com" in r.url):
                    with page.expect_request(lambda r:r.method=="POST" and "api.openai.com" in r.url):
                        page.locator("#aiTestConnectionBtn").click()
                flash.click()
                assert len(pending)==2
                while pending:
                    old=pending.pop()
                    if old.request.method=="GET": metadata(old,8192)
                    else: old.fulfill(status=200,headers={"Access-Control-Allow-Origin":"*"},content_type="application/json",body=json.dumps({"choices":[{"message":{"content":"Old test reply"},"finish_reason":"stop"}]}))
                expect(page.locator("#aiTestConnectionBtn")).to_be_enabled()
                expect(page.locator("#aiContextWindowHint")).to_contain_text("1,048,576")
                expect(page.locator("#aiSettingsStatus")).not_to_contain_text("gpt-6.1-terra")
                key.fill("fixture-deepseek-key")
                pro.click()
                expect(key).to_have_value("fixture-deepseek-key")
                expect(pro).to_have_attribute("aria-pressed","true")
                page.locator("#aiProfileModel").fill("custom-model")
                expect(pro).to_have_attribute("aria-pressed","false")
                page.locator("#aiProfileModel").fill("deepseek-v4-pro")
                expect(pro).to_have_attribute("aria-pressed","true")
                page.locator("#aiProfileBaseUrl").fill("https://other.invalid/v1")
                expect(pro).to_have_attribute("aria-pressed","false")
                pro.click()
                expect(key).to_have_value("")
                key.fill("fixture-deepseek-key")
                for width,height in [(1280,900),(390,844)]:
                    page.set_viewport_size({"width":width,"height":height})
                    page.screenshot(path=str(args.output/("preset-"+str(width)+".png")))
                    widths=page.evaluate("({page:document.documentElement.scrollWidth,viewport:innerWidth,modal:document.querySelector('#aiSettingsModal .ai-modal-panel')?.scrollWidth})")
                    assert widths["page"]<=widths["viewport"], widths
                page.locator("#aiTestConnectionBtn").click()
                expect(page.locator("#aiTestConnectionBtn")).to_be_enabled()
                assert any(r["method"]=="POST" and r["model"]=="deepseek-v4-pro" for r in requests)
                page.locator("#aiSaveProfileBtn").click()
                page.wait_for_function("JSON.parse(localStorage.getItem('quareia-ai-config-v1')).profiles[0].detectedContextWindow===262144")
                saved=page.evaluate("JSON.parse(localStorage.getItem('quareia-ai-config-v1')).profiles[0]")
                assert saved["contextWindowSource"]=="api" and not saved["contextWindow"]
                page.locator("#aiSettingsBtn").click()
                page.locator("#aiFieldContextWindow").fill("65536")
                page.locator("#aiSaveProfileBtn").click()
                saved=page.evaluate("JSON.parse(localStorage.getItem('quareia-ai-config-v1')).profiles[0]")
                assert saved["contextWindow"]==65536 and saved["contextWindowSource"]=="manual"
                page.locator("#aiSettingsBtn").click()
                page.locator("#aiFieldContextWindow").fill("")
                page.locator("#aiProfileModel").fill("deepseek-v4-pro")
                page.locator("#aiProfileBaseUrl").fill("https://gateway.invalid/v1")
                key.fill("fixture-gateway-key")
                with page.expect_request(lambda r:r.method=="GET" and "gateway.invalid" in r.url):
                    page.locator("#aiSaveProfileBtn").click()
                page.locator("#aiSettingsBtn").click()
                pro.click()
                key.fill("fixture-deepseek-key")
                page.locator("#aiSaveProfileBtn").click()
                page.wait_for_function("JSON.parse(localStorage.getItem('quareia-ai-config-v1')).profiles[0].detectedContextWindow===262144")
                assert len(pending)==1
                metadata(pending.pop(),8192)
                page.wait_for_timeout(50)
                saved=page.evaluate("JSON.parse(localStorage.getItem('quareia-ai-config-v1')).profiles[0]")
                assert saved["detectedContextWindow"]==262144, "Old endpoint probe overwrote current endpoint"
                assert not errors, errors
                result={"passed":True,"platform":"android" if args.android else "web","checks":["1M catalog default","cross-endpoint key cleared","same-endpoint key retained","Cancel preserves saved configuration","late detection ignored","late connection test ignored","late automatic endpoint probe ignored","model and endpoint edit refresh selection","test request uses correct fixture credential and model","live metadata overrides catalog","manual limit preserved","desktop and mobile layout"],"errors":errors}
                (args.output/"result.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
                print(json.dumps(result,ensure_ascii=False))
if __name__=="__main__": main()
