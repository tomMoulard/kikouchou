# Releasing the store apps

This runbook takes Kikouchou from a merged `main` to the App Store, Google Play
and F-Droid. Part 1 is done once. Part 2 is the first release. Part 3 is every
release after it.

Read `plans/2026-09-26-native-apps-v1.md` for the reasons behind each step.
This file only says what to do.

## Before you start

* You merged `feat/native-apps` in this repository and
  `feat/store-apps-pages` in `kikouchou-LP`.
* You have the GitHub CLI (`gh`) signed in to `tomMoulard/kikouchou`.
* You have a JDK 21 for `keytool`, and `openssl`.
* You have SSH access to the server that runs `docker-compose.yml`.

Keep every key and password you create in a password manager. The Android
upload key and the F-Droid repository key cannot be recovered. If you lose one,
you can no longer update the app or the repository with it.

## Part 1: one-time setup

### 1.1 Create the accounts

1. Join the Apple Developer Program at <https://developer.apple.com/programs/>.
   Write down the Team ID from Membership details. It is 10 characters, for
   example `ABCDE12345`.
2. Create a Google Play developer account at <https://play.google.com/console>.
   Complete the identity check. A personal account must run a closed test
   (step 2.5) before its first production release.
3. Create a Firebase project at <https://console.firebase.google.com>. Name it
   `kikouchou`. Turn Google Analytics off: the app does not use it.
4. If you have no GitLab account, create one. F-Droid takes submissions there.

### 1.2 Apply the database changes

Run these commands from the repository root, on `main`.

1. Apply the migration:

   ```bash
   bunx supabase db push
   ```

2. Make sure that the function exists. The result must be `delete_my_account`:

   ```bash
   bunx supabase db query --linked "select proname from pg_proc where proname = 'delete_my_account'"
   ```

3. Push the new sign-in return address, `app.kikouchou://auth/callback`.
   Export the four provider variables first. Without them the wrapper refuses
   to run (`AGENTS.md`, the Supabase section):

   ```bash
   bun run db:config-push
   ```

4. Make sure that Google sign-in still works on the website, with the check
   `AGENTS.md` gives:

   ```bash
   curl -sS -o /dev/null -w '%{redirect_url}\n' "$VITE_SUPABASE_URL/auth/v1/authorize?provider=google"
   ```

   The printed URL must carry the real Google client id.

### 1.3 Turn on Sign in with Apple

App Store guideline 4.8 requires it, because the app offers Google sign-in.

1. In the Apple Developer portal, open Certificates, Identifiers & Profiles.
2. Create an identifier of type Services IDs, for example
   `app.kikouchou.signin`. Turn on Sign in with Apple.
3. Configure it. Domain: your Supabase project host, `<ref>.supabase.co`.
   Return URL: `https://<ref>.supabase.co/auth/v1/callback`.
4. Create a key under Keys with Sign in with Apple turned on. Download the
   `.p8` file and write down its Key ID.
5. In the Supabase dashboard, open Authentication, then Providers, then Apple.
   Enter the Services ID, the Team ID, the Key ID and the key. Save.
6. On the website, sign in with Apple once, to prove that it works.

Do not put these values in the Supabase TOML file or in a script. The
dashboard holds the only copy (see `AGENTS.md`).

### 1.4 Register the iOS app

1. In Certificates, Identifiers & Profiles, create an App ID. Bundle ID:
   `app.kikouchou`, explicit.
2. Turn on these capabilities: Push Notifications and Associated Domains.
3. In App Store Connect, open Apps and create a new app:
   * platform: iOS
   * name: Kikouchou
   * primary language: French or English
   * bundle ID: `app.kikouchou`
   * SKU: `kikouchou`
4. Open App Information and copy the Apple ID number, for example
   `6712345678`. This is the `IOS_APP_STORE_ID`.

### 1.5 Create the Apple keys

You need two keys. Both are downloaded once.

1. The APNs key, for trip reminders:
   1. Open Keys and create a key with Apple Push Notifications service turned on.
   2. Download the `.p8` file.
   3. Write down its Key ID.
2. The App Store Connect API key, for CI uploads:
   1. In App Store Connect, open Users and Access, then Integrations, then App
      Store Connect API.
   2. Create a Team Key with the App Manager role.
   3. Download the `.p8` file.
   4. Write down the Key ID and the Issuer ID.

### 1.6 Create the Android upload key

1. Create the key:

   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore kikouchou-upload.keystore \
     -alias upload -keyalg RSA -keysize 4096 -validity 10000 \
     -dname "CN=Kikouchou, O=Kikouchou"
   ```

2. Print its SHA-256 fingerprint and keep it for step 1.10:

   ```bash
   keytool -list -v -keystore kikouchou-upload.keystore -alias upload | grep SHA256
   ```

The upload key signs the AAB for Play and the APKs on the GitHub release.
Google re-signs the Play download with its own key (step 2.3).

### 1.7 Connect Firebase for Android push

1. In the Firebase console, add an Android app with the package name
   `app.kikouchou`.
2. Download `google-services.json`. Do not commit it: CI writes it from a
   secret.
3. Open Project settings, then Service accounts. Generate a new private key.
   This JSON file is the server's `FCM_SERVICE_ACCOUNT_JSON`.

iOS push does not use Firebase. The server sends to APNs with the key from
step 1.5.

### 1.8 Create the Play upload account

1. In the Google Cloud console of the Firebase project, open IAM & Admin, then
   Service Accounts. Create a service account named `play-upload`.
2. Create a JSON key for it and download it.
3. In the Play Console, open Users and permissions. Invite the service
   account's email address. Give it Release to testing tracks and Release to
   production for the Kikouchou app.

### 1.9 Create the F-Droid repository key

1. Create the key. The alias must be `kikouchou`, because
   `scripts/build-fdroid-repo.sh` expects it:

   ```bash
   keytool -genkeypair -v -storetype PKCS12 -keystore kikouchou-fdroid.p12 \
     -alias kikouchou -keyalg RSA -keysize 4096 -validity 10000 \
     -dname "CN=Kikouchou, O=Kikouchou"
   ```

2. Use the same password for the store and the key. The script passes one
   password for both.

### 1.10 Store the secrets and variables in GitHub

Run these commands from the repository root. `gh secret set` reads the value
from standard input.

1. The Android signing secrets:

   ```bash
   base64 -i kikouchou-upload.keystore | gh secret set ANDROID_KEYSTORE_BASE64
   gh secret set ANDROID_KEYSTORE_PASSWORD
   gh secret set ANDROID_KEY_ALIAS --body upload
   gh secret set ANDROID_KEY_PASSWORD
   ```

2. Firebase and Play:

   ```bash
   gh secret set GOOGLE_SERVICES_JSON < google-services.json
   gh secret set PLAY_SERVICE_ACCOUNT_JSON < play-upload.json
   ```

3. App Store Connect:

   ```bash
   gh secret set ASC_KEY_ID --body <the API key's Key ID>
   gh secret set ASC_ISSUER_ID --body <the Issuer ID>
   gh secret set ASC_KEY_P8 < AuthKey_<Key ID>.p8
   ```

4. F-Droid:

   ```bash
   base64 -i kikouchou-fdroid.p12 | gh secret set FDROID_KEYSTORE_BASE64
   gh secret set FDROID_KEYSTORE_PASSWORD
   ```

5. The public variables:

   ```bash
   gh variable set APPLE_TEAM_ID --body ABCDE12345
   gh variable set IOS_APP_STORE_ID --body 6712345678
   gh variable set PLAY_RELEASE_STATUS --body draft
   gh variable set ANDROID_CERT_SHA256 --body "<upload key SHA-256>"
   ```

`ANDROID_CERT_SHA256` gets more fingerprints later: the Play App Signing key
in step 2.3, and the F-Droid key in step 2.7. Separate them with commas.

### 1.11 Configure the share server

1. On the server, add these lines to the `.env` file next to
   `docker-compose.yml`. Write the `.p8` key on one line, with `\n` for each
   line break.

   ```bash
   APPLE_TEAM_ID=ABCDE12345
   APNS_KEY_ID=<the APNs key's Key ID>
   APNS_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIGT...\n-----END PRIVATE KEY-----
   FCM_SERVICE_ACCOUNT_JSON=<the service account JSON from step 1.7, on one line>
   ANDROID_CERT_SHA256=<the same list as the GitHub variable>
   ```

2. Rebuild and restart the service. The image name changed to
   `tommoulard/kikouchou-share`, so the build is necessary:

   ```bash
   docker compose build share
   docker compose up -d share
   ```

3. Make sure that the two app-link files answer:

   ```bash
   curl -sS https://share.kikouchou.app/.well-known/apple-app-site-association
   curl -sS https://share.kikouchou.app/.well-known/assetlinks.json
   ```

   Each command must print JSON that names `app.kikouchou`. A `Not found`
   means that a variable is missing.

### 1.12 Deploy the website with the app-link files

1. Run the website deploy, so that it reads the new variables:

   ```bash
   gh workflow run deploy.yml
   ```

2. When the run is done, make sure that the files answer:

   ```bash
   curl -sSI https://app.kikouchou.app/.well-known/apple-app-site-association
   curl -sS https://app.kikouchou.app/.well-known/assetlinks.json
   curl -sS https://app-site-association.cdn-apple.com/a/v1/app.kikouchou.app
   ```

   The first answer must be `200`. The last command reads Apple's CDN copy.
   Apple refreshes that copy on its own schedule, sometimes after a day.

3. Make sure that the landing page pages answer. Both stores need these URLs:
   * <https://www.kikouchou.app/privacy.html>
   * <https://www.kikouchou.app/delete-account.html>

4. Make sure that the contact address `admin@kikouchou.app` on the privacy
   page reaches you. It must work before the first review.

## Part 2: the first release

### 2.1 Tag the release

1. Make sure that `version` in `package.json` is the version to ship. The
   first one is `0.1.0`.
2. Tag and push:

   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```

3. Watch `.github/workflows/native.yml`:

   ```bash
   gh run watch "$(gh run list --workflow native.yml --limit 1 --json databaseId --jq '.[0].databaseId')"
   ```

The run builds the web bundle, both Android flavors and the IPA. It uploads
the IPA to TestFlight and creates the GitHub release `v0.1.0`. The Google Play
job fails on this first run with `Package not found: app.kikouchou`, because
a new app takes its first AAB by hand. That is expected, and the release is
created all the same.

The Google Play job can also say that the Google Play Android Developer API is
not enabled. If it does, open the link in the error and turn the API on. Then
rerun the failed job.

If the tag and `package.json` disagree, the run stops at once. Fix the version
and tag again.

### 2.2 Check the GitHub release

1. Open <https://github.com/tomMoulard/kikouchou/releases/tag/v0.1.0>.
2. Make sure that it carries four files:
   * `kikouchou-0.1.0.apk`
   * `kikouchou-0.1.0-fdroid.apk`
   * `kikouchou-0.1.0.aab`
   * `kikouchou-0.1.0.ipa`
3. Install `kikouchou-0.1.0.apk` on an Android phone, to test it before Play
   has it.

### 2.3 Google Play: the first upload

1. In the Play Console, create the app:
   * name: Kikouchou
   * default language: French or English
   * type: App
   * price: Free
2. Open Test and release, then Testing, then Internal testing. Create a
   release.
3. When the console offers Play App Signing, accept it.
4. Upload `kikouchou-0.1.0.aab` from the GitHub release. Roll the release out
   to internal testers.
5. Open Test and release, then App integrity. Copy the SHA-256 of the app
   signing key.
6. Add that fingerprint to `ANDROID_CERT_SHA256` in GitHub and on the share
   server:

   ```bash
   gh variable set ANDROID_CERT_SHA256 --body "<upload SHA-256>,<Play app signing SHA-256>"
   ```

   Then do step 1.11, items 2 and 3, again, and step 1.12, item 1. Without this,
   a tap on a link opens the browser, not the app installed from Play.

### 2.4 Google Play: the store listing and the forms

The console lists each of these under Policy and programs, then App content,
and under Grow users, then Store presence.

1. Store listing:
   * App name: `fastlane/metadata/android/<locale>/title.txt`
   * Short description: `short_description.txt` in the same folder
   * Full description: `full_description.txt` in the same folder
   * App icon: `fastlane/metadata/android/en-US/images/icon.png`
   * Feature graphic: 1024 by 500 PNG. The repository has none yet. Create
     one from the brand kit.
   * Phone screenshots: at least two.
   * Tablet screenshots: at least one 7 inch and one 10 inch, because the app
     supports tablets.
   * Category: Travel & Local.
2. Privacy policy: <https://www.kikouchou.app/privacy.html>.
3. App access: say that the app works without an account. Say that sharing
   needs a sign-in with Google, Spotify, Apple or an email link.
4. Ads: the app contains no ads.
5. Content rating: fill in the questionnaire. The app has user-generated
   content that other members of a trip see.
6. Target audience: 18 and over.
7. Data safety: declare what `ios/App/App/PrivacyInfo.xcprivacy` lists:
   * email address and name, for the account
   * trip content, for sharing, and the assistant's prompt text, for analytics
   * app interactions and crash logs, for analytics
   * a device identifier, for the push token

   Data is encrypted in transit. A user can ask for deletion, at
   <https://www.kikouchou.app/delete-account.html>.
8. Account deletion: <https://www.kikouchou.app/delete-account.html>.

### 2.5 Google Play: the closed test

A personal account needs this step before production.

1. Open Testing, then Closed testing. Create a track.
2. Add at least 12 testers, by email list or Google Group.
3. Promote the internal release to the closed track.
4. Keep at least 12 testers opted in for 14 days in a row.
5. After the 14 days, open the Dashboard and apply for production access.
   Answer the questions about the test.

### 2.6 App Store

1. In App Store Connect, open TestFlight. Wait for the build from step 2.1 to
   finish processing. The export compliance question is answered already
   (`ITSAppUsesNonExemptEncryption` is false).
2. Add yourself as an internal tester and install the build with TestFlight.
   Run the device check in section 2.8.
3. Open the app's page, then the version 0.1.0 page. Fill in:
   * screenshots: 6.9 inch iPhone (1320 by 2868) and 13 inch iPad (2064 by 2752)
   * description, keywords, and a support URL, for example
     <https://github.com/tomMoulard/kikouchou/issues>
   * the build from TestFlight
4. Open App Privacy. Enter the same data as the Play Data safety form. Answer
   that the app does not track. The Meta pixel and the Google tags do not run
   in the app.
5. Open App Information:
   * privacy policy URL: <https://www.kikouchou.app/privacy.html>
   * category: Travel
   * age rating: fill in the questionnaire
6. Open Pricing and Availability. Set the price to free.
7. In App Review Information, write that the app works without an account.
   Write that a reviewer can sign in with Sign in with Apple to test sharing.
8. Submit for review.

### 2.7 F-Droid

There are three routes. Do all three: they reach different people.

1. The self-hosted repository:
   1. Run the website deploy again, now that a release with an F-Droid APK
      exists:

      ```bash
      gh workflow run deploy.yml
      ```

   2. Make sure that the index answers:

      ```bash
      curl -sSI https://app.kikouchou.app/fdroid/repo/index-v1.jar
      ```

   3. Tell people to add `https://app.kikouchou.app/fdroid/repo` in the F-Droid
      app.
2. IzzyOnDroid, which picks the APK from each GitHub release: open an App
   Inclusion Request at <https://codeberg.org/IzzyOnDroid/repodata/issues>.
   IzzyOnDroid moved its requests there from GitLab. Give the repository URL
   and the file pattern `kikouchou-*-fdroid.apk`.
3. The f-droid.org catalogue. Wait for the first release that contains
   `gradleprops` in `metadata/app.kikouchou.yml`. The source of `v0.1.0` reads
   the flavor from an environment variable only, which f-droid.org cannot
   set, so that build would put Google's plugin on the classpath.
   1. Fork <https://gitlab.com/fdroid/fdroiddata>.
   2. Copy `metadata/app.kikouchou.yml` into the fork's `metadata/` folder.
      Replace the tag in `commit:` with the full commit hash of the tag, because
      fdroiddata refuses a tag there:

      ```bash
      git rev-parse 'v<version>^{commit}'
      ```

   3. Make sure that fdroidserver accepts it, in the fork:

      ```bash
      fdroid readmeta
      fdroid lint app.kikouchou
      fdroid build -v -l app.kikouchou
      ```

   4. Open a merge request. Expect the reviewers to ask for changes: the
      recipe never ran on their servers.
   5. When the app is published, f-droid.org signs it with its own key. Add
      that key's SHA-256 to `ANDROID_CERT_SHA256`, then repeat step 1.11,
      items 2 and 3, and step 1.12, item 1.

An app installed from f-droid.org and one installed from Play carry different
signatures. Android refuses to update one with the other. A user who changes
store must uninstall first, which removes the trips that were never synced.

### 2.8 The device check

Do this on one iPhone, one iPad and one Android phone before each store
release.

1. Sign in with Google, with Apple, and with an email link.
2. Open an invite link from Messages or WhatsApp. The app must open, not the
   browser.
3. Turn reminders on for a trip. Close the app. Receive a reminder, and tap it.
4. Scan a trip's QR code.
5. Export the calendar of your rides. The share sheet must open.
6. Turn on airplane mode and edit a trip.
7. Delete the account.

If a link opens the browser, make sure that `ANDROID_CERT_SHA256` has every
fingerprint, or wait for Apple's CDN (step 1.12).

## Part 3: every release after the first

1. Change `version` in `package.json`. The Android `versionCode` comes from it
   (`android/app/build.gradle`), and Play refuses a code it has seen. Commit
   and merge the change.
2. Tag and push:

   ```bash
   git tag v<version>
   git push origin v<version>
   ```

3. The run uploads the AAB to the Play internal track and the IPA to
   TestFlight, and creates the GitHub release.
4. In the Play Console, promote the internal release to production.
5. In App Store Connect, create the new version, pick the build, and submit
   it.
6. Run `gh workflow run deploy.yml`, so that the self-hosted F-Droid
   repository carries the new APK. IzzyOnDroid and f-droid.org read the new
   tag on their own.

When the app is published on Play, set `PLAY_RELEASE_STATUS` to `completed`.
The internal release then goes out without a click:

```bash
gh variable set PLAY_RELEASE_STATUS --body completed
```

## What this runbook does not cover

* No part of this runbook ran against the real stores. The first run of each
  step is also its test.
* `native.yml` uploads to TestFlight with `xcrun altool`. If the Xcode on the
  runner no longer has that command, upload the IPA from the release with the
  Transporter app.
* The Play upload uses the `r0adkll/upload-google-play` action. If the step
  fails with an API error, read the action's release notes.
