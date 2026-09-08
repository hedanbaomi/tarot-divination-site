#!/bin/bash
# SPDX-License-Identifier: MPL-2.0
set -euo pipefail
case "${IOS_SHARE_DIAGNOSTIC_ONLY-0}" in
  0|1) ;;
  *) echo 'Invalid IOS_SHARE_DIAGNOSTIC_ONLY: expected unset, 0, or 1' >&2; exit 2 ;;
esac
case "${IOS_FILES_DIAGNOSTIC_ONLY-0}" in
  0|1) ;;
  *) echo 'Invalid IOS_FILES_DIAGNOSTIC_ONLY: expected unset, 0, or 1' >&2; exit 2 ;;
esac
case "${IOS_QSP_DIAGNOSTIC_ONLY-0}" in
  0|1) ;;
  *) echo 'Invalid IOS_QSP_DIAGNOSTIC_ONLY: expected unset, 0, or 1' >&2; exit 2 ;;
esac
if [ "$(( ${IOS_FILES_DIAGNOSTIC_ONLY-0} + ${IOS_SHARE_DIAGNOSTIC_ONLY-0} + ${IOS_QSP_DIAGNOSTIC_ONLY-0} ))" -gt 1 ]; then
  echo 'Choose only one public diagnostic mode' >&2; exit 2
fi
cd "$(dirname "$0")/../.."
mkdir -p ios-app/build
export CLOUDFLARE_TELEMETRY_DISABLED=1 WRANGLER_SEND_METRICS=false
(cd telemetry-worker && exec node tools/ios-local-fixture.mjs) > ios-app/build/local-fixture.log 2>&1 &
FIXTURE_PID=$!
cleanup() {
  local cleanup_status=$?
  if [ -n "${SIMULATOR_ID:-}" ]; then
    python3 ios-app/tools/run-bounded.py 30 xcrun simctl spawn "$SIMULATOR_ID" log show --last 45m \
      --predicate 'process == "Quareia" AND (eventMessage BEGINSWITH "IOS_UI_STATE " OR eventMessage BEGINSWITH "IOS_BOARD_DIAGNOSTIC ")' --style compact | tail -250 || true
  fi
  kill "$FIXTURE_PID" 2>/dev/null || true
  wait "$FIXTURE_PID" 2>/dev/null || true
  return "$cleanup_status"
}
trap cleanup EXIT
python3 - <<'PY'
import time, urllib.request
for _ in range(120):
    try:
        with urllib.request.urlopen('http://127.0.0.1:8787/__fixture/health', timeout=1) as response:
            if response.status == 200: break
    except Exception: time.sleep(0.5)
else: raise SystemExit('Local Worker fixture failed to start')
print('ISOLATED_LOOPBACK_FIXTURE_READY')
PY
node ios-app/tools/verify-fixture.mjs
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
python3 ios-app/tools/select-simulator.py ios-app/build/devices.json \
  --sdk "$SDK_VERSION" --family "${IOS_DEVICE_FAMILY:-iPhone}" \
  --policy "${IOS_RUNTIME_POLICY:-latest}" > ios-app/build/selected-simulator.json
SIMULATOR_ID=$(python3 -c "import json; print(json.load(open('ios-app/build/selected-simulator.json'))['udid'])")
cat ios-app/build/selected-simulator.json
python3 -c "import json; d=json.load(open('ios-app/build/selected-simulator.json')); print('MIN_OS_ACCEPTANCE_PENDING' if d['minimumOSAcceptancePending'] else 'MIN_OS_RUNTIME_AVAILABLE')"
echo "SIMULATOR_ID=$SIMULATOR_ID"
xcrun simctl boot "$SIMULATOR_ID" || test "$(xcrun simctl list devices booted -j | grep -c "$SIMULATOR_ID")" -gt 0
python3 ios-app/tools/run-bounded.py 240 xcrun simctl bootstatus "$SIMULATOR_ID" -b
python3 ios-app/tools/run-bounded.py 600 xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID,arch=$(uname -m)" \
  -derivedDataPath ios-app/build/simulator \
  -parallel-testing-enabled NO ONLY_ACTIVE_ARCH=YES build-for-testing | tee ios-app/build/xcode-build.log
echo 'SIMULATOR_INSTALL_BEGIN'
python3 ios-app/tools/run-bounded.py 240 xcrun simctl install "$SIMULATOR_ID" ios-app/build/simulator/Build/Products/PublicTesting-iphonesimulator/Quareia.app
echo 'SIMULATOR_INSTALL_PASS_LAUNCH_BEGIN'
python3 ios-app/tools/run-bounded.py 180 xcrun simctl launch --terminate-running-process "$SIMULATOR_ID" com.hedanbaomi.quareia.ios -probe
echo 'SIMULATOR_LAUNCH_PASS'
sleep 3
# Unified log collection is diagnostic; the XCTest smoke below checks the app.
python3 ios-app/tools/run-bounded.py 30 xcrun simctl spawn "$SIMULATOR_ID" log show --last 1m --predicate 'process == "Quareia" AND eventMessage CONTAINS "P0"' --style compact | tail -50 \
  || echo 'PUBLIC_PROBE_LOG_COLLECTION_UNAVAILABLE'
# Run gesture and system-panel scenarios first for prompt failure evidence.
# The remainder excludes exactly these already-executed tests; no retry.
BOARD_TEST='QuareiaUITests/QuareiaUITests/testFreeBoardGesturesHistoryAndDraftRestore'
UPDATE_TEST='QuareiaUITests/QuareiaUITests/testLoopbackUpdateDownloadCancelAndHandoff'
FILES_TEST='QuareiaUITests/QuareiaUITests/testNativeFilesImportCanBeCancelled'
QSP_TEST='QuareiaUITests/QuareiaUITests/testCustomSpreadQSPRoundTripUsesTheRealStudio'
if [ "${IOS_QSP_DIAGNOSTIC_ONLY-0}" = 1 ]; then
  python3 ios-app/tools/run-bounded.py 600 xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID,arch=$(uname -m)" \
    -derivedDataPath ios-app/build/simulator -resultBundlePath ios-app/build/qsp-diagnostic.xcresult \
    -only-testing:"$QSP_TEST" \
    -parallel-testing-enabled NO ONLY_ACTIVE_ARCH=YES test-without-building | tee ios-app/build/xcode-qsp-diagnostic.log
  echo 'PUBLIC_QSP_DIAGNOSTIC_PASS'
  exit 0
fi
if [ "${IOS_FILES_DIAGNOSTIC_ONLY-0}" = 1 ]; then
  python3 ios-app/tools/run-bounded.py 300 xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID,arch=$(uname -m)" \
    -derivedDataPath ios-app/build/simulator -resultBundlePath ios-app/build/files-diagnostic.xcresult \
    -only-testing:"$FILES_TEST" \
    -parallel-testing-enabled NO ONLY_ACTIVE_ARCH=YES test-without-building | tee ios-app/build/xcode-files-diagnostic.log
  echo 'PUBLIC_FILES_DIAGNOSTIC_PASS'
  exit 0
fi
if [ "${IOS_SHARE_DIAGNOSTIC_ONLY-0}" = 1 ]; then
  python3 ios-app/tools/run-bounded.py 300 xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID,arch=$(uname -m)" \
    -derivedDataPath ios-app/build/simulator -resultBundlePath ios-app/build/share-diagnostic.xcresult \
    -only-testing:"$UPDATE_TEST" \
    -parallel-testing-enabled NO ONLY_ACTIVE_ARCH=YES test-without-building | tee ios-app/build/xcode-share-diagnostic.log
  echo 'PUBLIC_SHARE_DIAGNOSTIC_PASS'
  exit 0
fi
# Renew the XCTest runner session between system-panel scenarios. Keep the
# same simulator/app container and run every test once within the original
# aggregate 600-second budget; do not erase state, retry, or reinstall.
critical_tests=("$BOARD_TEST" "$UPDATE_TEST" "$FILES_TEST")
critical_deadline=$((SECONDS + 600))
for critical_index in "${!critical_tests[@]}"; do
  remaining_seconds=$((critical_deadline - SECONDS))
  if [ "$remaining_seconds" -le 0 ]; then
    echo 'Critical UI aggregate deadline exceeded' >&2; exit 1
  fi
  python3 ios-app/tools/run-bounded.py "$remaining_seconds" xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
    -destination "platform=iOS Simulator,id=$SIMULATOR_ID,arch=$(uname -m)" \
    -derivedDataPath ios-app/build/simulator -resultBundlePath "ios-app/build/critical-$critical_index.xcresult" \
    -only-testing:"${critical_tests[$critical_index]}" \
    -parallel-testing-enabled NO ONLY_ACTIVE_ARCH=YES test-without-building | tee "ios-app/build/xcode-critical-$critical_index.log"
done
echo 'PUBLIC_CRITICAL_UI_PASS'
python3 ios-app/tools/run-bounded.py 1200 xcodebuild -project ios-app/Quareia.xcodeproj -scheme QuareiaPublic \
  -destination "platform=iOS Simulator,id=$SIMULATOR_ID,arch=$(uname -m)" \
  -derivedDataPath ios-app/build/simulator -resultBundlePath ios-app/build/public-tests.xcresult \
  -skip-testing:"$BOARD_TEST" -skip-testing:"$UPDATE_TEST" -skip-testing:"$FILES_TEST" \
  -parallel-testing-enabled NO ONLY_ACTIVE_ARCH=YES test-without-building | tee ios-app/build/xcode-test.log
echo 'PUBLIC_SIMULATOR_TESTS_PASS'
printf '\nDEVICE_ACCEPTANCE_PENDING\nPRIVATE_BUILD_BLOCKED\n'
