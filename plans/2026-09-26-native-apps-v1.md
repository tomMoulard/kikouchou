# Native apps for iOS and Android, v1

Date: 2026-09-26
Status: Route A decided on 2026-09-26 and implemented on branch
`feat/native-apps`. The last section lists what a person still has to do.

## The goal

Kikouchou is a PWA today. People install it from Chrome on Android and from
Safari on an iPhone. This plan ships the same app in the App Store and in Google
Play, from the same `src/`, with no rewrite of the UI.

The plan describes two routes.

* Route A: one Capacitor shell for both platforms. Capacitor is a native
  wrapper that loads the Vite build inside the system WebView and gives it
  native plugins.
* Route B: a Trusted Web Activity (TWA) for Android, and the Capacitor shell of
  Route A for iOS only. A TWA is an Android app that opens the deployed PWA in
  Chrome, full screen, with no browser bar.

iOS has no TWA. On iOS, both routes do the same Capacitor work. The routes
differ only on Android.

## The website stays

`https://app.kikouchou.app` stays online as it is today. The store apps are
two more ways to open the same product, not a replacement for the website.

* One `src/` builds three targets: the website, the iOS app and the Android
  app. Every native change is a branch on `getAppPlatform()` (S6). The web
  branch keeps today's behavior, and the Playwright suite keeps testing it.
* The web deploy (`deploy.yml`) does not change. In Route B, that deploy is
  also the Android app, because the TWA loads the live site.
* The PWA features stay on the website: the install prompt, the service
  worker, Web Push through VAPID, passkeys and Web3 sign-in. The native apps
  hide or replace some of them. The website loses none of them.
* The website is also the fallback for every link. A person with no app opens
  an invite, a template or the magic link's return page in the browser, as
  today. This is why the magic link in A3 returns to a universal link on
  `app.kikouchou.app`. Only the OAuth sheet, which never leaves the app, uses
  the custom URL scheme.
* A user can have trips in the website and in a store app on the same phone.
  The two storages are separate. Sign-in and sync join them (A9).

## The decision

Route A: Capacitor for both platforms. The product owner decided this on
2026-09-26, after the comparison below.

* A home screen widget is on the roadmap. An Android widget is native code,
  and it needs the trip data. In Capacitor the web layer can write a summary
  into native storage for the widget to read. A widget next to a TWA cannot
  read Chrome's IndexedDB, so it needs its own sign-in and its own copy of the
  data.
* A later move from a TWA to Capacitor keeps the Play listing but not the
  data, because Chrome's storage and the app's web view storage are separate.
  Starting on Capacitor avoids that move.
* The iOS work already pays for the FCM sender, the native sign-in and the
  deep links, so Capacitor on Android adds testing more than code.

Route B stays below as the record of the option that was not taken.

## What the investigation found

These facts come from a read of `main` on 2026-09-26. Each one changes the
work.

1. Nothing native exists. There is no `capacitor.config.*`, no `android/`, no
   `ios/`, no `twa-manifest.json`, and no `public/.well-known/`.
2. The web app deploys to GitHub Pages at `app.kikouchou.app`
   (`.github/workflows/deploy.yml`). The share preview service is the Rust
   server in `server/share-preview`, behind Traefik on `share.kikouchou.app`.
3. The manifest lists SVG icons only (`vite.config.ts:126-168`). The PNG files
   in `public/icons/` exist but the manifest does not list them.
4. The Capacitor page origin is `capacitor://localhost` on iOS and
   `https://localhost` on Android. Many parts of the app read the origin:
   * `isDevelopmentHost()` (`src/lib/analytics/development-host.ts:25`) treats
     `localhost` as a dev machine. PostHog, the Meta pixel and the Google tags
     all stay off in a Capacitor build.
   * `resolveRedirectTo()` (`src/features/auth/AuthContext.tsx:241-245`) sends
     `window.location.origin` as the OAuth and magic link target. GoTrue
     replaces a target that is not on its allow-list with the Site URL
     (`supabase/config.toml:481-487`). The user then lands on the website, not
     in the app.
   * Passkeys are bound to `rp_id = "app.kikouchou.app"`
     (`supabase/config.toml:537-540`).
   * `buildInviteUrl` and `buildTemplateUrl` (`src/lib/sync/invites.ts:169-181`,
     `src/lib/sync/templates.ts:156-168`) read `VITE_SHARE_ORIGIN`. If it is
     empty, they fall back to `window.location.origin`.
5. Push is Web Push end to end. The client calls `pushManager.subscribe`
   (`src/lib/notifications/push.ts:241-253`). The server encrypts and signs
   with VAPID (`push_sender.rs`). The table checks that `endpoint` starts with
   `https://` and that `p256dh` and `auth` exist
   (`supabase/migrations/20260910120000_trip_reminders.sql:58-85`). A WKWebView
   has no `PushManager`, so none of this works in a Capacitor iOS app.
6. Success messages go to the OS through the `Notification` API
   (`src/lib/notifications/os-notification.ts`). A WKWebView has no
   `Notification` either. `notify.success` then shows nothing. Only the screen
   reader announcement is left.
7. The `.ics` export uses a blob and `anchor.download`
   (`src/lib/utils/download.ts:93-104`). A WKWebView ignores that.
8. The app has no account deletion and no privacy policy page. Both stores
   require both for an app that creates accounts.

## Shared work, for both routes

Do this first. Both stores check it before the first review.

### S1. Store accounts and the Play testing rule

* An Apple Developer Program membership (99 USD a year) and a Google Play
  developer account (25 USD, one time).
* If the Play account is a personal account, Google requires a closed test with
  at least 12 testers for 14 days in a row before the first production release.
  Start this test on the first day. It sets the Android date, not the code.
* An organization account does not have this rule, but it needs a D-U-N-S
  number, which takes several days to get.

### S2. Account deletion

Apple guideline 5.1.1(v) and the Play user data policy both require that a user
can delete the account from inside the app. Play also requires a web page for
it.

* Add a `delete_my_account()` function in a new migration. It is
  `security definer`, checks `auth.uid()` as its first act, and deletes the
  rows that belong to the caller. Revoke EXECUTE from `public, anon,
  authenticated`, then grant it to `authenticated` only.
* Decide what happens to a shared trip whose owner leaves. This plan proposes
  that the next member becomes the owner, and that a trip with no other member
  goes away.
* Add the control in Settings, behind a dialog that asks the user again. Add
  the keys to both locales.
* Add pgTAP tests. `function_exposure_test.sql` covers the grant already,
  because it checks the whole catalog.

### S3. Privacy policy and store forms

* Publish a privacy policy page on the landing site. Both stores need its URL.
* Fill the App Store privacy labels and the Play Data safety form from the
  real data flows: Supabase account data, PostHog events (including the prompt
  text of `assistant_prompt_sent`), push tokens, and the Meta and Google
  trackers where they run.

### S4. PNG icons and store images

* Add the PNG icons (`icon-512.png`, `icon-maskable-512.png`) to the manifest.
  Bubblewrap needs a PNG of at least 512 px, and Capacitor asset generation
  starts from a 1024 px source.
* Produce store screenshots for a 6.9 inch iPhone, a 13 inch iPad (if iPad is
  in scope), and an Android phone.

### S5. The `.well-known` files

Both routes need files that prove the domain and the app belong together.

* Android: `/.well-known/assetlinks.json` on `app.kikouchou.app` and on
  `share.kikouchou.app`.
* iOS: `/.well-known/apple-app-site-association` (no extension) on the same
  two hosts.

`app.kikouchou.app` is GitHub Pages, so the files go in `public/.well-known/`.
Make sure that the Pages artifact keeps the dot folder and that the files come
back with a JSON content type. After the first deploy, test this with
`curl -I`. For Apple, also test
`https://app-site-association.cdn-apple.com/a/v1/app.kikouchou.app`. iOS reads
the file from that CDN and not from the site.

`share.kikouchou.app` is the Rust server. Add two routes there that serve the
files with `Content-Type: application/json`. This is easier to control than
GitHub Pages.

The Android fingerprint in `assetlinks.json` is the SHA-256 of the Play App
Signing key, from the Play Console. It is not the upload key. A wrong
fingerprint makes the TWA show a browser bar, and nothing else reports the
error.

### S6. A platform module

Add `src/lib/platform/` with one question and its answers:

```ts
export type AppPlatform = 'web' | 'twa' | 'ios' | 'android';
export function getAppPlatform(): AppPlatform;
export const PUBLIC_APP_ORIGIN: string; // from VITE_PUBLIC_APP_ORIGIN
```

* `ios` and `android` come from `Capacitor.getPlatform()`.
* `twa` comes from `document.referrer` starting with `android-app://` on the
  first load. Store it in `sessionStorage`, because the referrer is gone after
  the first navigation.
* Register the answer as the PostHog super property `platform`, next to
  `app_version`, so every breakdown can split web and store installs.
* Everything in `lib/` that needs the public origin takes
  `PUBLIC_APP_ORIGIN` as a parameter. This follows the rule that `lib/` never
  reads `window.location`.

## Route A: Capacitor for iOS and Android

### A1. The shell

* Add `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`,
  `@capacitor/android`, and `capacitor.config.ts`.
* App id `app.kikouchou`. `webDir: 'dist'`. Keep the default local assets.
  Do not set `server.url`.

The app loads from files inside the app, not from the website. The rejected
option was `server.url: 'https://app.kikouchou.app'`, which keeps the web
origin and so avoids most of the origin work. It fails for three reasons:

* The app does not open with no network on first launch.
* Apple guideline 4.2 rejects an app that is only a website in a frame.
* A service worker in WKWebView needs App-Bound Domains, and those limit
  which pages the plugins can talk to.

Commit `ios/` and `android/`. They are source, not build output, because
`Info.plist`, the entitlements and the Gradle files carry settings that
this plan edits.

### A2. Origin fixes

1. Analytics. Give `isDevelopmentHost()` a second input, the platform. A
   native platform is never a dev host, because the scheme is not `http:` and
   the WebView host is fixed. Keep the three existing layers of the dev guard.
   Add a unit test that `capacitor://localhost` on `ios` starts PostHog, and
   that `http://localhost:5173` on `web` still does not.
2. Trackers. Keep the Meta pixel and the Google tags off in native builds.
   On iOS, a tracker that follows the user across apps needs the App
   Tracking Transparency prompt (guideline 5.1.2). The store already counts
   installs, and `useInstallPrompt` never fires in a native app. PostHog stays
   on, as first party analytics that is declared in the privacy label.
3. Links. Native builds set `VITE_SHARE_ORIGIN=https://share.kikouchou.app`
   and `VITE_PUBLIC_APP_ORIGIN=https://app.kikouchou.app`. Change the fallback
   in `buildInviteUrl` and `buildTemplateUrl` from the page origin to
   `PUBLIC_APP_ORIGIN`, so a link never carries `capacitor://`.
4. The service worker. Skip `registerSW` in `src/lib/pwa/register.ts` on a
   native platform. The bundled files are already offline. The store ships
   updates, so the stale build prompt does not apply either.
5. Install UI. `InstallNudgeCard`, the install banner and
   `useHereManifest` render nothing on a native platform.

### A3. Sign-in

Google refuses OAuth inside an embedded WebView (`disallowed_useragent`). So
the sign-in leaves the WebView and comes back.

1. On a native platform, `resolveRedirectTo()` returns
   `app.kikouchou://auth/callback` for OAuth. The browser sheet opens inside
   the app and returns to it, so a custom scheme is enough, and a universal
   link does not reliably fire from a redirect inside the sheet. For the magic
   link it returns `https://app.kikouchou.app/auth/native`, a universal link
   on iOS and a verified app link on Android. That page is on the website
   too, for a user who opens the email on another device.
2. Call `signInWithOAuth` with `skipBrowserRedirect: true`, then open the
   returned URL with `@capacitor/browser` (SFSafariViewController on iOS,
   a Custom Tab on Android).
3. `App.addListener('appUrlOpen')` receives the URL with `?code=`. Close the
   browser and hand the code to `AuthProvider`, which exchanges it with
   `exchangeCodeForSession`. The PKCE verifier is in the WebView
   storage, where the sign-in started, so the exchange works.
4. The magic link email points at `/auth/native`. Tapping it on the phone
   opens the app through the universal link.
5. Add `app.kikouchou://auth/callback` to `additional_redirect_urls` for the
   production remote in `supabase/config.toml`. The existing
   `https://app.kikouchou.app/**` entry already covers `/auth/native`. A human pushes it with `bun run db:config-push`,
   and never with `supabase config push`.
6. Sign in with Apple. If an app offers Google sign-in, guideline 4.8 requires
   an equivalent privacy-focused sign-in. The magic link is probably not
   enough to satisfy it. Enable `[auth.external.apple]`. A human creates the
   Services ID and the key in the Apple console and puts them in the Supabase
   dashboard. No agent or script sets them.
7. Passkeys. The native app has no `app.kikouchou.app` origin, so WebAuthn in
   the WebView fails. Hide the passkey button in native builds for v1. A
   later version can add the `webcredentials:app.kikouchou.app` associated
   domain and a native passkey plugin.
8. Web3 sign-in. A WebView has no `window.ethereum`. Hide it in native builds.

### A4. Deep links

* iOS: add the associated domains `applinks:app.kikouchou.app` and
  `applinks:share.kikouchou.app`. The AASA file lists `/join/*`, `/t/*`,
  `/template/*`, `/auth/native`, `/fr/*` and `/en/*`.
* Android: add intent filters with `android:autoVerify="true"` for the same
  hosts and paths.
* In the app, one `appUrlOpen` handler maps the URL to a route:
  `share.kikouchou.app/{lang}/{token}` goes to `/join/{token}?lng={lang}`, and
  `share.kikouchou.app/{lang}/t/{token}` goes to `/template/{token}?lng={lang}`,
  the same mapping `server/share-preview/src/page.rs:146-178` does.
* Keep the preview server as it is. A chat app still needs the preview card,
  and a user with no app still needs the redirect.

### A5. Push

The server sends through Firebase Cloud Messaging (FCM) for both platforms.
If you upload the APNs key to Firebase, FCM delivers to iOS through APNs.
This gives the server one new sender, not two.

1. Client. Add `@capacitor/push-notifications`. On a native platform,
   `isPushSupported()` answers from the plugin, so the `ReminderCard` shows.
   `enableTripReminders()` asks for permission from the click, as today, then
   registers and sends `{ transport: 'fcm', token }` to the same two RPCs.
   The iOS app needs `@capacitor-firebase/messaging` or the Firebase SDK in
   `AppDelegate` to turn the APNs token into an FCM token.
2. Database. A new migration:
   * adds `push_subscriptions.transport text not null default 'webpush'` with
     a check on `('webpush', 'fcm')`.
   * adds `fcm_token text`, bounded to 4096 characters.
   * replaces the endpoint and key checks with checks per transport. A
     `webpush` row keeps today's rules. An `fcm` row needs a token and no
     keys.
   * adds a unique index on `(trip_id, fcm_token)`.
   * teaches `store_push_subscription` to read both shapes, and bounds every
     field of the new one.
   * extends `live_push_subscriptions` with the two columns, readable by
     `service_role` only.

   Grants stay revoke-first. Extend `trip_reminders_test.sql` with the fcm
   cases: subscribe, re-subscribe, a bad token refused, unsubscribe.
3. Unsubscribe. `unsubscribe_reminders(endpoint)` takes the FCM token in the
   same argument. Rename nothing, so old clients keep working.
4. Server. `push_sender.rs` branches on `transport`. The `fcm` path sends
   with the FCM HTTP v1 API and a Google service account. It keeps the
   existing rules. The log entry comes before the send. The text comes from
   the live document. An `UNREGISTERED` answer deletes the subscription, as a
   404 or 410 does today. The payload carries `title`, `body`, and
   `data: { kind, url, tag }`. It carries no guest name, as today.
5. Clicks. `pushNotificationActionPerformed` gives the `kind`. Send it to the
   code in `src/lib/notifications/opened.ts` that captures
   `notification_opened`, through a new exported function. The service worker
   path stays for the web.
6. Secrets. The server needs `FCM_SERVICE_ACCOUNT_JSON` and
   `FCM_PROJECT_ID`. The iOS build needs `GoogleService-Info.plist`, and the
   Android build needs `google-services.json`. The Firebase console needs the
   APNs `.p8` key.

### A6. OS success messages

A WKWebView has no `Notification`, so `notify.success` loses its visible half.
On a native platform, `confirm()` in `src/lib/notifications/notify.ts` shows
the in-page toast again, positioned clear of the nav bar and the FAB. A native
app that posts a system notification for "room saved" feels wrong, so do not
add `@capacitor/local-notifications` for this. Keep the announcement first, as
today.

### A7. Files, camera, maps, back button

* `.ics` export: on a native platform, write the file with
  `@capacitor/filesystem` and open the share sheet with `@capacitor/share`.
  The user then picks the Calendar app.
* Camera: `html5-qrcode` works in WKWebView from iOS 14.3. Add
  `NSCameraUsageDescription` in both locales (`InfoPlist.strings`) and the
  `CAMERA` permission on Android. Capacitor forwards the WebView permission
  request.
* Maps links: `window.open(url, '_blank')` in `DirectionsButton.tsx` and
  `TripLocationMap.tsx` goes through `@capacitor/app-launcher` on a native
  platform, so Apple Maps and Google Maps open as apps.
* Android back button: `App.addListener('backButton')` calls
  `navigate(-1)`, and closes the app from the trips list.
* Status bar and splash: `@capacitor/status-bar` and
  `@capacitor/splash-screen`. The safe area insets in `src/index.css` already
  apply, because `index.html` asks for `viewport-fit=cover`.

### A8. Storage and the assistant

* Call `navigator.storage.persist()` once on a native platform. IndexedDB
  holds the only copy of a local-only trip.
* The assistant downloads its model into Cache Storage. Qwen3 1.7B is more
  than 1 GB. Test on a real device that the model survives an app restart and
  a low-storage warning.
* WebGPU. Without it the assistant offers the cloud models and Needle only
  (answer 4 below). Test the probe in WKWebView on iOS 26 and in the Android
  System WebView. If the local models do not run there, the store text must
  not name them.

### A9. Data that is already on the phone

A user who installed the PWA has data in the browser storage. The native app
has its own storage and starts empty.

* A signed-in user gets every synced trip back on sign-in, through the account
  sweep.
* A local-only trip does not move. On the first launch of the native app,
  show a card: "Your trips from the web app are on this phone in the browser.
  Sign in there once to bring them here." Add the keys to both locales.

### A10. CI and release

A new workflow, `native.yml`, runs on `workflow_dispatch` and on a `v*` tag,
after CI succeeds. It follows the pattern of `deploy.yml`.

* The web step runs `bun run build` with the native `VITE_*` values, then
  `bunx cap sync`.
* The Android job runs on `ubuntu-latest`. It builds a signed AAB with the
  upload key and uploads it to the Play internal track.
* The iOS job runs on `macos-latest`. It builds and signs with fastlane, using
  an App Store Connect API key, and uploads to TestFlight.
* `versionName` comes from `package.json`. `versionCode` and the iOS build
  number come from `github.run_number`.

The workflow needs these secrets, plus the existing `VITE_*` values:

* Android: `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_KEYSTORE_PASSWORD`,
  `ANDROID_UPLOAD_KEY_ALIAS`, `ANDROID_UPLOAD_KEY_PASSWORD`,
  `PLAY_SERVICE_ACCOUNT_JSON`, `GOOGLE_SERVICES_JSON`.
* iOS: `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`, `MATCH_GIT_URL`,
  `MATCH_PASSWORD`, `GOOGLE_SERVICE_INFO_PLIST`.

Prove that the gate fails. Break the build on purpose on a branch, run the
workflow, and make sure that no upload happens.

### A11. Tests

* Unit tests mock `@capacitor/core` and cover each native branch:
  `getAppPlatform`, the dev host rule, the link builders, the redirect
  target, `isPushSupported`, the push payload, `confirm()`, and the download
  path. The coverage floor of 93% applies, and the new branches are small.
* Playwright keeps testing the web build. A native branch is not reachable
  there.
* Before each store release, a person runs a check list on a real device:
  1. Sign in with Google, with Apple and with email.
  2. Open an invite link from Messages and from WhatsApp.
  3. Receive a reminder with the app closed, and tap it.
  4. Scan a QR code, and export the calendar.
  5. Go offline and edit a trip.
  6. Delete the account.

### A12. The web side of the store apps

* Add `<meta name="apple-itunes-app" content="app-id=...">` to `index.html`.
  Safari then shows its own banner with a button that installs. This follows
  the rule "an install offer is a button that installs, or it is absent".
* Add `related_applications` with the Play id to the manifest, and set
  `prefer_related_applications` to false so Chrome keeps the PWA install too.

### A13. Store review risks

* 4.2, minimum functionality: push, offline work, the camera and the share
  sheet show that the app is more than a website.
* 3.1.1, in-app purchase: `UpgradeOfferDialog` only asks about intent. It
  sells nothing, and it links to no outside payment. Keep it that way in the
  iOS app. When a paid tier exists, the iOS app must sell it through in-app
  purchase or hide it.
* 5.1.1(v), account deletion: see S2.
* 4.8, sign-in: see A3 step 6.

## Route B: TWA for Android, Capacitor for iOS

The iOS half is Route A, steps A1 to A13, for iOS only. The Android half
follows.

### B1. Generate the TWA

* Run Bubblewrap (`@bubblewrap/cli`) against
  `https://app.kikouchou.app/manifest.webmanifest`, after S4 adds the PNG
  icons.
* Package id `app.kikouchou`, the same id as the iOS app.
* Turn on notification delegation (`enableNotifications: true`). Android 13
  then asks for `POST_NOTIFICATIONS` for the app, and Web Push shows under the
  app name.
* Add `share.kikouchou.app` in `additionalTrustedOrigins`, so an invite that
  goes through the preview page stays full screen.
* Keep `twa-manifest.json` and the generated project in `android/`. Commit
  the whole project except the build output.

### B2. What works with no change

The page runs in Chrome on the real origin, so these parts stay as they are:

* sign-in with Google and Spotify, the magic link, passkeys and Web3
* Web Push through VAPID
* the service worker and its offline cache
* the `.ics` download and the camera
* the analytics dev guard and the invite links

### B3. The small changes

* S6 detects the TWA, so PostHog can tell the TWA from the browser.
* The install banner and `InstallNudgeCard` hide in a TWA. `isInstalled`
  already turns true, because a TWA matches `(display-mode: standalone)`.
  Make sure of this on a device. If it does not match, the TWA check in S6
  covers it.
* `appinstalled` does not fire for a store install. The Play Console counts
  installs. Nothing in the app reports them.
* The Meta pixel and the Google Ads tag keep running in the TWA, because it is
  the same web page. Declare them in the Play Data safety form.

### B4. Links

`assetlinks.json` on both hosts (S5) plus the intent filters that Bubblewrap
writes. A tap on an invite link in WhatsApp or Gmail then opens the TWA and
not the browser.

### B5. Release

* Bubblewrap builds the AAB with the upload key.
* The `native.yml` Android job from A10 runs `bubblewrap build` in place of
  the Gradle build of the Capacitor project. It needs the same four keystore
  secrets and `PLAY_SERVICE_ACCOUNT_JSON`.
* A web deploy updates the TWA at once. A new store build is necessary only
  when the manifest, the icons or the Android target API level change. Google
  raises the target API level every year, so plan one rebuild each August.

### B6. TWA risks

* The fingerprint. A wrong SHA-256 in `assetlinks.json` gives an app with a
  browser bar on top. Use the Play App Signing key, and test the internal
  track build, not a local build.
* No Chrome. On a phone without a TWA-capable browser, the app opens in a
  WebView fallback, where Web Push and passkeys do not work. This is rare on
  phones that ship Google Play.
* Play quality. Google can reject a TWA that is slow or that breaks offline.
  The performance and offline specs already cover this on the web build.

## The cost of each route

| Work | Route A | Route B |
| --- | --- | --- |
| Shared work S1 to S6 | yes | yes |
| iOS Capacitor A1 to A13 | yes | yes |
| Android origin, sign-in and deep links in Capacitor | yes | no |
| Android FCM path on the client | yes | no |
| Android TWA B1 to B6 | no | yes |
| Server FCM sender | yes | yes, for iOS |
| Android updates without a store build | no | yes |
| Native Android APIs | yes | no |

## The order of work

Each step is one branch and one pull request.

1. S2, account deletion, and S3, the privacy policy. These are blockers for
   both stores and are useful on the web too.
2. S4, S5 and S6: the icons, the `.well-known` files, the platform module.
3. B1 to B5: the Android TWA to the internal track. Start the 14-day closed
   test on the same day.
4. A1, A2, A6 to A8 for iOS: the shell, the origin fixes, the success messages,
   the files and the camera. The result goes to TestFlight.
5. A3 and A4: sign-in, Sign in with Apple and the deep links.
6. A5: push over FCM, the migration, the server sender.
7. A10 to A13: the release workflow, the smart app banner, the App Store
   submission.

## Answers to the open questions

These answers came from the product owner on 2026-09-26.

1. The Play account is a personal account at first. The 14-day closed test
   with 12 testers (S1) therefore sets the Android date.
2. The iPad is in scope. The project targets iPhone and iPad
   (`TARGETED_DEVICE_FAMILY = "1,2"`) with all four orientations on iPad, which
   iPad multitasking requires. The store needs 13 inch iPad screenshots.
3. When the owner of a shared trip deletes the account, nothing happens to the
   trip unless the owner was its last member. A trip with other members goes
   to the member who joined first. A trip with no other member is deleted.
4. Without WebGPU the assistant stays, and offers only what can run there:
   the cloud models through OpenRouter, and Needle on the CPU. This replaced
   the first answer, which hid the page, on 2026-10-22: the OpenRouter models
   arrived on main, and a page that offers them is not a dead end. In an app,
   the OpenRouter sign-in returns on `app.kikouchou://openrouter/callback`.
5. The name is Kikouchou. The remaining "Kikoushou" strings were old and are
   renamed: the passkey display name, the wallet sign-in statement, a cache
   key, and the share service's image name.

## What is implemented

The branch `feat/native-apps` carries the whole of Route A:

* the Capacitor shells, with the Play and F-Droid flavors on Android
* `src/lib/platform` and the origin fixes in A2
* the sign-in in A3, except Sign in with Apple, which is a dashboard step
* the deep links in A4, on both hosts
* push over APNs and FCM in A5: the migration, the client and the server
* A6 to A9, and account deletion (S2)
* the icon variants: the iOS default, dark and tinted appearances, the Android
  adaptive icon with a monochrome layer, a monochrome icon in the manifest, and
  light and dark favicons
* `.github/workflows/native.yml` for A10, the self-hosted F-Droid repository in
  `deploy.yml`, and the F-Droid recipe in `metadata/app.kikouchou.yml`.

## What a person still has to do

No agent or script can do these, because each one needs an account, a key or
a decision. `docs/releasing-the-store-apps.md` gives each one as exact
steps and commands.

1. Create the Apple Developer and Google Play accounts (S1). Create the app
   `app.kikouchou` in App Store Connect and in the Play Console, and upload the
   first AAB to Play by hand: the Play API refuses a new app's first upload.
2. Start the Play closed test with 12 testers on the day the first build is on
   the internal track.
3. Create the keys and put them in the repository settings.
   * Secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
     `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `GOOGLE_SERVICES_JSON`,
     `PLAY_SERVICE_ACCOUNT_JSON`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8`,
     `FDROID_KEYSTORE_BASE64`, `FDROID_KEYSTORE_PASSWORD`.
   * Variables: `APPLE_TEAM_ID`, `ANDROID_CERT_SHA256` (the Play App Signing
     key, the upload key and the F-Droid key, comma separated),
     `IOS_APP_STORE_ID`, `PLAY_RELEASE_STATUS`.
4. On the share server, set `APPLE_TEAM_ID`, `APNS_KEY_ID`, `APNS_PRIVATE_KEY`,
   `FCM_SERVICE_ACCOUNT_JSON` and `ANDROID_CERT_SHA256`, then rebuild and
   restart it with `docker compose`. The image is now
   `tommoulard/kikouchou-share`.
5. Create a Firebase project for Android push. iOS push needs no Firebase,
   because the server sends to APNs directly with the `.p8` key.
6. Apply the migration with `bunx supabase db push`, and push the new redirect
   URL with `bun run db:config-push`.
7. Enable Sign in with Apple in the Supabase dashboard (guideline 4.8). The
   Services ID and the key come from the Apple console.
8. Publish the privacy policy and the account deletion page on the landing
   site, and fill the App Store privacy label and the Play Data safety form
   (S3). `ios/App/App/PrivacyInfo.xcprivacy` lists what the app collects.
9. Submit `metadata/app.kikouchou.yml` to fdroiddata as a merge request. The
   project is MIT, as the README said. The branch adds the LICENSE file that
   f-droid.org asks for.
10. Tag `v0.1.0` to run the first signed release.

## What this plan did not check

* That GitHub Pages serves `public/.well-known/` with a JSON content type.
  S5 has the test.
* That WebGPU is present in WKWebView on iOS 26 and in the Android System
  WebView. A8 has the test.
* That a TWA matches `(display-mode: standalone)`. B3 has the test.
* The Apple review outcome for guideline 4.8 with only the magic link. The
  plan assumes that Sign in with Apple is required.
