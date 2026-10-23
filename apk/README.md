# Signed release APK

The signed APK served at `/tracker.apk` lives here, and this directory is bind
mounted read-only into the `frontend` container at `/srv/apk`. nginx serves the
file straight from disk, so publishing a new build is just replacing the file
here — no image rebuild and no container restart.

Publish a build with:

    scripts/publish-apk.sh android/app/build/outputs/apk/release/app-release.apk

That script refuses to publish anything that is unsigned, signed with an
unexpected key, or older than the APK currently being served, because
distributing a bad APK strands the whole fleet: Android will reject it, the
only fix is reinstalling, and reinstalling erases each phone's pairing and any
GPS it had queued but not yet uploaded.

## `tracker.apk.json`

The same script writes a two-field sidecar next to the APK:

    {"versionName":"0.3.6","versionCode":9}

It is read from the APK's own `aapt2` badging, never hand-edited, and it is
ignored by git along with the APK. The backend (also mounted this directory at
`/app/apk`) reads it to answer `GET /api/device/update`, which is what makes the
phone's **Software update** button appear. The advertised `versionCode` is the
only thing that decides "newer": the repository's `VERSION` file can be ahead of
the published APK, and Android refuses an install whose `versionCode` is not
higher than the installed one.

The backend does **not** trust a hash from this file. It computes the SHA-256 of
`tracker.apk` itself, so the hash it hands a phone always describes the bytes
nginx is serving.

Consequences worth knowing:

- An APK copied here by hand (without the sidecar) is served normally but is
  never offered as an in-app update.
- Deleting the sidecar makes every phone report "latest version", even if the
  APK is newer. Publish again with the script rather than editing it.

`tracker.apk` itself is intentionally not committed — it is a build artifact,
and a binary in git history is permanent. A fresh clone has no APK here and
`/tracker.apk` returns 404 until one is published, which is the correct
behaviour for a deployment that has not been given a release yet.

Admin-only distribution: never upload this to a public file host.
