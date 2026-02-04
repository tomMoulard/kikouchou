# Kikoushou Coding Conventions

This document outlines the coding conventions and patterns used in the Kikoushou project, a PWA for vacation house room assignment and arrivals/departures tracking.

---

## Project Stack

- **Framework**: React 19 + TypeScript
- **Build Tool**: Vite
- **UI Components**: shadcn/ui + Radix UI primitives
- **Styling**: Tailwind CSS v4
- **Database**: IndexedDB via Dexie.js
- **Routing**: React Router v7
- **i18n**: react-i18next
- **Testing**: Vitest (unit), Playwright (E2E)

---

## Export Patterns

### Named Exports Preferred

Use named exports for all modules. This improves refactoring support, enables better tree-shaking, and makes imports more explicit.

```typescript
// Good - named exports
export { TripForm };
export type { TripFormProps };

// Avoid - default exports
export default TripForm;
```

### Page Components

Page components may use both named and default exports to support lazy loading with `React.lazy()`:

```typescript
// pages/TripListPage.tsx
export function TripListPage() { ... }
export default TripListPage; // For lazy loading
```

### Barrel Exports

Use `index.ts` files for feature modules to provide clean import paths:

```typescript
// features/trips/index.ts

// Pages
export { TripListPage } from './pages/TripListPage';
export { TripCreatePage } from './pages/TripCreatePage';
export { TripEditPage } from './pages/TripEditPage';

// Components
export { TripForm } from './components/TripForm';
export type { TripFormProps } from './components/TripForm';

// Routes
export { tripRoutes } from './routes';
```

This enables clean imports:

```typescript
import { TripListPage, TripForm, tripRoutes } from '@/features/trips';
```

---

## Component Patterns

### memo() for Performance

Use `memo()` for components that:
- Receive stable props but re-render due to parent updates
- Are rendered in lists
- Perform expensive rendering operations

```typescript
const TripCard = memo(({ trip, onSelect }: TripCardProps) => {
  // Component implementation
});
```

### displayName Assignment

Always assign `displayName` to memoized components for better debugging:

```typescript
const TripForm = memo(({ trip, onSubmit, onCancel }: TripFormProps) => {
  // Component implementation
});

TripForm.displayName = 'TripForm';
```

### Props Interface Naming

Name props interfaces with the `ComponentNameProps` pattern:

```typescript
interface TripFormProps {
  readonly trip?: Trip;
  readonly onSubmit: (data: TripFormData) => Promise<void>;
  readonly onCancel: () => void;
}
```

Use `readonly` for props that should not be mutated.

### Component File Structure

Organize component files with clear sections:

```typescript
/**
 * @fileoverview Component description
 * @module path/to/module
 */

import { ... } from 'react';

// ============================================================================
// Type Definitions
// ============================================================================

interface ComponentProps { ... }

// ============================================================================
// Constants
// ============================================================================

const SOME_CONSTANT = 'value';

// ============================================================================
// Component
// ============================================================================

const Component = memo(({ ... }: ComponentProps) => {
  // Implementation
});

Component.displayName = 'Component';

// ============================================================================
// Exports
// ============================================================================

export { Component };
export type { ComponentProps };
```

---

## State Management

### React Context for Global State

Use React Context for application-wide state like current trip, settings, and user preferences:

```typescript
// contexts/TripContext.tsx
export interface TripContextValue {
  readonly currentTrip: Trip | null;
  readonly trips: Trip[];
  readonly isLoading: boolean;
  readonly error: Error | null;
  setCurrentTrip: (tripId: string | null) => Promise<void>;
}

const TripContext = createContext<TripContextValue | null>(null);
TripContext.displayName = 'TripContext';

export function useTripContext(): TripContextValue {
  const context = useContext(TripContext);
  if (context === null) {
    throw new Error('useTripContext must be used within a TripProvider');
  }
  return context;
}
```

### useLiveQuery for Reactive IndexedDB Data

Use `useLiveQuery` from `dexie-react-hooks` for reactive data binding to IndexedDB:

```typescript
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '@/lib/db/database';

function TripList() {
  const trips = useLiveQuery(
    () => db.trips.orderBy('startDate').reverse().toArray(),
    []
  );

  if (trips === undefined) {
    return <LoadingState />;
  }

  return <TripListContent trips={trips} />;
}
```

### useCallback and useMemo for Stable References

Use `useCallback` for event handlers and `useMemo` for computed values to prevent unnecessary re-renders:

```typescript
const Component = memo(({ onSave }: Props) => {
  const [data, setData] = useState(initialData);

  // Stable callback reference
  const handleSubmit = useCallback(async () => {
    await onSave(data);
  }, [onSave, data]);

  // Memoized computed value
  const isValid = useMemo(() => validateData(data), [data]);

  // Stable setter reference for child components
  const toggleSidebar = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  return <Form onSubmit={handleSubmit} isValid={isValid} />;
});
```

---

## Styling

### Tailwind CSS Utility Classes

Use Tailwind CSS utility classes for all styling:

```tsx
<div className="flex flex-col items-center gap-4 p-6 rounded-lg bg-background">
  <h2 className="text-lg font-semibold text-foreground">Title</h2>
  <p className="text-sm text-muted-foreground">Description</p>
</div>
```

### cn() Utility for Conditional Classes

Use the `cn()` utility (combining `clsx` and `tailwind-merge`) for conditional and merged classes:

```typescript
import { cn } from '@/lib/utils';

<button
  className={cn(
    'flex items-center gap-2 px-4 py-2 rounded-md transition-colors',
    'hover:bg-accent hover:text-accent-foreground',
    isActive && 'bg-accent text-accent-foreground font-medium',
    isDisabled && 'opacity-50 pointer-events-none',
  )}
>
```

### shadcn/ui Components

Import UI primitives from `@/components/ui`:

```typescript
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
```

---

## File Organization

### Feature-Based Structure

Organize code by feature in `src/features/{feature-name}/`:

```
src/features/trips/
├── pages/
│   ├── TripListPage.tsx
│   ├── TripCreatePage.tsx
│   └── TripEditPage.tsx
├── components/
│   ├── TripForm.tsx
│   ├── TripCard.tsx
│   └── __tests__/
│       └── TripForm.test.tsx
├── routes.tsx
└── index.ts
```

### Directory Structure Overview

```
src/
├── components/
│   ├── shared/           # Shared application components
│   │   ├── Layout.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── LoadingState.tsx
│   │   └── __tests__/
│   ├── ui/               # shadcn/ui primitives
│   │   ├── button.tsx
│   │   ├── input.tsx
│   │   └── ...
│   └── pwa/              # PWA-specific components
│       ├── InstallPrompt.tsx
│       └── OfflineIndicator.tsx
├── contexts/             # React Context providers
├── features/             # Feature modules
│   ├── trips/
│   ├── rooms/
│   ├── persons/
│   ├── transports/
│   ├── calendar/
│   └── settings/
├── hooks/                # Shared custom hooks
├── lib/
│   ├── db/               # Database layer (Dexie)
│   │   ├── database.ts
│   │   ├── repositories/
│   │   └── __tests__/
│   ├── i18n/             # Internationalization setup
│   └── utils.ts          # Utility functions
├── locales/              # Translation files
│   ├── en/
│   └── fr/
├── types/                # TypeScript type definitions
└── router.tsx            # Application routes
```

---

## Type Safety

### Branded Types for IDs

Use branded types to prevent accidentally mixing IDs of different entity types:

```typescript
// types/index.ts
declare const __brand: unique symbol;
export type Brand<T extends string> = string & { readonly [__brand]: T };

export type TripId = Brand<'TripId'>;
export type RoomId = Brand<'RoomId'>;
export type PersonId = Brand<'PersonId'>;
export type RoomAssignmentId = Brand<'RoomAssignmentId'>;
export type TransportId = Brand<'TransportId'>;
```

This ensures type safety at compile time:

```typescript
function getRoom(roomId: RoomId): Room { ... }

const tripId = 'abc123' as TripId;
const roomId = 'xyz789' as RoomId;

getRoom(roomId);  // OK
getRoom(tripId);  // TypeScript error!
```

### Branded Types for Special Strings

Use branded types for validated string formats:

```typescript
export type ISODateString = Brand<'ISODateString'>;   // "2024-07-15"
export type HexColor = Brand<'HexColor'>;             // "#ef4444"
```

Provide helper functions to create branded types:

```typescript
export function toISODateString(date: Date): ISODateString {
  return format(date, 'yyyy-MM-dd') as ISODateString;
}

export function toISODateStringFromString(dateStr: string): ISODateString {
  // Validate format before casting
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  return dateStr as ISODateString;
}
```

### Form Data Types

Separate form data types from entity types. Form data excludes auto-generated fields:

```typescript
// Entity type (stored in database)
export interface Trip extends Identifiable, WithTimestamps {
  readonly id: TripId;
  readonly shareId: ShareId;
  name: string;
  startDate: ISODateString;
  endDate: ISODateString;
  // ...
}

// Form data type (for create/update operations)
export interface TripFormData {
  name: string;
  startDate: ISODateString;
  endDate: ISODateString;
  location?: string;
  description?: string;
}
```

---

## Testing

### Vitest for Unit Tests

Use Vitest for unit and integration tests. Tests are colocated with source code in `__tests__/` directories:

```
src/features/trips/components/
├── TripForm.tsx
└── __tests__/
    └── TripForm.test.tsx
```

Test file naming: `{ComponentName}.test.tsx` or `{module-name}.test.ts`

```typescript
// TripForm.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';
import { TripForm } from '../TripForm';

describe('TripForm', () => {
  it('validates required fields on submit', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const onCancel = vi.fn();

    render(<TripForm onSubmit={onSubmit} onCancel={onCancel} />);

    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(screen.getByText(/required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
```

### Playwright for E2E Tests

E2E tests are located in the `e2e/` directory:

```
e2e/
├── trip-lifecycle.spec.ts
├── room-assignment.spec.ts
└── fixtures/
```

```typescript
// e2e/trip-lifecycle.spec.ts
import { test, expect } from '@playwright/test';

test('user can create a new trip', async ({ page }) => {
  await page.goto('/trips');
  await page.click('text=New trip');
  
  await page.fill('[name="name"]', 'Summer Vacation 2024');
  await page.click('button:has-text("Save")');
  
  await expect(page).toHaveURL(/\/trips\/[\w-]+\/calendar/);
});
```

### Running Tests

```bash
# Unit tests
bun run test              # Watch mode
bun run test:run          # Single run
bun run test:coverage     # With coverage

# E2E tests (requires app running)
npx playwright test
```

---

## Internationalization

### react-i18next Setup

Use `react-i18next` for translations with the `useTranslation` hook:

```typescript
import { useTranslation } from 'react-i18next';

function TripCard({ trip }: TripCardProps) {
  const { t } = useTranslation();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{trip.name}</CardTitle>
      </CardHeader>
      <CardContent>
        <Button>{t('common.edit')}</Button>
        <Button variant="destructive">{t('common.delete')}</Button>
      </CardContent>
    </Card>
  );
}
```

### Translation File Structure

Translation files are JSON in `src/locales/{lang}/translation.json`:

```json
{
  "app": {
    "name": "Kikoushou",
    "tagline": "Organize your vacation with friends"
  },
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "edit": "Edit",
    "loading": "Loading...",
    "required": "Required"
  },
  "trips": {
    "title": "My trips",
    "new": "New trip",
    "name": "Trip name",
    "namePlaceholder": "e.g. Summer vacation 2024"
  }
}
```

### Translation Guidelines

- Use `t()` function, never template strings for user-facing text
- Use nested keys for organization: `section.subsection.key`
- Provide fallback text for new keys: `t('errors.new', 'Fallback text')`
- Keep keys consistent across language files

```typescript
// Good
<Label>{t('trips.name')}</Label>
<p>{t('validation.endDateBeforeStart', 'End date must be after start date')}</p>

// Avoid
<Label>Trip name</Label>  // Not translatable
<p>{`End date must be after ${startDate}`}</p>  // Template strings break i18n
```

---

## Error Handling

### Try-Catch with Contextual Messages

Wrap async operations with try-catch and provide contextual error messages:

```typescript
const handleSubmit = useCallback(async () => {
  setError(null);
  setIsSubmitting(true);

  try {
    await onSubmit({
      name: name.trim(),
      startDate: toISODateStringFromString(startDate),
      endDate: toISODateStringFromString(endDate),
    });
  } catch (error) {
    console.error('Failed to save trip:', error);
    setError(t('errors.saveFailed'));
  } finally {
    setIsSubmitting(false);
  }
}, [name, startDate, endDate, onSubmit, t]);
```

### Error Boundaries at Route Level

Use `ErrorBoundary` components to catch rendering errors:

```typescript
// router.tsx
import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

const routes = [
  {
    path: '/trips',
    element: (
      <ErrorBoundary>
        <TripListPage />
      </ErrorBoundary>
    ),
  },
];
```

The `ErrorBoundary` component:
- Catches JavaScript errors in the component tree
- Displays a user-friendly fallback UI
- Provides retry functionality
- Shows detailed error info in development mode

### Toast Notifications for User Feedback

Use the `sonner` toast library for transient user feedback:

```typescript
import { toast } from 'sonner';

async function handleDelete() {
  try {
    await deleteTrip(tripId);
    toast.success(t('trips.deleted'));
  } catch (error) {
    toast.error(t('errors.deleteFailed'));
  }
}
```

---

## Accessibility

### ARIA Labels on Interactive Elements

Provide ARIA labels for all interactive elements, especially icon-only buttons:

```typescript
<Button
  variant="ghost"
  size="icon"
  onClick={onMenuClick}
  aria-label={t('common.menu', 'Menu')}
>
  <Menu className="h-5 w-5" />
</Button>
```

### aria-hidden for Decorative Icons

Mark decorative icons as hidden from assistive technology:

```tsx
<item.icon className="h-5 w-5" aria-hidden="true" />
<span>{t(item.labelKey)}</span>
```

### Keyboard Navigation Support

Ensure all interactive elements are keyboard accessible:

```typescript
<NavLink
  to={path}
  className={cn(
    'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
    'hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
  )}
>
```

### Skip Links

Provide skip links for keyboard users to bypass navigation:

```tsx
<a
  href="#main-content"
  className={cn(
    'sr-only focus:not-sr-only',
    'focus:absolute focus:top-2 focus:left-2 focus:z-[100]',
    'focus:px-4 focus:py-2 focus:rounded-md',
    'focus:bg-background focus:text-foreground',
  )}
>
  {t('nav.skipToMain', 'Skip to main content')}
</a>
```

### Focus Management in Dialogs

Manage focus properly in dialogs and modals:

```typescript
<Dialog>
  <DialogTrigger asChild>
    <Button>Open Dialog</Button>
  </DialogTrigger>
  <DialogContent>
    {/* Focus trapped inside dialog */}
    {/* Focus returns to trigger on close */}
  </DialogContent>
</Dialog>
```

### Form Accessibility

- Associate labels with inputs using `htmlFor`/`id`
- Use `aria-invalid` for invalid fields
- Use `aria-describedby` to link error messages
- Use `role="alert"` for error messages

```tsx
<div className="space-y-2">
  <Label htmlFor="trip-name">
    {t('trips.name')}
    <span className="text-destructive ml-1" aria-hidden="true">*</span>
  </Label>
  <Input
    id="trip-name"
    value={name}
    onChange={handleNameChange}
    aria-invalid={Boolean(errors.name)}
    aria-describedby={errors.name ? 'trip-name-error' : undefined}
  />
  {errors.name && (
    <p id="trip-name-error" className="text-sm text-destructive" role="alert">
      {errors.name}
    </p>
  )}
</div>
```
