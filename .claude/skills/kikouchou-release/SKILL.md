---
name: kikouchou-release
description: Release a new version of the Kikouchou store apps (Google Play, App Store, GitHub release, self-hosted F-Droid). Use when the user asks to tag, cut, publish or ship a release such as "tag v0.1.11" in this repository.
---

# Kikouchou release

This skill tags a release of the Kikouchou store apps. The tag starts
`.github/workflows/native.yml`, which builds both Android flavors and the
iOS app, uploads the AAB to the Play internal track, creates the GitHub
release, and uploads the IPA to TestFlight when the Apple secrets exist.
The full runbook is `docs/releasing-the-store-apps.md`. This skill is the
short routine for every release after the first.

## Rules

- Tag only when the user asks for this release in this turn, with its
  version. A fix merged to main is not a request to tag.
- Do not touch the fdroiddata merge request
  (`gitlab.com/fdroid/fdroiddata/-/merge_requests/55775`) unless the user
  asks. After the merge, f-droid.org follows new tags on its own.
- Never move, delete or re-push an existing tag.
- Do not use the em dash or the en dash in the changelogs.
- Commit and push with the usual flow: a worktree branch, a rebase on
  `origin/main`, a fast-forward of main, a push.

## 1. Decide what the release contains

1. Fetch and list the commits since the last tag:

   ```bash
   git fetch -q origin --tags
   last=$(git tag -l 'v*' --sort=-v:refname | head -1)
   git log --oneline "$last"..origin/main
   ```

2. Make sure that the main checkout has no uncommitted change from another
   session: `git status --short | grep -v '^??'` must print nothing.
3. Read the commits. The changelog describes what a user of the app sees.
   A commit that touches only the server, CI or docs adds nothing to it.
4. A change under `android/`, `ios/`, `capacitor.config.ts`, or a
   `@capacitor/*` or `@capawesome/*` version changes the native
   fingerprint (`scripts/native-fingerprint.js`). Installed apps then get
   no live update until they install this release. Say so to the user.

## 2. Bump the version

The version code is `major * 1000000 + minor * 1000 + patch`. For 0.1.11 it
is 1011. `android/app/build.gradle` stops the build when `package.json`
disagrees with that formula.

In a worktree from `origin/main`, change these files:

1. `package.json`: `"version"` and `"versionCode"`.
2. `metadata/app.kikouchou.yml`: `versionName`, `versionCode` and
   `commit: v<version>` in the build entry, and `CurrentVersion` and
   `CurrentVersionCode` at the end.
3. `fastlane/metadata/android/en-US/changelogs/<versionCode>.txt` and
   `fastlane/metadata/android/fr-FR/changelogs/<versionCode>.txt`. One
   line per change, 500 characters at most per file. Google Play, F-Droid
   and the GitHub release (`scripts/release-notes.sh`) all show them.

Check the code before you commit:

```bash
node -e "const p=require('./package.json');const[a,b,c]=p.version.split('.').map(Number);console.log(p.version,p.versionCode,a*1e6+b*1e3+c)"
```

The two numbers must be equal.

## 3. Commit, merge and tag

```bash
git add -A
git commit -m "chore(release): <version>

<one line on what the release ships>. versionCode <code>."
git fetch -q origin && git rebase -q origin/main
```

Then, in the main checkout:

```bash
git merge --ff-only -q origin/main
git merge --ff-only -q release/v<version>
git push -q origin main
git tag -a v<version> -m "v<version>" HEAD
git push -q origin v<version>
git show v<version>:package.json | grep -E '"version(Code)?"'
```

`native.yml` stops at once if the tag and `package.json` disagree.

## 4. Watch the release run

Wait for the run in one blocking command, not in a polling loop:

```bash
id=$(gh run list --workflow native.yml --branch v<version> --limit 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$id" --exit-status
gh run view "$id" --json jobs --jq '.jobs[]|"\(.name): \(.conclusion)"'
gh release view v<version> --json name,assets --jq '.name, (.assets[]|"\(.name) \(.size)")'
```

- If a job fails with an HTTP 5xx while it downloads Gradle or a
  dependency, rerun it once: `gh run rerun "$id" --failed`.
- Any other failure: read `gh run view "$id" --log-failed` and report it.
  Do not retag.

A good run has five green jobs: Web bundle, Android, iOS, Google Play and
GitHub release. The release carries `kikouchou-<version>.apk`,
`kikouchou-<version>-fdroid.apk` and `kikouchou-<version>.aab`. With R8 on,
the Play APK is about 3.4 MB. A size near 6.7 MB means R8 did not run.

## 5. Report

Tell the user:

- the tag and its commit;
- the job results and the release files with their sizes;
- that Play rolls the release out to internal testing by itself
  (`PLAY_RELEASE_STATUS=completed`), and that closed testing and
  production need "Promote release" in the Play Console;
- that the self-hosted F-Droid repository at
  `app.kikouchou.app/fdroid/repo` updates with the next green website
  deploy;
- what you did not check, such as a run on a real phone.
