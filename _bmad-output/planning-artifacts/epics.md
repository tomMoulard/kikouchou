---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - TODO.md
  - README.md
---

# Kikoushou - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Kikoushou, decomposing the requirements from the PRD, UX Design, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

**Trip Management**
- FR1: Organizer can create a trip with name, location, start date, and end date
- FR2: Organizer can edit trip details after creation
- FR3: Organizer can delete a trip and all associated data
- FR4: User can view a list of all their trips
- FR5: User can switch between trips

**Person Management**
- FR6: Organizer can add participants to a trip
- FR7: User can select themselves as an existing participant when accessing a shared trip
- FR8: User can edit participant details (name, color)
- FR9: User can remove a participant (cascading removal of assignments and transports)
- FR10: Each participant is visually distinguished by an assigned color

**Room Management**
- FR11: Organizer can add rooms with name, capacity, and description
- FR12: User can edit room details
- FR13: User can delete a room (cascading removal of assignments)
- FR14: User can reorder rooms
- FR15: User can view room availability for a given date range
- FR16: User can see which rooms have remaining capacity for specific dates

**Room Assignment**
- FR17: User can assign themselves (or another participant) to a room for a date range
- FR18: System enforces room capacity (first come, first served)
- FR19: User can modify an existing room assignment (change room or dates)
- FR20: User can remove a room assignment
- FR21: User can view all room assignments on a calendar
- FR22: System detects and prevents conflicting assignments (same person in two rooms for overlapping dates)

**Transport Tracking**
- FR23: User can add a transport event (arrival/departure) with datetime, location, mode, and number
- FR24: User can flag a transport as needing pickup
- FR25: User can assign themselves as driver for another participant's transport
- FR26: User can edit transport details
- FR27: User can delete a transport event
- FR28: User can view all transports separated by arrivals and departures
- FR29: User can view upcoming transports needing a driver
- FR30: User can view transports on the calendar alongside room assignments

**Calendar Visualization**
- FR31: User can view a calendar with room assignments as color-coded blocks per participant
- FR32: User can view transport events on the calendar
- FR33: User can navigate between time periods
- FR34: Calendar displays the full trip date range

**Trip Sharing**
- FR35: Organizer can generate a shareable link for a trip
- FR36: Organizer can generate a QR code for a trip
- FR37: User can copy the share link to clipboard
- FR38: Anyone with the shared link can access the trip with full read/write capability
- FR39: Shared link access requires no account creation or login

**Offline & Data**
- FR40: App is fully functional after first load without network connectivity
- FR41: Data is stored locally on the user's device
- FR42: App can be installed as a PWA

**Internationalization**
- FR43: User can switch language between French and English
- FR44: Language preference persists across sessions
- FR45: App detects browser language on first visit and defaults accordingly

**Maps**
- FR46: User can view transport locations on a map

### NonFunctional Requirements

**Performance**
- NFR1: First Contentful Paint < 1.5s on fast 3G
- NFR2: Time to Interactive < 2s on fast 3G
- NFR3: Lighthouse Performance score 95+
- NFR4: UI interactions < 200ms perceived response
- NFR5: Calendar rendering smooth with 15+ participants, 20+ assignments
- NFR6: Bundle size tracked per build, no regressions
- NFR7: Offline load time < 1s from PWA cache

**Accessibility**
- NFR8: Lighthouse Accessibility score 95+
- NFR9: WCAG 2.1 AA best effort (semantic HTML, keyboard nav, ARIA)
- NFR10: Color contrast 4.5:1 minimum
- NFR11: No color-only information encoding (calendar needs secondary indicators)
- NFR12: Respect prefers-reduced-motion
- NFR13: Touch targets minimum 44x44px
- NFR14: Visible focus indicators for keyboard navigation

**Offline & Reliability**
- NFR15: 100% read + write to local data when offline
- NFR16: Zero data loss on close/restart/network loss
- NFR17: Meets all PWA install criteria
- NFR18: Service worker auto-update with notification
- NFR19: Lighthouse PWA score 95+

**Security**
- NFR20: Trip accessible only via UUID in share link
- NFR21: No passwords, payment info, or PII beyond names
- NFR22: HTTPS only

**Code Quality**
- NFR23: TypeScript zero errors (strict mode)
- NFR24: Zero ESLint warnings/errors
- NFR25: 80%+ line test coverage
- NFR26: Lighthouse Best Practices score 95+

### Additional Requirements

**From Architecture:**
- AR-1: Starter template is NOT applicable — brownfield project. First implementation story should focus on UX polish per PRD finalization priorities.
- AR-2: Remove `@tanstack/react-query` dependency (unused, creates confusion) [AI-1]
- AR-3: Deprecate non-ownership-checking repository variants; all context CRUD must use `*WithOwnershipCheck` [AI-2]
- AR-4: Extract shared `useFormSubmission()` hook from repeated form patterns [AI-3]
- AR-5: Align vitest coverage threshold to 80% (matching PRD target NFR25) [AI-4]
- AR-6: Add calendar rendering performance test (15 persons, 20+ assignments) [AI-5]
- AR-7: Add cascade delete partial-failure integration tests [AI-6]
- AR-8: Add CI chunk size check (500KB threshold per JS chunk) [AI-7]
- AR-9: Context Provider nesting order is load-bearing and MUST NOT change (Trip → Room → Person → Assignment → Transport)
- AR-10: Share route `/share/:shareId` operates OUTSIDE `AppProviders` — no context hooks allowed
- AR-11: Components NEVER call Dexie directly — always through context hooks
- AR-12: Forms use inline validation, NOT Zod (Zod is for repository/test layer only)
- AR-13: All user-facing strings MUST use i18n (toast, labels, errors, empty states)
- AR-14: All lazy routes MUST be wrapped in `<ErrorBoundary><Suspense>`
- AR-15: Use branded types for all entity IDs, dates, and colors
- AR-16: Guest onboarding wizard architecture needed (new components in `features/sharing/` or new `features/onboarding/`)

**From UX Design:**
- UX-1: Guest Onboarding Wizard (highest priority) — 5-step guided flow for first-time shared link access: welcome, identity selection, room selection, transport entry, summary. Target: under 2 minutes.
- UX-2: Trip Dashboard as post-wizard landing — single screen answering: who's here today, who's arriving next, unassigned pickups, your room and transport at a glance
- UX-3: Smart Room Assignment Flow — surface "available rooms for your dates" with visual capacity indicators and one-tap self-assign
- UX-4: Progressive Disclosure for dual information architecture — guests get wizard then dashboard; organizers get dashboard with management affordances; reduce mobile bottom nav from 6 tabs to 2-3 contextual views
- UX-5: Visual Warmth and Trust — move beyond generic component library styling; warmer colors, purposeful whitespace, inviting empty states, vacation-appropriate personality
- UX-6: Pickup coordination visibility — unassigned pickups surfaced as actionable alerts, not buried in transport list
- UX-7: Accidental edit protection — destructive actions need clear visual distinction and consistent confirmation patterns
- UX-8: Offline state confidence indicators — clear, non-intrusive feedback that edits are saved locally

**From TODO.md (Remaining Tasks):**
- TODO-1: REVIEW-MIN-1,3,4 — Minor code style improvements (low priority)
- TODO-2: REVIEW-CQ-1,2,3 — Code quality considerations (low priority)
- TODO-3: REVIEW-PERF-3 — Context re-render performance monitoring
- TODO-4: REVIEW-SEC-2 — ShareId predictability concern

### FR Coverage Map

| FR | Epic | Focus |
|----|------|-------|
| FR1 | Epic 1 | Trip creation polish |
| FR2 | Epic 1 | Trip editing polish |
| FR3 | Epic 1 | Trip deletion polish (cascade tests) |
| FR4 | Epic 1 + 4 | Trip list polish + organizer dashboard |
| FR5 | Epic 1 | Trip switching polish |
| FR6 | Epic 1 | Add participants polish |
| FR7 | Epic 2 | Identity selection in onboarding wizard |
| FR8 | Epic 1 | Edit participant polish |
| FR9 | Epic 1 | Remove participant polish |
| FR10 | Epic 1 | Color coding polish |
| FR11 | Epic 1 | Add rooms polish |
| FR12 | Epic 1 | Edit rooms polish |
| FR13 | Epic 1 | Delete rooms polish |
| FR14 | Epic 1 | Reorder rooms polish |
| FR15 | Epic 1 + 4 | Room availability + organizer alerts |
| FR16 | Epic 1 + 4 | Remaining capacity + organizer alerts |
| FR17 | Epic 1 | Room self-assignment polish |
| FR18 | Epic 1 | Capacity enforcement polish |
| FR19 | Epic 1 | Modify assignment polish |
| FR20 | Epic 1 | Remove assignment polish |
| FR21 | Epic 1 | Calendar assignments polish |
| FR22 | Epic 1 | Conflict detection polish |
| FR23 | Epic 1 | Add transport polish |
| FR24 | Epic 1 | Flag pickup polish |
| FR25 | Epic 1 | Driver self-assignment polish |
| FR26 | Epic 1 | Edit transport polish |
| FR27 | Epic 1 | Delete transport polish |
| FR28 | Epic 1 | Arrivals/departures view polish |
| FR29 | Epic 1 + 4 | Upcoming pickups + organizer alerts |
| FR30 | Epic 1 | Transport on calendar polish |
| FR31 | Epic 1 | Calendar color blocks polish |
| FR32 | Epic 1 | Calendar transport events polish |
| FR33 | Epic 1 | Calendar navigation polish |
| FR34 | Epic 1 | Full trip range polish |
| FR35 | Epic 1 | Share link polish |
| FR36 | Epic 1 | QR code polish |
| FR37 | Epic 1 | Copy link polish |
| FR38 | Epic 1 + 2 | Shared link access + onboarding |
| FR39 | Epic 1 + 2 | No account required + onboarding |
| FR40 | Epic 1 | Offline functionality polish |
| FR41 | Epic 1 | Local data storage polish |
| FR42 | Epic 1 | PWA installable polish |
| FR43 | Epic 1 | Language switch polish |
| FR44 | Epic 1 | Language persistence polish |
| FR45 | Epic 1 | Browser language detection polish |
| FR46 | Epic 1 | Transport map polish |

## Epic List

### Epic 1: UX Polish & Friction Reduction
Users experience a polished, frictionless interface across all existing features — trip management, room setup, room assignment, transport tracking, calendar, sharing, offline, and i18n — with improved empty states, mobile usability, visual warmth, and accidental edit protection.
**FRs covered:** FR1-FR6, FR8-FR46 (all existing functionality, polish focus)
**Additional Requirements:** AR-2, AR-3, AR-4, AR-7, AR-8, AR-11-15, UX-3, UX-5, UX-6, UX-7, UX-8, TODO-1, TODO-2, TODO-3, TODO-4

### Epic 2: Guest Onboarding Experience
First-time guests arriving via shared link get a guided 5-step wizard (welcome, identity selection, room selection, transport entry, summary) and land on a trip dashboard, achieving self-service setup in under 2 minutes.
**FRs covered:** FR7 (enhanced), FR38, FR39
**Additional Requirements:** UX-1, UX-2, UX-4, AR-10, AR-16

### Epic 3: Quality & Performance Gates
The app achieves all Lighthouse targets (95+ across 4 categories), accessibility compliance, performance budgets, test coverage at 80%+, and CI enforcement of bundle size limits.
**FRs covered:** None directly (enables all)
**Additional Requirements:** NFR1-NFR26, AR-5, AR-6, AR-8

### Epic 4: Organizer Dashboard & Management Alerts
Organizers see a management dashboard showing trip health — unassigned rooms, missing transport details, unassigned pickups — enabling proactive coordination without being the bottleneck.
**FRs covered:** Extends FR4, FR15, FR16, FR29
**Additional Requirements:** UX-2 (organizer view), UX-4 (management affordances)

---

## Epic 1: UX Polish & Friction Reduction

Users experience a polished, frictionless interface across all existing features — trip management, room setup, room assignment, transport tracking, calendar, sharing, offline, and i18n — with improved empty states, mobile usability, visual warmth, and accidental edit protection.

### Story 1.1: Remove Unused Dependencies and Align Code Patterns

As a **developer**,
I want unused dependencies removed and shared patterns extracted,
So that the codebase is clean, consistent, and ready for UX work.

**Acceptance Criteria:**

**Given** the project has `@tanstack/react-query` as a dependency
**When** I remove the package and all references
**Then** the build passes with zero errors and no runtime references to react-query remain

**Given** multiple form components duplicate the submit/guard/error pattern
**When** I extract a shared `useFormSubmission()` hook in `src/hooks/`
**Then** all existing form components use the hook and the duplicated pattern is eliminated

**Given** some repository functions lack ownership validation
**When** I audit all context-level CRUD calls
**Then** all context CRUD uses `*WithOwnershipCheck` variants and non-checking variants are marked `@deprecated`

**Given** the vitest coverage threshold is set below 80%
**When** I update `vitest.config.ts`
**Then** the coverage threshold is set to 80% and CI enforces it

### Story 1.2: Visual Warmth and Empty State Improvements

As a **user**,
I want the app to feel warm, inviting, and vacation-appropriate,
So that I trust it and enjoy using it instead of texting the organizer.

**Acceptance Criteria:**

**Given** empty state components use generic messaging
**When** I update all empty states across trips, rooms, persons, transports
**Then** each empty state has inviting, action-oriented copy (e.g., "This room has 2 spots open - claim yours!") and uses i18n keys

**Given** the app uses default shadcn/ui styling
**When** I apply warmer color accents, purposeful whitespace, and vacation-appropriate personality to shared components
**Then** the visual design feels like a vacation planning tool, not an enterprise app, while maintaining accessibility contrast ratios (NFR10: 4.5:1)

**Given** the color palette is only functional
**When** I review and update the Tailwind theme CSS variables
**Then** the theme conveys warmth while preserving dark/light mode support

### Story 1.3: Mobile UX Friction Audit and Fixes

As a **guest on mobile**,
I want every interaction to feel smooth and finger-friendly,
So that I can self-serve my trip details without frustration.

**Acceptance Criteria:**

**Given** some touch targets may be smaller than 44x44px (NFR13)
**When** I audit all interactive elements on mobile viewport
**Then** all buttons, links, and tappable areas meet the 44x44px minimum

**Given** the bottom navigation has 6 tabs
**When** I evaluate navigation for mobile guests
**Then** navigation is streamlined for mobile with the most relevant views prioritized and all labels use i18n

**Given** forms may be difficult to use on mobile
**When** I review all form inputs on a mobile viewport
**Then** inputs use appropriate mobile keyboard types (`inputMode`), have adequate spacing, and labels are clearly associated

**Given** dialogs may not display well on small screens
**When** I test all dialogs on mobile viewport (< 768px)
**Then** dialogs are responsive, scrollable when content overflows, and dismissable

### Story 1.4: Smart Room Assignment Flow

As a **guest**,
I want to see which rooms have available capacity for my dates and self-assign with one tap,
So that I can pick my room without asking the organizer.

**Acceptance Criteria:**

**Given** the room list page shows rooms with raw capacity numbers
**When** I redesign the room availability display
**Then** each room shows a clear visual capacity indicator (e.g., progress bar, "2 of 4 spots taken") for the selected date range

**Given** a guest wants to self-assign to a room
**When** they view available rooms for their dates
**Then** rooms with remaining capacity show a prominent "Claim this room" action button

**Given** a guest taps "Claim this room"
**When** the assignment is created
**Then** the system enforces capacity (FR18), detects conflicts (FR22), shows a success toast, and the room's availability indicator updates immediately

**Given** a guest tries to assign to a full room
**When** capacity is exceeded
**Then** a clear, friendly message explains the room is full and suggests alternatives

### Story 1.5: Pickup Coordination Visibility

As a **driver**,
I want unassigned pickups surfaced as prominent, actionable alerts,
So that I can quickly see who needs a ride and volunteer.

**Acceptance Criteria:**

**Given** there are transports with `needsPickup: true` and no `driverId`
**When** I view the transport list or dashboard
**Then** unassigned pickups are displayed as prominent alert cards (not buried in a table) with person name, station, time, and a "Volunteer to drive" button

**Given** multiple unassigned pickups exist at the same station within a time window
**When** I view the pickup alerts
**Then** nearby pickups are grouped or flagged so drivers can plan combined trips

**Given** I tap "Volunteer to drive"
**When** I assign myself as driver (FR25)
**Then** the alert updates to show me as the assigned driver, a success toast appears, and the pickup is removed from the unassigned list

### Story 1.6: Accidental Edit Protection

As a **user with shared link access**,
I want destructive actions to require confirmation,
So that I don't accidentally delete or overwrite someone else's data.

**Acceptance Criteria:**

**Given** any destructive action (delete trip, delete room, delete person, delete transport, remove assignment)
**When** the user initiates it
**Then** a `ConfirmDialog` appears with a clear description of what will be lost, using the `destructive` variant

**Given** the user is editing an entity (trip, room, person, transport)
**When** they have unsaved changes and try to navigate away
**Then** a confirmation prompt warns about losing unsaved changes

**Given** all confirmation dialogs
**When** they are displayed
**Then** they use i18n for all text, have accessible focus management, and the destructive action button is visually distinct (red/danger styling)

### Story 1.7: Offline State Confidence Indicators

As a **user at a rural vacation house with spotty connectivity**,
I want clear feedback that my edits are saved locally,
So that I trust the app works even without internet.

**Acceptance Criteria:**

**Given** the device has no network connectivity
**When** the user opens the app (after first load)
**Then** a non-intrusive offline indicator is visible (not blocking UI) and all features remain fully functional (NFR15)

**Given** the user creates or edits data while offline
**When** the IndexedDB write completes
**Then** a brief, reassuring confirmation appears (e.g., "Saved locally") distinct from the online success toast

**Given** the device transitions between online and offline
**When** connectivity changes
**Then** the offline indicator updates within 2 seconds and the transition is smooth (no flash or jarring UI change)

**Given** `prefers-reduced-motion` is enabled
**When** the offline indicator animates
**Then** animations are suppressed per NFR12

### Story 1.8: Code Review Cleanup and Remaining TODO Items

As a **developer**,
I want all documented review findings and minor issues resolved,
So that the codebase is clean before real-world validation.

**Acceptance Criteria:**

**Given** REVIEW-MIN-1,3,4 (minor code style improvements)
**When** I address each finding
**Then** the code style issues are resolved and ESLint passes with zero warnings (NFR24)

**Given** REVIEW-CQ-1,2,3 (code quality considerations)
**When** I address each finding
**Then** the code quality improvements are applied

**Given** REVIEW-PERF-3 (context re-render performance)
**When** I investigate the concern
**Then** re-render behavior is documented or optimized as needed

**Given** REVIEW-SEC-2 (ShareId predictability)
**When** I assess the risk
**Then** the finding is either mitigated or documented as accepted risk with rationale

---

## Epic 2: Guest Onboarding Experience

First-time guests arriving via shared link get a guided 5-step wizard (welcome, identity selection, room selection, transport entry, summary) and land on a trip dashboard, achieving self-service setup in under 2 minutes.

### Story 2.1: Share Link Landing and Welcome Screen

As a **guest opening a shared link**,
I want to see a warm welcome screen with the trip name, dates, and location,
So that I know I'm in the right place and feel invited to participate.

**Acceptance Criteria:**

**Given** a guest navigates to `/share/:shareId` for a valid trip
**When** the page loads
**Then** a welcome screen displays the trip name, location, date range, and a "Get Started" button — using repository functions directly (AR-10), not context hooks

**Given** the share link has an invalid or unknown `shareId`
**When** the page loads
**Then** a friendly error message is shown ("This trip link doesn't seem to work") with no technical jargon

**Given** the guest has visited this trip before (returning visit)
**When** the page loads
**Then** the wizard is skipped and the guest is redirected to the trip dashboard directly

**Given** any screen in the wizard
**When** it is rendered
**Then** all text uses i18n keys (FR/EN) and the design matches the visual warmth established in Epic 1

### Story 2.2: Identity Selection Step

As a **guest**,
I want to select myself from the participant list or add myself,
So that the app knows who I am for room and transport assignments.

**Acceptance Criteria:**

**Given** the guest proceeds from the welcome screen
**When** the identity step loads
**Then** all trip participants are displayed as selectable cards with name and color, fetched via `getPersonsByTripId()` (direct repository call)

**Given** the guest finds their name in the list
**When** they tap their name
**Then** they are selected as the active participant and the selection is visually confirmed

**Given** the guest is not yet in the participant list
**When** they tap "I'm not on the list" / "Add myself"
**Then** a compact inline form appears for name entry, a color is auto-assigned, and `createPerson()` is called directly

**Given** the guest has selected their identity
**When** they tap "Next"
**Then** their identity is stored locally (localStorage or IndexedDB settings) for returning visit detection (Story 2.1 skip logic)

### Story 2.3: Room Selection Step

As a **guest**,
I want to see available rooms for my dates and claim one with a single tap,
So that I have a room reserved without needing to ask anyone.

**Acceptance Criteria:**

**Given** the guest proceeds from the identity step
**When** the room selection step loads
**Then** all rooms are displayed with their name, capacity, current occupancy for the trip dates, and a visual availability indicator — fetched via `getRoomsByTripId()` and `getAssignmentsByTripId()` directly

**Given** a room has remaining capacity
**When** it is displayed
**Then** it shows a prominent "Claim this room" button and a clear capacity indicator (e.g., "2 of 4 spots taken")

**Given** a room is at full capacity
**When** it is displayed
**Then** the room is visually dimmed, the button is disabled, and it shows "Full"

**Given** the guest taps "Claim this room"
**When** the assignment is created via `createAssignment()` directly
**Then** the room's availability updates, a success confirmation appears, and the guest can proceed to the next step

**Given** the guest wants to skip room selection
**When** they tap "Skip for now"
**Then** they proceed to the transport step without an assignment (room can be chosen later from the main app)

### Story 2.4: Transport Entry Step

As a **guest**,
I want to enter my arrival and departure details,
So that the group knows when I'm coming and whether I need a pickup.

**Acceptance Criteria:**

**Given** the guest proceeds from the room selection step
**When** the transport entry step loads
**Then** a compact form is displayed with fields: type (arrival/departure toggle), date and time, station/location, transport mode, transport number (optional), and a "Need pickup?" toggle

**Given** the guest fills in their arrival details
**When** they toggle "Need pickup?" on and submit
**Then** a transport record is created via `createTransport()` directly with `needsPickup: true`

**Given** the guest wants to add both arrival and departure
**When** they submit the first transport
**Then** the form resets with the opposite type pre-selected (if arrival was entered, departure is suggested) and an "Add another" option is visible

**Given** the guest wants to skip transport entry
**When** they tap "Skip for now"
**Then** they proceed to the summary step without transport records (can be added later)

**Given** all form inputs
**When** they are displayed on mobile
**Then** appropriate `inputMode` attributes are used (numeric for time, text for location) and touch targets meet 44x44px minimum

### Story 2.5: Summary and Trip Entry

As a **guest**,
I want to see a summary of everything I've set up and enter the trip,
So that I'm confident everything is correct before I start using the app.

**Acceptance Criteria:**

**Given** the guest completes (or skips) all wizard steps
**When** the summary step loads
**Then** it displays: identity (name + color), room assignment (or "Not yet assigned"), and transport details (or "None added") in a clear, scannable layout

**Given** the guest wants to change something
**When** they tap on any summary section (identity, room, transport)
**Then** they are taken back to that specific wizard step to make changes

**Given** the guest is satisfied with the summary
**When** they tap "Enter trip" / "Let's go!"
**Then** the current trip is set via `setCurrentTrip()`, the app navigates to `/trips/:tripId/calendar` (inside the context boundary), and the wizard is marked as completed for this shareId

**Given** the guest completes the wizard
**When** the total elapsed time is measured
**Then** the wizard flow should be achievable in under 2 minutes (UX-1 target) with no more than 5 taps for the happy path

### Story 2.6: Trip Dashboard for Returning Guests

As a **returning guest**,
I want to land on a dashboard showing my room, upcoming transports, and trip activity,
So that I can see everything I need at a glance without navigating multiple pages.

**Acceptance Criteria:**

**Given** a returning guest navigates to the trip (via share link or direct URL)
**When** the dashboard loads
**Then** it displays: "Your room" section (current assignment or prompt to pick one), "Your transports" section (upcoming arrival/departure), and "Trip activity" section (who's here today, who's arriving next)

**Given** the guest has unassigned pickups visible
**When** the dashboard loads
**Then** unassigned pickups needing a driver are surfaced as actionable alerts (consistent with Story 1.5)

**Given** the guest has no room assigned
**When** the dashboard loads
**Then** a prominent call-to-action "Pick your room" links to the room selection flow

**Given** the dashboard is viewed on mobile
**When** rendered on viewport < 768px
**Then** sections stack vertically with clear visual hierarchy, and the most time-sensitive information (next transport, today's activity) appears first

---

## Epic 3: Quality & Performance Gates

The app achieves all Lighthouse targets (95+ across 4 categories), accessibility compliance, performance budgets, test coverage at 80%+, and CI enforcement of bundle size limits.

### Story 3.1: Lighthouse Performance Optimization

As a **user on a mobile device with limited connectivity**,
I want the app to load fast and feel responsive,
So that I can access trip information even on slow networks.

**Acceptance Criteria:**

**Given** the production build is deployed
**When** a Lighthouse performance audit is run on mobile (fast 3G)
**Then** the Performance score is 95+ (NFR3)

**Given** a first-time visitor loads the app
**When** measured on fast 3G
**Then** First Contentful Paint is < 1.5s (NFR1) and Time to Interactive is < 2s (NFR2)

**Given** the app is loaded from PWA cache (returning user, offline)
**When** the load time is measured
**Then** the app loads in < 1s (NFR7)

**Given** a user taps a button, opens a dialog, or submits a form
**When** the interaction is measured
**Then** perceived response is < 200ms (NFR4)

**Given** the production build outputs JS chunks
**When** chunk sizes are measured
**Then** no single chunk exceeds 500KB (AR-8) and total bundle size does not regress from the current baseline

### Story 3.2: Accessibility Compliance

As a **user with accessibility needs**,
I want the app to follow WCAG 2.1 AA best practices,
So that I can use it regardless of ability or input method.

**Acceptance Criteria:**

**Given** the production build is deployed
**When** a Lighthouse accessibility audit is run
**Then** the Accessibility score is 95+ (NFR8)

**Given** all color-coded elements (calendar blocks, person badges)
**When** they are displayed
**Then** information is not conveyed by color alone — secondary indicators (name text, pattern, icon) are present (NFR11)

**Given** all color combinations in the UI
**When** contrast is measured
**Then** text-to-background contrast meets 4.5:1 minimum (NFR10)

**Given** a keyboard-only user navigates the app
**When** they tab through interactive elements
**Then** all elements have visible focus indicators (NFR14) and the tab order is logical

**Given** the user has `prefers-reduced-motion` enabled
**When** any animation or transition occurs
**Then** it is suppressed or simplified (NFR12)

**Given** critical user flows (share link landing, room assignment, transport entry)
**When** tested with `@axe-core/playwright` in E2E
**Then** zero critical or serious accessibility violations are reported

### Story 3.3: Calendar Rendering Performance

As a **user viewing a trip with many participants**,
I want the calendar to render smoothly,
So that I can browse room assignments without lag or stutter.

**Acceptance Criteria:**

**Given** a trip with 15 persons and 20+ room assignments (NFR5)
**When** the CalendarPage renders
**Then** initial render completes in < 500ms (AR-6)

**Given** a trip with 15 persons and 20+ room assignments
**When** the calendar re-renders (e.g., navigating to a different week)
**Then** re-render completes in < 100ms (AR-6)

**Given** a performance test exists in the test suite
**When** `bun run test` is executed
**Then** the calendar rendering benchmark runs as a regression guard and fails if thresholds are exceeded

**Given** the calendar displays transport events alongside room assignments
**When** both are rendered simultaneously
**Then** no perceptible frame drops or jank occur on a mid-range mobile device

### Story 3.4: Test Coverage and CI Quality Gates

As a **developer**,
I want the CI pipeline to enforce quality gates automatically,
So that regressions are caught before they reach production.

**Acceptance Criteria:**

**Given** the vitest coverage threshold is set to 80% (AR-5)
**When** `bun run test:coverage` is executed
**Then** the pipeline fails if line coverage drops below 80% (NFR25)

**Given** cascade delete operations (trip, room, person)
**When** partial-failure integration tests are run (AR-7)
**Then** tests cover: (a) full transaction success, (b) mid-transaction IndexedDB error (mock Dexie to throw after partial delete), (c) verification that rollback leaves data consistent

**Given** the CI build step produces JS chunks in `dist/assets/`
**When** chunk sizes are checked (AR-8)
**Then** a warning is emitted if any chunk exceeds 500KB

**Given** TypeScript strict mode is enabled
**When** `tsc --noEmit` is run in CI
**Then** zero TypeScript errors are reported (NFR23)

**Given** ESLint is configured
**When** `eslint .` is run in CI
**Then** zero warnings and zero errors are reported (NFR24)

### Story 3.5: PWA and Best Practices Audit

As a **user**,
I want the app to meet all PWA install criteria and Lighthouse best practices,
So that I can install it on my home screen and trust its quality.

**Acceptance Criteria:**

**Given** the production build is deployed
**When** a Lighthouse PWA audit is run
**Then** the PWA score is 95+ (NFR19)

**Given** the production build is deployed
**When** a Lighthouse Best Practices audit is run
**Then** the Best Practices score is 95+ (NFR26)

**Given** the service worker is registered with `autoUpdate` strategy
**When** a new version is deployed
**Then** the user is notified of the update and the app updates on next load (NFR18)

**Given** the app manifest and service worker
**When** the PWA install criteria are checked
**Then** the app is installable on Chrome (mobile + desktop) and Safari (mobile) (NFR17)

**Given** data is written to IndexedDB
**When** the app is closed, restarted, or loses network
**Then** zero data loss occurs (NFR16)

---

## Epic 4: Organizer Dashboard & Management Alerts

Organizers see a management dashboard showing trip health — unassigned rooms, missing transport details, unassigned pickups — enabling proactive coordination without being the bottleneck.

### Story 4.1: Trip Health Overview

As an **organizer**,
I want to see a single dashboard showing the overall health of my trip,
So that I can spot coordination gaps without checking each section individually.

**Acceptance Criteria:**

**Given** the organizer views the trip dashboard
**When** the dashboard loads
**Then** it displays a "Trip Health" summary section with counts: total participants, participants with room assignments, participants without room assignments, total transports, unassigned pickups

**Given** some participants have not picked a room
**When** the trip health section is displayed
**Then** an alert card shows "X guests haven't picked a room" with a link to the room management view

**Given** some transports have `needsPickup: true` and no `driverId`
**When** the trip health section is displayed
**Then** an alert card shows "X pickups need a driver" with a link to the transport view

**Given** all participants have rooms and all pickups have drivers
**When** the trip health section is displayed
**Then** a positive status message is shown (e.g., "Everything's set! Your trip is fully organized.")

**Given** the dashboard is viewed
**When** all text is rendered
**Then** all labels, alerts, and status messages use i18n keys (FR/EN)

### Story 4.2: Participant Readiness Tracker

As an **organizer**,
I want to see which participants have completed their setup and who still needs to act,
So that I can nudge specific friends if needed.

**Acceptance Criteria:**

**Given** the organizer views the participant readiness section
**When** the section loads
**Then** each participant is listed with status indicators: room assigned (yes/no), transport entered (yes/no), pickup needed and assigned (yes/no/n/a)

**Given** a participant has completed all setup (room + transport)
**When** they are displayed
**Then** they show a "Ready" visual indicator (e.g., checkmark, green badge)

**Given** a participant is missing room or transport details
**When** they are displayed
**Then** they show an "Action needed" visual indicator with the specific missing items listed

**Given** the organizer views this on mobile
**When** rendered on viewport < 768px
**Then** participants are displayed as compact cards with clear status badges, sorted with "action needed" participants first

### Story 4.3: Upcoming Activity Timeline

As an **organizer**,
I want to see an upcoming timeline of arrivals, departures, and pickups,
So that I can plan ahead and ensure nothing is missed.

**Acceptance Criteria:**

**Given** the organizer views the upcoming activity section
**When** the section loads
**Then** a chronological timeline shows the next 7 days of transport events with: person name, type (arrival/departure), datetime, location, driver (if assigned), and pickup status

**Given** an upcoming transport has no assigned driver and needs pickup
**When** it is displayed on the timeline
**Then** it is visually highlighted as urgent with a "Needs driver" label

**Given** multiple transports occur on the same day
**When** the timeline is displayed
**Then** they are grouped by day with clear date headers and sorted by time within each day

**Given** there are no upcoming transports in the next 7 days
**When** the section loads
**Then** a friendly empty state message is shown (e.g., "No arrivals or departures in the next week")

**Given** the organizer taps on a transport event in the timeline
**When** the event is tapped
**Then** a detail view or edit dialog opens for that transport

### Story 4.4: Dashboard Navigation and Progressive Disclosure

As a **user (organizer or guest)**,
I want the dashboard to adapt to my role,
So that I see what's relevant to me without clutter.

**Acceptance Criteria:**

**Given** a guest accesses the trip (via shared link, returning)
**When** the dashboard loads
**Then** the guest sees: their personal section (my room, my transports), trip activity (who's here, who's arriving), and unassigned pickup alerts — but NOT the organizer management sections (trip health, participant readiness)

**Given** the organizer accesses the trip (identified as the trip creator or by local settings)
**When** the dashboard loads
**Then** the organizer sees all guest sections PLUS: trip health overview (Story 4.1), participant readiness tracker (Story 4.2), and upcoming activity timeline (Story 4.3)

**Given** the mobile bottom navigation currently has multiple tabs
**When** the dashboard is the primary landing page
**Then** navigation is restructured to prioritize: Dashboard (home), Calendar, and a "More" menu for Rooms/Persons/Transports/Settings — reducing tabs from 6 to 3 contextual views (UX-4)

**Given** any dashboard section
**When** the user taps on a summary card
**Then** they are navigated to the relevant detail view (rooms, transports, persons) for deeper management
