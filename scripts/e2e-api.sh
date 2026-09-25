#!/usr/bin/env bash
# End-to-end API verification. Requires a running stack (`docker compose up -d`)
# plus a seeded administrator, or any reachable API with API_URL/credentials set.
set -euo pipefail

API_URL="${API_URL:-http://localhost:5789}"
ADMIN_EMAIL="${SEED_ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${SEED_ADMIN_PASSWORD:-change-this-password}"

json_value() { python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
json_len() { python3 -c "import json,sys; print(len(json.load(sys.stdin)))"; }
# Usage: json_path "d['totals']['totalTrips']"
json_path() { python3 -c "import json,sys; d=json.load(sys.stdin); print($1)"; }
fail() { echo "FAIL: $1" >&2; exit 1; }

echo "== health =="
health=$(curl -fsS "$API_URL/health")
test "$(printf '%s' "$health" | json_value status)" = ok || fail "health status"
test "$(printf '%s' "$health" | json_path "d['database']")" = ok || fail "database health"
curl -fsS "$API_URL/health/version" >/dev/null
test "$(curl -fsS "$API_URL/api/setup/status" | json_value initialized)" = True || fail "system should be initialized after seeding"

echo "== auth =="
login=$(curl -fsS -X POST "$API_URL/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\"}")
admin_token=$(printf '%s' "$login" | json_value accessToken)
refresh_token=$(printf '%s' "$login" | json_value refreshToken)
refreshed=$(curl -fsS -X POST "$API_URL/api/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$refresh_token\"}")
admin_token=$(printf '%s' "$refreshed" | json_value accessToken)
me=$(curl -fsS "$API_URL/api/auth/me" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$me" | json_value role)" = SUPERADMIN || fail "superadmin role"
anon_status=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/auth/me")
test "$anon_status" = 401 || fail "unauthenticated /me should be 401"

echo "== technicians + devices =="
suffix=$(date +%s)
tech=$(curl -fsS -X POST "$API_URL/api/technicians" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"name\":\"E2E Technician\",\"employeeNumber\":\"E2E-$suffix\"}")
tech_id=$(printf '%s' "$tech" | json_value id)
pair=$(curl -fsS -X POST "$API_URL/api/devices/pairing-code" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"technicianId\":\"$tech_id\",\"deviceName\":\"E2E-DEVICE-$suffix\"}")
device_id=$(printf '%s' "$pair" | json_value deviceId)
code=$(printf '%s' "$pair" | json_value pairingCode)
device_uuid=$(printf '%s' "$pair" | json_value deviceUuid)
device=$(curl -fsS -X POST "$API_URL/api/devices/pair" -H 'Content-Type: application/json' -d "{\"code\":\"$code\",\"deviceUuid\":\"$device_uuid\",\"manufacturer\":\"E2E\",\"model\":\"Test\",\"androidVersion\":\"15\",\"appVersion\":\"0.2.0\"}")
device_token=$(printf '%s' "$device" | json_value deviceToken)
reuse_status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API_URL/api/devices/pair" -H 'Content-Type: application/json' -d "{\"code\":\"$code\",\"deviceUuid\":\"$device_uuid\"}")
test "$reuse_status" = 400 || fail "pairing codes must be single-use"
device_read_status=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/technicians" -H "Authorization: Bearer $device_token")
test "$device_read_status" = 403 || fail "device tokens must not read technician lists"
device_config=$(curl -fsS "$API_URL/api/device/config" -H "Authorization: Bearer $device_token")
test "$(printf '%s' "$device_config" | json_value deviceId)" = "$device_id" || fail "device config identity"
test "$(printf '%s' "$device_config" | json_path "d['tracking']['stopTimeoutSeconds']")" -gt 0 || fail "device config tracking settings"

echo "== GPS ingestion =="
point_id=$(python3 -c 'import uuid; print(uuid.uuid4())')
point2_id=$(python3 -c 'import uuid; print(uuid.uuid4())')
t1=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=3)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
t2=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
point="{\"id\":\"$point_id\",\"recordedAt\":\"$t1\",\"latitude\":10.3157,\"longitude\":123.8854,\"speed\":11.6,\"accuracy\":4,\"battery\":78,\"networkState\":\"wifi\"}"
point2="{\"id\":\"$point2_id\",\"recordedAt\":\"$t2\",\"latitude\":10.3200,\"longitude\":123.8900,\"speed\":13.2,\"accuracy\":5,\"battery\":77,\"networkState\":\"wifi\"}"
first=$(curl -fsS -X POST "$API_URL/api/locations/batch" -H "Authorization: Bearer $device_token" -H 'Content-Type: application/json' -d "{\"points\":[$point,$point2]}")
duplicate=$(curl -fsS -X POST "$API_URL/api/locations/batch" -H "Authorization: Bearer $device_token" -H 'Content-Type: application/json' -d "{\"points\":[$point,$point2]}")
test "$(printf '%s' "$first" | json_value accepted)" = 2 || fail "batch accept"
test "$(printf '%s' "$duplicate" | json_value duplicates)" = 2 || fail "idempotent uploads"

echo "== dwell stops =="
# A standstill of at least five minutes must surface as a stop with its duration,
# and a phone credential must never be able to read them.
probe_tech=$(curl -fsS -X POST "$API_URL/api/technicians" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"name\":\"E2E Dwell\",\"employeeNumber\":\"E2E-DWELL-$suffix\"}")
probe_tech_id=$(printf '%s' "$probe_tech" | json_value id)
probe_pair=$(curl -fsS -X POST "$API_URL/api/devices/pairing-code" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"technicianId\":\"$probe_tech_id\",\"deviceName\":\"E2E-DWELL-DEV-$suffix\"}")
probe_code=$(printf '%s' "$probe_pair" | json_value pairingCode)
probe_uuid=$(printf '%s' "$probe_pair" | json_value deviceUuid)
probe_dev=$(curl -fsS -X POST "$API_URL/api/devices/pair" -H 'Content-Type: application/json' -d "{\"code\":\"$probe_code\",\"deviceUuid\":\"$probe_uuid\",\"manufacturer\":\"E2E\",\"model\":\"Dwell\",\"androidVersion\":\"15\",\"appVersion\":\"0.2.0\"}")
probe_token=$(printf '%s' "$probe_dev" | json_value deviceToken)
ds1=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=9)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
ds2=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=4)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
dst_point="{\"id\":\"$(python3 -c 'import uuid; print(uuid.uuid4())')\",\"recordedAt\":\"$ds1\",\"latitude\":10.3400,\"longitude\":123.9100,\"speed\":0,\"accuracy\":5,\"battery\":65}"
dst_point2="{\"id\":\"$(python3 -c 'import uuid; print(uuid.uuid4())')\",\"recordedAt\":\"$ds2\",\"latitude\":10.3400,\"longitude\":123.9100,\"speed\":0,\"accuracy\":5,\"battery\":64}"
curl -fsS -X POST "$API_URL/api/locations/batch" -H "Authorization: Bearer $probe_token" -H 'Content-Type: application/json' -d "{\"points\":[$dst_point,$dst_point2]}" >/dev/null
stop_from=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(days=1)).strftime("%Y-%m-%d"))')
stop_to=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(days=1)).strftime("%Y-%m-%d"))')
stops=$(curl -fsS "$API_URL/api/technicians/$probe_tech_id/stops?from=$stop_from&to=$stop_to" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$stops" | json_len)" -ge 1 || fail "a five-minute standstill must be recorded as a stop"
test "$(printf '%s' "$stops" | json_path "d[0]['durationSeconds']")" -ge 300 || fail "dwell stop must carry its duration"
probe_stops_status=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/technicians/$probe_tech_id/stops" -H "Authorization: Bearer $probe_token")
test "$probe_stops_status" = 403 || fail "device tokens must not read stop lists (got $probe_stops_status)"

echo "== live dashboard =="
live=$(curl -fsS "$API_URL/api/dashboard/live" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$live" | grep -c "$tech_id")" -ge 1 || fail "live dashboard technician"
summary=$(curl -fsS "$API_URL/api/dashboard/summary" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$summary" | json_path "d['online']")" -ge 1 || fail "summary online count"
route=$(curl -fsS "$API_URL/api/technicians/$tech_id/locations" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$route" | json_len)" = 2 || fail "technician route history"

echo "== trips + replay =="
trips=$(curl -fsS "$API_URL/api/trips?technicianId=$tech_id" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$trips" | json_len)" -ge 1 || fail "automatic trip detection"
trip_id=$(curl -fsS -X POST "$API_URL/api/trips/process" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"technicianId\":\"$tech_id\",\"from\":\"$t1\",\"to\":\"$t2\"}" | json_value id)
test "$(curl -fsS "$API_URL/api/trips/$trip_id/route" -H "Authorization: Bearer $admin_token" | json_len)" = 2 || fail "trip route"
replay=$(curl -fsS "$API_URL/api/trips/$trip_id/replay" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$replay" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["frames"]))')" = 2 || fail "replay frames"

echo "== reports + settings + audit =="
report=$(curl -fsS "$API_URL/api/reports/daily" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$report" | json_path "d['totals']['totalTrips']")" -ge 1 || fail "daily report"
curl -fsS "$API_URL/api/settings" -H "Authorization: Bearer $admin_token" >/dev/null
curl -fsS "$API_URL/api/settings/tracking" -H "Authorization: Bearer $admin_token" >/dev/null
curl -fsS "$API_URL/api/settings/retention" -H "Authorization: Bearer $admin_token" >/dev/null
audit_status=$(curl -s -o /dev/null -w '%{http_code}' "$API_URL/api/audit-logs" -H "Authorization: Bearer $admin_token")
test "$audit_status" = 200 || fail "audit logs"
curl -fsS "$API_URL/api/alerts" -H "Authorization: Bearer $admin_token" >/dev/null
curl -fsS "$API_URL/api/openapi.json" >/dev/null

echo "== device replacement keeps history =="
old_device=$(curl -fsS -X POST "$API_URL/api/devices/pairing-code" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"technicianId\":\"$tech_id\",\"deviceName\":\"E2E-REPLACEMENT-$suffix\"}")
replacement_id=$(printf '%s' "$old_device" | json_value deviceId)
curl -fsS -X POST "$API_URL/api/devices/$device_id/unpair" -H "Authorization: Bearer $admin_token" >/dev/null
test "$(curl -fsS "$API_URL/api/technicians/$tech_id/locations" -H "Authorization: Bearer $admin_token" | json_len)" = 2 || fail "history must survive device replacement"
test "$(curl -fsS "$API_URL/api/devices/$replacement_id" -H "Authorization: Bearer $admin_token" | json_value status)" = PENDING || fail "replacement device pending"

echo "== removal: technicians and devices =="
# Removing a record that has GPS history must be refused until the caller opts in,
# so history can never be destroyed by a single click.
http_status() { curl -s -o /dev/null -w '%{http_code}' "$@"; }

rm_tech=$(curl -fsS -X POST "$API_URL/api/technicians" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"name\":\"E2E Removable\",\"employeeNumber\":\"E2E-RM-$suffix\"}")
rm_tech_id=$(printf '%s' "$rm_tech" | json_value id)
rm_pair=$(curl -fsS -X POST "$API_URL/api/devices/pairing-code" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"technicianId\":\"$rm_tech_id\",\"deviceName\":\"E2E-RM-DEV-$suffix\"}")
rm_device_id=$(printf '%s' "$rm_pair" | json_value deviceId)
rm_code=$(printf '%s' "$rm_pair" | json_value pairingCode)
rm_uuid=$(printf '%s' "$rm_pair" | json_value deviceUuid)
rm_device=$(curl -fsS -X POST "$API_URL/api/devices/pair" -H 'Content-Type: application/json' -d "{\"code\":\"$rm_code\",\"deviceUuid\":\"$rm_uuid\"}")
rm_token=$(printf '%s' "$rm_device" | json_value deviceToken)
rt1=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=3)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
rt2=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
rm_point="{\"id\":\"$(python3 -c 'import uuid; print(uuid.uuid4())')\",\"recordedAt\":\"$rt1\",\"latitude\":10.3157,\"longitude\":123.8854,\"speed\":12.0,\"accuracy\":5,\"battery\":70}"
rm_point2="{\"id\":\"$(python3 -c 'import uuid; print(uuid.uuid4())')\",\"recordedAt\":\"$rt2\",\"latitude\":10.3220,\"longitude\":123.8930,\"speed\":14.0,\"accuracy\":5,\"battery\":69}"
curl -fsS -X POST "$API_URL/api/locations/batch" -H "Authorization: Bearer $rm_token" -H 'Content-Type: application/json' -d "{\"points\":[$rm_point,$rm_point2]}" >/dev/null

# Device with history: refused, then erased explicitly.
status=$(http_status -X DELETE "$API_URL/api/devices/$rm_device_id" -H "Authorization: Bearer $admin_token")
test "$status" = 409 || fail "device with history must not delete silently (got $status)"
purged=$(curl -fsS -X DELETE "$API_URL/api/devices/$rm_device_id?purge=true" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$purged" | json_path "d['deleted']")" = True || fail "device purge"
test "$(printf '%s' "$purged" | json_path "d['erasedLocations']")" -ge 2 || fail "device purge should erase its points"
status=$(http_status "$API_URL/api/devices/$rm_device_id" -H "Authorization: Bearer $admin_token")
test "$status" = 404 || fail "deleted device must be gone (got $status)"

# Technician left with detected trips: refused, then erased explicitly.
status=$(http_status -X DELETE "$API_URL/api/technicians/$rm_tech_id" -H "Authorization: Bearer $admin_token")
test "$status" = 409 || fail "technician with history must not delete silently (got $status)"
tech_purged=$(curl -fsS -X DELETE "$API_URL/api/technicians/$rm_tech_id?purge=true" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$tech_purged" | json_path "d['deleted']")" = True || fail "technician purge"
status=$(http_status "$API_URL/api/technicians/$rm_tech_id" -H "Authorization: Bearer $admin_token")
test "$status" = 404 || fail "deleted technician must be gone (got $status)"

# Records with no history remove in one step.
empty_tech=$(curl -fsS -X POST "$API_URL/api/technicians" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"name\":\"E2E Empty\",\"employeeNumber\":\"E2E-EMPTY-$suffix\"}")
status=$(http_status -X DELETE "$API_URL/api/technicians/$(printf '%s' "$empty_tech" | json_value id)" -H "Authorization: Bearer $admin_token")
test "$status" = 200 || fail "technician without history should delete directly (got $status)"

empty_pair=$(curl -fsS -X POST "$API_URL/api/devices/pairing-code" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"technicianId\":\"$tech_id\",\"deviceName\":\"E2E-EMPTY-DEV-$suffix\"}")
status=$(http_status -X DELETE "$API_URL/api/devices/$(printf '%s' "$empty_pair" | json_value deviceId)" -H "Authorization: Bearer $admin_token")
test "$status" = 200 || fail "device without history should delete directly (got $status)"

# A device token must never be able to delete records.
device_delete_status=$(http_status -X DELETE "$API_URL/api/devices/$device_id" -H "Authorization: Bearer $device_token")
test "$device_delete_status" = 403 || fail "device tokens must not delete devices (got $device_delete_status)"

echo "== removal: organizations =="
# An organization with nothing in it removes in one step.
spare_org_id=$(curl -fsS -X POST "$API_URL/api/organizations" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"name\":\"E2E Spare $suffix\",\"slug\":\"e2e-spare-$suffix\"}" | json_value id)
status=$(http_status -X DELETE "$API_URL/api/organizations/$spare_org_id" -H "Authorization: Bearer $admin_token")
test "$status" = 200 || fail "empty organization should remove in one step (got $status)"

# An organization holding technicians, devices, and GPS points must be refused until the
# operator opts in, then erase everything it owns.
org_id=$(curl -fsS -X POST "$API_URL/api/organizations" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"name\":\"E2E Org $suffix\",\"slug\":\"e2e-org-$suffix\"}" | json_value id)
org_tech_id=$(curl -fsS -X POST "$API_URL/api/technicians" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"name\":\"E2E Org Technician\",\"employeeNumber\":\"E2E-ORG-$suffix\",\"organizationId\":\"$org_id\"}" | json_value id)
org_pair=$(curl -fsS -X POST "$API_URL/api/devices/pairing-code" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"technicianId\":\"$org_tech_id\",\"deviceName\":\"E2E-ORG-DEV-$suffix\"}")
org_device=$(curl -fsS -X POST "$API_URL/api/devices/pair" -H 'Content-Type: application/json' -d "{\"code\":\"$(printf '%s' "$org_pair" | json_value pairingCode)\",\"deviceUuid\":\"$(printf '%s' "$org_pair" | json_value deviceUuid)\"}")
org_token=$(printf '%s' "$org_device" | json_value deviceToken)
ot1=$(python3 -c 'import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(minutes=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"))')
org_point="{\"id\":\"$(python3 -c 'import uuid; print(uuid.uuid4())')\",\"recordedAt\":\"$ot1\",\"latitude\":10.3300,\"longitude\":123.9000,\"speed\":9.0,\"accuracy\":6,\"battery\":64}"
curl -fsS -X POST "$API_URL/api/locations/batch" -H "Authorization: Bearer $org_token" -H 'Content-Type: application/json' -d "{\"points\":[$org_point]}" >/dev/null

status=$(http_status -X DELETE "$API_URL/api/organizations/$org_id" -H "Authorization: Bearer $admin_token")
test "$status" = 409 || fail "organization holding data must not delete silently (got $status)"
org_removed=$(curl -fsS -X DELETE "$API_URL/api/organizations/$org_id?purge=true" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$org_removed" | json_path "d['deleted']")" = True || fail "organization purge"
test "$(printf '%s' "$org_removed" | json_path "d['erasedTechnicians']")" -ge 1 || fail "organization purge should erase its technicians"
test "$(printf '%s' "$org_removed" | json_path "d['erasedLocations']")" -ge 1 || fail "organization purge should erase its GPS history"
status=$(http_status "$API_URL/api/technicians/$org_tech_id" -H "Authorization: Bearer $admin_token")
test "$status" = 404 || fail "technicians inside a removed organization must be gone (got $status)"
test "$(curl -fsS "$API_URL/api/organizations" -H "Authorization: Bearer $admin_token" | python3 -c "import json,sys; print(any(o['slug'] == 'e2e-org-$suffix' for o in json.load(sys.stdin)))")" = False || fail "removed organization must be gone from the list"

# The organization the signed-in superadmin belongs to can never be removed, and the
# deletion is recorded without leaving a dangling organization reference.
me_org=$(printf '%s' "$me" | json_value organizationId)
status=$(http_status -X DELETE "$API_URL/api/organizations/$me_org" -H "Authorization: Bearer $admin_token")
test "$status" = 403 || fail "the signed-in superadmin's own organization must never be removable (got $status)"
test "$(curl -fsS "$API_URL/api/audit-logs?limit=50" -H "Authorization: Bearer $admin_token" | python3 -c "import json,sys; print(any(e['action'] == 'organization.delete-purged' for e in json.load(sys.stdin)))")" = True || fail "organization removal must be audited"

echo "== removal: user accounts =="
u_email="e2e-user-$suffix@example.com"
u_id=$(curl -fsS -X POST "$API_URL/api/users" -H "Authorization: Bearer $admin_token" -H 'Content-Type: application/json' -d "{\"name\":\"E2E Dispatcher\",\"email\":\"$u_email\",\"password\":\"e2e-temporary-password\",\"role\":\"DISPATCHER\"}" | json_value id)
u_refresh=$(curl -fsS -X POST "$API_URL/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$u_email\",\"password\":\"e2e-temporary-password\"}" | json_value refreshToken)

# Your own account can never be removed.
me_id=$(printf '%s' "$me" | json_value id)
status=$(http_status -X DELETE "$API_URL/api/users/$me_id" -H "Authorization: Bearer $admin_token")
test "$status" = 403 || fail "you must not be able to remove your own account (got $status)"

removed_user=$(curl -fsS -X DELETE "$API_URL/api/users/$u_id" -H "Authorization: Bearer $admin_token")
test "$(printf '%s' "$removed_user" | json_path "d['deleted']")" = True || fail "user account removal"
test "$(curl -fsS "$API_URL/api/users" -H "Authorization: Bearer $admin_token" | python3 -c "import json,sys; print(any(u['id'] == '$u_id' for u in json.load(sys.stdin)))")" = False || fail "removed account must be gone from the list"
# The removed account can no longer sign in and its refresh token is dead.
status=$(http_status -X POST "$API_URL/api/auth/login" -H 'Content-Type: application/json' -d "{\"email\":\"$u_email\",\"password\":\"e2e-temporary-password\"}")
test "$status" = 401 || fail "a removed account must not be able to sign in (got $status)"
status=$(http_status -X POST "$API_URL/api/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$u_refresh\"}")
test "$status" = 401 || fail "a removed account's sessions must be revoked (got $status)"

echo "E2E passed: health, setup state, auth + refresh, technician setup, single-use pairing, device-token isolation, GPS upload, idempotency, live dashboard, auto trip detection, route, replay, reports, settings, audit, alerts, history-preserving device replacement, and guarded technician/device/organization/user-account removal."
