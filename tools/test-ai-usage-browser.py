"""Offline browser checks for AI usage collection, with every network request intercepted.
No real credentials, provider calls, telemetry writes, or existing browser profile are used.
"""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse, unquote


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--android",action="store_true")
    parser.add_argument("--output",type=Path)
    parser.add_argument("--browser-executable",type=Path)
    args=parser.parse_args()
    root=Path(__file__).resolve().parents[1]
    if args.android: root /= "android-demo/app/src/main/assets/www"
    root=root.resolve()
    site="https://hedanbaomi.github.io/tarot-divination-site/"
    events,pending,errors=[],[],[]
    config={"version":1,"activeProfileId":"fixture","profiles":[{"id":"fixture","name":"Offline fixture","format":"openai-chat","model":"gpt-6.1-terra","baseUrl":"https://provider.invalid/v1","apiKey":"fixture-only-key","contextWindow":65536}]}

    def answer(route, unknown=False):
        payload={"choices":[{"delta":{"content":"Synthetic reply"},"finish_reason":"stop"}]}
        if not unknown: payload["usage"]={"prompt_tokens":100,"completion_tokens":50,"total_tokens":150}
        route.fulfill(status=200,content_type="text/event-stream",body="data: "+json.dumps(payload)+"\n\ndata: [DONE]\n\n")

    def handle(route):
        url=route.request.url
        if url.startswith(site):
            path=(root / unquote(urlparse(url).path.removeprefix("/tarot-divination-site/"))).resolve()
            if path.is_relative_to(root) and path.is_file(): route.fulfill(path=str(path))
            else: route.fulfill(status=404,body="missing")
        elif url.startswith("https://telemetry.luotianyi.fun/"):
            if route.request.method=="POST":
                data=route.request.post_data_json
                if data.get("event")=="ai_usage": events.append(data)
            route.fulfill(status=204,headers={"Access-Control-Allow-Origin":"https://hedanbaomi.github.io","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST,OPTIONS"})
        elif url.startswith("https://provider.invalid/"):
            if route.request.method=="OPTIONS":
                route.fulfill(status=204,headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"*","Access-Control-Allow-Methods":"GET,POST,OPTIONS"})
            elif route.request.method=="GET": route.fulfill(status=200,content_type="application/json",body='{"data":[]}')
            else:
                data=route.request.post_data_json
                prompt=data["messages"][-1]["content"]
                if prompt.endswith("hold-fixture"): pending.append(route)
                else: answer(route, prompt.endswith("unknown-fixture"))
        else: route.abort()

    from playwright.sync_api import sync_playwright, expect
    with sync_playwright() as pw:
        options={"headless":True}
        if args.browser_executable: options["executable_path"]=str(args.browser_executable)
        else: options["channel"]="chrome"
        with pw.chromium.launch(**options) as browser:
            with browser.new_context(viewport={"width":1100,"height":950},locale="zh-CN") as context:
                context.route("**/*",handle)
                context.add_init_script("localStorage.setItem('quareia-ai-config-v1',"+json.dumps(json.dumps(config))+");")
                if args.android:
                    context.add_init_script("""window._fixtureEvents=[];let enabled=true,epoch=0;window.androidTelemetry={isEnabled:()=>enabled,setEnabled:v=>{enabled=v;if(!v)epoch++},beginAiUsage:()=>enabled?String(epoch):'',logAiUsage:(id,model,kind,tokens,token)=>{if(enabled&&token===String(epoch))_fixtureEvents.push({request_id:id,model_id:model,usage_kind:kind,total_tokens:tokens===-1?null:tokens})}};""")
                page=context.new_page()
                page.on("pageerror",lambda error:errors.append(str(error)))
                page.goto(site+"ai.html")
                page.wait_for_function("document.querySelectorAll('.ai-chat-item').length>0")
                expect(page.locator("#aiTelemetryToggle")).to_be_visible()

                def get_events():
                    return page.evaluate("window._fixtureEvents") if args.android else list(events)

                def complete():
                    expect(page.locator("#aiStopBtn")).to_be_hidden()
                    expect(page.locator("#aiPromptInput")).to_be_enabled()
                    page.evaluate("() => new Promise(resolve => setTimeout(resolve, 50))")

                def send(text):
                    page.locator("#aiPromptInput").fill(text)
                    page.locator("#aiSendBtn").click()
                    complete()

                send("known-fixture")
                assert len(get_events())==1, get_events()
                assert get_events()[0]["total_tokens"]==150
                page.get_by_role("button",name="重新生成",exact=True).last.click()
                complete()
                assert len(get_events())==2
                assert get_events()[0]["request_id"]!=get_events()[1]["request_id"]
                send("unknown-fixture")
                assert len(get_events())==3 and get_events()[-1]["total_tokens"] is None
                page.locator("#aiPromptInput").fill("hold-fixture")
                page.locator("#aiSendBtn").click()
                page.wait_for_timeout(100)
                assert len(pending)==1
                page.locator("#aiTelemetryToggle").click()
                page.locator("#aiTelemetryToggle").click()
                answer(pending.pop())
                complete()
                assert len(get_events())==3, "A pre-opt-out request was reported after re-enable"
                page.locator("#aiTelemetryToggle").click()
                send("disabled-fixture")
                assert len(get_events())==3
                assert all(x["model_id"]=="gpt-6.1-terra" and x["usage_kind"]=="conversation" for x in get_events())
                assert all("prompt" not in x and "apiKey" not in x and "baseUrl" not in x and "content" not in x for x in get_events())
                if args.output:
                    args.output.mkdir(parents=True,exist_ok=True)
                    page.screenshot(path=str(args.output/"ai-usage.png"))
                    (args.output/"ai-usage.json").write_text(json.dumps({"passed":True,"events":get_events(),"checks":["known tokens","regeneration new round","unknown usage null","opt-out then on drops old result","disabled no event","no private content"]},indent=2),encoding="utf-8")
                assert not errors, errors
    print("AI usage browser checks passed: "+("android" if args.android else "web"))


if __name__=="__main__":main()
