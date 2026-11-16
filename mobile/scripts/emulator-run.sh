#!/usr/bin/env bash
# Runs inside the Android emulator job of .github/workflows/android.yml (repository root as working directory).
# 1. the debug build: driven through the WebView (tests/emulator.mjs); 2. the release build: installs and starts cleanly.
set -u
OUT="$PWD/emulator-results"; mkdir -p "$OUT"
DEBUG_APK="mobile/android/app/build/outputs/apk/debug/app-debug.apk"
RELEASE_APK="${INKNOTE_EMULATOR_RELEASE_APK:-$(ls dist/*.apk | head -1)}"
status=0

adb wait-for-device
adb shell settings put global window_animation_scale 0 || true
adb shell settings put global transition_animation_scale 0 || true
adb shell settings put global animator_duration_scale 0 || true
adb shell dumpsys package com.google.android.webview 2>/dev/null | grep -m1 versionName | sed 's/^ */WebView package: /' | tee "$OUT/webview.txt" || true

echo "== debug build: checks through the WebView"
adb install -r -g "$DEBUG_APK" || status=1
(cd mobile && timeout 600 node tests/emulator.mjs com.inknote.app.debug "$OUT") || status=1
adb logcat -d > "$OUT/logcat-debug.txt" || true
adb uninstall com.inknote.app.debug || true

echo "== release build: install and start"
adb logcat -c || true
adb install -r "$RELEASE_APK" || status=1
adb shell monkey -p com.inknote.app -c android.intent.category.LAUNCHER 1 || status=1
sleep 25
adb exec-out screencap -p > "$OUT/release-start.png" || true
adb logcat -d > "$OUT/logcat-release.txt" || true
if grep -q "FATAL EXCEPTION" "$OUT/logcat-release.txt"; then echo "✗ release build crashed" | tee -a "$OUT/results.txt"; status=1; fi
if adb shell pidof com.inknote.app >/dev/null; then echo "✓ release build starts and keeps running" | tee -a "$OUT/results.txt"; else echo "✗ release build is not running" | tee -a "$OUT/results.txt"; status=1; fi
grep -E "Capacitor/Console|chromium" "$OUT/logcat-release.txt" | grep -iE "error|uncaught" | head -20 > "$OUT/release-console-errors.txt" || true
exit $status
