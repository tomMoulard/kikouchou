# Kikouchou

> A PWA application to help you organize your vacation house rooms and arrivals/departures.

**Live**: <https://app.kikouchou.app> — deployed to GitHub Pages by
[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) on every push to `main`.

**Pitch**: You're on vacation with friends and renting a house together. Kikouchou helps you assign rooms and never forget to pick up or drop off your friends at the train station.

## Features (MVP)

- **Calendar View** - Visualize who sleeps where and when
- **Room Management** - Manage rooms with capacity and assignments
- **Guest Groups** - Save a family or a band of friends once, add them to any trip in one go
- **Transport Tracking** - Track arrivals/departures with detailed transport info
- **Trip Sharing** - Share trips via links and QR codes
- **Offline-First** - Works without internet after first load
- **Multi-language** - French and English support

## User flows

How people get into a trip, and what they do once they are there. Everything
works without an account and offline. You sign in only to share a trip with
other people.

```mermaid
flowchart TD
    NEW["Someone new opens the app"] --> EMPTY["Empty trip list"]
    EMPTY --> CREATE["Create a trip"]
    CREATE --> TRIP["The trip calendar"]

    BACK["Someone who has been here before"] --> LIST["Their trip list"]
    LIST --> TRIP

    ICON["Someone taps the installed app icon"] --> LIST
    NOTIF["Someone taps a notification"] --> TRIP

    INVITE["Someone clicks an invite link"] --> WHO["Which one are you?"]
    INVITE -.->|"link dead or used up"| ASK["Ask for a fresh link"]
    WHO --> TRIP

    STABLE["Someone clicks a trip link"] --> HAVEIT{"Do they already have the trip?"}
    STABLE -.->|"link dead or used up"| ASK
    HAVEIT -->|"yes"| TRIP
    HAVEIT -->|"no, and signed in"| TRIP
    HAVEIT -->|"no, and signed out"| SIGNIN["Sign in, or use an invite instead"]
    SIGNIN --> TRIP

    TEMPLATE["Someone clicks a hotel's template link"] --> THREE["Name, dates, who is coming"]
    THREE --> TRIP

    QR["Someone scans a trip QR from another phone"] --> HAVEIT

    TRIP --> PLAN["Plan it: rooms, guests, transport, activities, money"]
    TRIP --> SHARE["Share it"]
    SHARE --> ACCOUNT{"Signed in?"}
    ACCOUNT -->|"no"| OFFER["Offered an account, or share by QR"]
    ACCOUNT -->|"yes"| SLINK["Create a sharable link"]
    SLINK --> GUESTS["Guests join and see their own room and travel"]
    GUESTS --> WHO
    TRIP --> INSTALL["Offered the app on their home screen"]
    GUESTS --> OWN["Later nudged to plan a trip of their own"]
    TRIP --> END["Archive it when it is over"]
```

## Tech Stack

| Category   | Technology               |
|------------|--------------------------|
| Runtime    | Bun                      |
| Build Tool | Vite                     |
| Framework  | React 18 + TypeScript    |
| UI Library | shadcn/ui + Tailwind CSS |
| Database   | IndexedDB (Dexie.js)     |
| i18n       | react-i18next            |

## Documentation

- [IDEAS.md](./IDEAS.md) - Original project ideas and brainstorming
- [TODO.md](./TODO.md) - Comprehensive step-by-step implementation guide

## Getting Started

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Build for production
bun run build
```

## Store apps

The same app ships to the App Store, Google Play and F-Droid, from this
repository. The iOS and Android projects are Capacitor shells around the web
build (`ios/`, `android/`). See `plans/2026-09-26-native-apps-v1.md` for the
design, and the "Store apps" section of `AGENTS.md` for the rules.

```bash
bun run build:native      # Build the web app and copy it into both shells
bunx cap open ios         # Open the iOS project in Xcode
bunx cap open android     # Open the Android project in Android Studio
```

A `v*` tag builds, signs and publishes both apps (`.github/workflows/native.yml`)
and attaches the APK and the IPA to a GitHub release. F-Droid users can add
`https://app.kikouchou.app/fdroid/repo`.
[`docs/releasing-the-store-apps.md`](docs/releasing-the-store-apps.md) is the
step-by-step runbook for the first release and every one after it.

## License

MIT, see [LICENSE](LICENSE).
