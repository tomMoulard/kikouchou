# Story 1.5: Pickup Coordination Visibility

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **driver**,
I want unassigned pickups surfaced as prominent, actionable alerts,
so that I can quickly see who needs a ride and volunteer.

## Acceptance Criteria

1. **Given** there are transports with `needsPickup: true` and no `driverId`
   **When** I view the transport list or dashboard
   **Then** unassigned pickups are displayed as prominent alert cards (not buried in a table) with person name, station, time, and a "Volunteer to drive" button

2. **Given** multiple unassigned pickups exist at the same station within a time window
   **When** I view the pickup alerts
   **Then** nearby pickups are grouped or flagged so drivers can plan combined trips

3. **Given** I tap "Volunteer to drive"
   **When** I assign myself as driver (FR25)
   **Then** the alert updates to show me as the assigned driver, a success toast appears, and the pickup is removed from the unassigned list

## Tasks / Subtasks

- [x] Task 1: Redesign UpcomingPickups component as prominent alert cards (AC: #1)
  - [x] 1.1 In `src/features/transports/components/UpcomingPickups.tsx`, redesign each `PickupItem` from a compact list item to an alert-style card with amber/warning background. Show: person name (PersonBadge), station/location, datetime with relative time, transport mode icon, transport number (if present), and a prominent "Volunteer to drive" button.
  - [x] 1.2 Filter `upcomingPickups` in the component to show ONLY unassigned pickups (`!transport.driverId`). Currently `upcomingPickups` from TransportContext includes ALL pickups with `needsPickup: true` — filter client-side to exclude resolved ones.
  - [x] 1.3 Add a "Volunteer to drive" button to each alert card. The button opens a person-selector dialog (since no "current user" concept exists yet — that's Epic 2). Use a simple `Select` or dialog showing all trip persons so the user can pick who is driving.
  - [x] 1.4 Wire the "Volunteer to drive" action: call `updateTransport(transport.id, { driverId: selectedPersonId })` from `useTransportContext()`. On success, show `toast.success(t('pickups.volunteerSuccess'))`. On error, show `toast.error(t('errors.saveFailed'))`.
  - [x] 1.5 When a pickup is resolved (driver assigned), animate it out of the unassigned list. The assigned driver's name should briefly appear as a confirmation before the card is removed. Use Tailwind transitions (respect `prefers-reduced-motion` via `motion-safe:`).
  - [x] 1.6 Update the empty state message to be warm and inviting: "All pickups are covered! No one needs a ride right now." using i18n.

- [x] Task 2: Add station/time-window grouping for combined trip planning (AC: #2)
  - [x] 2.1 Create a grouping utility function `groupPickupsByProximity(pickups, timeWindowMinutes = 60)` that groups unassigned pickups at the same station within a configurable time window (default: 60 minutes). Matching logic: exact string match on `transport.location` (case-insensitive, trimmed) AND `|datetime1 - datetime2| <= timeWindowMinutes`.
  - [x] 2.2 In UpcomingPickups, when a group has 2+ pickups, render them as a visual cluster: a shared header showing the station name and time window (e.g., "Gare de Vannes — 14:00-15:10"), with individual pickup cards nested inside. Add a "Combined trip" badge or visual indicator.
  - [x] 2.3 For single pickups (no nearby matches), render as standalone alert cards (same as Task 1).
  - [x] 2.4 Groups should be sorted chronologically by the earliest pickup datetime in each group. Within a group, pickups are sorted by datetime.

- [x] Task 3: Integrate pickup alerts into TransportListPage (AC: #1)
  - [x] 3.1 In `src/features/transports/pages/TransportListPage.tsx`, add the `UpcomingPickups` component above the transport list (between the count summary and the date-grouped list). Only show when there are unassigned pickups — hide the section entirely when all pickups have drivers.
  - [x] 3.2 Ensure the UpcomingPickups section is visually distinct from the transport list — use a contrasting background or border to draw attention. Consider adding a "Pickups needed" section header with a count badge.
  - [x] 3.3 When a user volunteers for a pickup via the alert card, the TransportCard in the main list should also update (the existing "needs pickup" badge should change to show the driver — this already works via Dexie live query reactivity, but verify it).

- [x] Task 4: Add i18n keys for all new text (AC: #1, #2, #3)
  - [x] 4.1 Add to `src/locales/en/translation.json`:
    - `pickups.volunteerDrive`: "Volunteer to drive"
    - `pickups.volunteerSuccess`: "You're the driver! Thanks for helping out"
    - `pickups.selectDriver`: "Who's driving?"
    - `pickups.selectDriverDescription`: "Select the person who will pick up {{name}}"
    - `pickups.combinedTrip`: "Combined trip"
    - `pickups.combinedTripHint`: "These pickups are at the same station — combine into one trip!"
    - `pickups.stationWindow`: "{{station}} — {{startTime}}-{{endTime}}"
    - `pickups.allCovered`: "All pickups are covered! No one needs a ride right now."
    - `pickups.needsDriver`: "Needs a driver"
    - `pickups.unassignedCount`: "{{count}} pickup needs a driver" / "{{count}} pickups need a driver"
    - `pickups.overdue`: "Overdue"
  - [x] 4.2 Add the same keys with French translations to `src/locales/fr/translation.json`:
    - `pickups.volunteerDrive`: "Je conduis"
    - `pickups.volunteerSuccess`: "C'est note ! Merci pour le coup de main"
    - `pickups.selectDriver`: "Qui conduit ?"
    - `pickups.selectDriverDescription`: "Choisissez qui va chercher {{name}}"
    - `pickups.combinedTrip`: "Trajet combine"
    - `pickups.combinedTripHint`: "Ces arrivees sont a la meme gare — combinez en un seul trajet !"
    - `pickups.stationWindow`: "{{station}} — {{startTime}}-{{endTime}}"
    - `pickups.allCovered`: "Tous les trajets sont couverts ! Personne n'a besoin qu'on vienne le chercher."
    - `pickups.needsDriver`: "Cherche conducteur"
    - `pickups.unassignedCount_one`: "{{count}} arrivee a besoin d'un conducteur"
    - `pickups.unassignedCount_other`: "{{count}} arrivees ont besoin d'un conducteur"
    - `pickups.overdue`: "En retard"

- [x] Task 5: Final validation (AC: #1, #2, #3)
  - [x] 5.1 Run `bun run build` and confirm zero build errors
  - [x] 5.2 Run `tsc --noEmit` and confirm zero TypeScript errors (NFR23)
  - [x] 5.3 Run `bun run lint` and confirm no NEW lint errors introduced (baseline: 29 pre-existing)
  - [x] 5.4 Run `bun run test:run` and confirm all existing tests pass
  - [ ] 5.5 Manually verify on mobile viewport (375px): alert cards are prominent with 44px+ touch targets, "Volunteer to drive" button is clearly tappable, grouped pickups show combined trip indicator, person selector works
  - [ ] 5.6 Manually verify the full flow: view unassigned pickup alert -> tap "Volunteer to drive" -> select person -> driver assigned -> success toast -> pickup removed from unassigned list -> TransportCard in list updates to show driver badge

## Dev Notes

### Architecture Patterns and Constraints

- **Components NEVER call Dexie directly** (AR-11) — always through context hooks (`useTransportContext`, `usePersonContext`)
- **Context Provider nesting order is load-bearing** (AR-9): Trip > Room > Person > Assignment > Transport — DO NOT change
- **All user-facing strings MUST use i18n** (AR-13) — every new label must be added to both `en/translation.json` and `fr/translation.json`
- **Forms use inline validation, NOT Zod** (AR-12) — person selection validation should be inline
- **Use branded types for all entity IDs, dates, and colors** (AR-15) — `TransportId`, `PersonId`
- **shadcn/ui primitives in `src/components/ui/` — DO NOT modify** base components. All changes go in consuming components.
- **Tailwind utilities only** — DO NOT create new CSS files. Use Tailwind classes for alert card styling.
- **Mobile-first responsive pattern** — base classes for mobile, `md:` overrides for desktop (e.g., `h-11 md:h-8`)
- **Toast pattern** — use `toast.success()` / `toast.error()` from `sonner` at the component level, not in hooks
- **Respect `prefers-reduced-motion`** (NFR12) — use `motion-safe:` Tailwind prefix for any animations

### Source Tree Components to Touch

**Task 1 (alert card redesign):**
- MODIFY: `src/features/transports/components/UpcomingPickups.tsx` — redesign PickupItem as alert cards, add "Volunteer to drive" button, add person selector, filter unassigned only, update empty state

**Task 2 (grouping):**
- MODIFY: `src/features/transports/components/UpcomingPickups.tsx` — add `groupPickupsByProximity` utility, render grouped clusters with shared station header and "Combined trip" badge

**Task 3 (transport list integration):**
- MODIFY: `src/features/transports/pages/TransportListPage.tsx` — add UpcomingPickups section above transport list, show only when unassigned pickups exist

**Task 4 (i18n):**
- MODIFY: `src/locales/en/translation.json` — add new pickup keys
- MODIFY: `src/locales/fr/translation.json` — add French translations

**No new files are created in this story** — all changes are to existing components and translation files. The grouping utility can be a local function in UpcomingPickups.tsx (matching the pattern of keeping utils co-located when only used in one place).

### Project Structure Notes

- Alignment with unified project structure: All modifications are to existing files in `src/features/transports/` and `src/locales/`.
- The `UpcomingPickups` component is currently imported only in `TransportListPage.tsx` (via `import { UpcomingPickups } from '@/features/transports/components/UpcomingPickups'`). It's not used on any dashboard page yet (dashboard is Epic 4).
- If the grouping utility becomes reused elsewhere (e.g., Epic 4 dashboard), it can be extracted to `src/features/transports/utils/pickup-utils.ts` later.

### Previous Story Intelligence (Story 1.4)

- **Smart Room Assignment Flow** established the pattern for "action alert" UX: prominent cards with action buttons. Apply the same approach here — pickup alerts should feel similar to the "Claim this room" pattern.
- **Capacity progress bars** in RoomCard used Tailwind-only CSS with color-coded indicators (green/amber/red). Use the same approach for pickup urgency indicators.
- **QuickAssignmentDialog** opened a person-selector dialog from a card action button — reuse this pattern for the "Volunteer to drive" person selector. The person selector in QuickAssignmentDialog uses a `Select` component showing all persons.
- **Lint baseline: 29 pre-existing errors** — do not introduce new ones.
- **Test baseline from Story 1.4**: All 1265 tests passing. Note: test count may have changed since — run tests and use current count as baseline.
- **Agent model used:** claude-opus-4-6 (via OpenCode) — same model, maintain consistency.

### Previous Story Intelligence (Story 1.3)

- **Mobile bottom nav restructured** from 6 tabs to 3 + "More" sheet. Transports is accessible via the "More" menu.
- **Touch targets**: All interactive elements must be 44x44px minimum on mobile (`size-11 md:size-8` or `h-11 md:h-8` pattern). The "Volunteer to drive" button MUST follow this pattern.
- **Dialog scroll handling**: `max-h-[90vh] overflow-y-auto` pattern is established. Person selector dialog should follow this.

### Previous Story Intelligence (Story 1.2)

- **Color palette updated** from cold blue-gray to warm teal/amber/sand using OKLCH color format.
- **Empty states** use inviting, action-oriented i18n copy. The "all pickups covered" message should match this warm tone.
- **Visual warmth** was established — pickup alerts should feel vacation-appropriate (amber/warm tones for urgency, not cold red danger).

### Git Intelligence

- Recent commits: `feat: story 1.4` (05f6674), `fix: story 1.3 code review fixes` (560f26b), `feat: story 1.3` (73be107)
- Commit message pattern: `feat: story X.Y` for story implementations
- Previous stories are single commits — aim for the same pattern

### Technical Notes

**UpcomingPickups current state:**
The `UpcomingPickups` component (360 lines) currently:
- Uses `useTransportContext().upcomingPickups` which returns transports where `needsPickup: true && datetime >= now`
- Does NOT filter out pickups that already have a `driverId` — this means resolved pickups still show in the list
- Displays as a simple collapsible Card with compact list items (PickupItem subcomponent)
- Shows person badge, type icon, relative time, and location
- Has expand/collapse for 3+ items
- Has empty state handling
- Full i18n support

**What needs to change:**
1. Filter to show ONLY unassigned pickups (where `!transport.driverId`)
2. Redesign PickupItem from compact list item to alert-style card
3. Add "Volunteer to drive" button with person selector
4. Add station/time grouping for combined trip planning
5. Update empty state to warm inviting message
6. Integrate prominently into TransportListPage

**TransportContext `upcomingPickups` computed value:**
Located at `TransportContext.tsx:330-357`. Computed via single-pass classification from all transports:
```typescript
if (transport.needsPickup && transport.datetime >= currentTimestamp) {
  upcomingPickupsArr.push(transport);
}
```
This includes ALL upcoming pickups (both assigned and unassigned). The component should filter client-side for unassigned ones. Do NOT modify the context — other future consumers (Epic 4 dashboard) may need the full list.

**Driver assignment via updateTransport:**
To assign a driver: `updateTransport(transportId, { driverId: selectedPersonId })`. This triggers a Dexie live query update, which propagates through TransportContext → component re-render. The assigned pickup will still appear in `upcomingPickups` (it has `needsPickup: true`) but the component filter will exclude it from the unassigned list.

**Person selector pattern:**
Use the shadcn/ui `Select` component already used in `QuickAssignmentDialog.tsx` for person selection. Import persons from `usePersonContext()`. Show all trip participants with their PersonBadge color indicator.

**Grouping algorithm:**
```
1. Filter to unassigned pickups (needsPickup && !driverId && datetime >= now)
2. Sort by datetime
3. Iterate and group: for each pickup, check if it matches an existing group
   - Match criteria: same location (case-insensitive trim) AND within timeWindow of any pickup in the group
4. Output: array of { station, timeWindow, pickups[] } sorted by earliest datetime
```

Performance: For a typical trip with <20 pickups, this is O(n^2) worst case, which is negligible. No optimization needed.

**Urgency indicators:**
- Overdue (past datetime): red/danger styling — should not happen for upcoming but handle edge case
- Today: amber/warning styling with "in X hours" relative time
- Tomorrow: lighter amber with "tomorrow at HH:mm"
- Later: neutral with formatted date

### Testing Standards

- **Existing tests must pass** — run `bun run test:run` to confirm no regressions
- **New test considerations**: The `groupPickupsByProximity` utility function should be testable. If extracted as a pure function, add a test file or include inline tests. Given the pattern of keeping tests co-located: `src/features/transports/components/__tests__/UpcomingPickups.test.tsx` may already exist — check and extend.
- **Manual testing required**: verify the full "volunteer to drive" flow on both desktop and mobile viewport

### Anti-Patterns to Avoid

- **DO NOT** modify `TransportContext` to filter out assigned pickups — keep the full `upcomingPickups` list there. Filter in the component. Other consumers (Epic 4 dashboard) may need the complete list.
- **DO NOT** add a "current user" concept in this story — that's Epic 2 (Guest Onboarding). The "Volunteer" button opens a person selector dialog.
- **DO NOT** hard-code station matching logic that depends on coordinates or geocoding — use simple string matching on `transport.location` for now. Coordinate-based proximity is a future enhancement.
- **DO NOT** create new CSS files — Tailwind utilities only for alert card styling
- **DO NOT** change existing i18n key names — only add new keys
- **DO NOT** modify shadcn/ui primitives in `src/components/ui/`
- **DO NOT** modify the TransportCard in TransportListPage — it already handles driver display correctly. The reactivity via Dexie live queries will update it automatically when a driver is assigned.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] — Story definition with acceptance criteria
- [Source: _bmad-output/planning-artifacts/epics.md#FR24] — User can flag a transport as needing pickup
- [Source: _bmad-output/planning-artifacts/epics.md#FR25] — User can assign themselves as driver for another participant's transport
- [Source: _bmad-output/planning-artifacts/epics.md#FR29] — User can view upcoming transports needing a driver
- [Source: _bmad-output/planning-artifacts/epics.md#UX-6] — Pickup coordination visibility: unassigned pickups surfaced as actionable alerts, not buried in transport list
- [Source: _bmad-output/planning-artifacts/epics.md#AR-11] — Components NEVER call Dexie directly
- [Source: _bmad-output/planning-artifacts/epics.md#AR-13] — All user-facing strings MUST use i18n
- [Source: _bmad-output/planning-artifacts/epics.md#NFR12] — Respect prefers-reduced-motion
- [Source: src/features/transports/components/UpcomingPickups.tsx] — Current pickup display component (360 lines)
- [Source: src/features/transports/pages/TransportListPage.tsx] — Transport list with date grouping (1063 lines)
- [Source: src/contexts/TransportContext.tsx] — Transport state with upcomingPickups computed (538 lines)
- [Source: src/lib/db/repositories/transport-repository.ts] — Transport CRUD including updateTransportWithOwnershipCheck
- [Source: src/types/index.ts] — Transport interface with driverId?: PersonId, needsPickup: boolean
- [Source: _bmad-output/implementation-artifacts/1-4-smart-room-assignment-flow.md] — Previous story learnings (action card pattern, person selector pattern)

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (via OpenCode)

### Debug Log References

- Build: zero errors (`bun run build` success)
- TypeScript: zero errors (`tsc --noEmit` clean)
- Lint: 29 problems (unchanged from baseline — no new errors introduced)
- Tests: 37 files, 1283 tests passing (18 new tests added for groupPickupsByProximity utility, 0 regressions from 1265 baseline)

### Completion Notes List

- Redesigned UpcomingPickups from compact collapsible list to prominent amber alert cards with urgency-based styling (overdue: red, today: amber, tomorrow: lighter amber, later: warm neutral)
- Added DriverSelectDialog component using shadcn/ui Select pattern from QuickAssignmentDialog for person selection
- Implemented groupPickupsByProximity utility extracted to `src/features/transports/utils/pickup-utils.ts` for testability (deviation from "no new files" — extracted per story's own suggestion about future extraction to this exact path)
- Client-side filter for unassigned pickups only (`!transport.driverId`) preserves TransportContext's full `upcomingPickups` list for Epic 4 consumers
- Animated pickup resolution: resolving card shows driver name briefly with green confirmation, then fades out via `motion-safe:` transitions
- Grouped pickups render with shared station header, time window, and "Combined trip" badge with Users icon
- Added UpcomingPickups section to TransportListPage between count summary and transport list with amber border wrapper
- All i18n keys added in both EN and FR with proper pluralization (`_one`/`_other` pattern)
- Touch targets follow 44px mobile pattern (`h-11 md:h-9`)
- Dialog follows `max-h-[90vh] overflow-y-auto` scroll pattern
- Tasks 5.5 and 5.6 are manual verification tasks requiring user testing

### Change Log

- 2026-02-10: Implemented Story 1.5 — Pickup Coordination Visibility. Redesigned UpcomingPickups as prominent alert cards with "Volunteer to drive" button, station/time grouping for combined trips, and integration into TransportListPage. Added 18 unit tests for grouping utility. All automated validations pass.
- 2026-02-10: Code review fixes applied (6 issues fixed):
  - H-1: Fixed count badge mismatch — derive unassigned count from grouped pickups (single source of truth)
  - H-2: Fixed resolving animation driver name — store driver name in resolvingMap before async update
  - H-3: Fixed missing warm empty state — show `pickups.allCovered` message when all pickups have drivers
  - M-2: Fixed grouping algorithm — now checks against any pickup in group (earliestTime to latestTime range), not just earliestTime
  - M-3: Fixed Cancel button missing 44px touch target in DriverSelectDialog
  - M-1: Added sprint-status.yaml to File List documentation

### Senior Developer Review (AI)

**Reviewed by:** tom on 2026-02-10
**Outcome:** Changes Requested → Fixed

**Findings (6 fixed, 1 noted):**
- [FIXED][HIGH] Count badge showed different number than rendered cards due to separate filtering paths
- [FIXED][HIGH] Resolving animation never displayed driver name (driverId was stale from pre-update state)
- [FIXED][HIGH] `pickups.allCovered` i18n key defined but never rendered — component returned null instead of warm empty state
- [FIXED][MEDIUM] Grouping algorithm only checked against earliest pickup, not any pickup in group (deviation from spec)
- [FIXED][MEDIUM] Cancel button in DriverSelectDialog missing `h-11 md:h-9` mobile touch target
- [FIXED][MEDIUM] sprint-status.yaml modified but not in File List
- [NOTED][MEDIUM] Main JS chunk at 518KB exceeds 500KB architectural limit (AR-8) — pre-existing, not introduced by this story

### File List

- MODIFIED: `src/features/transports/components/UpcomingPickups.tsx` — Full redesign: alert cards, driver selector dialog, unassigned filter, animation, grouping integration
- MODIFIED: `src/features/transports/pages/TransportListPage.tsx` — Added UpcomingPickups section above transport list with amber wrapper
- MODIFIED: `src/locales/en/translation.json` — Added `pickups.*` i18n keys (12 new keys)
- MODIFIED: `src/locales/fr/translation.json` — Added `pickups.*` French translations (12 new keys)
- MODIFIED: `_bmad-output/implementation-artifacts/sprint-status.yaml` — Story status tracking
- NEW: `src/features/transports/utils/pickup-utils.ts` — groupPickupsByProximity utility and PickupGroup type
- NEW: `src/features/transports/utils/__tests__/pickup-utils.test.ts` — 18 unit tests for grouping utility
