# Signing and distributing the Android app

The tracker is a self-hosted, self-signed Android app. Nobody installs it from
Google Play, so *you* control the signing key, and that key is what makes an
update possible without destroying a technician's work.

This document covers: what the key actually does, how to use the shared one,
how to run your own, how to publish a build, and how to avoid the one mistake
that wipes a fleet.

---

## The one thing to understand first

Android only installs a new APK over an existing app when **all three** match:

| | Requirement | If it fails |
|---|---|---|
| Package name | `org.opensource.tracker` | Treated as a new app |
| Signing certificate | Byte-identical to the installed one | `INSTALL_FAILED_UPDATE_INCOMPATIBLE` |
| `versionCode` | Strictly **higher** than installed | `INSTALL_FAILED_VERSION_DOWNGRADE` |

When any of these fail, the only way forward is to uninstall first — and
uninstalling deletes the app's private storage, which holds:

- the device token and server address (the pairing)
- the encrypted preference store holding it (`EncryptedSharedPreferences`,
  keyed from Android Keystore)
- `tracking.db`, the Room database of GPS points recorded but not yet uploaded

The pairing code itself is not stored — it is exchanged for a device token at
pairing time — so preserving the token *is* preserving the pairing.

**Losing the pairing is recoverable (re-enter a code) but losing `tracking.db`
is not.** Points that were recorded while offline and never uploaded are gone.

Note also `android:allowBackup="false"`: there is no backup path. An accidental
uninstall cannot be undone.

### The practical consequence

Your signing key is fleet-critical infrastructure. Treat a keystore the way you
treat a database backup credential, and:

- keep **one** key for the lifetime of the product
- never rotate it casually
- back it up somewhere you would still have in five years
- do not commit it to git

---

## Option A — the shared key (default)

The project ships one release key, and the public repository's CI is configured
to use it. Every customer gets the same APK; each one points their phones at
their own server, because the server address is entered by the technician at
pairing time and nothing about it is baked into the app.

**If you use this**, CI builds the signed APK for you:

```bash
git tag v0.3.4
git push --tags
```

The workflow (`.github/workflows/android-release.yml`) builds, verifies the
signature, and attaches the APK to a GitHub Release. Then publish it to your
server with `scripts/publish-apk.sh` (see below).

Two things to know about this option:

1. **The key lives in GitHub Actions secrets on a public repository.** Secrets
   are encrypted and only decrypted inside runs, but anyone with *write* access
   to the repository can edit the workflow to exfiltrate it. Keep the
   collaborator list short and reviewed.
2. **You can replace the app on every phone that ever installed the shared
   build.** So can anyone who obtains the key. That is a real concentration of
   trust, and it is the main reason to prefer your own key.

---

## Option B — your own key

Use this if you are deploying for a customer and do not want to depend on a key
you do not control, or if you want one customer's compromise to be unable to
touch another customer's fleet.

### 1. Generate a keystore

```bash
keytool -genkeypair -v \
  -keystore release.keystore \
  -alias tracker \
  -keyalg RSA -keysize 4096 -validity 10000 \
  -storetype PKCS12
```

Use a strong, unique password and store it in a password manager. Choose
`-validity` generously: 10000 days is about 27 years. You cannot extend an
existing key, and a short one silently breaks updates years from now.

> Back up this file *now*. There is no recovery if it is lost — every phone
> then needs a fresh install and a re-pair.

### 2. Point the build at it

`android/local.properties` is gitignored and never committed. It needs both the
keystore reference and the credentials, because `app/build.gradle.kts` reads
them from there:

```properties
sdk.dir=/path/to/Android/sdk
storeFile=/absolute/path/to/release.keystore
storePassword=...
keyAlias=tracker
keyPassword=...
```

`storeFile` may be absolute. If it is relative it is resolved against
`android/`.

### 3. Read your certificate's fingerprint

This is the value your tooling pins, so that a wrong or rotated key is caught
before it reaches a phone:

```bash
keytool -list -v -keystore release.keystore -alias tracker \
  | awk '/SHA256:/{print $2}' | tr -d ':' | tr 'A-F' 'a-f'
```

### 4. Build and publish

```bash
cd android && ./gradlew assembleRelease
../scripts/publish-apk.sh \
  app/build/outputs/apk/release/app-release.apk \
  --fingerprint <the fingerprint from step 3> \
  --url https://your-server.example.com
```

`--fingerprint` makes the script refuse any APK that is not signed by *your*
key — which is what stops a stray debug or shared-key build from being
published to your fleet by mistake.

---

## Publishing without a repository, or without CI

If you would rather not use GitHub Actions at all, build locally and publish:

```bash
cd android && ./gradlew assembleRelease
scripts/publish-apk.sh \
  android/app/build/outputs/apk/release/app-release.apk \
  --fingerprint <your fingerprint>
```

That is the whole pipeline. The keystore never leaves your machine.

---

## How publishing works

`scripts/publish-apk.sh` copies the APK to `apk/tracker.apk` in the repository.
That directory is bind-mounted read-only into the `frontend` container at
`/srv/apk`, and `frontend/nginx.conf` serves it at `/tracker.apk`.

Because nginx reads it from disk per request, publishing is just replacing the
file. **No image rebuild and no container restart** — admins see the new build
on their next page load.

Before anything is copied, the script refuses to publish an APK that is:

- unsigned, or signed with an unexpected certificate
- older than the build already being served
- missing a higher `versionCode`
- built from a `VERSION` file that disagrees with the APK
- built from a Room schema bump with no `Migration` (that would crash the app
  on every phone at first launch)

If a stack is running, it then re-fetches `/tracker.apk` and compares the bytes,
so a caching proxy cannot quietly keep serving the old build.

### What admins see

The dashboard's **About** page and **Android setup** guide both link to
`/tracker.apk`, and the version they display comes from the server's
`/health/version`, which reads the repository's `VERSION` file — the same file
the Android build uses. The version shown is therefore the version actually
built, not a string someone has to remember to update.

---

## Distributing to phones

1. Sign in to the dashboard and open **About** (or **Android setup**).
2. Download the APK. It is admin-only: **do not** put it on a public file host.
3. On the phone, allow installs from the app used to open the file
   (Settings → Apps → Special app access → Install unknown apps), install, then
   turn that permission back off.
4. If Play Protect objects, it is because the APK has never been scanned. Use
   *More details → Install anyway*, or pause Play Protect for the install.

### Updating an already-paired phone

Download the new build and install it over the old one, the same way. As long
as the key matches and `versionCode` increased, the pairing and any queued GPS
survive.

**Check before you roll out**, if you have the phone on USB:

```bash
adb shell dumpsys package org.opensource.tracker | grep -E "versionCode|versionName"
```

Or, more reliably, let the tooling compare the installed certificate against the
new APK:

```bash
scripts/preflight-update.sh path/to/new.apk --install
```

It will refuse — before touching the device — if the phone is signed with a
different key, or if the new build is not actually newer.

---

## Rotating the key

There is no safe in-place rotation. A new key means every phone must uninstall
first, which erases each pairing and each unsynced upload queue.

If you must rotate:

1. Expect every phone to be re-paired by hand.
2. Warn the customer before you start, not after.
3. Keep the old APK available in the release notes so anyone mid-install can get
   a matching build.

Do not rotate because someone asked for a "fresh" key. Rotate because the old
one was exposed — and if it was exposed, assume the fleet is untrusted until
every phone has been reinstalled.

---

## Troubleshooting

**"App not installed" / `INSTALL_FAILED_UPDATE_INCOMPATIBLE`**
The phone's build is signed with a different key. See
`adb shell dumpsys package org.opensource.tracker`. Do not uninstall unless you
accept losing the pairing and the unsynced queue.

**`INSTALL_FAILED_VERSION_DOWNGRADE`**
`versionCode` did not increase. Edit `android/app/build.gradle.kts`, bump it,
and rebuild.

**The build succeeds but the APK is unsigned**
`android/local.properties` is missing the signing keys, so AGP falls back to
producing an unsigned artifact without failing. The `types` check in
`scripts/check-version.sh` and the first step of `scripts/preflight-update.sh`
both catch this.

**"The server must use HTTPS"**
The app refuses a plain `http://` server address, with one deliberate exception:
`http://10.0.2.2` is allowed in debug builds only, for the emulator talking to
a laptop. See `TrackerApi.kt`.

**Play Protect blocks every install**
Expected for a self-signed sideloaded app — it is a provenance check, not a
signature check, and a long-lived key does not avoid it. Options are in
*Distributing to phones* above.

**The dashboard still shows the old version**
The dashboard reads `/health/version`. The container needs the `VERSION` file
mounted (`./VERSION:/app/VERSION:ro` in `docker-compose.yml`); if the stack was
started before that mount existed, recreate it with
`docker compose up -d --force-recreate backend`.
