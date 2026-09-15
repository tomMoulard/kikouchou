/**
 * @fileoverview Tests for the trip-scoped route table, mounted through the real one.
 *
 * `/trips/:tripId` used to be claimed by three separate route objects: the
 * calendar registered both `trips/:tripId/calendar` and `trips/:tripId` as flat
 * siblings, each with its own `withSuspense(...)` element, and `router.tsx`
 * added a third for the sync page. Two live copies of the calendar meant
 * crossing between the two URLs remounted the page — losing the month you were
 * looking at, the selected event and the open dialog — and `?view=`, which
 * lives in the URL, applied to whichever path you happened to be on.
 *
 * These tests import `routes` from `src/router.tsx` and mount it with
 * `createMemoryRouter`, exactly as `features/sharing/__tests__/routes.test.tsx`
 * does. A hand-built `<MemoryRouter><Routes>` tree cannot see a duplicate
 * registration, because the duplicate is in the config the hand-built tree
 * replaces. Assertions are on rendered content, never on the URL alone: the
 * share-wizard bug survived for months behind a passing `toHaveURL`.
 *
 * @module features/calendar/__tests__/routes.test
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
// A bare RTL render, not `@/test/utils`: that helper wraps children in its own
// MemoryRouter, and this file's whole point is to mount the real route table.
import { render as rtlRender, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';

import type { Activity, Person, Room, RoomAssignment, Transport, Trip } from '@/types';

// ============================================================================
// Test Data
// ============================================================================

const TRIP_ID = 'trip-1';

const mockTrip: Trip = {
  id: TRIP_ID as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  location: 'Paris',
  startDate: '2026-04-01' as Trip['startDate'],
  endDate: '2026-04-10' as Trip['endDate'],
  description: '',
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockPerson: Person = {
  id: 'person-1' as Person['id'],
  tripId: mockTrip.id,
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
  stayStartDate: '2026-04-01' as NonNullable<Person['stayStartDate']>,
  stayEndDate: '2026-04-10' as NonNullable<Person['stayEndDate']>,
};

const mockRoom: Room = {
  id: 'room-1' as Room['id'],
  tripId: mockTrip.id,
  name: 'Blue Room',
  capacity: 2,
  order: 0,
};

const mockAssignment: RoomAssignment = {
  id: 'assignment-1' as RoomAssignment['id'],
  tripId: mockTrip.id,
  roomId: mockRoom.id,
  personId: mockPerson.id,
  startDate: '2026-04-02' as RoomAssignment['startDate'],
  endDate: '2026-04-08' as RoomAssignment['endDate'],
};

const mockArrival: Transport = {
  id: 'transport-1' as Transport['id'],
  tripId: mockTrip.id,
  personId: mockPerson.id,
  type: 'arrival',
  datetime: '2026-04-01T14:00:00' as Transport['datetime'],
  location: 'Paris CDG',
  needsPickup: true,
  transportMode: 'plane',
};

const mockActivity: Activity = {
  id: 'activity-1' as Activity['id'],
  tripId: mockTrip.id,
  title: 'Plant fair',
  category: 'horticulture',
  startDatetime: '2026-04-03T09:00:00.000Z',
  endDatetime: '2026-04-03T12:00:00.000Z',
  allDay: false,
  location: 'Saint-Jean',
  participantIds: [mockPerson.id],
};

// ============================================================================
// Mocks
// ============================================================================

// The whole trip-scoped subtree renders inside `Layout`, which reads four of
// these contexts itself; `CalendarPage` reads all six.
const mockUseTripContext = vi.fn();
const mockUseRoomContext = vi.fn();
const mockUseAssignmentContext = vi.fn();
const mockUsePersonContext = vi.fn();
const mockUseTransportContext = vi.fn();
const mockUseActivityContext = vi.fn();

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => mockUseTripContext(),
}));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => mockUseRoomContext(),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => mockUseAssignmentContext(),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => mockUsePersonContext(),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => mockUseTransportContext(),
}));

vi.mock('@/contexts/ActivityContext', () => ({
  useActivityContext: () => mockUseActivityContext(),
}));

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => ({
    rides: [],
    vehicles: [],
    isLoading: false,
    error: null,
  }),
}));

// Local midnight, so "today" is the same calendar day at any UTC offset.
vi.mock('@/hooks/useToday', () => ({
  useToday: () => ({ today: new Date(2026, 3, 4) }),
}));

vi.mock('@/features/transports', () => ({
  TransportDialog: () => null,
}));

vi.mock('@/features/activities/components/ActivityDialog', () => ({
  ActivityDialog: () => null,
}));

// ============================================================================
// Imports after mocks
// ============================================================================

import { appRoutes, routes } from '@/router';

/** Lazy route chunks resolve on first import, which is slower than RTL's 1s default. */
const FIND_TIMEOUT = { timeout: 5000 };

/**
 * Warm the module registry before the first render.
 *
 * The route elements are `React.lazy`, so the first render of each one pays for
 * transforming that page's whole import graph — several seconds, which a
 * `findBy*` would otherwise have to sit through staring at the Suspense
 * fallback. Importing the pages here populates the same registry `React.lazy`
 * reads.
 */
beforeAll(async () => {
  await Promise.all([
    import('../pages/CalendarPage'),
    import('@/features/sharing/pages/TripSyncPage'),
  ]);
}, 60000);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Mounts the application's real route table at the given URL.
 *
 * @returns The memory router, so a test can read where a redirect landed *in
 *   addition to* asserting on what rendered.
 */
function renderRouteAt(url: string) {
  const router = createMemoryRouter(routes, { initialEntries: [url] });
  rtlRender(<RouterProvider router={router} />);
  return router;
}

function setDefaultMocks(): void {
  mockUseTripContext.mockReturnValue({
    currentTrip: mockTrip,
    trips: [mockTrip],
    isLoading: false,
    error: null,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
  });
  mockUseRoomContext.mockReturnValue({
    rooms: [mockRoom],
    isLoading: false,
    error: null,
  });
  mockUseAssignmentContext.mockReturnValue({
    assignments: [mockAssignment],
    isLoading: false,
    error: null,
    deleteAssignment: vi.fn().mockResolvedValue(undefined),
  });
  mockUsePersonContext.mockReturnValue({
    persons: [mockPerson],
    getPersonById: vi.fn((id: string) => (id === mockPerson.id ? mockPerson : undefined)),
    isLoading: false,
    error: null,
  });
  mockUseTransportContext.mockReturnValue({
    arrivals: [mockArrival],
    departures: [],
    isLoading: false,
    error: null,
    deleteTransport: vi.fn().mockResolvedValue(undefined),
  });
  mockUseActivityContext.mockReturnValue({
    activities: [mockActivity],
    isLoading: false,
    error: null,
    deleteActivity: vi.fn().mockResolvedValue(undefined),
  });
}

/**
 * Joins a parent pattern with a child pattern the way React Router does.
 */
function joinPattern(parent: string, child: string): string {
  return `${parent}/${child}`.replace(/\/+/gu, '/').replace(/(.)\/$/u, '$1');
}

/**
 * Flattens a route table to the full URL pattern of every *leaf* — the routes
 * a URL can actually land on. An `index` child contributes its parent's
 * pattern, which is exactly how a bare path becomes reachable.
 */
function collectLeafPatterns(routeObjects: readonly RouteObject[], parent = ''): string[] {
  return routeObjects.flatMap((route) => {
    const pattern = route.index === true ? parent : joinPattern(parent, route.path ?? '');

    return route.children !== undefined && route.children.length > 0
      ? collectLeafPatterns(route.children, pattern)
      : [pattern];
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('trip-scoped routes', () => {
  beforeEach(() => {
    setDefaultMocks();
  });

  describe('route table shape', () => {
    it('gives every URL pattern exactly one claimant', () => {
      const patterns = collectLeafPatterns(routes),
        duplicates = patterns.filter((p, i) => patterns.indexOf(p) !== i);

      // Scope, honestly: this catches two leaves resolving to the *same*
      // pattern. It did NOT catch the bug this file was written for — the
      // pre-fix table's three claimants produced three distinct leaves
      // (`/trips/:tripId`, `/trips/:tripId/calendar`, `/trips/:tripId/sync`),
      // and this assertion passes on it. Restoring the flat shape in place and
      // re-running proves that. The guards that go red on it are the sibling
      // test below and the redirect assertions in the next describe block.
      // This one is here for the next duplicate, not for the last one.
      expect(duplicates).toEqual([]);
    });

    it('registers `trips/:tripId` as a single parent carrying calendar and sync', () => {
      const children = appRoutes.children ?? [],
        tripScoped = children.filter((route) => route.path === 'trips/:tripId');

      // This is the assertion that goes red on the actual pre-fix table: it
      // had two `trips/:tripId` siblings, the calendar's and the sync parent's.
      expect(tripScoped).toHaveLength(1);
      // The calendar must not also be a flat sibling of that parent.
      expect(children.some((route) => route.path?.startsWith('trips/:tripId/calendar'))).toBe(false);
    });
  });

  describe('/trips/:tripId (bare path)', () => {
    it('lands on the calendar', async () => {
      const router = renderRouteAt(`/trips/${TRIP_ID}`);

      // Content first: the URL matched even when the wrong screen rendered.
      expect(await screen.findByText('calendar.title', undefined, FIND_TIMEOUT)).toBeInTheDocument();
      // And it got there by redirecting, so there is only one calendar URL.
      expect(router.state.location.pathname).toBe(`/trips/${TRIP_ID}/calendar`);
    });

    it('carries `?view=card` through the redirect', async () => {
      const router = renderRouteAt(`/trips/${TRIP_ID}?view=card`);

      // Dropping the search here would silently fall back to the timeline —
      // the very bug the single-claimant fix exists to remove.
      expect(
        await screen.findByRole('grid', { name: 'calendar.monthView' }, FIND_TIMEOUT),
      ).toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'calendar.timeline.ariaLabel' })).not.toBeInTheDocument();
      expect(router.state.location.search).toBe('?view=card');
    });

    it('replaces the history entry so Back does not bounce off it', async () => {
      const router = renderRouteAt(`/trips/${TRIP_ID}`);

      await screen.findByText('calendar.title', undefined, FIND_TIMEOUT);

      expect(router.state.historyAction).toBe('REPLACE');
    });
  });

  describe('/trips/:tripId/calendar', () => {
    it('renders the calendar', async () => {
      renderRouteAt(`/trips/${TRIP_ID}/calendar`);

      expect(await screen.findByText('calendar.title', undefined, FIND_TIMEOUT)).toBeInTheDocument();
    });

    it('defaults to the timeline view with no `view` param', async () => {
      renderRouteAt(`/trips/${TRIP_ID}/calendar`);

      expect(
        await screen.findByRole('region', { name: 'calendar.timeline.ariaLabel' }, FIND_TIMEOUT),
      ).toBeInTheDocument();
      expect(screen.queryByRole('grid', { name: 'calendar.monthView' })).not.toBeInTheDocument();
    });

    it('honours `?view=card`', async () => {
      renderRouteAt(`/trips/${TRIP_ID}/calendar?view=card`);

      expect(
        await screen.findByRole('grid', { name: 'calendar.monthView' }, FIND_TIMEOUT),
      ).toBeInTheDocument();
    });
  });

  describe('/trips/:tripId/sync', () => {
    it('still resolves now that the calendar owns the same parent', async () => {
      renderRouteAt(`/trips/${TRIP_ID}/sync`);

      // TripSyncPage renders this header in every one of its states. No trip is
      // seeded, so it settles on "not found" — which is still unambiguously the
      // sync page and not the calendar.
      expect(
        await screen.findByText('sharing.sync.pageTitle', undefined, FIND_TIMEOUT),
      ).toBeInTheDocument();
      expect(await screen.findByText('sharing.sync.tripNotFound', undefined, FIND_TIMEOUT)).toBeInTheDocument();
      expect(screen.queryByText('calendar.title')).not.toBeInTheDocument();
    });
  });
});
