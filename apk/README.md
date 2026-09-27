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

`tracker.apk` itself is intentionally not committed — it is a build artifact,
and a binary in git history is permanent. A fresh clone has no APK here and
`/tracker.apk` returns 404 until one is published, which is the correct
behaviour for a deployment that has not been given a release yet.

Admin-only distribution: never upload this to a public file host.
