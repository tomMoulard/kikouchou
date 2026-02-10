---
stepsCompleted: [1, 2]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/product-brief-kikoushou-2026-02-06.md
  - _bmad-output/brainstorming/brainstorming-session-2026-02-06.md
  - src/components/ (current implementation review)
documentCounts:
  briefs: 1
  research: 1
  brainstorming: 1
  currentImplementation: 1
date: 2026-02-06
author: tom
---

# UX Design Specification kikoushou

**Author:** tom
**Date:** 2026-02-06

---

<!-- UX design content will be appended sequentially through collaborative workflow steps -->

## Executive Summary

### Project Vision

Kikoushou is a Progressive Web App that eliminates the coordination bottleneck in vacation house sharing. When groups of 5-15 friends rent a house together, one person (the organizer) typically becomes the "human FAQ" - fielding questions about rooms, arrival times, and pickups. Kikoushou replaces that bottleneck with a self-service, shareable tool.

The product innovates by subtraction: zero accounts, zero authentication, zero server. Anyone with a shared link has full access. Social context (friend groups) is the access control. The app is offline-first, working at rural vacation houses with intermittent connectivity.

The MVP is functionally complete. The current focus is UX polish - making the existing features frictionless, especially on mobile where guests will open the shared link.

### Target Users

**Primary: The Organizer (Marie)**
- Sets up trip scaffolding: rooms, participants, dates
- Shares a single link and stops being the coordinator
- Success = "I shared the link and never got asked a logistics question"
- Device: Desktop for setup, mobile for checking
- Needs: management dashboard showing trip health ("2 guests haven't picked rooms", "3 unassigned pickups")

**Secondary: The Guest (Lucas)**
- Opens shared link on mobile (primary device), standing at a train station with luggage
- Needs: guided setup (room, transport, pickup) then ongoing situational awareness
- Success = "I clicked the link and was set up in 2 minutes"
- No install, no account, no friction
- Mental model is task-oriented ("what do I need to know for THIS trip"), not management-oriented

**Secondary: The Driver (Sophie)**
- Checks who needs pickup, when, and where
- Self-assigns as driver, combines nearby pickups
- Success = "I saw two pickups at the same station and combined them"

### Key Design Challenges

1. **Dual information architecture** - The app is built around the organizer's mental model (manage trips, rooms, people, transports as separate entities). The guest's mental model is task-oriented ("what do I need for this trip?"). One navigation structure cannot serve both optimally. The current 6-tab bottom navigation reflects the organizer's world, not the guest's.

2. **First-time guest experience via shared link** - There is no guided entry point. A guest tapping a WhatsApp link lands in a full management app and must navigate 4+ steps to find their room assignment. This directly threatens the PRD's #1 success metric: "guest self-service under 2 minutes." Without guidance, guests will text Marie instead.

3. **Context mismatch on landing** - The app feels like a management tool, not a vacation planning aid. The emotional context (friends planning a vacation) doesn't match the visual experience (generic component library UI). Trust is built in the first 3 seconds - a warm, purposeful landing builds it; a cold enterprise feel breaks it.

4. **Room self-assignment clarity** - Guests need to intuitively see which rooms have available capacity for their dates and assign themselves. Current flow requires navigating to a room list, understanding capacity numbers, and manually assigning. Empty states show "Capacity: 2/4" rather than inviting action: "This room has 2 spots open - claim yours!"

5. **Pickup coordination visibility** - Unassigned pickups are buried in a transport list. Drivers need them surfaced prominently - not as data in a table, but as actionable alerts: "Lucas needs a pickup from Gare de Vannes at 14:32 - volunteer?"

6. **Accidental edit protection** - Since anyone with the link can edit anything, the UX must protect against "oops I tapped the wrong thing" without adding friction. Destructive actions need clear visual distinction and consistent confirmation patterns.

7. **Confidence in offline state** - Users at rural locations need clear, non-intrusive feedback that their edits are saved locally, even without connectivity.

### Design Opportunities

1. **Guest Onboarding Wizard (highest priority)** - A 5-step guided flow for first-time shared link access: (1) Welcome screen with trip name/dates/location, (2) "Who are you?" - select from participant list (with "add yourself" fallback), (3) Room selection - available rooms for your dates with one-tap assign, (4) Transport entry - arrival/departure details and pickup flag, (5) "You're all set!" summary. Each step is one decision. Total time target: under 2 minutes. Returning visits skip directly to dashboard.

2. **Trip Dashboard as post-wizard landing** - A single screen answering: Who's here today? Who's arriving next? Any unassigned pickups? Your room and transport at a glance. For organizers, add management alerts ("2 guests haven't picked rooms"). The dashboard IS the calendar in compact form - color bands showing "who's here when" with detail expansion.

3. **Smart Room Assignment Flow** - Surface "Available rooms for your dates" with visual capacity indicators and one-tap self-assign. Integrate into both the wizard and the standalone room view. Empty states should invite action, not display raw data.

4. **Progressive Disclosure for dual IA** - Guest via shared link gets the wizard then dashboard. Organizer gets the dashboard with management affordances. Full detail views (rooms, transports, persons, calendar) are accessible but not the default. Reduce mobile bottom navigation from 6 tabs to 2-3 contextual views.

5. **Visual Warmth and Trust** - Move beyond generic component library styling. Vacation planning should feel like a beautiful schedule tacked to the fridge door. Warmer colors, purposeful whitespace, inviting empty states, subtle personality. This isn't polish - it's trust-building that determines whether guests use the app or text Marie.
