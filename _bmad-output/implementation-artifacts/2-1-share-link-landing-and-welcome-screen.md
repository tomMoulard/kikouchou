# Story 2.1: Share Link Landing and Welcome Screen

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **guest opening a shared link**,
I want to see a warm welcome screen with the trip name, dates, and location,
so that I know I'm in the right place and feel invited to participate.

## Acceptance Criteria

1. **Given** a guest navigates to `/share/:shareId` for a valid trip
   **When** the page loads
   **Then** a welcome screen displays the trip name, location (if set), date range, and a "Get Started" button — using repository functions directly (AR-10), NOT context hooks

2. **Given** the share link has an invalid or unknown `shareId`
   **When** the page loads
   **Then** a friendly error message is shown ("This trip link doesn't seem to work") with no technical jargon

3. **Given** the guest has visited this trip before (returning visit — their identity is persisted in `localStorage`)
   **When** the page loads
   **Then** the wizard is skipped and the guest is redirected to the trip dashboard directly (navigate to `/trips/:tripId/calendar`)

4. **Given** any screen in the wizard
   **When** it is rendered
   **Then** all text uses i18n keys (FR/EN) and the design matches the visual warmth theme from Epic 1 (warm colors, inviting empty states, vacation personality)

## Tasks / Subtasks

- [x] Task 1: Refactor/enhance `ShareImportPage` to become the welcome screen (AC: 1, 2, 4)
  - [x] 1.1 Update the "View this trip" card to match the warm welcome screen design: trip name prominent, date range, location (if set), and a "Get Started" / "Continue to trip" CTA button with vacation-appropriate styling
  - [x] 1.2 Add returning-guest detection: on load, check `localStorage` key `kikouchou_guest_{shareId}` (or equivalent); if found with valid `personId`, navigate directly to `/trips/:tripId/calendar` (via `setCurrentTrip(trip.id)` then navigate)
  - [x] 1.3 Ensure friendly not-found error uses the i18n key `sharing.notFoundWizard` (new key) — message "This trip link doesn't seem to work" — no stack traces or technical jargon
  - [x] 1.4 Add all new i18n keys to `src/locales/en/translation.json` and `src/locales/fr/translation.json`

- [x] Task 2: Implement the wizard routing scaffold (AC: 1, 3)
  - [x] 2.1 The "Get Started" button should navigate to Step 2 of the wizard (story 2.2 identity step). For now, stub the navigation to a `/share/:shareId/identity` placeholder route that renders a "Coming soon" view — this is the wiring point for stories 2.2–2.5
  - [x] 2.2 Add the onboarding sub-routes to `src/features/sharing/routes.tsx`: nested under `/share/:shareId` — e.g., `/share/:shareId/identity`, `/share/:shareId/room`, `/share/:shareId/transport`, `/share/:shareId/summary`

- [x] Task 3: Tests (AC: 1–4)
  - [x] 3.1 Unit test: valid shareId → welcome screen renders trip name, location, date range
  - [x] 3.2 Unit test: invalid shareId → friendly not-found message shown
  - [x] 3.3 Unit test: returning guest (localStorage key present + valid) → redirected to calendar
  - [x] 3.4 Unit test: no location on trip → location row is hidden (conditional rendering)

- [x] Task 4: Verification
  - [x] 4.1 `bunx tsc --noEmit` — 0 errors
  - [x] 4.2 `bun run lint` — no new warnings or errors beyond baseline
  - [x] 4.3 `bun run test:run` — all tests pass (1332 passing, +12 new)

## Dev Notes

### Developer Context (Read First)

This is the **first story of Epic 2 (Guest Onboarding)**. The primary goal is transforming the existing `ShareImportPage` into a warm welcome screen and adding returning-guest detection. Epic 2 builds a guided wizard on top of the `/share/:shareId` route — this story lays the foundation.

**Critical architectural constraint (AR-10):** The `/share/:shareId` route is **outside `AppProviders`**. Any component rendered under this path MUST use repository functions directly from `@/lib/db` — NEVER context hooks like `useRoomContext()`, `useTripContext()`, etc. This constraint is load-bearing.

**Do NOT** create a new feature module or folder. The onboarding wizard lives in `src/features/sharing/` — the existing feature module. Specifically:
- Pages go in `src/features/sharing/pages/`
- Components go in `src/features/sharing/components/`
- Routes go in `src/features/sharing/routes.tsx`
- Barrel export in `src/features/sharing/index.ts`

**Returning guest detection strategy:** Use `localStorage` to store guest identity across visits. The key should be `kikouchou_guest_${shareId}` storing `{ personId: string, tripId: string }`. On the welcome screen, check this key before rendering the "Get Started" CTA; if valid, auto-redirect. This key will be written in Story 2.2 (identity step) — this story only reads it.

### Technical Requirements

1. **Repository-only data access** — use `getTripByShareId(shareId)` and `setCurrentTrip(trip.id)` from `@/lib/db`. No context hooks.
2. **Inline form validation** — no Zod in component layer (Zod is repository/test only).
3. **Branded types** — `shareId` from URL params must be cast as `ShareId` before repository calls: `shareId as ShareId`.
4. **useFormSubmission pattern** — any async operation uses the `isMountedRef` guard pattern (already present in existing `ShareImportPage`).
5. **i18n** — all user-facing strings via `useTranslation()` / `t('key', 'fallback')`. Never hardcode text.
6. **Tailwind only** — no inline styles, no CSS modules.
7. **memo(function Name(){})** — named function inside `memo` for `displayName`.
8. **`undefined` not `null`** for optional fields.

### Architecture Compliance

- Context provider nesting: `Trip → Room → Person → Assignment → Transport` — MUST NOT change. Share route is outside this tree. [Source: architecture.md#ARCHITECTURAL RULE: Context Provider Nesting Order]
- Share route boundary: `/share/:shareId` is outside `AppProviders`. Components under this path use `@/lib/db` repository functions directly. [Source: architecture.md#ARCHITECTURAL RULE: Share Route Boundary]
- `ShareImportPage` already correctly uses `getTripByShareId()` and `setCurrentTrip()` directly — preserve and build on this pattern.
- All lazy routes MUST be wrapped in `<ErrorBoundary><Suspense>` (already done in `routes.tsx`). [Source: architecture.md#Code splitting]
- Data access boundary: Components → Repository functions → Dexie. Components NEVER call `db.trips.get()` etc. directly — always via repository function. [Source: architecture.md#Data Access Boundary]

### Library / Framework Requirements

- React 19 + TypeScript strict. [Source: architecture.md#Language & Runtime]
- React Router DOM 7.x: use `useNavigate`, `useParams` from `react-router-dom`.
- `react-i18next`: use `useTranslation()` hook; all text via `t('key', 'fallback')`.
- `sonner`: use `toast.error(t('key'))` for user feedback on errors.
- `date-fns`: already used in `ShareImportPage` for date formatting — reuse `formatDateRange()` and `getDateLocale()` helpers already defined there.
- Lucide React icons: use `aria-hidden="true"` on all decorative icons.
- No new dependencies to introduce.

### File Structure Requirements

**Files to modify:**
- `src/features/sharing/pages/ShareImportPage.tsx` — primary file; enhance welcome screen UI, add returning-guest detection
- `src/features/sharing/routes.tsx` — add nested wizard sub-routes scaffold
- `src/features/sharing/index.ts` — export any new components/pages added
- `src/locales/en/translation.json` — add new i18n keys under `sharing.*`
- `src/locales/fr/translation.json` — add French translations for same keys

**New files (if needed):**
- `src/features/sharing/components/WelcomeCard.tsx` — optional extraction if the welcome card logic grows; otherwise keep inline in `ShareImportPage`
- `src/features/sharing/pages/OnboardingPlaceholderPage.tsx` — minimal stub for wizard sub-routes (stories 2.2–2.5 will replace it)

**Do NOT create:**
- A new `features/onboarding/` folder (wizard lives in `features/sharing/`)
- Any new context providers
- Any files in `src/contexts/`

### i18n Keys Required

Add to both `src/locales/en/translation.json` and `src/locales/fr/translation.json` under the `sharing` object:

```json
"welcome": "Welcome to {{tripName}}!",
"welcomeSubtitle": "You've been invited to join this trip",
"getStarted": "Get Started",
"continueToTrip": "Continue to trip",
"notFoundWizard": "This trip link doesn't seem to work",
"notFoundWizardDescription": "The link may be incorrect or the trip may no longer exist.",
"returning": "Welcome back! Taking you to the trip..."
```

French translations:
```json
"welcome": "Bienvenue dans {{tripName}} !",
"welcomeSubtitle": "Vous avez été invité(e) à rejoindre ce voyage",
"getStarted": "Commencer",
"continueToTrip": "Accéder au voyage",
"notFoundWizard": "Ce lien de voyage ne semble pas fonctionner",
"notFoundWizardDescription": "Le lien est peut-être incorrect ou le voyage n'existe plus.",
"returning": "Bon retour ! Redirection vers le voyage..."
```

Note: existing `sharing.viewTrip`, `sharing.notFound`, `sharing.notFoundDescription`, `sharing.viewError` keys are still used and must NOT be removed.

### Returning Guest Detection — Implementation Detail

```typescript
const GUEST_STORAGE_KEY = (shareId: string) => `kikouchou_guest_${shareId}`;

interface StoredGuestIdentity {
  personId: string;
  tripId: string;
}

function getStoredGuestIdentity(shareId: string): StoredGuestIdentity | undefined {
  try {
    const raw = localStorage.getItem(GUEST_STORAGE_KEY(shareId));
    if (!raw) return undefined;
    return JSON.parse(raw) as StoredGuestIdentity;
  } catch {
    return undefined;
  }
}
```

Check this in `useEffect` after trip is loaded. If `storedIdentity?.tripId === trip.id`, call `setCurrentTrip(trip.id)` then navigate to `/trips/${trip.id}/calendar`.

### Testing Requirements

- Tests live in `src/features/sharing/pages/__tests__/ShareImportPage.test.tsx` (create if not exists; follow co-location rule)
- Use `render` from `@/test/utils` (wraps MemoryRouter + AppProviders is NOT needed here; use `{ withProviders: false }` since this page is outside AppProviders)
- Mock `@/lib/db` module: mock `getTripByShareId` to return fixture trip or `undefined`
- Mock `localStorage` using `vi.spyOn(Storage.prototype, 'getItem')`
- Mock `react-router-dom`: use `MemoryRouter` with `initialEntries={['/share/abc123']}`
- Use `fake-indexeddb/auto` (auto-imported from test setup) — no manual setup needed
- Test pattern follows existing `ShareImportPage` component structure

### Previous Story Intelligence (1.8)

- Story 1.8 established `memo(function Name() {})` as the canonical pattern for all components — use it for any new components created here [Source: 1-8-code-review-cleanup-and-remaining-todo-items.md#Task 1]
- Story 1.8 confirmed `src/features/sharing/pages/ShareImportPage.tsx` already uses the correct `isMountedRef` + cancelled-flag async pattern and the `getTripByShareId()` / `setCurrentTrip()` direct repository calls. Build on this, don't replace it.
- Story 1.8 baseline lint issues: 30 errors / 4 warnings are **pre-existing** in E2E tests and unrelated files. Do not introduce new issues.
- Current test count: 1320 passing. Do not regress.
- CONVENTIONS.md was created in story 1.8 and documents accepted risk for shareId predictability + Zod/form validation split.

### Git Intelligence

- Recent commits: `chore: upgrade bmad` (f4558ef), `feat: 1.8` (9d80edd), `chore: upgrade deps` (5016c04)
- Follow commit convention: `feat: story 2.1`
- Pattern: stories are implemented in feature-focused commits; Epic 1 established the naming

### UX Requirements (from UX Design Spec)

- **Visual warmth is essential** — this is the first screen a guest sees after clicking a WhatsApp link. The emotional context is "vacation with friends." It must feel warm and inviting, not generic/enterprise. Reference Epic 1 Story 1.2 visual theme changes.
- **Target: under 2 minutes for full wizard** (UX-1). The welcome screen is step 0/5 — it must be fast to scan and act on. Trip name should be visually prominent (large, warm header), date range and location should be scannable at a glance.
- **Mobile-first** — primary use case is a guest on a phone at a train station. Card layout, large CTA button (min 44x44px touch target per NFR13), readable text size.
- The "Get Started" button is the primary CTA — it should be visually prominent and distinct from the secondary "View as guest" action (if kept).

### Project Context

- No `project-context.md` found; treat PRD + Architecture + Epics as canonical sources.
- Project: kikouchou — vacation house coordination PWA. No backend. IndexedDB (Dexie.js). Offline-first.
- Epic 2 goal: first-time guests arriving via shared link get a guided 5-step wizard and can self-service in under 2 minutes.
- Story 2.1 is the entry point (Step 1: Welcome). Stories 2.2–2.5 are the subsequent wizard steps. Story 2.6 is the returning guest dashboard.

### References

- Story definition + AC: [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1]
- Epic 2 context: [Source: _bmad-output/planning-artifacts/epics.md#Epic 2: Guest Onboarding Experience]
- Share route boundary rule (AR-10): [Source: _bmad-output/planning-artifacts/architecture.md#ARCHITECTURAL RULE: Share Route Boundary]
- Context nesting order rule: [Source: _bmad-output/planning-artifacts/architecture.md#ARCHITECTURAL RULE: Context Provider Nesting Order]
- Existing ShareImportPage (pattern to build on): [Source: src/features/sharing/pages/ShareImportPage.tsx]
- Existing sharing routes: [Source: src/features/sharing/routes.tsx]
- Repository functions available: `getTripByShareId`, `setCurrentTrip` [Source: src/lib/db/index.ts]
- Data format rules (branded types, undefined not null): [Source: _bmad-output/planning-artifacts/architecture.md#Format Patterns]
- i18n rules: [Source: _bmad-output/planning-artifacts/architecture.md#Internationalization]
- Visual warmth UX goal: [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Design Opportunities]
- Mobile-first, NFR13 (44px touch targets): [Source: _bmad-output/planning-artifacts/prd.md#Non-Functional Requirements]
- Previous story patterns: [Source: _bmad-output/implementation-artifacts/1-8-code-review-cleanup-and-remaining-todo-items.md]

## Dev Agent Record

### Agent Model Used

anthropic/claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Story context created from epics + architecture + UX design + PRD + git history analysis.
- This is the first story in Epic 2. Epic 2 status updated to `in-progress` in sprint-status.yaml.
- The existing `ShareImportPage` is the foundation — enhance and extend, don't replace.
- Returning-guest localStorage key (`kikouchou_guest_${shareId}`) established here; Story 2.2 will write it.
- Wizard sub-routes scaffold should be minimal stubs — full implementations come in stories 2.2–2.5.
- Implementation complete: warm amber-themed welcome screen replacing the previous generic card.
- `ShareImportPage` fully rewritten: warm Palmtree icon, amber gradient background, prominent trip name via `t('sharing.welcome', { tripName })`, date range, conditional location, `h-12` "Get Started" CTA.
- Returning-guest detection: `getStoredGuestIdentity(shareId)` reads `kikouchou_guest_${shareId}` from localStorage; matching `tripId` triggers `setCurrentTrip` + navigate to `/trips/:tripId/calendar`. `setIsLoading(false)` is called before the async redirect to prevent stuck loading state.
- Not-found state replaced with warm amber card using `sharing.notFoundWizard` / `sharing.notFoundWizardDescription` keys.
- 7 new i18n keys added to both `en/translation.json` and `fr/translation.json` under the `sharing` object.
- `OnboardingPlaceholderPage` created as minimal stub for wizard sub-routes (identity, room, transport, summary).
- `routes.tsx` updated with nested children routes for the four wizard steps.
- `index.ts` updated to export `OnboardingPlaceholderPage`.
- `Palmtree` icon used (renamed from `Palm` to `Palmtree` in lucide-react); `ExternalLink` removed.
- 12 unit tests added in `src/features/sharing/pages/__tests__/ShareImportPage.test.tsx` — all pass.
- Full test suite: 1332 tests passing, 0 regressions (baseline was 1320).
- TypeScript: 0 errors. Lint: 0 new errors (34 pre-existing baseline unchanged).

### File List

- `src/features/sharing/pages/ShareImportPage.tsx` — rewritten as warm welcome screen
- `src/features/sharing/pages/OnboardingPlaceholderPage.tsx` — new stub page for wizard steps
- `src/features/sharing/pages/__tests__/ShareImportPage.test.tsx` — new test file (12 tests)
- `src/features/sharing/routes.tsx` — added nested wizard sub-routes
- `src/features/sharing/index.ts` — added OnboardingPlaceholderPage export
- `src/locales/en/translation.json` — added 7 new sharing.* i18n keys
- `src/locales/fr/translation.json` — added 7 new sharing.* i18n keys (French translations)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story status updated to review

## Change Log

- **2026-03-16** — Story 2.1 implemented: warm welcome screen, returning-guest detection, wizard routing scaffold, i18n keys, unit tests (Date: 2026-03-16)
