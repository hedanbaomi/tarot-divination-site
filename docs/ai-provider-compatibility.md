# AI provider parameter compatibility

Verified against official API references on 2026-11-17. These rules adapt the existing five text-chat protocols; they do not change the model ID, endpoint, credentials, conversation, or configured numeric output limit.

| Protocol | Output limit |
| --- | --- |
| OpenAI Chat Completions, o-series and GPT-5+ family names (including GPT-6 and provider namespaces) | `max_completion_tokens` |
| Other OpenAI-compatible Chat Completions models and opaque gateway aliases | `max_tokens` initially; explicit rejection can select the alternative field |
| OpenAI Responses | `max_output_tokens` |
| Anthropic Messages | `max_tokens` |
| Gemini AI Studio / Vertex | `generationConfig.maxOutputTokens` |

OpenAI [deprecates `max_tokens` in favor of `max_completion_tokens`](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create). DeepSeek [continues to document `max_tokens`](https://api-docs.deepseek.com/api/create-chat-completion/). The native [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create), [OpenAI Responses](https://developers.openai.com/api/reference/resources/responses/methods/create), and [Gemini generation configuration](https://ai.google.dev/api/generate-content#v1beta.GenerationConfig) schemas remain separate. A model-family match is a request default, not proof of a gateway's capabilities.

## Bounded compatibility recovery

Only HTTP 400/422 responses received before a successful response is consumed can trigger recovery. The rejection must identify an unsupported allowlisted field through a compatible structured error or a standalone parameter diagnostic. Unrelated error codes, quoted user input, HTML error pages and mixed validation failures are not treated as compatibility advice.

- Chat Completions may swap `max_tokens` and `max_completion_tokens` once. The value is preserved; the limit is never dropped. Other protocols never swap token fields.
- Explicitly unsupported `temperature`, `stream_options`, or `stream` may be omitted. Gemini temperature stays within `generationConfig`. Omitting `stream` also removes `stream_options` and permits an ordinary JSON response.
- At most three corrections are attempted per operation; a field/group is not changed twice. Nothing is persisted to the user's profile.
- Authentication, quota, network, server, range and context-length errors do not trigger these retries. Neither do errors embedded in a successful stream, partial output, empty output or truncated output.
- Abort signals remain attached to every attempt. One logical operation emits one observer start/end pair and one successful result, so compatibility retries do not duplicate conversation messages or successful-use statistics.

Normal generation, connection tests, and automatic conversation compression all share this path. This is not a guarantee for every gateway: unknown protocol changes, unsupported message roles, non-chat models and custom authentication still need an explicit adapter or a clear error.

## Validation

`node --test tests/ai-provider-compatibility.test.js tests/ai-providers.test.js` covers all five request shapes, modern/legacy model families, the reported rejection, opaque aliases, reverse gateway compatibility, optional fields, retry caps, errors, cancellation, usage observers, probes and compression.

`uv run --with playwright python tools/test-ai-browser.py` and the same command with `--android` exercise the real settings/probe/chat flows against an intercepted loopback provider. They use disposable browser contexts and synthetic credentials; they do not call authenticated public providers. Android checks here validate web assets, not a rebuilt APK or physical-device acceptance.
