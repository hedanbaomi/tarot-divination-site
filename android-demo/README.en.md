[简体中文](./README.md) | [English](./README.en.md)

# Quareia Divination · Android Offline Demo

This is an Android demo of the Quareia divination website. It packages the mobile interface as an offline experience and requires no sign-in; card art and core functions do not depend on the network. The app requests `INTERNET` permission for opt-out anonymous usage statistics and external links.

This is an unofficial, non-commercial demo. It is not affiliated with, sponsored by, or endorsed by Quareia, Josephine McCarthy, any associated artist, or any publisher.

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

## In-App Updates (since v1.1.1)

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

v1.1 and earlier do not contain the fixed in-app updater — install v1.1.1
manually from GitHub Releases; all later versions can use in-app updates.

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

This app is an unofficial, free, strictly non-commercial tool. It contains no advertising, donations, subscriptions, paid cloud services, paid unlocks, or other revenue-generating features. Josephine McCarthy's written permission covers this free application (and the corresponding free GitHub Pages website), provided that the copyrighted materials remain strictly non-commercial and are excluded from all open-source licences.

An in-app "About / Copyright & Attribution" screen (entered via the button in the top-right corner of the home screen) is bilingual and contains: the non-commercial statement, the Mystagogus and LXXXI credits, the separation of third-party materials from the application's open-source licence, a clickable link to the official Quareia website, and the author's note kept verbatim in English with a Chinese reference translation.

The MIT License covers only original program code and content explicitly identified as original to this project. Third-party card artwork (Mystagogus, LXXXI, etc.), publication content, and adapted, rewritten, or translated material are outside the MIT License, and opening the source grants no permission to copy or redistribute them. LXXXI card faces are not distributed with the open-source repository; in the official APK they ship in a protected packaging that includes no original scan masters and offers no bulk-export or raw-image download feature. See the repository-level [`LICENSE`](../LICENSE) and [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).

The developer key material required to rebuild the full official APK is kept
only in controlled local directories. Never commit, package, upload, or share
it. Contact the maintainers for the material and process if you need to
rebuild the full-card APK in a controlled environment.
