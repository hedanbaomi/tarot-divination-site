-- Quareia Divination — D1 schema (migration 0001).
--
-- Two tables only: announcements (admin-managed, read by the public API and
-- the Android app) and install_state (one row per anonymous install, tracking
-- the most recently reported version for active-device statistics).
--
-- Privacy contract:
--  * install_state stores only the anonymous install hash, the app version
--    (name + code), the locale, the Android major version, and server-side
--    first/last-seen timestamps.
--  * No raw IP, no IP digest, no User-Agent, no device model, no city, no
--    card faces, names, spreads, questions, notes, or history is ever stored.
--  * A daily cron deletes installs inactive for more than 90 days.
--
-- All timestamps are Unix epoch seconds, produced by the server clock, never
-- by the client.

CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    revision INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'withdrawn')),
    severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'important', 'update')),
    title_zh TEXT NOT NULL DEFAULT '',
    body_zh TEXT NOT NULL DEFAULT '',
    button_zh TEXT NOT NULL DEFAULT '',
    title_en TEXT NOT NULL DEFAULT '',
    body_en TEXT NOT NULL DEFAULT '',
    button_en TEXT NOT NULL DEFAULT '',
    action_url TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT 'all' CHECK (platform IN ('all', 'android', 'web')),
    min_version_code INTEGER NOT NULL DEFAULT 0,
    max_version_code INTEGER NOT NULL DEFAULT 2147483647,
    starts_at INTEGER NOT NULL DEFAULT 0,
    ends_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Public read path: status + time + platform + version range.
CREATE INDEX IF NOT EXISTS idx_announcements_public
    ON announcements (status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS install_state (
    install_hash TEXT PRIMARY KEY,
    app_version TEXT NOT NULL,
    version_code INTEGER NOT NULL,
    locale TEXT NOT NULL,
    android_major INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

-- Daily 90-day cleanup scans on this index.
CREATE INDEX IF NOT EXISTS idx_install_state_last_seen
    ON install_state (last_seen_at);
