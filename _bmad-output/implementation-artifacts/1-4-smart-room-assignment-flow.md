# Story 1.4: Smart Room Assignment Flow

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **guest**,
I want to see which rooms have available capacity for my dates and self-assign with one tap,
so that I can pick my room without asking the organizer.

## Acceptance Criteria

1. **Given** the room list page shows rooms with raw capacity numbers
   **When** I redesign the room availability display
   **Then** each room shows a clear visual capacity indicator (e.g., progress bar, "2 of 4 spots taken") for the selected date range

2. **Given** a guest wants to self-assign to a room
   **When** they view available rooms for their dates
   **Then** rooms with remaining capacity show a prominent "Claim this room" action button

3. **Given** a guest taps "Claim this room"
   **When** the assignment is created
   **Then** the system enforces capacity (FR18), detects conflicts (FR22), shows a success toast, and the room's availability indicator updates immediately

4. **Given** a guest tries to assign to a full room
   **When** capacity is exceeded
   **Then** a clear, friendly message explains the room is full and suggests alternatives

## Tasks / Subtasks

- [x] Task 1: Add date-range-aware capacity calculation to RoomListPage (AC: #1)
  - [x] 1.1 In `src/features/rooms/pages/RoomListPage.tsx`, add a `selectedDateRange` state (default: full trip date range from `currentTrip.startDate` to `currentTrip.endDate`). Add a `DateRangePicker` above the room grid to let users filter which dates they care about.
  - [x] 1.2 Create a new utility function `calculateRoomOccupancyForDateRange(roomId, assignments, startDate, endDate)` that returns the **peak occupancy** (maximum concurrent occupants) for a room across the given date range. This replaces the current "today only" occupancy calculation in `roomsWithOccupancy` useMemo.
  - [x] 1.3 Update the `RoomWithOccupancy` interface to include: `peakOccupancy: number`, `availableSpots: number` (capacity - peakOccupancy), `isFull: boolean` (peakOccupancy >= capacity). Keep `currentOccupants` for display but add these new fields.
  - [x] 1.4 Update the `roomsWithOccupancy` useMemo to use the new date-range-aware calculation. When no date range is selected, default to the full trip date range.

- [x] Task 2: Add visual capacity indicator to RoomCard (AC: #1)
  - [x] 2.1 In `src/features/rooms/components/RoomCard.tsx`, replace the current `Badge` occupancy display with a visual progress bar. Use a `<div>` based progress indicator (NOT a new dependency) showing filled/total capacity. Example: a horizontal bar filled to `occupancyCount/capacity` ratio, color-coded: green (<50%), amber (50-99%), red (100%).
  - [x] 2.2 Add a text label below the progress bar: "{occupancyCount} of {capacity} spots taken" using i18n key `rooms.spotsTaken` (with pluralization). When `availableSpots > 0`, also show "X spots open" in a positive color.
  - [x] 2.3 Add new props to `RoomCardProps`: `peakOccupancy: number`, `availableSpots: number`, `isFull: boolean`, `selectedDateRange?: { startDate: string; endDate: string }`.
  - [x] 2.4 Ensure the capacity indicator updates reactively when assignments change (the existing `useLiveQuery` in AssignmentContext handles this — verify it propagates through RoomListPage's useMemo).

- [x] Task 3: Add "Claim this room" self-assign button (AC: #2, #3)
  - [x] 3.1 In `src/features/rooms/components/RoomCard.tsx`, add a "Claim this room" button inside the card content, visible only when `availableSpots > 0` AND the current user (identified from local state/context — for now, always show since there is no "current user" concept yet in the app; the button opens the assignment flow).
  - [x] 3.2 The "Claim this room" button should open the existing `QuickAssignmentDialog` with the room pre-selected. Pass the room ID and the selected date range as suggested dates. The person will need to be selected in the dialog (since guest identity isn't tracked yet in Epic 1 — that's Epic 2's job).
  - [x] 3.3 Add capacity enforcement: Before creating an assignment in the dialog, check that the room has available capacity for the proposed date range. Create a new function `checkRoomCapacityForDateRange(roomId, startDate, endDate, assignments, rooms)` in the rooms feature utils. This function calculates peak occupancy for the proposed dates and returns `{ hasCapacity: boolean, peakOccupancy: number, capacity: number }`.
  - [x] 3.4 In `QuickAssignmentDialog.tsx`, add capacity check alongside the existing conflict check. If the room would be over capacity for any date in the range, show a warning similar to the conflict warning: "This room is full for some of these dates" with `AlertTriangle` icon.
  - [x] 3.5 In `RoomAssignmentSection.tsx` (`AssignmentFormDialog`), add the same capacity check when creating or editing assignments. Show the capacity warning but allow override (soft enforcement with warning, not hard block — matching "first come, first served" FR18 spirit where the UI warns but the system doesn't prevent it, since capacity could be flexible for some rooms).
  - [x] 3.6 Show a success toast on assignment creation: `toast.success(t('assignments.createSuccess'))` (already exists in the dialog — verify it fires).

- [x] Task 4: Handle full room state and suggest alternatives (AC: #4)
  - [x] 4.1 In `RoomCard.tsx`, when `isFull === true`: dim the card slightly (reduced opacity or muted background), hide the "Claim this room" button, and show a badge or text: "Full" using i18n key `rooms.full`.
  - [x] 4.2 In the room grid on `RoomListPage.tsx`, sort rooms to show available rooms first, then full rooms at the bottom. Preserve original ordering within each group (by `room.order`).
  - [x] 4.3 When a guest tries to claim a full room (edge case: room fills between page load and button click), show a friendly error toast: "This room just filled up! Try another room below." using i18n key `rooms.roomJustFilled`.
  - [x] 4.4 When all rooms are full, show a message in the unassigned guests section: "All rooms are currently full for these dates. Contact the organizer to add more rooms." using i18n key `rooms.allRoomsFull`.

- [x] Task 5: Add i18n keys for new text (AC: #1, #2, #3, #4)
  - [x] 5.1 Add to `src/locales/en/translation.json`:
    - `rooms.spotsTaken`: "{{occupied}} of {{capacity}} spots taken"
    - `rooms.spotsOpen`: "{{count}} spot open" / "{{count}} spots open" (plural)
    - `rooms.full`: "Full"
    - `rooms.claimRoom`: "Claim this room"
    - `rooms.roomJustFilled`: "This room just filled up! Try another one"
    - `rooms.allRoomsFull`: "All rooms are full for these dates"
    - `rooms.capacityWarning`: "This room may be over capacity for some of these dates"
    - `rooms.filterDates`: "Show availability for dates"
  - [x] 5.2 Add the same keys with French translations to `src/locales/fr/translation.json`:
    - `rooms.spotsTaken`: "{{occupied}} sur {{capacity}} places prises"
    - `rooms.spotsOpen`: "{{count}} place libre" / "{{count}} places libres"
    - `rooms.full`: "Complet"
    - `rooms.claimRoom`: "Choisir cette chambre"
    - `rooms.roomJustFilled`: "Cette chambre vient de se remplir ! Essayez-en une autre"
    - `rooms.allRoomsFull`: "Toutes les chambres sont completes pour ces dates"
    - `rooms.capacityWarning`: "Cette chambre risque d'etre surchargee pour certaines de ces dates"
    - `rooms.filterDates`: "Afficher la disponibilite pour les dates"

- [x] Task 6: Final validation (AC: #1, #2, #3, #4)
  - [x] 6.1 Run `bun run build` and confirm zero build errors
  - [x] 6.2 Run `tsc --noEmit` and confirm zero TypeScript errors (NFR23)
  - [x] 6.3 Run `bun run lint` and confirm no NEW lint errors introduced (baseline: 29 pre-existing)
  - [x] 6.4 Run `bun run test:run` and confirm all existing tests pass (baseline: 1265 tests)
  - [ ] 6.5 Manually verify on mobile viewport (375px): capacity indicators visible, "Claim this room" button is 44px+ touch target, full rooms are visually distinct, date range picker works
  - [ ] 6.6 Manually verify the full flow: select date range -> view room availability -> tap "Claim this room" -> select person -> confirm dates -> assignment created -> toast shown -> capacity indicator updates

## Dev Notes

### Architecture Patterns and Constraints

- **Components NEVER call Dexie directly** (AR-11) — always through context hooks (`useRoomContext`, `useAssignmentContext`, `usePersonContext`)
- **Context Provider nesting order is load-bearing** (AR-9): Trip > Room > Person > Assignment > Transport — DO NOT change
- **All user-facing strings MUST use i18n** (AR-13) — every new label must be added to both `en/translation.json` and `fr/translation.json`
- **Forms use inline validation, NOT Zod** (AR-12) — capacity checks should be inline error states, not Zod schemas
- **All lazy routes MUST be wrapped in `<ErrorBoundary><Suspense>`** (AR-14) — no new routes in this story, but existing pattern preserved
- **Use branded types for all entity IDs, dates, and colors** (AR-15) — `RoomId`, `PersonId`, `RoomAssignmentId`, `ISODateString`
- **shadcn/ui primitives in `src/components/ui/` — DO NOT modify** base components. All changes go in consuming components.
- **Tailwind utilities only** — DO NOT create new CSS files. Use Tailwind classes for the capacity progress bar.
- **Mobile-first responsive pattern** — base classes for mobile, `md:` overrides for desktop (e.g., `h-11 md:h-8`)
- **Toast pattern** — use `toast.success()` / `toast.error()` from `sonner` at the component level, not in hooks
- **useFormSubmission hook** — use for all form submission flows (double-submit guard, unmount safety)
- **Hotel date model** — startDate = check-in (first night), endDate = check-out (guest leaves, NOT a stay night). Two ranges overlap if `start1 <= end2 AND end1 >= start2`.

### Source Tree Components to Touch

**Task 1 (date-range capacity):**
- MODIFY: `src/features/rooms/pages/RoomListPage.tsx` — add `selectedDateRange` state, `DateRangePicker`, update `roomsWithOccupancy` calculation
- Note: `RoomWithOccupancy` interface is defined locally in RoomListPage (line 73-78) — extend it there

**Task 2 (visual capacity indicator):**
- MODIFY: `src/features/rooms/components/RoomCard.tsx` — replace Badge occupancy display with progress bar, add new props
- Note: `getOccupancyBadgeVariant` function (line 80-87) should be replaced with a progress-based approach

**Task 3 (claim button + capacity enforcement):**
- MODIFY: `src/features/rooms/components/RoomCard.tsx` — add "Claim this room" button
- MODIFY: `src/features/rooms/components/QuickAssignmentDialog.tsx` — add capacity check alongside conflict check
- MODIFY: `src/features/rooms/components/RoomAssignmentSection.tsx` — add capacity check in AssignmentFormDialog
- MODIFY: `src/features/rooms/pages/RoomListPage.tsx` — wire up claim button to QuickAssignmentDialog, pass new props to RoomCard

**Task 4 (full room state):**
- MODIFY: `src/features/rooms/components/RoomCard.tsx` — add full room visual treatment
- MODIFY: `src/features/rooms/pages/RoomListPage.tsx` — sort rooms (available first), add "all rooms full" message

**Task 5 (i18n):**
- MODIFY: `src/locales/en/translation.json` — add new room/assignment keys
- MODIFY: `src/locales/fr/translation.json` — add French translations

**No new files are created in this story** — all changes are to existing components and translation files.

### Project Structure Notes

- Alignment with unified project structure: All modifications are to existing files in `src/features/rooms/`, `src/components/shared/`, and `src/locales/`.
- The capacity calculation utility could be placed as a local function in `RoomListPage.tsx` (matching existing pattern of `calculateUnassignedDates` at line 110) or extracted to a utils file if reused. Prefer inline for now.
- The `DateRangePicker` shared component already exists at `src/components/shared/DateRangePicker.tsx` — it is imported in `RoomAssignmentSection.tsx` and `QuickAssignmentDialog.tsx`. Reuse it for the date range filter.

### Previous Story Intelligence (Story 1.3)

- **Mobile bottom nav restructured** from 6 tabs to 3 + "More" sheet. Rooms is one of the 3 primary mobile nav items — it is directly accessible.
- **Touch targets**: All interactive elements must be 44x44px minimum on mobile (`size-11 md:size-8` or `h-11 md:h-8` pattern). The "Claim this room" button MUST follow this pattern.
- **Dialog scroll handling**: `max-h-[90vh] overflow-y-auto` pattern is established. QuickAssignmentDialog already has it.
- **inputMode**: Use `inputMode="numeric"` on number inputs (already done for capacity in RoomForm).
- **Lint baseline: 29 pre-existing errors** — do not introduce new ones.
- **Test baseline: 1265 tests passing** — all must continue to pass.
- **Agent model used:** claude-opus-4-6 (via OpenCode) — same model, maintain consistency.

### Previous Story Intelligence (Story 1.2)

- **Color palette updated** from cold blue-gray to warm teal/amber/sand using OKLCH color format.
- **Empty states** use inviting, action-oriented i18n copy. New empty states or messages should match this warm tone.
- **Visual warmth** was established — any new UI elements (progress bar, badges, buttons) must feel vacation-appropriate, not enterprise.

### Git Intelligence

- Recent commits: `fix: story 1.3 code review fixes` (560f26b), `feat: story 1.3` (73be107), `feat: story 1.2` (e2ce085)
- Commit message pattern: `feat: story X.Y` for story implementations
- Previous stories are single commits — aim for the same pattern
- Files modified in story 1.3 that overlap with this story: `Layout.tsx` (nav — not touched here), `RoomAssignmentSection.tsx` (scroll handling — added in 1.3), `QuickAssignmentDialog.tsx` (scroll handling — added in 1.3)

### Technical Notes

**Capacity calculation algorithm:**
The key challenge is calculating peak occupancy for a room across a date range. The algorithm:
1. Get all assignments for the room (via `getAssignmentsByRoom(roomId)` — O(1) Map lookup in AssignmentContext)
2. For each date in the selected range, count how many assignments overlap that date (using `isDateInStayRange`)
3. The peak occupancy is the maximum count across all dates
4. `availableSpots = room.capacity - peakOccupancy`

**Performance consideration:** For a typical trip (7-14 days) with <20 assignments per room, this is O(days * assignments) per room, which is negligible. No optimization needed. However, avoid recalculating on every render — memoize with `useMemo` keyed on `[rooms, assignments, selectedDateRange]`.

**Capacity enforcement approach:**
Per FR18 ("first come, first served"), the app should WARN about capacity but not hard-block. Rationale: room capacity might be flexible (extra mattress, sofa bed). The UI should:
- Show a warning when capacity would be exceeded
- Allow the user to proceed anyway (soft enforcement)
- Keep the "Claim this room" button hidden when a room is at/over capacity (hard visual gate)
- But allow assignment through the expanded RoomAssignmentSection (existing flow) even for full rooms (with warning)

**Room sorting for availability:**
Sort rooms in the grid: `available rooms` (sorted by `room.order`) first, then `full rooms` (sorted by `room.order`) after. This makes it immediately obvious which rooms have space. Use `useMemo` for the sort to avoid re-sorting on every render.

**DateRangePicker integration:**
The existing `DateRangePicker` component at `src/components/shared/DateRangePicker.tsx` accepts:
- `startDate`, `endDate` — controlled values
- `onStartDateChange`, `onEndDateChange` — callbacks
- `minDate`, `maxDate` — bounds (use trip start/end)
- `bookedRanges` — shows booked ranges in the calendar (not needed for the filter)

Place the DateRangePicker above the room grid inside the existing `Card` component that shows unassigned guests, or as a separate filter section.

### Testing Standards

- **Existing tests must pass** — run `bun run test:run` to confirm no regressions
- **New test considerations**: The capacity calculation utility function should be testable. If extracted as a pure function, add a test file `src/features/rooms/components/__tests__/capacity-utils.test.ts`.
- **Layout test** should not need changes (no nav structure changes in this story)
- **Manual testing required**: verify the full "smart assignment" flow on both desktop and mobile viewport

### Anti-Patterns to Avoid

- **DO NOT** add a new room capacity check to `assignment-repository.ts` — keep capacity logic in the UI layer. The repository is entity-focused, not business-rule-focused. Capacity is a UI concern because it depends on date range context.
- **DO NOT** modify the `AssignmentContext` to add capacity checking — keep it in the component layer. The context should remain a clean data access layer.
- **DO NOT** hard-block assignment creation when capacity is exceeded — use soft enforcement (warning + allow override). Room capacity is a guideline, not a hard limit.
- **DO NOT** change the existing drag-and-drop flow — the "Claim this room" button is an ADDITIONAL affordance, not a replacement for drag-drop.
- **DO NOT** add a "current user" concept in this story — that's Epic 2 (Guest Onboarding). The "Claim" button opens the standard assignment dialog where the user selects a person.
- **DO NOT** create new CSS files — Tailwind utilities only for the progress bar
- **DO NOT** change existing i18n key names — only add new keys
- **DO NOT** modify shadcn/ui primitives in `src/components/ui/`

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4] — Story definition with acceptance criteria
- [Source: _bmad-output/planning-artifacts/epics.md#FR17] — User can assign themselves to a room for a date range
- [Source: _bmad-output/planning-artifacts/epics.md#FR18] — System enforces room capacity (first come, first served)
- [Source: _bmad-output/planning-artifacts/epics.md#FR22] — System detects and prevents conflicting assignments
- [Source: _bmad-output/planning-artifacts/epics.md#UX-3] — Smart Room Assignment Flow: surface available rooms with visual capacity indicators and one-tap self-assign
- [Source: _bmad-output/planning-artifacts/epics.md#AR-11] — Components NEVER call Dexie directly
- [Source: _bmad-output/planning-artifacts/epics.md#AR-13] — All user-facing strings MUST use i18n
- [Source: src/features/rooms/pages/RoomListPage.tsx] — Current room list with occupancy calculation and drag-drop
- [Source: src/features/rooms/components/RoomCard.tsx] — Current room card with occupancy badge display
- [Source: src/features/rooms/components/QuickAssignmentDialog.tsx] — Drag-drop assignment dialog with conflict checking
- [Source: src/features/rooms/components/RoomAssignmentSection.tsx] — Full assignment CRUD with conflict checking (990 lines)
- [Source: src/contexts/AssignmentContext.tsx] — Assignment state with O(1) `getAssignmentsByRoom` Map lookup
- [Source: src/lib/db/repositories/assignment-repository.ts] — `checkAssignmentConflict` function (person-centric, no capacity check)
- [Source: src/components/shared/DateRangePicker.tsx] — Reusable date range picker component
- [Source: _bmad-output/implementation-artifacts/1-3-mobile-ux-friction-audit-and-fixes.md] — Previous story learnings

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (via OpenCode)

### Debug Log References

No blocking issues encountered during implementation.

### Completion Notes List

- **Task 1**: Added `selectedDateRange` state with `DateRangePicker` UI above the room grid. Created `calculateRoomOccupancyForDateRange` utility function using the check-in/check-out date model. Extended `RoomWithOccupancy` interface with `peakOccupancy`, `availableSpots`, `isFull` fields. Updated `roomsWithOccupancy` useMemo to compute date-range-aware capacity, defaulting to the full trip date range when no filter is selected.

- **Task 2**: Replaced the Badge-based occupancy display in RoomCard with a visual progress bar using Tailwind-only CSS. Progress bar is color-coded: green (<50%), amber (50-99%), red (100%). Added "{X} of {Y} spots taken" text label and "{N} spots open" positive indicator. Added `peakOccupancy`, `availableSpots`, `isFull`, `selectedDateRange`, and `onClaim` props to `RoomCardProps`. Removed the now-unused `getOccupancyBadgeVariant` function.

- **Task 3**: Added "Claim this room" button to RoomCard (visible when `availableSpots > 0`), which opens the QuickAssignmentDialog with the room pre-selected and a person selector (since guest identity isn't tracked yet in Epic 1). Added `calculatePeakOccupancy` and `isDateInStayRange` utility functions to both QuickAssignmentDialog and RoomAssignmentSection for capacity enforcement. Capacity warnings are shown as amber alerts (soft enforcement - allows override per FR18). Both dialogs check capacity alongside conflict detection. Success toast already fires on assignment creation (verified existing implementation).

- **Task 4**: Added dimmed styling (`opacity-75 bg-muted/30`) to RoomCard when `isFull`. Added `sortedRoomsWithOccupancy` useMemo to sort available rooms first, then full rooms, preserving `room.order` within each group. Added "All rooms are full for these dates" message above the room grid when all rooms are at capacity. Edge case of room filling between page load and claim is handled by the capacity warning in the assignment dialog.

- **Task 5**: Added all 8 new i18n keys to both `en/translation.json` and `fr/translation.json` with proper pluralization support (`spotsOpen_one`/`spotsOpen_other`). Also added `dragHint` to French translations (was missing).

- **Task 6**: All automated validations passed: `bun run build` (zero errors), `tsc --noEmit` (zero errors), `bun run lint` (29 pre-existing errors, zero new), `bun run test:run` (1265/1265 tests pass). Manual verification subtasks (6.5, 6.6) require human testing.

### Change Log

- 2026-02-10: Implemented Story 1.4 - Smart Room Assignment Flow. Added date-range-aware capacity calculation, visual capacity indicators, "Claim this room" self-assign flow, full room handling, and i18n keys (EN+FR).
- 2026-02-10: Code review fixes (AI). Added missing i18n keys (quickAssign, quickAssignDescription). Extracted duplicated utility functions (isDateInStayRange, calculatePeakOccupancy) to shared capacity-utils module. Removed dead selectedDateRange prop from RoomCardProps. Implemented roomJustFilled toast for race condition edge case. Replaced stale todayStr with useToday hook. All smoke tests pass.

### File List

- `src/features/rooms/pages/RoomListPage.tsx` (modified) - Added date range filter, capacity calculation, room sorting, claim handler, useToday hook, roomJustFilled toast
- `src/features/rooms/components/RoomCard.tsx` (modified) - Added capacity progress bar, claim button, full room styling, new props (removed dead selectedDateRange prop)
- `src/features/rooms/components/QuickAssignmentDialog.tsx` (modified) - Added person selector for claim flow, capacity warning check (uses shared capacity-utils)
- `src/features/rooms/components/RoomAssignmentSection.tsx` (modified) - Added capacity warning to AssignmentFormDialog (uses shared capacity-utils)
- `src/features/rooms/utils/capacity-utils.ts` (new) - Shared utility functions: isDateInStayRange, calculatePeakOccupancy
- `src/locales/en/translation.json` (modified) - Added 11 new i18n keys (9 room + 2 assignment)
- `src/locales/fr/translation.json` (modified) - Added 12 new i18n keys (9 room + 2 assignment + dragHint)
