---
stepsCompleted:
  - step-01-init
  - step-02-discovery
  - step-03-success
  - step-04-journeys
  - step-05-domain
  - step-06-innovation
  - step-07-project-type
  - step-08-scoping
  - step-09-functional
  - step-10-nonfunctional
  - step-11-polish
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-kikoushou-2026-02-06.md
  - _bmad-output/brainstorming/brainstorming-session-2026-02-06.md
  - README.md
  - TODO.md
documentCounts:
  briefs: 1
  research: 0
  brainstorming: 1
  projectDocs: 2
classification:
  projectType: web_app
  domain: general
  complexity: low
  projectContext: brownfield
workflowType: 'prd'
date: 2026-02-06
author: tom
---

# Product Requirements Document - Kikoushou

**Author:** tom
**Date:** 2026-02-06
**Status:** MVP code complete, finalizing quality

## Executive Summary

**Kikoushou** is a Progressive Web App that helps groups of friends organize vacation house stays. It solves a specific coordination problem: when friends rent a house together, one person (the organizer) becomes the bottleneck for questions about rooms, arrival times, and pickups.

**Core differentiator:** Kikoushou is collaborative, not hierarchical. The organizer creates the scaffolding (trip, rooms, participants); everyone with the shared link has equal editing power. Guests self-assign rooms, enter their own transport details, and volunteer for pickups. No accounts, no login, no permissions - the social context is the access control.

**Target users:** Groups of 5-15 friends renting vacation houses together. Primary persona is the organizer who sets up the trip; secondary personas are guests who self-serve and drivers who volunteer for pickups.

**Project context:** Brownfield. The MVP is functionally complete and deployed (19 development phases, 1074+ unit/integration tests, 178 E2E tests). This PRD defines what "finalized MVP" means: UX polish, performance targets, and quality gates before real-world validation with friend groups.

**Tech stack:** React 18 + TypeScript, Vite, shadcn/ui + Tailwind CSS, IndexedDB (Dexie.js), react-i18next, PWA via Workbox. No backend server.

## Success Criteria

### User Success

| Criteria | Target | Measurement |
|----------|--------|-------------|
| **Trip setup time** | Under 10 minutes from start to shareable link | Time from trip creation to first share action |
| **Guest self-service** | Guests access all info without asking the organizer | Reduction in coordination messages |
| **Organizer mental load** | Organizer stops being the "human FAQ" after sharing | Organizer satisfaction |
| **Repeat usage** | Organizers voluntarily create a second trip | Trips per organizer over time |
| **Offline reliability** | App works seamlessly at rural vacation houses | No errors or data loss when offline |

### Business Success

| Criteria | Target | Timeframe |
|----------|--------|-----------|
| **Active users** | 5 friends using it for real trips | First vacation season |
| **Real trips created** | At least 5 real trips organized | First 6 months |
| **Setup completion** | 100% of started trips get shared | Ongoing |
| **Organizer retention** | Organizers return for next vacation | Per vacation cycle |
| **Guest link usage** | Every guest opens the shared link at least once | Per trip |

### Technical Success

| Criteria | Target |
|----------|--------|
| **Lighthouse (all 4 categories)** | 95+ |
| **Test coverage** | 80%+ line coverage |
| **TypeScript** | 0 errors (strict mode) |
| **ESLint** | 0 warnings, 0 errors |
| **First Contentful Paint** | < 1.5s on fast 3G |
| **Time to Interactive** | < 2s on fast 3G |
| **Bundle size** | Tracked per build, no regressions |
| **Offline-first** | Full functionality after first load |

### Measurable Outcomes

- A real group of friends successfully organizes a vacation trip end-to-end using kikoushou
- The organizer shares the link once and doesn't need to answer logistics questions
- Guests check the shared link before arriving and know their room and transport details
- The app works reliably on mobile at a rural vacation house with intermittent connectivity

## User Journeys

### Journey 1: Marie the Organizer - Setting Up the Trip

**Opening Scene:** Marie just booked a vacation house in Brittany for two weeks with a rotating group of 8 friends. Her phone buzzes with WhatsApp messages: "Which room should I take?", "When does Pierre arrive?", "Can someone pick me up?". She's stressed and the trip is three weeks away.

**Rising Action:** Marie opens kikoushou and creates a new trip - "Summer 2026, Brittany". She adds the house's 4 rooms with their bed counts and descriptions, then adds the 8 friends to the trip. She doesn't assign anyone to rooms - that's for each person to do themselves.

**Climax:** Marie taps "Share", copies the link, and drops it in the WhatsApp group: "Here's the trip - pick your room, add your travel details, and flag if you need a pickup." She puts her phone down.

**Resolution:** Over the next few days, friends click the link and self-organize. They pick their rooms, enter their train times, and flag pickup needs. The calendar fills up with color-coded blocks without Marie lifting a finger. Marie set up the scaffolding; the group filled it in.

**Capabilities revealed:** Trip creation, room management, person management, calendar visualization, link sharing.

---

### Journey 2: Lucas the Guest - Self-Organizing His Stay

**Opening Scene:** Lucas gets a link in the group chat from Marie. He's joining for the second week only, arriving by train on Saturday. He doesn't want to install anything or create an account.

**Rising Action:** Lucas taps the link on his phone. The app loads instantly - no login, no signup. He selects himself as Lucas in the trip. He checks the rooms and sees which rooms have available capacity during his dates - "La chambre bleue" has one spot left. He assigns himself to that room, adds his transport details (TGV 8541, Gare de Vannes, 14:32), and toggles "needs pickup."

**Climax:** Lucas has self-organized his entire stay in under two minutes. Room reserved, train logged, pickup request visible to everyone. He didn't ask Marie anything.

**Resolution:** Two days before the trip, Lucas checks the link on spotty mobile data - the app works fine offline. He sees Sophie volunteered to pick him up. He arrives relaxed.

**Capabilities revealed:** Share link with full edit, room availability visibility, self-assignment (first come first served), transport self-entry, pickup flagging, offline PWA, no account required.

---

### Journey 3: Sophie the Driver - Volunteering for Pickup

**Opening Scene:** Sophie is already at the vacation house. She checks kikoushou to see who's arriving tomorrow. Lucas needs a pickup from Gare de Vannes at 14:32 but no driver is assigned.

**Rising Action:** Sophie assigns herself as the driver. She notices Camille arrives at 15:10 at the same station - she can do both pickups in one trip.

**Climax:** The transport view shows Sophie her two pickups tomorrow afternoon: station names, train numbers, and times in one place. No chat history scrolling needed.

**Resolution:** Sophie does both pickups smoothly. The next day, another friend volunteers for the evening pickup. Pickup coordination becomes self-organizing.

**Capabilities revealed:** Driver self-assignment, transport filtering by date/time, multi-pickup planning, self-organizing coordination.

---

### Journey 4: Mid-Trip Changes - Everyone Self-Serves

**Opening Scene:** Wednesday of the first week. Pierre's train is cancelled (arriving a day late). Camille wants to switch rooms (upstairs is too hot).

**Rising Action:** Pierre updates his own transport - new train, new time. He adjusts his room assignment start date. Camille and the downstairs room occupant agree to swap and each reassign themselves. No Marie involvement.

**Climax:** Marie checks the calendar and sees all updates reflected. Pierre's new pickup time is visible. Camille's room swap is done. Nobody asked Marie.

**Resolution:** The trip runs itself. Changes happen, but kikoushou absorbs them because everyone can edit their own details.

**Capabilities revealed:** Transport/room editing by any user, mutual room swaps, shared link always shows current state, conflict detection, self-organizing without coordinator bottleneck.

---

### Journey 5: Room Conflict - First Come, First Served

**Opening Scene:** Two weeks before the trip. Lucas and Antoine both want "La chambre bleue" for the same dates. One spot left.

**Rising Action:** Lucas assigns himself first. Antoine tries ten minutes later - the app shows the room is at full capacity.

**Climax:** Antoine checks other rooms, finds "La chambre verte" has space, and assigns himself there. Alternatively, he messages Lucas and they agree to swap.

**Resolution:** First come, first served established the baseline. Social negotiation handled the rest. Clear availability visibility enabled self-resolution.

**Capabilities revealed:** Room capacity enforcement, availability indicators, conflict visibility, social resolution via transparent data.

---

### Design Constraints

| Constraint | Description |
|-----------|-------------|
| **Collaborative editing** | Anyone with the shared link has full read/write access. No authentication or authorization. The organizer/guest distinction is social, not technical. |
| **Data integrity** | Accidental edits possible. Social context (friend groups) mitigates. Organizer can re-edit as recovery. |
| **Offline and sync** | Each device stores data locally (IndexedDB). No real-time sync between devices. Shared link is the coordination mechanism. |

### Journey-to-Capability Traceability

| Capability | Journeys |
|-----------|----------|
| Trip creation + structure | J1 |
| Room management + availability visibility | J1, J2, J4, J5 |
| Room self-assignment (first come first served) | J2, J5 |
| Room capacity enforcement | J5 |
| Person management | J1, J2 |
| Transport self-entry + editing | J2, J4 |
| Pickup request flagging | J2 |
| Driver self-assignment | J3 |
| Calendar visualization | J1, J2, J3 |
| Link/QR sharing (full access) | J1, J2 |
| Offline-first PWA | J2 |
| Mid-trip self-service editing | J4 |
| Conflict detection + social resolution | J4, J5 |
| Multi-language | All |

## Innovation & Novel Patterns

### Detected Innovation Areas

| Innovation | What It Challenges | Why It Matters |
|-----------|-------------------|----------------|
| **Zero-auth collaborative editing** | "Tools need accounts and permissions" | Removes adoption barrier, trusts social context |
| **Serverless collaboration** | "Shared data needs a backend" | Zero infrastructure, infinite scale, no cost |
| **Self-organizing groups** | "Someone must be in charge" | Eliminates coordinator bottleneck |
| **Offline-first by necessity** | "Apps need internet" | Works where it's needed most |

**Innovation philosophy:** Kikoushou innovates by subtraction, not addition. Each innovation removes something other tools add by default, and the removal IS the feature.

### Innovation Validation

| Innovation | Validation Question |
|-----------|-------------------|
| **Zero-auth** | Do guests use the link without friction? Does lack of auth cause problems? |
| **Serverless** | Does manual sync work for vacation coordination cadence? |
| **Self-organizing** | Does the group fill in their own details, or does the organizer still do it? |
| **Offline-first** | Does the app work reliably at rural vacation houses? |

### Innovation Risks

| Risk | Mitigation |
|------|-----------|
| Zero-auth leads to accidental edits | Social context mitigates; organizer can re-edit |
| Manual sync causes stale data | Coordination cadence is slow (days, not seconds) |
| Self-organizing doesn't happen | Organizer can assign on behalf of others as fallback |
| Offline data diverges between devices | Each device independent; shared link is source of truth when online |

## Web App (PWA) Technical Requirements

### Architecture

| Aspect | Decision |
|--------|----------|
| **Application type** | SPA with client-side routing (React Router) |
| **Rendering** | Client-side only. No SSR, no SSG. |
| **Data layer** | Local-first IndexedDB, no remote database |
| **Hosting** | Static file hosting only (no server required) |

### Browser Support

| Browser | Support Level |
|---------|--------------|
| **Chrome (mobile + desktop)** | Primary - latest 2 versions |
| **Safari (mobile)** | Primary - latest 2 versions (critical for iOS PWA) |
| **Firefox (mobile + desktop)** | Secondary - latest 2 versions |
| **Samsung Internet** | Secondary - latest version |
| **Edge** | Secondary - latest 2 versions |

PWA prerequisites: service worker support, IndexedDB support. No IE/legacy polyfills.

### Responsive Design

| Breakpoint | Priority | Usage Context |
|-----------|----------|---------------|
| **Mobile (< 768px)** | Primary | Guests checking shared link on phone |
| **Tablet (768px - 1024px)** | Secondary | Casual use |
| **Desktop (> 1024px)** | Secondary | Organizer setting up trip |

Mobile-first design. Most common use case: guest opening shared link on phone.

### SEO

**Main app:** No SEO needed. Private, accessed via direct links. `robots.txt` disallows crawling.
**Landing page:** Post-MVP consideration for discoverability.

### PWA Configuration

- Service worker with `autoUpdate` registration strategy
- Workbox for precaching static assets
- App manifest with icons (192x192, 512x512)
- Standalone display mode
- Offline fallback for all routes

## Project Scoping & Phased Development

### MVP Strategy

**Approach:** Experience MVP. Features exist; goal is polished, frictionless UX.
**Resources:** Solo developer, couple of weeks.
**Core principle:** A friend opens the shared link on their phone, understands immediately what to do, and never hits a UX wall.

### Finalization Priorities (Ordered by Impact)

| Priority | Category | Work | Rationale |
|----------|----------|------|-----------|
| **1** | UX Polish | Audit and fix mobile UX friction points | UX drawbacks kill early interest. Mobile is primary. |
| **2** | UX Polish | Room availability clarity for self-assignment | J2 & J5 depend on guests seeing available rooms instantly |
| **3** | UX Polish | Transport/pickup flow clarity | J3 depends on drivers understanding pickup needs at a glance |
| **4** | Quality | Achieve 95+ Lighthouse scores (all 4 categories) | Performance and accessibility impact mobile UX directly |
| **5** | Quality | Zero linting issues | Code hygiene for maintainability |
| **6** | Quality | 80%+ test coverage | Confidence for future changes |
| **7** | Quality | Bundle size audit and optimization | Faster loads on mobile/3G |
| **8** | Housekeeping | Address REVIEW-MIN, REVIEW-CQ, REVIEW-PERF, REVIEW-SEC | Clean up as encountered |

**Explicitly OUT of MVP:** New features, landing page, P2P sync, any scope expansion.

### Post-MVP Roadmap

**Phase 2 (Growth) - Triggered by real usage:**

| Feature | Trigger |
|---------|---------|
| Pickup reminders / notifications | Friends miss a pickup |
| Print support | Someone asks for fridge-printable schedule |
| E-ink display view | Personal itch or user request |
| Landing page | Want organic discovery |

**Phase 3 (Expansion) - Triggered by repeated use:**

| Feature | Trigger |
|---------|---------|
| P2P sync | Manual sync becomes pain point |
| Food / meal management | Users ask "can we plan meals?" |
| Task management | Users ask "who's doing shopping?" |
| Money management | Users ask "how do we split costs?" |
| New user segments | Interest from families, corporate groups |

**Philosophy:** No Phase 2/3 feature gets built until a real user asks for it or a real trip reveals the need.

### Risk Mitigation

**Technical:**

| Risk | Mitigation |
|------|-----------|
| Lighthouse 95+ hard to reach | Low-hanging fruit first. Accept 90+ if 95+ requires disproportionate effort. |
| Bundle size large | Audit dependencies, tree-shake, lazy-load routes. Track with CI. |
| Safari PWA quirks | Test on real iOS devices. |

**Market:**

| Risk | Mitigation |
|------|-----------|
| Friends don't adopt | First experience must be frictionless. Guest self-serve under 2 minutes or UX failed. |
| Shared link model confuses | Clear onboarding cues on first shared link access. |
| No one volunteers for driver duty | Make unassigned pickups visually prominent. |

**Resource:**

| Risk | Mitigation |
|------|-----------|
| Timeline too tight | UX polish first, Lighthouse second, coverage third. Ship when UX is solid. |
| Solo developer burnout | Timebox at 3 weeks. Ship what's ready. |

## Functional Requirements

### Trip Management

- **FR1:** Organizer can create a trip with name, location, start date, and end date
- **FR2:** Organizer can edit trip details after creation
- **FR3:** Organizer can delete a trip and all associated data
- **FR4:** User can view a list of all their trips
- **FR5:** User can switch between trips

### Person Management

- **FR6:** Organizer can add participants to a trip
- **FR7:** User can select themselves as an existing participant when accessing a shared trip
- **FR8:** User can edit participant details (name, color)
- **FR9:** User can remove a participant (cascading removal of assignments and transports)
- **FR10:** Each participant is visually distinguished by an assigned color

### Room Management

- **FR11:** Organizer can add rooms with name, capacity, and description
- **FR12:** User can edit room details
- **FR13:** User can delete a room (cascading removal of assignments)
- **FR14:** User can reorder rooms
- **FR15:** User can view room availability for a given date range
- **FR16:** User can see which rooms have remaining capacity for specific dates

### Room Assignment

- **FR17:** User can assign themselves (or another participant) to a room for a date range
- **FR18:** System enforces room capacity (first come, first served)
- **FR19:** User can modify an existing room assignment (change room or dates)
- **FR20:** User can remove a room assignment
- **FR21:** User can view all room assignments on a calendar
- **FR22:** System detects and prevents conflicting assignments (same person in two rooms for overlapping dates)

### Transport Tracking

- **FR23:** User can add a transport event (arrival/departure) with datetime, location, mode, and number
- **FR24:** User can flag a transport as needing pickup
- **FR25:** User can assign themselves as driver for another participant's transport
- **FR26:** User can edit transport details
- **FR27:** User can delete a transport event
- **FR28:** User can view all transports separated by arrivals and departures
- **FR29:** User can view upcoming transports needing a driver
- **FR30:** User can view transports on the calendar alongside room assignments

### Calendar Visualization

- **FR31:** User can view a calendar with room assignments as color-coded blocks per participant
- **FR32:** User can view transport events on the calendar
- **FR33:** User can navigate between time periods
- **FR34:** Calendar displays the full trip date range

### Trip Sharing

- **FR35:** Organizer can generate a shareable link for a trip
- **FR36:** Organizer can generate a QR code for a trip
- **FR37:** User can copy the share link to clipboard
- **FR38:** Anyone with the shared link can access the trip with full read/write capability
- **FR39:** Shared link access requires no account creation or login

### Offline & Data

- **FR40:** App is fully functional after first load without network connectivity
- **FR41:** Data is stored locally on the user's device
- **FR42:** App can be installed as a PWA

### Internationalization

- **FR43:** User can switch language between French and English
- **FR44:** Language preference persists across sessions
- **FR45:** App detects browser language on first visit and defaults accordingly

### Maps

- **FR46:** User can view transport locations on a map

## Non-Functional Requirements

### Performance

| ID | Requirement | Target | Rationale |
|----|-------------|--------|-----------|
| NFR1 | First Contentful Paint | < 1.5s on fast 3G | Guest opening shared link must see content immediately |
| NFR2 | Time to Interactive | < 2s on fast 3G | Guest must interact quickly |
| NFR3 | Lighthouse Performance | 95+ | Quality gate |
| NFR4 | UI interactions | < 200ms perceived response | Must feel instant on mobile |
| NFR5 | Calendar rendering | Smooth with 15+ participants, 20+ assignments | Most data-dense view |
| NFR6 | Bundle size | Tracked per build, no regressions | Faster loads on mobile/3G |
| NFR7 | Offline load time | < 1s from PWA cache | Returning users with no connectivity |

### Accessibility

| ID | Requirement | Target | Rationale |
|----|-------------|--------|-----------|
| NFR8 | Lighthouse Accessibility | 95+ | Quality gate |
| NFR9 | WCAG 2.1 AA | Best effort, non-blocking | Semantic HTML, keyboard nav, ARIA |
| NFR10 | Color contrast | 4.5:1 minimum | Readability on mobile in varied lighting |
| NFR11 | Color independence | No color-only information encoding | Calendar needs secondary indicators (name, pattern) |
| NFR12 | Reduced motion | Respect `prefers-reduced-motion` | User preference |
| NFR13 | Touch targets | Minimum 44x44px | Finger-friendly on mobile |
| NFR14 | Focus management | Visible focus indicators | Keyboard navigation |

### Offline & Reliability

| ID | Requirement | Target | Rationale |
|----|-------------|--------|-----------|
| NFR15 | Offline functionality | 100% read + write to local data | Core promise - works at rural houses |
| NFR16 | Data persistence | Zero data loss on close/restart/network loss | IndexedDB must survive all normal operations |
| NFR17 | PWA installability | Meets all PWA install criteria | Home screen access |
| NFR18 | Service worker updates | Auto-update with notification | Latest version without manual intervention |
| NFR19 | Lighthouse PWA | 95+ | Quality gate |

### Security

| ID | Requirement | Target | Rationale |
|----|-------------|--------|-----------|
| NFR20 | Access control | Trip accessible only via UUID in share link | UUID is the access token |
| NFR21 | Data sensitivity | No passwords, payment info, or PII beyond names | Low-risk data model |
| NFR22 | Transport security | HTTPS only | Standard baseline |

### Code Quality

| ID | Requirement | Target | Rationale |
|----|-------------|--------|-----------|
| NFR23 | TypeScript | Zero errors (strict mode) | Prevent runtime type bugs |
| NFR24 | Linting | Zero ESLint warnings/errors | Consistent quality |
| NFR25 | Test coverage | 80%+ line coverage | Confidence for changes |
| NFR26 | Lighthouse Best Practices | 95+ | Quality gate |
