#!/usr/bin/env bash
# Refuse to publish an APK that could break an already-paired phone.
#
# The failure this exists to prevent: an APK signed with a different key cannot
# be installed over an existing app. Android answers INSTALL_FAILED_UPDATE_INCOMPATIBLE,
# the only way forward is to uninstall, and uninstalling erases the pairing, the
# server URL and every queued GPS point. From the technician's side that looks
# like "the app got blocked", not like a signing mistake.
#
# Usage:
#   scripts/preflight-update.sh path/to/app-release.apk [options]
#
#   --expect-fingerprint SHA256   signing cert that must be present (default: the
#                                 shared fleet key; override for your own key)
#   --min-version-code N          refuse anything not strictly newer than this
#   --install                     actually install on the attached device
#   --serial SERIAL               target a specific device
#   --skip-device                 never touch a device even if one is attached
#
# Exits non-zero on the first problem, printing what to do about it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The shared release key. A customer using their own key passes their own
# fingerprint; see docs/signing.md.
DEFAULT_FINGERPRINT="5989d0500690f5b7a817247724b0a2532ac826302e243bd41f37730d5cdc6322"
PKG="org.opensource.tracker"

APK=""
EXPECT="$DEFAULT_FINGERPRINT"
MIN_CODE=""
DO_INSTALL=0
SKIP_DEVICE=0
SERIAL=""

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "  ok   $1"; }
note() { echo "  ..   $1"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --expect-fingerprint) EXPECT="$2"; shift 2 ;;
    --min-version-code)   MIN_CODE="$2"; shift 2 ;;
    --install)            DO_INSTALL=1; shift ;;
    --serial)             SERIAL="$2"; shift 2 ;;
    --skip-device)        SKIP_DEVICE=1; shift ;;
    -h|--help)            sed -n '2,20p' "$0"; exit 0 ;;
    -*)                   fail "unknown option $1" ;;
    *)                    APK="$1"; shift ;;
  esac
done

[ -n "$APK" ] || { sed -n '2,20p' "$0"; echo >&2; fail "no APK given"; }
[ -f "$APK" ] || fail "APK not found: $APK"

# --- locate the SDK tooling ---------------------------------------------------
# Order matters: an explicit AAPT2/APKSIGNER wins, then ANDROID_HOME (the Android
# environment script sets this), then ANDROID_SDK_ROOT, then the usual macOS path.
find_tool() {
  local name="$1" root
  for root in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk"; do
    [ -n "$root" ] || continue
    for candidate in "$root"/build-tools/*/"$name"; do
      [ -x "$candidate" ] && { echo "$candidate"; return 0; }
    done
  done
  return 1
}

APKSIGNER="${APKSIGNER:-$(find_tool apksigner || true)}"
AAPT2="${AAPT2:-$(find_tool aapt2 || true)}"
if [ -z "$APKSIGNER" ] || [ -z "$AAPT2" ]; then
  fail "could not find apksigner/aapt2 — install the Android SDK build-tools or set ANDROID_HOME"
fi
# apksigner is a shell script that execs `java`.
if [ -z "${JAVA_HOME:-}" ] || [ ! -x "$JAVA_HOME/bin/java" ]; then
  fail "JAVA_HOME is not set to a usable JDK (apksigner needs java)"
fi

echo "== signature =="
if ! "$APKSIGNER" verify "$APK" >/dev/null 2>&1; then
  # Deliberately vague: the usual cause is missing keystore properties, which
  # makes AGP emit an *unsigned* APK that still builds successfully.
  fail "APK does not verify — it is unsigned or corrupt. (An unsigned release build usually means android/local.properties has no storeFile/storePassword/keyAlias/keyPassword.)"
fi
ok "APK verifies"

ACTUAL="$("$APKSIGNER" verify --print-certs "$APK" 2>/dev/null \
  | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1)"
[ -n "$ACTUAL" ] || fail "could not read the signing certificate from the APK"
DN="$("$APKSIGNER" verify --print-certs "$APK" 2>/dev/null \
  | sed -n 's/^Signer #1 certificate DN: //p' | head -1)"
if [ "$ACTUAL" != "$EXPECT" ]; then
  fail "signed by the wrong key.
       expected $EXPECT
       actual   $ACTUAL  ($DN)
     Publishing this would make every phone reject the update
     (INSTALL_FAILED_UPDATE_INCOMPATIBLE) and require a re-pair, which erases
     the pairing and any queued GPS. See docs/signing.md."
fi
ok "signed by the expected certificate ($DN)"

echo "== version =="
BADGING="$("$AAPT2" dump badging "$APK")"
APK_CODE="$(printf '%s' "$BADGING" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)"
APK_NAME="$(printf '%s' "$BADGING" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
[ -n "$APK_CODE" ] && [ "$APK_CODE" -gt 0 ] 2>/dev/null || fail "could not read versionCode from the APK"
ok "versionCode=$APK_CODE versionName=$APK_NAME"

VERSION_FILE="$ROOT/VERSION"
if [ -f "$VERSION_FILE" ]; then
  WANT="$(tr -d '[:space:]' < "$VERSION_FILE")"
  [ "$APK_NAME" = "$WANT" ] || fail "APK versionName '$APK_NAME' != VERSION file '$WANT' — bump VERSION and rebuild, or the dashboard will advertise the wrong build"
  ok "versionName matches the VERSION file"
else
  note "no VERSION file at the repo root, skipping that check"
fi

if [ -n "$MIN_CODE" ]; then
  [ "$APK_CODE" -gt "$MIN_CODE" ] || fail "versionCode $APK_CODE is not newer than the published $MIN_CODE — Android will refuse the update (INSTALL_FAILED_VERSION_DOWNGRADE)"
  ok "versionCode is newer than the published $MIN_CODE"
fi

# --- schema guard -------------------------------------------------------------
# Room has no migrations registered yet, so bumping the schema version without
# adding a Migration makes the app throw on the technician's phone at the first
# database open. That is a crash on someone else's device, not a test failure.
echo "== room schema =="
ENTITY="$ROOT/android/app/src/main/java/org/opensource/tracker/LocationEntity.kt"
if [ -f "$ENTITY" ] && command -v git >/dev/null 2>&1; then
  cur_db="$(sed -n 's/.*@Database(.*version *= *\([0-9]*\).*/\1/p' "$ENTITY" | head -1)"
  head_db="$(git -C "$ROOT" show "HEAD:$ENTITY" 2>/dev/null | sed -n 's/.*@Database(.*version *= *\([0-9]*\).*/\1/p' | head -1 || true)"
  if [ -n "$cur_db" ] && [ -n "$head_db" ] && [ "$cur_db" != "$head_db" ]; then
    added_migration="$(git -C "$ROOT" diff HEAD -- android/ | grep -E '^\+.*(Migration\s*[:(]|AutoMigration)' || true)"
    if [ -z "$added_migration" ]; then
      fail "the Room schema moved from version $head_db to $cur_db but no Migration was added.
     Room.databaseBuilder has no addMigrations and no fallbackToDestructiveMigration,
     so the app will throw IllegalStateException on the first database open on every
     paired phone. Add an explicit Migration, or revert the schema change."
    fi
    ok "schema $head_db -> $cur_db with a Migration"
  else
    ok "schema unchanged (version ${cur_db:-unknown})"
  fi
else
  note "skipping schema check"
fi

# --- device -------------------------------------------------------------------
echo "== device =="
if [ "$SKIP_DEVICE" = "1" ]; then
  note "skipped (--skip-device)"
elif [ -z "$(command -v adb || true)" ]; then
  note "adb not on PATH, skipping device checks"
else
  # Decide whether there is exactly one device we can safely act on.
  run_device=0
  target=""
  if [ -n "$SERIAL" ]; then
    target="-$SERIAL"
    run_device=1
  else
    count="$(adb devices | sed '1d' | grep -c 'device$' || true)"
    if [ "${count:-0}" -eq 0 ]; then
      note "no device attached, skipping device checks"
    elif [ "${count:-0}" -gt 1 ]; then
      note "$count devices attached, skipping device checks (use --serial)"
    else
      run_device=1
    fi
  fi

  if [ "$run_device" = "1" ]; then
    state="$(adb $target get-state 2>/dev/null || true)"
    if [ "$state" = "device" ]; then
      installed_path="$(adb $target shell pm path "$PKG" 2>/dev/null | tr -d '\r' | sed 's/^package://' | head -1)"
      if [ -z "$installed_path" ]; then
        note "$PKG is not installed on this device, nothing to protect"
      else
        inst_code="$(adb $target shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r' | sed -n 's/.*versionCode=\([0-9]*\).*/\1/p' | head -1)"
        tmp="$(mktemp -d)"
        if adb $target pull "$installed_path" "$tmp/installed.apk" >/dev/null 2>&1 && [ -s "$tmp/installed.apk" ]; then
          inst_fp="$("$APKSIGNER" verify --print-certs "$tmp/installed.apk" 2>/dev/null \
            | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1)"
          if [ "$inst_fp" != "$EXPECT" ]; then
            rm -rf "$tmp"
            fail "this phone has $PKG installed with a DIFFERENT key.
       installed $inst_fp
       new APK    $EXPECT
     The update will be refused and the only fix is uninstalling, which erases
     the pairing, the server URL and every queued GPS point on that phone.
     Do not force this. See docs/signing.md."
          fi
          ok "installed app is signed by the same key"
          if [ -n "$inst_code" ] && [ "$APK_CODE" -le "$inst_code" ]; then
            rm -rf "$tmp"
            fail "phone has versionCode $inst_code installed; this APK is $APK_CODE. Android refuses a non-incrementing update (INSTALL_FAILED_VERSION_DOWNGRADE)."
          fi
          ok "phone has versionCode ${inst_code:-unknown}, new APK is newer"
        else
          note "could not read the installed APK's signature, skipping the key comparison"
        fi
        rm -rf "$tmp"

        if [ "$DO_INSTALL" = "1" ]; then
          echo "== install =="
          if adb $target install -r "$APK" 2>&1 | tee /tmp/preflight-install.log | grep -q Success; then
            ok "installed"
            new_code="$(adb $target shell dumpsys package "$PKG" 2>/dev/null | tr -d '\r' | sed -n 's/.*versionCode=\([0-9]*\).*/\1/p' | head -1)"
            [ "$new_code" = "$APK_CODE" ] || fail "installed but versionCode is $new_code, expected $APK_CODE"
            ok "device now on versionCode $new_code"
          else
            fail "adb install failed: $(tail -2 /tmp/preflight-install.log | tr '\n' ' ')"
          fi
        fi
      fi
    fi
  fi
fi

echo
echo "Preflight passed. This APK can be published without risking a re-pair."
