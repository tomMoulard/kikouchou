/**
 * @fileoverview Tests for the sharing route table, mounted through its real parent.
 *
 * Every wizard step already had its own passing test — each mounted the step on
 * a *flat* route, which is exactly why nobody noticed that the parent
 * `/share/:shareId` route rendered no `<Outlet />` and therefore swallowed all
 * four of them. These tests go through `sharingRoutes` itself so a missing
 * outlet fails here.
 *
 * @module features/sharing/__tests__/routes.test
 */

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// A bare RTL render, not `@/test/utils`: that helper wraps children in its own
// MemoryRouter, and this file's whole point is to mount the real route table.
import { render as rtlRender, screen } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/db', () => ({
  checkAssignmentConflict: vi.fn().mockResolvedValue(false),
  createAssignment: vi.fn(),
  createPersonWithAutoColor: vi.fn(),
  createTransport: vi.fn(),
  getAssignmentsByPersonId: vi.fn().mockResolvedValue([]),
  getAssignmentsByTripId: vi.fn().mockResolvedValue([]),
  getPersonById: vi.fn().mockResolvedValue(undefined),
  getPersonsByTripId: vi.fn().mockResolvedValue([]),
  getRoomById: vi.fn().mockResolvedValue(undefined),
  getRoomsByTripId: vi.fn().mockResolvedValue([]),
  getTransportsByPersonId: vi.fn().mockResolvedValue([]),
  getTripByShareId: vi.fn(),
  setCurrentTrip: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/sharing', () => ({
  createBaselineForGuest: vi.fn().mockResolvedValue(undefined),
}));

// localStorage mock — the wizard steps read the guest identity from it, and
// jsdom's own storage is not exposed as a global in this environment.
const localStorageMock: Record<string, string> = {};

Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: (key: string) => localStorageMock[key] ?? null,
    setItem: (key: string, value: string) => { localStorageMock[key] = value; },
    removeItem: (key: string) => { delete localStorageMock[key]; },
    clear: () => { Object.keys(localStorageMock).forEach((k) => { delete localStorageMock[k]; }); },
    get length() { return Object.keys(localStorageMock).length; },
    key: (i: number) => Object.keys(localStorageMock)[i] ?? null,
  },
  writable: true,
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

// ============================================================================
// Imports after mocks
// ============================================================================

import type { ShareId, Trip, TripId } from '@/types';
import { isoDate } from '@/test/utils';
import { getPersonsByTripId, getTripByShareId } from '@/lib/db';
import { sharingRoutes } from '../routes';

const mockGetTripByShareId = vi.mocked(getTripByShareId);
const mockGetPersonsByTripId = vi.mocked(getPersonsByTripId);

/** Lazy route chunks resolve on first import, which is slower than RTL's 1s default. */
const FIND_TIMEOUT = { timeout: 5000 };

/**
 * Warm the module registry before the first render.
 *
 * The route elements are `React.lazy`, so the first render of each one pays for
 * transforming that page's whole import graph — several seconds, which a
 * `findBy*` would otherwise have to sit through while staring at the Suspense
 * fallback. Importing the pages here is the same registry `React.lazy` reads.
 */
beforeAll(async () => {
  await Promise.all([
    import('../pages/ShareImportPage'),
    import('../pages/IdentityStepPage'),
    import('../pages/RoomSelectionStepPage'),
    import('../pages/TransportEntryStepPage'),
    import('../pages/SummaryStepPage'),
  ]);
}, 60000);

afterEach(() => {
  localStorage.clear();
});

// ============================================================================
// Test Helpers
// ============================================================================

const SHARE_ID = 'share-123';

/**
 * Builds a minimal trip row for the mocked repository to return.
 */
function makeTrip(): Trip {
  return {
    id: 'trip-abc' as TripId,
    name: 'Beach Vacation',
    location: 'Brittany, France',
    startDate: isoDate('2026-07-15'),
    endDate: isoDate('2026-07-22'),
    shareId: SHARE_ID as ShareId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Mounts the real sharing route table at the given URL.
 */
function renderRouteAt(url: string): void {
  const router = createMemoryRouter(sharingRoutes, { initialEntries: [url] });
  rtlRender(<RouterProvider router={router} />);
}

// ============================================================================
// Tests
// ============================================================================

describe('sharingRoutes', () => {
  it('renders the welcome screen at the index route', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());

    renderRouteAt(`/share/${SHARE_ID}`);

    expect(await screen.findByText('sharing.getStarted', undefined, FIND_TIMEOUT)).toBeInTheDocument();
  });

  it('renders the identity step, not the welcome screen, at /identity', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([]);

    renderRouteAt(`/share/${SHARE_ID}/identity`);

    // Content, not URL: the URL matched even while the step was unreachable.
    expect(await screen.findByText('sharing.identityTitle', undefined, FIND_TIMEOUT)).toBeInTheDocument();
    expect(screen.queryByText('sharing.getStarted')).not.toBeInTheDocument();
  });

  it.each([
    ['room', 'sharing.roomTitle'],
    ['transport', 'sharing.transportTitle'],
    ['summary', 'sharing.summaryTitle'],
  ])('renders the %s step through the parent route', async (segment, heading) => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetPersonsByTripId.mockResolvedValue([]);
    localStorage.setItem(
      `kikouchou_guest_${SHARE_ID}`,
      JSON.stringify({ personId: 'person-1', tripId: 'trip-abc' }),
    );

    renderRouteAt(`/share/${SHARE_ID}/${segment}`);

    expect(await screen.findByText(heading, undefined, FIND_TIMEOUT)).toBeInTheDocument();
  });
});
