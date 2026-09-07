# iOS feasibility prototype

This is the first feasibility stage of an offline Swift/UIKit/WKWebView port,
targeting iOS/iPadOS 16+, iPhone and iPad, version 1.0.0/build 1. It is not a
complete product, installable signed IPA, or a release. Android is unchanged.

`QuareiaPublic` uses synthetic images for its protected-resource tests. The
public build has no private provider or protected card artwork. Release builds
must fail until the separate private integration has been implemented and
approved. Simulator success does not establish device or re-signing acceptance.

## Build and test

From a checkout with the source commit in `web-assets.json` available:

```bash
node ios-app/tools/sync-web-assets.mjs
node ios-app/tools/sync-web-assets.mjs --check
```

The explicit manifest reads Android-distributed public files from Git objects
at a fixed SHA, verifies source hashes, and writes generated resources and their
provenance. It does not copy directories from the working tree. Generated files
are ignored. No card artwork is copied. During this feasibility stage, the
generated main page disables network access, Web announcement initialization and
the Android telemetry notice; native services and complete product parity are
subsequent work. Existing Android files are not edited.

On a Mac with a stable Xcode and an installed iOS simulator:

```bash
bash ios-app/tools/cloud-test.sh
```

The public GitHub Actions workflow runs on a standard `macos-15` runner with
stable Xcode 26.3 (or the explicit `IOS_DEVELOPER_DIR` override), records
the actual Xcode, SDK, architecture and available runtimes, selects an available
iPhone simulator, runs XCTest/XCUITest, and builds a separate unsigned `iphoneos`
app. Mach-O platform checks distinguish device from simulator even on arm64.
It does not produce or upload an IPA. Build metadata and a synthetic probe
screenshot are retained in the workflow log; no artifact or cache is uploaded.
Runner labels are not a promise that any particular old simulator is installed.

Xcode 16.4/iOS 18.5 failed before app startup with the Apple-tracked
[missing Swift WebKit library issue](https://developer.apple.com/forums/thread/785964).
The workflow selects the newer installed toolchain; it does not alter security
settings, raise the app deployment target, or patch simulator system libraries.

The public main page currently provides a source-integration smoke surface;
the dedicated `-probe` page tests storage and bridge foundations. Neither is a
claim that all Android features have reached iOS parity.

## Signing and external acceptance

There is no candidate IPA to install from this stage. When an approved complete
device IPA becomes available, a tester on Windows can use a supported signing
tool such as AltStore Classic, following its current official instructions:
[Windows installation](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows).
The tester enters their Apple account only into the signing tool, connects and
trusts their iPhone/iPad, enables Developer Mode when required, and imports the
candidate IPA. The unsigned original is not directly installable. Personal Team
profiles expire and require renewal; the app does not sign or renew itself.

Keep the same signing identity and effective Bundle ID when testing renewal and
an N to N+1 overwrite. Export a backup first. Uninstalling, changing Bundle ID or
changing signing configuration may produce a separate data container; retention
is a device test result, not a guarantee. A re-signed IPA normally has a different
SHA-256 from the original candidate.

Required external checks: first launch after signing; offline LXXXI back and all
81 faces after re-signing; three decks; touch drawing board; Files export/import
and cancellation; announcement revision handling; telemetry opt-out; restart;
same-identity renewal and version overwrite with history/spreads/settings intact;
iPad landscape, text sizes and share popover. Status remains
`DEVICE_ACCEPTANCE_PENDING` until evidence is received.

Feedback should contain candidate source SHA and original package SHA, OS and
device model, signing-tool version, effective Bundle ID (no account identifiers),
reproduction steps, expected/actual result and a redacted error. Do not send Apple
credentials, certificates, provisioning profiles, pairing files, identifiers,
personal reading content or protected card screenshots.

## Future distribution

iOS updates must use an independent manifest/channel. Any future `ios-v*` Release
must set `make_latest=false` and pass the existing Android latest-release parser
before and after publication. This stage creates no Release, update manifest or
production deployment. Public distribution of third-party content requires its
separate authorization; this document grants none.

Original public iOS software is MPL-2.0, including software generated from the
Android mobile distribution. See [LICENSE.md](LICENSE.md),
[the license text](../LICENSES/MPL-2.0.txt), and existing third-party notices.
