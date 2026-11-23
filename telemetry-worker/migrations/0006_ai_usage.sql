-- AI interpretation usage counters (migration 0006).
--
-- One row per completed AI request, written only by the closed `ai_usage`
-- event from the web and Android clients. Additive: existing announcements,
-- install_state and web analytics archive tables are untouched.
--
-- Privacy contract:
--  * No install hash, account id, IP, User-Agent or locale is stored here; the
--    install hash on the event is used only for in-memory rate limiting.
--  * No question, answer, prompt, API key, URL, conversation id, model
--    response, or any free-form content is stored. Only the four scalar usage
--    fields below are persisted.
--  * `request_id` is a random 128-bit client value, never derived from a
--    person or a device. It is the primary key, so a retried report for the
--    same request cannot double count.
--  * `total_tokens` is NULL when the provider did not return usage, which is
--    "unknown", never "zero". A real reported 0 is stored as 0.
--
-- All timestamps are Unix epoch seconds from the server clock, never the
-- client.

CREATE TABLE IF NOT EXISTS ai_usage (
    request_id TEXT PRIMARY KEY
        CHECK (length(request_id) = 32 AND request_id NOT GLOB '*[^0-9a-f]*'),
    model_id TEXT NOT NULL
        CHECK (length(model_id) BETWEEN 1 AND 128
               AND model_id NOT GLOB '*[^A-Za-z0-9._:/@+-]*'
               AND model_id GLOB '[A-Za-z0-9]*'),
    platform TEXT NOT NULL
        CHECK (platform IN ('android', 'web')),
    usage_kind TEXT NOT NULL
        CHECK (usage_kind IN ('conversation', 'compression')),
    total_tokens INTEGER
        CHECK (total_tokens IS NULL OR total_tokens BETWEEN 0 AND 1000000000),
    created_at INTEGER NOT NULL
);

-- Admin aggregation reads/window filters and the 90-day retention sweep both
-- scan by created_at; a platform-filtered read is covered by the composite.
CREATE INDEX IF NOT EXISTS idx_ai_usage_created_at
    ON ai_usage (created_at);

CREATE INDEX IF NOT EXISTS idx_ai_usage_platform_created_at
    ON ai_usage (platform, created_at);
