-- Add the WeChat mini-program and mini-game as first-class announcement and telemetry
-- WeChat client platforms while preserving every existing row as Android by default.

ALTER TABLE announcements RENAME TO announcements_legacy;

CREATE TABLE announcements (
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
    platform TEXT NOT NULL DEFAULT 'all'
        CHECK (platform IN ('all', 'android', 'web', 'miniprogram', 'minigame')),
    min_version_code INTEGER NOT NULL DEFAULT 0,
    max_version_code INTEGER NOT NULL DEFAULT 2147483647,
    starts_at INTEGER NOT NULL DEFAULT 0,
    ends_at INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

INSERT INTO announcements (
    id, revision, status, severity, title_zh, body_zh, button_zh, title_en,
    body_en, button_en, action_url, platform, min_version_code,
    max_version_code, starts_at, ends_at, created_at, updated_at
)
SELECT
    id, revision, status, severity, title_zh, body_zh, button_zh, title_en,
    body_en, button_en, action_url, platform, min_version_code,
    max_version_code, starts_at, ends_at, created_at, updated_at
FROM announcements_legacy;

DROP TABLE announcements_legacy;

CREATE INDEX idx_announcements_public
    ON announcements (status, starts_at, ends_at);

ALTER TABLE install_state ADD COLUMN platform TEXT NOT NULL DEFAULT 'android'
    CHECK (platform IN ('android', 'miniprogram', 'minigame'));
ALTER TABLE install_state ADD COLUMN env_version TEXT NOT NULL DEFAULT ''
    CHECK (env_version IN ('', 'develop', 'trial', 'release'));

CREATE INDEX idx_install_state_platform_last_seen
    ON install_state (platform, last_seen_at);
