-- Add iOS as a first-class native telemetry and announcement platform.
-- Existing announcement ids/revisions and install rows are copied verbatim;
-- historical rows receive ios_major = 0 because they predate iOS support.

ALTER TABLE announcements RENAME TO announcements_pre_ios;

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
        CHECK (platform IN ('all', 'android', 'ios', 'web', 'miniprogram', 'minigame')),
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
FROM announcements_pre_ios;

-- Preserve the historical high-water mark, including deleted announcement ids.
-- Explicit row copying alone would only retain MAX(id) of surviving rows.
UPDATE sqlite_sequence
SET seq = MAX(seq, COALESCE(
    (SELECT seq FROM sqlite_sequence WHERE name = 'announcements_pre_ios'), 0
))
WHERE name = 'announcements';

INSERT INTO sqlite_sequence (name, seq)
SELECT 'announcements', seq FROM sqlite_sequence
WHERE name = 'announcements_pre_ios'
  AND NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'announcements');

DROP TABLE announcements_pre_ios;

CREATE INDEX idx_announcements_public
    ON announcements (status, starts_at, ends_at);

ALTER TABLE install_state RENAME TO install_state_pre_ios;

CREATE TABLE install_state (
    install_hash TEXT PRIMARY KEY,
    app_version TEXT NOT NULL,
    version_code INTEGER NOT NULL,
    locale TEXT NOT NULL,
    android_major INTEGER NOT NULL,
    ios_major INTEGER NOT NULL DEFAULT 0,
    platform TEXT NOT NULL DEFAULT 'android'
        CHECK (platform IN ('android', 'ios', 'miniprogram', 'minigame')),
    env_version TEXT NOT NULL DEFAULT ''
        CHECK (env_version IN ('', 'develop', 'trial', 'release')),
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
);

INSERT INTO install_state (
    install_hash, app_version, version_code, locale, android_major, ios_major,
    platform, env_version, first_seen_at, last_seen_at
)
SELECT
    install_hash, app_version, version_code, locale, android_major, 0,
    platform, env_version, first_seen_at, last_seen_at
FROM install_state_pre_ios;

DROP TABLE install_state_pre_ios;

CREATE INDEX idx_install_state_last_seen
    ON install_state (last_seen_at);
CREATE INDEX idx_install_state_platform_last_seen
    ON install_state (platform, last_seen_at);
