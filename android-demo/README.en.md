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
repository; `app-release-unsigned.apk` must not be distributed. Keep the
mapping file private for crash retracing.

The debug APK is written to (not for distribution):

```text
app/build/outputs/apk/debug/app-debug.apk
```

The local hardened acceptance APK is written to:

```text
app/build/outputs/apk/hardened/app-hardened.apk
```

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
