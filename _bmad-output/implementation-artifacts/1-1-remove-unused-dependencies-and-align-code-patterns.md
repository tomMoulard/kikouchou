# Story 1.1: Remove Unused Dependencies and Align Code Patterns

Status: ready-for-dev

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **developer**,
I want unused dependencies removed and shared patterns extracted,
so that the codebase is clean, consistent, and ready for UX work.

## Acceptance Criteria

1. **Given** the project has `@tanstack/react-query` as a dependency
   **When** I remove the package and all references
   **Then** the build passes with zero errors and no runtime references to react-query remain

2. **Given** multiple form components duplicate the submit/guard/error pattern
   **When** I extract a shared `useFormSubmission()` hook in `src/hooks/`
   **Then** all existing form components use the hook and the duplicated pattern is eliminated

3. **Given** some repository functions lack ownership validation
   **When** I audit all context-level CRUD calls
   **Then** all context CRUD uses `*WithOwnershipCheck` variants and non-checking variants are marked `@deprecated`

4. **Given** the vitest coverage threshold is set below 80%
   **When** I update `vitest.config.ts`
   **Then** the coverage threshold is set to 80% and CI enforces it

## Tasks / Subtasks

- [ ] Task 1: Remove `@tanstack/react-query` (AC: #1)
  - [ ] 1.1 Run `bun remove @tanstack/react-query` to uninstall the package
  - [ ] 1.2 Remove the dependency line from `package.json` (line 37: `"@tanstack/react-query": "^5.90.20"`)
  - [ ] 1.3 Search entire `src/` for any imports from `@tanstack/react-query` and remove them (currently zero actual imports in app code — only in `package.json` and `bun.lock`)
  - [ ] 1.4 Run `bun run build` and `bun run test:run` to confirm zero errors
  - [ ] 1.5 Run `bun run lint` to confirm zero warnings/errors

- [ ] Task 2: Extract `useFormSubmission()` hook (AC: #2)
  - [ ] 2.1 Create `src/hooks/useFormSubmission.ts` implementing the canonical submit pattern
  - [ ] 2.2 Hook must encapsulate: `isSubmittingRef`, `isMountedRef`, `isSubmitting` state, `submitError` state, and the try/catch/finally wrapper
  - [ ] 2.3 Hook signature: `useFormSubmission<T>(onSubmit: (data: T) => Promise<void>, options?: { onError?: (error: unknown) => void })` returning `{ isSubmitting, submitError, handleSubmit, clearError }`
  - [ ] 2.4 Refactor all 11 form components that duplicate the pattern:
    - `src/features/transports/components/TransportForm.tsx`
    - `src/features/transports/components/TransportDialog.tsx`
    - `src/features/persons/components/PersonDialog.tsx`
    - `src/features/persons/components/PersonForm.tsx`
    - `src/features/rooms/components/RoomDialog.tsx`
    - `src/features/rooms/components/RoomForm.tsx`
    - `src/features/rooms/components/RoomAssignmentSection.tsx`
    - `src/features/rooms/components/QuickAssignmentDialog.tsx`
    - `src/features/trips/pages/TripCreatePage.tsx`
    - `src/features/trips/pages/TripEditPage.tsx`
    - `src/features/trips/components/TripForm.tsx`
  - [ ] 2.5 Write unit tests in `src/hooks/__tests__/useFormSubmission.test.ts`
  - [ ] 2.6 Verify all existing tests pass after refactoring

- [ ] Task 3: Deprecate non-ownership repository variants (AC: #3)
  - [ ] 3.1 Audit all repository files to identify non-ownership-checking update/delete functions:
    - `src/lib/db/repositories/room-repository.ts`: `updateRoom`, `deleteRoom`
    - `src/lib/db/repositories/person-repository.ts`: `updatePerson`, `deletePerson`
    - `src/lib/db/repositories/assignment-repository.ts`: `updateAssignment`, `deleteAssignment`
    - `src/lib/db/repositories/transport-repository.ts`: `updateTransport`, `deleteTransport`
  - [ ] 3.2 Add `@deprecated` JSDoc tag to each non-ownership variant with message: "Use *WithOwnershipCheck variant instead. This function will be removed in a future version."
  - [ ] 3.3 Verify all context files already use `*WithOwnershipCheck` internally (confirmed: all 4 contexts do)
  - [ ] 3.4 Search for any direct usage of deprecated variants from components (should be zero — components go through contexts)
  - [ ] 3.5 Update `src/lib/db/index.ts` barrel exports to add deprecation comments

- [ ] Task 4: Update vitest coverage threshold to 80% (AC: #4)
  - [ ] 4.1 Edit `vitest.config.ts` line 62-66: change all threshold values from `70` to `80`
  - [ ] 4.2 Run `bun run test:coverage` to verify current coverage meets 80%
  - [ ] 4.3 If coverage is below 80%, document which areas need additional tests (do NOT write tests in this story — that's Epic 3 scope)

- [ ] Task 5: Final validation
  - [ ] 5.1 Run full validation: `bun run validate` (test, lint, build, e2e)
  - [ ] 5.2 Verify TypeScript strict mode passes: `tsc --noEmit` with zero errors (NFR23)
  - [ ] 5.3 Verify ESLint passes with zero warnings/errors (NFR24)

## Dev Notes

### Architecture Patterns and Constraints

- **Context Provider nesting order is load-bearing and MUST NOT change:** Trip > Room > Person > Assignment > Transport (in `src/contexts/AppProviders.tsx`)
- **Components NEVER call Dexie directly** — always through context hooks (AR-11)
- **Forms use inline validation, NOT Zod** — Zod is for repository/test layer only (AR-12)
- **All user-facing strings MUST use i18n** — toast messages, labels, errors, empty states (AR-13)
- **All lazy routes MUST be wrapped in `<ErrorBoundary><Suspense>`** (AR-14)
- **Use branded types for all entity IDs, dates, and colors** (AR-15)

### Source Tree Components to Touch

**Task 1 (react-query removal):**
- `package.json` — remove `@tanstack/react-query` from dependencies
- `bun.lock` — auto-updated by `bun remove`

**Task 2 (useFormSubmission hook):**
- NEW: `src/hooks/useFormSubmission.ts` — the shared hook
- NEW: `src/hooks/__tests__/useFormSubmission.test.ts` — unit tests
- MODIFY: `src/hooks/index.ts` — add barrel export
- MODIFY: 11 form components listed in Task 2.4 — replace duplicated pattern with hook usage

**Task 3 (deprecation):**
- MODIFY: `src/lib/db/repositories/room-repository.ts`
- MODIFY: `src/lib/db/repositories/person-repository.ts`
- MODIFY: `src/lib/db/repositories/assignment-repository.ts`
- MODIFY: `src/lib/db/repositories/transport-repository.ts`
- MODIFY: `src/lib/db/index.ts`

**Task 4 (coverage threshold):**
- MODIFY: `vitest.config.ts`

### useFormSubmission Hook Design

The hook must follow the exact canonical pattern documented in the architecture:

```typescript
import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface UseFormSubmissionOptions {
  /** Custom error message i18n key (defaults to 'errors.saveFailed') */
  errorKey?: string;
}

interface UseFormSubmissionReturn<T> {
  isSubmitting: boolean;
  submitError: string | undefined;
  handleSubmit: (data: T) => Promise<void>;
  clearError: () => void;
}

export function useFormSubmission<T>(
  onSubmit: (data: T) => Promise<void>,
  options?: UseFormSubmissionOptions
): UseFormSubmissionReturn<T> {
  const { t } = useTranslation();
  const isSubmittingRef = useRef(false);
  const isMountedRef = useRef(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>(undefined);

  // Track mount state
  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  const handleSubmit = useCallback(async (data: T) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);
    setSubmitError(undefined);
    try {
      await onSubmit(data);
    } catch (error) {
      if (isMountedRef.current) {
        setSubmitError(t(options?.errorKey ?? 'errors.saveFailed', 'Save failed'));
      }
      throw error; // Re-throw so caller can handle (e.g., keep dialog open)
    } finally {
      isSubmittingRef.current = false;
      if (isMountedRef.current) {
        setIsSubmitting(false);
      }
    }
  }, [onSubmit, t, options?.errorKey]);

  const clearError = useCallback(() => {
    setSubmitError(undefined);
  }, []);

  return { isSubmitting, submitError, handleSubmit, clearError };
}
```

**Critical implementation notes:**
- Use `undefined` for optional fields, NEVER `null` (architecture convention)
- The `isSubmittingRef` is the synchronous guard against double-submit — `isSubmitting` state is for UI only
- Re-throw errors so callers (dialogs) can keep themselves open on failure
- Use `isMountedRef` to prevent state updates after unmount
- Toast notifications remain in the calling component (not in the hook) — toasts are called only from event handlers per architecture rules

### Testing Standards

- **Framework:** Vitest 4.0 + @testing-library/react
- **Test location:** `src/hooks/__tests__/useFormSubmission.test.ts`
- **Coverage target:** 80%+ line coverage (NFR25)
- **Test co-location:** Tests go in `__tests__/` subdirectory adjacent to code
- **Naming:** Test file matches source: `useFormSubmission.test.ts`

### Anti-Patterns to Avoid

- **DO NOT** add any new dependencies to replace react-query
- **DO NOT** use `null` where `undefined` is convention
- **DO NOT** create custom CSS files — Tailwind utilities only
- **DO NOT** modify the context provider nesting order
- **DO NOT** use Zod validation in form components
- **DO NOT** call `setState` in async callbacks without `isMountedRef` guard
- **DO NOT** change existing form validation logic — only extract the submit/guard/error pattern

### Project Structure Notes

- Alignment with unified project structure: All new files follow canonical locations (`src/hooks/` for shared hooks, `__tests__/` for tests)
- No conflicts or variances detected
- The `useFormSubmission` hook follows the naming convention: camelCase with `use` prefix, file named `useFormSubmission.ts`

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Action Items Identified During Review] — AI-1 (react-query), AI-2 (ownership check), AI-3 (useFormSubmission), AI-4 (coverage 80%)
- [Source: _bmad-output/planning-artifacts/architecture.md#Form Patterns] — Canonical form submit pattern
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Handling] — useFormSubmission hook spec
- [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines] — MUST/MUST NOT rules
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1] — Story acceptance criteria with BDD format
- [Source: package.json:37] — `@tanstack/react-query` dependency to remove
- [Source: vitest.config.ts:62-66] — Coverage thresholds at 70% to update to 80%

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
