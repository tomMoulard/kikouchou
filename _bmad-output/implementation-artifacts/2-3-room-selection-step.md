# Story 2.3: Room Selection Step

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **guest**,
I want to see available rooms for my dates and claim one with a single tap,
so that I have a room reserved without needing to ask anyone.

## Acceptance Criteria

1. **Given** the guest proceeds from the identity step (taps "Next" on `/share/:shareId/identity`)
   **When** the room selection step loads at `/share/:shareId/room`
   **Then** all trip rooms are displayed with name, capacity, current occupancy for the full trip date range, and a visual availability indicator — fetched via `getRoomsByTripId()` and `getAssignmentsByTripId()` (direct repository calls — AR-10, no context hooks)

2. **Given** a room has remaining capacity
   **When** it is displayed
   **Then** it shows a prominent "Claim this room" button and a clear capacity indicator (e.g., "2 of 4 spots taken"), and the button is enabled and tappable

3. **Given** a room is at full capacity
   **When** it is displayed
   **Then** the room is visually dimmed, the "Claim" button is disabled (or replaced with "Full"), and a "Full" label is shown

4. **Given** the guest taps "Claim this room"
   **When** the assignment is created via `createAssignment()` directly
   **Then** the room's occupancy indicator updates immediately, a success confirmation appears inline or as a brief visual, and the "Proceed" button becomes enabled

5. **Given** a conflict is detected before creating the assignment (person already assigned for overlapping dates via `checkAssignmentConflict()`)
   **When** the guest taps "Claim this room"
   **Then** a clear inline error message is shown ("You're already assigned to a room for these dates") without navigating away

6. **Given** the guest wants to skip room selection
   **When** they tap "Skip for now"
   **Then** they proceed to `/share/:shareId/transport` without an assignment, and room can be chosen later from the main app

7. **Given** all text in the room selection step
   **When** it is rendered
   **Then** all strings use i18n keys (FR/EN) with fallbacks — no hardcoded text

## Tasks / Subtasks

- [x] Task 1: Create `RoomSelectionStepPage` component (AC: 1, 2, 3, 7)
  - [x] 1.1 Create `src/features/sharing/pages/RoomSelectionStepPage.tsx` — the room wizard step page
  - [x] 1.2 On mount: call `getTripByShareId(shareId as ShareId)` to get tripId, then `getRoomsByTripId(tripId)` and `getAssignmentsByTripId(tripId)` in parallel (use `Promise.all`); show `<LoadingState />` while loading, `<ErrorDisplay />` on failure
  - [x] 1.3 Compute per-room occupancy: for each room, count assignments where `roomId === room.id` (use all trip assignments, no date filtering — use trip total capacity model matching existing logic)
  - [x] 1.4 Render each room as a card with: room name, room icon, capacity indicator (e.g., "2 of 4 spots taken"), visual progress or slots indicator, and either "Claim this room" (enabled) or "Full" (disabled) button
  - [x] 1.5 Add `<LoadingState />` guard, `<ErrorDisplay />` guard, and empty state for 0 rooms
  - [x] 1.6 Add all new i18n keys to `src/locales/en/translation.json` and `src/locales/fr/translation.json` under `sharing` object

- [x] Task 2: Implement claim and navigation logic (AC: 4, 5, 6)
  - [x] 2.1 Read stored guest identity from localStorage key `kikouchou_guest_${shareId}` → `{ personId, tripId }` on mount; if not found, redirect back to `/share/:shareId/identity` (guard: can't skip identity step)
  - [x] 2.2 On "Claim this room": call `checkAssignmentConflict(tripId, personId, trip.startDate, trip.endDate)` first; if conflict → show inline error, do not call `createAssignment`
  - [x] 2.3 If no conflict: call `createAssignment(tripId, { roomId: room.id, personId, startDate: trip.startDate, endDate: trip.endDate })` — use trip start/end dates as the full stay duration
  - [x] 2.4 On success: update local occupancy state (re-add to assignments array), show success state on the claimed card (disable "Claim" button, show "Claimed ✓"), enable "Next" button
  - [x] 2.5 Wrap claim submit in `isSubmittingRef` guard + `try/catch/finally` per canonical pattern; reset loading state in `finally`
  - [x] 2.6 "Skip for now" button navigates to `/share/:shareId/transport`; "Next" button (only enabled after claiming) also navigates to `/share/:shareId/transport`

- [x] Task 3: Wire the room step into routing (AC: 1, 6)
  - [x] 3.1 Update `src/features/sharing/routes.tsx`: add lazy import declaration at top (following the existing `IdentityStepPage` pattern exactly):
    ```typescript
    const RoomSelectionStepPage = lazy(() =>
      import('./pages/RoomSelectionStepPage').then((module) => ({
        default: module.RoomSelectionStepPage,
      })),
    );
    ```
    Then replace the `OnboardingPlaceholderPage` element for `path: 'room'` with `withSuspense(RoomSelectionStepPage)`
  - [x] 3.2 Update `src/features/sharing/index.ts` to export `RoomSelectionStepPage`

- [x] Task 4: Tests (AC: 1–7)
  - [x] 4.1 Unit test: rooms load and render with capacity indicators (mock `getTripByShareId`, `getRoomsByTripId`, `getAssignmentsByTripId`)
  - [x] 4.2 Unit test: full room shows "Full" / disabled button
  - [x] 4.3 Unit test: available room shows "Claim this room" button (enabled)
  - [x] 4.4 Unit test: tapping "Claim this room" calls `checkAssignmentConflict` then `createAssignment`
  - [x] 4.5 Unit test: conflict detection shows inline error message without navigating
  - [x] 4.6 Unit test: successful claim updates card state (claimed indicator) and enables "Next"
  - [x] 4.7 Unit test: "Skip for now" navigates to `/share/:shareId/transport`
  - [x] 4.8 Unit test: missing localStorage identity redirects to identity step
  - [x] 4.9 Unit test: i18n — text nodes use translation keys (keys returned as-is by mock)
  - [x] 4.10 Unit test: empty rooms list shows friendly empty state

- [x] Task 5: Verification
  - [x] 5.1 `bunx tsc --noEmit` — 0 errors
  - [x] 5.2 `bun run lint` — no new warnings or errors beyond baseline (34 pre-existing)
  - [x] 5.3 `bun run test:run` — all tests pass (1363 total = 1349 baseline + 14 new)

## Dev Notes

### Developer Context (Read First)

This is **Story 2.3 of Epic 2 (Guest Onboarding)**. It replaces the `OnboardingPlaceholderPage` stub for the `/share/:shareId/room` route with a real room selection step. The wizard flow is:

```
/share/:shareId           → Story 2.1: Welcome screen (DONE)
/share/:shareId/identity  → Story 2.2: Identity step (DONE)
/share/:shareId/room      → Story 2.3: Room selection (THIS STORY)
/share/:shareId/transport → Story 2.4: Transport entry (stub, still placeholder)
/share/:shareId/summary   → Story 2.5: Summary (stub, still placeholder)
```

**Critical constraint (AR-10):** The entire `/share/:shareId/*` subtree is **outside `AppProviders`**. There is NO `useTripContext()`, `useRoomContext()`, `useAssignmentContext()`, or any context hook available. All data access MUST go through direct repository calls from `@/lib/db`:
- `getTripByShareId(shareId as ShareId)` — to get the trip from the URL shareId
- `getRoomsByTripId(tripId as TripId)` — to list rooms
- `getAssignmentsByTripId(tripId as TripId)` — to compute occupancy per room
- `checkAssignmentConflict(tripId, personId, startDate, endDate)` — before creating
- `createAssignment(tripId, data)` — to claim a room

**Getting tripId from the URL:** The `/share/:shareId/room` route does NOT have a `tripId` param — only `shareId`. Call `getTripByShareId(shareId as ShareId)` on mount (exactly as `ShareImportPage` and `IdentityStepPage` do). Store `trip` in state for all subsequent calls.

**Getting the guest personId:** Read from localStorage under key `kikouchou_guest_${shareId}`:
```typescript
const GUEST_STORAGE_KEY = (shareId: string) => `kikouchou_guest_${shareId}`;

interface StoredGuestIdentity {
  personId: string;
  tripId: string;
}
```
If the stored identity is missing or invalid, redirect to `/share/:shareId/identity` so the guest must identify themselves first. This is a guard: the room step has no meaning without knowing who the guest is.

**Room occupancy computation:** Use `getAssignmentsByTripId(tripId)` to get all assignments for the trip, then for each room:
```typescript
const roomOccupancy = (room: Room): number => {
  return assignments.filter(a => a.roomId === room.id).length;
};
const isFull = (room: Room): boolean => roomOccupancy(room) >= room.capacity;
```
No date-range filtering needed — the wizard model is "claim a room for the whole trip" (use `trip.startDate` to `trip.endDate`).

**Assignment date range:** When creating the assignment, use the trip's full date range:
```typescript
await createAssignment(tripId, {
  roomId: room.id as RoomId,
  personId: storedIdentity.personId as PersonId,
  startDate: trip.startDate,
  endDate: trip.endDate,
});
```

**File to create:** `src/features/sharing/pages/RoomSelectionStepPage.tsx`
**Do NOT** create a new feature folder. Everything stays in `src/features/sharing/`.

### Technical Requirements

1. **Repository-only data access** — `getTripByShareId`, `getRoomsByTripId`, `getAssignmentsByTripId`, `checkAssignmentConflict`, `createAssignment` from `@/lib/db`. No context hooks.
2. **Get tripId from shareId** — call `getTripByShareId(shareId as ShareId)` on mount; handle loading/not-found states.
3. **Load rooms and assignments in parallel** — `const [rooms, assignments] = await Promise.all([getRoomsByTripId(tripId), getAssignmentsByTripId(tripId)])`.
4. **Conflict check before create** — always call `checkAssignmentConflict` before `createAssignment` to show a friendly inline error if the person is already assigned.
5. **Inline form validation** — no Zod in component layer (AR-12). Name conflict message is inline below the room card.
6. **`isSubmittingRef` + `isMountedRef` pattern** — use `useRef(false)` guards + `try/catch/finally` for the claim async submit. Follow `IdentityStepPage.tsx` or `ShareImportPage.tsx` exactly.
7. **Branded types** — `shareId as ShareId`, `trip.id as TripId`, `room.id as RoomId`, `personId as PersonId`.
8. **i18n** — all text via `t('key', 'fallback')`. Never hardcode.
9. **Tailwind only** — no inline styles, no CSS modules.
10. **`memo(function Name(){})`** — named function inside `memo` for `displayName`.
11. **`undefined` not `null`** for optional fields.
12. **Touch targets** — all interactive elements ≥ 44×44px (NFR13).

### Architecture Compliance

- Share route boundary: `/share/:shareId/*` is outside `AppProviders`. [Source: architecture.md#ARCHITECTURAL RULE: Share Route Boundary]
- Data access boundary: Components → Repository functions → Dexie. NEVER call `db.roomAssignments.*` directly from components. [Source: architecture.md#Data Access Boundary]
- Feature module structure: pages in `src/features/sharing/pages/`, components in `src/features/sharing/components/`. [Source: architecture.md#Feature Module Structure]
- Lazy routes: wrap in `<ErrorBoundary><Suspense>` (already handled in `routes.tsx` via `withSuspense()`). [Source: architecture.md#Code splitting]
- Context nesting order: MUST NOT change in `AppProviders.tsx`. [Source: architecture.md#ARCHITECTURAL RULE: Context Provider Nesting Order]
- Named export + `memo` pattern: all new components follow `export const Foo = memo(function Foo() {})`.

### Library / Framework Requirements

- React 19 + TypeScript strict.
- React Router DOM 7.x: `useNavigate`, `useParams` (for `shareId`).
- `react-i18next`: `useTranslation()` hook; all text via `t('key', 'fallback')`.
- `sonner`: `toast.error(t('key'))` for DB errors.
- Lucide React: `Check` icon for claimed state, `BedDouble` (or room icon from `RoomIcon` type) for room cards; `aria-hidden="true"` on decorative icons.
- `@/components/shared/LoadingState` — show while data is loading.
- `@/components/shared/ErrorDisplay` — show if trip not found or data fails to load.
- `@/components/ui/button` — for "Claim this room", "Skip for now", "Next" buttons.
- `@/components/ui/card` — for the page card wrapper (amber theme, same as previous steps).
- **No new dependencies.**

### File Structure Requirements

**New files:**
- `src/features/sharing/pages/RoomSelectionStepPage.tsx` — the room selection step component

**Files to modify:**
- `src/features/sharing/routes.tsx` — replace `OnboardingPlaceholderPage` element for `path: 'room'` with lazy-loaded `RoomSelectionStepPage`
- `src/features/sharing/index.ts` — export `RoomSelectionStepPage`
- `src/locales/en/translation.json` — add new `sharing.room*` keys under the existing `sharing` object
- `src/locales/fr/translation.json` — add French translations

**Files NOT to touch:**
- `src/features/sharing/pages/OnboardingPlaceholderPage.tsx` — keep for routes `transport`, `summary`
- `src/contexts/` — no changes to context providers
- `src/features/sharing/pages/ShareImportPage.tsx` — do not modify unless fixing a bug
- `src/features/sharing/pages/IdentityStepPage.tsx` — do not modify

**Test file:**
- `src/features/sharing/pages/__tests__/RoomSelectionStepPage.test.tsx` — create new

### i18n Keys Required

Add to **both** `src/locales/en/translation.json` and `src/locales/fr/translation.json` under the `"sharing"` object (alongside the existing `identity*` keys):

**English:**
```json
"roomTitle": "Pick your room",
"roomSubtitle": "Choose a room for your stay",
"roomClaim": "Claim this room",
"roomClaimed": "Claimed ✓",
"roomFull": "Full",
"roomSkip": "Skip for now",
"roomNext": "Next",
"roomSpotsTaken": "{{occupied}} of {{capacity}} spots taken",
"roomEmpty": "No rooms available",
"roomEmptyDescription": "The organizer hasn't added any rooms yet. Check back later!",
"roomConflict": "You're already assigned to a room for these dates",
"roomClaimError": "Failed to claim room. Please try again.",
"roomLoading": "Loading rooms..."
```

**French:**
```json
"roomTitle": "Choisissez votre chambre",
"roomSubtitle": "Sélectionnez une chambre pour votre séjour",
"roomClaim": "Réserver cette chambre",
"roomClaimed": "Réservé ✓",
"roomFull": "Complet",
"roomSkip": "Passer pour l'instant",
"roomNext": "Suivant",
"roomSpotsTaken": "{{occupied}} sur {{capacity}} places prises",
"roomEmpty": "Aucune chambre disponible",
"roomEmptyDescription": "L'organisateur n'a pas encore ajouté de chambres. Revenez plus tard !",
"roomConflict": "Vous êtes déjà assigné(e) à une chambre pour ces dates",
"roomClaimError": "Impossible de réserver la chambre. Veuillez réessayer.",
"roomLoading": "Chargement des chambres..."
```

### Async Load Pattern (Canonical)

Follow exactly the same pattern as `IdentityStepPage.tsx` and `ShareImportPage.tsx`. Load trip + rooms + assignments in parallel after getting the tripId.

**Note on `ISODateString`:** `trip.startDate` and `trip.endDate` are already typed as `ISODateString` (branded) by the DB layer. Do NOT re-wrap them with `toISODateString()`. Pass them directly to `createAssignment` and `checkAssignmentConflict`.

```typescript
// isMountedRef cleanup — add this effect alongside the load effect
useEffect(() => () => {
  isMountedRef.current = false;
}, []);

useEffect(() => {
  let cancelled = false;

  async function loadData(): Promise<void> {
    if (!shareId) {
      if (!cancelled && isMountedRef.current) {
        setNotFound(true);
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    try {
      const trip = await getTripByShareId(shareId as ShareId);
      if (cancelled || !isMountedRef.current) return;
      if (!trip) { setNotFound(true); return; }

      const [rooms, assignments] = await Promise.all([
        getRoomsByTripId(trip.id),
        getAssignmentsByTripId(trip.id),
      ]);
      if (cancelled || !isMountedRef.current) return;

      setTrip(trip);
      setRooms(rooms);
      setAssignments(assignments);
    } catch (error) {
      console.error('Failed to load room selection data:', error);
      if (!cancelled && isMountedRef.current) setNotFound(true);
    } finally {
      if (!cancelled && isMountedRef.current) setIsLoading(false);
    }
  }

  void loadData();
  return () => { cancelled = true; };
}, [shareId]);
```

### Guest Identity Guard Pattern

Read stored identity on mount, redirect to identity step if missing.

**Note on nested routes:** This page is a **child** of the `share/:shareId` route in `routes.tsx`. React Router v7 propagates parent route params to children, so `useParams<{ shareId: string }>()` inside `RoomSelectionStepPage` correctly receives `shareId` from the parent `share/:shareId` segment — no extra route configuration needed.

```typescript
const { shareId } = useParams<{ shareId: string }>();
const navigate = useNavigate();
const isMountedRef = useRef(true);

// On mount: read guest identity from localStorage
useEffect(() => {
  const stored = localStorage.getItem(`kikouchou_guest_${shareId}`);
  if (!stored) {
    // No identity stored — must go through identity step first
    navigate(`/share/${shareId}/identity`, { replace: true });
    return;
  }
  try {
    const identity = JSON.parse(stored) as { personId: string; tripId: string };
    // Validate shape before casting to branded types
    if (!identity.personId || !identity.tripId) {
      navigate(`/share/${shareId}/identity`, { replace: true });
      return;
    }
    setGuestPersonId(identity.personId as PersonId);
  } catch {
    navigate(`/share/${shareId}/identity`, { replace: true });
  }
}, [shareId, navigate]);
```

### Claim Room Pattern

```typescript
const isSubmittingRef = useRef(false);
const [isClaimingRoomId, setIsClaimingRoomId] = useState<RoomId | undefined>();
const [claimError, setClaimError] = useState<string | undefined>();
const [claimedRoomId, setClaimedRoomId] = useState<RoomId | undefined>();

const handleClaimRoom = useCallback(async (room: Room): Promise<void> => {
  if (isSubmittingRef.current || !trip || !guestPersonId) return;
  isSubmittingRef.current = true;
  setIsClaimingRoomId(room.id);   // shows per-room loading: button text → "Claiming..." + disabled
  setClaimError(undefined);

  try {
    // Check for conflicts first
    // Note: checkAssignmentConflict takes startDate/endDate as `string` (unbranded).
    // trip.startDate/endDate are ISODateString (branded string subtype) — compatible.
    const hasConflict = await checkAssignmentConflict(
      trip.id,
      guestPersonId,
      trip.startDate,
      trip.endDate,
    );
    if (!isMountedRef.current) return;

    if (hasConflict) {
      setClaimError(t('sharing.roomConflict'));
      return;
    }

    // createAssignment requires RoomAssignmentFormData with ISODateString branded dates.
    // trip.startDate/endDate are already ISODateString — no cast needed.
    const newAssignment = await createAssignment(trip.id, {
      roomId: room.id,
      personId: guestPersonId,
      startDate: trip.startDate,   // already ISODateString — do not re-wrap
      endDate: trip.endDate,       // already ISODateString — do not re-wrap
    });
    if (!isMountedRef.current) return;

    // Update local state: add new assignment to reflect updated occupancy
    setAssignments(prev => [...prev, newAssignment]);
    setClaimedRoomId(room.id);
  } catch (error) {
    console.error('Failed to claim room:', error);
    if (isMountedRef.current) setClaimError(t('sharing.roomClaimError'));
  } finally {
    isSubmittingRef.current = false;
    if (isMountedRef.current) setIsClaimingRoomId(undefined);
  }
}, [trip, guestPersonId, t]);
```

### Room Card Visual Design

Consistent with the amber theme established in Stories 2.1 and 2.2:

- **Available room card:** `cursor-pointer rounded-xl border-2 p-4 transition-colors border-amber-200 bg-white`
- **Full room card:** `rounded-xl border-2 p-4 opacity-60 border-gray-200 bg-gray-50`
- **Claimed room card:** `rounded-xl border-2 p-4 border-green-400 bg-green-50`
- Room name: `font-medium text-amber-900`
- Capacity indicator: `text-sm text-amber-700` — use text `"X of Y spots taken"` + a visual progress bar (`<div>` with `w-[X%] bg-amber-400 h-1 rounded-full`) below the text. This is simpler than slot dots and works for any capacity size.
- "Claim" button: amber variant, min-h-[44px] (NFR13). While claiming: button text → "Claiming..." + `disabled` (use `isClaimingRoomId === room.id` to determine).
- "Full" label: muted/gray badge (`bg-gray-100 text-gray-500 text-sm px-2 py-1 rounded`), no button
- "Claimed ✓" state: green text `text-green-700 font-medium` with `<Check size={16} aria-hidden="true" />` icon visible only when `claimedRoomId === room.id`
- Touch target: entire button must be ≥ 44×44px

**Note on AC numbering vs epics.md:** The story ACs are numbered 1–7. The original epics.md story 2.3 has 5 ACs (no explicit conflict-detection AC, no explicit i18n AC). Story AC5 (conflict detection via `checkAssignmentConflict`) and AC7 (i18n) are additions in the story file for safety and completeness — they do not contradict epics.md. Story AC6 = epics.md AC5 (skip).

### Occupancy Computation (No Date Filtering Needed)

The wizard uses the full trip date range for assignments. Occupancy = number of existing assignments for this room (regardless of dates within the trip):

```typescript
function getRoomOccupancy(room: Room, allAssignments: RoomAssignment[]): number {
  return allAssignments.filter(a => a.roomId === room.id).length;
}

function isRoomFull(room: Room, allAssignments: RoomAssignment[]): boolean {
  return getRoomOccupancy(room, allAssignments) >= room.capacity;
}
```

### Testing Requirements

- Test file: `src/features/sharing/pages/__tests__/RoomSelectionStepPage.test.tsx`
- Use `render` from `@/test/utils` with `{ withProviders: false }` — page is outside `AppProviders`
- Wrap in `MemoryRouter` with `initialEntries={['/share/abc123/room']}`
- Mock `@/lib/db` module:
  ```typescript
  vi.mock('@/lib/db', () => ({
    getTripByShareId: vi.fn(),
    getRoomsByTripId: vi.fn(),
    getAssignmentsByTripId: vi.fn(),
    checkAssignmentConflict: vi.fn(),
    createAssignment: vi.fn(),
  }));
  ```
- Example mock shapes (TypeScript strict mode requires all required fields):
  ```typescript
  const mockTrip = {
    id: 'trip1' as TripId,
    shareId: 'abc123' as ShareId,
    name: 'Test Trip',
    location: 'Paris',
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-22' as ISODateString,
    createdAt: 0 as UnixTimestamp,
    updatedAt: 0 as UnixTimestamp,
  };
  const mockRoom = {
    id: 'room1' as RoomId,
    tripId: 'trip1' as TripId,
    name: 'Master Bedroom',
    capacity: 2,
    order: 0,
    icon: 'bed-double' as RoomIcon,
    createdAt: 0 as UnixTimestamp,
    updatedAt: 0 as UnixTimestamp,
  };
  const mockAssignment = {
    id: 'assign1' as RoomAssignmentId,
    tripId: 'trip1' as TripId,
    roomId: 'room1' as RoomId,
    personId: 'person1' as PersonId,
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-22' as ISODateString,
  };
  ```
- Mock `localStorage` using `vi.spyOn(Storage.prototype, 'getItem')` for guest identity reads:
  ```typescript
  vi.spyOn(Storage.prototype, 'getItem').mockReturnValue(
    JSON.stringify({ personId: 'person1', tripId: 'trip1' })
  );
  ```
- Mock `navigate` via `vi.mock('react-router-dom', ...)` or wrap in proper `MemoryRouter` with routes
- `fake-indexeddb/auto` is auto-imported from test setup — no manual setup needed
- i18n is mocked — `t('key')` returns the key string
- Existing test baseline: **1349 passing**; add ~10 new tests

### Previous Story Intelligence (2.1 + 2.2)

**From Story 2.2 (IdentityStepPage — most relevant):**
- `IdentityStepPage.tsx` is the canonical pattern for this story — same async-load flow, same `isMountedRef` + cancelled flag, same `isSubmittingRef` for submitting.
- localStorage key `kikouchou_guest_${shareId}` → `{ personId: string, tripId: string }` is **written** by 2.2 and **read** by 2.3. This is the bridge between steps.
- Amber theme confirmed: `from-amber-50 to-orange-50` gradient background, `border-amber-200` card border, `text-amber-900` text.
- `withSuspense()` helper is already defined in `routes.tsx` — use it for `RoomSelectionStepPage`.
- `OnboardingPlaceholderPage` stays for routes `transport`, `summary` until stories 2.4–2.5.
- Baseline: **1349 tests** passing, **34 lint errors** (all pre-existing baseline, not ours), **0 TypeScript errors**.

**From Story 2.1 (ShareImportPage — foundational patterns):**
- `getStoredGuestIdentity(shareId)` helper pattern — Story 2.1 reads this key for returning-guest detection. Reuse the same key structure.
- `OnboardingPlaceholderPage` stub is what we're replacing for the `room` route.
- Error UI: `<LoadingState />` + `<ErrorDisplay />` + not-found states are all established patterns.

**From Story 1.4 (Smart Room Assignment Flow — visual reference):**
- The existing `RoomAssignmentSection` / `QuickAssignmentDialog` in `src/features/rooms/` uses capacity indicators. Do NOT import from `rooms/` feature (feature boundary). Re-implement the capacity display inline in the wizard card — it's simpler context.
- The `rooms.spotsTaken` i18n key already exists: `"{{occupied}} of {{capacity}} spots taken"`. You may reuse it OR add `sharing.roomSpotsTaken` for consistency within the wizard context. Prefer a new key under `sharing` to keep the wizard self-contained.

### Git Intelligence

- Recent commits: `7a7fd8a` `2.2`, `4b3b0fb` `chore: add opencode`, `4020ef4` `2.1`, `f4558ef` `chore: upgrade bmad`, `9d80edd` `feat: 1.8`
- Commit convention for this story: `feat: 2.3` or `feat: story 2.3`
- Epic 2 is `in-progress` (set from story 2.1)

### UX Requirements (from UX Design Spec)

- **Room selection is step 3 of 5** in the wizard. One decision per step: pick a room. [Source: ux-design-specification.md#Design Opportunities, item 1]
- **Visual capacity indicators** — Guests need to see at a glance which rooms have space. Do not show raw numbers; show inviting language: "2 of 4 spots taken" with a visual progress bar or slot dots. [Source: ux-design-specification.md#Key Design Challenges, item 4]
- **"Claim this room"** — The primary CTA must be prominent and finger-friendly (≥44px touch target). [Source: ux-design-specification.md#Design Opportunities, item 3]
- **Full room dimming** — Full rooms should be visually de-emphasized, not hidden. Guest may want to see what's full. [Source: epics.md#Story 2.3 AC 3]
- **"Skip for now"** — visible but secondary; guest can claim a room later from the main app. [Source: epics.md#Story 2.3 AC 5]
- **Mobile-first** — Cards stack vertically, full-width, with large tap targets. This step is used standing at a train station. [Source: ux-design-specification.md#Target Users, Guest]

### Project Context

- Project: kikouchou — vacation house coordination PWA. No backend. IndexedDB (Dexie.js). Offline-first.
- This story is step 3 of the wizard flow, outside AppProviders. Pattern established by Stories 2.1 and 2.2.
- Epic 2 goal: first-time guests can self-service setup in under 2 minutes with no more than 5 taps for the happy path (UX-1).
- After this story: story 2.4 (transport entry) will also read the stored guest identity to pre-populate the personId for the transport record.

### References

- Story definition + AC: [Source: _bmad-output/planning-artifacts/epics.md#Story 2.3: Room Selection Step]
- Epic 2 context: [Source: _bmad-output/planning-artifacts/epics.md#Epic 2: Guest Onboarding Experience]
- Share route boundary rule (AR-10): [Source: _bmad-output/planning-artifacts/architecture.md#ARCHITECTURAL RULE: Share Route Boundary]
- Canonical async-load pattern reference: `src/features/sharing/pages/IdentityStepPage.tsx` and `src/features/sharing/pages/ShareImportPage.tsx`
- Available repository functions: `getTripByShareId`, `getRoomsByTripId`, `getAssignmentsByTripId`, `checkAssignmentConflict`, `createAssignment` [Source: src/lib/db/index.ts]
- Wizard routes scaffold: [Source: src/features/sharing/routes.tsx]
- localStorage key contract: [Source: _bmad-output/implementation-artifacts/2-2-identity-selection-step.md#localStorage Write — Implementation Detail]
- Branded types: `TripId`, `RoomId`, `PersonId`, `ShareId` [Source: src/types/index.ts]
- `Room` interface + `RoomAssignment` interface + `RoomAssignmentFormData` [Source: src/types/index.ts]
- `createAssignment`, `checkAssignmentConflict` signatures [Source: src/lib/db/repositories/assignment-repository.ts]
- `getRoomsByTripId` [Source: src/lib/db/repositories/room-repository.ts]
- Amber visual theme reference: [Source: src/features/sharing/pages/ShareImportPage.tsx] and [Source: src/features/sharing/pages/IdentityStepPage.tsx]
- Touch target requirement (NFR13, 44px minimum): [Source: _bmad-output/planning-artifacts/architecture.md#Accessibility]
- Existing capacity i18n key (reference): `rooms.spotsTaken` = `"{{occupied}} of {{capacity}} spots taken"` [Source: src/locales/en/translation.json]
- Test utilities: [Source: src/test/utils.tsx]

## Dev Agent Record

### Agent Model Used

anthropic/claude-sonnet-4-6

### Debug Log References

_No debug issues encountered. Clean implementation following IdentityStepPage patterns exactly._

### Completion Notes List

- ✅ Implemented `RoomSelectionStepPage` following the canonical async-load pattern from `IdentityStepPage` and `ShareImportPage` (isMountedRef + cancelled flag + isSubmittingRef).
- ✅ AR-10 compliant: no context hooks — all data via `getTripByShareId`, `getRoomsByTripId`, `getAssignmentsByTripId`, `checkAssignmentConflict`, `createAssignment` from `@/lib/db`.
- ✅ Identity guard: reads `kikouchou_guest_${shareId}` from localStorage on mount; redirects to identity step if missing or malformed.
- ✅ Parallel data load: `getRoomsByTripId` and `getAssignmentsByTripId` called with `Promise.all`.
- ✅ Occupancy computed client-side (no date filtering, whole-trip model) with visual progress bar.
- ✅ Full rooms dimmed + "Full" badge; available rooms show "Claim this room" (amber button, ≥44px touch target).
- ✅ Conflict check (`checkAssignmentConflict`) before `createAssignment`; inline `role="alert"` error shown on conflict.
- ✅ On successful claim: local assignments state updated, "Claimed ✓" shown, "Next" button enabled.
- ✅ "Skip for now" always navigates to transport step without requiring a claim.
- ✅ 15 i18n keys added to EN and FR translation files under `sharing` object.
- ✅ Lazy route wired in `routes.tsx`; exported from `index.ts` barrel.
- ✅ 14 unit tests written and passing (4 extra tests added to cover not-found state, parallel call assertion, loading state, and malformed localStorage).
- ✅ 0 TypeScript errors, 34 pre-existing lint errors (no new), 1363 tests total (all passing).

### File List

**New files:**
- `src/features/sharing/pages/RoomSelectionStepPage.tsx`
- `src/features/sharing/pages/__tests__/RoomSelectionStepPage.test.tsx`

**Modified files:**
- `src/features/sharing/routes.tsx` — added lazy `RoomSelectionStepPage`, replaced `OnboardingPlaceholderPage` for `room` route
- `src/features/sharing/index.ts` — added `RoomSelectionStepPage` export
- `src/locales/en/translation.json` — added 15 `sharing.room*` i18n keys
- `src/locales/fr/translation.json` — added 15 `sharing.room*` i18n keys (French)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — updated story status to `review`
- `_bmad-output/implementation-artifacts/2-3-room-selection-step.md` — updated story file

## Change Log

- **2026-03-16** — Implemented Story 2.3: Room Selection Step. Created `RoomSelectionStepPage` with full room display, capacity indicators, claim flow (conflict check + create), identity guard, i18n, routing wire-up, and 14 unit tests. All ACs satisfied.
