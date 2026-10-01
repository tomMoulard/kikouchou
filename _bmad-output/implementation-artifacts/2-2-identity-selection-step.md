# Story 2.2: Identity Selection Step

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **guest**,
I want to select myself from the participant list or add myself,
so that the app knows who I am for room and transport assignments.

## Acceptance Criteria

1. **Given** the guest proceeds from the welcome screen (taps "Get Started" on `/share/:shareId`)
   **When** the identity step loads at `/share/:shareId/identity`
   **Then** all trip participants are displayed as selectable cards with name and color swatch, fetched via `getPersonsByTripId()` (direct repository call — AR-10, no context hooks)

2. **Given** the guest finds their name in the list
   **When** they tap their name card
   **Then** the card shows a clear visual selected state (ring/border highlight using their color) and a checkmark indicator

3. **Given** the guest is not yet in the participant list
   **When** they tap "I'm not on the list" / "Add myself"
   **Then** a compact inline form appears (no dialog/modal) with a name text input and a color auto-assigned from the palette; `createPersonWithAutoColor()` is called directly on submit

4. **Given** the guest has selected (or created) their identity
   **When** they tap "Next"
   **Then** their identity is stored to `localStorage` under key `kikouchou_guest_${shareId}` as `{ personId: string, tripId: string }` and navigation proceeds to `/share/:shareId/room`

5. **Given** all text in the identity step
   **When** it is rendered
   **Then** all strings use i18n keys (FR/EN) with fallbacks — no hardcoded text

## Tasks / Subtasks

- [x] Task 1: Replace `OnboardingPlaceholderPage` for the `/identity` route (AC: 1, 2, 3, 5)
  - [x] 1.1 Create `src/features/sharing/pages/IdentityStepPage.tsx` — the identity wizard step page
  - [x] 1.2 Fetch participants with `getPersonsByTripId(tripId as TripId)` inside a `useEffect` on mount; show `<LoadingState />` while fetching and `<ErrorDisplay />` on failure
  - [x] 1.3 Render each person as a selectable card showing name + color swatch (filled circle, same pattern as `PersonBadge`); selected state uses a ring matching the person's color
  - [x] 1.4 Add "I'm not on the list" section at the bottom: tap reveals inline name input + "Add myself" submit button; on submit call `createPersonWithAutoColor(tripId, name.trim())` directly
  - [x] 1.5 Add all new i18n keys to `src/locales/en/translation.json` and `src/locales/fr/translation.json`

- [x] Task 2: Wire the identity step into the routing scaffold (AC: 4)
  - [x] 2.1 Update `src/features/sharing/routes.tsx`: replace the `OnboardingPlaceholderPage` element for `path: 'identity'` with lazy-loaded `IdentityStepPage`
  - [x] 2.2 On "Next", write `localStorage.setItem(kikouchou_guest_${shareId}, JSON.stringify({ personId, tripId }))` before navigating to `/share/:shareId/room`
  - [x] 2.3 Keep `OnboardingPlaceholderPage` in place for `room`, `transport`, `summary` routes (stories 2.3–2.5)
  - [x] 2.4 Update `src/features/sharing/index.ts` to export `IdentityStepPage`

- [x] Task 3: Tests (AC: 1–5)
  - [x] 3.1 Unit test: participants load and render as selectable cards (mock `getPersonsByTripId`)
  - [x] 3.2 Unit test: selecting a participant updates visual selection state
  - [x] 3.3 Unit test: tapping "I'm not on the list" reveals inline form
  - [x] 3.4 Unit test: submitting "Add myself" form calls `createPersonWithAutoColor` and selects the new person
  - [x] 3.5 Unit test: tapping "Next" writes localStorage key and navigates to `/share/:shareId/room`
  - [x] 3.6 Unit test: empty participant list shows the "Add myself" prompt prominently (not buried)
  - [x] 3.7 Unit test: i18n — text nodes use translation keys (keys returned as-is by mock)

- [x] Task 4: Verification
  - [x] 4.1 `bunx tsc --noEmit` — 0 errors
  - [x] 4.2 `bun run lint` — no new warnings or errors beyond baseline (34 pre-existing)
  - [x] 4.3 `bun run test:run` — all tests pass (1352 total: 1332 baseline + 20 new)

## Dev Notes

### Developer Context (Read First)

This is **Story 2.2 of Epic 2 (Guest Onboarding)**. It replaces the `OnboardingPlaceholderPage` stub for the `/share/:shareId/identity` route with a real identity selection step. The wizard flow is:

```
/share/:shareId           → Story 2.1: Welcome screen (DONE)
/share/:shareId/identity  → Story 2.2: Identity step (THIS STORY)
/share/:shareId/room      → Story 2.3: Room selection (stub, still placeholder)
/share/:shareId/transport → Story 2.4: Transport entry (stub, still placeholder)
/share/:shareId/summary   → Story 2.5: Summary (stub, still placeholder)
```

**Critical constraint (AR-10):** The entire `/share/:shareId/*` subtree is **outside `AppProviders`**. There is NO `useTripContext()`, `usePersonContext()`, or any context hook available. All data access MUST go through direct repository calls from `@/lib/db`:
- `getPersonsByTripId(tripId as TripId)` — to list participants
- `createPersonWithAutoColor(tripId as TripId, name)` — to add a new participant
- `getTripByShareId(shareId as ShareId)` — if you need the tripId from a shareId (see pattern in `ShareImportPage.tsx`)

**Getting tripId from the URL:** The `/share/:shareId/identity` route does NOT have a `tripId` param — only `shareId`. To get the `tripId`, call `getTripByShareId(shareId as ShareId)` on mount (exactly as `ShareImportPage` does). Store `trip.id` in state for all subsequent repository calls.

**localStorage key contract established in Story 2.1:**
```typescript
const GUEST_STORAGE_KEY = (shareId: string) => `kikouchou_guest_${shareId}`;

interface StoredGuestIdentity {
  personId: string;
  tripId: string;
}
```
Story 2.1's `ShareImportPage` already *reads* this key for returning-guest detection. Story 2.2 is where it is *written* (after identity is confirmed). Write it right before navigating to the next step.

**File to create:** `src/features/sharing/pages/IdentityStepPage.tsx`  
**Do NOT** create a new feature folder. Everything stays in `src/features/sharing/`.

### Technical Requirements

1. **Repository-only data access** — `getPersonsByTripId`, `createPersonWithAutoColor` from `@/lib/db`. No context hooks.
2. **Get tripId from shareId** — call `getTripByShareId(shareId as ShareId)` on mount; handle loading/not-found states with the canonical guard sequence.
3. **Inline form validation** — name field: non-empty after trim. No Zod in component layer.
4. **`useFormSubmission` pattern** — use `isMountedRef`, `isSubmittingRef`, `try/catch/finally` for the "Add myself" async submit (follow `ShareImportPage.tsx` pattern exactly).
5. **Branded types** — `shareId as ShareId`, `trip.id as TripId`, `personId as PersonId`.
6. **i18n** — all text via `t('key', 'fallback')`. Never hardcode.
7. **Tailwind only** — no inline styles, no CSS modules.
8. **memo(function Name(){})** — named function inside `memo` for `displayName`.
9. **`undefined` not `null`** for optional fields.
10. **Touch targets** — all interactive elements ≥ 44×44px (NFR13).

### Architecture Compliance

- Share route boundary: `/share/:shareId/*` is outside `AppProviders`. [Source: architecture.md#ARCHITECTURAL RULE: Share Route Boundary]
- Data access boundary: Components → Repository functions → Dexie. NEVER call `db.persons.*` directly. [Source: architecture.md#Data Access Boundary]
- Feature module structure: pages in `src/features/sharing/pages/`, components in `src/features/sharing/components/`. [Source: architecture.md#Feature Module Structure]
- Lazy routes: wrap in `<ErrorBoundary><Suspense>` (already handled in `routes.tsx` via `withSuspense()`). [Source: architecture.md#Code splitting]
- Context nesting order: MUST NOT change in `AppProviders.tsx`. [Source: architecture.md#ARCHITECTURAL RULE: Context Provider Nesting Order]
- Named export + `memo` pattern established in Story 1.8. All new components follow `export const Foo = memo(function Foo() {})`.

### Library / Framework Requirements

- React 19 + TypeScript strict.
- React Router DOM 7.x: `useNavigate`, `useParams` (for `shareId`).
- `react-i18next`: `useTranslation()` hook; all text via `t('key', 'fallback')`.
- `sonner`: `toast.error(t('key'))` for DB errors.
- Lucide React: `Check` icon for selected state; `aria-hidden="true"` on decorative icons.
- `@/components/shared/LoadingState` — show while trip + persons are fetching.
- `@/components/shared/ErrorDisplay` — show if trip not found or persons fail to load.
- `@/components/ui/button` — for "Next", "Add myself", "I'm not on the list" buttons.
- `@/components/ui/input` — for the inline name input field.
- `@/components/ui/card` — for the page card wrapper (amber theme, same as welcome screen).
- **No new dependencies.**

### File Structure Requirements

**New files:**
- `src/features/sharing/pages/IdentityStepPage.tsx` — the identity step component

**Files to modify:**
- `src/features/sharing/routes.tsx` — replace `OnboardingPlaceholderPage` element for `path: 'identity'` with lazy-loaded `IdentityStepPage`
- `src/features/sharing/index.ts` — export `IdentityStepPage`
- `src/locales/en/translation.json` — add new `sharing.identity.*` keys
- `src/locales/fr/translation.json` — add French translations

**Files NOT to touch:**
- `src/features/sharing/pages/OnboardingPlaceholderPage.tsx` — keep for routes `room`, `transport`, `summary`
- `src/contexts/` — no changes to context providers
- `src/features/sharing/pages/ShareImportPage.tsx` — do not modify unless fixing a bug

**Test file:**
- `src/features/sharing/pages/__tests__/IdentityStepPage.test.tsx` — create new

### i18n Keys Required

Add to both `src/locales/en/translation.json` and `src/locales/fr/translation.json` under the `sharing` object:

**English:**
```json
"identityTitle": "Who are you?",
"identitySubtitle": "Select yourself from the list below",
"identityNotOnList": "I'm not on the list",
"identityAddMyself": "Add myself",
"identityAddName": "Your name",
"identityNext": "Next",
"identitySelected": "Selected",
"identityEmptyList": "No participants yet. Add yourself to get started!",
"identityNameRequired": "Please enter your name",
"identityAdding": "Adding..."
```

**French:**
```json
"identityTitle": "Qui êtes-vous ?",
"identitySubtitle": "Sélectionnez-vous dans la liste ci-dessous",
"identityNotOnList": "Je ne suis pas dans la liste",
"identityAddMyself": "M'ajouter",
"identityAddName": "Votre prénom",
"identityNext": "Suivant",
"identitySelected": "Sélectionné",
"identityEmptyList": "Aucun participant pour l'instant. Ajoutez-vous pour commencer !",
"identityNameRequired": "Veuillez entrer votre prénom",
"identityAdding": "Ajout en cours..."
```

### localStorage Write — Implementation Detail

Write this right before `navigate(`/share/${shareId}/room`)` in the "Next" handler:

```typescript
const GUEST_STORAGE_KEY = (shareId: string) => `kikouchou_guest_${shareId}`;

interface StoredGuestIdentity {
  personId: string;
  tripId: string;
}

// Write identity to localStorage before proceeding
try {
  const identity: StoredGuestIdentity = {
    personId: selectedPersonId,
    tripId: trip.id,
  };
  localStorage.setItem(GUEST_STORAGE_KEY(shareId), JSON.stringify(identity));
} catch {
  // Non-fatal: if localStorage write fails, continue anyway
  // Returning-guest detection in Story 2.1 won't work, but wizard can proceed
  console.warn('Failed to save guest identity to localStorage');
}
```

### Async Load Pattern (Canonical)

Follow exactly the same async load pattern as `ShareImportPage.tsx`:

```typescript
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

      const persons = await getPersonsByTripId(trip.id);
      if (cancelled || !isMountedRef.current) return;

      setTrip(trip);
      setPersons(persons);
    } catch (error) {
      console.error('Failed to load identity step data:', error);
      if (!cancelled && isMountedRef.current) setNotFound(true);
    } finally {
      if (!cancelled && isMountedRef.current) setIsLoading(false);
    }
  }

  void loadData();
  return () => { cancelled = true; };
}, [shareId]);
```

### "Add Myself" Inline Form Pattern

Show/hide with a boolean `showAddForm` state. Do NOT use a dialog — it must be inline on the page. Validate name is non-empty on submit. Pattern:

```typescript
const [showAddForm, setShowAddForm] = useState(false);
const [newName, setNewName] = useState('');
const [nameError, setNameError] = useState<string | undefined>();
const isSubmittingRef = useRef(false);
const [isAdding, setIsAdding] = useState(false);

const handleAddMyself = useCallback(async (): Promise<void> => {
  if (isSubmittingRef.current || !trip) return;
  const trimmedName = newName.trim();
  if (!trimmedName) {
    setNameError(t('sharing.identityNameRequired'));
    return;
  }
  setNameError(undefined);
  isSubmittingRef.current = true;
  setIsAdding(true);
  try {
    const person = await createPersonWithAutoColor(trip.id, trimmedName);
    if (isMountedRef.current) {
      setPersons(prev => [...prev, person]);
      setSelectedPersonId(person.id);
      setShowAddForm(false);
      setNewName('');
    }
  } catch (error) {
    console.error('Failed to create person:', error);
    if (isMountedRef.current) toast.error(t('errors.saveFailed'));
  } finally {
    isSubmittingRef.current = false;
    if (isMountedRef.current) setIsAdding(false);
  }
}, [newName, trip, t]);
```

### Person Card Visual Design

Consistent with the amber theme established in Story 2.1:

- Card: `cursor-pointer rounded-xl border-2 p-4 transition-colors`
- Unselected: `border-amber-200 bg-white hover:border-amber-300`
- Selected: `border-amber-500 bg-amber-50 ring-2 ring-amber-500`
- Color swatch: `size-8 rounded-full flex-shrink-0` with `style={{ backgroundColor: person.color }}`
- Person name: `font-medium text-amber-900`
- Check icon: `size-5 text-amber-600` visible only when selected, `aria-hidden="true"`
- Touch target: entire card is the tap target (min-h-[52px] to safely exceed 44px — NFR13)

### Testing Requirements

- Test file: `src/features/sharing/pages/__tests__/IdentityStepPage.test.tsx`
- Use `render` from `@/test/utils` with `{ withProviders: false }` — page is outside `AppProviders`
- Wrap in `MemoryRouter` with `initialEntries={['/share/abc123/identity']}`
- Use `Routes`/`Route` from `react-router-dom` if `useParams` is needed, or mock the module
- Mock `@/lib/db` module:
  ```typescript
  vi.mock('@/lib/db', () => ({
    getTripByShareId: vi.fn(),
    getPersonsByTripId: vi.fn(),
    createPersonWithAutoColor: vi.fn(),
  }));
  ```
- Mock `localStorage` using `vi.spyOn(Storage.prototype, 'setItem')` and `vi.spyOn(Storage.prototype, 'getItem')`
- `fake-indexeddb/auto` is auto-imported from test setup — no manual setup needed
- i18n is mocked — `t('key')` returns the key string
- Existing test baseline: 1332 passing; add ~7 new tests

### Previous Story Intelligence (2.1)

- `ShareImportPage.tsx` is the canonical pattern for this story's async load and `isMountedRef` usage — read it carefully before implementing.
- Story 2.1 established the `getStoredGuestIdentity(shareId)` function that *reads* from localStorage. This story *writes* to that same key. The key and interface shape MUST match: `kikouchou_guest_${shareId}` → `{ personId: string, tripId: string }`.
- Story 2.1 confirmed: `Palmtree` icon (lucide-react), amber gradient background (`from-amber-50 to-orange-50`), amber card theme (`border-amber-200`). Reuse this design language.
- Story 2.1 added the wizard sub-routes to `routes.tsx`; the `withSuspense()` helper is already defined there. Use it for `IdentityStepPage`.
- Story 2.1 created `OnboardingPlaceholderPage` — it stays for routes `room`, `transport`, `summary` until those stories are implemented.
- Baseline: 1332 tests passing, 34 lint errors (pre-existing in E2E/unrelated files), 0 TypeScript errors.

### Git Intelligence

- Recent commits: `chore: add opencode` (0a8ec67), `2.1` (4020ef4), `chore: upgrade bmad` (f4558ef), `feat: 1.8` (9d80edd)
- Convention: story commits use short identifiers — `feat: 2.2` or `feat: story 2.2`
- Epic 2 is in-progress (set by story 2.1)

### UX Requirements (from UX Design Spec)

- **"Who are you?" is step 2 of 5** in the wizard. Must be fast: one choice, one tap. [Source: ux-design-specification.md#Design Opportunities, item 1]
- **Participant cards** should be visually distinct and easy to tap on mobile (standing at a train station with luggage). Large touch targets (≥44px), clear visual hierarchy.
- **"I'm not on the list"** must be visually accessible but not dominant — it's the fallback, not the primary action. Show it below the participant list.
- **Empty list state:** If no participants yet, show a friendly message and make the "add yourself" form immediately visible (don't hide it behind a button).
- **Mobile-first:** The list of people cards stacks vertically. Each card is a full-width row with color swatch + name + optional checkmark.

### Project Context

- Project: kikouchou — vacation house coordination PWA. No backend. IndexedDB (Dexie.js). Offline-first.
- This story is in the wizard flow, outside AppProviders. Pattern established by Story 2.1.
- Epic 2 goal: first-time guests can self-service setup in under 2 minutes.
- After this story: story 2.3 (room selection) will read the stored guest identity to pre-select the person.

### References

- Story definition + AC: [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2: Identity Selection Step]
- Epic 2 context: [Source: _bmad-output/planning-artifacts/epics.md#Epic 2: Guest Onboarding Experience]
- Share route boundary rule (AR-10): [Source: _bmad-output/planning-artifacts/architecture.md#ARCHITECTURAL RULE: Share Route Boundary]
- Async load pattern reference: `src/features/sharing/pages/ShareImportPage.tsx`
- Available repository functions: `getPersonsByTripId`, `createPersonWithAutoColor`, `getTripByShareId` [Source: src/lib/db/index.ts]
- Wizard routes scaffold: [Source: src/features/sharing/routes.tsx]
- localStorage key contract: [Source: _bmad-output/implementation-artifacts/2-1-share-link-landing-and-welcome-screen.md#Returning Guest Detection — Implementation Detail]
- Branded types: `TripId`, `PersonId`, `ShareId` [Source: src/types/index.ts]
- Default person colors: `DEFAULT_PERSON_COLORS`, `getDefaultPersonColor()` [Source: src/types/index.ts]
- `createPersonWithAutoColor` auto-selects color from palette [Source: src/lib/db/repositories/person-repository.ts]
- Amber visual theme: [Source: src/features/sharing/pages/ShareImportPage.tsx]
- `ColorPicker` component (reference for color swatch style): [Source: src/components/shared/ColorPicker.tsx]
- Touch target requirement (NFR13, 44px minimum): [Source: _bmad-output/planning-artifacts/architecture.md#Accessibility]
- Test utilities: [Source: src/test/utils.tsx]

## Dev Agent Record

### Agent Model Used

anthropic/claude-sonnet-4-6

### Debug Log References

_No debug issues encountered._

### Completion Notes List

- Implemented `IdentityStepPage` following the canonical `ShareImportPage` async-load pattern (cancelled flag + isMountedRef).
- Used repository-only data access (AR-10): `getTripByShareId`, `getPersonsByTripId`, `createPersonWithAutoColor` — no context hooks.
- Person card buttons use `aria-pressed` and `aria-label` for accessible selection state; color swatch uses inline `style` per spec.
- Empty list state shows the inline "Add myself" form immediately (not behind a toggle button) per UX spec.
- localStorage write is wrapped in try/catch (non-fatal) before navigation to `/share/:shareId/room`.
- Added 10 EN + 10 FR i18n keys under `sharing.identity*`.
- All 20 new tests pass; 0 TypeScript errors; 34 lint errors (all pre-existing baseline).

### File List

- `src/features/sharing/pages/IdentityStepPage.tsx` (new)
- `src/features/sharing/pages/__tests__/IdentityStepPage.test.tsx` (new)
- `src/features/sharing/routes.tsx` (modified — replaced identity route stub with IdentityStepPage)
- `src/features/sharing/index.ts` (modified — added IdentityStepPage export)
- `src/locales/en/translation.json` (modified — added sharing.identity* keys)
- `src/locales/fr/translation.json` (modified — added sharing.identity* keys)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — status: in-progress → review)
- `_bmad-output/implementation-artifacts/2-2-identity-selection-step.md` (modified — tasks checked, status updated)

## Change Log

- 2026-03-16: Story 2.2 implemented — IdentityStepPage created, routes wired, tests added (anthropic/claude-sonnet-4-6)
