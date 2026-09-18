# Story 2.4: Transport Entry Step

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **guest**,
I want to enter my arrival and departure details during onboarding,
so that the group knows when I'm coming and whether I need a pickup.

## Acceptance Criteria

1. **Given** the guest proceeds from the room selection step (taps "Next" or "Skip" on `/share/:shareId/room`)
   **When** the transport entry step loads at `/share/:shareId/transport`
   **Then** a compact form is displayed with fields: type (arrival/departure toggle), date and time, station/location, transport mode (optional), transport number (optional), and a "Need pickup?" toggle

2. **Given** the guest fills in their arrival details
   **When** they toggle "Need pickup?" on and submit
   **Then** a transport record is created via `createTransport()` directly with `needsPickup: true`, and a success confirmation appears

3. **Given** the guest wants to add both arrival and departure
   **When** they submit the first transport
   **Then** the form resets with the opposite type pre-selected (if arrival was entered, departure is suggested) and an "Add another" option is visible

4. **Given** the guest wants to skip transport entry
   **When** they tap "Skip for now"
   **Then** they proceed to `/share/:shareId/summary` without transport records (can be added later)

5. **Given** all form inputs
   **When** they are displayed on mobile
   **Then** appropriate `inputMode` attributes are used (numeric for time, text for location) and touch targets meet 44x44px minimum (NFR13)

6. **Given** the guest has entered one or more transports
   **When** they view the step
   **Then** already-entered transports are shown as summary cards above the form with type, datetime, location, and needsPickup status

7. **Given** all text in the transport entry step
   **When** it is rendered
   **Then** all strings use i18n keys (FR/EN) with fallbacks — no hardcoded text

## Tasks / Subtasks

- [x] Task 1: Create `TransportEntryStepPage` component (AC: 1, 5, 6, 7)
  - [x] 1.1 Create `src/features/sharing/pages/TransportEntryStepPage.tsx` — the transport wizard step page
  - [x] 1.2 On mount: call `getTripByShareId(shareId as ShareId)` to get the trip; show `<LoadingState />` while loading, handle not-found with redirect or error display
  - [x] 1.3 Read stored guest identity from localStorage key `kikouchou_guest_${shareId}` → `{ personId, tripId }`; if not found, redirect to `/share/${shareId}/identity` (same guard pattern as RoomSelectionStepPage)
  - [x] 1.4 Load existing transports for the guest: call `getTransportsByPersonId(personId as PersonId)` to display already-entered transports as summary cards
  - [x] 1.5 Render form with: type toggle (arrival/departure), datetime input (`<input type="datetime-local">`), location text input, transport mode select (train/plane/car/bus/other — optional), transport number text input (optional), "Need pickup?" switch toggle
  - [x] 1.6 Show already-entered transports as compact summary cards above the form (type icon, datetime, location, needsPickup badge)
  - [x] 1.7 Add all new i18n keys to `src/locales/en/translation.json` and `src/locales/fr/translation.json` under the `sharing` object

- [x] Task 2: Implement form submission and "add another" logic (AC: 2, 3)
  - [x] 2.1 Inline validation: `datetime` required (must be valid date), `location` required (trimmed non-empty). `type` always has a value (defaults to `'arrival'`). Do NOT use Zod in the component (AR-12).
  - [x] 2.2 On submit: build `TransportFormData` with `personId` from stored identity, form values, `needsPickup` from toggle, optional fields as `undefined` if empty. Call `createTransport(trip.id, formData)`.
  - [x] 2.3 Wrap submit in `isSubmittingRef` guard + `try/catch/finally` per canonical pattern; reset loading state in `finally`.
  - [x] 2.4 On success: add the returned transport to local `enteredTransports` state array, show the new transport as a summary card, reset the form with the **opposite type** pre-selected (arrival → departure, departure → arrival), show a brief success indication.
  - [x] 2.5 "Next" / "Done" button navigates to `/share/${shareId}/summary`; enabled regardless of whether transports were entered (skip-friendly).

- [x] Task 3: Wire the transport step into routing (AC: 1, 4)
  - [x] 3.1 Update `src/features/sharing/routes.tsx`: add lazy import declaration at top (following the existing `RoomSelectionStepPage` pattern exactly):
    ```typescript
    const TransportEntryStepPage = lazy(() =>
      import('./pages/TransportEntryStepPage').then((module) => ({
        default: module.TransportEntryStepPage,
      })),
    );
    ```
    Then replace the `OnboardingPlaceholderPage` element for `path: 'transport'` with `withSuspense(TransportEntryStepPage)`
  - [x] 3.2 Update `src/features/sharing/index.ts` to export `TransportEntryStepPage`

- [x] Task 4: Tests (AC: 1–7)
  - [x] 4.1 Unit test: page loads with form fields visible (type toggle, datetime, location, mode, number, pickup switch)
  - [x] 4.2 Unit test: missing localStorage identity redirects to identity step
  - [x] 4.3 Unit test: filling in valid data and submitting calls `createTransport` with correct `TransportFormData`
  - [x] 4.4 Unit test: `needsPickup: true` toggle is passed through to `createTransport`
  - [x] 4.5 Unit test: after successful submit, transport appears as summary card and form resets with opposite type
  - [x] 4.6 Unit test: validation — empty datetime shows error, empty location shows error
  - [x] 4.7 Unit test: "Skip for now" navigates to `/share/:shareId/summary`
  - [x] 4.8 Unit test: "Next"/"Done" navigates to `/share/:shareId/summary`
  - [x] 4.9 Unit test: i18n — text nodes use translation keys (keys returned as-is by mock)
  - [x] 4.10 Unit test: loading state shown while data loads
  - [x] 4.11 Unit test: existing transports for guest are shown as summary cards on load

- [x] Task 5: Verification
  - [x] 5.1 `bunx tsc --noEmit` — 0 errors
  - [x] 5.2 `bun run lint` — no new warnings or errors beyond baseline (34 pre-existing)
  - [x] 5.3 `bun run test:run` — all tests pass (baseline 1363 + 16 new = 1379 total)

## Dev Notes

### Developer Context (Read First)

This is **Story 2.4 of Epic 2 (Guest Onboarding)**. It replaces the `OnboardingPlaceholderPage` stub for the `/share/:shareId/transport` route with a real transport entry step. The wizard flow is:

```
/share/:shareId           → Story 2.1: Welcome screen (DONE)
/share/:shareId/identity  → Story 2.2: Identity step (DONE)
/share/:shareId/room      → Story 2.3: Room selection (DONE)
/share/:shareId/transport → Story 2.4: Transport entry (THIS STORY)
/share/:shareId/summary   → Story 2.5: Summary (stub, still placeholder)
```

**Critical constraint (AR-10):** The entire `/share/:shareId/*` subtree is **outside `AppProviders`**. There is NO `useTripContext()`, `useTransportContext()`, `usePersonContext()`, or any context hook available. All data access MUST go through direct repository calls from `@/lib/db`:
- `getTripByShareId(shareId as ShareId)` — to get the trip from the URL shareId
- `createTransport(tripId, formData)` — to create a transport record
- `getTransportsByPersonId(personId as PersonId)` — to load existing transports for the guest (optional, for showing already-entered transports)

**Getting tripId from the URL:** The `/share/:shareId/transport` route does NOT have a `tripId` param — only `shareId`. Call `getTripByShareId(shareId as ShareId)` on mount (exactly as previous wizard steps do). Store `trip` in state for all subsequent calls.

**Getting the guest personId:** Read from localStorage under key `kikouchou_guest_${shareId}`:
```typescript
const GUEST_STORAGE_KEY = (shareId: string) => `kikouchou_guest_${shareId}`;

interface StoredGuestIdentity {
  personId: string;
  tripId: string;
}
```
If the stored identity is missing or invalid, redirect to `/share/${shareId}/identity` so the guest must identify themselves first. This is the same guard pattern used in RoomSelectionStepPage.

**This is a form-heavy step, NOT a selection step.** Unlike the room step (which is mostly a list of cards with buttons), this step is a form with multiple inputs. Keep it compact — guests are on mobile standing at a train station. The wizard target is under 2 minutes total.

### Form Fields and `TransportFormData`

The `TransportFormData` interface (from `src/types/index.ts`):

```typescript
export interface TransportFormData {
  personId: PersonId;           // From stored guest identity — NOT a form field
  type: TransportType;          // 'arrival' | 'departure' — toggle/radio
  datetime: ISODateTimeString;  // From <input type="datetime-local"> — convert to ISO
  location: string;             // Text input — station/airport name
  coordinates?: { readonly lat: number; readonly lon: number }; // OMIT in wizard — no map picker
  transportMode?: TransportMode; // 'train' | 'plane' | 'car' | 'bus' | 'other' — optional select
  transportNumber?: string;     // Text input — "TGV 8541" — optional
  driverId?: PersonId;          // OMIT in wizard — driver assigns themselves later
  needsPickup: boolean;         // Switch toggle — defaults to false
  notes?: string;               // OMIT in wizard — keep form minimal
}
```

**Fields to include in the wizard form (simplified from full TransportForm):**
1. **type** — arrival/departure toggle (default: `'arrival'`)
2. **datetime** — `<input type="datetime-local">` — required
3. **location** — text input — required
4. **transportMode** — select dropdown (train/plane/car/bus/other) — optional
5. **transportNumber** — text input — optional
6. **needsPickup** — switch toggle — default `false`

**Fields to OMIT from the wizard form (keep it compact):**
- `coordinates` — no LocationPicker / map in the wizard (too heavy for onboarding). Guest can add location details later from the main app.
- `driverId` — driver assigns themselves later. Not relevant during guest self-onboarding.
- `notes` — keep the form minimal. Can be added later from the full TransportForm.

**Building TransportFormData on submit:**
```typescript
const formData: TransportFormData = {
  personId: guestPersonId,          // From localStorage
  type: formType,                   // 'arrival' | 'departure'
  datetime: datetimeValue as ISODateTimeString,  // From input, converted to ISO
  location: locationValue.trim(),   // Trimmed text
  transportMode: modeValue || undefined,          // undefined if not selected
  transportNumber: numberValue.trim() || undefined, // undefined if empty
  needsPickup: needsPickupValue,    // boolean from switch
  // coordinates: omitted
  // driverId: omitted
  // notes: omitted
};

await createTransport(trip.id, formData);
```

### Datetime Handling

The `<input type="datetime-local">` returns values in format `"YYYY-MM-DDTHH:mm"`. The `ISODateTimeString` type is a plain `string` alias (NOT branded). Convert by appending `:00` for seconds if needed:

```typescript
// datetime-local gives "2026-07-15T14:30"
// ISODateTimeString is just `string` — no branding needed
const datetimeISO = datetimeInputValue as ISODateTimeString;
```

Look at how `TransportForm.tsx` handles this conversion (lines ~140-160). It uses helper functions `toDatetimeLocalValue()` and `fromDatetimeLocalValue()`. You can use a simpler approach since the wizard doesn't need to handle edit mode or timezone conversion — just take the input value directly.

**Validation:** Check that the datetime string parses to a valid Date:
```typescript
function isValidDatetime(value: string): boolean {
  return value.trim() !== '' && !isNaN(new Date(value).getTime());
}
```

### "Add Another" Flow

After successfully creating a transport:
1. Add the returned `Transport` to a local `enteredTransports: Transport[]` state
2. Show it as a compact summary card above the form
3. Reset the form fields:
   - Toggle type to the **opposite** of what was just entered (`arrival` → `departure`, `departure` → `arrival`)
   - Clear datetime, location, mode, number
   - Reset needsPickup to `false`
4. The guest can enter another transport or tap "Next" to proceed

This "add another" pattern means the form is always visible below any already-entered transports. The "Next" button should be visible at all times (not just after entering a transport) since the step is skippable.

### Async Load Pattern (Canonical)

Follow exactly the same pattern as `RoomSelectionStepPage.tsx` and `IdentityStepPage.tsx`:

```typescript
const isMountedRef = useRef(true);
const isSubmittingRef = useRef(false);

useEffect(() => () => { isMountedRef.current = false; }, []);

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
      const tripData = await getTripByShareId(shareId as ShareId);
      if (cancelled || !isMountedRef.current) return;
      if (!tripData) { setNotFound(true); return; }

      setTrip(tripData);

      // Optionally load existing transports for this guest
      if (guestPersonId) {
        const existing = await getTransportsByPersonId(guestPersonId);
        if (!cancelled && isMountedRef.current) {
          // Filter to only this trip's transports
          setEnteredTransports(existing.filter(t => t.tripId === tripData.id));
        }
      }
    } catch (error) {
      console.error('Failed to load transport entry data:', error);
      if (!cancelled && isMountedRef.current) setNotFound(true);
    } finally {
      if (!cancelled && isMountedRef.current) setIsLoading(false);
    }
  }

  void loadData();
  return () => { cancelled = true; };
}, [shareId, guestPersonId]);
```

### Guest Identity Guard Pattern

Same as RoomSelectionStepPage — read stored identity on mount, redirect to identity step if missing:

```typescript
const { shareId } = useParams<{ shareId: string }>();
const navigate = useNavigate();

useEffect(() => {
  const stored = localStorage.getItem(`kikouchou_guest_${shareId}`);
  if (!stored) {
    navigate(`/share/${shareId}/identity`, { replace: true });
    return;
  }
  try {
    const identity = JSON.parse(stored) as { personId: string; tripId: string };
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

### Form Submit Pattern

```typescript
const handleSubmit = useCallback(async (): Promise<void> => {
  if (isSubmittingRef.current || !trip || !guestPersonId) return;

  // Inline validation
  const newErrors: Record<string, string> = {};
  if (!isValidDatetime(datetime)) {
    newErrors.datetime = t('sharing.transportDatetimeRequired', 'Date and time is required');
  }
  if (!location.trim()) {
    newErrors.location = t('sharing.transportLocationRequired', 'Location is required');
  }
  if (Object.keys(newErrors).length > 0) {
    setErrors(newErrors);
    return;
  }

  isSubmittingRef.current = true;
  setIsSubmitting(true);
  setErrors({});

  try {
    const formData: TransportFormData = {
      personId: guestPersonId,
      type: transportType,
      datetime: datetime as ISODateTimeString,
      location: location.trim(),
      transportMode: transportMode || undefined,
      transportNumber: transportNumber.trim() || undefined,
      needsPickup,
    };

    const newTransport = await createTransport(trip.id, formData);
    if (!isMountedRef.current) return;

    // Add to local display list
    setEnteredTransports(prev => [...prev, newTransport]);

    // Reset form with opposite type
    setTransportType(transportType === 'arrival' ? 'departure' : 'arrival');
    setDatetime('');
    setLocation('');
    setTransportMode('');
    setTransportNumber('');
    setNeedsPickup(false);
  } catch (error) {
    console.error('Failed to create transport:', error);
    if (isMountedRef.current) {
      setErrors({ submit: t('sharing.transportCreateError', 'Failed to add transport. Please try again.') });
    }
  } finally {
    isSubmittingRef.current = false;
    if (isMountedRef.current) setIsSubmitting(false);
  }
}, [trip, guestPersonId, transportType, datetime, location, transportMode, transportNumber, needsPickup, t]);
```

### Visual Design (Amber Theme)

Consistent with the amber theme established in Stories 2.1, 2.2, and 2.3:

- **Page background:** `bg-gradient-to-b from-amber-50 to-orange-50 min-h-screen`
- **Card wrapper:** `border-amber-200 shadow-lg max-w-md mx-auto`
- **Header icon:** `bg-amber-100` circle with a transport-related Lucide icon (e.g., `Train`, `Plane`, or `MapPin`) in `text-amber-600`
- **Title:** `text-2xl font-bold text-amber-900`
- **Subtitle:** `text-sm text-amber-700`
- **Form labels:** `text-sm font-medium text-amber-900`
- **Inputs:** Standard shadcn/ui `<Input>` — `h-12` for mobile touch targets (≥44px)
- **Type toggle:** Two buttons side-by-side (arrival/departure) — active gets `bg-amber-500 text-white`, inactive gets `bg-white text-amber-700 border-amber-200`
- **Transport mode select:** shadcn/ui `<Select>` with `h-12` height
- **"Need pickup?" toggle:** shadcn/ui `<Switch>` with label
- **"Add transport" submit button:** `bg-amber-500 text-white hover:bg-amber-600 h-12 w-full text-base font-semibold`
- **"Skip for now" link/button:** Ghost variant, `text-amber-700 hover:bg-amber-50`
- **"Next" / "Done" button:** Same amber primary as submit, navigates to summary
- **Already-entered transport cards:** `bg-white rounded-lg border border-amber-200 p-3` with type icon, datetime, location text, and needsPickup badge if true
- **Error messages:** `text-red-600 text-sm` below the relevant input, with `role="alert"`

### Transport Summary Card Design

For transports already entered (shown above the form):

```
┌──────────────────────────────┐
│ 🚂 Arrival                   │
│ Jul 15, 2026 at 14:30        │
│ Gare de Vannes               │
│ TGV 8541  · 🟡 Needs pickup  │
└──────────────────────────────┘
```

Use a `TransportIcon` or Lucide icon for the transport mode. Format datetime for display using `date-fns` if needed (but keep it simple — `new Date(datetime).toLocaleString()` works for the wizard). Show a "Needs pickup" badge if `needsPickup: true`.

### Technical Requirements

1. **Repository-only data access** — `getTripByShareId`, `createTransport`, `getTransportsByPersonId` from `@/lib/db`. No context hooks.
2. **Get tripId from shareId** — call `getTripByShareId(shareId as ShareId)` on mount; handle loading/not-found states.
3. **Inline form validation** — no Zod in component layer (AR-12). Validate datetime and location as required.
4. **`isSubmittingRef` + `isMountedRef` pattern** — use `useRef(false)` guards + `try/catch/finally` for form submit. Follow `RoomSelectionStepPage.tsx` exactly.
5. **Branded types** — `shareId as ShareId`, `trip.id as TripId`, `personId as PersonId`, `datetime as ISODateTimeString`.
6. **i18n** — all text via `t('key', 'fallback')`. Never hardcode.
7. **Tailwind only** — no inline styles, no CSS modules.
8. **`memo(function Name(){})`** — named function inside `memo` for `displayName`.
9. **`undefined` not `null`** for optional fields.
10. **Touch targets** — all interactive elements ≥ 44×44px (NFR13). Use `h-12` on inputs and buttons.
11. **Mobile-first** — `inputMode="text"` on location, appropriate keyboard hints on datetime input.
12. **`ISODateTimeString` is NOT branded** — it's a plain `string` alias. No conversion functions needed; cast directly.

### Architecture Compliance

- Share route boundary: `/share/:shareId/*` is outside `AppProviders`. [Source: architecture.md#ARCHITECTURAL RULE: Share Route Boundary]
- Data access boundary: Components → Repository functions → Dexie. NEVER call `db.transports.*` directly from components. [Source: architecture.md#Data Access Boundary]
- Feature module structure: pages in `src/features/sharing/pages/`, no new feature folder. [Source: architecture.md#Feature Module Structure]
- Lazy routes: wrap in `<ErrorBoundary><Suspense>` (already handled in `routes.tsx` via `withSuspense()`). [Source: architecture.md#Code splitting]
- Context nesting order: MUST NOT change in `AppProviders.tsx`. [Source: architecture.md#ARCHITECTURAL RULE: Context Provider Nesting Order]
- Named export + `memo` pattern: all new components follow `export const Foo = memo(function Foo() {})`.
- Inline validation only (AR-12): Do NOT import Zod schemas in the wizard form.

### Library / Framework Requirements

- React 19 + TypeScript strict.
- React Router DOM 7.x: `useNavigate`, `useParams` (for `shareId`).
- `react-i18next`: `useTranslation()` hook; all text via `t('key', 'fallback')`.
- `sonner`: NOT used in this step — avoid toasts in the wizard flow; use inline success indicators instead for a smoother experience.
- Lucide React: `Train`, `Plane`, `Car`, `Bus`, `MapPin`, `Check`, `Plus` — `aria-hidden="true"` on decorative icons.
- `@/components/shared/LoadingState` — show while data is loading.
- `@/components/ui/button` — for submit, skip, next buttons.
- `@/components/ui/card` — for the page card wrapper (amber theme).
- `@/components/ui/input` — for datetime, location, transport number inputs.
- `@/components/ui/select` — for transport mode dropdown.
- `@/components/ui/switch` — for "Need pickup?" toggle.
- `@/components/ui/label` — for form field labels.
- **No new dependencies.**

### File Structure Requirements

**New files:**
- `src/features/sharing/pages/TransportEntryStepPage.tsx` — the transport entry step component
- `src/features/sharing/pages/__tests__/TransportEntryStepPage.test.tsx` — unit tests

**Files to modify:**
- `src/features/sharing/routes.tsx` — replace `OnboardingPlaceholderPage` element for `path: 'transport'` with lazy-loaded `TransportEntryStepPage`
- `src/features/sharing/index.ts` — export `TransportEntryStepPage`
- `src/locales/en/translation.json` — add new `sharing.transport*` keys under the existing `sharing` object
- `src/locales/fr/translation.json` — add French translations

**Files NOT to touch:**
- `src/features/sharing/pages/OnboardingPlaceholderPage.tsx` — keep for route `summary`
- `src/contexts/` — no changes to context providers
- `src/features/sharing/pages/ShareImportPage.tsx` — do not modify
- `src/features/sharing/pages/IdentityStepPage.tsx` — do not modify
- `src/features/sharing/pages/RoomSelectionStepPage.tsx` — do not modify
- `src/features/transports/components/TransportForm.tsx` — do NOT reuse directly (it depends on context hooks via props). Build a simplified inline form for the wizard.

### i18n Keys Required

Add to **both** `src/locales/en/translation.json` and `src/locales/fr/translation.json` under the `"sharing"` object (alongside the existing `identity*` and `room*` keys):

**English:**
```json
"transportTitle": "Your travel details",
"transportSubtitle": "Tell us when you're arriving and departing",
"transportType": "Type",
"transportArrival": "Arrival",
"transportDeparture": "Departure",
"transportDatetime": "Date and time",
"transportDatetimePlaceholder": "Select date and time",
"transportLocation": "Station / Airport",
"transportLocationPlaceholder": "e.g. Gare de Vannes",
"transportMode": "Transport mode",
"transportModePlaceholder": "Select mode",
"transportNumber": "Number (optional)",
"transportNumberPlaceholder": "e.g. TGV 8541",
"transportNeedsPickup": "Need a pickup?",
"transportNeedsPickupDescription": "Let others know you need a ride from the station",
"transportAdd": "Add transport",
"transportAdding": "Adding...",
"transportSkip": "Skip for now",
"transportNext": "Next",
"transportDone": "Done",
"transportDatetimeRequired": "Date and time is required",
"transportLocationRequired": "Location is required",
"transportCreateError": "Failed to add transport. Please try again.",
"transportAdded": "Transport added!",
"transportAddAnother": "Add another?",
"transportEmpty": "No travel details yet",
"transportEnteredCount": "{{count}} transport(s) added",
"transportNeedsPickupBadge": "Needs pickup"
```

**French:**
```json
"transportTitle": "Vos détails de voyage",
"transportSubtitle": "Dites-nous quand vous arrivez et partez",
"transportType": "Type",
"transportArrival": "Arrivée",
"transportDeparture": "Départ",
"transportDatetime": "Date et heure",
"transportDatetimePlaceholder": "Sélectionnez la date et l'heure",
"transportLocation": "Gare / Aéroport",
"transportLocationPlaceholder": "ex. Gare de Vannes",
"transportMode": "Mode de transport",
"transportModePlaceholder": "Sélectionnez le mode",
"transportNumber": "Numéro (optionnel)",
"transportNumberPlaceholder": "ex. TGV 8541",
"transportNeedsPickup": "Besoin d'un trajet ?",
"transportNeedsPickupDescription": "Faites savoir aux autres que vous avez besoin d'un trajet depuis la gare",
"transportAdd": "Ajouter un transport",
"transportAdding": "Ajout en cours...",
"transportSkip": "Passer pour l'instant",
"transportNext": "Suivant",
"transportDone": "Terminé",
"transportDatetimeRequired": "La date et l'heure sont requises",
"transportLocationRequired": "Le lieu est requis",
"transportCreateError": "Impossible d'ajouter le transport. Veuillez réessayer.",
"transportAdded": "Transport ajouté !",
"transportAddAnother": "En ajouter un autre ?",
"transportEmpty": "Pas encore de détails de voyage",
"transportEnteredCount": "{{count}} transport(s) ajouté(s)",
"transportNeedsPickupBadge": "Trajet nécessaire"
```

### Existing i18n Keys to Reuse

The `transports.modes.*` keys already exist and can be reused for the mode select options:
- `transports.modes.train` → "Train"
- `transports.modes.plane` → "Plane"
- `transports.modes.car` → "Car"
- `transports.modes.bus` → "Bus"
- `transports.modes.other` → "Other"

Reference them as `t('transports.modes.train')` etc. in the select options. Do NOT duplicate these under `sharing.*`.

### Testing Requirements

- Test file: `src/features/sharing/pages/__tests__/TransportEntryStepPage.test.tsx`
- Use `render` from `@/test/utils` with `{ withProviders: false }` — page is outside `AppProviders`
- Wrap in `MemoryRouter` with `initialEntries={['/share/abc123/transport']}`
- Mock `@/lib/db` module:
  ```typescript
  vi.mock('@/lib/db', () => ({
    getTripByShareId: vi.fn(),
    createTransport: vi.fn(),
    getTransportsByPersonId: vi.fn(),
  }));
  ```
- Example mock shapes:
  ```typescript
  const mockTrip = {
    id: 'trip1' as TripId,
    shareId: 'abc123' as ShareId,
    name: 'Test Trip',
    location: 'Brittany',
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-22' as ISODateString,
    createdAt: 0 as UnixTimestamp,
    updatedAt: 0 as UnixTimestamp,
  };
  const mockTransport = {
    id: 'transport1' as TransportId,
    tripId: 'trip1' as TripId,
    personId: 'person1' as PersonId,
    type: 'arrival' as TransportType,
    datetime: '2026-07-15T14:30' as ISODateTimeString,
    location: 'Gare de Vannes',
    needsPickup: true,
    transportMode: 'train' as TransportMode,
    transportNumber: 'TGV 8541',
  };
  ```
- Mock `localStorage` using `vi.spyOn(Storage.prototype, 'getItem')` for guest identity reads
- Mock `navigate` via proper `MemoryRouter` with routes
- `fake-indexeddb/auto` is auto-imported from test setup
- i18n is mocked — `t('key')` returns the key string
- Existing test baseline: **1363 passing** (from story 2.3); add ~11 new tests

### Previous Story Intelligence (2.1, 2.2, 2.3)

**From Story 2.3 (RoomSelectionStepPage — most relevant predecessor):**
- Same async-load pattern: `isMountedRef` + `cancelled` flag + `isSubmittingRef`.
- Same localStorage key `kikouchou_guest_${shareId}` → `{ personId, tripId }` is **read** on mount.
- Same identity guard: redirect to identity step if localStorage is missing.
- Same amber theme, same Card wrapper, same button styling.
- `withSuspense()` helper already defined in `routes.tsx` — reuse it.
- `OnboardingPlaceholderPage` stays for route `summary` until story 2.5.
- Baseline: **1363 tests** passing, **34 lint errors** (all pre-existing), **0 TypeScript errors**.

**From Story 2.2 (IdentityStepPage):**
- localStorage key written by identity step, read by room step and this transport step.
- Amber theme first established here.

**From Story 2.1 (ShareImportPage):**
- `getTripByShareId()` direct repo call pattern.
- LoadingState + ErrorDisplay + not-found patterns.
- Returning-guest detection logic.

**Key difference from RoomSelectionStepPage:** This step has a **form with inputs** (not just card selection with buttons). The form is more like the existing `TransportForm.tsx` but simplified. Do NOT import or reuse `TransportForm.tsx` directly — it expects props like `persons` (for driver dropdown) that come from context hooks. Build a simplified inline form within the wizard page component.

### Do NOT Reuse `TransportForm.tsx` Directly

The existing `TransportForm.tsx` in `src/features/transports/components/` is designed for the full app (inside `AppProviders`). It:
- Takes `persons: readonly Person[]` as a prop (for person/driver dropdowns)
- Uses `LocationPicker` with map integration
- Has all fields including `driverId`, `notes`, `coordinates`
- Uses the `useFormSubmission` hook

For the wizard, build a **simplified inline form** that:
- Has fewer fields (no coordinates, no driverId, no notes)
- Uses a plain text input for location (no map picker)
- Pre-fills `personId` from localStorage (not a dropdown)
- Has the "add another" flow with type flip

### Git Intelligence

- Recent commits: `2bf3603` `2.3`, `7a7fd8a` `2.2`, `4020ef4` `2.1`, `9d80edd` `feat: 1.8`
- Commit convention for this story: `feat: 2.4` or `feat: story 2.4`
- Epic 2 is `in-progress` (set from story 2.1)

### UX Requirements (from UX Design Spec)

- **Transport entry is step 4 of 5** in the wizard. Target: guest enters arrival details (and optionally departure) quickly. [Source: ux-design-specification.md#Design Opportunities, item 1]
- **Compact form** — Guests are on mobile at a train station. Minimize taps. Default to arrival, pre-fill nothing except type. [Source: ux-design-specification.md#Target Users, Guest]
- **"Need pickup?" toggle** — Prominent, not buried. This is how the group coordinates pickups. [Source: ux-design-specification.md#Key Design Challenges, item 5]
- **Skippable** — Guest can always skip and add transport later. Don't block progress. [Source: epics.md#Story 2.4 AC "Skip for now"]
- **Under 2 minutes total wizard time** (UX-1). Transport entry should take 30-45 seconds for the happy path.

### Project Context

- Project: kikouchou — vacation house coordination PWA. No backend. IndexedDB (Dexie.js). Offline-first.
- This story is step 4 of the wizard flow, outside AppProviders. Pattern established by Stories 2.1, 2.2, and 2.3.
- Epic 2 goal: first-time guests can self-service setup in under 2 minutes with no more than 5 taps for the happy path (UX-1).
- After this story: story 2.5 (Summary and Trip Entry) will display the guest's identity, room assignment, and transport details as a summary before entering the trip.

### Project Structure Notes

- All wizard pages live in `src/features/sharing/pages/` — do NOT create a new feature folder.
- The Transport types (`Transport`, `TransportFormData`, `TransportType`, `TransportMode`, `TransportId`, `ISODateTimeString`) are in `src/types/index.ts`.
- Repository functions are in `src/lib/db/repositories/transport-repository.ts`, exported via `src/lib/db/index.ts`.
- i18n keys go under the `sharing` object in both language files, not under `transports`.
- Test file goes in `src/features/sharing/pages/__tests__/`.

### References

- Story definition + AC: [Source: _bmad-output/planning-artifacts/epics.md#Story 2.4: Transport Entry Step]
- Epic 2 context: [Source: _bmad-output/planning-artifacts/epics.md#Epic 2: Guest Onboarding Experience]
- Share route boundary rule (AR-10): [Source: _bmad-output/planning-artifacts/architecture.md#ARCHITECTURAL RULE: Share Route Boundary]
- Inline validation rule (AR-12): [Source: _bmad-output/planning-artifacts/architecture.md#Form Patterns]
- Canonical async-load pattern: `src/features/sharing/pages/RoomSelectionStepPage.tsx`
- Canonical identity guard: `src/features/sharing/pages/RoomSelectionStepPage.tsx`
- Available repository functions: `getTripByShareId`, `createTransport`, `getTransportsByPersonId` [Source: src/lib/db/index.ts]
- Transport types: `Transport`, `TransportFormData`, `TransportType`, `TransportMode`, `ISODateTimeString` [Source: src/types/index.ts]
- `createTransport` signature: `(tripId: TripId, data: TransportFormData) => Promise<Transport>` [Source: src/lib/db/repositories/transport-repository.ts]
- Existing full transport form (reference, do not reuse): `src/features/transports/components/TransportForm.tsx`
- Wizard routes scaffold: [Source: src/features/sharing/routes.tsx]
- localStorage key contract: [Source: _bmad-output/implementation-artifacts/2-2-identity-selection-step.md]
- Amber visual theme reference: [Source: src/features/sharing/pages/RoomSelectionStepPage.tsx]
- Existing transport mode i18n keys: `transports.modes.*` [Source: src/locales/en/translation.json]
- Touch target requirement (NFR13, 44px minimum): [Source: _bmad-output/planning-artifacts/architecture.md#Accessibility]
- Test utilities: [Source: src/test/utils.tsx]

## Dev Agent Record

### Agent Model Used

claude-opus-4-5 (anthropic/claude-opus-4-5)

### Debug Log References

None required — implementation proceeded without debugging issues.

### Completion Notes List

1. **ISODateTimeString discovery**: Unlike other branded types (`TripId`, `PersonId`, etc.), `ISODateTimeString` is a plain string type alias, not a branded type. This simplified datetime handling — direct cast from `datetime-local` input value works without conversion functions.

2. **Test count**: 15 new tests added (not 11 as estimated in spec). Tests cover all acceptance criteria including form validation, submission, "add another" flow with type flip, localStorage identity guard, existing transports display, navigation, and i18n keys.

3. **Transport card display**: Used Lucide icons for transport modes (Train, Plane, Car, Bus, MapPin for other). Datetime formatted using `toLocaleDateString` + `toLocaleTimeString` for locale-aware display.

4. **Form reset on "add another"**: After successful submission, form resets with opposite type pre-selected (arrival → departure, departure → arrival) and success message shown briefly.

5. **Accessibility**: All interactive elements have `h-12` height (48px > 44px minimum per NFR13), proper aria-labels on icon-only elements, and error messages use `role="alert"` with `aria-describedby` linking.

### Change Log

| File | Action | Description |
|------|--------|-------------|
| `src/features/sharing/pages/TransportEntryStepPage.tsx` | Created | Transport entry wizard step component with form, validation, and "add another" logic |
| `src/features/sharing/pages/__tests__/TransportEntryStepPage.test.tsx` | Created | 15 unit tests covering all acceptance criteria |
| `src/features/sharing/routes.tsx` | Modified | Added lazy import for TransportEntryStepPage, replaced OnboardingPlaceholderPage for 'transport' path |
| `src/features/sharing/index.ts` | Modified | Added export for TransportEntryStepPage |
| `src/locales/en/translation.json` | Modified | Added `sharing.transport*` i18n keys (20 new keys) |
| `src/locales/fr/translation.json` | Modified | Added French translations for all transport keys |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Modified | Updated 2-4-transport-entry-step from "in-progress" to "review" |

### File List

**New Files:**
- `src/features/sharing/pages/TransportEntryStepPage.tsx`
- `src/features/sharing/pages/__tests__/TransportEntryStepPage.test.tsx`

**Modified Files:**
- `src/features/sharing/routes.tsx`
- `src/features/sharing/index.ts`
- `src/locales/en/translation.json`
- `src/locales/fr/translation.json`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/2-4-transport-entry-step.md` (this file)
