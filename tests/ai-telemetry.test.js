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

test("incomplete responses are unknown and optional observer failures never escape", () => {
  let reported;
  const observer = reporter.createObserver("model", "compression", {crypto:webcrypto, receiver:{beginAiUsage:()=>"2",logAiUsage:(...args)=>{reported=args;throw Error("optional");}}});
  observer.onRequestStart();
  assert.doesNotThrow(()=>observer.onRequestEnd({complete:false,usage:{totalTokens:50}}));
  assert.equal(reported[3],-1); assert.equal(reported[2],"compression");
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
