"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const providers = require("../js/ai-providers.js");
const profile = { format: "openai-chat", baseUrl: "https://gateway.invalid/v1", apiKey: "fixture-only", model: "opaque-alias", maxTokens: 1234, temperature: 0.4 };
const messages = [{ role: "user", content: "Local compatibility fixture" }];
const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const ok = () => jsonResponse({ choices: [{ message: { content: "OK" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 } });
const unsupported = (param, message) => jsonResponse({ error: { code: "unsupported_parameter", param, message: message || `Unsupported parameter: '${param}' is not supported with this model.` } }, 400);

test("modern OpenAI families and namespaced IDs select completion limits without affecting other chat families", () => {
  for (const model of ["gpt-5", "gpt-5.6-sol", "gpt-6", "gpt-6.1-sol", "GPT-6.1-TERRA", "openai/gpt-6-astra", "openai:gpt-6-luna", "o1", "o3-mini", "o4-mini"]) {
    const req = providers.buildRequest({ ...profile, model }, { messages });
    assert.equal(req.body.max_completion_tokens, 1234, model);
    assert.equal("max_tokens" in req.body, false, model);
    assert.equal("temperature" in req.body, false, model);
  }
  for (const model of ["gpt-4o", "gpt-4.1", "deepseek-flash", "deepseek-v4-pro", "qwen3-max", "glm-4.7", "kimi-k2", "MiniMax-M2", "claude-sonnet-4-5", "gemini-2.5-pro", "opaque-alias"]) {
    const req = providers.buildRequest({ ...profile, model }, { messages });
    assert.equal(req.body.max_tokens, 1234, model);
    assert.equal(req.body.temperature, 0.4, model);
  }
  for (const [format, field, nested] of [["openai-responses", "max_output_tokens"], ["anthropic-messages", "max_tokens"], ["gemini-aistudio", "maxOutputTokens", "generationConfig"], ["gemini-vertex", "maxOutputTokens", "generationConfig"]]) {
    const req = providers.buildRequest({ ...profile, format }, { messages });
    assert.equal((nested ? req.body[nested] : req.body)[field], 1234, format);
  }
});

test("the reported max_tokens 400 recovers for opaque aliases without changing content, model, endpoint or credentials", async () => {
  const original = JSON.stringify(profile);
  const calls = [], events = [], deltas = [];
  const result = await providers.streamChat(profile, {
    systemPrompt: "Unchanged system prompt", messages,
    onRequestStart: () => events.push("start"), onRequestEnd: event => events.push(event),
    onDelta: delta => deltas.push(delta),
    fetchImpl: async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return calls.length === 1
        ? unsupported("max_tokens", "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.")
        : ok();
    }
  });
  assert.equal(result.text, "OK");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.max_completion_tokens, 1234);
  assert.equal("max_tokens" in calls[1].body, false);
  assert.deepEqual(calls[1].body.messages, calls[0].body.messages);
  assert.equal(calls[1].body.model, profile.model);
  assert.equal(calls[1].url, calls[0].url);
  assert.deepEqual(calls[1].headers, calls[0].headers);
  assert.equal(JSON.stringify(profile), original);
  assert.deepEqual(deltas, ["OK"]);
  assert.equal(events.length, 2);
  assert.equal(events[1].complete, true);
  assert.equal(events[1].usage.totalTokens, 3);
});

test("legacy gateways can reject the modern field, including FastAPI 422 extra-field responses", async () => {
  for (const error of [
    () => new Response("Unrecognized request argument supplied: max_completion_tokens", { status: 400 }),
    () => jsonResponse({ detail: [{ type: "extra_forbidden", loc: ["body", "max_completion_tokens"], msg: "Extra inputs are not permitted" }] }, 422)
  ]) {
    const calls = [];
    await providers.streamChat({ ...profile, model: "gpt-6.1-sol" }, { messages, fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return calls.length === 1 ? error() : ok();
    } });
    assert.equal(calls.length, 2);
    assert.equal(calls[1].max_tokens, 1234);
    assert.equal("max_completion_tokens" in calls[1], false);
  }
});

test("chained explicit compatibility failures are bounded and can fall back to non-streaming JSON", async () => {
  const calls = [];
  const result = await providers.streamChat(profile, { messages, fetchImpl: async (_url, init) => {
    calls.push(JSON.parse(init.body));
    if (calls.length === 1) return unsupported("max_tokens");
    if (calls.length === 2) return jsonResponse({ error: { code: "unsupported_value", param: "temperature", message: "Unsupported value: 'temperature' does not support 0.4 with this model. Only the default (1) value is supported." } }, 400);
    if (calls.length === 3) return unsupported("stream");
    return ok();
  } });
  assert.equal(result.text, "OK");
  assert.equal(calls.length, 4);
  assert.equal(calls[3].max_completion_tokens, 1234);
  assert.equal("temperature" in calls[3], false);
  assert.equal("stream" in calls[3], false);
});

test("unsupported optional sampling and stream usage fields do not change protocol-specific token fields", async () => {
  for (const [format, param] of [["openai-responses", "temperature"], ["anthropic-messages", "temperature"], ["gemini-aistudio", "generationConfig.temperature"], ["gemini-vertex", "generation_config.temperature"], ["openai-chat", "stream_options"]]) {
    const calls = [];
    const responseBody = format === "openai-responses" ? { output: [{ type: "message", content: [{ type: "output_text", text: "OK" }] }], status: "completed" }
      : format === "anthropic-messages" ? { content: [{ type: "text", text: "OK" }], stop_reason: "end_turn" }
      : format.startsWith("gemini") ? { candidates: [{ content: { parts: [{ text: "OK" }] }, finishReason: "STOP" }] }
      : { choices: [{ message: { content: "OK" }, finish_reason: "stop" }] };
    const result = await providers.streamChat({ ...profile, format, baseUrl: providers.DEFAULT_BASE_URLS[format] }, { messages, fetchImpl: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return calls.length === 1 ? unsupported(param) : jsonResponse(responseBody);
    } });
    assert.equal(result.text, "OK", format);
    assert.equal(calls.length, 2, format);
    const before = structuredClone(calls[0]);
    if (format.startsWith("gemini")) delete before.generationConfig.temperature;
    else delete before[param];
    assert.deepEqual(calls[1], before, format);
  }
});

test("compatibility fallback never loops token aliases, strips limits, or crosses API formats", async () => {
  let calls = 0;
  await assert.rejects(providers.streamChat(profile, { messages, fetchImpl: async (_url, init) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.equal(body.max_tokens || body.max_completion_tokens, 1234);
    return unsupported("max_tokens" in body ? "max_tokens" : "max_completion_tokens");
  } }), { code: "http_error", status: 400 });
  assert.equal(calls, 2);
  for (const format of ["openai-responses", "anthropic-messages", "gemini-aistudio", "gemini-vertex"]) {
    calls = 0;
    await assert.rejects(providers.streamChat({ ...profile, format }, { messages, fetchImpl: async () => {
      calls++;
      return unsupported(format === "openai-responses" ? "max_output_tokens" : "max_tokens");
    } }), { code: "http_error" });
    assert.equal(calls, 1, format);
  }
});

test("auth, quota, server, range and unrelated validation failures never trigger compatibility retries", async () => {
  const errors = [
    ...[401, 403, 429, 500, 502].map(status => () => jsonResponse({ error: { param: "max_tokens", code: "unsupported_parameter", message: "Unsupported parameter: max_tokens" } }, status)),
    () => jsonResponse({ error: { param: "max_tokens", message: "max_tokens is too large; reduce its value" } }, 400),
    () => jsonResponse({ error: { param: "messages", message: "Invalid message containing Unsupported parameter: max_tokens" } }, 400),
    () => jsonResponse({ error: { code: "context_length_exceeded", message: "Maximum context length exceeded; reduce max_tokens" } }, 400),
    () => jsonResponse({ error: { param: "temperature", message: "temperature must be between 0 and 1" } }, 422)
  ];
  for (const error of errors) {
    let calls = 0;
    await assert.rejects(providers.streamChat(profile, { messages, fetchImpl: async () => { calls++; return error(); } }));
    assert.equal(calls, 1);
  }
});

test("unrelated structured errors and echoed user text cannot authorize a compatibility retry", async () => {
  for (const error of [
    () => jsonResponse({ error: { code: "content_policy_violation", message: "Rejected user input: Unsupported parameter: max_tokens" } }, 400),
    () => jsonResponse({ error: { code: "context_length_exceeded", message: "Unsupported parameter: max_tokens" } }, 400),
    () => jsonResponse({ error: { code: "content_policy_violation", param: "max_tokens", message: "Unsupported parameter: max_tokens" } }, 400),
    () => jsonResponse({ error: { message: "Rejected user input: Unsupported parameter: max_tokens" } }, 400),
    () => jsonResponse({ error: { message: "Unsupported parameter: max_tokens is quoted in the rejected user message" } }, 400),
    () => new Response("max_tokens is not supported is a quote from the rejected prompt", { status: 400 }),
    () => new Response("Rejected user input: Unsupported parameter: max_tokens", { status: 400 })
  ]) {
    let calls = 0;
    await assert.rejects(providers.streamChat(profile, { messages, fetchImpl: async () => {
      calls++;
      return calls === 1 ? error() : ok();
    } }), { code: "http_error", status: 400 });
    assert.equal(calls, 1);
  }
});

test("standalone diagnostics without structured codes accept only recognized complete forms", async () => {
  for (const diagnostic of [
    "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.",
    "max_tokens is not supported with this model.",
    "Unknown parameter: max_tokens.",
    "Error: Unknown parameter: max_tokens"
  ]) {
    let calls = 0;
    const result = await providers.streamChat(profile, { messages, fetchImpl: async () => {
      calls++;
      return calls === 1 ? jsonResponse({ error: { message: diagnostic } }, 400) : ok();
    } });
    assert.equal(result.text, "OK");
    assert.equal(calls, 2);
  }
});

test("compatibility requests stop after three corrections and never retry network errors", async () => {
  let calls = 0;
  const fields = ["max_tokens", "temperature", "stream_options", "stream"];
  await assert.rejects(providers.streamChat({ ...profile, baseUrl: "https://api.openai.com/v1" }, { messages, fetchImpl: async () => {
    return unsupported(fields[calls++]);
  } }), { code: "http_error", status: 400 });
  assert.equal(calls, 4);
  calls = 0;
  await assert.rejects(providers.streamChat(profile, { messages, fetchImpl: async () => {
    calls++;
    throw new Error("Unsupported parameter: max_tokens");
  } }), { code: "network_error" });
  assert.equal(calls, 1);
});

test("abort and failures after any output never restart generation", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(providers.streamChat(profile, { messages, signal: controller.signal, fetchImpl: async () => {
    calls++;
    const response = unsupported("max_tokens");
    const text = response.text.bind(response);
    response.text = async () => { const value = await text(); controller.abort(); return value; };
    return response;
  } }), { code: "aborted" });
  assert.equal(calls, 1);
  const deltas = [];
  calls = 0;
  await assert.rejects(providers.streamChat(profile, { messages, onDelta: text => deltas.push(text), fetchImpl: async () => {
    calls++;
    return new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\ndata: {"error":{"message":"Unsupported parameter: max_tokens"}}\n\n', { headers: { "content-type": "text/event-stream" } });
  } }));
  assert.equal(calls, 1);
  assert.deepEqual(deltas, ["partial"]);
});

test("connection probes and context compression use the same compatibility path", async () => {
  for (const mode of ["probe", "compression"]) {
    const calls = [];
    const fetchImpl = async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return calls.length === 1 ? unsupported("max_tokens") : ok();
    };
    const result = mode === "probe" ? await providers.testConnection(profile, { fetchImpl })
      : await providers.compressMessages(profile, { messages, fetchImpl });
    assert.equal(mode === "probe" ? result.reply : result.summaryText, "OK");
    assert.equal(calls.length, 2);
    assert.equal(calls[1].max_completion_tokens, mode === "probe" ? 256 : 2048);
  }
});
