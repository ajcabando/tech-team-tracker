#!/usr/bin/env bash
# Publish a signed release APK to ./apk, where it is served at /tracker.apk.
#
# The only thing standing between a build mistake and a broken fleet: a phone
# that cannot install the new APK has to be uninstalled first, and that erases
# its pairing, its server URL and every GPS point it had queued offline. So
# nothing is copied into place until it has passed the same gate CI uses.
#
# Usage:
#   scripts/publish-apk.sh android/app/build/outputs/apk/release/app-release.apk
#
# Options:
#   --fingerprint SHA256   expected signing certificate (default: the shared
#                          fleet key; pass your own for a customer key)
#   --force                publish even over a newer already-published APK
#   --dry-run              run every check, copy nothing
#   --url URL              base URL to verify against (default http://localhost:5788)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK_DIR="$ROOT/apk"
TARGET="$APK_DIR/tracker.apk"
EXPECT=""
FORCE=0
DRY_RUN=0
URL=""

fail() { echo "FAIL: $1" >&2; exit 1; }
ok()   { echo "  ok   $1"; }
note() { echo "  ..   $1"; }

APK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --fingerprint) EXPECT="$2"; shift 2 ;;
    --force)       FORCE=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    --url)         URL="$2"; shift 2 ;;
    -h|--help)     sed -n '2,20p' "$0"; exit 0 ;;
    -*)            fail "unknown option $1" ;;
    *)             APK="$1"; shift ;;
  esac
done

[ -n "$APK" ] || { sed -n '2,20p' "$0"; echo >&2; fail "no APK given"; }
[ -f "$APK" ] || fail "APK not found: $APK"
mkdir -p "$APK_DIR"

# --- 1. the same gate CI uses -----------------------------------------------
echo "== preflight =="
gate=("$ROOT/scripts/preflight-update.sh" "$APK" --skip-device)
if [ -n "$EXPECT" ]; then
  gate+=(--expect-fingerprint "$EXPECT")
fi
"${gate[@]}" || fail "preflight refused this APK — nothing was published"

# --- 2. never go backwards ----------------------------------------------------
# Publishing an older build over a newer one produces a fleet that silently
# downgrades on reinstall, and versionCodes going backwards is confusing to
# debug from a phone.
if [ -f "$TARGET" ] && [ "$FORCE" = "0" ]; then
  echo "== currently published =="
  aapt2="${AAPT2:-}"
  if [ -z "$aapt2" ]; then
    for root in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk"; do
      [ -n "$root" ] || continue
      for c in "$root"/build-tools/*/aapt2; do [ -x "$c" ] && { aapt2="$c"; break 2; }; done
    done
  fi
  if [ -n "$aapt2" ]; then
    cur_code="$("$aapt2" dump badging "$TARGET" 2>/dev/null | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)"
    cur_name="$("$aapt2" dump badging "$TARGET" 2>/dev/null | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
    new_code="$("$aapt2" dump badging "$APK" 2>/dev/null | sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" | head -1)"
    new_name="$("$aapt2" dump badging "$APK" 2>/dev/null | sed -n "s/.*versionName='\([^']*\)'.*/\1/p" | head -1)"
    note "published: versionCode=$cur_code versionName=$cur_name"
    if [ -n "$cur_code" ] && [ -n "$new_code" ] && [ "$new_code" -lt "$cur_code" ]; then
      fail "this APK is versionCode $new_code but $new_name is already published at $cur_code. Refusing to downgrade; pass --force if that is really intended."
    fi
    if [ "$new_name" = "$cur_name" ] && [ "$new_code" = "$cur_code" ] && [ "$FORCE" = "0" ]; then
      note "same version as the published build; republishing anyway"
    fi
  else
    note "aapt2 not found, skipping the downgrade check"
  fi
fi

# --- 3. publish ---------------------------------------------------------------
echo "== publish =="
if [ "$DRY_RUN" = "1" ]; then
  note "--dry-run: nothing copied"
  exit 0
fi

# Copy to a temp name in the same directory, then rename. The rename is atomic,
# so a request never sees a half-written APK.
tmp="$(mktemp "$APK_DIR/.tracker.apk.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
cp "$APK" "$tmp"
chmod 644 "$tmp"
# Preserve the original name so admins get a recognisable download.
mv -f "$tmp" "$TARGET"
trap - EXIT
ok "published $(basename "$APK") -> apk/tracker.apk ($(du -h "$TARGET" | cut -f1))"

# --- 4. verify what is actually being served ---------------------------------
if [ -n "$URL" ]; then
  echo "== verify =="
  served_code="$(curl -fsS -o /tmp/published.apk -w '%{http_code}' "$URL/tracker.apk" || true)"
  [ "$served_code" = "200" ] || fail "GET $URL/tracker.apk returned '$served_code' — is the stack up and is ./apk mounted?"
  ok "GET /tracker.apk -> 200"
  ctype="$(curl -fsSI "$URL/tracker.apk" 2>/dev/null | tr -d '\r' | sed -n 's/^[Cc]ontent-[Tt]ype: //p' | head -1)"
  case "$ctype" in
    application/vnd.android.package-archive*) ok "content-type: $ctype" ;;
    *) fail "wrong content-type '$ctype' — the phone will not recognise it as an APK" ;;
  esac
  # Byte comparison, not a signature comparison: identical inputs still produce
  # different bytes because of zip timestamps, but a *served* file must match
  # the one on disk exactly.
  a="$(shasum -a 256 "$TARGET" | cut -d' ' -f1)"
  b="$(shasum -a 256 /tmp/published.apk | cut -d' ' -f1)"
  [ "$a" = "$b" ] || fail "the served APK does not match the published file (cache or a stale mount)"
  ok "served bytes match the published file"
  rm -f /tmp/published.apk
else
  note "no --url given, skipped the served-bytes check (the stack may not be running)"
fi

echo
echo "Published. The dashboard's Download APK button now serves this build."
