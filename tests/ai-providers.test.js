"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const providers = require("../js/ai-providers.js");

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    removeItem(k) {
      map.delete(k);
    }
  };
}

function createSseResponse(chunks, status = 200, contentType = "text/event-stream; charset=utf-8") {
  const encoder = new TextEncoder();
  const encodedChunks = chunks.map((item) => (typeof item === "string" ? encoder.encode(item) : item));
  let idx = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-type" ? contentType : null;
      }
    },
    body: {
      getReader() {
        return {
          read() {
            if (idx >= encodedChunks.length) {
              return Promise.resolve({ done: true, value: undefined });
            }
            const value = encodedChunks[idx];
            idx += 1;
            return Promise.resolve({ done: false, value });
          },
          cancel() {
            idx = encodedChunks.length;
            return Promise.resolve();
          }
        };
      }
    },
    text() {
      const decoder = new TextDecoder();
      return Promise.resolve(encodedChunks.map((c) => decoder.decode(c, { stream: true })).join("") + decoder.decode());
    }
  };
}

test("SSE extension-only fields are ignored without hiding a plain-text proxy failure", async () => {
  const profile = providers.createDefaultProfile("openai-chat", {
    baseUrl: "http://localhost:1234/v1", apiKey: "fixture-extension-key", model: "fixture"
  });
  for (const contentType of ["text/event-stream", "text/plain"]) {
    const result = await providers.streamChat(profile, {
      messages: [{ role: "user", content: "fixture" }],
      fetchImpl: async () => createSseResponse([
        "trace-id: fixture\ncustom field: ignored\nbare-field\n\n",
        'data: {"choices":[{"delta":{"content":"Valid answer"},"finish_reason":"stop"}]}\n\n',
        "extension-only: tail"
      ], 200, contentType)
    });
    assert.equal(result.text, "Valid answer");
    assert.equal(result.completionStatus, "complete");
    assert.equal(result.finishReason, "stop");
  }
  await assert.rejects(providers.streamChat(profile, {
    messages: [{ role: "user", content: "fixture" }],
    fetchImpl: async () => createSseResponse(["proxy failed: fixture-extension-key\n\n"], 200, "text/plain")
  }), err => {
    assert.equal(err.code, "invalid_response");
    assert.equal(err.message.includes("fixture-extension-key"), false);
    return true;
  });
});

test("buildRequest builds strictly isolated headers and URLs for all 5 API formats", () => {
  const messages = [
    { role: "user", content: "What does this spread indicate?" },
    { role: "assistant", content: "Let us look at position 1." },
    { role: "user", content: "Go deeper." }
  ];

  // 1. OpenAI Chat Completions
  const chatReq = providers.buildRequest({
    format: "openai-chat",
    baseUrl: "https://api.openai.com/v1/",
    apiKey: "sk-chat-123456",
    model: "gpt-4o",
    temperature: 0.4,
    maxTokens: 1500
  }, { systemPrompt: "System prompt", messages });
  assert.equal(chatReq.url, "https://api.openai.com/v1/chat/completions");
  assert.deepEqual(Object.keys(chatReq.headers), ["Content-Type", "Authorization"]);
  assert.equal(chatReq.headers.Authorization, "Bearer sk-chat-123456");
  assert.equal(chatReq.body.messages[0].role, "system");
  assert.equal(chatReq.body.stream, true);
  assert.equal(chatReq.body.max_tokens, 1500);

  // 2. OpenAI Responses API
  const respReq = providers.buildRequest({
    format: "openai-responses",
    baseUrl: "https://api.openai.com",
    apiKey: "sk-resp-123456",
    model: "gpt-4.1-mini"
  }, { systemPrompt: "Be concise", messages });
  assert.equal(respReq.url, "https://api.openai.com/v1/responses");
  assert.deepEqual(Object.keys(respReq.headers), ["Content-Type", "Authorization"]);
  assert.equal(respReq.body.instructions, "Be concise");
  assert.equal(respReq.body.input.length, 3);

  // 3. Anthropic Messages API
  const anthReq = providers.buildRequest({
    format: "anthropic-messages",
    baseUrl: "https://api.anthropic.com/v1",
    apiKey: "sk-ant-123456",
    model: "claude-sonnet-4-20250514"
  }, { systemPrompt: "Quareia context", messages });
  assert.equal(anthReq.url, "https://api.anthropic.com/v1/messages");
  assert.deepEqual(anthReq.headers, {
    "content-type": "application/json",
    "x-api-key": "sk-ant-123456",
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true"
  });
  assert.equal(anthReq.body.max_tokens, 4096);
  assert.equal(anthReq.body.system, "Quareia context");

  // 4. Gemini AI Studio
  const studioReq = providers.buildRequest({
    format: "gemini-aistudio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "AIzaSyTest12345678",
    model: "models/gemini-2.5-flash"
  }, { systemPrompt: "Sys", messages });
  assert.equal(
    studioReq.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
  );
  assert.deepEqual(studioReq.headers, {
    "content-type": "application/json",
    "x-goog-api-key": "AIzaSyTest12345678"
  });
  assert.equal(studioReq.headers.Authorization, undefined);
  assert.equal(studioReq.body.contents[1].role, "model");
  assert.equal(studioReq.body.systemInstruction.parts[0].text, "Sys");

  // 5a. Gemini Vertex Express (static key only, no OAuth)
  const vertexExpressReq = providers.buildRequest({
    format: "gemini-vertex",
    baseUrl: "https://aiplatform.googleapis.com/v1",
    apiKey: "AQ.VertexKey123456",
    model: "gemini-2.5-pro"
  }, { systemPrompt: "Vertex Sys", messages });
  assert.equal(
    vertexExpressReq.url,
    "https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-2.5-pro:streamGenerateContent?alt=sse"
  );
  assert.deepEqual(vertexExpressReq.headers, {
    "content-type": "application/json",
    "x-goog-api-key": "AQ.VertexKey123456"
  });

  // 5b. Gemini Vertex Regional Project (static key only)
  const vertexProjectReq = providers.buildRequest({
    format: "gemini-vertex",
    baseUrl: "https://aiplatform.googleapis.com/v1",
    vertexProject: "my-gcp-project",
    vertexLocation: "us-central1",
    apiKey: "AQ.VertexRegionalKey",
    model: "gemini-2.5-flash"
  }, { systemPrompt: "Sys", messages });
  assert.equal(
    vertexProjectReq.url,
    "https://us-central1-aiplatform.googleapis.com/v1/projects/my-gcp-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
  );
  assert.deepEqual(Object.keys(vertexProjectReq.headers), ["content-type", "x-goog-api-key"]);
});

test("validateProfile permits HTTPS and localhost HTTP, rejects remote HTTP and missing key/model", () => {
  assert.equal(providers.validateProfile({
    format: "openai-chat",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiKey: "local",
    model: "qwen2.5"
  }).ok, true);

  const bad = providers.validateProfile({
    format: "openai-chat",
    baseUrl: "http://example.com/v1",
    apiKey: "",
    model: ""
  });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors, ["insecure_http_url", "missing_api_key", "missing_model"]);
});

test("streamChat handles chunked UTF-8 multi-byte SSE across all stream formats", async () => {
  // Split a Chinese UTF-8 payload across Uint8Array boundaries intentionally.
  const fullOpenAiSse = [
    'data: {"choices":[{"delta":{"reasoning_content":"思考中..."}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"牌面显示："}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"需稳步前行。"}}]}\n\n',
    "data: [DONE]\n\n"
  ].join("");
  const bytes = new TextEncoder().encode(fullOpenAiSse);
  const splitChunks = [];
  for (let i = 0; i < bytes.length; i += 7) {
    splitChunks.push(bytes.slice(i, i + 7));
  }

  let deltas = [];
  let reasonings = [];
  const resChat = await providers.streamChat({
    format: "openai-chat",
    baseUrl: "https://api.openai.com/v1",
    apiKey: "sk-test",
    model: "gpt-4o"
  }, {
    messages: [{ role: "user", content: "解读" }],
    onDelta: (d) => deltas.push(d),
    onReasoning: (r) => reasonings.push(r),
    fetchImpl: async () => createSseResponse(splitChunks)
  });
  assert.equal(resChat.text, "牌面显示：需稳步前行。");
  assert.equal(resChat.reasoning, "思考中...");
  assert.equal(resChat.completionStatus, "complete");
  assert.equal(deltas.join(""), "牌面显示：需稳步前行。");
  assert.equal(reasonings.join(""), "思考中...");

  // OpenAI Responses SSE
  const resResponses = await providers.streamChat({
    format: "openai-responses",
    apiKey: "sk-test",
    model: "gpt-4.1"
  }, {
    messages: [{ role: "user", content: "Hello" }],
    fetchImpl: async () => createSseResponse([
      'event: response.reasoning_summary_text.delta\ndata: {"type":"response.reasoning_summary_text.delta","delta":"Step 1"}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Answer "}\n\n',
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"here."}\n\n',
      'event: response.completed\ndata: {"type":"response.completed"}\n\n'
    ])
  });
  assert.equal(resResponses.reasoning, "Step 1");
  assert.equal(resResponses.text, "Answer here.");

  // Anthropic Messages SSE
  const resAnth = await providers.streamChat({
    format: "anthropic-messages",
    apiKey: "sk-ant",
    model: "claude-sonnet-4-20250514"
  }, {
    messages: [{ role: "user", content: "Hi" }],
    fetchImpl: async () => createSseResponse([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"Weighing cards"}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Balanced path"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ])
  });
  assert.equal(resAnth.reasoning, "Weighing cards");
  assert.equal(resAnth.text, "Balanced path");

  // Gemini AI Studio / Vertex SSE with thought part + text part
  const resGemini = await providers.streamChat({
    format: "gemini-vertex",
    apiKey: "AQ.static-key",
    model: "gemini-2.5-flash"
  }, {
    messages: [{ role: "user", content: "Hi" }],
    fetchImpl: async () => createSseResponse([
      'data: {"candidates":[{"content":{"parts":[{"text":"Internal note","thought":true}]}}]}\n\n',
      'data: {"candidates":[{"content":{"parts":[{"text":"Visible interpretation"}]},"finishReason":"STOP"}]}\n\n'
    ])
  });
  assert.equal(resGemini.reasoning, "Internal note");
  assert.equal(resGemini.text, "Visible interpretation");
});

test("streamChat retains partial output and reports provider completion reasons", async () => {
  const chatPartial = await providers.streamChat({
    format: "openai-chat",
    apiKey: "sk-partial-chat",
    model: "gpt-4o"
  }, {
    messages: [{ role: "user", content: "Explain" }],
    fetchImpl: async () => createSseResponse([
      ": keep-alive\n\n",
      'event: ping\ndata: {"type":"ping"}\n\n',
      'data: {"choices":[{"delta":{"content":"Partial "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"answer"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      "data: [DONE]\n\n"
    ])
  });
  assert.equal(chatPartial.text, "Partial answer");
  assert.equal(chatPartial.completionStatus, "truncated");
  assert.equal(chatPartial.finishReason, "length");

  const responsesPartial = await providers.streamChat({
    format: "openai-responses",
    apiKey: "sk-partial-response",
    model: "gpt-4.1"
  }, {
    messages: [{ role: "user", content: "Explain" }],
    fetchImpl: async () => createSseResponse([
      'event: response.output_text.delta\ndata: {"type":"response.output_text.delta","delta":"Response prefix"}\n\n',
      'event: response.incomplete\ndata: {"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}\n\n'
    ])
  });
  assert.equal(responsesPartial.text, "Response prefix");
  assert.equal(responsesPartial.completionStatus, "truncated");
  assert.equal(responsesPartial.finishReason, "max_output_tokens");

  const anthropicPartial = await providers.streamChat({
    format: "anthropic-messages",
    apiKey: "sk-partial-anthropic",
    model: "claude-sonnet-4-20250514"
  }, {
    messages: [{ role: "user", content: "Explain" }],
    fetchImpl: async () => createSseResponse([
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Anthropic prefix"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ])
  });
  assert.equal(anthropicPartial.text, "Anthropic prefix");
  assert.equal(anthropicPartial.completionStatus, "truncated");
  assert.equal(anthropicPartial.finishReason, "max_tokens");

  const safetyResponse = await providers.streamChat({
    format: "openai-responses",
    apiKey: "sk-response-filter",
    model: "gpt-4.1"
  }, {
    stream: false,
    messages: [{ role: "user", content: "Explain" }],
    fetchImpl: async () => createSseResponse([JSON.stringify({
      object: "response",
      status: "incomplete",
      incomplete_details: { reason: "content_filter" },
      output: [{ type: "message", content: [{ type: "output_text", text: "Filtered prefix" }] }]
    })], 200, "application/json")
  });
  assert.equal(safetyResponse.text, "Filtered prefix");
  assert.equal(safetyResponse.completionStatus, "blocked");
  assert.equal(safetyResponse.finishReason, "content_filter");

  for (const reason of ["SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII"]) {
    const geminiPartial = await providers.streamChat({
      format: "gemini-vertex",
      apiKey: "AQ.test-gemini",
      model: "gemini-2.5-flash"
    }, {
      stream: false,
      messages: [{ role: "user", content: "Explain" }],
      fetchImpl: async () => createSseResponse([JSON.stringify({
        candidates: [{ content: { role: "model", parts: [{ text: "Gemini prefix" }] }, finishReason: reason }]
      })], 200, "application/json")
    });
    assert.equal(geminiPartial.text, "Gemini prefix", reason);
    assert.equal(geminiPartial.completionStatus, "blocked", reason);
    assert.equal(geminiPartial.finishReason, reason, reason);
  }

  const geminiTruncated = await providers.streamChat({
    format: "gemini-aistudio",
    apiKey: "AIza-test-gemini",
    model: "gemini-2.5-flash"
  }, {
    stream: false,
    messages: [{ role: "user", content: "Explain" }],
    fetchImpl: async () => createSseResponse([JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: "Gemini prefix" }] }, finishReason: "MAX_TOKENS" }]
    })], 200, "application/json")
  });
  assert.equal(geminiTruncated.text, "Gemini prefix");
  assert.equal(geminiTruncated.completionStatus, "truncated");
  assert.equal(geminiTruncated.finishReason, "MAX_TOKENS");

  const unspecifiedPromptBlock = await providers.streamChat({
    format: "gemini-aistudio",
    apiKey: "AIza-unspecified-block",
    model: "gemini-2.5-flash"
  }, {
    stream: false,
    messages: [{ role: "user", content: "Explain" }],
    fetchImpl: async () => createSseResponse([JSON.stringify({
      promptFeedback: { blockReason: "BLOCK_REASON_UNSPECIFIED" },
      candidates: [{ content: { role: "model", parts: [{ text: "Gemini prefix" }] }, finishReason: "MAX_TOKENS" }]
    })], 200, "application/json")
  });
  assert.equal(unspecifiedPromptBlock.text, "Gemini prefix");
  assert.equal(unspecifiedPromptBlock.completionStatus, "truncated");
  assert.equal(unspecifiedPromptBlock.finishReason, "MAX_TOKENS");
});

test("streamChat distinguishes terminal SSE responses, premature EOF, and non-SSE JSON", async () => {
  const partialStreams = [
    { format: "openai-chat", payload: { choices: [{ delta: { content: "Chat partial" } }] }, text: "Chat partial" },
    { format: "openai-responses", payload: { type: "response.output_text.delta", delta: "Responses partial" }, text: "Responses partial" },
    { format: "anthropic-messages", payload: { type: "content_block_delta", delta: { type: "text_delta", text: "Anthropic partial" } }, text: "Anthropic partial" },
    { format: "gemini-aistudio", payload: { candidates: [{ content: { parts: [{ text: "AI Studio partial" }] } }] }, text: "AI Studio partial" },
    { format: "gemini-vertex", payload: { candidates: [{ content: { parts: [{ text: "Vertex partial" }] } }] }, text: "Vertex partial" }
  ];
  for (const fixture of partialStreams) {
    const result = await providers.streamChat({ format: fixture.format, apiKey: "fixture-key", model: "test" }, {
      messages: [{ role: "user", content: "hello" }],
      fetchImpl: async () => createSseResponse(['data: ' + JSON.stringify(fixture.payload) + "\n\n"])
    });
    assert.equal(result.text, fixture.text, fixture.format);
    assert.equal(result.completionStatus, "truncated", fixture.format);
    assert.equal(result.finishReason, "stream_closed", fixture.format);
  }

  const emptyStreams = [
    { format: "openai-chat", payload: { choices: [{ delta: { role: "assistant" } }], usage: { prompt_tokens: 1 } } },
    { format: "openai-responses", payload: { type: "response.created", response: { usage: { input_tokens: 1 } } } },
    { format: "anthropic-messages", payload: { type: "message_start", message: { usage: { input_tokens: 1, output_tokens: 0 } } } },
    { format: "gemini-aistudio", payload: { usageMetadata: { promptTokenCount: 1 } } },
    { format: "gemini-vertex", payload: { usageMetadata: { promptTokenCount: 1 } } }
  ];
  for (const fixture of emptyStreams) {
    await assert.rejects(() => providers.streamChat({ format: fixture.format, apiKey: "fixture-key", model: "test" }, {
      allowEmptyOutput: true,
      messages: [{ role: "user", content: "hello" }],
      fetchImpl: async () => createSseResponse(['data: ' + JSON.stringify(fixture.payload) + "\n\n"])
    }), (err) => {
      assert.equal(err.code, "response_incomplete", fixture.format);
      assert.equal(err.detail, "stream_closed", fixture.format);
      return true;
    });
  }

  const terminalProbes = [
    { format: "openai-chat", payload: { choices: [{ delta: {}, finish_reason: "stop" }] } },
    { format: "openai-responses", event: "response.completed", payload: { type: "response.completed" } },
    { format: "anthropic-messages", event: "message_stop", payload: { type: "message_stop" } },
    { format: "gemini-aistudio", payload: { candidates: [{ content: { role: "model" }, finishReason: "STOP" }] } },
    { format: "gemini-vertex", payload: { candidates: [{ content: { role: "model" }, finishReason: "STOP" }] } }
  ];
  for (const fixture of terminalProbes) {
    const eventName = fixture.event ? "event: " + fixture.event + "\n" : "";
    const result = await providers.streamChat({ format: fixture.format, apiKey: "fixture-key", model: "test" }, {
      allowEmptyOutput: true,
      messages: [{ role: "user", content: "hello" }],
      fetchImpl: async () => createSseResponse([eventName + "data: " + JSON.stringify(fixture.payload) + "\n\n"])
    });
    assert.equal(result.text, "", fixture.format);
    assert.equal(result.completionStatus, "complete", fixture.format);
  }

  const jsonResult = await providers.streamChat({ format: "openai-chat", apiKey: "fixture-key", model: "test" }, {
    messages: [{ role: "user", content: "hello" }],
    fetchImpl: async () => createSseResponse([JSON.stringify({ choices: [{ message: { content: "Valid JSON fallback" } }] })], 200, "application/json")
  });
  assert.equal(jsonResult.text, "Valid JSON fallback");
  assert.equal(jsonResult.completionStatus, "complete");
  assert.equal(jsonResult.finishReason, "");

  const prettyJsonFallback = await providers.streamChat({ format: "openai-chat", apiKey: "fixture-key", model: "test" }, {
    messages: [{ role: "user", content: "hello" }],
    fetchImpl: async () => createSseResponse([
      '{\n  "choices": [{ "message": { "content": "Pretty JSON fallback" } }],\n\n  "usage": { "prompt_tokens": 1 }\n}'
    ], 200, "text/plain")
  });
  assert.equal(prettyJsonFallback.text, "Pretty JSON fallback");
  assert.equal(prettyJsonFallback.completionStatus, "complete");

  const emptyJsonProbe = await providers.streamChat({ format: "openai-chat", apiKey: "fixture-key", model: "test" }, {
    stream: false,
    allowEmptyOutput: true,
    messages: [{ role: "user", content: "hello" }],
    fetchImpl: async () => createSseResponse([JSON.stringify({
      choices: [{ message: { role: "assistant", content: "" } }],
      usage: { prompt_tokens: 1, completion_tokens: 0 }
    })], 200, "application/json")
  });
  assert.equal(emptyJsonProbe.text, "");
  assert.equal(emptyJsonProbe.completionStatus, "complete");
});

test("streamChat rejects empty blocked or truncated probes and diagnoses invalid 200 proxy bodies safely", async () => {
  await assert.rejects(() => providers.streamChat({
    format: "gemini-aistudio",
    apiKey: "AIza-safety-probe",
    model: "gemini-2.5-flash"
  }, {
    stream: false,
    allowEmptyOutput: true,
    messages: [{ role: "user", content: "Reply" }],
    fetchImpl: async () => createSseResponse([JSON.stringify({
      promptFeedback: { blockReason: "SAFETY" },
      usageMetadata: { promptTokenCount: 14, thoughtsTokenCount: 256, totalTokenCount: 270 }
    })], 200, "application/json")
  }), (err) => {
    assert.equal(err.code, "content_blocked");
    assert.equal(err.detail, "SAFETY");
    return true;
  });

  await assert.rejects(() => providers.streamChat({
    format: "gemini-aistudio",
    apiKey: "AIza-empty-truncated",
    model: "gemini-2.5-flash"
  }, {
    stream: false,
    allowEmptyOutput: true,
    messages: [{ role: "user", content: "Reply" }],
    fetchImpl: async () => createSseResponse([JSON.stringify({
      candidates: [{ content: { role: "model" }, finishReason: "MAX_TOKENS" }],
      usageMetadata: { promptTokenCount: 14, thoughtsTokenCount: 256, totalTokenCount: 270 }
    })], 200, "application/json")
  }), (err) => err.code === "output_truncated");

  for (const testCase of [
    { stream: false, contentType: "text/html", body: "<html><body>Proxy echoed sk-proxy-secret-4321</body></html>" },
    { stream: true, contentType: "text/plain", body: "Upstream proxy echoed sk-proxy-secret-4321 and returned plain text." }
  ]) {
    await assert.rejects(() => providers.streamChat({
      format: "openai-chat",
      apiKey: "sk-proxy-secret-4321",
      model: "gpt-4o"
    }, {
      stream: testCase.stream,
      messages: [{ role: "user", content: "Reply" }],
      fetchImpl: async () => createSseResponse([testCase.body], 200, testCase.contentType)
    }), (err) => {
      assert.equal(err.code, "invalid_response");
      assert.ok(err.detail.length <= 240);
      assert.equal(err.message.includes("sk-proxy-secret-4321"), false);
      assert.equal(err.detail.includes("sk-proxy-secret-4321"), false);
      assert.ok(err.detail.length > 0);
      return true;
    });
  }

  const partialDeltas = [];
  await assert.rejects(() => providers.streamChat({
    format: "openai-chat",
    apiKey: "sk-partial-proxy-4321",
    model: "gpt-4o"
  }, {
    messages: [{ role: "user", content: "Reply" }],
    onDelta: (delta) => partialDeltas.push(delta),
    fetchImpl: async () => createSseResponse([
      'data: {"choices":[{"delta":{"content":"Kept partial answer"}}]}\n\n',
      "data: proxy returned malformed text and sk-partial-proxy-4321\n\n"
    ])
  }), (err) => {
    assert.equal(err.code, "invalid_response");
    assert.equal(err.message.includes("sk-partial-proxy-4321"), false);
    assert.ok(err.detail.length <= 240);
    return true;
  });
  assert.equal(partialDeltas.join(""), "Kept partial answer");
});

test("streamChat handles non-SSE JSON fallback, HTTP error redaction, and AbortController", async () => {
  // Non-SSE JSON response
  const jsonRes = await providers.streamChat({
    format: "openai-chat",
    apiKey: "sk-secret-key-9999",
    model: "gpt-4o"
  }, {
    messages: [{ role: "user", content: "Ping" }],
    fetchImpl: async () => createSseResponse([
      JSON.stringify({ choices: [{ message: { content: "OK" } }] })
    ], 200, "application/json")
  });
  assert.equal(jsonRes.text, "OK");

  // 401 redacts echoed API key
  await assert.rejects(() => providers.streamChat({
    format: "openai-chat",
    apiKey: "sk-secret-key-9999",
    model: "gpt-4o"
  }, {
    messages: [{ role: "user", content: "Ping" }],
    fetchImpl: async () => createSseResponse([
      JSON.stringify({ error: { message: "Incorrect API key provided: sk-secret-key-9999." } })
    ], 401, "application/json")
  }), (err) => {
    assert.equal(err.code, "auth_error");
    assert.equal(err.status, 401);
    assert.equal(err.message.includes("sk-secret-key-9999"), false);
    assert.equal(err.message.includes("sk-s...9999"), true);
    return true;
  });

  // AbortController
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => providers.streamChat({
    format: "gemini-aistudio",
    apiKey: "AIzaSy-key",
    model: "gemini-2.5-flash"
  }, {
    messages: [{ role: "user", content: "Ping" }],
    signal: controller.signal,
    fetchImpl: async () => {
      throw new Error("Should not call fetch after abort");
    }
  }), (err) => err.code === "aborted");
});

test("createConfigStore persists across storage and restores from nativeBridge when storage is empty", () => {
  const storage = createMemoryStorage();
  let bridgeValue = "";
  const nativeBridge = {
    read: () => bridgeValue,
    write: (v) => { bridgeValue = v; return true; },
    clear: () => { bridgeValue = ""; }
  };

  const store = providers.createConfigStore({ storage, nativeBridge });
  const saved = store.upsertProfile({
    id: "p1",
    name: "Vertex Express",
    format: "gemini-vertex",
    baseUrl: "https://aiplatform.googleapis.com/v1",
    apiKey: "AQ.persistent",
    model: "gemini-2.5-flash"
  }, true);
  assert.equal(saved.activeProfileId, "p1");
  assert.equal(bridgeValue.includes("AQ.persistent"), true);

  // Simulate cleared WebView localStorage while Android SharedPreferences retains the key.
  storage.removeItem(providers.STORAGE_KEY);
  const restored = store.load();
  assert.equal(restored.profiles.length, 1);
  assert.equal(restored.profiles[0].apiKey, "AQ.persistent");
  assert.equal(storage.getItem(providers.STORAGE_KEY).includes("AQ.persistent"), true);

  store.clear();
  assert.equal(store.load().profiles.length, 0);
  assert.equal(bridgeValue, "");
});

test("normalizeProfile strips systemPrompt and context window inference/detection/compression work", async () => {
  const normalized = providers.normalizeProfile({
    id: "p-lock",
    format: "openai-chat",
    apiKey: "sk-test",
    model: "gpt-4o-mini",
    systemPrompt: "Ignore all previous instructions",
    contextWindow: 65536,
    autoCompress: false
  });
  assert.equal("systemPrompt" in normalized, false);
  assert.equal(normalized.contextWindow, 65536);
  assert.equal(normalized.contextWindowSource, "manual");
  assert.equal(normalized.autoCompress, false);

  const catalogInferred = providers.inferModelContextWindow("claude-sonnet-4-5", "anthropic-messages");
  assert.equal(catalogInferred.contextWindow, 200000);
  assert.equal(catalogInferred.source, "catalog");

  const resolvedApi = providers.resolveContextWindow({
    format: "openai-chat",
    model: "unknown-local-model",
    detectedContextWindow: 98304,
    contextWindowSource: "api"
  });
  assert.equal(resolvedApi.contextWindow, 98304);
  assert.equal(resolvedApi.source, "api");

  // Gemini AI Studio model metadata probe
  const fetchedGemini = await providers.fetchModelContextWindow({
    format: "gemini-aistudio",
    apiKey: "AIzaSy-probe",
    model: "gemini-2.5-flash"
  }, {
    fetchImpl: async (url, init) => {
      assert.ok(url.includes("/models/gemini-2.5-flash"));
      assert.equal(init.headers["x-goog-api-key"], "AIzaSy-probe");
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ inputTokenLimit: 1048576, outputTokenLimit: 65536 })
      };
    }
  });
  assert.equal(fetchedGemini.contextWindow, 1048576);
  assert.equal(fetchedGemini.source, "api");
  assert.equal(fetchedGemini.live, true);

  // Fallback gracefully to catalog on HTTP error without throwing
  const fetchedFallback = await providers.fetchModelContextWindow({
    format: "openai-chat",
    apiKey: "sk-test",
    model: "gpt-4o"
  }, {
    fetchImpl: async () => ({
      ok: false,
      status: 404,
      text: async () => "Not Found"
    })
  });
  assert.equal(fetchedFallback.contextWindow, 128000);
  assert.equal(fetchedFallback.source, "catalog");
  assert.equal(fetchedFallback.live, false);

  // Streaming usage extraction
  const streamRes = await providers.streamChat({
    format: "openai-chat",
    apiKey: "sk-usage",
    model: "gpt-4o"
  }, {
    messages: [{ role: "user", content: "Hi" }],
    fetchImpl: async () => createSseResponse([
      'data: {"choices":[{"delta":{"content":"Answer"}}],"usage":{"prompt_tokens":120,"completion_tokens":30,"total_tokens":150}}\n\n',
      'data: [DONE]\n\n'
    ])
  });
  assert.deepEqual(streamRes.usage, { inputTokens: 120, outputTokens: 30, totalTokens: 150 });

  // Context compression helper
  const compRes = await providers.compressMessages({
    format: "openai-chat",
    apiKey: "sk-comp",
    model: "gpt-4o-mini"
  }, {
    previousSummary: "Earlier turn summary",
    messages: [
      { role: "user", content: "What does The Fool mean here?" },
      { role: "assistant", content: "The Fool marks a threshold." }
    ],
    locale: "en",
    fetchImpl: async () => createSseResponse([
      JSON.stringify({
        choices: [{ message: { content: "- User asked about The Fool threshold." } }],
        usage: { prompt_tokens: 90, completion_tokens: 15, total_tokens: 105 }
      })
    ], 200, "application/json")
  });
  assert.equal(compRes.summaryText, "- User asked about The Fool threshold.");
  assert.equal(compRes.usage.totalTokens, 105);
});

test("SSE CRLF, bare CR and UTF-8 boundaries preserve multiline data for all formats", async () => {
  const fixtures = {
    "openai-chat": { choices: [{ delta: { content: "Hello 牌" }, finish_reason: "stop" }] },
    "openai-responses": { type: "response.output_text.delta", delta: "Hello 牌" },
    "anthropic-messages": { type: "content_block_delta", delta: { type: "text_delta", text: "Hello 牌" } },
    "gemini-aistudio": { candidates: [{ content: { parts: [{ text: "Hello 牌" }] }, finishReason: "STOP" }] },
    "gemini-vertex": { candidates: [{ content: { parts: [{ text: "Hello 牌" }] }, finishReason: "STOP" }] }
  };
  for (const [format, payload] of Object.entries(fixtures)) {
    for (const newline of ["\r\n", "\r", "\n"]) {
      const json = JSON.stringify(payload);
      let event = ": comment" + newline + "data: {" + newline + "data: " + json.slice(1) + newline + newline;
      if (format === "openai-responses") {
        event += 'event: response.completed' + newline + 'data: {"type":"response.completed"}' + newline + newline;
      } else if (format === "anthropic-messages") {
        event += 'event: message_stop' + newline + 'data: {"type":"message_stop"}' + newline + newline;
      }
      const bytes = new TextEncoder().encode(event);
      const partitions = [Array.from(bytes, b => Uint8Array.of(b))];
      for (let i = 1; i < bytes.length; i++) partitions.push([bytes.slice(0, i), bytes.slice(i)]);
      for (const chunks of partitions) {
        const deltas = [];
        const result = await providers.streamChat({ format, apiKey: "fixture-key", model: "test" }, {
          messages: [{ role: "user", content: "hello" }],
          fetchImpl: async () => createSseResponse(chunks),
          onDelta: delta => deltas.push(delta)
        });
        assert.equal(result.text, "Hello 牌", format + " " + JSON.stringify(newline));
        assert.equal(result.completionStatus, "complete", format + " " + JSON.stringify(newline));
        assert.equal(deltas.join(""), "Hello 牌");
      }
    }
  }
});

test("reasoning models use max_completion_tokens, omit non-1 temperature, and testConnection handles reasoning-only probes & timeouts", async () => {
  // OpenAI Chat reasoning models: o1/o3/o4/gpt-5 swap max_tokens -> max_completion_tokens and drop temperature != 1
  for (const model of ["o1", "o3-mini", "o4-mini", "gpt-5", "openai/gpt-5-mini"]) {
    const reqDropTemp = providers.buildRequest({
      format: "openai-chat",
      apiKey: "sk-reason-1234",
      model,
      temperature: 0.3,
      maxTokens: 1200
    }, { messages: [{ role: "user", content: "Interpret" }] });
    assert.equal(reqDropTemp.body.max_completion_tokens, 1200, model);
    assert.equal("max_tokens" in reqDropTemp.body, false, model);
    assert.equal("temperature" in reqDropTemp.body, false, model);

    const reqTempOne = providers.buildRequest({
      format: "openai-chat",
      apiKey: "sk-reason-1234",
      model,
      temperature: 1,
      maxTokens: 800
    }, { messages: [{ role: "user", content: "Interpret" }] });
    assert.equal(reqTempOne.body.temperature, 1, model);

    const respReq = providers.buildRequest({
      format: "openai-responses",
      apiKey: "sk-reason-1234",
      model,
      temperature: 0.2,
      maxTokens: 900
    }, { messages: [{ role: "user", content: "Interpret" }] });
    assert.equal(respReq.body.max_output_tokens, 900, model);
    assert.equal("temperature" in respReq.body, false, model);
  }

  // compressMessages omits non-1 temperature on OpenAI reasoning models and uses >= 2048 token budget
  let capturedCompBody = null;
  await providers.compressMessages({
    format: "openai-chat",
    apiKey: "sk-comp-reason",
    model: "gpt-5"
  }, {
    messages: [
      { role: "user", content: "Turn 1" },
      { role: "assistant", content: "Reply 1" }
    ],
    locale: "en",
    fetchImpl: async (_url, init) => {
      capturedCompBody = JSON.parse(init.body);
      return createSseResponse([
        JSON.stringify({ choices: [{ message: { content: "Summary." } }] })
      ], 200, "application/json");
    }
  });
  assert.ok(capturedCompBody.max_completion_tokens >= 2048);
  assert.equal("max_tokens" in capturedCompBody, false);
  assert.equal("temperature" in capturedCompBody, false);

  // testConnection omits temperature, sends >= 256 tokens, and accepts valid HTTP 200 hidden-thinking completions
  let capturedProbeBody = null;
  const geminiThinkOnly = await providers.testConnection({
    format: "gemini-aistudio",
    apiKey: "AIzaSy-think-probe",
    model: "gemini-2.5-pro",
    temperature: 0.7
  }, {
    fetchImpl: async (_url, init) => {
      capturedProbeBody = JSON.parse(init.body);
      return createSseResponse([
        JSON.stringify({
          candidates: [{ content: { role: "model", parts: [{ text: "Reasoning-only probe", thought: true }] }, finishReason: "MAX_TOKENS" }],
          usageMetadata: { promptTokenCount: 14, thoughtsTokenCount: 256, totalTokenCount: 270 }
        })
      ], 200, "application/json");
    }
  });
  assert.equal(geminiThinkOnly.ok, true);
  assert.equal(geminiThinkOnly.reply, "Reasoning-only probe");
  assert.ok(capturedProbeBody.generationConfig.maxOutputTokens >= 256);
  assert.equal("temperature" in capturedProbeBody.generationConfig, false);

  // testConnection still rejects non-LLM HTTP 200 healthcheck payloads without completion metadata
  await assert.rejects(() => providers.testConnection({
    format: "openai-chat",
    apiKey: "sk-bogus-endpoint",
    model: "gpt-4o"
  }, {
    fetchImpl: async () => createSseResponse([JSON.stringify({ ok: true })], 200, "application/json")
  }), (err) => err.code === "empty_response");

  // testConnection enforces AbortController timeout when upstream hangs
  let signalAborted = false;
  await assert.rejects(() => providers.testConnection({
    format: "openai-chat",
    apiKey: "sk-timeout-probe",
    model: "gpt-4o"
  }, {
    timeoutMs: 30,
    fetchImpl: async (_url, init) => {
      init.signal.addEventListener("abort", () => {
        signalAborted = true;
      }, { once: true });
      return new Promise(() => {});
    }
  }), (err) => err.code === "timeout");
  assert.equal(signalAborted, true);
});

test("sanitizeMessages & buildRequest drop empty/leading-assistant turns, coalesce same-role turns, and reject empty messages before fetch", async () => {
  const messy = [
    { role: "assistant", content: "Leading orphan assistant after shift" },
    { role: "user", content: "   " },
    { role: "user", content: "First user prompt (previous attempt aborted)" },
    { role: "assistant", content: "" },
    { role: "system", content: "Extra inline system rule" },
    { role: "user", content: "Second user prompt" },
    { role: "assistant", content: "Part A" },
    { role: "assistant", content: "Part B" }
  ];

  for (const format of providers.FORMAT_IDS) {
    const req = providers.buildRequest({
      format,
      apiKey: "sk-norm-123456",
      model: "gemini-2.5-flash"
    }, { systemPrompt: "Base sys", messages: messy });

    if (format === "openai-chat") {
      assert.deepEqual(req.body.messages, [
        { role: "system", content: "Base sys\n\nExtra inline system rule" },
        { role: "user", content: "First user prompt (previous attempt aborted)\n\nSecond user prompt" },
        { role: "assistant", content: "Part A\n\nPart B" }
      ]);
    } else if (format === "openai-responses") {
      assert.equal(req.body.instructions, "Base sys\n\nExtra inline system rule");
      assert.deepEqual(req.body.input, [
        { role: "user", content: "First user prompt (previous attempt aborted)\n\nSecond user prompt" },
        { role: "assistant", content: "Part A\n\nPart B" }
      ]);
    } else if (format === "anthropic-messages") {
      assert.equal(req.body.system, "Base sys\n\nExtra inline system rule");
      assert.deepEqual(req.body.messages, [
        { role: "user", content: "First user prompt (previous attempt aborted)\n\nSecond user prompt" },
        { role: "assistant", content: "Part A\n\nPart B" }
      ]);
    } else {
      assert.equal(req.body.systemInstruction.parts[0].text, "Base sys\n\nExtra inline system rule");
      assert.deepEqual(req.body.contents, [
        { role: "user", parts: [{ text: "First user prompt (previous attempt aborted)\n\nSecond user prompt" }] },
        { role: "model", parts: [{ text: "Part A\n\nPart B" }] }
      ]);
    }
  }

  let fetchCalled = false;
  for (const badMessages of [
    [],
    [{ role: "user", content: "   " }],
    [{ role: "assistant", content: "Orphan assistant only" }]
  ]) {
    await assert.rejects(() => providers.streamChat({
      format: "anthropic-messages",
      apiKey: "sk-ant-empty",
      model: "claude-sonnet-4-20250514"
    }, {
      messages: badMessages,
      fetchImpl: async () => {
        fetchCalled = true;
        return createSseResponse([]);
      }
    }), (err) => err.code === "empty_messages");
  }
  assert.equal(fetchCalled, false);
});

test("redacts secrets before 400-char slice (including URL-encoded and ?key=), and URL builders handle ?query, Vertex locations & pasted Gemini URLs", async () => {
  const secretKey = "sk-key/with+plus=987654321";
  const encodedSecret = encodeURIComponent(secretKey);
  const boundaryBody = "X".repeat(392) + " token=" + secretKey + " url=https://proxy.example/v1?key=AIzaSyLeak999&foo=1";

  await assert.rejects(() => providers.streamChat({
    format: "openai-chat",
    apiKey: secretKey,
    model: "gpt-4o"
  }, {
    messages: [{ role: "user", content: "Hi" }],
    fetchImpl: async () => createSseResponse([boundaryBody], 502, "text/html")
  }), (err) => {
    assert.equal(err.message.includes("sk-key/with"), false);
    assert.equal(err.message.includes("AIzaSyLeak999"), false);
    assert.ok(err.detail.length <= 400);
    return true;
  });

  await assert.rejects(() => providers.streamChat({
    format: "openai-chat",
    apiKey: secretKey,
    model: "gpt-4o"
  }, {
    messages: [{ role: "user", content: "Hi" }],
    fetchImpl: async () => {
      throw new Error("Proxy failed for " + encodedSecret + " at https://host/path?api_key=PlainQueryKey");
    }
  }), (err) => {
    assert.equal(err.message.includes(encodedSecret), false);
    assert.equal(err.message.includes("PlainQueryKey"), false);
    assert.ok(err.message.includes("api_key=****"));
    return true;
  });

  // URL builders keep paths inside pathname before ?query and strip leaked ?key=
  const oaQueryReq = providers.buildRequest({
    format: "openai-chat",
    baseUrl: "https://gateway.example.com/openai/v1?api-version=2024-10-21&api_key=leak",
    apiKey: "sk-gw-123456",
    model: "gpt-4o"
  }, { messages: [{ role: "user", content: "Hi" }] });
  assert.equal(oaQueryReq.url, "https://gateway.example.com/openai/v1/chat/completions?api-version=2024-10-21");

  // Vertex blank location defaults BOTH host and path to us-central1; global keeps aiplatform.googleapis.com
  const vertexBlankLoc = providers.buildRequest({
    format: "gemini-vertex",
    baseUrl: "https://aiplatform.googleapis.com/v1",
    vertexProject: "proj-1",
    vertexLocation: "",
    apiKey: "AQ.Key123456",
    model: "gemini-2.5-flash"
  }, { messages: [{ role: "user", content: "Hi" }] });
  assert.equal(
    vertexBlankLoc.url,
    "https://us-central1-aiplatform.googleapis.com/v1/projects/proj-1/locations/us-central1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
  );

  const vertexGlobalLoc = providers.buildRequest({
    format: "gemini-vertex",
    baseUrl: "https://aiplatform.googleapis.com",
    vertexProject: "proj-1",
    vertexLocation: "global",
    apiKey: "AQ.Key123456",
    model: "gemini-2.5-flash"
  }, { messages: [{ role: "user", content: "Hi" }] });
  assert.equal(
    vertexGlobalLoc.url,
    "https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
  );

  const vertexBareRegional = providers.buildRequest({
    format: "gemini-vertex",
    baseUrl: "https://europe-west4-aiplatform.googleapis.com",
    vertexProject: "proj-eu",
    vertexLocation: "",
    apiKey: "AQ.Key123456",
    model: "gemini-2.5-flash"
  }, { messages: [{ role: "user", content: "Hi" }], stream: false });
  assert.equal(
    vertexBareRegional.url,
    "https://europe-west4-aiplatform.googleapis.com/v1/projects/proj-eu/locations/europe-west4/publishers/google/models/gemini-2.5-flash:generateContent"
  );

  // Pasted :generateContent URL swaps cleanly to :streamGenerateContent?alt=sse and strips :generateContent in metadata probe
  const studioPasted = providers.buildRequest({
    format: "gemini-aistudio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=AIzaPasted",
    apiKey: "AIzaHeaderKey123",
    model: "gemini-2.5-flash"
  }, { messages: [{ role: "user", content: "Hi" }], stream: true });
  assert.equal(
    studioPasted.url,
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
  );

  let probedMetadataUrl = "";
  await providers.fetchModelContextWindow({
    format: "gemini-aistudio",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse&key=AIzaPasted",
    apiKey: "AIzaHeaderKey123",
    model: "gemini-2.5-flash"
  }, {
    fetchImpl: async (url) => {
      probedMetadataUrl = url;
      return { ok: true, status: 200, text: async () => JSON.stringify({ inputTokenLimit: 1048576 }) };
    }
  });
  assert.equal(probedMetadataUrl, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash");
});

test("catalog/default contextWindowSource stays auto, Anthropic usage merge preserves inputTokens, and /models prefers exact ID & clean stream cancel", async () => {
  // Non-live fallback must stay auto (never mislabeled as "api")
  const fallbackProf = providers.normalizeProfile({
    format: "openai-chat",
    apiKey: "sk-test",
    model: "gpt-4o",
    detectedContextWindow: 128000,
    contextWindowSource: "catalog"
  });
  assert.equal(fallbackProf.contextWindowSource, "auto");
  assert.equal(fallbackProf.detectedContextWindow, 0);
  const resolvedAfterModelSwitch = providers.resolveContextWindow(Object.assign({}, fallbackProf, {
    model: "gemini-2.5-flash",
    format: "gemini-aistudio"
  }));
  assert.equal(resolvedAfterModelSwitch.contextWindow, 1048576);
  assert.equal(resolvedAfterModelSwitch.source, "catalog");

  // Anthropic message_start + message_delta usage merge never drops inputTokens from totalTokens
  const anthStream = await providers.streamChat({
    format: "anthropic-messages",
    apiKey: "sk-ant-usage",
    model: "claude-sonnet-4-20250514"
  }, {
    messages: [{ role: "user", content: "Read spread" }],
    fetchImpl: async () => createSseResponse([
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":900,"cache_creation_input_tokens":200,"cache_read_input_tokens":151,"output_tokens":1}}}\n\n',
      'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Interpretation"}}\n\n',
      'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":340}}\n\n',
      'event: message_stop\ndata: {"type":"message_stop"}\n\n'
    ])
  });
  assert.deepEqual(anthStream.usage, {
    inputTokens: 1251,
    outputTokens: 340,
    totalTokens: 1591
  });

  // /models list prefers exact ID over earlier short-name match
  const exactCtx = await providers.fetchModelContextWindow({
    format: "openai-chat",
    apiKey: "sk-openrouter",
    model: "deepseek/deepseek-r1"
  }, {
    fetchImpl: async (url) => {
      if (url.endsWith("/models")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            data: [
              { id: "other-vendor/deepseek-r1", context_length: 32768 },
              { id: "deepseek/deepseek-r1", context_length: 163840 }
            ]
          })
        };
      }
      return { ok: false, status: 404, text: async () => "" };
    }
  });
  assert.equal(exactCtx.contextWindow, 163840);
  assert.equal(exactCtx.live, true);

  // Unary JSON containing "data:" inside reply text with text/plain Content-Type is parsed as JSON, not SSE
  const unaryWithColon = await providers.streamChat({
    format: "openai-chat",
    apiKey: "sk-unary",
    model: "gpt-4o"
  }, {
    messages: [{ role: "user", content: "Hi" }],
    fetchImpl: async () => createSseResponse([
      JSON.stringify({ choices: [{ message: { content: "Here is data: 42" } }] })
    ], 200, "text/plain")
  });
  assert.equal(unaryWithColon.text, "Here is data: 42");

  // Mid-stream abort cancels reader cleanly
  const abortCtrl = new AbortController();
  let readerCancelled = false;
  await assert.rejects(() => providers.streamChat({
    format: "openai-chat",
    apiKey: "sk-abort-mid",
    model: "gpt-4o"
  }, {
    messages: [{ role: "user", content: "Hi" }],
    signal: abortCtrl.signal,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: {
        getReader() {
          let readCount = 0;
          return {
            read() {
              readCount += 1;
              if (readCount === 1) {
                abortCtrl.abort();
                return Promise.resolve({
                  done: false,
                  value: new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n')
                });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
            cancel() {
              readerCancelled = true;
              return Promise.reject(new Error("benign cancel rejection"));
            }
          };
        }
      }
    })
  }), (err) => err.code === "aborted");
  assert.equal(readerCancelled, true);
});
