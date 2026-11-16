#!/usr/bin/env bash
set -euo pipefail
task_repo_root=$(cd "$(dirname "$0")/../.." && pwd)
collect_evidence() {
    task_test_status=$?
    set +e
    mkdir -p "$task_repo_root/native-dist"
    adb pull /sdcard/Android/data/com.inknote.nativepreview/files/native-library.png "$task_repo_root/native-dist/"
    adb pull /sdcard/Android/data/com.inknote.nativepreview/files/native-editor.png "$task_repo_root/native-dist/"
    adb logcat -d > "$task_repo_root/native-dist/emulator-logcat.txt"
    exit "$task_test_status"
}
trap collect_evidence EXIT
cd "$task_repo_root/mobile/native-android"
../android/gradlew --no-daemon connectedDebugAndroidTest
