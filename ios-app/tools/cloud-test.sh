#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p ios-app/build
{
  echo "SOURCE_SHA=$(git rev-parse HEAD)"
  echo "RUNNER_IMAGE=${ImageOS:-unknown}/${ImageVersion:-unknown}"
  sw_vers
  uname -m
  xcodebuild -version
  xcodebuild -showsdks
  swift --version
  xcrun simctl list runtimes
} | tee ios-app/build/environment.txt
if xcodebuild -version | grep -Eiq 'beta|release candidate'; then
  echo 'A stable Xcode is required'; exit 1
fi
xcrun simctl list devices available -j > ios-app/build/devices.json
SIMULATOR_ID=$(python3 - <<'PY'
import json
data=json.load(open('ios-app/build/devices.json'))
choices=[(runtime,d) for runtime, devices in data['devices'].items() if '.iOS-' in runtime for d in devices if d.get('isAvailable') and d['name'].startswith('iPhone')]
if not choices: raise SystemExit('No installed available iPhone simulator runtime')
runtime,device=sorted(choices, key=lambda x:(x[0],x[1]['name']),reverse=True)[0]
print(device['udid'])
PY
)
echo "SIMULATOR_ID=$SIMULATOR_ID"
xcrun simctl boot "$SIMULATOR_ID" || test "$(xcrun simctl list devices booted -j | grep -c "$SIMULATOR_ID")" -gt 0
xcrun simctl bootstatus "$SIMULATOR_ID" -b
xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID" \
  -derivedDataPath ios-app/build/simulator -resultBundlePath ios-app/build/public-tests.xcresult \
  -parallel-testing-enabled NO test | tee ios-app/build/xcode-test.log
# Device build is deliberately separate. No archive, signing, IPA or upload.
xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -configuration PublicTesting -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath ios-app/build/device CODE_SIGNING_ALLOWED=NO build | tee ios-app/build/xcode-device.log
python3 ios-app/tools/inspect-app.py ios-app/build/device/Build/Products/PublicTesting-iphoneos/Quareia.app --platform IOS
python3 ios-app/tools/inspect-app.py ios-app/build/simulator/Build/Products/PublicTesting-iphonesimulator/Quareia.app --platform IOSSIMULATOR
# Prove a public checkout cannot silently emit a complete distribution build.
if xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath ios-app/build/distribution CODE_SIGNING_ALLOWED=NO build > ios-app/build/distribution-gate.log 2>&1; then
  echo 'FAIL: distribution unexpectedly built without private integration'; exit 1
fi
grep -F 'Distribution is blocked: private LXXXI provider integration is not implemented' ios-app/build/distribution-gate.log
echo 'PRIVATE_DISTRIBUTION_FAIL_CLOSED_PASS'
# A tiny synthetic-only screenshot is emitted as base64 in the log, not stored as an artifact.
# UI tests never load card artwork or private material.
xcrun simctl terminate "$SIMULATOR_ID" com.hedanbaomi.quareia.ios || true
xcrun simctl launch "$SIMULATOR_ID" com.hedanbaomi.quareia.ios -probe
sleep 3
xcrun simctl io "$SIMULATOR_ID" screenshot ios-app/build/public-probe.png
python3 - <<'PY'
import base64
print('PUBLIC_PROBE_SCREENSHOT_BASE64_BEGIN')
print(base64.b64encode(open('ios-app/build/public-probe.png','rb').read()).decode())
print('PUBLIC_PROBE_SCREENSHOT_BASE64_END')
PY
printf '\nPUBLIC_SIMULATOR_AND_DEVICE_BUILD_PASS\nDEVICE_ACCEPTANCE_PENDING\nPRIVATE_BUILD_BLOCKED\n'
