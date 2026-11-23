# AI context-window catalog

Base catalog verified 2026-11-15; DeepSeek entries verified 2026-11-16. Values are tokens, not bytes. The catalog is a fallback when the configured endpoint supplies no model limit; it does not guarantee access or override proxy restrictions. Manual limits and real API metadata take precedence. The Model ID sent to the provider is never rewritten.

## Sources and coverage

| Models | Window | Official source |
| --- | ---: | --- |
| DeepSeek Flash (`deepseek-flash`), V4 Pro (`deepseek-v4-pro`) | 1,048,576 shared input and output | https://api-docs.deepseek.com/api/list-models/ |
| DeepSeek V4 Flash / V4 Flash Vision Exp compatibility IDs | 1,048,576 (officially routed to the current Flash model) | https://api-docs.deepseek.com/quick_start/pricing/ |
| GPT-5.6 (alias), GPT-5.6 Sol | 1,050,000 | https://developers.openai.com/api/docs/models/gpt-5.6-sol |
| GPT-5.6 Terra | 1,050,000 | https://developers.openai.com/api/docs/models/gpt-5.6-terra |
| GPT-5.6 Luna | 1,050,000 | https://developers.openai.com/api/docs/models/gpt-5.6-luna |
| GPT-6 Sol | 1,050,000 | https://developers.openai.com/api/docs/models/gpt-6-sol |
| GPT-6 Astra, GPT-6 Luna, GPT-6.1 Sol, GPT-6.1 Terra | 1,050,000 | https://developers.openai.com/api/docs/models |
| Claude Fable 5 / 5.1 / 5.2; Mythos Preview / 5 / 5.1 / 5.2; Opus 4.6 / 4.7 / 4.8 / 5 / 5.5; Sonnet 4.6 / 5 / 5.5; Haiku 5.5 | 1,000,000 | https://platform.claude.com/docs/en/build-with-claude/context-windows |
| Claude Opus 4 / 4.1 / 4.5, Sonnet 4 / 4.5, Haiku 4.5 | 200,000 | https://platform.claude.com/docs/en/models/overview |
| Gemini 4 Carbon / Argon / Hydrogen | 1,048,576, shared input and output | https://aistudio.google.com/docs/models/gemini-4-carbon ; https://aistudio.google.com/docs/models/gemini-4-argon ; https://aistudio.google.com/docs/models/gemini-4-hydrogen |
| Gemini 3.8 Flash, 3.6 Flash, 3.5 Flash-Lite, 3.1 Flash-Lite (including preview) | 1,048,576 input | https://aistudio.google.com/docs/models/gemini-3.8-flash ; https://aistudio.google.com/docs/models/gemini-3.6-flash ; https://aistudio.google.com/docs/models/gemini-3.5-flash-lite ; https://aistudio.google.com/docs/models/gemini-3.1-flash-lite |
| Gemini 3.1 Pro Preview, 3 Flash Preview, 3 Pro Preview | 1,048,576 input | https://aistudio.google.com/docs/models/gemini-3.1-pro-preview ; https://aistudio.google.com/docs/models/gemini-3-flash-preview ; https://aistudio.google.com/docs/models/gemini-3-pro-preview |
| Gemini 2.5 Pro / Flash / Flash-Lite | 1,048,576 input | https://aistudio.google.com/docs/models/gemini-2.5-pro ; https://aistudio.google.com/docs/models/gemini-2.5-flash ; https://aistudio.google.com/docs/models/gemini-2.5-flash-lite |

GPT coverage follows the official text-model catalog from 5.6 onwards; unlisted IDs are not invented from naming patterns. Gemini entries cover text chat; Live, TTS, image-generation, and future variants are not matched by a generic Gemini-3 prefix. Older/deprecated IDs remain recognizable for existing gateway configurations, not a recommendation or availability promise. Gemini 3 Pro Preview is retired.

OpenAI's model metadata response documents ID, creation time, owner, and retirement metadata, but no context-window field: https://developers.openai.com/api/reference/resources/models/methods/retrieve . A successful HTTP response without a context limit therefore uses the catalog; it must not be labeled as a live measurement.

## Settings behavior

- Auto Detect uses valid API metadata when supplied; otherwise a known catalog value. A successful explicit detection switches the draft from manual to auto, applied only by Save.
- Unknown models report that detection failed. An existing manual/API limit survives; otherwise the conservative default remains visibly identified as an estimate.
- A late Auto Detect response cannot overwrite a form/profile edited while that request was running.
- Test fixtures use fake keys and local responses only. Android web assets stay synchronized, but Android packaging and release remain paused at the user's request.

The former blanket rule treating any Claude ID containing `1m`/`1000k` as a million-token model was removed. Anthropic retired the Sonnet 4/4.5 long-context beta on 2026-04-30; unknown gateway aliases require metadata or manual confirmation. Source: https://platform.claude.com/docs/en/release-notes/overview .

## DeepSeek quick presets (PR #14 review, 2026-11-16)

The two presets use the current official `deepseek-flash` and `deepseek-v4-pro` IDs with a 1,048,576-token catalog fallback. The former `deepseek-chat` / `deepseek-reasoner` aliases were announced as inaccessible after 2026-07-24 15:59 UTC: https://api-docs.deepseek.com/news/news260424/ . They are not offered as official presets and are not assigned a universal 1M limit for third-party gateways. Unlisted, retired and future DeepSeek names require live metadata or an explicit manual limit. The old blanket `deepseek*` rule is removed.

Selecting a preset edits the current settings draft. It clears the draft API key when the endpoint changes, retains it when switching models on the same endpoint, and never saves until Save is pressed. Cancel restores the saved configuration. The context field uses Auto so real metadata can override the catalog; the user can still supply a manual limit. Model/endpoint edits immediately update preset selection state. Late connection-test and automatic-metadata results are ignored when the form, endpoint, credentials or saved context settings have changed.

Validation covers provider/controller tests plus a completely intercepted browser suite (`tools/test-ai-presets-browser.py`) for web and Android resources, including desktop/mobile layouts, credential isolation, cancellation, stale metadata, API limit precedence and manual overrides. The public DeepSeek OPTIONS response accepted the website Origin and requested headers without a key; no real authenticated generation or billing test was performed. Android packaging remains paused.
