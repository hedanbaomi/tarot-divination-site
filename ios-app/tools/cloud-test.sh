#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p ios-app/build
# Verified standard runner image includes this stable Xcode. Fail if removed;
# do not silently fall back to the broken 16.4/iOS 18.5 WebKit simulator pair.
export DEVELOPER_DIR="${IOS_DEVELOPER_DIR:-/Applications/Xcode_26.3.app/Contents/Developer}"
test -x "$DEVELOPER_DIR/usr/bin/xcodebuild"
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
SDK_VERSION=$(xcrun --sdk iphonesimulator --show-sdk-version)
SIMULATOR_ID=$(python3 - "$SDK_VERSION" <<'PY'
import json, re, sys
data=json.load(open('ios-app/build/devices.json'))
sdk=tuple(int(n) for n in sys.argv[1].split('.')[:2])
choices=[]
for runtime,devices in data['devices'].items():
    match=re.search(r'\.iOS-(\d+)-(\d+)',runtime)
    if not match: continue
    version=tuple(map(int,match.groups()))
    if version>sdk: continue
    for device in devices:
        if device.get('isAvailable') and device['name'].startswith('iPhone'):
            model=re.search(r'iPhone (\d+)',device['name'])
            choices.append((version,int(model[1]) if model else 0,device['name'],runtime,device))
if not choices: raise SystemExit('No installed available iPhone runtime supported by the selected Xcode SDK')
_,_,_,runtime,device=max(choices,key=lambda x:x[:3])
json.dump({'runtime':runtime,'name':device['name'],'udid':device['udid'],'sdk':sys.argv[1]},open('ios-app/build/selected-simulator.json','w'))
print(device['udid'])
PY
)
cat ios-app/build/selected-simulator.json
echo "SIMULATOR_ID=$SIMULATOR_ID"
xcrun simctl boot "$SIMULATOR_ID" || test "$(xcrun simctl list devices booted -j | grep -c "$SIMULATOR_ID")" -gt 0
python3 ios-app/tools/run-bounded.py 240 xcrun simctl bootstatus "$SIMULATOR_ID" -b
xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID,arch=$(uname -m)" \
  -derivedDataPath ios-app/build/simulator \
  -parallel-testing-enabled NO ONLY_ACTIVE_ARCH=YES build-for-testing | tee ios-app/build/xcode-build.log
python3 ios-app/tools/run-bounded.py 90 xcrun simctl install "$SIMULATOR_ID" ios-app/build/simulator/Build/Products/PublicTesting-iphonesimulator/Quareia.app
python3 ios-app/tools/run-bounded.py 90 xcrun simctl launch --terminate-running-process "$SIMULATOR_ID" com.hedanbaomi.quareia.ios -probe
sleep 3
python3 ios-app/tools/run-bounded.py 30 xcrun simctl spawn "$SIMULATOR_ID" log show --last 1m --predicate 'process == "Quareia" AND eventMessage CONTAINS "P0"' --style compact | tail -50
python3 ios-app/tools/run-bounded.py 300 xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID,arch=$(uname -m)" \
  -derivedDataPath ios-app/build/simulator -resultBundlePath ios-app/build/public-tests.xcresult \
  -parallel-testing-enabled NO ONLY_ACTIVE_ARCH=YES test-without-building | tee ios-app/build/xcode-test.log
# Device build is deliberately separate. No archive, signing, IPA or upload.
xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -configuration PublicTesting -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath ios-app/build/device CODE_SIGNING_ALLOWED=NO build | tee ios-app/build/xcode-device.log
python3 ios-app/tools/inspect-app.py ios-app/build/device/Build/Products/PublicTesting-iphoneos/Quareia.app --platform IOS
# The test host contains an injected XCTest PlugIns bundle. Inspect a separate
# app-only simulator build so the no-extensions gate stays strict for both apps.
xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -configuration PublicTesting -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID,arch=$(uname -m)" \
  -derivedDataPath ios-app/build/simulator-app ONLY_ACTIVE_ARCH=YES build | tee ios-app/build/xcode-simulator-app.log
python3 ios-app/tools/inspect-app.py ios-app/build/simulator-app/Build/Products/PublicTesting-iphonesimulator/Quareia.app --platform IOSSIMULATOR
# Prove a public checkout cannot silently emit a complete distribution build.
if xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath ios-app/build/distribution CODE_SIGNING_ALLOWED=NO build > ios-app/build/distribution-gate.log 2>&1; then
  echo 'FAIL: distribution unexpectedly built without private integration'; exit 1
fi
grep -F 'Distribution is blocked: private LXXXI provider integration is not implemented' ios-app/build/distribution-gate.log
echo 'PRIVATE_DISTRIBUTION_FAIL_CLOSED_PASS'
# The passing probe UI test emits a synthetic-only screenshot after readiness.
printf '\nPUBLIC_SIMULATOR_AND_DEVICE_BUILD_PASS\nDEVICE_ACCEPTANCE_PENDING\nPRIVATE_BUILD_BLOCKED\n'
