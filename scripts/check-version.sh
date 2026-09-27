#!/usr/bin/env bash
# Keeps the release version honest across the three places that used to hold
# their own literal: the Android APK, the backend, and the dashboard.
#
# Run from CI before publishing, and after changing VERSION locally.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "  ok   $1"; }

VERSION_FILE="$ROOT/VERSION"
test -f "$VERSION_FILE" || fail "VERSION file missing at $VERSION_FILE"
VERSION="$(tr -d '[:space:]' < "$VERSION_FILE")"
test -n "$VERSION" || fail "VERSION file is empty"
echo "== version =="
ok "VERSION = $VERSION"

# The format the dashboard assumes when it renders "v${version}".
if ! printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  fail "VERSION must look like MAJOR.MINOR.PATCH, got '$VERSION'"
fi
ok "VERSION is well formed"

# --- No hardcoded version literals left in the dashboard ----------------------
# These drifted to v0.3.3 / v0.3.2 while the APK moved to 0.3.3, which is how a
# release page ends up advertising a build that is not the one it serves.
echo "== dashboard =="
stale="$(grep -rInE 'v[0-9]+\.[0-9]+\.[0-9]+' frontend/src 2>/dev/null || true)"
if [ -n "$stale" ]; then
  fail "hardcoded version literal(s) in frontend/src — read the version from /health/version instead:
$stale"
fi
ok "no hardcoded version literals in frontend/src"

# The backend must derive its version from the file, not a literal.
if grep -qE "version: *'[0-9]+\.[0-9]+\.[0-9]+'" backend/src/config.ts; then
  fail "backend/src/config.ts hardcodes a version — it must read the VERSION file"
fi
ok "backend reads the VERSION file"

# --- The APK, if one has been built ------------------------------------------
# Optional: this runs in CI *after* the build, and locally you may only be
# changing the version before rebuilding.
APK="${1:-}"
if [ -n "$APK" ] && [ -f "$APK" ]; then
  echo "== apk =="
  AAPT2="${AAPT2:-}"
  if [ -z "$AAPT2" ]; then
    if [ -n "${ANDROID_HOME:-}" ] && [ -x "$ANDROID_HOME/build-tools/35.0.0/aapt2" ]; then
      AAPT2="$ANDROID_HOME/build-tools/35.0.0/aapt2"
    else
      echo "  skip aapt2 not found (set ANDROID_HOME or AAPT2)"
    fi
  fi
  if [ -n "$AAPT2" ]; then
    badging="$("$AAPT2" dump badging "$APK")"
    apk_code="$(printf '%s' "$badging" | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)"
    apk_name="$(printf '%s' "$badging" | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
    [ "$apk_name" = "$VERSION" ] || fail "APK versionName '$apk_name' != VERSION '$VERSION'"
    ok "APK versionName matches VERSION"
    [ -n "$apk_code" ] && [ "$apk_code" -gt 0 ] 2>/dev/null || fail "APK versionCode missing or not a positive integer"
    ok "APK versionCode = $apk_code"
  fi
fi

echo
echo "All version checks passed."
