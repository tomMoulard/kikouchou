# Invite first, reminders second: a review of the install-first plan

Date: 2026-09-10. Status: proposal. Nothing is built.

## Summary

You want people to come back after one interaction with the app. Your plan pushes installation and gates most features behind the installed app. It requires an account to create, share or sync a trip. It lets an invitee read the calendar in the browser.

This document reviews that plan against the code and against nine days of analytics. The goal is right. The part that opens the invite link without an account is right, and the data supports it. The rest rests on three premises that do not hold. Installing does not cause return visits. No browser can schedule a notification for a closed app. Installing grants no write access on the server.

The plan below keeps your goal and reorders the work. Open the invite link to everyone. Give people a reason to return, which is a reminder. Nudge installation only where reminders need it, on the iPhone. Leave trip creation free of accounts.

## 1. What the analytics say

PostHog started recording on 2026-09-01. The window is nine days, 80 persons and 3228 events. The numbers are small, and most of the activity is the owner testing the app. Read them as direction and not as proof. The arguments in section 2 stand on the platform facts, not on these counts.

Who the 80 persons are:

- 36 arrived on app.kikouchou.app and 5 on the old tommoulard.github.io address.
- 18 came from localhost:3000 and 1 from localhost:5173. These are the development phantoms that AGENTS.md describes.
- 16 came from www.kikouchou.app, the landing site, which shares the PostHog key.
- 9 are flagged as bots. Another 18 report Safari on a desktop with no operating system, which is the shape of a link scanner.

What they did:

| Measure | Persons |
| --- | --- |
| Loaded at least one page | 76 |
| Used the app at all (app_used) | 6 |
| Created a trip | 6 |
| Landed on an invite link | 5 |
| Stopped by "sign in to join" | 4 |
| Of those 4, joined afterwards | 1 |
| Shared a trip | 4 |
| Have an account | 4 |
| Installed the app | 3 |
| Clicked "Install on your phone" on the landing page | 1 |
| Came back on a later day, of the 72 who had two days to do so | 9 |

The three installers:

- One installed two hours after the first visit. That person then used the app on 5 days, created a trip and joined one.
- One installed 31 seconds after the first visit. That person used the app on 3 days and created two trips.
- One installed 7 seconds after the first visit and never used the app.

The four invitees stopped at sign-in:

- One signed in and joined. That person has 141 page views over 6 days, the most active person in the data.
- Three left within 3 minutes, with one or two page views each.

Devices: 21 persons on Android, 1 on an iPhone inside the Facebook browser, the rest on desktop. Chrome dominates. Two of the three installs happened on Android Chrome and one on Android Firefox.

## 2. The roast

### 2.1 The theory runs backwards

Two of the three installers are two of the six people who used the app at all. They installed minutes after arriving, because they were already engaged. Installation is a symptom of engagement, not a cause of it. The correlation you expect will appear in the data and prove nothing. Browsers agree with this reading. Chrome fires its install prompt only after the visitor meets an engagement heuristic.

### 2.2 The leak is before retention

70 of 80 persons never used the app. Among real visitors on the app domain, about 6 of 41 did. Nobody returns to an app they never used. The first value moment is where the funnel dies, not the missing icon.

Your one measured leak is the invite wall. 3 of 4 invitees left within 3 minutes of "Create an account so the others can see your room". That is the change with evidence behind it.

### 2.3 No browser schedules a notification

The sentence "if they installed the application, I can do scheduled notifications" is false as written. A service worker (the script that runs behind the page) cannot wake itself at a chosen time. Chrome trialed a Notification Triggers API in 2020 and dropped it. The only way to notify a closed app is Web Push (a server sends a message to a subscribed device). The app has no push today. The ride alerts in lib/notifications fire only while the app is open, and the Settings card says so.

Installation matters for push in exactly one place. On an iPhone, Web Push works only for a web app on the Home Screen, since iOS 16.4. Everywhere else the browser tab receives push without installation. The real dependency chain is: reminder content, then a push sender, then a permission prompt at a moment of value, then an install nudge on the iPhone as a prerequisite. Installation is step four.

### 2.4 Installing grants nothing on the server

Every write goes through Row Level Security (RLS), the Postgres rules that decide who changes a row. RLS knows accounts and trip membership. It does not know whether the page runs as an installed app. An invitee who installs to "access most of the app features" still cannot edit a shared trip without an account. "Install to edit" puts a second wall in front of the account wall. The gate for editing is the account, whichever order you put the walls in.

### 2.5 The iPhone breaks the browser-to-app handoff

Story 1 assumes the browser and the installed app are the same place. On Android with Chrome they share storage, so the story works. On an iPhone they do not:

- A Home Screen web app has its own storage, separate from Safari. The trip in IndexedDB and the "which guest are you" answer in localStorage do not carry over. The installed app opens empty.
- A tapped link always opens Safari, never the installed web app. "If I have the app installed, I am greeted to a page" cannot happen from a link on an iPhone.

A plan that sends a guest from the browser to the installed app needs a server-side handoff. The installed app must fetch the trip again, through the invite token (scan or paste) or through an account. Your current audience is Android and desktop, so this has not bitten yet. A group of French friends will have iPhones.

### 2.6 Gating on installation locks people out

Firefox on macOS cannot install web apps at all. The app says so in its own install steps. Firefox on Linux needs an about:config flag. Desktop Chrome and Safari can install, but almost nobody installs a desktop web app. Trips are organized on laptops. Grayed buttons that lead to an install page are a dead end for all of these people.

Detection is also a heuristic. The app knows it is installed only through the display-mode media query and the Safari standalone flag. An invitee who installed and then taps a link in a chat lands in a browser tab and reads as "not installed". The gate misfires on exactly the flow you are designing.

### 2.7 Login before creating a trip reverses the foundation

The codebase is built on one rule: a trip is created, edited and read with no account and no network. AuthContext states "rendering never waits on auth". The sync plan lists exactly three operations allowed to need the network: share, join, sign in. Requiring an account to create a trip puts an OAuth redirect in front of the first value moment, on a train, with no signal.

Six people created trips in nine days. Zero people were stopped at the share wall, because everybody who shared already had an account. Sign-in at share time costs nothing measurable. Sign-in at creation time will.

### 2.8 An anonymous calendar changes the privacy stance

Today the invite token is usable without being readable, and anon has zero grants on every table. A read-only calendar for anyone holding the link makes the token a bearer read credential. Guest names, stay dates and pickup places become visible to anyone who forwards or screenshots the link. The share preview service deliberately shows acronyms only, for this reason.

This is a policy change, not a bug, and it is defensible. The same token already lets any Google account join and edit. The ShareDialog already promises "Anyone with this link can view and edit this trip". Decide it on purpose, and keep revocation and expiry as the controls.

The default expiry is one month. A trip planned three months ahead outlives its own link, so an anonymous viewer loses updates after a month. Expiry needs to follow the trip end date.

### 2.9 Story 2 contradicts itself

"I have the app installed, but I am not logged in. I can view trips that were shared with me." On an iPhone that installed app has empty storage. Where do the shared trips come from? Without an account there is no sweep, and without the token there is nothing to fetch. The installed app needs a first-launch screen that takes a pasted link, a scanned QR code, or a sign-in.

### 2.10 The wizard and the confetti do not serve the goal

A one-question-per-screen creation flow with confetti is a good first impression for the organizer. It does nothing for return visits, and the organizer is the one person who already returns. It also costs more than it looks. The current form holds a name, a place with autocomplete and import from a previous trip, dates, guests with group import, and rooms. That is six screens minimum. Eleven end-to-end specs create a trip through the one-page form, and every one of them breaks. Do it, but last, and behind a feature flag.

## 3. Decisions (2026-09-10)

The questions were answered on the day of the review. The plan below follows these answers.

1. Anonymous read: accepted. Anyone holding an invite link reads the trip. Expiry follows the trip end date plus seven days. Revocation stays.
2. Trip creation: no account. The account is asked for at share time and at "turn on reminders".
3. The gate: every section is read-only for a viewer. Editing is gated on the account. Installation is nudged on phones only, and only for reminders. Nothing on desktop mentions installation.
4. Installing grants nothing on the server, so any install-related behavior is a front-end nudge and never a gate.
5. Reminders: the least possible. Three kinds: the trip starts soon, your own arrival is tomorrow, and an upcoming pickup you drive or ride in.
6. The sender runs inside the Rust share-preview service on the VPS. Campaign control lives in PostHog: the service reports what is due as an event, a PostHog workflow decides, and a webhook back to the service sends the push. Feature flags gate each reminder kind.
7. The iPhone handoff: the invite lives in the URL the installed app opens on. The join page points at a manifest without a start_url, so "Add to Home Screen" from that page opens the app on the invite itself. The query parameter install=1 shows the steps.
8. The wizard: one question per screen, for the first trip on a device only, behind a PostHog feature flag, compared on completion against the one-page form.

## 4. The plan

Five phases. Each one ships on its own and is measured before the next starts. Effort is in focused days and includes tests.

### Phase 0. Measure what you are about to change (half a day)

The theory cannot be tested today, because no event says whether the page runs installed. Add that first.

- Register a display_mode super property (a value attached to every event) in src/lib/posthog.ts. The values are standalone and browser, read from the media query that useInstallPrompt uses.
- Add the events the later phases need: trip_viewed_anonymously, install_nudge_shown, install_nudge_accepted, install_nudge_dismissed, reminder_optin_shown, reminder_optin_granted, reminder_optin_denied and push_subscribed. Names follow the noun_verb_past rule in AGENTS.md.
- Filter the localhost and www.kikouchou.app hosts out of the PostHog insights you read, or move the landing site to its own project.
- Build one retention insight: app_used, broken down by display_mode. In four weeks it answers your original question with real numbers.

Tests: the existing posthog unit tests, extended for the new super property.

### Phase 1. The invite link works without an account (5 to 7 days)

This is the change with evidence behind it. An invitee opens the link, sees the trip, says who they are, and reads the calendar. The first edit asks for an account.

Database:

- A new function read_shared_trip(invite_token, after_id), security definer (it runs with its owner's rights), granted to anon and authenticated. It applies the same token rules as redeem_invite, with the same hints for not found, revoked, expired and exhausted. It does not consume a use and writes nothing. It returns the trip preview, the compacted snapshot, and at most 500 log rows after the given id, with a has_more flag.
- No other grant to anon. The function is the one door, and pgTAP (the Postgres test framework) proves it: anon reads a valid token, anon still gets 42501 on every table, each refusal hint fires, uses does not move, and paging works.
- The default invite expiry becomes the trip end date plus seven days, in lib/sync/invites.ts.

Client:

- Trip gains an optional viewerToken field. A trip with a token and no membership is a viewer trip. A new hook useTripAccess returns viewer or member.
- lib/sync/viewer.ts materializes a viewer trip the way join-trip.ts does. It applies the snapshot and the updates into the Y.Doc, records the server state vector through cursors.ts, and projects into Dexie through the existing bridge. A refresh runs on open and on visibilitychange, pull only, with no Realtime.
- /join/:token becomes the anonymous welcome. It shows the warm card from ShareImportPage with the trip name, dates and place, then the existing "Which one are you?" step. Signed out, the choice is device-local through lib/sharing/guest-identity. Signed in, the current redeem path runs unchanged.
- Read-only mode hides every write control on a viewer trip: the edit and delete buttons in EventDetailDialog, the create buttons on rooms, guests, transports and activities, drag on the rooms timeline, room claiming, ride volunteering, and the trip card on the Settings page. The assistant refuses actions on a viewer trip, and its system prompt says the trip is read-only.
- One UnlockCard on every trip page for viewers: "Sign in to edit this trip". It opens SignInDialog with that reason.
- Upgrade path: the account sweep in AccountTripSync redeems the stored token when a viewer signs in, clears viewerToken, and mounts the sync provider. If a device-local identity exists, it is offered once as the server-side claim.
- Copy in both locales. The ShareDialog notice becomes "Anyone with this link can see this trip. Editing needs an account."

Tests:

- pgTAP for the function, in supabase/tests.
- Unit tests for viewer.ts, useTripAccess and every read-only branch.
- The e2e stub gains the RPC. A new spec drives the journey: open the link signed out, see the name, pick a guest, read the calendar, find no edit controls, sign in, edit.
- AGENTS.md and the sync plan record that anon now executes one function.

### Phase 2. Install nudge with a reason, and the iPhone handoff (2 to 3 days)

Nothing is gated. Installation is offered where it helps, with a stated benefit.

- An InstallNudgeCard built on useInstallPrompt, shown on phones in a browser tab: after the guest picks who they are, and on the calendar. It is dismissible for 30 days, like PlanOwnTripPrompt. Before phase 3 the benefit reads "open the trip in one tap". After phase 3 it reads "get a heads-up before your train".
- The iPhone steps come from the existing manual install table.
- First launch of an installed app with no trips: the empty state on /trips gains "Paste or scan an invite link" next to "New trip". ImportTripQrDialog already accepts a pasted link and routes to /join.
- A stable deep link /t/:remoteTripId resolves the local trip by its server id. It downloads the trip when signed in and asks for the invite link otherwise. Notifications point at it, so an expired token does not break a reminder.
- The iPhone handoff: the build emits a second manifest, identical to the first but without a start_url. The join page swaps its manifest link to that file. Safari then opens the Home Screen app on the page it was added from, which is /join/<token>, and the installed app fetches the trip on its own. The nudge on a trip page sends the viewer to /join/<token>?install=1 first, so the steps and the right manifest are on screen together.
- The manifest gains launch_handler with client_mode navigate-existing, so Chromium opens a link in the running installed app instead of a second window.
- Nothing about installation is shown on desktop.

Tests: unit tests for the nudge decision, an e2e spec that stubs the standalone media query through an init script, and the existing install-request spec.

### Phase 3. Reminders, the reason to come back (6 to 9 days)

Web Push, end to end. This is the only part of the plan that creates a return trigger. Three reminder kinds and no more: trip_start (the trip begins soon), own_arrival (your arrival is tomorrow), and pickup (a ride you drive or ride in is due).

Database:

- A push_subscriptions table: trip id, optional person id, endpoint (unique), the two keys, locale, created and last seen timestamps. RLS is on in the same migration. All grants are revoked from anon and authenticated. service_role gets select and delete.
- Two security definer functions. subscribe_trip_reminders(invite_token, subscription, person_id, locale) serves anonymous viewers and applies the read_shared_trip token rules. A member variant takes the trip id and requires membership. unsubscribe(endpoint) removes one row.
- A reminder_log table keyed on subscription, kind and subject, so a reminder is sent once.

Sender, in server/share-preview:

- A tokio task runs hourly. It selects the subscriptions whose trip has an event inside the window, rebuilds the document with the code that already draws the card, finds the person's own arrival and pickups, and reports one reminder_due event per person and kind to PostHog, with the subscription id as a property.
- PostHog owns the campaign. A workflow with an event trigger on reminder_due decides, with conditions per kind, delays and cohorts, and calls the service back through an HTTP webhook step: POST /push/send with the subscription id and the kind, signed with a shared secret. Turning a kind off, changing its timing, or running an A/B test is a workflow edit, not a deploy.
- The service sends with the web-push crate, using a VAPID key pair (the keys that identify the push sender). The private key arrives as an environment variable, like the service key. A 404 or 410 from the push service deletes the subscription. The payload text is localized by the existing i18n module.
- A PostHog feature flag per kind, read by the service before it reports reminder_due, is the second control and the fallback when no workflow is active.
- It records every send in reminder_log and reports reminder_sent to PostHog through the public project key.

Client:

- lib/notifications/push.ts subscribes through the service worker registration with the public VAPID key from the build configuration, then calls the function.
- public/sw-notifications.js gains a push listener that shows the notification with a data.url. The existing notificationclick handler opens it.
- A ReminderCard after the identity step and on the calendar: what you will get, and one button. The permission request runs from that click only, following lib/notifications/permission.ts. On an iPhone in Safari the card shows the Home Screen steps first, because push is impossible there until the app is installed.
- The Settings notification card stops saying the app has no server.

Tests: pgTAP for the tables and functions, Rust unit tests for window selection and payload text without a network, unit tests for push.ts, an e2e spec with the stub for subscribe and unsubscribe, and one manual run on a real iPhone and a real Android phone.

### Phase 4. The creation wizard and the confetti (4 to 6 days)

Behind a PostHog feature flag, for the first trip on a device only, compared against the one-page form on trip_created completion. A device that already holds a trip keeps the one-page form.

- Extract the field groups of TripForm into components first: name, dates, place, guest list, room list. The one-page form keeps them for editing. The extraction is a refactor with no behavior change and its own tests.
- TripCreateWizard on /trips/new: one question per screen, Enter advances, Back goes back, progress dots, and every step after the dates is skippable. Screens: name, dates, place with import from a previous trip, guests with group import, rooms, done.
- The done screen fires canvas-confetti, loaded lazily and skipped under prefers-reduced-motion. The status region announces the creation. The screen offers "Share the trip" and, on a phone, the install nudge.
- Trip creation stays local and account-free.

Tests: unit tests per step. The eleven e2e specs that create a trip through the form move to shared helpers in e2e/support/trip-form.ts, so the wizard and the form are both driven from one place.

### Phase 5. Read the numbers, then decide about gates (after four weeks)

Build these insights and read them before adding any gate:

- Retention of app_used by display_mode.
- The funnel: invite link opened, guest picked, reminder granted, returned within seven days.
- Conversion from viewer to account, and the reason shown in SignInDialog.
- Install nudge acceptance by platform.

If installed users return more after this, the gate question is worth reopening with data. If they do not, the question is closed.

## 5. What already exists and is reused

- The identity step in JoinTripPage and the warm wizard under /share.
- extractInviteToken and ImportTripQrDialog for pasted links and QR codes.
- useInstallPrompt with the manual steps per platform, and the ?install=1 handling.
- lib/notifications: the permission rule, the OS delivery paths, and the notificationclick handler in the service worker.
- The Rust share-preview service: service key at run time, PostgREST reads, Yjs rebuild, localized rendering.
- pg_cron and pg_net, already enabled.
- PlanOwnTripPrompt, RemoteTripsSection and the account sweep.
- PostHog feature flags, already wired in lib/flags.

## 6. What this plan does not do

- No anonymous writes. Editing needs an account, because RLS needs an author.
- No feature gated on installation.
- No account before creating a trip.
- No Realtime channel for viewers. A pull on open and on focus is enough for a read-only page.
- No change to the plaintext storage decision.

## 7. Status

Updated as phases land. Each entry names the branch and what it contains.

Phase 0 and phase 1 are built on the branch feat/invite-without-account, as one set of commits:

- The display_mode super property and the trip_viewed usage action.
- The read_shared_trip function, granted to anon and authenticated, with 22 pgTAP assertions.
- The viewer trip: viewerToken on the trip row, lib/sync/viewer.ts, useViewerSync, the SupabaseTripSync branch, the YjsSyncObserver guard, the read-only badge, and the account sweep upgrade.
- The invite link without an account: useJoinTrip reads as a viewer when signed out, JoinTripPage shows the welcome and the device-local identity pick, and the ViewerUnlockCard offers the sign-in on every trip page.
- Read-only gating on the calendar, rooms, guests, transport, activities, cars and settings pages, in the card components, and in the assistant.
- Invite expiry bound to the trip end date plus seven days, and a viewer's share dialog handing on the same link.
- The e2e stub answers read_shared_trip, and trip-invite-anonymous.spec.ts drives the journey in the sync project.

Not in phase 1, on purpose: the install nudge (phase 2), the iPhone handoff manifest (phase 2), and reminders (phase 3).

## 8. Effort

| Phase | Days |
| --- | --- |
| 0 Measure | 0.5 |
| 1 Invite without account | 5 to 7 |
| 2 Install nudge and handoff | 2 to 3 |
| 3 Reminders | 6 to 9 |
| 4 Wizard and confetti | 4 to 6 |
| Total | 18 to 26 |
