[简体中文](./README.md) | [English](./README.en.md)

# Quareia Divination · Android Offline Demo

This is an Android demo of the Quareia divination website. It packages the mobile interface as an offline experience and requires no sign-in; card art and core functions do not depend on the network. The app requests `INTERNET` permission for opt-out anonymous usage statistics and external links.

This is an unofficial demo. It is not affiliated with, sponsored by, or endorsed by Quareia, Josephine McCarthy, any associated artist, or any publisher.

## Features

- Tarot, Mystagogus, and LXXXI deck support
- One-tap Simplified Chinese / English switching
- The website's decks, spreads, orientation rules, and local reading history
- Intentional card choice from a horizontally spread deck
- After **Reveal & Interpret**, tap a card in the spread to flip between its artwork and meaning
- Branded confirmation sheets when shuffling or changing a setting would clear the spread
- The main reading flow remains available offline

## Build and Run

Requirements:

- JDK 17
- Android SDK with compileSdk 36; minSdk 24

From Windows PowerShell (development only):

```powershell
cd android-demo
.\gradlew.bat :app:assembleDebug
android run --apks=app\build\outputs\apk\debug\app-debug.apk
```

The `debug` variant is debuggable and not R8-hardened. Never distribute or
upload it. For local acceptance of the hardened offline deck, use:

```powershell
cd android-demo
.\gradlew.bat :app:assembleHardened
android run --apks=app\build\outputs\apk\hardened\app-hardened.apk
```

`hardened` is a non-debuggable, R8/shrunk local acceptance variant signed with
the Android debug key. It is not a production signing artifact. Production
releases must sign the `assembleRelease` output with a controlled release
keystore and pass `apksigner verify`. Release credentials are not stored in the
repository; keep the mapping file private for crash retracing.

Release signing credentials are only ever supplied through the environment or
Gradle properties:

- the `QUAREIA_KEYSTORE_PROPERTIES` environment variable pointing at a
  `keystore.properties` file outside the repository (`storeFile` /
  `storePassword` / `keyAlias` / `keyPassword`), or
- the Gradle properties `quareia.keystore.storeFile`,
  `quareia.keystore.storePassword`, `quareia.keystore.keyAlias`, and
  `quareia.keystore.keyPassword` (in `~/.gradle/gradle.properties` or passed
  with `-P`).

Without credentials, `assembleDebug`, `testDebugUnitTest`, `assembleHardened`,
and IDE sync all keep working; only a real `assembleRelease` fails, with the
clear error "SigningConfig 'release' is missing required property 'storeFile'",
and no unsigned APK is emitted. Back up the keystore and passwords offline;
losing them makes it impossible to ship updates to installed users.

The debug APK is written to (not for distribution):

```text
app/build/outputs/apk/debug/app-debug.apk
```

The local hardened acceptance APK is written to:

```text
app/build/outputs/apk/hardened/app-hardened.apk
```

## In-App Updates (since v1.2.0)

The app silently checks GitHub Releases on startup and offers a manual check on
the About / Copyright screen. Only a published release (non-draft,
non-prerelease) is accepted, and it must contain exactly one APK asset named
`QuareiaDivination-v<version>.apk`, at most 100 MiB, carrying a
`sha256:<hex>` digest from the GitHub API. Missing or duplicated assets,
missing or malformed digests, and download URLs that are not trusted GitHub
HTTPS domains all fail closed ("check failed" / "download failed"); there is
never a fallback to tarball/zipball URLs or the releases page.

Downloads run on a background thread into a `.part` file inside the app-private
`files/updates/` directory. The system installer opens only after every check
passes:

1. the actual file size equals the release asset size;
2. the file's SHA-256 equals the `sha256:<hex>` digest from the GitHub API;
3. the APK parses through the PackageManager;
4. its `packageName` is exactly `com.quareia.divination`;
5. its versionCode is higher than the installed version;
6. the SHA-256 of the APK's signing certificate matches the installed app's
   signer certificates (including signing-certificate history) — digests are
   read from the system and computed at runtime, never hard-coded strings.

Any failed check deletes the downloaded file, does not open the installer, and
shows a localized security message; the same verification runs again when a
pending install is resumed after the permission is granted. Note the two
different SHA-256 values: item 2 is the hash of the APK file, item 6 is the
hash of the signing certificate — they are not the same thing.

Install-permission flow: once the download is fully verified, the installer
opens immediately if the app already has "install unknown apps" permission;
otherwise the pending APK state is saved and the user is taken to the system
setting. When the app resumes, the permission is re-checked: if granted, the
cached APK is re-verified and installed automatically; if not, or if the cached
file is no longer valid (deleted, size/digest mismatch, unparseable, etc.), a
clear message is shown and nothing is re-downloaded. Pending state survives
activity recreation and process restart and always lives inside the app-private
update directory.

v1.1 and earlier do not contain the fixed in-app updater — v1.2.0 is the
last manual install; all later versions can use in-app updates.

## Announcements and Active-Version Statistics (since v1.2.0)

Ordinary announcement checks are throttled to once every 6 hours. Returning to
the foreground performs a fresh check so new `important` / `update` revisions
arrive promptly. Network failures never affect any feature; the About /
Copyright screen provides an announcements list and manual refresh.

- Announcements are filtered server-side (telemetry-worker D1) by status,
  platform, version range, and start/end time; content is plain text and the
  client never renders HTML.
- Unread `important` / `update` announcements pop up once when the app opens;
  `info` announcements only appear in the list and never force a popup.
- Read state is tracked locally by `id + revision`: an admin edit bumps the
  revision and makes the announcement appear again.
- An `update` announcement's button reuses the in-app updater (checks and
  prompts for download); other action URLs open in the system browser only
  when they are HTTPS.
- Language follows the app's current language with fallback to the other
  language.

Anonymous active-version statistics: on first launch, on returning to the
foreground, and immediately when the installed version changes, the app sends
an `app_active` event with the current `versionCode` through the telemetry
channel — at most once per 6 hours for the same version, always immediately on
a version change. When telemetry is off nothing is sent and the local anonymous
identifier keeps being deleted. The backend maintains "active installs /
active devices" statistics (24h / 7d / 30d windows and a distribution grouped
by each install's most recently reported version); these are anonymous
estimates, not exact user counts. v1.1's `install_seen` / `daily_active` /
`reading_completed` events remain compatible; v1.1 clients' `daily_active`
counts towards the statistics (labelled "unknown/legacy"), and an `app_active`
from the upgraded client moves the install into the new version group.

### Privacy and networking semantics

- With telemetry off, `app_active`, `daily_active`, `install_seen` and
  `reading_completed` are never sent and the local anonymous install
  identifier is deleted;
- announcement checks and update checks are not statistics and may still use
  the network while telemetry is off;
- the announcement request carries no install_hash and never uploads
  divination content, spreads, questions, or local history;
- active-install / active-device counts are estimates from periodic sampling
  of a random per-install identifier, not exact user numbers.

## Open-Source Boundary

This repository contains the application's open-source code. The LXXXI card
decryption implementation, key material, and encrypted card records are
**not** published here (see the corresponding entries in the repository-level
`.gitignore`): `LxxxiVault.kt`, `VaultMaterial.kt`, the `qv/` asset directory,
and their tests exist only in a controlled local environment used to build the
full signed release APK. In the open-source build, every opaque LXXXI image
request answers 404 from `MainActivity` (the card meanings remain available);
full functionality is provided only by the official APK published in GitHub
Releases.

## Verified Scenarios

- The app launches to the home screen in an Android emulator
- All three decks can be selected, drawn, and revealed
- A revealed card flips to its meaning and back when tapped
- The reshuffle confirmation supports cancel, continue, and backdrop dismissal
- Reading history remains in the app's local WebView data
- The "About / Copyright & Attribution" screen opens from the home button, switches with the system language, the Quareia link is tappable, and the author's English note is preserved verbatim

## Content and Rights

This is an unofficial application. Josephine McCarthy's written permission covers this Android application and the corresponding GitHub Pages website; the WeChat Mini Program received a separate extension on 2026-08-05. The non-commercial condition applies to Mystagogus/LXXXI artwork, meanings, translations, layouts, and related authorised materials—not as a general commercial-use ban on project-authored Android software, infrastructure, or unrelated independent services. The protected materials may not be sold, paywalled or offered as a paid unlock, separately distributed for commercial purposes, sublicensed, or placed under AGPL, MPL, or the Mini Program proprietary software licence. Commercial use involving those materials requires separate permission from the relevant rights holders. This notice does not claim that Josephine has approved any particular commercial model.

An in-app "About / Copyright & Attribution" screen (entered via the button in the top-right corner of the home screen) is bilingual and contains: the protected-material non-commercial boundary, the Mystagogus and LXXXI credits, the separation of third-party materials from the application's open-source licence, a clickable link to the official Quareia website, and the author's note kept verbatim in English with a Chinese reference translation.

Project-authored public Android native/host code, Android-specific resources, Gradle project configuration, and tests in this directory use `MPL-2.0`. Web software in the Android bundle follows the directory licence map and is distributed under MPL; the root website is separately distributed under `AGPL-3.0-only`. Third-party artwork (Mystagogus, LXXXI, etc.), publication content, adaptations, rewrites, and translations are outside both open-source grants, and opening the source grants no permission to copy or redistribute them. The private LXXXI provider/Vault/material/qv is also excluded. LXXXI card faces are not distributed with the open-source repository; in the official APK they ship in protected packaging that includes no original scan masters and offers no bulk-export or raw-image download feature. See [`LICENSE.md`](LICENSE.md), the repository-level [`LICENSE.md`](../LICENSE.md), and [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md). Historical MIT permissions already received for `v1.2.0` and earlier remain valid.

The developer key material required to rebuild the full official APK is kept
only in controlled local directories. Never commit, package, upload, or share
it. Contact the maintainers for the material and process if you need to
rebuild the full-card APK in a controlled environment.
