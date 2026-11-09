-- Imported Cloudflare Web Analytics aggregates, separate from live telemetry.
-- A complete, verified batch is published last; partial imports stay invisible.
CREATE TABLE web_analytics_imports (
    id TEXT PRIMARY KEY CHECK (length(id) = 64),
    source TEXT NOT NULL CHECK (source = 'cloudflare_web_analytics'),
    host TEXT NOT NULL CHECK (host = 'hedanbaomi.github.io'),
    path TEXT NOT NULL CHECK (path = '/tarot-divination-site/'),
    from_utc TEXT NOT NULL,
    cutoff_utc TEXT NOT NULL,
    exported_at TEXT NOT NULL,
    coverage_days INTEGER NOT NULL CHECK (coverage_days BETWEEN 1 AND 186),
    pageviews INTEGER NOT NULL CHECK (pageviews >= 0),
    visits INTEGER NOT NULL CHECK (visits >= 0 AND visits <= pageviews),
    exclude_bots INTEGER NOT NULL CHECK (exclude_bots = 1),
    published_at INTEGER
);

CREATE TABLE web_analytics_daily (
    import_id TEXT NOT NULL REFERENCES web_analytics_imports(id),
    utc_day TEXT NOT NULL CHECK (length(utc_day) = 10),
    pageviews INTEGER NOT NULL CHECK (pageviews >= 0),
    visits INTEGER NOT NULL CHECK (visits >= 0 AND visits <= pageviews),
    max_sample_interval REAL CHECK (max_sample_interval >= 1),
    has_samples INTEGER NOT NULL CHECK (has_samples IN (0, 1)),
    PRIMARY KEY (import_id, utc_day)
);

CREATE INDEX idx_web_analytics_published ON web_analytics_imports(published_at);
