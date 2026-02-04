/**
 * @fileoverview Test utilities for the Kikoushou application.
 * Provides custom render functions, helpers, and re-exports testing library utilities.
 *
 * @module test/utils
 *
 * @example
 * ```tsx
 * import { render, screen, userEvent } from '@/test/utils';
 *
 * test('button click works', async () => {
 *   const user = userEvent.setup();
 *   render(<MyComponent />);
 *   await user.click(screen.getByRole('button'));
 *   expect(screen.getByText('Clicked')).toBeInTheDocument();
 * });
 * ```
 */

import type { ReactElement, ReactNode } from 'react';
import type { RenderOptions, RenderResult } from '@testing-library/react';

import { render as rtlRender } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import { AppProviders } from '@/contexts/AppProviders';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Options for the custom render function.
 * Extends RTL RenderOptions with routing configuration.
 */
export interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  /**
   * Initial route for MemoryRouter.
   * @default '/'
   */
  readonly initialRoute?: string;

  /**
   * Array of initial history entries for MemoryRouter.
   * If provided, takes precedence over initialRoute.
   */
  readonly initialEntries?: string[];

  /**
   * Whether to wrap with AppProviders.
   * Set to false for testing components in isolation.
   * @default true
   */
  readonly withProviders?: boolean;
}

/**
 * Result of the custom render function.
 * Extends RTL RenderResult with additional utilities.
 */
export interface CustomRenderResult extends RenderResult {
  /**
   * User event instance for simulating user interactions.
   */
  readonly user: ReturnType<typeof userEvent.setup>;
}

// ============================================================================
// Wrapper Components
// ============================================================================

/**
 * Props for the AllProviders wrapper component.
 */
interface AllProvidersProps {
  readonly children: ReactNode;
  readonly initialEntries: string[];
}

/**
 * Wrapper component that provides all application context providers and routing.
 *
 * @param props - Wrapper props including children and initial route entries
 * @returns Wrapped component tree
 */
function AllProviders({ children, initialEntries }: AllProvidersProps): ReactElement {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <AppProviders>{children}</AppProviders>
    </MemoryRouter>
  );
}

/**
 * Props for the RouterOnly wrapper component.
 */
interface RouterOnlyProps {
  readonly children: ReactNode;
  readonly initialEntries: string[];
}

/**
 * Wrapper component that provides only routing without context providers.
 * Useful for testing components that don't depend on application contexts.
 *
 * @param props - Wrapper props including children and initial route entries
 * @returns Wrapped component tree
 */
function RouterOnly({ children, initialEntries }: RouterOnlyProps): ReactElement {
  return <MemoryRouter initialEntries={initialEntries}>{children}</MemoryRouter>;
}

// ============================================================================
// Custom Render Function
// ============================================================================

/**
 * Custom render function that wraps components with application providers.
 *
 * @param ui - React element to render
 * @param options - Render options including routing configuration
 * @returns Render result with user event instance
 *
 * @example
 * ```tsx
 * // Basic usage
 * const { user } = render(<MyComponent />);
 * await user.click(screen.getByRole('button'));
 *
 * // With initial route
 * render(<MyComponent />, { initialRoute: '/trips/123' });
 *
 * // With multiple history entries
 * render(<MyComponent />, { initialEntries: ['/trips', '/trips/123'] });
 *
 * // Without providers (isolated testing)
 * render(<MyComponent />, { withProviders: false });
 * ```
 */
export function render(
  ui: ReactElement,
  options: CustomRenderOptions = {}
): CustomRenderResult {
  const {
    initialRoute = '/',
    initialEntries,
    withProviders = true,
    ...renderOptions
  } = options;

  // Determine initial entries for MemoryRouter
  const entries = initialEntries ?? [initialRoute];

  // Create user event instance
  const user = userEvent.setup();

  // Create wrapper function
  function Wrapper({ children }: { children: ReactNode }): ReactElement {
    if (withProviders) {
      return <AllProviders initialEntries={entries}>{children}</AllProviders>;
    }
    return <RouterOnly initialEntries={entries}>{children}</RouterOnly>;
  }

  // Render with wrapper
  const result = rtlRender(ui, { wrapper: Wrapper, ...renderOptions });

  return {
    ...result,
    user,
  };
}

// ============================================================================
// Database Test Helpers
// ============================================================================

/**
 * Wait for IndexedDB operations to complete.
 * Useful when testing components that perform async database operations.
 *
 * @param ms - Milliseconds to wait (default: 10, allows microtasks to flush)
 * @returns Promise that resolves after the specified delay
 *
 * @remarks
 * IndexedDB operations are microtask-based and may require multiple event loop
 * ticks to complete. This helper provides a reliable way to wait for them.
 *
 * @example
 * ```tsx
 * await waitForDb();
 * expect(screen.getByText('Trip loaded')).toBeInTheDocument();
 * ```
 */
export async function waitForDb(ms = 10): Promise<void> {
  // Wait for specified time
  await new Promise((resolve) => setTimeout(resolve, ms));
  // Additional flush for microtasks
  await Promise.resolve();
}

/**
 * Create test data in the database.
 * Helper for setting up test scenarios with pre-populated data.
 *
 * @param data - Trip data
 * @returns Created trip ID
 * @throws Error if trip creation fails
 *
 * @example
 * ```tsx
 * import { createTestTrip, render, screen } from '@/test/utils';
 * import type { TripId } from '@/types';
 *
 * const tripId = await createTestTrip({ name: 'Test Trip', startDate: '2024-01-01' });
 * render(<TripList />);
 * expect(screen.getByText('Test Trip')).toBeInTheDocument();
 * ```
 */
export async function createTestTrip(data: {
  name: string;
  startDate: string;
  endDate?: string;
  location?: string;
}): Promise<import('@/types').TripId> {
  try {
    const { createTrip } = await import('@/lib/db/repositories/trip-repository');
    const { toISODateStringFromString } = await import('@/lib/db/utils');
    const trip = await createTrip({
      name: data.name,
      startDate: toISODateStringFromString(data.startDate),
      endDate: toISODateStringFromString(data.endDate ?? data.startDate),
      location: data.location,
    });
    return trip.id;
  } catch (error) {
    throw new Error(
      `Failed to create test trip "${data.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Create a test person in the database.
 *
 * @param tripId - ID of the trip to add the person to
 * @param data - Person data
 * @returns Created person ID
 * @throws Error if person creation fails
 */
export async function createTestPerson(
  tripId: import('@/types').TripId,
  data: { name: string; color?: string }
): Promise<import('@/types').PersonId> {
  try {
    const { createPerson } = await import('@/lib/db/repositories/person-repository');
    const { toHexColor } = await import('@/lib/db/utils');
    const person = await createPerson(tripId, {
      name: data.name,
      color: toHexColor(data.color ?? '#3b82f6'),
    });
    return person.id;
  } catch (error) {
    throw new Error(
      `Failed to create test person "${data.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Create a test room in the database.
 *
 * @param tripId - ID of the trip to add the room to
 * @param data - Room data
 * @returns Created room ID
 * @throws Error if room creation fails
 */
export async function createTestRoom(
  tripId: import('@/types').TripId,
  data: { name: string; capacity?: number; description?: string }
): Promise<import('@/types').RoomId> {
  try {
    const { createRoom } = await import('@/lib/db/repositories/room-repository');
    const room = await createRoom(tripId, {
      name: data.name,
      capacity: data.capacity ?? 2,
      description: data.description,
    });
    return room.id;
  } catch (error) {
    throw new Error(
      `Failed to create test room "${data.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

// ============================================================================
// Branded Type Test Helpers
// ============================================================================

import type { HexColor, ISODateString } from '@/types';

/**
 * Creates an ISODateString for use in tests.
 * This is a type-safe way to create test fixtures with branded types.
 *
 * @param value - A valid YYYY-MM-DD string
 * @returns Branded ISODateString
 * @example
 * ```tsx
 * const trip = {
 *   startDate: isoDate('2024-07-15'),
 *   endDate: isoDate('2024-07-20'),
 * };
 * ```
 */
export function isoDate(value: string): ISODateString {
  return value as ISODateString;
}

/**
 * Creates a HexColor for use in tests.
 * This is a type-safe way to create test fixtures with branded types.
 *
 * @param value - A valid #RRGGBB string
 * @returns Branded HexColor
 * @example
 * ```tsx
 * const person = {
 *   color: hexColor('#ef4444'),
 * };
 * ```
 */
export function hexColor(value: string): HexColor {
  return value as HexColor;
}

// ============================================================================
// Re-exports
// ============================================================================

// Re-export everything from @testing-library/react
// This includes: screen, within, waitFor, waitForElementToBeRemoved, etc.
export * from '@testing-library/react';

// Re-export userEvent for user interaction simulation
export { userEvent };

// Re-export branded type helpers from utils for convenience
export { toISODateStringFromString, toHexColor } from '@/lib/db/utils';
