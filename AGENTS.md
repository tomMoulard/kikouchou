# Kikoushou — Agent Coding Guidelines

**Stack:** React 19 + TypeScript (strict) · Vite · Bun · Tailwind CSS v4 · shadcn/ui · Dexie.js (IndexedDB) · React Router v7 · i18next · Vitest + Playwright

---

## Commands

```bash
# Dev
bun run dev                   # Start dev server
bun run build                 # tsc -b && vite build

# Quality
bun run lint                  # ESLint
bun run validate              # test:run + lint + build + generate-icons + test:e2e:run

# Unit tests (Vitest)
bun run test                  # Watch mode
bun run test:run              # Single run (use in CI)
bun run test:coverage         # Coverage report (target: 80% — not yet enforced in CI)
bun run test src/features/trips/components/__tests__/TripForm.test.tsx  # Single file
bun run test --grep="TripForm"  # Pattern match

# E2E tests (Playwright)
bun run test:e2e              # Headless
bun run test:e2e:headed       # With browser
npx playwright test e2e/trip-lifecycle.spec.ts  # Single file
npx playwright test -g "user can create a new trip"  # Single test

# Type check
tsc -b                        # Full project build check
tsc --noEmit                  # Check without emitting
```

---

## TypeScript — Strict Flags

All are enabled in `tsconfig.app.json`. Key non-obvious ones:
- `noUncheckedIndexedAccess` — array/object access returns `T | undefined`; always guard or use `!`
- `verbatimModuleSyntax` — type-only imports **must** use `import type` or `import { type X }`
- `erasableSyntaxOnly` — **no enums or namespaces**; use `const` objects + union types instead
- `noUncheckedSideEffectImports` — no bare side-effect imports without explicit intent

---

## Import Order

Blank line between each group; `import type` / `import { type X }` for type-only imports.

1. `react`, `react-dom`
2. Third-party libs (`react-router-dom`, `react-i18next`, `sonner`, `dexie-react-hooks`, …)
3. `@/components/ui/*`
4. `@/components/shared/*`
5. `@/features/*`
6. `@/hooks/*`
7. `@/contexts/*`
8. `@/lib/*`
9. `@/types` (type imports last)

Path alias `@/` maps to `src/`.

---

## Component Rules

- **Named exports** everywhere; page components also export `default` for `React.lazy`.
- **`memo(function Name(props){})`** — named function inside `memo` for automatic `displayName`.
- Props interfaces: `interface FooProps { readonly bar: string; }` — `readonly` on all props.
- Section comments: `// ===…=== // Type Definitions`, `// Constants`, `// Component`, `// Exports`.
- File docblock: `/** @fileoverview … @module path/to/module */`
- **No default exports** except pages.
- **Barrel exports** via `features/{name}/index.ts`.

---

## State & Data

- **React Context** for global state (`TripContext`, `SettingsContext`); always throw when used outside provider.
- **`useLiveQuery`** (dexie-react-hooks) for reactive IndexedDB reads — returns `undefined` while loading.
- **`useCallback`** for all event handlers passed to children; **`useMemo`** for derived values.
- Functional state updates when new state derives from old: `setState(prev => !prev)`.

---

## AI Assistant — Keep It In Sync

The on-device LLM assistant (`src/features/assistant/`) knows **only** what the
system prompt hands it. A feature that is missing from that prompt makes the
assistant answer *"I don't have access to that"* even though the data sits right
there in IndexedDB — storing it in Dexie is not enough.

**Adding or changing a trip feature, entity or field? Update the assistant in the
same change, in this order:**

1. **`hooks/useTripSystemPrompt.ts` — read access.**
   Add a `## Section` for a new entity, or the new field to the existing line.
   Anything the user can see in the UI belongs here. Lead each item with its
   `id:` (actions need it), then the human-readable values. Never drop a section
   when it is empty — print `No … yet.` so the model knows the list is empty
   rather than unavailable.
2. **`action-schema.ts` — write access.**
   Add one `ActionDef` per mutation (`addX` / `updateX` / `removeX`, plus
   narrower verbs like `joinActivity` when they map to a real repository call).
   This array is the single source of truth: `generateActionPrompt()` documents
   it to the LLM and `validateAction()` enforces it at runtime — never hand-write
   prompt text for an action, and never accept an action the schema does not list.
3. **`hooks/useTripActions.ts` — execution.**
   Add a `case` per action: bail with `t('assistant.noTripForAction')` when there
   is no active trip, go through the `…WithOwnershipCheck` repositories, drop ids
   that do not belong to the trip, `safeParse` the record against its Zod schema
   before writing, then push a `summaries` line for the UI.
4. **`src/locales/{en,fr}/translation.json`.**
   Add the `assistant.actionDetails.*` summary and any new error key to **both**
   locales.
5. **Tests.** Extend `src/features/assistant/__tests__/action-schema.test.ts`
   and `src/features/assistant/hooks/__tests__/{useTripSystemPrompt,useTripActions}.test.tsx`.

Relative dates ("today", "tonight", "this weekend") resolve against the current
date, which the prompt states from `useToday()` — extend that line rather than
letting the model guess.

Done check: *could the assistant both answer a question about this feature and
change it, from the prompt alone?* If not, the feature is not finished.

---

## Styling

- Tailwind CSS utility classes only — no inline styles, no CSS modules.
- **`cn()`** (`@/lib/utils`) for conditional/merged classes — wraps `clsx` + `tailwind-merge`.
- shadcn/ui components from `@/components/ui/*`; do not modify generated files directly.
- Theme tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, etc.) over raw colors.

---

## Error Handling

- Async handlers: `try/catch/finally`; reset loading state in `finally`.
- Log with context: `console.error('Failed to save trip:', error)`.
- User feedback: `toast.success(t('…'))` / `toast.error(t('…'))` via `sonner`.
- `ErrorBoundary` wraps every route in `router.tsx`.
- Validation: **Zod schemas** in `src/lib/validation/schemas.ts`; parse at form submit / DB write boundaries.

---

## Internationalization

- **All** user-facing strings via `t('section.key')` — never hardcode text.
- Translation files: `src/locales/{en,fr}/translation.json`.
- Nested keys: `common.save`, `trips.name`, `errors.saveFailed`.
- Provide fallback for new keys: `t('errors.new', 'Fallback')`.

---

## Type Safety — Branded Types

IDs and special strings are branded to prevent mixing:

```typescript
export type TripId  = Brand<'TripId'>;   // never pass a RoomId where TripId expected
export type ISODateString = Brand<'ISODateString'>;  // use toISODateString(date) to create
export type HexColor      = Brand<'HexColor'>;       // use toHexColor('#rrggbb') to create
```

Use `toISODateStringFromString()` / `toISODateString()` / `toHexColor()` from `@/lib/db/utils` — never cast directly in production code.

---

## Testing Conventions

**Unit tests** — `src/{path}/__tests__/{Name}.test.tsx`; import from `@/test/utils` (not RTL directly):

```typescript
import { render, screen, waitForDb, createTestTrip, isoDate } from '@/test/utils';
```

- `render()` wraps with `MemoryRouter + AppProviders`; pass `{ withProviders: false }` for isolation.
- IndexedDB is mocked via `fake-indexeddb/auto` (auto-imported in `src/test/setup.ts`).
- DB is cleared before each test; do not share state between tests.
- `waitForDb()` flushes async DB microtasks when needed.
- i18next is mocked — `t('key')` returns the key string.

**E2E tests** — `e2e/{feature}.spec.ts`; use `@playwright/test`; `@axe-core/playwright` available for a11y checks.

---

## Accessibility

- ARIA labels on all icon-only buttons: `aria-label={t('common.menu')}`.
- Decorative icons: `aria-hidden="true"`.
- Form fields: `htmlFor`/`id`, `aria-invalid`, `aria-describedby` linking error `<p role="alert">`.
- Keyboard nav: `focus-visible:ring-2 focus-visible:ring-ring` on all interactive elements.
- Skip link: `<a href="#main-content" className="sr-only focus:not-sr-only …">`.

---

## Directory Structure

```
src/
├── components/
│   ├── ui/          # shadcn/ui primitives (do not edit directly)
│   ├── shared/      # Layout, ErrorBoundary, LoadingState, PageHeader
│   └── pwa/         # InstallPrompt, OfflineIndicator
├── contexts/        # React Context providers + hooks
├── features/        # trips | rooms | persons | transports | activities | calendar | analytics | assistant | sharing | settings
│   └── {name}/      # pages/ · components/ · routes.tsx · index.ts
├── hooks/           # Shared custom hooks
├── lib/
│   ├── db/          # Dexie database, repositories, utils
│   ├── i18n/        # i18next setup
│   ├── map/         # Leaflet helpers
│   ├── utils/       # Shared utilities
│   └── validation/  # Zod schemas
├── locales/         # en/ · fr/
├── test/            # setup.ts · utils.tsx (test helpers)
├── types/           # index.ts (all branded types + entity interfaces)
└── router.tsx
```

For detailed convention rationale, see `CONVENTIONS.md`.
