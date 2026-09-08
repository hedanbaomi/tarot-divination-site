#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p ios-app/build
export DEVELOPER_DIR="${IOS_DEVELOPER_DIR:-/Applications/Xcode_26.3.app/Contents/Developer}"
test -x "$DEVELOPER_DIR/usr/bin/xcodebuild"
echo "SOURCE_SHA=$(git rev-parse HEAD)"
xcodebuild -version
if xcodebuild -version | grep -Eiq 'beta|release candidate'; then
  echo 'A stable Xcode is required'; exit 1
fi
# Device build is separate; a synthetic IPA is inspected locally and never uploaded.
xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -configuration PublicTesting -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath ios-app/build/device CODE_SIGNING_ALLOWED=NO build | tee ios-app/build/xcode-device.log
python3 ios-app/tools/inspect-app.py ios-app/build/device/Build/Products/PublicTesting-iphoneos/Quareia.app --platform IOS \
  --source-sha "$(git rev-parse HEAD)" --expected-version 1.0.0 --expected-build 1 --synthetic-test-product
python3 ios-app/tools/package-ipa.py ios-app/build/device/Build/Products/PublicTesting-iphoneos/Quareia.app \
  --source-sha "$(git rev-parse HEAD)" --expected-version 1.0.0 --expected-build 1 --synthetic-test-product \
  --output ios-app/build/Quareia-1.0.0-1.ipa --package-report ios-app/build/synthetic-package.json
echo 'SYNTHETIC_IPHONEOS_PACKAGE_INSPECTION_PASS_NO_UPLOAD'
python3 ios-app/tools/private-integration-gate.py make-synthetic \
  --output ios-app/build/private-provider-synthetic --source-sha "$(git rev-parse HEAD)"
python3 ios-app/tools/private-integration-gate.py verify-synthetic \
  --fixture ios-app/build/private-provider-synthetic --app-report ios-app/build/synthetic-package.json \
  --source-sha "$(git rev-parse HEAD)"
if python3 ios-app/tools/run-private-integration.py status; then
  echo 'FAIL: private integration was not blocked by default'; exit 1
else
  test "$?" = 3
fi
node ios-app/tools/plan-ios-release.mjs \
  --ipa ios-app/build/Quareia-1.0.0-1.ipa --package-report ios-app/build/synthetic-package.json \
  --download-url https://github.com/hedanbaomi/tarot-divination-site/releases/download/ios-v1.0.0/QuareiaDivination-iOS-v1.0.0.ipa \
  --tag ios-v1.0.0 --previous-manifest INITIAL_CHANNEL --output ios-app/build/ios-release-plan.json
echo 'SYNTHETIC_CONTRACT_AND_RELEASE_DRY_RUN_PASS_REAL_PRIVATE_PENDING'
# The test host contains an injected XCTest PlugIns bundle. Inspect a separate
# app-only simulator build so the no-extensions gate stays strict for both apps.
xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -configuration PublicTesting -sdk iphonesimulator \
  -destination "generic/platform=iOS Simulator" ARCHS="$(uname -m)" \
  -derivedDataPath ios-app/build/simulator-app ONLY_ACTIVE_ARCH=YES build | tee ios-app/build/xcode-simulator-app.log
python3 ios-app/tools/inspect-app.py ios-app/build/simulator-app/Build/Products/PublicTesting-iphonesimulator/Quareia.app --platform IOSSIMULATOR \
  --source-sha "$(git rev-parse HEAD)" --expected-version 1.0.0 --expected-build 1 --synthetic-test-product
# Prove a public checkout cannot silently emit a complete distribution build.
if xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath ios-app/build/distribution CODE_SIGNING_ALLOWED=NO build > ios-app/build/distribution-gate.log 2>&1; then
  echo 'FAIL: distribution unexpectedly built without private integration'; exit 1
fi
grep -F 'Distribution is blocked: private LXXXI provider integration is not implemented' ios-app/build/distribution-gate.log
echo 'PRIVATE_DISTRIBUTION_FAIL_CLOSED_PASS'
printf '\nPUBLIC_DEVICE_PACKAGE_GATES_PASS\nDEVICE_ACCEPTANCE_PENDING\nPRIVATE_BUILD_BLOCKED\n'
