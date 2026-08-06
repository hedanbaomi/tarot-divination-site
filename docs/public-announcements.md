# Public web announcements

The web client requests:

`GET https://telemetry.luotianyi.fun/v1/announcements?platform=web&version_code=1&locale=<current>`

The web request contains no `install_hash`, device identifier, or native
bridge data. `WEB_VERSION_CODE` is the stable compatibility value `1`; only a
backward-incompatible public announcement contract may increment it.

The Worker adds CORS headers only on the public announcements route for the
allow-listed GitHub Pages origin and finite local development origins. The
same headers are present on a matching `304`; admin HTML and admin API
responses do not receive public CORS headers.

The browser stores a bounded list of `id:revision` read marks. `important` and
`update` announcements open once when unread; `info` announcements are shown
only in the list. A revision change creates a new mark. A successful response
is cached per locale and remains displayable when a later request fails; the
failure itself is silent.

Action links are created as text-only DOM nodes and are accepted only when the
URL is HTTPS. They open with `target="_blank"` and
`rel="noopener noreferrer"`. A web update never calls Android's
`UpdateManager`.

## Android asset boundary

The Android WebView receives only the one JavaScript file in the explicit shared-file
manifest of `tools/sync-public-announcements.mjs`:

- `js/announcements.js`

Announcement CSS rules are kept in each platform's existing `styles.css`; the
CSS is not copied as a whole because Android's stylesheet is platform-owned.
Android's menu and i18n remain platform-owned files; Android HTML only adds the
guarded script include and no dead web announcement entry. The copied module exits
before initialization when the host is `appassets.androidplatform.net` or a
trusted native bridge (`androidAbout`, `androidTelemetry`, or
`androidHistoryExport`) is present, so the WebView makes no announcement
request or web popup.

The sync script has an explicit exclusion list for `assets/qv`,
`lxxxi-data.js`, `LXXXI_SOURCE`, LXXXI vault/native material, `.private`,
`.local-backups`, and `占卜小程序`. It does not enumerate or copy any of those
paths.

Run from the repository root:

```text
node tools/sync-public-announcements.mjs
node tools/sync-public-announcements.mjs --check
```

`--check` is read-only and returns a non-zero exit code on shared-file drift.
