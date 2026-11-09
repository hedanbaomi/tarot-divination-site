-- Widen the platform constraint without changing existing identities or timestamps.
CREATE TABLE install_state_web (
    install_hash TEXT PRIMARY KEY,
    app_version TEXT NOT NULL,
    version_code INTEGER NOT NULL,
    locale TEXT NOT NULL,
    android_major INTEGER NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    platform TEXT NOT NULL DEFAULT 'android'
        CHECK (platform IN ('android', 'web', 'miniprogram', 'minigame')),
    env_version TEXT NOT NULL DEFAULT ''
        CHECK (env_version IN ('', 'develop', 'trial', 'release'))
);
INSERT INTO install_state_web
    (install_hash, app_version, version_code, locale, android_major,
     first_seen_at, last_seen_at, platform, env_version)
SELECT install_hash, app_version, version_code, locale, android_major,
       first_seen_at, last_seen_at, platform, env_version
FROM install_state;
DROP TABLE install_state;
ALTER TABLE install_state_web RENAME TO install_state;
CREATE INDEX idx_install_state_last_seen ON install_state (last_seen_at);
CREATE INDEX idx_install_state_platform_last_seen ON install_state (platform, last_seen_at);
