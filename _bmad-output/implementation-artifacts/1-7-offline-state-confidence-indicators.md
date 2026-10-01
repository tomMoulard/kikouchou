# Story 1.7: Offline State Confidence Indicators

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **user at a rural vacation house with spotty connectivity**,
I want clear feedback that my edits are saved locally,
so that I trust the app works even without internet.

## Acceptance Criteria

1. **Given** the device has no network connectivity
   **When** the user opens the app (after first load)
   **Then** a non-intrusive offline indicator is visible (not blocking UI) and all features remain fully functional (NFR15)

2. **Given** the user creates or edits data while offline
   **When** the IndexedDB write completes
   **Then** a brief, reassuring confirmation appears (e.g., "Saved locally") distinct from the online success toast

3. **Given** the device transitions between online and offline
   **When** connectivity changes
   **Then** the offline indicator updates within 2 seconds and the transition is smooth (no flash or jarring UI change)

4. **Given** `prefers-reduced-motion` is enabled
   **When** the offline indicator animates
   **Then** animations are suppressed per NFR12

## Tasks / Subtasks

- [x] Task 1: Enhance OfflineIndicator with improved UX (AC: #1, #3, #4)
  - [x] 1.1 Update `src/components/pwa/OfflineIndicator.tsx` to improve the visual design for better trust-building:
    - Replace the `Badge` with a more visible but still non-intrusive bar or banner
    - Use a warm, reassuring tone (not alarming red/destructive) for the offline state — use an amber/warm tone consistent with the app's vacation personality (Story 1.2 color palette)
    - Ensure the indicator does NOT block any interactive elements (currently fixed top-0, verify it doesn't cover the header)
    - Position below the header (`top-14` to clear the 56px header) or integrate into the header area
  - [x] 1.2 Add `motion-safe:` prefix to ALL transition/animation classes in OfflineIndicator (currently missing — the `transition-transform duration-300` and `transition-colors duration-300` need `motion-safe:` wrapping per NFR12)
  - [x] 1.3 Verify the offline indicator updates within 2 seconds of connectivity change. The existing `useOnlineStatus` hook uses browser `online`/`offline` events which fire near-instantly. Confirm the visual update path is < 2s (the current `setTimeout(0)` in the effect should be fast enough, but verify)
  - [x] 1.4 Add a subtle pulse or glow animation (with `motion-safe:` prefix) to the offline indicator to draw gentle attention without being distracting
  - [x] 1.5 Improve the "back online" transition: currently shows a green badge for 3 seconds. Make the transition smoother — fade in the "back online" message, hold briefly, then fade out. Avoid jarring color switches.

- [x] Task 2: Create "Saved locally" toast variant for offline data writes (AC: #2)
  - [x] 2.1 Create a new utility function or hook that wraps toast notifications to differentiate between online and offline success messages:
    - When online: use existing `toast.success(t('...'))` pattern unchanged
    - When offline: use `toast.success(t('pwa.savedLocally'))` or a custom toast with a distinct visual (e.g., a cloud-off icon + "Saved on this device") to reassure users their data is safe
  - [x] 2.2 The simplest approach: create a `useOfflineAwareToast` hook in `src/hooks/` that:
    - Calls `useOnlineStatus()` to get current connectivity state
    - Exports a `successToast(onlineMessage: string)` function
    - When online: calls `toast.success(onlineMessage)` as usual
    - When offline: calls `toast.success(t('pwa.savedLocally', 'Saved on this device'))` with a custom icon
    - Returns the hook function for components to use
  - [x] 2.3 Integrate `useOfflineAwareToast` into ALL components that show success toasts after data writes:
    - `src/features/rooms/components/RoomDialog.tsx` — room create/update success
    - `src/features/rooms/components/RoomAssignmentSection.tsx` — assignment create/update/delete success
    - `src/features/rooms/components/QuickAssignmentDialog.tsx` — assignment create success
    - `src/features/rooms/pages/RoomListPage.tsx` — room delete success
    - `src/features/persons/components/PersonDialog.tsx` — person create/update success
    - `src/features/transports/components/TransportDialog.tsx` — transport create/update success
    - `src/features/transports/pages/TransportListPage.tsx` — transport delete success
    - `src/features/transports/components/UpcomingPickups.tsx` — volunteer driver success
    - `src/features/calendar/pages/CalendarPage.tsx` — assignment/transport delete success
    - `src/features/settings/pages/SettingsPage.tsx` — language change, data clear success
  - [x] 2.4 Ensure the "Saved locally" toast uses a different visual from the standard success toast:
    - Use a cloud-off or device icon (e.g., `Smartphone` or `HardDrive` from lucide-react) instead of the default checkmark
    - Use a slightly different background tone (e.g., warm amber from the app palette) or keep the green but add the icon distinction
    - The toast message should be short and reassuring: "Saved on this device" or "Saved locally"

- [x] Task 3: Add i18n keys for new text (AC: #1, #2, #3)
  - [x] 3.1 Add to `src/locales/en/translation.json`:
    - `pwa.savedLocally`: "Saved on this device"
    - `pwa.offlineDescription`: "Your changes are saved locally and the app works normally"
    - `pwa.connectionRestored`: "Connection restored"
  - [x] 3.2 Add to `src/locales/fr/translation.json`:
    - `pwa.savedLocally`: "Enregistre sur cet appareil"
    - `pwa.offlineDescription`: "Vos modifications sont enregistrees localement et l'application fonctionne normalement"
    - `pwa.connectionRestored`: "Connexion retablie"

- [x] Task 4: Write tests (AC: #1, #2, #3, #4)
  - [x] 4.1 Create `src/components/pwa/__tests__/OfflineIndicator.test.tsx`:
    - Test renders offline indicator when `useOnlineStatus` returns `isOnline: false`
    - Test renders "back online" message when `hasRecentlyChanged: true` and `isOnline: true`
    - Test renders nothing when fully online (`isOnline: true`, `hasRecentlyChanged: false`)
    - Test uses ARIA live region (`role="status"`, `aria-live="polite"`)
    - Test animations use `motion-safe:` prefix (check class names)
    - Test offline indicator does not have `variant="destructive"` (should be warm/amber)
  - [x] 4.2 Create `src/hooks/__tests__/useOfflineAwareToast.test.ts`:
    - Test calls standard `toast.success(message)` when online
    - Test calls `toast.success` with "Saved on this device" message when offline
    - Test uses correct i18n key (`pwa.savedLocally`)

- [x] Task 5: Final validation (AC: #1, #2, #3, #4)
  - [x] 5.1 Run `bun run build` and confirm zero build errors
  - [x] 5.2 Run `tsc --noEmit` and confirm zero TypeScript errors (NFR23)
  - [x] 5.3 Run `bun run lint` and confirm no NEW lint errors introduced (baseline: 23 errors from Story 1.6)
  - [x] 5.4 Run `bun run test:run` and confirm all existing tests pass plus new tests
  - [ ] 5.5 Manually verify on mobile viewport (375px): offline indicator is visible but non-intrusive, positioned below header, not blocking any UI elements *(requires manual testing)*
  - [ ] 5.6 Manually verify: disconnect network -> see offline indicator appear smoothly -> create/edit data -> see "Saved on this device" toast -> reconnect -> see "Connection restored"/"Back online" message briefly -> indicator fades out *(requires manual testing)*
  - [ ] 5.7 Manually verify with `prefers-reduced-motion: reduce` in DevTools: all animations are suppressed, transitions are instant *(requires manual testing)*

## Dev Notes

### Architecture Patterns and Constraints

- **Components NEVER call Dexie directly** (AR-11) — always through context hooks (`useRoomContext`, `usePersonContext`, etc.)
- **Context Provider nesting order is load-bearing** (AR-9): Trip > Room > Person > Assignment > Transport — DO NOT change
- **All user-facing strings MUST use i18n** (AR-13) — every new label must be added to both `en/translation.json` and `fr/translation.json`
- **Forms use inline validation, NOT Zod** (AR-12)
- **Use branded types for all entity IDs, dates, and colors** (AR-15)
- **shadcn/ui primitives in `src/components/ui/` — DO NOT modify** base components
- **Tailwind utilities only** — DO NOT create new CSS files
- **Mobile-first responsive pattern** — base classes for mobile, `md:` overrides for desktop
- **Toast pattern** — use `toast.success()` / `toast.error()` from `sonner` at the component level, only in event handlers
- **Respect `prefers-reduced-motion`** (NFR12) — use `motion-safe:` Tailwind prefix for any animations. This was a review finding (M-1) in Story 1.6.
- **`useOnlineStatus` hook** (existing at `src/hooks/useOnlineStatus.ts`) — uses `useSyncExternalStore` for tear-safe updates. Returns `{ isOnline, hasRecentlyChanged }`. The `hasRecentlyChanged` flag auto-resets after 3 seconds.
- **`OfflineIndicator` component** (existing at `src/components/pwa/OfflineIndicator.tsx`) — currently displays a Badge variant at the top of the screen. Already has ARIA live region. Already rendered in `App.tsx` outside the router.

### Source Tree Components to Touch

**Task 1 (OfflineIndicator enhancement):**
- MODIFY: `src/components/pwa/OfflineIndicator.tsx` — Improve visual design, positioning, motion-safe prefixes, transitions

**Task 2 (Offline-aware toast):**
- NEW: `src/hooks/useOfflineAwareToast.ts` — Hook wrapping toast with offline-aware messaging
- MODIFY: `src/hooks/index.ts` — Add barrel export for useOfflineAwareToast
- MODIFY: `src/features/rooms/components/RoomDialog.tsx` — Use useOfflineAwareToast
- MODIFY: `src/features/rooms/components/RoomAssignmentSection.tsx` — Use useOfflineAwareToast
- MODIFY: `src/features/rooms/components/QuickAssignmentDialog.tsx` — Use useOfflineAwareToast
- MODIFY: `src/features/rooms/pages/RoomListPage.tsx` — Use useOfflineAwareToast
- MODIFY: `src/features/persons/components/PersonDialog.tsx` — Use useOfflineAwareToast
- MODIFY: `src/features/transports/components/TransportDialog.tsx` — Use useOfflineAwareToast
- MODIFY: `src/features/transports/pages/TransportListPage.tsx` — Use useOfflineAwareToast
- MODIFY: `src/features/transports/components/UpcomingPickups.tsx` — Use useOfflineAwareToast
- MODIFY: `src/features/calendar/pages/CalendarPage.tsx` — Use useOfflineAwareToast
- MODIFY: `src/features/settings/pages/SettingsPage.tsx` — Use useOfflineAwareToast

**Task 3 (i18n):**
- MODIFY: `src/locales/en/translation.json` — Add pwa.savedLocally, pwa.offlineDescription, pwa.connectionRestored
- MODIFY: `src/locales/fr/translation.json` — Add French translations

**Task 4 (tests):**
- NEW: `src/components/pwa/__tests__/OfflineIndicator.test.tsx` — Unit tests for OfflineIndicator
- NEW: `src/hooks/__tests__/useOfflineAwareToast.test.ts` — Unit tests for the new hook

### Project Structure Notes

- Alignment with unified project structure: New hook goes in `src/hooks/`, tests go in `__tests__/` adjacent to source files.
- No changes to context providers, repositories, or database schema.
- No changes to the router.
- `OfflineIndicator` is rendered in `App.tsx` outside the router, so it's globally visible on all routes including `/share/:shareId`.

### Previous Story Intelligence (Story 1.6)

- **Code review found M-1**: Missing `motion-safe:` prefix on `Loader2` spinner animations. This establishes the pattern — ALL animations in the codebase should have `motion-safe:` prefix per NFR12.
- **`useUnsavedChanges` hook** was added — demonstrates the pattern for creating new hooks with barrel exports.
- **Lint baseline: 23 errors, 4 warnings** — do not introduce new ones.
- **Test baseline from Story 1.6**: 38 files, 1301 tests passing. Use as baseline.
- **Agent model used:** claude-opus-4-6 (via OpenCode) — maintain consistency.
- **Touch target pattern**: `h-11 md:h-9` for mobile 44px compliance.
- **`skipNextBlock()` pattern**: demonstrates ref-based approach for bypassing hooks in specific scenarios.

### Previous Story Intelligence (Story 1.5)

- **Amber alert styling** for urgency (pickup alerts). The offline indicator should NOT use red/destructive — it should use a warm, reassuring tone. Amber/warm styling is already established in the design system from Story 1.2.
- **DriverSelectDialog** and **UpcomingPickups** patterns — relevant for understanding where success toasts are called.

### Previous Story Intelligence (Story 1.2)

- **Color palette** updated to warm teal/amber/sand using OKLCH. The offline indicator should use the warm amber tone, NOT red/destructive. The `destructive` variant (red) is reserved for actual errors and dangerous actions.
- **CSS custom properties** available: `--warm-amber`, `--warm-sand`, etc. in the Tailwind theme.

### Git Intelligence

- Recent commits: `feat: story 1.6` (900ec77), `feat: story 1.5` (7cad426), `feat: story 1.4` (05f6674)
- Commit message pattern: `feat: story X.Y` for story implementations
- Previous stories are single commits — aim for the same pattern

### Technical Notes

**Existing OfflineIndicator state:**
The current component (152 lines) at `src/components/pwa/OfflineIndicator.tsx`:
- Uses `useOnlineStatus()` hook for connectivity detection
- Displays a `Badge` variant (destructive when offline, green when "back online")
- Fixed positioning at `top-0` — **this overlaps with the header** (header is `sticky top-0 z-40 h-14`)
- Has `z-50` so it renders above header, but this means it COVERS the header
- Has ARIA live region (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`)
- Uses `transition-transform duration-300` and `transition-colors duration-300` — **missing `motion-safe:` prefix**
- "Back online" message shows for 3 seconds via `RECENT_CHANGE_DURATION_MS` in `useOnlineStatus`

**What needs to change for OfflineIndicator:**
1. Fix positioning — move below header or integrate with header to avoid overlap
2. Change offline styling from `variant="destructive"` (red) to warm amber — this is NOT an error, it's a reassurance
3. Add `motion-safe:` prefix to all transition/animation classes
4. Improve "back online" transition smoothness
5. Optionally add an informational description (e.g., "Your changes are saved locally")

**Existing useOnlineStatus hook state:**
The hook (229 lines) at `src/hooks/useOnlineStatus.ts`:
- Uses `useSyncExternalStore` for tear-safe status tracking
- Global event listeners for `online`/`offline` browser events
- `hasRecentlyChanged` flag auto-resets after 3000ms
- SSR-safe with `getServerSnapshot` returning `true`
- Properly cleans up timers on unmount

**What needs to change for useOnlineStatus:**
- Nothing. The hook is well-implemented and provides everything needed. The new `useOfflineAwareToast` hook will consume it.

**Toast pattern for offline distinction:**
- Current: All success toasts use `toast.success(t('entity.createSuccess'))` regardless of connectivity
- Desired: When offline, show "Saved on this device" instead of the entity-specific success message
- Implementation: A thin wrapper hook that checks `isOnline` and swaps the message
- Sonner supports custom icons via the `icon` prop: `toast.success(message, { icon: <Smartphone /> })`

**Sonner toast API (already in use):**
```typescript
import { toast } from 'sonner';

// Current usage:
toast.success(t('rooms.createSuccess', 'Room created successfully'));

// Desired offline-aware usage:
const { successToast } = useOfflineAwareToast();
successToast(t('rooms.createSuccess', 'Room created successfully'));
// When offline → shows "Saved on this device" with device icon
// When online → shows "Room created successfully" as before
```

### Testing Standards

- **Existing tests must pass** — run `bun run test:run` to confirm no regressions
- **New tests needed**: OfflineIndicator unit tests, useOfflineAwareToast hook unit tests
- **Mock `useOnlineStatus`** in OfflineIndicator tests to control `isOnline` and `hasRecentlyChanged` values
- **Mock `toast` from sonner** in useOfflineAwareToast tests to verify correct calls
- **Test render patterns**: Use `@testing-library/react` with `render()` and `screen` queries

### Anti-Patterns to Avoid

- **DO NOT** use `variant="destructive"` (red) for the offline indicator — offline is NOT an error, it's expected behavior at rural vacation houses. Use a warm, reassuring visual.
- **DO NOT** block UI interaction when offline — the app is fully functional offline (NFR15)
- **DO NOT** show a modal/dialog for offline state — only non-intrusive indicators
- **DO NOT** modify `useOnlineStatus` hook — it's already well-implemented
- **DO NOT** add offline-aware toasts to error toasts — only success toasts need the offline variant. Errors should always show the error message regardless of connectivity.
- **DO NOT** create new CSS files — Tailwind utilities only
- **DO NOT** change existing i18n key names — only add new keys
- **DO NOT** modify shadcn/ui primitives in `src/components/ui/`
- **DO NOT** use `transition-*` classes without `motion-safe:` prefix (NFR12 compliance)
- **DO NOT** forget to add `motion-safe:` to the existing OfflineIndicator transitions (currently missing)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.7] — Story definition with acceptance criteria
- [Source: _bmad-output/planning-artifacts/epics.md#UX-8] — Offline state confidence indicators: clear, non-intrusive feedback that edits are saved locally
- [Source: _bmad-output/planning-artifacts/epics.md#NFR12] — Respect prefers-reduced-motion
- [Source: _bmad-output/planning-artifacts/epics.md#NFR15] — 100% read + write to local data when offline
- [Source: _bmad-output/planning-artifacts/epics.md#NFR16] — Zero data loss on close/restart/network loss
- [Source: _bmad-output/planning-artifacts/architecture.md#PWA Components] — OfflineIndicator.tsx, InstallPrompt.tsx in src/components/pwa/
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Handling] — Toast notification rules, sonner pattern
- [Source: _bmad-output/planning-artifacts/architecture.md#Cross-Cutting Concerns] — Offline-first data integrity
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md#Key Design Challenges] — Challenge 7: Confidence in offline state
- [Source: src/components/pwa/OfflineIndicator.tsx] — Existing offline indicator (152 lines, needs enhancement)
- [Source: src/hooks/useOnlineStatus.ts] — Existing online status hook (229 lines, no changes needed)
- [Source: src/components/pwa/InstallPrompt.tsx] — PWA install prompt (332 lines, reference for PWA component patterns)
- [Source: src/components/shared/Layout.tsx] — Main layout with header at top-0 z-40 h-14 (654 lines)
- [Source: src/App.tsx] — Root component where OfflineIndicator is rendered (58 lines)
- [Source: _bmad-output/implementation-artifacts/1-6-accidental-edit-protection.md] — Previous story learnings (motion-safe M-1, toast patterns, lint baseline 23 errors)

## Dev Agent Record

### Agent Model Used

claude-opus-4-6 (via OpenCode)

### Debug Log References

None — no debugging sessions required.

### Completion Notes List

- Replaced `Badge` component with styled div banner in OfflineIndicator; removed `Badge` dependency entirely for more control over styling
- Used Tailwind `amber` color classes (amber-50, amber-700, amber-200) for warm offline indicator, consistent with Story 1.2 amber palette
- Positioned indicator at `top-14` (below 56px header) with `z-50` to avoid overlapping header content
- Added `motion-safe:` prefix to ALL transition and animation classes per NFR12 (M-1 finding from Story 1.6)
- Created `useOfflineAwareToast` hook with `useCallback`-memoized `successToast` function to avoid stale closure issues
- Used `createElement(Smartphone, ...)` pattern in hook (`.ts` file) to avoid JSX — keeps hook as pure TypeScript
- Only success toasts are offline-aware; error toasts always show actual error messages regardless of connectivity
- Components that only had success toasts (RoomDialog, PersonDialog, TransportDialog, QuickAssignmentDialog) had their `import { toast } from 'sonner'` removed entirely
- Components with both success and error toasts retain the `toast` import for `toast.error()` calls
- Fixed 4 `react-hooks/exhaustive-deps` warnings by adding `successToast` to dependency arrays and memoizing the hook function
- SettingsPage uses `dataSuccessToast` alias (renamed destructured `successToast`) in DataSection to avoid variable shadowing
- Manual verification tasks 5.5-5.7 require human testing (mobile viewport, network disconnect/reconnect, prefers-reduced-motion)
- Test count: 1301 (baseline) + 19 (new) = 1320 total, all passing
- Lint: 23 errors (matches Story 1.6 baseline), 4 warnings (all pre-existing from DirectionsButton.tsx)

### File List

**NEW files:**
- `src/hooks/useOfflineAwareToast.ts` — Hook wrapping sonner toast with offline-aware messaging
- `src/components/pwa/__tests__/OfflineIndicator.test.tsx` — 12 unit tests for OfflineIndicator
- `src/hooks/__tests__/useOfflineAwareToast.test.ts` — 7 unit tests for useOfflineAwareToast hook

**MODIFIED files:**
- `src/components/pwa/OfflineIndicator.tsx` — Complete rewrite: Badge → styled div banner, amber styling, motion-safe prefixes, improved transitions
- `src/hooks/index.ts` — Added barrel export for useOfflineAwareToast
- `src/locales/en/translation.json` — Added pwa.savedLocally, pwa.offlineDescription, pwa.connectionRestored
- `src/locales/fr/translation.json` — Added French translations for same keys
- `src/features/rooms/components/RoomDialog.tsx` — Integrated useOfflineAwareToast, removed direct toast import
- `src/features/rooms/components/RoomAssignmentSection.tsx` — Integrated useOfflineAwareToast for create/update/delete success
- `src/features/rooms/components/QuickAssignmentDialog.tsx` — Integrated useOfflineAwareToast, removed direct toast import
- `src/features/rooms/pages/RoomListPage.tsx` — Integrated useOfflineAwareToast for delete success
- `src/features/persons/components/PersonDialog.tsx` — Integrated useOfflineAwareToast, removed direct toast import
- `src/features/transports/components/TransportDialog.tsx` — Integrated useOfflineAwareToast, removed direct toast import
- `src/features/transports/pages/TransportListPage.tsx` — Integrated useOfflineAwareToast for delete success
- `src/features/transports/components/UpcomingPickups.tsx` — Integrated useOfflineAwareToast for volunteer driver success
- `src/features/calendar/pages/CalendarPage.tsx` — Integrated useOfflineAwareToast for assignment/transport delete success
- `src/features/settings/pages/SettingsPage.tsx` — Integrated useOfflineAwareToast for language change and data clear success

### Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-02-10 | Created story file from epic definition | Story creation via create-story workflow |
| 2026-02-10 | Implemented Tasks 1-5 (all automated subtasks) | Full story implementation |
| 2026-02-10 | Story moved to review status | All automated tasks complete, manual verification tasks noted for human review |
| 2026-02-10 | Code review: fixed M-2 (OfflineIndicator first-render flash) | Initialize isVisible from current online state to avoid ARIA live region absence on first frame |
| 2026-02-10 | Code review: fixed M-3 (LanguageSelector misleading offline toast) | Language change uses localStorage not IndexedDB, reverted to standard toast.success |
| 2026-02-10 | Story moved to done status | Code review passed with 0 critical, 2 medium (fixed), 3 low issues |
