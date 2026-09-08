# Quareia iOS self-signing implementation

This Swift/UIKit/WKWebView application targets iOS/iPadOS 16+, iPhone and iPad,
version 1.0.0/build 1. The public testing build is named **Quareia Test** and
uses synthetic LXXXI artwork. It is not a signed release or a complete private package.

`QuareiaPublic` uses synthetic images for its protected-resource tests. The
public build has no private provider or private LXXXI artwork. Release builds
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

## Signing and external acceptance

No complete private IPA is supplied by public CI. When an approved complete
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
