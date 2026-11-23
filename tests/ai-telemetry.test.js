"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const reporter = require("../js/ai-telemetry.js");

test("AI observer reports only scalar metadata once and distinguishes unknown from zero", () => {
  const calls = [];
  const receiver = { beginAiUsage: () => "0", logAiUsage: (...args) => calls.push(args) };
  for (const total of [0, 154, null]) {
    const observer = reporter.createObserver("gpt-6.1-terra", "conversation", {receiver, crypto: webcrypto});
    observer.onRequestStart();
    observer.onRequestStart();
    observer.onRequestEnd({complete: true, usage: {totalTokens: total, secret: "never-send"}});
    observer.onRequestEnd({complete: true, usage: {totalTokens: 999}});
  }
  assert.deepEqual(calls.map(x => x[3]), [0,154,-1]);
  assert.equal(new Set(calls.map(x => x[0])).size, 3);
  for (const args of calls) {
    assert.match(args[0], /^[0-9a-f]{32}$/);
    assert.deepEqual(args.slice(1,3), ["gpt-6.1-terra","conversation"]);
    assert.equal(args.length, 5);
    assert.equal(args[4], "0");
  }
  assert.equal(JSON.stringify(calls).includes("never-send"), false);
});

test("AI observer ignores opt-out, invalid model IDs and unstarted calls", () => {
  let draws = 0, calls = 0;
  const receiver = {beginAiUsage: () => "", logAiUsage: () => calls++};
  const crypto = {getRandomValues: () => draws++};
  const off = reporter.createObserver("model", "conversation", {receiver,crypto});
  off.onRequestStart(); off.onRequestEnd({});
  const invalid = reporter.createObserver("not a model", "conversation", {receiver,crypto});
  invalid.onRequestStart(); invalid.onRequestEnd({});
  reporter.createObserver("model", "compression", {receiver,crypto}).onRequestEnd({});
  assert.equal(draws,0); assert.equal(calls,0);
});

test("AI observer drops unsuccessful completions and optional reporting failures never escape", () => {
  const calls = [];
  const receiver = {beginAiUsage:()=>"2",logAiUsage:(...args)=>{calls.push(args);throw Error("optional");}};
  for (const result of [undefined, {}, {complete:false,usage:{totalTokens:50}}]) {
    const observer = reporter.createObserver("model", "compression", {crypto:webcrypto,receiver});
    observer.onRequestStart();
    assert.doesNotThrow(()=>observer.onRequestEnd(result));
    observer.onRequestEnd({complete:true,usage:{totalTokens:999}});
  }
  assert.equal(calls.length,0,"A failure must not report now or on a repeated callback");
  const successful = reporter.createObserver("model", "compression", {crypto:webcrypto,receiver});
  successful.onRequestStart();
  assert.doesNotThrow(()=>successful.onRequestEnd({complete:true,usage:{totalTokens:50}}));
  assert.equal(calls.length,1); assert.equal(calls[0][3],50);
});

function collector() {
  const calls=[], values=new Map(), listeners={};
  const document={documentElement:{lang:"en"},visibilityState:"visible",getElementById:()=>null,addEventListener:(k,f)=>listeners[k]=f};
  const window={location:{protocol:"https:",hostname:"hedanbaomi.github.io",pathname:"/tarot-divination-site/ai.html"},crypto:webcrypto,
    localStorage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,String(v)),removeItem:k=>values.delete(k)},
    addEventListener:(k,f)=>listeners[k]=f,fetch:async(url,opts)=>{calls.push(JSON.parse(opts.body));return{status:204};}};
  vm.runInNewContext(fs.readFileSync(require.resolve("../js/web-telemetry.js"),"utf8"),{window,document,Uint8Array,AbortController,setTimeout,clearTimeout});
  return {api:window.DivinationWebTelemetry,calls,values,listeners};
}

test("web collector rejects stale consent after off/on and sends a closed nullable usage payload", async () => {
  const c=collector(); const token=c.api.beginAiUsage();
  c.api.setEnabled(false); c.api.setEnabled(true);
  assert.equal(await c.api.logAiUsage("a".repeat(32),"model","conversation",123,token),false);
  assert.equal(c.calls.filter(x=>x.event==="ai_usage").length,0);
  const current=c.api.beginAiUsage();
  assert.equal(await c.api.logAiUsage("b".repeat(32),"model","compression",-1,current),true);
  const event=c.calls.filter(x=>x.event==="ai_usage")[0];
  assert.equal(event.total_tokens,null);
  assert.deepEqual(Object.keys(event).sort(),["app_version","event","install_hash","locale","model_id","platform","request_id","schema_version","total_tokens","usage_kind"]);
  assert.equal(await c.api.logAiUsage("bad","model","conversation",0,current),false);
  assert.equal(await c.api.logAiUsage("c".repeat(32),"model","conversation",NaN,current),false);
  c.api.setEnabled(false);
  assert.equal(c.api.beginAiUsage(),"");
  assert.equal(c.values.has("quareia-web-telemetry-id"),false);
});

test("provider-to-collector pipeline counts only successful conversation and compression calls", async (t) => {
  const providers = require("../js/ai-providers.js");
  const profile = providers.createDefaultProfile("openai-chat", {
    model:"gpt-4o-mini",baseUrl:"https://provider.invalid/v1",apiKey:"offline-fixture-key"
  });
  function sse(reason, usage, terminal=true) {
    const payload = {choices:[{delta:{content:"Synthetic reply"},finish_reason:reason}]};
    if (usage !== undefined) payload.usage={total_tokens:usage};
    return new Response("data: "+JSON.stringify(payload)+"\n\n"+(terminal?"data: [DONE]\n\n":""),
      {headers:{"Content-Type":"text/event-stream"}});
  }
  const scenarios = [
    {name:"HTTP 401", fetch:async()=>new Response("Unauthorized",{status:401}), error:"auth_failed"},
    {name:"HTTP 500", fetch:async()=>new Response("Unavailable",{status:500}), error:true},
    {name:"network failure", fetch:async()=>{throw new TypeError("offline");}, error:"network_error"},
    {name:"cancelled", fetch:async(_url,opts)=>{throw new DOMException("cancelled","AbortError");}, error:"aborted"},
    {name:"malformed response", fetch:async()=>new Response("invalid-json",{headers:{"Content-Type":"application/json"}}), error:true},
    {name:"premature EOF", fetch:async()=>sse(null,150,false), status:"truncated"},
    {name:"output limit", fetch:async()=>sse("length",150), status:"truncated"},
    {name:"blocked partial output", fetch:async()=>sse("content_filter",150), status:"blocked"},
    {name:"success with tokens", fetch:async()=>sse("stop",150), count:150},
    {name:"success with zero tokens", fetch:async()=>sse("stop",0), count:0},
    {name:"success without usage", fetch:async()=>sse("stop"), count:-1},
    {name:"JSON success without usage", fetch:async()=>new Response(JSON.stringify({choices:[{message:{content:"Synthetic reply"},finish_reason:"stop"}]}),{headers:{"Content-Type":"application/json"}}), count:-1}
  ];
  for (const kind of ["conversation","compression"]) for (const scenario of scenarios) {
    await t.test(kind+" / "+scenario.name, async () => {
      const calls=[];
      const observer=reporter.createObserver(profile.model,kind,{
        crypto:webcrypto,receiver:{beginAiUsage:()=>"1",logAiUsage:(...args)=>calls.push(args)}
      });
      const payload=Object.assign({},observer,{
        messages:[{role:"user",content:"Offline usage test"}],fetchImpl:scenario.fetch
      });
      const result=kind==="compression"?providers.compressMessages(profile,payload):providers.streamChat(profile,payload);
      if (scenario.error) await assert.rejects(result);
      else {
        const response=await result;
        if (scenario.status && kind==="conversation") assert.equal(response.completionStatus,scenario.status);
      }
      if (scenario.count !== undefined) {
        assert.equal(calls.length,1,"successful call must report exactly once");
        assert.equal(calls[0][2],kind); assert.equal(calls[0][3],scenario.count);
      } else assert.equal(calls.length,0,"unsuccessful call must not reach telemetry");
    });
  }
});
