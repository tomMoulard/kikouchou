# Story 2.5: Summary and Trip Entry

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **guest**,
I want to see a summary of everything I've set up and enter the trip,
so that I'm confident everything is correct before I start using the app.

## Acceptance Criteria

1. **Given** the guest completes (or skips) all wizard steps
   **When** the summary step loads at `/share/:shareId/summary`
   **Then** it displays: identity (name + color), room assignment (or "Not yet assigned"), and transport details (or "None added") in a clear, scannable layout

2. **Given** the guest wants to change something
   **When** they tap on any summary section (identity, room, transport)
   **Then** they are taken back to that specific wizard step to make changes

3. **Given** the guest is satisfied with the summary
   **When** they tap "Enter trip" / "Let's go!"
   **Then** the current trip is set via `setCurrentTrip()`, the app navigates to `/trips/:tripId/calendar` (inside the context boundary), and the wizard is marked as completed for this shareId

4. **Given** the guest completes the wizard
   **When** the total elapsed time is measured
   **Then** the wizard flow should be achievable in under 2 minutes (UX-1 target) with no more than 5 taps for the happy path

5. **Given** all text in the summary step
   **When** it is rendered
   **Then** all strings use i18n keys (FR/EN) with fallbacks — no hardcoded text

6. **Given** the summary step is viewed on mobile
   **When** rendered on viewport < 768px
   **Then** sections stack vertically with touch targets ≥ 44×44px (NFR13)

7. **Given** the guest has no room assigned and no transports entered
   **When** the summary step loads
   **Then** "Not yet assigned" and "None added" placeholders are shown (not empty space), and the guest can still enter the trip

## Tasks / Subtasks

- [x] Task 1: Create `SummaryStepPage` component (AC: 1, 5, 6, 7)
  - [x] 1.1 Create `src/features/sharing/pages/SummaryStepPage.tsx` — the final wizard step page
  - [x] 1.2 On mount: read stored guest identity from localStorage key `kikouchou_guest_${shareId}` → `{ personId, tripId }`; if not found, redirect to `/share/${shareId}/identity` (same guard pattern as TransportEntryStepPage)
  - [x] 1.3 Call `getTripByShareId(shareId as ShareId)` to get the trip; show `<LoadingState variant="fullPage" />` while loading, handle not-found with friendly error card
  - [x] 1.4 Cross-validate: if stored `tripId` doesn't match loaded trip's `id`, clear localStorage and redirect to identity step (same guard as previous steps)
  - [x] 1.5 Load guest data in parallel:
    - `getPersonById(personId as PersonId)` → guest name + color
    - `getAssignmentsByPersonId(personId as PersonId)` → filter to `tripId` matches → get room assignment(s)
    - If assignment found: `getRoomById(assignment.roomId)` → room name
    - `getTransportsByPersonId(personId as PersonId)` → filter to `tripId` matches → guest's transports
  - [x] 1.6 Render three summary sections (identity, room, transport) as described in Visual Design below
  - [x] 1.7 Show "Not yet assigned" for room and "None added" for transport when data is absent — never show blank/empty sections
  - [x] 1.8 Add all new i18n keys to `src/locales/en/translation.json` and `src/locales/fr/translation.json` under the `sharing` object

- [x] Task 2: Implement "edit" navigation for each section (AC: 2)
  - [x] 2.1 Each summary section (identity, room, transport) has a tappable area or "Change" button
  - [x] 2.2 Tapping identity section navigates to `/share/${shareId}/identity`
  - [x] 2.3 Tapping room section navigates to `/share/${shareId}/room`
  - [x] 2.4 Tapping transport section navigates to `/share/${shareId}/transport`
  - [x] 2.5 Use `navigate()` (not `replace`) so the guest can use browser back to return to summary

- [x] Task 3: Implement "Enter trip" action (AC: 3)
  - [x] 3.1 "Enter trip" / "Let's go!" button calls `setCurrentTrip(trip.id)` from `@/lib/db/repositories/settings-repository`
  - [x] 3.2 After `setCurrentTrip`, mark wizard completed: `localStorage.setItem(\`kikouchou_wizard_complete_${shareId}\`, 'true')`
  - [x] 3.3 Navigate to `/trips/${trip.id}/calendar` — this crosses the context boundary into `AppProviders`
  - [x] 3.4 Wrap in `isSubmittingRef` guard + `try/catch/finally` per canonical pattern
  - [x] 3.5 On error: show inline error message (do not navigate), allow retry

- [x] Task 4: Wire the summary step into routing (AC: 1)
  - [x] 4.1 Update `src/features/sharing/routes.tsx`: add lazy import declaration at top (following the existing `TransportEntryStepPage` pattern exactly):
    ```typescript
    const SummaryStepPage = lazy(() =>
      import('./pages/SummaryStepPage').then((module) => ({
        default: module.SummaryStepPage,
      })),
    );
    ```
    Then replace the `OnboardingPlaceholderPage` element for `path: 'summary'` with `withSuspense(SummaryStepPage)`
  - [x] 4.2 Update `src/features/sharing/index.ts` to export `SummaryStepPage`

- [x] Task 5: Tests (AC: 1–7)
  - [x] 5.1 Unit test: page loads and displays identity section (name + color badge)
  - [x] 5.2 Unit test: page displays room assignment when one exists
  - [x] 5.3 Unit test: page displays "Not yet assigned" when no room assignment
  - [x] 5.4 Unit test: page displays transport entries when they exist
  - [x] 5.5 Unit test: page displays "None added" when no transports
  - [x] 5.6 Unit test: missing localStorage identity redirects to identity step
  - [x] 5.7 Unit test: tapping identity section navigates to `/share/:shareId/identity`
  - [x] 5.8 Unit test: tapping room section navigates to `/share/:shareId/room`
  - [x] 5.9 Unit test: tapping transport section navigates to `/share/:shareId/transport`
  - [x] 5.10 Unit test: "Enter trip" button calls `setCurrentTrip(trip.id)` and navigates to `/trips/:tripId/calendar`
  - [x] 5.11 Unit test: "Enter trip" sets wizard-complete flag in localStorage
  - [x] 5.12 Unit test: loading state shown while data loads
  - [x] 5.13 Unit test: not-found trip shows friendly error card
  - [x] 5.14 Unit test: i18n — text nodes use translation keys (keys returned as-is by mock)
  - [x] 5.15 Unit test: submit error shows error message and allows retry

- [x] Task 6: Verification
  - [x] 6.1 `bunx tsc --noEmit` — 0 errors
  - [x] 6.2 `bun run lint` — no new warnings or errors beyond baseline (34 pre-existing)
  - [x] 6.3 `bun run test:run` — all tests pass (baseline ~1379 + new)

## Dev Notes

### Developer Context (Read First)

This is **Story 2.5 of Epic 2 (Guest Onboarding)**. It replaces the `OnboardingPlaceholderPage` stub for the `/share/:shareId/summary` route with the final wizard summary step. The wizard flow is:

```
/share/:shareId           → Story 2.1: Welcome screen (DONE)
/share/:shareId/identity  → Story 2.2: Identity step (DONE)
/share/:shareId/room      → Story 2.3: Room selection (DONE)
/share/:shareId/transport → Story 2.4: Transport entry (DONE, in review)
/share/:shareId/summary   → Story 2.5: Summary & trip entry (THIS STORY)
```

**Critical constraint (AR-10):** The entire `/share/:shareId/*` subtree is **outside `AppProviders`**. There is NO `useTripContext()`, `useTransportContext()`, `usePersonContext()`, or any context hook available. All data access MUST go through direct repository calls from `@/lib/db`.

**This step is a read-heavy display page with ONE action.** Unlike previous steps (forms, selections), the summary page primarily displays data already collected. The only write action is `setCurrentTrip()` + localStorage flag when the guest taps "Enter trip".

### Repository Functions Needed

All imports from `@/lib/db`:

```typescript
import { getTripByShareId } from '@/lib/db/repositories/trip-repository';
import { getPersonById } from '@/lib/db/repositories/person-repository';
import { getAssignmentsByPersonId } from '@/lib/db/repositories/assignment-repository';
import { getRoomById } from '@/lib/db/repositories/room-repository';
import { getTransportsByPersonId } from '@/lib/db/repositories/transport-repository';
import { setCurrentTrip } from '@/lib/db/repositories/settings-repository';
```

**Function signatures:**
- `getTripByShareId(shareId: ShareId): Promise<Trip | undefined>`
- `getPersonById(id: PersonId): Promise<Person | undefined>`
- `getAssignmentsByPersonId(personId: PersonId): Promise<RoomAssignment[]>`
- `getRoomById(id: RoomId): Promise<Room | undefined>`
- `getTransportsByPersonId(personId: PersonId): Promise<Transport[]>`
- `setCurrentTrip(tripId: TripId | undefined): Promise<void>`

### Getting tripId from the URL

The `/share/:shareId/summary` route does NOT have a `tripId` param — only `shareId`. Call `getTripByShareId(shareId as ShareId)` on mount (exactly as previous wizard steps do). Store `trip` in state for all subsequent calls.

### Getting the Guest personId

Read from localStorage under key `kikouchou_guest_${shareId}`:

```typescript
const GUEST_STORAGE_KEY = (shareId: string) => `kikouchou_guest_${shareId}`;

interface StoredGuestIdentity {
  personId: string;
  tripId: string;
}
```

If the stored identity is missing or invalid, redirect to `/share/${shareId}/identity`. This is the same guard pattern used in RoomSelectionStepPage and TransportEntryStepPage.

### Wizard Completion Flag

When the guest taps "Enter trip", set a localStorage flag:

```typescript
const WIZARD_COMPLETE_KEY = (shareId: string) => `kikouchou_wizard_complete_${shareId}`;

// On "Enter trip" action:
localStorage.setItem(WIZARD_COMPLETE_KEY(shareId), 'true');
```

This flag is checked by `ShareImportPage` (Story 2.1) — returning guests who have this flag get redirected straight to the trip dashboard instead of the wizard.

### Data Loading Strategy

Load all guest data in a single `useEffect` after identity guard passes:

```typescript
const [trip, setTrip] = useState<Trip | undefined>();
const [guest, setGuest] = useState<Person | undefined>();
const [claimedRoom, setClaimedRoom] = useState<Room | undefined>();
const [transports, setTransports] = useState<Transport[]>([]);
const [isLoading, setIsLoading] = useState(true);
const [notFound, setNotFound] = useState(false);

useEffect(() => {
  let cancelled = false;

  async function loadData(): Promise<void> {
    if (!shareId || !guestPersonId) {
      if (!cancelled && isMountedRef.current) {
        setNotFound(true);
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    try {
      const tripData = await getTripByShareId(shareId as ShareId);
      if (cancelled || !isMountedRef.current) return;
      if (!tripData) { setNotFound(true); return; }
      setTrip(tripData);

      // Load guest person
      const personData = await getPersonById(guestPersonId);
      if (cancelled || !isMountedRef.current) return;
      if (personData) setGuest(personData);

      // Load room assignment for this guest in this trip
      const assignments = await getAssignmentsByPersonId(guestPersonId);
      if (cancelled || !isMountedRef.current) return;
      const tripAssignment = assignments.find(a => a.tripId === tripData.id);
      if (tripAssignment) {
        const room = await getRoomById(tripAssignment.roomId);
        if (!cancelled && isMountedRef.current && room) setClaimedRoom(room);
      }

      // Load transports for this guest in this trip
      const allTransports = await getTransportsByPersonId(guestPersonId);
      if (!cancelled && isMountedRef.current) {
        setTransports(allTransports.filter(t => t.tripId === tripData.id));
      }
    } catch (error) {
      console.error('Failed to load summary data:', error);
      if (!cancelled && isMountedRef.current) setNotFound(true);
    } finally {
      if (!cancelled && isMountedRef.current) setIsLoading(false);
    }
  }

  void loadData();
  return () => { cancelled = true; };
}, [shareId, guestPersonId]);
```

### "Enter Trip" Handler

```typescript
const handleEnterTrip = useCallback(async (): Promise<void> => {
  if (isSubmittingRef.current || !trip) return;

  isSubmittingRef.current = true;
  setIsSubmitting(true);
  setSubmitError(undefined);

  try {
    await setCurrentTrip(trip.id);
    if (!isMountedRef.current) return;

    // Mark wizard as completed for this share link
    localStorage.setItem(`kikouchou_wizard_complete_${shareId}`, 'true');

    // Navigate INTO the context boundary
    navigate(`/trips/${trip.id}/calendar`);
  } catch (error) {
    console.error('Failed to enter trip:', error);
    if (isMountedRef.current) {
      setSubmitError(t('sharing.enterTripError', 'Failed to enter trip. Please try again.'));
    }
  } finally {
    isSubmittingRef.current = false;
    if (isMountedRef.current) setIsSubmitting(false);
  }
}, [trip, shareId, navigate, t]);
```

### Visual Design (Amber Theme)

Consistent with the amber theme established in Stories 2.1–2.4:

- **Page background:** `bg-gradient-to-b from-amber-50 to-orange-50 min-h-svh`
- **Card wrapper:** `border-amber-200 shadow-lg max-w-md mx-auto`
- **Header icon:** `bg-amber-100` circle with a checkmark-related Lucide icon (e.g., `ClipboardCheck` or `CheckCircle2`) in `text-amber-600`
- **Title:** `text-2xl font-bold text-amber-900` — e.g., "You're all set!"
- **Subtitle:** `text-sm text-amber-700` — e.g., "Here's a summary of your trip setup"

**Summary Section Cards** (each section is a tappable card):

```
┌──────────────────────────────────────┐
│ 👤 Identity              [Change →] │
│ ● Lucas (color dot)                 │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ 🛏️ Room                  [Change →] │
│ Chambre du Jardin (2/4 spots)       │
│  — OR —                             │
│ Not yet assigned                    │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐
│ 🚂 Transport             [Change →] │
│ Arrival: Jul 15 at 14:30            │
│ Gare de Vannes · Needs pickup       │
│ Departure: Jul 22 at 10:00          │
│ Gare de Vannes                      │
│  — OR —                             │
│ None added                          │
└──────────────────────────────────────┘
```

- **Section cards:** `bg-white rounded-lg border border-amber-200 p-4 cursor-pointer hover:border-amber-300 transition-colors`
- **Section header:** `flex items-center justify-between` — icon + label left, "Change" link right
- **Section label:** `text-sm font-medium text-amber-900`
- **"Change" link:** `text-sm text-amber-600 hover:text-amber-700` — right-aligned
- **Section content:** `text-sm text-amber-800 mt-1`
- **Empty state text:** `text-sm text-amber-500 italic` — "Not yet assigned" / "None added"
- **Person color dot:** Inline `w-3 h-3 rounded-full` with `style={{ backgroundColor: guest.color }}`
- **Transport entries:** Stack vertically inside the section card, same compact format as TransportEntryStepPage summary cards

**CTA Button:**
- **"Let's go!" / "Enter trip":** `bg-amber-500 text-white hover:bg-amber-600 h-12 w-full text-base font-semibold rounded-lg` — prominent at the bottom
- **Error message below button:** `text-red-600 text-sm mt-2` with `role="alert"`

### Technical Requirements

1. **Repository-only data access** — `getTripByShareId`, `getPersonById`, `getAssignmentsByPersonId`, `getRoomById`, `getTransportsByPersonId`, `setCurrentTrip` from `@/lib/db`. No context hooks.
2. **Get tripId from shareId** — call `getTripByShareId(shareId as ShareId)` on mount; handle loading/not-found states.
3. **Inline form validation** — none needed for this step (no form fields). Only guard the submit button.
4. **`isSubmittingRef` + `isMountedRef` pattern** — use `useRef(false)` guards + `try/catch/finally` for "Enter trip". Follow `TransportEntryStepPage.tsx` exactly.
5. **Branded types** — `shareId as ShareId`, `trip.id as TripId`, `personId as PersonId`, `assignment.roomId as RoomId`.
6. **i18n** — all text via `t('key', 'fallback')`. Never hardcode. New keys under `sharing.*`.
7. **Tailwind only** — no inline styles (exception: person color dot uses `style={{ backgroundColor }}`), no CSS modules.
8. **`memo(function Name(){})`** — named function inside `memo` for `displayName`.
9. **`undefined` not `null`** for optional fields.
10. **Touch targets** — all interactive elements ≥ 44×44px (NFR13). Use `h-12` on buttons, `min-h-[44px]` on tappable sections.
11. **Mobile-first** — sections stack vertically, full-width on mobile.
12. **Accessibility** — `aria-label` on tappable sections ("Change identity", "Change room", etc.), `role="alert"` on error messages, `aria-describedby` for button+error association.

### Architecture Compliance

- Share route boundary: `/share/:shareId/*` is outside `AppProviders`. [Source: architecture.md#ARCHITECTURAL RULE: Share Route Boundary]
- Data access boundary: Components → Repository functions → Dexie. NEVER call `db.*` directly from components. [Source: architecture.md#Data Access Boundary]
- Feature module structure: pages in `src/features/sharing/pages/`, no new feature folder. [Source: architecture.md#Feature Module Structure]
- Lazy routes: wrap in `<ErrorBoundary><Suspense>` (already handled in `routes.tsx` via `withSuspense()`). [Source: architecture.md#Code splitting]
- Context boundary crossing: after `setCurrentTrip()`, navigate to `/trips/:tripId/calendar` which IS inside `AppProviders`. [Source: architecture.md#Share Import Flow]

### Library/Framework Requirements

- **React 19.2** — functional components, hooks only
- **react-router-dom 7.13** — `useParams`, `useNavigate`
- **react-i18next** — `useTranslation()`
- **shadcn/ui** — `Card`, `CardContent`, `CardHeader`, `CardTitle`, `Button`, `Badge`
- **Lucide React** — icons (`ClipboardCheck`, `User`, `Bed`, `Train`, `Plane`, `Car`, `Bus`, `ChevronRight`, etc.)
- **NO** new dependencies — everything needed is already installed

### File Structure Requirements

```
src/features/sharing/
├── pages/
│   ├── SummaryStepPage.tsx                    ← NEW (this story)
│   └── __tests__/
│       └── SummaryStepPage.test.tsx           ← NEW (this story)
├── routes.tsx                                  ← MODIFY (swap placeholder for SummaryStepPage)
└── index.ts                                   ← MODIFY (add SummaryStepPage export)
src/locales/en/translation.json                ← MODIFY (add sharing.summary* keys)
src/locales/fr/translation.json                ← MODIFY (add sharing.summary* keys)
```

### Testing Requirements

Follow the same test patterns as `TransportEntryStepPage.test.tsx`:

- Mock `@/lib/db` repositories:
  ```typescript
  vi.mock('@/lib/db/repositories/trip-repository', () => ({
    getTripByShareId: vi.fn(),
  }));
  vi.mock('@/lib/db/repositories/person-repository', () => ({
    getPersonById: vi.fn(),
  }));
  vi.mock('@/lib/db/repositories/assignment-repository', () => ({
    getAssignmentsByPersonId: vi.fn(),
  }));
  vi.mock('@/lib/db/repositories/room-repository', () => ({
    getRoomById: vi.fn(),
  }));
  vi.mock('@/lib/db/repositories/transport-repository', () => ({
    getTransportsByPersonId: vi.fn(),
  }));
  vi.mock('@/lib/db/repositories/settings-repository', () => ({
    setCurrentTrip: vi.fn(),
  }));
  ```
- Mock `react-router-dom`: `useParams` returns `{ shareId: 'test-share-id' }`, `useNavigate` returns `vi.fn()`
- Mock `react-i18next`: `useTranslation` returns `{ t: (key: string) => key, i18n: { language: 'en' } }`
- Mock `localStorage.getItem` / `localStorage.setItem`
- Use `@testing-library/react` + `@testing-library/user-event` for component rendering and interaction
- Test file location: `src/features/sharing/pages/__tests__/SummaryStepPage.test.tsx`

### Previous Story Intelligence (from Story 2.4)

**Patterns established:**
- Guest identity guard: read localStorage → redirect if missing/invalid → set `guestPersonId` state
- Async load pattern: `useEffect` with `cancelled` flag + `isMountedRef` + `try/catch/finally`
- Form submit pattern: `isSubmittingRef` guard + `setIsSubmitting` + `try/catch/finally`
- Transport summary cards: compact `bg-white rounded-lg border border-amber-200 p-3` with icon + datetime + location
- Amber theme: all wizard steps use consistent amber gradient + amber-* color palette

**Baseline metrics (from Story 2.4):**
- TypeScript: 0 errors
- Lint: 34 pre-existing warnings (baseline)
- Tests: 1379 total passing

### References

- [Source: epics.md#Epic 2 - Story 2.5: Summary and Trip Entry]
- [Source: architecture.md#ARCHITECTURAL RULE: Share Route Boundary]
- [Source: architecture.md#Share Import Flow]
- [Source: architecture.md#Data Architecture - Entity Relationship Model]
- [Source: architecture.md#Component Architecture - Code splitting]
- [Source: architecture.md#State Management - Context Provider Nesting]
- [Source: ux-design-specification.md#Guest Onboarding Wizard]
- [Source: prd.md#UX-1 Guest Onboarding Wizard - under 2 minutes target]
- [Source: 2-4-transport-entry-step.md#Dev Notes - patterns and conventions]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation, all tests passed first run.

### Completion Notes List

- Created `SummaryStepPage.tsx` — final wizard step displaying identity, room, and transport summary sections as tappable cards with amber theme
- Each section navigates back to its wizard step using `navigate()` (not `replace`) for browser back support
- "Let's go!" button calls `setCurrentTrip(trip.id)`, sets `kikouchou_wizard_complete_${shareId}` localStorage flag, then navigates to `/trips/:tripId/calendar`
- Full identity guard pattern with localStorage read + cross-validation (matching TransportEntryStepPage)
- `isMountedRef` + `isSubmittingRef` + cancelled-flag pattern for async safety
- 16 i18n keys added to EN and FR translations under `sharing.summary*`
- Wired into routes.tsx (lazy import replacing `OnboardingPlaceholderPage` stub) and index.ts barrel export
- 16 unit tests covering all ACs: identity display, room display/empty, transport display/empty, navigation, enter trip, wizard-complete flag, loading, not-found, i18n, error retry
- TypeScript: 0 errors | Lint: no new warnings | Tests: 1395 total passing (1379 baseline + 16 new)

### Change Log

- 2026-03-22: Story 2.5 implementation complete — SummaryStepPage created with all ACs satisfied

### File List

- `src/features/sharing/pages/SummaryStepPage.tsx` — NEW
- `src/features/sharing/pages/__tests__/SummaryStepPage.test.tsx` — NEW
- `src/features/sharing/routes.tsx` — MODIFIED (lazy import + route swap)
- `src/features/sharing/index.ts` — MODIFIED (added SummaryStepPage export)
- `src/locales/en/translation.json` — MODIFIED (16 new sharing.summary* keys)
- `src/locales/fr/translation.json` — MODIFIED (16 new sharing.summary* keys)
