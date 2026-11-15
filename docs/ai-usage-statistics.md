# AI usage statistics

The website and Android report one anonymous event after each AI request completes successfully, when usage statistics was enabled at request start and has stayed enabled. Turning statistics off invalidates in-flight reports, including after re-enabling it. API keys, endpoint URLs, prompts, selected reading content, answers and conversation IDs are never sent to this collector.

## Counting rules

- Model ID is the configured model identifier, not a guessed provider identity.
- Conversation rounds count successfully completed answer-generation requests; a successful regeneration counts again. HTTP/network errors, cancellation, malformed or empty responses, blocked output, output-limit truncation and premature stream closure do not emit statistics.
- Successfully completed automatic context compression contributes reported tokens but adds no conversation round. Connection tests and model-limit detection do not emit AI usage events.
- Token totals come from provider usage metadata. Unknown or incomplete usage is stored as null, separately from a reported zero. Anthropic cache input tokens and Gemini thought tokens are included when supplied.
- Official OpenAI Chat Completions requests ask for the final usage chunk. Compatible gateways retain their request shape; gateways that omit usage remain explicitly unknown.
- Delivery is best effort, subject to connectivity, consent and existing rate limits. These counters are not a billing ledger, unique-user metric or complete record of all provider spending.

## Storage and administration

The additive D1 migration is `telemetry-worker/migrations/0006_ai_usage.sql`. The table holds random request ID, model ID, platform, call kind, nullable total tokens and server timestamp. It does not store an installation identifier. Request ID makes duplicate delivery idempotent. The daily cleanup removes rows older than 90 days, independently of install-state cleanup. Existing Analytics Engine projections remain unchanged.

The authenticated admin page adds an AI usage panel with 24-hour, 7-day and 30-day windows, web/Android filters, summary counts and model/platform rows. The top 200 groups do not truncate summary totals. Unknown-token requests are shown separately. The table scrolls within its own region on narrow screens.

## Success-only collection update (2026-11-16)

Current clients report only a fully successful completion. Success without provider token metadata still reports unknown usage. Older records and already-open old pages did not distinguish failed calls; their unknown-usage records cannot reliably be reclassified and are retained. Reload the web page to use the new collector.

Validation for this change: the new provider-to-collector regression failed before the fix and passed afterward, covering 24 conversation/compression scenarios. Web unit tests (284), Android JavaScript tests (25), Worker tests (216), both offline browser suites and the Worker dry-run passed. Native Android code and the database schema are unchanged.

## Initial release validation (2026-11-16)

Web unit tests: 259 passed; Android JavaScript: 25 passed; Android native unit tests: 155 passed. Worker tests: 216 passed after clean dependency installation. Local D1 migrations 0001–0006 and Worker deployment dry-run passed. Offline browser scenarios passed for both web and Android resources.

The real admin UI with synthetic input reconciled 400 known tokens, three conversation rounds, one unknown-usage request and four total requests; web/Android and time-window filtering passed. At a 390px viewport, body width remained 390px with all table columns available.

Local evidence is retained outside the repository at `E:/quareia-ai-usage-evidence-20261115`. DSH / DeepSeek V4.1 Flash completed an independent read-only review of client privacy, the native bridge, backend authentication and the additive migration; no blocking findings remained.

Android source changes require a new app build to reach installed apps. Android 1.5.2 packaging is paused by the owner; no APK or release is published by this change. Real provider billing and physical-device acceptance are not part of these local tests.
