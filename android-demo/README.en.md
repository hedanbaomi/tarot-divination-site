[简体中文](./README.md) | [English](./README.en.md)

# Quareia Divination · Android Offline Demo

This is an Android demo of the Quareia divination website. It packages the mobile interface as an offline experience, requires no sign-in, and requests no network permission.

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

From Windows PowerShell:

```powershell
cd android-demo
.\gradlew.bat :app:assembleDebug
android run --apks=app\build\outputs\apk\debug\app-debug.apk
```

The debug APK is written to:

```text
app/build/outputs/apk/debug/app-debug.apk
```

## Verified Scenarios

- The app launches to the home screen in an Android emulator
- All three decks can be selected, drawn, and revealed
- A revealed card flips to its meaning and back when tapped
- The reshuffle confirmation supports cancel, continue, and backdrop dismissal
- Reading history remains in the app's local WebView data

## Content and Rights

The MIT License covers only original program code and content explicitly identified as original to this project. Third-party card artwork, publication content, and adapted, rewritten, or translated material are outside the MIT License. The demo does not grant permission to copy or redistribute those materials. See the repository-level [`LICENSE`](../LICENSE) and [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
