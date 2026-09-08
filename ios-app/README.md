# Quareia for iOS

Quareia 1.0.0 (build 1) is a Swift/UIKit/WKWebView application for iPhone and
iPad with a minimum deployment target of iOS/iPadOS 16.0. The release is
distributed as an unsigned IPA for users to sign and install with an external
tool of their choice.

## Download

- [QuareiaDivination-iOS-v1.0.0.ipa](https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.0.0/QuareiaDivination-iOS-v1.0.0.ipa)
- [Official SHA-256 checksum](https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.0.0/QuareiaDivination-iOS-v1.0.0.ipa.sha256)
- [iOS update manifest](https://telemetry.luotianyi.fun/v1/ios-update)
- [Release and acceptance record](https://github.com/hedanbaomi/tarot-divination-site/releases/tag/ios-v1.0.0)

Download the IPA and checksum from the same release. On Windows, compare the
downloaded file with the published checksum before opening it in a signing tool:

```powershell
Get-FileHash .\QuareiaDivination-iOS-v1.0.0.ipa -Algorithm SHA256
Get-Content .\QuareiaDivination-iOS-v1.0.0.ipa.sha256
```

The checksum authenticates the original release IPA. Signing necessarily
changes the archive, so a re-signed IPA normally has a different SHA-256. The
app can check the independent iOS manifest, download and validate an original
update, and hand it to the system share sheet. Quareia does not collect an Apple
Account, sign an IPA, install an app, or renew a signing profile. Enter your
Apple Account credentials only in the external signing tool you chose.

## Install on Windows with Sideloadly

1. Back up Quareia data as described in [Protect data during renewal](#protect-data-during-renewal).
2. Install Sideloadly from its [official download page](https://sideloadly.io/).
   Follow its Windows prerequisite notice for Apple components; do not download
   repackaged installers from unrelated sites.
3. Connect and unlock the iPhone or iPad, accept the device trust prompt, then
   open Sideloadly and select the downloaded IPA and the connected device.
4. Enter your Apple Account in Sideloadly and start sideloading. Keep the
   effective Bundle ID unchanged when Sideloadly permits it, especially when
   overwriting or renewing an existing installation.
5. Follow the prompts on the device to trust the developer profile and enable
   Developer Mode when iOS/iPadOS requires it.

Sideloadly documents device detection, Wi-Fi sideloading, renewal and
same-Bundle-ID overwrite behavior in its [official FAQ](https://sideloadly.io/faq).

## Install on Windows with AltStore Classic

1. Back up Quareia data as described in [Protect data during renewal](#protect-data-during-renewal).
2. Follow AltStore's [official Windows installation guide](https://faq.altstore.io/altstore-classic/how-to-install-altstore-windows).
   It covers the required Apple components, AltServer installation, device
   trust, Wi-Fi sync, profile trust and Developer Mode on iOS/iPadOS 16 or later.
3. Keep AltServer running, download the verified Quareia IPA to the device, and
   use AltStore Classic's IPA import from **My Apps**. Enter your Apple Account
   only in AltStore/AltServer when its official flow requests it.
4. Before expiry, use **Refresh All** while the device can reach AltServer by
   local Wi-Fi or USB. AltStore explains manual and background renewal in
   [Getting Started](https://faq.altstore.io/altstore-classic/your-altstore) and
   its [AltServer guide](https://faq.altstore.io/altstore-classic/altserver).

Apple states that a free account shown as a Personal Team uses provisioning
profiles that expire seven days after issuance, after which the app must be
reprovisioned and reinstalled. See Apple's current
[developer account overview](https://developer.apple.com/help/account/basics/about-your-developer-account/).
Refresh or re-sign before expiry rather than waiting for the app to stop opening.

## Protect data during renewal

Before an overwrite, update or renewal, export a Quareia backup and keep a copy
outside the app. Confirm that it contains the history, custom spreads and
settings you need. For the safest in-place renewal:

- use the same signing account and preserve the effective Bundle ID whenever possible;
- install over the existing app rather than uninstalling it;
- keep the backup until the renewed app has launched and the data has been checked.

A different effective Bundle ID can install a separate app with a separate data
container. Uninstalling can delete the existing container and its local data.
Neither the release IPA checksum nor a successful signature proves that local
data survived an overwrite, so verify the result on the device.

## Acceptance status

The release gate requires the source-pinned public sync checks, unit and UI
tests, device archive inspection, reopened-IPA validation, checksum and update
manifest checks, and the Android latest-release regression to pass before
publication. The exact run links and results are recorded with the
[ios-v1.0.0 Release](https://github.com/hedanbaomi/tarot-divination-site/releases/tag/ios-v1.0.0).

The cloud acceptance scope for this version is iPhone on iOS 26.2, compatibility
iPhone on iOS 18.6, and iPad on iPadOS 26.2. This matrix does not establish
physical-device signing, installation or renewal. Those remain
`DEVICE_ACCEPTANCE_PENDING`. The deployment target remains 16.0, but no actual
iOS/iPadOS 16 runtime result is claimed; minimum-OS runtime acceptance remains
`MIN_OS_ACCEPTANCE_PENDING`.

External device acceptance should cover first launch after signing; offline
LXXXI back and all 81 faces; all three decks; the touch drawing board; Files
export/import and cancellation; announcement revision handling; telemetry
opt-out; restart; same-identity renewal and version overwrite with history,
custom spreads and settings intact; iPad landscape; text sizes; and the share
popover.

When reporting a problem, include app version/build, device model, iOS/iPadOS
version, signing-tool name and version, effective Bundle ID, reproduction steps,
expected and actual results, a redacted error, and whether a backup exists. Do
not include an Apple Account, certificate, provisioning profile, pairing file,
device identifier, personal reading content or protected card image.

## Build and test

`QuareiaPublic` uses synthetic images for protected-resource tests. Public CI
and the public source tree contain no private provider or private LXXXI artwork.
Simulator success does not establish device or re-signing acceptance.

From a checkout with the source commit in `web-assets.json` available:

```bash
node ios-app/tools/sync-web-assets.mjs
node ios-app/tools/sync-web-assets.mjs --check
```

The explicit manifest reads Android-distributed public files from Git objects
at a fixed SHA, verifies source hashes, and writes generated resources and their
provenance. It does not copy directories from the working tree. Generated files
are ignored. The 157 Tarot/Mystagogus JPEGs and five theme PNGs already present
in the locked public Android Git tree are copied byte-for-byte against individual hashes; no private
LXXXI artwork is copied. Reviewed iOS overlays provide the native
bridge, Files transfer, persistent mobile template library, and aggregate backup.
The fixed local origin keeps persistent IndexedDB and localStorage. Web network
requests, Web announcements and Web telemetry are disabled; native URLSession
services use explicit trusted endpoint configuration.

The application includes the locked Android deck/spread/history/free-board logic,
native themed about/privacy/announcement surfaces, consent-based telemetry and a
size/hash-checked update download handed to the system share sheet. Production
endpoints are unconfigured by default. Announcements and updates have independent
network clients and do not depend on telemetry consent. Full backups contain
history, templates, draft, theme and locale; import validates first and uses a
recovery journal. They exclude artwork, keys and telemetry identity.

Optional build-time `QuareiaServices` metadata in Info.plist requires exactly
`trustedHosts` (unique lowercase ASCII host names), `announcementsURL`,
`telemetryURL`, and `updateManifestURL` (absolute trusted HTTPS strings).
Unknown, missing or unsafe values disable remote services. The dictionary is
read when the native host is created and cannot be changed by web content.
No endpoint is supplied in the checked-in plist.

On a Mac with a stable Xcode and an installed iOS simulator:

```bash
npm ci --prefix telemetry-worker --ignore-scripts
node --test ios-app/Tests/*.test.mjs
python3 -m unittest discover -s ios-app/tools -p 'test_*.py'
bash ios-app/tools/cloud-test.sh
```

The public GitHub Actions workflow runs on a standard `macos-15` runner with
stable Xcode 26.3 (or the explicit `IOS_DEVELOPER_DIR` override), records
the actual Xcode, SDK, architecture and available runtimes, selects an available
iPhone/iPad simulator plus the oldest available compatible runtime, runs
XCTest/XCUITest, and builds a separate unsigned `iphoneos` app. The script starts
an isolated loopback Worker with local D1; the test scheme explicitly enables
that fixture. No production credentials or databases are used. Mach-O platform
checks distinguish device from simulator even on arm64. A synthetic IPA is
created and reopened for inspection on the runner, then discarded with the job.
No package, artifact or cache is uploaded. Only public test evidence is logged.
Runner labels are not a promise that any particular old simulator is installed.

The installed iOS 18.5 runtime failed before app startup under both Xcode 16.4
and 26.3 with the Apple-tracked
[missing Swift WebKit library issue](https://developer.apple.com/forums/thread/785964).
The selector reports this excluded runtime and chooses the next installed
eligible runtime for compatibility tests. It does not alter security
settings, raise the app deployment target, or patch simulator system libraries.

The dedicated `-probe` page remains a foundation test alongside the real app.
An implemented test is not evidence of execution: use the exact source SHA and
matching successful Actions run when reporting acceptance. Missing iOS 16
runtime coverage remains `MIN_OS_ACCEPTANCE_PENDING`; the target stays 16.0.

## Packaging and distribution tools

`tools/package-ipa.py` accepts only an inspected device app and requires exact
source SHA, version, build and the explicit `--synthetic-test-product` flag.
It verifies the final Payload, executable platform/architecture, permissions,
provenance and resource hashes after reopening the archive. It has no upload
or signing operation. Run it with `--help` for the required local output paths.

`tools/plan-ios-release.mjs` writes a dry-run plan and independent iOS update
manifest. Its output is never publishable, and it tests the Android latest
release parser. The original download hash is verified before sharing; app
startup does not bind execution to that hash or an author's signing identity.

`tools/private-integration-gate.py` supplies synthetic contract exercises; its
legacy `real` subcommand remains a blocked public scaffold, not the real runner.
`tools/run-private-integration.py status` returns `PRIVATE_BUILD_BLOCKED` and
exit code 3 by default. Its separately approved real mode requires reviewed
source, owner-only external inputs, isolated temporary/output directories, and
provider runtime acceptance tests. It copies no input into this checkout and
removes its disposable test simulator and temporary inputs. Synthetic checks
are not evidence that the real private format decoded successfully. A successful
authorized `run` instead reports `PRIVATE_PROVIDER_RUNTIME_VERIFIED` with a
`PRIVATE_CANDIDATE` product; default/public blocked status does not describe that
verified private run.

The approved `run` command accepts `--full-runtime` to run the reviewed public
Swift and UI tests with the integrated provider, in addition to the 82-record
decode and format-authentication tests. The private workflow must first start
the reviewed `telemetry-worker/tools/ios-local-fixture.mjs` at its fixed loopback
origin and own its cleanup. There is no production fallback. Simulator tests
retain `PUBLIC_TESTING` only for test hooks and loopback services;
`DISTRIBUTION PRIVATE_LXXXI_PROVIDER` keeps the real provider selected. The runner
requires every reviewed test to pass once, in native, critical-UI and remaining-UI
groups with the existing 600/600/1200-second limits, without retries.

Every device candidate uses Release, `-O`, no testability/debug dylib, and only
`DISTRIBUTION PRIVATE_LXXXI_PROVIDER`. Add
`--ipa-output /owner-private/output/Quareia-<version>-<build>.ipa` to the existing
required `run` arguments to create an unsigned `Payload/Quareia.app` archive.
This output must be outside the public repository, manifest inputs, temporary
root and candidate app, with an owner-only parent. The runner rechecks the app
and ZIP and records the approved source/manifest, final app tree, IPA size/hash,
provider evidence and full-suite status in the private report. Its final bundle
allowlist rejects source/key/environment sidecars, raw or decoded material, and
unreviewed runtime files. Source-tree checks run before overlay injection.
The synthetic inspector/packager CLI remains unchanged and cannot accept this
private candidate. A verified unsigned IPA still reports
`DEVICE_ACCEPTANCE_PENDING` and `releaseComplete=false`; signing, device
acceptance and publication are separate operations. Failure output contains
only normalized categories, Swift basenames/line numbers or failed test names;
raw logs and result bundles remain ephemeral and must not be uploaded.

iOS updates must use an independent manifest/channel. Any future `ios-v*` Release
must set `make_latest=false` and pass the existing Android latest-release parser
before and after publication. These tools create no Release or production
deployment. Public distribution of third-party content requires its
separate authorization; this document grants none.

Original public iOS software is MPL-2.0, including software generated from the
Android mobile distribution. See [LICENSE.md](LICENSE.md),
[the license text](../LICENSES/MPL-2.0.txt), and existing third-party notices.
