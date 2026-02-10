---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
lastStep: 8
status: 'complete'
completedAt: '2026-02-10'
inputDocuments:
  - _bmad-output/planning-artifacts/product-brief-kikoushou-2026-02-06.md
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - .github/workflows/ci.yml
  - .github/workflows/deploy.yml
  - package.json
workflowType: 'architecture'
project_name: 'kikoushou'
user_name: 'tom'
date: '2026-02-06'
---

# Architecture Decision Document

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**
46 functional requirements across 9 domains: Trip Management (FR1-5), Person Management (FR6-10), Room Management (FR11-16), Room Assignment (FR17-22), Transport Tracking (FR23-30), Calendar Visualization (FR31-34), Trip Sharing (FR35-39), Offline & Data (FR40-42), Internationalization (FR43-45), and Maps (FR46). The requirements describe a complete coordination tool where all users have equal editing power via a shared link.

**Non-Functional Requirements:**
26 NFRs organized into Performance (NFR1-7), Accessibility (NFR8-14), Offline & Reliability (NFR15-19), Security (NFR20-22), and Code Quality (NFR23-26). The most architecturally significant NFRs are:
- Offline-first with 100% read/write to local data (NFR15)
- Zero data loss on close/restart/network loss (NFR16)
- FCP < 1.5s, TTI < 2s on fast 3G (NFR1-2)
- Lighthouse 95+ across all 4 categories (NFR3, NFR8, NFR19, NFR26)
- Calendar rendering smooth with 15+ participants, 20+ assignments (NFR5)

**UX Architecture Implications:**
- Dual information architecture: organizer (entity management) vs. guest (task-oriented)
- Guest onboarding wizard as highest-priority UX work
- Mobile-first design (primary use case: guest on phone opening shared link)
- Accidental edit protection without adding friction
- Offline state confidence indicators

**Scale & Complexity:**

- Primary domain: Front-end web application (PWA)
- Complexity level: Low-medium
- Estimated architectural components: ~15-20 (routing, data layer, UI component library, state management, PWA service worker, i18n, calendar engine, room assignment logic, transport tracking, sharing mechanism, map integration, theme system, form validation, error handling, offline indicators)

### Technical Constraints & Dependencies

- **No backend server** - Static file hosting only. All logic is client-side.
- **IndexedDB (Dexie.js)** - Sole persistence layer. Must survive all normal operations without data loss.
- **React 19 + TypeScript (strict)** - Existing codebase with zero TS errors required.
- **Vite 7** - Build toolchain with bundle size tracking.
- **shadcn/ui + Tailwind CSS 4** - UI component library and styling.
- **Workbox** - Service worker management for PWA precaching and offline fallback.
- **No real-time sync** - Each device stores data independently. Shared link is coordination mechanism, not sync mechanism.
- **UUID-based access control** - Trip UUID in the share link is the sole access token. No authentication.
- **Browser support** - Chrome + Safari mobile (primary), Firefox/Samsung/Edge (secondary). Latest 2 versions.

### Cross-Cutting Concerns Identified

- **Offline-first data integrity** - Every write must reliably persist to IndexedDB. Every read must work without network. Service worker must cache all static assets.
- **Internationalization (i18n)** - All user-facing strings in FR and EN via react-i18next. Language detection on first visit, persistent preference.
- **Accessibility** - WCAG 2.1 AA best effort. Semantic HTML, keyboard navigation, ARIA, 44px touch targets, 4.5:1 contrast, reduced motion support, color-independent information encoding.
- **Performance budget** - Bundle size tracked per build with no regressions. Lazy-loading routes. Tree-shaking dependencies.
- **Calendar rendering** - Most data-dense view. Must remain smooth with 15+ participants and 20+ room assignments. Color-coded blocks per participant with secondary indicators for accessibility.
- **PWA lifecycle** - Service worker auto-update with user notification. Standalone display mode. Offline fallback for all routes.
- **Error handling** - Accidental edit protection via confirmation patterns for destructive actions. Graceful degradation on unsupported browsers.

## Starter Template Evaluation

### Primary Technology Domain

Front-end web application (PWA) - client-side only SPA with offline-first architecture.

### Starter Options Considered

**Not applicable - brownfield project.** Kikoushou is an existing, MVP-complete codebase. The technology stack has been established through 19 development phases and is production-deployed. This section documents the existing stack rather than evaluating new starters.

### Existing Stack: Vite + React + TypeScript PWA

**Rationale:**
The stack was selected organically during development and is now deeply embedded across 1074+ tests and the full application. Changing any foundational technology would require a rewrite, not a migration.

**Architectural Decisions Established by Current Stack:**

**Language & Runtime:**
- TypeScript ~5.9.3 in strict mode (zero errors required)
- React 19.2 with ES Modules
- Bun as package manager and script runner

**Styling Solution:**
- Tailwind CSS 4.1 with `@tailwindcss/vite` plugin
- shadcn/ui components built on Radix UI primitives
- `class-variance-authority` + `clsx` + `tailwind-merge` for variant management
- `tw-animate-css` for animations
- `next-themes` for dark/light mode

**Build Tooling:**
- Vite 7.3 as dev server and bundler
- `vite-plugin-pwa` 1.2 with Workbox for service worker generation
- Bundle size tracked per build (NFR6)

**Testing Framework:**
- Vitest 4.0 for unit and integration tests (1074+ tests)
- Playwright 1.58 for E2E tests (178 tests)
- @testing-library/react + @testing-library/user-event for component testing
- @axe-core/playwright for accessibility testing
- fake-indexeddb for Dexie.js testing
- msw for API mocking
- @vitest/coverage-v8 for coverage reporting (target: 80%+)

**Code Organization:**
- React SPA with client-side routing (React Router DOM 7.13)
- Dexie.js 4.2 as IndexedDB abstraction layer
- Zod 4.3 for runtime validation
- Component-based architecture with shadcn/ui patterns

**Development Experience:**
- Vite HMR for fast development feedback
- ESLint 9.39 with typescript-eslint for linting (zero warnings/errors target)
- CI pipeline (`.github/workflows/ci.yml`) and deploy pipeline (`.github/workflows/deploy.yml`)
- Scripts: `dev`, `build`, `test`, `test:run`, `test:coverage`, `test:e2e`, `lint`, `validate` (full pipeline)

**Note:** No project initialization needed. The first implementation story should focus on UX polish per the PRD finalization priorities.

## Core Architectural Decisions

### Decision Priority Analysis

**Already Decided (Established by Existing Codebase):**
All core architectural decisions are established and embedded across 1074+ tests. The decisions below document what IS, plus gaps and improvements identified through architectural review.

**Action Items Identified During Review:**
- AI-1: Remove `@tanstack/react-query` dependency (unused, creates confusion)
- AI-2: Deprecate non-ownership-checking repository variants; all context CRUD uses `*WithOwnershipCheck`
- AI-3: Extract shared `useFormSubmission()` hook from repeated form patterns
- AI-4: Align vitest coverage threshold to 80% (matching PRD target)
- AI-5: Add calendar rendering performance test (15 persons, 20+ assignments)
- AI-6: Add cascade delete partial-failure integration tests
- AI-7: Add CI chunk size check (500KB threshold)

**Deferred Decisions (Post-MVP):**
- P2P sync protocol (deferred until manual sync becomes a pain point)
- Server-side rendering (not needed -- SPA with no SEO requirement)
- Authentication/authorization (not needed -- social context is access control)

### Data Architecture

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Persistence** | IndexedDB via Dexie.js 4.2 | Local-first, offline-first. No server dependency. |
| **Schema versioning** | Dexie versioned migrations (currently v3) | Declarative, automatic migration on version bump |
| **Data modeling** | Flat tables with foreign keys (relational) | 6 tables: `trips`, `rooms`, `persons`, `roomAssignments`, `transports`, `settings` |
| **ID generation** | nanoid (21 chars for entities, 10 chars for share IDs) | URL-safe, collision-resistant. Branded types prevent cross-entity ID misuse. |
| **Referential integrity** | Application-level cascade deletes in Dexie transactions | No DB-level FK constraints in IndexedDB. Atomic transactions ensure consistency. **MUST have dedicated integration tests covering partial failure scenarios.** |
| **Denormalization** | All child entities carry `tripId` | Enables efficient compound index queries (`[tripId+startDate]`, `[tripId+order]`) without joins |
| **Validation strategy** | **Forms validate inline** (canonical). Zod schemas in `lib/validation/` are for repository-level assertions and test utilities only. AI agents building new forms MUST use inline validation, NOT Zod in form components. | Single canonical pattern prevents inconsistency. |
| **Data access** | Dexie live queries (`useLiveQuery`) provide automatic reactivity | **TanStack React Query is NOT used and MUST be removed.** Dexie's observation API handles cache invalidation automatically. |
| **Conflict detection** | `checkAssignmentConflict()` prevents overlapping room assignments | First-come-first-served with date range overlap detection |
| **Ownership validation** | **All context-level CRUD MUST use `*WithOwnershipCheck` repository variants.** Non-checking variants (`updateRoom`, `deleteRoom`, etc.) are deprecated for direct use from UI code. | Transactional atomic read-then-mutate prevents TOCTOU race conditions. |

**Entity Relationship Model:**

```
Trip (root aggregate)
 ├── 1:many → Room (via Room.tripId)
 ├── 1:many → Person (via Person.tripId)
 ├── 1:many → RoomAssignment (via RoomAssignment.tripId)
 └── 1:many → Transport (via Transport.tripId)

RoomAssignment (join entity: Room ↔ Person with date range)
 ├── many:1 → Room (via roomId)
 └── many:1 → Person (via personId)

Transport
 ├── many:1 → Person (via personId -- the traveler)
 └── many:0..1 → Person (via driverId -- optional pickup driver)
```

**Cascade Delete Rules:**
- Delete Trip → deletes all rooms, persons, assignments, transports (atomic transaction)
- Delete Room → deletes all assignments for that room
- Delete Person → deletes all assignments + transports for that person + clears `driverId` references

**Testing requirement:** Cascade delete transactions MUST have dedicated integration tests covering: (a) full transaction success, (b) mid-transaction IndexedDB error (mock Dexie to throw after partial delete), (c) verification that rollback leaves data consistent.

### Authentication & Security

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Authentication** | None | Zero-auth by design. Social context (friend groups) is access control. |
| **Access control** | UUID-based share link (10-char nanoid with unique DB index) | Trip UUID in URL is the sole access token. Retry on collision. |
| **Input sanitization** | Repository-layer trim + truncate via `sanitize.ts` | Data quality focus. Max lengths enforced (e.g., 100 chars for names, 500 for descriptions). |
| **XSS prevention** | React's built-in JSX escaping | No DOMPurify or HTML escaping -- React handles output encoding. |
| **Transport security** | HTTPS only (GitHub Pages enforces) | Standard baseline. |
| **Data sensitivity** | Low-risk: only names and logistics. No passwords, PII, or payment data. | Minimal attack surface by design. |

### Frontend Architecture

**State Management:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Reactive data layer** | Dexie live queries (`useLiveQuery` from `dexie-react-hooks`) | Automatic UI updates when IndexedDB changes. No manual cache invalidation. |
| **State distribution** | 5 React Contexts (Trip, Room, Person, Assignment, Transport) | Each context wraps a Dexie live query + CRUD callbacks. |
| **Local UI state** | `useState` / `useRef` per component | No global UI state library. Component-local state for dialogs, forms, navigation guards. |
| **Referential stability** | `useRef` + deep equality checks (`areArraysEqual`) | Prevents unnecessary re-renders when Dexie data hasn't semantically changed. |
| **Derived data** | `useMemo` with O(1) lookup Maps | PersonContext maintains `Map<PersonId, Person>`, AssignmentContext maintains `Map<RoomId, RoomAssignment[]>`. |

**ARCHITECTURAL RULE: Context Provider Nesting Order**

The context provider nesting order is **load-bearing and MUST NOT be changed**:

```
<TripProvider>              ← Root: manages trip list + currentTripId
  <RoomProvider>            ← Depends on: TripContext (currentTripId)
    <PersonProvider>        ← Depends on: TripContext (currentTripId)
      <AssignmentProvider>  ← Depends on: TripContext, needs Room + Person for display
        <TransportProvider> ← Depends on: TripContext, needs Person for display
          {children}
        </TransportProvider>
      </AssignmentProvider>
    </PersonProvider>
  </RoomProvider>
</TripProvider>
```

**Why this order matters:**
- Every child context calls `useTripContext()` to get `currentTripId` for scoped queries
- `AssignmentProvider` needs rooms and persons already resolved for occupancy calculations
- `TransportProvider` needs persons resolved for driver name lookups
- Reordering breaks the dependency chain and causes runtime errors or stale data

**ARCHITECTURAL RULE: Share Route Boundary**

The `/share/:shareId` route operates **outside `AppProviders`**. This is a hard boundary:

- **DO NOT** use any context hooks (`useRoomContext`, `usePersonContext`, etc.) on the share import page
- **DO NOT** assume contexts are available for any component rendered under `/share/`
- Share import logic MUST use repository functions directly (e.g., `getTripByShareId()`)
- Any feature requiring context data after share import MUST first import the trip, then navigate to a context-wrapped route (e.g., `/trips/:tripId/calendar`)

**Component Architecture:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Organization** | Feature-based folders (`src/features/{feature}/`) | Co-located pages, components, routes, types, utils per feature. |
| **Route definitions** | Decentralized per feature (`routes.tsx` per feature) | Each feature owns its routes, composed in `src/router.tsx`. |
| **Code splitting** | All page components lazy-loaded via `React.lazy()` | Wrapped in `<ErrorBoundary><Suspense>` at the route level. |
| **UI primitives** | shadcn/ui in `src/components/ui/` (21 components) | Standard Radix-based primitives. Some have extracted `.variants.ts` files (CVA). |
| **Shared components** | `src/components/shared/` (16 components) | Layout, PageHeader, LoadingState, EmptyState, ErrorDisplay, ConfirmDialog, etc. |
| **Data access** | Components → Context hooks → Repository functions → Dexie | Components NEVER call Dexie directly. Always via context hooks. |

**Error Handling:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Render errors** | `ErrorBoundary` class component (with i18n-safe fallback) | Wraps every lazy route. Dev mode shows stack trace. |
| **Data errors** | Per-context `error` state + `ErrorDisplay` component | Each context tracks its own error. Cleared before new operations. |
| **User feedback** | sonner toasts (`toast.success` / `toast.error`) | Always with i18n keys. Called only from event handlers, never during render. |
| **Destructive actions** | `ConfirmDialog` (Radix Dialog) | Async-aware, stays open on error for retry, loading spinner, destructive variant. |
| **Async safety** | **Shared `useFormSubmission()` hook** (to be extracted) | Encapsulates `isMountedRef`, `isSubmittingRef`, `submitError` state, and try/catch/finally pattern. All forms MUST use this hook instead of copy-pasting the pattern. |

**Form Patterns:**

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Form library** | None (fully controlled components) | Individual `useState` per field or single `FormState` object. No react-hook-form. |
| **Validation** | **Inline validation is canonical for forms.** On-blur (field-level) + on-submit (full form). Zod schemas are NOT used in form components. | Single source of truth. Zod exists for repository/test layer only. |
| **Cross-field validation** | Manual in `validateForm()` | e.g., endDate >= startDate. |
| **Submit guard** | Via `useFormSubmission()` hook | Synchronous ref prevents race conditions. |
| **HTML** | `noValidate` on `<form>`, `aria-invalid`, `role="alert"` on errors | Accessible, no browser validation interference. |

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Hosting** | GitHub Pages (via `actions/deploy-pages@v4`) | Free, static-only, HTTPS enforced. Base URL: `/kikoushou/`. |
| **Package manager** | Bun (`bun install --frozen-lockfile`) | Used in all CI jobs and local development. |
| **CI pipeline** | GitHub Actions with 6 jobs | lint → typecheck → test → generate-icons → build → e2e (parallel where possible). |
| **Concurrency** | `cancel-in-progress: true` per branch | Saves CI minutes on rapid pushes. |
| **Versioning** | `VITE_APP_VERSION` set from git SHA/ref in CI | Displayed in SettingsPage. Defaults to `"devel"` locally. |
| **Base URL** | Dynamic: `/kikoushou/` in CI, `/` locally | `process.env.GITHUB_ACTIONS` conditional in `vite.config.ts`. |
| **Test coverage** | **80% line coverage** (aligned with PRD NFR25) | vitest.config.ts threshold MUST be updated from 70% to 80%. |
| **Accessibility testing** | `@axe-core/playwright` in E2E tests (SHOULD, not MUST) | Runs on critical user flows: share link landing, room assignment, transport entry. Does not gate CI. |
| **Performance testing** | Calendar rendering benchmark MUST exist | Synthetic test: render CalendarPage with 15 persons, 20+ assignments. Thresholds: initial render < 500ms, re-render < 100ms. Regression guard. |
| **TypeScript strictness** | Maximum: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noUncheckedIndexedAccess`, `noImplicitReturns` | Zero tolerance for type issues. |

**ARCHITECTURAL RULE: Bundle Chunk Size Constraint**

Maximum chunk size: **500KB** per JS chunk in `dist/assets/`.

**Splitting rationale:** Independent libraries with no circular dependencies to React get their own chunk. Libraries tightly coupled to React stay in the main chunk.

**Current splits:**
- `vendor-date` — date-fns (pure utility, no React deps)
- `vendor-i18n` — i18next core + browser language detector (standalone)
- `vendor-radix` — Radix UI primitives (large, self-contained)
- Main chunk — React, React Router, Dexie, dnd-kit, Leaflet, and application code

**CI enforcement:** Build step MUST check `dist/assets/*.js` sizes. If any chunk exceeds 500KB, the build warns. Candidates for future splitting if they grow: Leaflet/react-leaflet, dnd-kit.

### Decision Impact Analysis

**Implementation Sequence for New Features:**
1. Define types in `src/types/index.ts` (branded IDs, interfaces, form data types)
2. Add Dexie schema version + repository in `src/lib/db/repositories/` (use `*WithOwnershipCheck` pattern)
3. Add Zod validation schema in `src/lib/validation/schemas.ts` (for repository/test use only)
4. Create React Context provider in `src/contexts/` (insert at correct position in nesting order)
5. Build feature folder with pages, components, routes in `src/features/{name}/`
6. Forms use inline validation + `useFormSubmission()` hook
7. Wire routes into `src/router.tsx`
8. Add tests: unit (80%+), integration (cascade deletes), E2E (critical flows), accessibility (SHOULD)

**Cross-Component Dependencies:**
- All trip-scoped data flows through `TripContext.currentTripId`
- Context provider nesting order is load-bearing (see rule above)
- Share link import (`/share/:shareId`) operates outside the context hierarchy (see rule above)
- PWA service worker caching strategy affects offline behavior of map tiles and geocoding
- Bundle chunk splitting affects load performance on mobile/3G

## Implementation Patterns & Consistency Rules

### Critical Conflict Points Identified

12 areas where AI agents could make different choices if patterns are not documented explicitly.

### Naming Patterns

**Dexie Table & Index Naming:**
- Tables: camelCase plural (`trips`, `rooms`, `persons`, `roomAssignments`, `transports`, `settings`)
- Compound indexes: bracket notation `[tripId+startDate]`, `[tripId+order]`
- Unique indexes: `&shareId` prefix
- New tables MUST follow these conventions exactly

**Code Naming Conventions:**

| Element | Convention | Example |
|---------|-----------|---------|
| **Components** | PascalCase | `RoomCard`, `TransportForm`, `CalendarPage` |
| **Component files** | PascalCase.tsx | `RoomCard.tsx`, `TransportForm.tsx` |
| **Hooks** | camelCase with `use` prefix | `useFormSubmission`, `useOnlineStatus` |
| **Hook files** | camelCase.ts | `useFormSubmission.ts`, `useOnlineStatus.ts` |
| **Context files** | PascalCase + Context.tsx | `RoomContext.tsx`, `TripContext.tsx` |
| **Context hooks** | `use{Entity}Context` | `useRoomContext()`, `useTripContext()` |
| **Repository files** | kebab-case.ts | `room-repository.ts`, `trip-repository.ts` |
| **Repository functions** | camelCase verb-first | `createRoom`, `getRoomsByTripId`, `deleteRoomWithOwnershipCheck` |
| **Type files** | kebab-case or index.ts | `src/types/index.ts` |
| **Interfaces** | PascalCase, no `I` prefix | `Trip`, `Room`, `Person` (not `ITrip`) |
| **Branded types** | PascalCase + Id suffix | `TripId`, `RoomId`, `ShareId` |
| **Form data types** | `{Entity}FormData` | `TripFormData`, `RoomFormData` |
| **Zod schemas** | PascalCase + Schema | `TripFormDataSchema`, `RoomFormDataSchema` |
| **Utility files** | kebab-case.ts | `calendar-utils.ts`, `tile-cache.ts` |
| **Test files** | Co-located `__tests__/{name}.test.ts(x)` | `__tests__/RoomCard.test.tsx` |
| **Route files** | `routes.tsx` per feature | `src/features/rooms/routes.tsx` |
| **Constants** | UPPER_SNAKE_CASE | `MAX_LENGTHS`, `MAX_ID_RETRIES` |
| **CSS/Tailwind** | Tailwind utilities only, no custom CSS files | Use `className` with Tailwind classes |
| **i18n keys** | dot-separated lowercase | `trips.created`, `errors.saveFailed`, `common.delete` |
| **Path aliases** | `@/` prefix | `import { db } from '@/lib/db'` |

**Route Path Naming:**
- All routes are lowercase kebab-case
- Entity routes are nested: `/trips/:tripId/rooms`, `/trips/:tripId/transports/map`
- Route params use camelCase: `:tripId`, `:shareId`
- Share route is top-level: `/share/:shareId`

### Structure Patterns

**Feature Module Structure (canonical):**
```
src/features/{featureName}/
├── components/
│   ├── __tests__/
│   │   └── {ComponentName}.test.tsx
│   ├── {ComponentName}.tsx
│   └── {FormName}.tsx
├── pages/
│   └── {PageName}Page.tsx
├── utils/                    # (optional, only if needed)
│   └── {feature}-utils.ts
├── types.ts                  # (optional, feature-specific types)
├── routes.tsx                # Feature route definitions
└── index.ts                  # Barrel export
```

**Where things go:**

| Artifact | Location | Rule |
|----------|----------|------|
| Domain types & interfaces | `src/types/index.ts` | ALL entity types in one file. Feature-specific display types can live in `features/{name}/types.ts` |
| Dexie repositories | `src/lib/db/repositories/{entity}-repository.ts` | One file per entity. Pure async functions, no classes. |
| Zod schemas | `src/lib/validation/schemas.ts` | ALL schemas in one file, with validators in `src/lib/validation/index.ts` |
| React Contexts | `src/contexts/{Entity}Context.tsx` | One file per entity context. Provider + hook co-located. |
| Shared UI components | `src/components/shared/` | Cross-feature reusable components |
| shadcn/ui primitives | `src/components/ui/` | DO NOT modify directly unless adding variants file |
| PWA components | `src/components/pwa/` | Install prompt, offline indicator |
| Global hooks | `src/hooks/` | Hooks not tied to a specific feature |
| i18n translations | `src/locales/{lang}/` | One folder per language |
| Test setup | `src/test/` | Global test config and utilities |

**Test Co-location Rule:**
- Unit/integration tests go in `__tests__/` subdirectory adjacent to the code they test
- Repository tests: `src/lib/db/repositories/__tests__/`
- Component tests: `src/features/{name}/components/__tests__/`
- Context tests: `src/contexts/__tests__/`
- E2E tests: top-level `tests/` or `e2e/` (Playwright)

### Format Patterns

**Data Formats:**

| Data Type | Format | Example |
|-----------|--------|---------|
| **Dates** | ISO 8601 string branded as `ISODateString` | `'2026-07-15'` |
| **DateTimes** | ISO 8601 string branded as `ISODateTimeString` | `'2026-07-15T14:32:00'` |
| **Timestamps** | Unix milliseconds as `UnixTimestamp` | `Date.now()` |
| **Colors** | Hex string branded as `HexColor` | `'#3b82f6'` |
| **IDs** | nanoid string with branded type | `'V1StGXR8_Z5jdHi6B-myT'` |
| **Booleans** | `true`/`false` only | Never `1`/`0` or `'true'`/`'false'` |
| **Optional fields** | `undefined` (not `null`) | `description?: string` means absent = `undefined` |
| **Enums** | String literal unions | `'arrival' \| 'departure'`, `'train' \| 'plane' \| 'car' \| 'bus' \| 'other'` |

**JSON/Data Exchange:**
- camelCase field names in all data structures
- No `null` values -- use `undefined` for optional fields
- Branded types for all IDs, dates, and colors
- `readonly` modifier on fields that should never change after creation (`id`, `tripId`, `shareId`, `createdAt`)

### Communication Patterns

**State Update Patterns:**

| Pattern | Rule | Example |
|---------|------|---------|
| **Context state updates** | Always functional form | `setError(prev => prev ? null : prev)` |
| **Error clearing** | Clear before new operation | `clearErrorIfNeeded(setError)` |
| **Array comparison** | Use `areArraysEqual` for referential stability | Never replace array ref if contents unchanged |
| **Memoization** | `useMemo` for derived data, `useCallback` for handlers | All event handlers wrapped in `useCallback` |
| **Re-render prevention** | `useRef` + `useEffect` for Dexie query results | Compare new results against ref before updating state |

**Toast Notification Rules:**
- Always use i18n: `toast.success(t('key', 'fallback'))`
- `toast.success()` after successful DB write, from event handler only
- `toast.error()` in catch block, only if `isMountedRef.current`
- Never call toast during render
- Keep messages short and actionable

**Console Logging:**
- `console.error()` for caught errors in production paths
- `console.warn()` sparingly for recoverable issues
- `console.log()` only in development (guard with `import.meta.env.DEV` if needed)
- No logging libraries -- direct console calls

### Process Patterns

**Component Rendering Guard Sequence (canonical):**
```tsx
// Every page component follows this exact sequence:
if (isLoading) return <LoadingState />;
if (error) return <ErrorDisplay error={error} onRetry={retry} />;
if (!data) return <EmptyState />;
// ... main render
```

**Context CRUD Operation Pattern (canonical):**
```tsx
const handleCreate = useCallback(async (data: FormData) => {
  clearErrorIfNeeded(setError);
  try {
    await createEntityWithOwnershipCheck(currentTripId, data);
    // Dexie live query auto-updates UI -- no manual state update needed
  } catch (err) {
    wrapAndSetError(err, setError);
    throw err; // Re-throw so caller (dialog/form) can handle
  }
}, [currentTripId]);
```

**Form Submit Pattern (canonical, to be extracted as `useFormSubmission`):**
```tsx
if (isSubmittingRef.current) return;     // Synchronous guard
if (!validateForm()) return;              // Inline validation
isSubmittingRef.current = true;
setIsSubmitting(true);
setSubmitError(null);
try {
  await onSubmit(trimmedData);
} catch (error) {
  if (isMountedRef.current) setSubmitError(t('errors.saveFailed'));
} finally {
  isSubmittingRef.current = false;
  if (isMountedRef.current) setIsSubmitting(false);
}
```

**Dialog Interaction Pattern:**
- Dialog wraps Form component
- Dialog calls context CRUD in `onSubmit`
- On success: `toast.success()` + close dialog
- On error: `toast.error()` + keep dialog open for retry
- `ConfirmDialog` for all destructive actions (variant: `destructive`)

**URL-to-Context Sync Pattern:**
```tsx
// Every trip-scoped page:
const { tripId } = useParams<{ tripId: string }>();
const { setCurrentTrip } = useTripContext();

useEffect(() => {
  if (tripId) setCurrentTrip(tripId as TripId);
}, [tripId, setCurrentTrip]);
```

### Enforcement Guidelines

**All AI Agents MUST:**
1. Follow the naming conventions table exactly -- no exceptions
2. Place files in the canonical locations defined above
3. Use `*WithOwnershipCheck` variants for all context-level CRUD
4. Use inline validation in forms, NOT Zod
5. Use the `useFormSubmission()` hook (once extracted) for all form components
6. Wrap every lazy route in `<ErrorBoundary><Suspense>`
7. Follow the component rendering guard sequence
8. Use branded types for all entity IDs, dates, and colors
9. Use `undefined` for optional fields, never `null`
10. Use i18n for ALL user-facing strings (toast, labels, errors, empty states)

**All AI Agents MUST NOT:**
1. Call Dexie directly from components -- always go through context hooks
2. Use React Query / TanStack Query for anything
3. Use `null` where `undefined` is the convention
4. Create custom CSS files -- use Tailwind utilities only
5. Skip `noValidate` on `<form>` elements
6. Use `setState` in async callbacks without `isMountedRef` guard
7. Modify shadcn/ui primitives directly (add `.variants.ts` files instead)
8. Reorder the context provider nesting in `AppProviders.tsx`
9. Use context hooks on the `/share/:shareId` route

### Anti-Pattern Examples

**WRONG -- calling Dexie from component:**
```tsx
// DO NOT DO THIS
const rooms = useLiveQuery(() => db.rooms.where('tripId').equals(tripId).toArray());
```

**RIGHT -- using context hook:**
```tsx
const { rooms } = useRoomContext();
```

**WRONG -- using null for optional:**
```tsx
const description: string | null = null;
```

**RIGHT -- using undefined:**
```tsx
const description?: string = undefined;
```

**WRONG -- Zod validation in form component:**
```tsx
const result = TripFormDataSchema.safeParse(formData);
```

**RIGHT -- inline validation in form:**
```tsx
function validateForm(): boolean {
  const newErrors: FormErrors = {};
  if (!name.trim()) newErrors.name = t('validation.required');
  setErrors(newErrors);
  return Object.keys(newErrors).length === 0;
}
```

## Project Structure & Boundaries

### Complete Project Directory Structure

```
kikoushou/
├── .github/
│   └── workflows/
│       ├── ci.yml                          # CI: lint, typecheck, test, build, e2e
│       └── deploy.yml                      # Deploy to GitHub Pages
├── public/
│   └── icons/                              # Generated PWA icons (not committed)
├── scripts/
│   └── generate-icons.js                   # Sharp-based PWA icon generator
├── src/
│   ├── assets/                             # Static assets (SVGs, images)
│   ├── components/
│   │   ├── pwa/
│   │   │   ├── InstallPrompt.tsx           # PWA install prompt UI
│   │   │   ├── OfflineIndicator.tsx        # Network status banner
│   │   │   └── index.ts
│   │   ├── shared/
│   │   │   ├── __tests__/
│   │   │   ├── ColorPicker.tsx             # Person color selection
│   │   │   ├── ConfirmDialog.tsx           # Destructive action confirmation
│   │   │   ├── DateRangePicker.tsx         # Date range input
│   │   │   ├── EmptyState.tsx              # Empty state placeholder
│   │   │   ├── ErrorBoundary.tsx           # React error boundary
│   │   │   ├── ErrorDisplay.tsx            # Data error display
│   │   │   ├── Layout.tsx                  # App shell (sidebar/bottom nav)
│   │   │   ├── LoadingState.tsx            # Loading spinner
│   │   │   ├── LocationPicker.tsx          # Map-based location picker
│   │   │   ├── MapMarker.tsx               # Leaflet map marker
│   │   │   ├── MapOfflineIndicator.tsx     # Map offline status
│   │   │   ├── MapView.tsx                 # Leaflet map wrapper
│   │   │   ├── PageHeader.tsx              # Consistent page header
│   │   │   ├── PersonBadge.tsx             # Colored person badge
│   │   │   ├── RoomIconPicker.tsx          # Room icon selection
│   │   │   ├── TransportIcon.tsx           # Transport mode icon
│   │   │   └── index.ts
│   │   └── ui/                             # shadcn/ui primitives (DO NOT modify)
│   │       ├── avatar.tsx
│   │       ├── badge.tsx / badge.variants.ts
│   │       ├── button.tsx / button.variants.ts
│   │       ├── calendar.tsx
│   │       ├── card.tsx
│   │       ├── dialog.tsx
│   │       ├── dropdown-menu.tsx
│   │       ├── input.tsx
│   │       ├── label.tsx
│   │       ├── popover.tsx
│   │       ├── radio-group.tsx
│   │       ├── select.tsx
│   │       ├── separator.tsx
│   │       ├── sheet.tsx
│   │       ├── sonner.tsx
│   │       ├── switch.tsx
│   │       ├── tabs.tsx / tabs.variants.ts
│   │       └── textarea.tsx
│   ├── contexts/
│   │   ├── __tests__/
│   │   ├── AppProviders.tsx                # Composite provider (nesting order!)
│   │   ├── TripContext.tsx                  # Trip state + CRUD
│   │   ├── RoomContext.tsx                  # Room state + CRUD
│   │   ├── PersonContext.tsx                # Person state + CRUD
│   │   ├── AssignmentContext.tsx            # Assignment state + CRUD
│   │   ├── TransportContext.tsx             # Transport state + CRUD
│   │   ├── utils.ts                        # Shared context utilities
│   │   └── index.ts
│   ├── features/
│   │   ├── calendar/
│   │   │   ├── __tests__/
│   │   │   ├── components/
│   │   │   │   ├── CalendarDay.tsx
│   │   │   │   ├── CalendarDayHeader.tsx
│   │   │   │   ├── CalendarEventPill.tsx
│   │   │   │   ├── CalendarHeader.tsx
│   │   │   │   ├── EventDetailDialog.tsx
│   │   │   │   └── TransportIndicator.tsx
│   │   │   ├── pages/
│   │   │   │   └── CalendarPage.tsx
│   │   │   ├── utils/
│   │   │   │   └── calendar-utils.ts
│   │   │   ├── types.ts
│   │   │   ├── routes.tsx
│   │   │   └── index.ts
│   │   ├── persons/
│   │   │   ├── components/
│   │   │   │   ├── PersonCard.tsx
│   │   │   │   ├── PersonDialog.tsx
│   │   │   │   └── PersonForm.tsx
│   │   │   ├── pages/
│   │   │   │   └── PersonListPage.tsx
│   │   │   ├── routes.tsx
│   │   │   └── index.ts
│   │   ├── rooms/
│   │   │   ├── components/
│   │   │   │   ├── __tests__/
│   │   │   │   ├── DraggableGuest.tsx
│   │   │   │   ├── DroppableRoom.tsx
│   │   │   │   ├── QuickAssignmentDialog.tsx
│   │   │   │   ├── RoomAssignmentSection.tsx
│   │   │   │   ├── RoomCard.tsx
│   │   │   │   ├── RoomDialog.tsx
│   │   │   │   └── RoomForm.tsx
│   │   │   ├── pages/
│   │   │   │   └── RoomListPage.tsx
│   │   │   ├── routes.tsx
│   │   │   └── index.ts
│   │   ├── settings/
│   │   │   ├── pages/
│   │   │   │   └── SettingsPage.tsx
│   │   │   └── index.ts
│   │   ├── sharing/
│   │   │   ├── components/
│   │   │   │   └── ShareDialog.tsx
│   │   │   ├── pages/
│   │   │   │   └── ShareImportPage.tsx     # OUTSIDE AppProviders boundary
│   │   │   ├── routes.tsx
│   │   │   └── index.ts
│   │   ├── transports/
│   │   │   ├── components/
│   │   │   │   ├── __tests__/
│   │   │   │   ├── DirectionsButton.tsx
│   │   │   │   ├── TransportDialog.tsx
│   │   │   │   ├── TransportForm.tsx
│   │   │   │   └── UpcomingPickups.tsx
│   │   │   ├── pages/
│   │   │   │   ├── TransportListPage.tsx
│   │   │   │   └── TransportMapPage.tsx
│   │   │   ├── routes.tsx
│   │   │   └── index.ts
│   │   └── trips/
│   │       ├── components/
│   │       │   ├── __tests__/
│   │       │   ├── TripCard.tsx
│   │       │   ├── TripForm.tsx
│   │       │   └── TripLocationMap.tsx
│   │       ├── pages/
│   │       │   ├── TripCreatePage.tsx
│   │       │   ├── TripEditPage.tsx
│   │       │   └── TripListPage.tsx
│   │       ├── routes.tsx
│   │       └── index.ts
│   ├── hooks/
│   │   ├── __tests__/
│   │   ├── useInstallPrompt.ts             # PWA install prompt management
│   │   ├── useOnlineStatus.ts              # Network status detection
│   │   ├── useToday.ts                     # Current day tracking
│   │   └── index.ts
│   ├── lib/
│   │   ├── db/
│   │   │   ├── __tests__/
│   │   │   ├── repositories/
│   │   │   │   ├── __tests__/
│   │   │   │   ├── assignment-repository.ts
│   │   │   │   ├── person-repository.ts
│   │   │   │   ├── room-repository.ts
│   │   │   │   ├── settings-repository.ts
│   │   │   │   ├── transport-repository.ts
│   │   │   │   └── trip-repository.ts
│   │   │   ├── database.ts                 # Dexie DB class + schema
│   │   │   ├── sanitize.ts                 # Input sanitization
│   │   │   ├── utils.ts                    # ID generation, timestamps
│   │   │   └── index.ts
│   │   ├── i18n/
│   │   │   ├── __tests__/
│   │   │   └── index.ts                    # i18next configuration
│   │   ├── map/
│   │   │   ├── __tests__/
│   │   │   └── tile-cache.ts               # OSM tile caching utilities
│   │   ├── utils/                          # General utility functions
│   │   ├── validation/
│   │   │   ├── __tests__/
│   │   │   ├── schemas.ts                  # All Zod schemas
│   │   │   └── index.ts                    # Validation utilities
│   │   └── utils.ts                        # Shared utility functions
│   ├── locales/
│   │   ├── en/                             # English translations
│   │   └── fr/                             # French translations
│   ├── test/
│   │   ├── setup.ts                        # Vitest global setup
│   │   ├── setup.test.ts                   # Setup verification
│   │   └── utils.tsx                       # Test render utilities
│   ├── types/
│   │   ├── __tests__/
│   │   └── index.ts                        # ALL entity types, branded types
│   ├── App.tsx                             # Root component (Toaster, theme)
│   ├── main.tsx                            # Entry point (React root)
│   └── router.tsx                          # Route composition
├── package.json
├── bun.lock
├── tsconfig.json / tsconfig.app.json / tsconfig.node.json
├── vite.config.ts
├── vitest.config.ts
├── playwright.config.ts
├── eslint.config.js
├── index.html
└── README.md
```

### Architectural Boundaries

**Data Access Boundary:**
```
Components (React)
    │ NEVER cross this boundary directly
    ▼
Context Hooks (useRoomContext, etc.)
    │ Delegate to repositories
    ▼
Repository Functions (pure async)
    │ Sanitize inputs, manage transactions
    ▼
Dexie.js (IndexedDB)
```

AI agents MUST NOT skip layers. A component calling `db.rooms.add()` directly violates this boundary.

**Share Route Boundary:**
```
AppProviders (Trip → Room → Person → Assignment → Transport)
    │
    ├── /trips/*           ← Context hooks AVAILABLE
    ├── /settings          ← Context hooks AVAILABLE
    │
    └── /share/:shareId    ← Context hooks NOT AVAILABLE
                             Uses repository functions directly
```

**Feature Module Boundary:**
- Each feature owns its pages, components, routes
- Features communicate ONLY through contexts (never import from another feature's components)
- Shared functionality goes in `src/components/shared/` or `src/hooks/`
- Cross-feature types go in `src/types/index.ts`

**UI Layer Boundary:**
```
Feature Components (application logic)
    │ compose from
    ▼
Shared Components (cross-feature reusable)
    │ compose from
    ▼
shadcn/ui Primitives (DO NOT modify directly)
```

### Requirements to Structure Mapping

**FR Category to Feature Module:**

| FR Category | Feature Module | Key Files |
|-------------|---------------|-----------|
| Trip Management (FR1-5) | `features/trips/` | TripListPage, TripCreatePage, TripEditPage, TripForm |
| Person Management (FR6-10) | `features/persons/` | PersonListPage, PersonDialog, PersonForm |
| Room Management (FR11-16) | `features/rooms/` | RoomListPage, RoomCard, RoomDialog, RoomForm |
| Room Assignment (FR17-22) | `features/rooms/` | RoomAssignmentSection, QuickAssignmentDialog, DraggableGuest, DroppableRoom |
| Transport Tracking (FR23-30) | `features/transports/` | TransportListPage, TransportDialog, TransportForm, UpcomingPickups |
| Calendar Visualization (FR31-34) | `features/calendar/` | CalendarPage, CalendarDay, CalendarEventPill, EventDetailDialog |
| Trip Sharing (FR35-39) | `features/sharing/` | ShareDialog, ShareImportPage |
| Offline & Data (FR40-42) | `components/pwa/`, `lib/db/` | OfflineIndicator, InstallPrompt, database.ts, service worker |
| Internationalization (FR43-45) | `lib/i18n/`, `locales/` | i18n config, en/, fr/ |
| Maps (FR46) | `features/transports/` | TransportMapPage, DirectionsButton; `components/shared/` MapView, LocationPicker |

**Cross-Cutting Concerns to Location:**

| Concern | Primary Location | Supporting Files |
|---------|-----------------|-----------------|
| Offline-first data | `lib/db/` (Dexie), `vite.config.ts` (Workbox) | `components/pwa/OfflineIndicator.tsx` |
| i18n | `lib/i18n/`, `locales/{lang}/` | Every component via `useTranslation()` |
| Accessibility | Embedded in all components | `@axe-core/playwright` in E2E tests |
| Input sanitization | `lib/db/sanitize.ts` | Called by every repository |
| Validation | `lib/validation/` (Zod), inline in forms | Form components + repositories |
| Error handling | `components/shared/ErrorBoundary.tsx`, `ErrorDisplay.tsx` | Per-context error state, sonner toasts |
| Theme (dark/light) | `App.tsx` (`next-themes`), Tailwind config | All components via CSS variables |
| PWA lifecycle | `vite.config.ts` (vite-plugin-pwa) | `components/pwa/InstallPrompt.tsx` |
| ID generation | `lib/db/utils.ts` (nanoid) | All repositories |
| Type safety | `types/index.ts` (branded types) | All files via TypeScript |

### Data Flow

**Write Flow (user action to IndexedDB):**
```
User Action (click, submit)
    → Component Event Handler (useCallback)
        → Context CRUD Method (*WithOwnershipCheck)
            → Repository Function (sanitize → validate → transaction)
                → Dexie.js → IndexedDB
                    → useLiveQuery auto-triggers re-render
                        → UI updates automatically
```

**Read Flow (IndexedDB to UI):**
```
Dexie useLiveQuery (reactive, auto-subscribes to table changes)
    → Context Provider (stable refs, lookup maps)
        → Component (via useXContext() hook)
            → useMemo for derived data
                → Render
```

**Share Import Flow (special, outside context boundary):**
```
/share/:shareId URL
    → ShareImportPage (no context)
        → getTripByShareId() (direct repository call)
            → Display trip info
                → User clicks "View"
                    → setCurrentTrip() + navigate to /trips/:tripId/calendar
                        → Now inside context boundary, normal flow resumes
```

### Development Workflow Integration

**Local Development:**
- `bun run dev` → Vite dev server with HMR, base URL `/`
- `bun run test` → Vitest in watch mode
- `bun run lint` → ESLint check
- `bun run build` → Production build (base URL `/kikoushou/` if `GITHUB_ACTIONS`)

**CI Pipeline (`.github/workflows/ci.yml`):**
```
push/PR to main
    ├── lint (parallel)
    ├── typecheck (parallel)
    ├── test + coverage (parallel)
    ├── generate-icons (parallel)
    ├── build (depends on generate-icons)
    └── e2e (depends on build)
```

**Deploy Pipeline (`.github/workflows/deploy.yml`):**
```
push to main
    → build (icons + vite build, VITE_APP_VERSION=ref@sha)
        → deploy to GitHub Pages
```

**Build Output (`dist/`):**
```
dist/
├── assets/
│   ├── index-[hash].js           # Main chunk (< 500KB)
│   ├── vendor-date-[hash].js     # date-fns chunk
│   ├── vendor-i18n-[hash].js     # i18next chunk
│   ├── vendor-radix-[hash].js    # Radix UI chunk
│   └── index-[hash].css          # Tailwind CSS
├── icons/                        # Generated PWA icons
├── registerSW.js                 # Service worker registration
├── sw.js                         # Workbox service worker
├── manifest.webmanifest          # PWA manifest
└── index.html                    # SPA entry point
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:** All technology choices are verified compatible. React 19 + Vite 7 + TypeScript 5.9 + Tailwind CSS 4 + Dexie.js 4.2 is a proven, conflict-free stack. The only inconsistency (unused TanStack React Query dependency) is captured as action item AI-1 for removal.

**Pattern Consistency:** All naming conventions, code patterns, and structural rules are internally consistent. Canonical patterns are documented with concrete code examples. No contradictions between decisions and patterns.

**Structure Alignment:** Feature-based organization maps cleanly to all architectural decisions. Data access boundary (Components → Contexts → Repositories → Dexie), share route boundary, and UI layer boundary are clearly defined with enforcement rules.

### Requirements Coverage Validation

**Functional Requirements:** All 46 FRs (FR1-46) across 9 domains are mapped to specific feature modules with identified key files. No functional requirement lacks architectural support.

**Non-Functional Requirements:** All 26 NFRs (NFR1-26) are architecturally addressed:
- Performance (NFR1-7): Lazy loading, chunk splitting (< 500KB), Workbox precaching, Dexie live queries for reactivity. Calendar performance test needed (AI-5). Bundle size CI check needed (AI-7).
- Accessibility (NFR8-14): WCAG patterns documented, axe-core in E2E as SHOULD. Touch targets, contrast, ARIA, keyboard nav, reduced motion specified.
- Offline & Reliability (NFR15-19): IndexedDB via Dexie with atomic transactions, Workbox precaching, autoUpdate service worker.
- Security (NFR20-22): UUID share links, HTTPS enforced, low-risk data model.
- Code Quality (NFR23-26): TypeScript strict mode, ESLint zero errors, 80% coverage target (AI-4), Lighthouse gates.

### Implementation Readiness Validation

**Decision Completeness:** All critical decisions documented with specific library versions. Implementation patterns include concrete code examples for every canonical pattern. Consistency rules cover 10 MUST and 9 MUST NOT directives.

**Structure Completeness:** Complete directory tree with every existing file annotated. Feature module template defined. File placement rules cover all artifact types.

**Pattern Completeness:** 12 conflict points identified and resolved. Anti-pattern examples provided. Enforcement guidelines explicit.

### Gap Analysis Results

**Critical Gaps:** None identified. Architecture is implementation-ready.

**Action Items (from review, important but non-blocking):**

| ID | Action | Priority | Status |
|----|--------|----------|--------|
| AI-1 | Remove `@tanstack/react-query` dependency | High | Pending |
| AI-2 | Deprecate non-ownership-checking repository variants | High | Pending |
| AI-3 | Extract `useFormSubmission()` hook | Medium | Pending |
| AI-4 | Align vitest coverage threshold to 80% | Medium | Pending |
| AI-5 | Add calendar rendering performance test | Medium | Pending |
| AI-6 | Add cascade delete partial-failure integration tests | Medium | Pending |
| AI-7 | Add CI chunk size check (500KB) | Low | Pending |

**Minor Gaps (documented, not blocking):**
- No explicit error recovery for IndexedDB corruption/quota exceeded (low risk for MVP data volumes)
- `TripListPage` queries Dexie directly for cross-trip person data (documented exception to context-only rule)
- No monitoring/analytics strategy (acceptable for side project)

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (low-medium, front-end PWA)
- [x] Technical constraints identified (no backend, IndexedDB, offline-first)
- [x] Cross-cutting concerns mapped (offline, i18n, a11y, performance, PWA, error handling)

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified (all dependencies with versions)
- [x] Data architecture defined (entity model, relationships, cascade rules)
- [x] Security model defined (zero-auth, UUID share links)
- [x] Frontend architecture defined (contexts, state management, routing)
- [x] Infrastructure defined (GitHub Pages, CI/CD, PWA)
- [x] 3 architectural rules established (context nesting, share boundary, chunk size)

**Implementation Patterns**
- [x] Naming conventions established (20 element types covered)
- [x] Structure patterns defined (feature module template, file placement rules)
- [x] Communication patterns specified (state updates, toasts, logging)
- [x] Process patterns documented (rendering guards, CRUD ops, form submission, dialogs, URL sync)
- [x] Enforcement guidelines with 10 MUST and 9 MUST NOT rules
- [x] Anti-pattern examples provided

**Project Structure**
- [x] Complete directory structure defined
- [x] Architectural boundaries documented (4 boundaries)
- [x] FR-to-structure mapping complete (all 46 FRs)
- [x] Cross-cutting concern mapping complete (10 concerns)
- [x] Data flow diagrams (write, read, share import)
- [x] Development workflow integration (local dev, CI, deploy, build output)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High -- brownfield project with existing, tested codebase. Architecture documents what IS with identified improvements, not speculative design.

**Key Strengths:**
- Architecture derived from actual codebase analysis, not theoretical design
- Strong type safety via branded types preventing cross-entity ID misuse
- Clear data access boundary with 4-layer architecture
- Explicit rules preventing AI agent inconsistency (10 MUST, 9 MUST NOT)
- Comprehensive pattern documentation with code examples and anti-patterns
- All 46 FRs and 26 NFRs mapped to architectural support

**Areas for Future Enhancement:**
- IndexedDB corruption recovery strategy (post-MVP)
- P2P sync architecture (when/if needed)
- Monitoring/analytics (when user base grows)
- Guest onboarding wizard architecture (highest-priority UX feature, will need new components in `features/sharing/` or new `features/onboarding/`)

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries (data access, share route, UI layers)
- Refer to this document for all architectural questions
- When in doubt, look at existing code for the established pattern

**First Implementation Priorities:**
1. AI-1: Remove `@tanstack/react-query` (cleans up confusion)
2. AI-4: Update vitest coverage threshold to 80%
3. AI-3: Extract `useFormSubmission()` hook (reduces copy-paste)
4. AI-2: Migrate to `*WithOwnershipCheck` variants exclusively
5. Then: UX polish per PRD finalization priorities
