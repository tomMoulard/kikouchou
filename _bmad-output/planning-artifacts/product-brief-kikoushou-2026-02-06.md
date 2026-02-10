---
stepsCompleted: [1, 2, 3, 4, 5]
inputDocuments:
  - _bmad-output/brainstorming/brainstorming-session-2026-02-06.md
  - README.md
  - TODO.md
date: 2026-02-06
author: tom
---

# Product Brief: kikoushou

## Executive Summary

**Kikoushou** is a focused PWA that solves vacation house coordination for groups of friends with rotating attendance. While generic trip planners handle multi-destination itineraries and expense apps track money, kikoushou answers the simple but critical questions: *Who sleeps where? Who arrives when? Who needs a pickup?*

Built for the trip organizer drowning in mental load and the guests who just want clarity, kikoushou provides a visual, shareable, offline-first solution that works even at rural vacation houses with spotty wifi. One link or QR code gives everyone the information they need.

---

## Core Vision

### Problem Statement

When groups of friends rent a vacation house together, coordination becomes chaotic. Information scatters across WhatsApp threads, spreadsheets, and one person's memory. The "trip organizer" becomes a single point of failure - tracking room assignments, arrival times, pickup logistics, and guest rotations while everyone else just shows up.

### Problem Impact

- **Mental overload** on the organizer who must remember everything
- **Confusion** about room assignments leading to conflicts or couch-sleeping
- **Missed pickups** when arrival information gets buried in chat
- **Repeated questions** because no single source of truth exists
- **Stress** that undermines the vacation experience before it even begins

### Why Existing Solutions Fall Short

| Solution | Gap |
|----------|-----|
| **WhatsApp/Group chats** | Information buried, no structure, impossible to find later |
| **Google Sheets** | Clunky on mobile, requires manual maintenance, not shareable easily |
| **Trip planners (TripIt, Wanderlog)** | Built for multi-destination travel, not single-house rotating attendance |
| **Expense apps (Splitwise, Tricount)** | Only handle money, not logistics |
| **Google Calendar** | No room assignment logic, transport details don't fit the model |

The gap: No tool focuses specifically on **one house, rotating guests, room logistics, and transport coordination**.

### Proposed Solution

Kikoushou provides:

1. **Calendar View** - Visual timeline showing who's at the house and when
2. **Room Management** - Clear assignments with capacity tracking, no double-bookings
3. **Transport Tracking** - Arrivals/departures with times, locations, pickup needs, and driver assignments
4. **Effortless Sharing** - One link or QR code gives guests full visibility without app installation
5. **Offline-First** - Works without internet after first load, perfect for rural locations
6. **Print-Friendly** - Generate a schedule for the vacation house fridge

### Key Differentiators

| Differentiator | Why It Matters |
|----------------|----------------|
| **Laser focus** | Does one thing exceptionally well - no feature bloat |
| **Offline-first PWA** | Works at remote vacation houses with poor connectivity |
| **Share-first design** | Guests get visibility via link, no app install required |
| **Print support** | Physical schedule on the fridge serves everyone |
| **Dual value** | Relieves organizer stress AND gives guests clarity |
| **Niche ownership** | Too specific for generic tools to prioritize, too valuable for users to ignore |

---

## Target Users

### Primary Users

#### The Trip Organizer

**Profile:** "Marie" or "Thomas" - The friend who ends up coordinating the vacation house, whether by choice (the natural planner) or by default (someone has to do it).

**Context:**
- Working full-time with limited bandwidth
- Organizing the trip on top of everything else in life
- Managing a group of 2-15 friends with rotating attendance
- Sometimes coordinating families with kids

**Current Pain:**
- Constantly answering: *"When does X arrive?"* and *"Where will they sleep?"*
- Information scattered across WhatsApp, mental notes, maybe a spreadsheet
- Being the single point of failure for all logistics
- Fielding repeat questions because nothing is centralized

**Goals:**
- Set up the trip once and stop being the human FAQ
- Have a single source of truth to point people to
- Reduce mental load while still ensuring everyone is taken care of

**Success Moment:** Seeing the calendar view populated with all room assignments and arrivals - and realizing they can just share a link instead of answering questions.

---

### Secondary Users

#### The Guests

**Profile:** Friends, family members, or acquaintances joining the vacation - ranging from close friends to partners-of-friends to extended family.

**Context:**
- All guests are equal in terms of product interaction
- They just want to know the basics without hassle
- Some are drivers who may help with pickups

**Needs:**
- Know their room assignment
- Know when others arrive (especially if they're picking someone up)
- Have all trip info in one accessible place
- Not install an app or create an account

**Interaction Model:** Read-only via shared link. They consume information, they don't manage it.

**Success Moment:** Clicking the shared link and immediately seeing: where they sleep, when to arrive, and who else is there.

---

### User Journey

#### Organizer Journey

| Stage | Action | Experience |
|-------|--------|------------|
| **Discovery** | Hears about kikoushou from another organizer or friend | "Finally, something for this specific problem" |
| **Onboarding** | Creates a trip, adds rooms, adds guests | Quick setup, intuitive flow |
| **Core Usage** | Assigns rooms, adds transport details | Visual calendar shows everything at a glance |
| **Sharing** | Sends link/QR code to the group | One action replaces dozens of messages |
| **Success** | Stops getting questions, guests self-serve | Mental load lifted |

#### Guest Journey

| Stage | Action | Experience |
|-------|--------|------------|
| **Discovery** | Receives link from organizer | No app install, just click |
| **First View** | Opens link, sees trip overview | "Oh, I'm in the blue room, arriving Thursday" |
| **Core Usage** | Checks details as needed | Bookmarks link, refers back before trip |
| **Success** | Has all info without asking anyone | Feels informed, not dependent |

---

## Success Metrics

### User Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| **Trip setup time** | Under 10 minutes from start to shareable link | Time from trip creation to first share action |
| **Repeat usage** | Organizers create multiple trips | Trips per organizer over time |
| **Guest self-service** | Guests don't need to ask the organizer questions | Reduction in coordination messages (qualitative) |
| **Guest engagement** | Guests check the shared link before arriving | Link visits per trip (if trackable) |

### Business Objectives

| Objective | Description |
|-----------|-------------|
| **Product scope** | Side project solving a personal pain point |
| **Adoption goal** | 5 friends actively using it for real trips |
| **Growth model** | Organic - word of mouth and sharing |
| **Monetization** | None planned - free to use |
| **Timeline** | Value delivered as soon as possible |

### Key Performance Indicators

| KPI | Target | Timeframe |
|-----|--------|-----------|
| **Active users** | 5 friends using it for real trips | First vacation season |
| **Trips created** | At least 5 real trips | First 6 months |
| **Setup completion rate** | 100% of started trips get shared | Ongoing |
| **Organizer retention** | Organizers return for their next trip | Per vacation cycle |
| **Guest link usage** | Guests open the shared link at least once | Per trip |

### Strategic Alignment

These metrics are intentionally lightweight for a side project:
- **User success drives adoption** - If the 5 friends find it useful, they'll share it with their organizer friends
- **No vanity metrics** - We don't care about downloads or page views, only real trips being organized
- **Quality over quantity** - One trip perfectly organized beats 100 abandoned accounts

---

## MVP Scope

### Core Features (Shipped)

| Feature | Description | Status |
|---------|-------------|--------|
| **Trip Management** | Create/edit trips with date ranges and location | Complete |
| **Room Management** | Add rooms, set capacity, drag-and-drop guest assignment, occupancy tracking | Complete |
| **Person Management** | Add guests with color badges for calendar display | Complete |
| **Calendar View** | Month view with color-coded room assignments and transport events | Complete |
| **Transport Tracking** | Arrivals/departures with mode, location, pickup needs, driver assignment | Complete |
| **Trip Sharing** | Share via links and QR codes for read-only guest access | Complete |
| **Offline-First PWA** | Full functionality without internet after first load | Complete |
| **Multi-language** | French and English support | Complete |
| **Maps Integration** | Visualize transport locations on a map | Complete |

### Out of Scope for MVP

| Feature | Rationale |
|---------|-----------|
| **Notifications / Reminders** | Not essential for core value; deferred to v2 |
| **Print Support** | Differentiator but not blocking for initial adoption |
| **P2P Sync** | Complex infrastructure; not needed with share links |
| **Food / Meal Management** | Scope expansion beyond core logistics |
| **Task Management** | Cleaning, shopping lists - adjacent but not core |
| **Money Management** | Explicitly deferred; link to Tricount instead |
| **E-ink Display Support** | Niche enhancement for later |
| **New User Segments** | Current focus is friend groups only |

### MVP Success Criteria

| Criteria | Validation |
|----------|------------|
| **Shippable** | MVP is complete and ready to deploy |
| **Core problem solved** | Organizer can set up a trip and share it in under 10 minutes |
| **Guest self-service** | Guests access all info via shared link without asking questions |
| **5 friends adopt it** | Used for at least one real vacation trip |
| **Repeat usage** | Organizer creates a second trip voluntarily |

### Future Vision

**Near-term (v2 candidates, no priority order):**
- Notifications and pickup reminders
- E-ink display support (Kindle-friendly view)
- P2P sync (serverless data sharing)
- Print support (fridge-ready schedule)

**Long-term (if adoption grows):**
- Food and meal management
- Task management (cleaning schedules, shopping lists)
- Expanding to new user segments beyond friend groups
- Money management (or deeper Tricount integration)

**Philosophy:** The MVP solves room assignments and transport coordination. Future features expand the scope from "logistics" to "complete vacation house management" - but only if adoption validates the core value first.
