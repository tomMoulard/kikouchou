/**
 * Unit tests for RoomSelectionStepPage (room selection step).
 *
 * Tests:
 * 4.1 Rooms load and render with capacity indicators
 * 4.2 Full room shows "Full" badge and disabled button
 * 4.3 Available room shows "Claim this room" button (enabled)
 * 4.4 Tapping "Claim this room" calls checkAssignmentConflict then createAssignment
 * 4.5 Conflict detection shows inline error without navigating
 * 4.6 Successful claim updates card state and enables "Next"
 * 4.7 "Skip for now" navigates to /share/:shareId/transport
 * 4.8 Missing localStorage identity redirects to identity step
 * 4.9 i18n — text nodes use translation keys (keys returned as-is by mock)
 * 4.10 Empty rooms list shows friendly empty state
 *
 * Note: i18next is mocked in test/setup.ts — t('key', options) returns the key string.
 *
 * @module features/sharing/pages/__tests__/RoomSelectionStepPage.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { render } from '@/test/utils';

import { RoomSelectionStepPage } from '../RoomSelectionStepPage';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/db', () => ({
  getTripByShareId: vi.fn(),
  getRoomsByTripId: vi.fn(),
  getAssignmentsByTripId: vi.fn(),
  getPersonsByTripId: vi.fn(),
  checkAssignmentConflict: vi.fn(),
  createAssignment: vi.fn(),
}));

// i18next is auto-mocked in test/setup.ts: t('key') → 'key', t('key', {x}) → 'key'

// localStorage mock — controlled per test
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

// ============================================================================
// Imports after mocks
// ============================================================================

import type {
  HexColor,
  ISODateString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  ShareId,
  Trip,
  TripId,
  UnixTimestamp,
} from '@/types';
import {
  getTripByShareId,
  getRoomsByTripId,
  getAssignmentsByTripId,
  getPersonsByTripId,
  checkAssignmentConflict,
  createAssignment,
} from '@/lib/db';

const mockGetTripByShareId = vi.mocked(getTripByShareId);
const mockGetRoomsByTripId = vi.mocked(getRoomsByTripId);
const mockGetAssignmentsByTripId = vi.mocked(getAssignmentsByTripId);
const mockGetPersonsByTripId = vi.mocked(getPersonsByTripId);
const mockCheckAssignmentConflict = vi.mocked(checkAssignmentConflict);
const mockCreateAssignment = vi.mocked(createAssignment);

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Creates a minimal fixture Trip for testing.
 */
function makeTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: 'trip1' as TripId,
    shareId: 'abc123' as ShareId,
    name: 'Test Trip',
    location: 'Paris',
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-22' as ISODateString,
    createdAt: 0 as UnixTimestamp,
    updatedAt: 0 as UnixTimestamp,
    ...overrides,
  };
}

/**
 * Creates a minimal fixture Room for testing.
 */
function makeRoom(overrides?: Partial<Room>): Room {
  return {
    id: 'room1' as RoomId,
    tripId: 'trip1' as TripId,
    name: 'Master Bedroom',
    capacity: 2,
    order: 0,
    icon: 'bed-double',
    ...overrides,
  };
}

/**
 * Creates a minimal fixture RoomAssignment for testing.
 */
function makeAssignment(overrides?: Partial<RoomAssignment>): RoomAssignment {
  return {
    id: 'assign1' as RoomAssignmentId,
    tripId: 'trip1' as TripId,
    roomId: 'room1' as RoomId,
    personId: 'person1' as PersonId,
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-22' as ISODateString,
    ...overrides,
  };
}

/**
 * Creates a minimal fixture Person for testing.
 *
 * `headcount` defaults to 1; pass 2 for a guest row that stands for a couple.
 */
function makePerson(overrides?: Partial<Person>): Person {
  return {
    id: 'person1' as PersonId,
    tripId: 'trip1' as TripId,
    name: 'Alice',
    color: '#3b82f6' as HexColor,
    ...overrides,
  };
}

/**
 * Sets the stored guest identity in the fake localStorage.
 */
function setStoredIdentity(
  shareId: string,
  identity: { personId: string; tripId: string },
): void {
  localStorageMock[`kikouchou_guest_${shareId}`] = JSON.stringify(identity);
}

/**
 * Renders RoomSelectionStepPage inside a MemoryRouter with shareId in the URL.
 * Uses @/test/utils render with withProviders: false — page is outside AppProviders (AR-10).
 * Passes initialEntries so @/test/utils provides the router; Routes are defined directly.
 */
function renderRoomSelectionPage(shareId = 'abc123') {
  return render(
    <Routes>
      <Route path="/share/:shareId/room" element={<RoomSelectionStepPage />} />
      <Route
        path="/share/:shareId/identity"
        element={<div data-testid="identity-page">Identity step</div>}
      />
      <Route
        path="/share/:shareId/transport"
        element={<div data-testid="transport-page">Transport step</div>}
      />
    </Routes>,
    { withProviders: false, initialEntries: [`/share/${shareId}/room`] },
  );
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  // The page resolves each assignment's headcount from the guest list, so every
  // test needs this to resolve even when the guest list is irrelevant to it.
  mockGetPersonsByTripId.mockResolvedValue([]);
});

// ============================================================================
// 4.1 — Rooms load and render with capacity indicators
// ============================================================================

describe('RoomSelectionStepPage — 4.1: rooms load and render with capacity indicators', () => {
  it('renders room names and capacity text after loading', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([
      makeRoom({ id: 'r1' as RoomId, name: 'Bedroom A', capacity: 3 }),
      makeRoom({ id: 'r2' as RoomId, name: 'Bedroom B', capacity: 2 }),
    ]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);

    renderRoomSelectionPage();

    await waitFor(() => {
      expect(screen.getByText('Bedroom A')).toBeInTheDocument();
      expect(screen.getByText('Bedroom B')).toBeInTheDocument();
    });
  });

  it('shows loading state while fetching', () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockReturnValue(new Promise(() => { /* never resolves */ }));

    renderRoomSelectionPage();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows not-found state when trip does not exist', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(undefined);

    renderRoomSelectionPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.notFoundWizard')).toBeInTheDocument();
    });
  });

  it('calls getRoomsByTripId and getAssignmentsByTripId in parallel with correct tripId', async () => {
    // storedIdentity.tripId must match trip.id for the R5 cross-check to pass
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip-xyz' });
    const trip = makeTrip({ id: 'trip-xyz' as TripId });
    mockGetTripByShareId.mockResolvedValue(trip);
    mockGetRoomsByTripId.mockResolvedValue([]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);

    renderRoomSelectionPage();

    await waitFor(() => {
      expect(mockGetRoomsByTripId).toHaveBeenCalledWith('trip-xyz');
      expect(mockGetAssignmentsByTripId).toHaveBeenCalledWith('trip-xyz');
    });
  });
});

// ============================================================================
// 4.2 — Full room shows "Full" badge and disabled button
// ============================================================================

describe('RoomSelectionStepPage — 4.2: full room shows "Full" and no claim button', () => {
  it('shows "Full" badge when room occupancy equals capacity', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([
      makeRoom({ id: 'r1' as RoomId, name: 'Full Room', capacity: 1 }),
    ]);
    // One assignment fills the capacity-1 room
    mockGetAssignmentsByTripId.mockResolvedValue([
      makeAssignment({ roomId: 'r1' as RoomId }),
    ]);

    renderRoomSelectionPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.roomFull')).toBeInTheDocument();
    });

    // "Claim this room" button should not be rendered for a full room
    expect(screen.queryByRole('button', { name: 'sharing.roomClaimNamed' })).not.toBeInTheDocument();
  });
});

describe('RoomSelectionStepPage — 4.2b: occupancy counts people over the trip nights', () => {
  it('treats a couple as two occupants, filling a two-bed room', async () => {
    setStoredIdentity('abc123', { personId: 'person2', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([
      makeRoom({ id: 'r1' as RoomId, name: 'Couple Room', capacity: 2 }),
    ]);
    mockGetAssignmentsByTripId.mockResolvedValue([
      makeAssignment({ roomId: 'r1' as RoomId, personId: 'person1' as PersonId }),
    ]);
    // One guest row, two real people: the room has no bed left.
    mockGetPersonsByTripId.mockResolvedValue([makePerson({ headcount: 2 })]);

    renderRoomSelectionPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.roomFull')).toBeInTheDocument();
    });
    expect(
      screen.queryByRole('button', { name: 'sharing.roomClaimNamed' }),
    ).not.toBeInTheDocument();
  });

  it('ignores an assignment whose nights fall outside the trip', async () => {
    setStoredIdentity('abc123', { personId: 'person2', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([
      makeRoom({ id: 'r1' as RoomId, name: 'Free Room', capacity: 1 }),
    ]);
    // A stale row for the week before the trip: it takes no bed during the stay.
    mockGetAssignmentsByTripId.mockResolvedValue([
      makeAssignment({
        roomId: 'r1' as RoomId,
        startDate: '2026-07-01' as ISODateString,
        endDate: '2026-07-05' as ISODateString,
      }),
    ]);
    mockGetPersonsByTripId.mockResolvedValue([makePerson()]);

    renderRoomSelectionPage();

    const claimButton = await screen.findByRole('button', { name: 'sharing.roomClaimNamed' });
    expect(claimButton).toBeInTheDocument();
    expect(screen.queryByText('sharing.roomFull')).not.toBeInTheDocument();
  });
});

// ============================================================================
// 4.3 — Available room shows "Claim this room" button (enabled)
// ============================================================================

describe('RoomSelectionStepPage — 4.3: available room shows enabled "Claim" button', () => {
  it('renders enabled "Claim this room" button for available room', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([
      makeRoom({ id: 'r1' as RoomId, name: 'Available Room', capacity: 2 }),
    ]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);

    renderRoomSelectionPage();

    const claimButton = await screen.findByRole('button', { name: 'sharing.roomClaimNamed' });
    expect(claimButton).toBeInTheDocument();
    expect(claimButton).not.toBeDisabled();
  });
});

// ============================================================================
// 4.4 — Tapping "Claim this room" calls checkAssignmentConflict then createAssignment
// ============================================================================

describe('RoomSelectionStepPage — 4.4: tapping "Claim" calls conflict check then createAssignment', () => {
  it('calls checkAssignmentConflict then createAssignment on claim', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    const trip = makeTrip();
    mockGetTripByShareId.mockResolvedValue(trip);
    const room = makeRoom({ id: 'r1' as RoomId, capacity: 2 });
    mockGetRoomsByTripId.mockResolvedValue([room]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);
    mockCheckAssignmentConflict.mockResolvedValue(false);
    const newAssignment = makeAssignment({ id: 'a-new' as RoomAssignmentId });
    mockCreateAssignment.mockResolvedValue(newAssignment);

    const { user } = renderRoomSelectionPage();

    const claimButton = await screen.findByRole('button', { name: 'sharing.roomClaimNamed' });
    await user.click(claimButton);

    await waitFor(() => {
      expect(mockCheckAssignmentConflict).toHaveBeenCalledWith(
        'trip1',
        'person1',
        '2026-07-15',
        '2026-07-22',
      );
      expect(mockCreateAssignment).toHaveBeenCalledWith('trip1', {
        roomId: 'r1',
        personId: 'person1',
        startDate: '2026-07-15',
        endDate: '2026-07-22',
      });
    });
  });
});

// ============================================================================
// 4.5 — Conflict detection shows inline error without navigating
// ============================================================================

describe('RoomSelectionStepPage — 4.5: conflict shows inline error without navigating', () => {
  it('shows inline conflict message when checkAssignmentConflict returns true', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([
      makeRoom({ id: 'r1' as RoomId, capacity: 2 }),
    ]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);
    mockCheckAssignmentConflict.mockResolvedValue(true);

    const { user } = renderRoomSelectionPage();

    const claimButton = await screen.findByRole('button', { name: 'sharing.roomClaimNamed' });
    await user.click(claimButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('sharing.roomConflict')).toBeInTheDocument();
    });

    // createAssignment should not be called when there is a conflict
    expect(mockCreateAssignment).not.toHaveBeenCalled();

    // Should still be on the room page (not navigate away)
    expect(screen.queryByTestId('transport-page')).not.toBeInTheDocument();
  });
});

// ============================================================================
// 4.6 — Successful claim updates card state and enables "Next"
// ============================================================================

describe('RoomSelectionStepPage — 4.6: successful claim shows claimed state and enables Next', () => {
  it('shows "Claimed ✓" and enables Next button after successful claim', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    const room = makeRoom({ id: 'r1' as RoomId, capacity: 2 });
    mockGetRoomsByTripId.mockResolvedValue([room]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);
    mockCheckAssignmentConflict.mockResolvedValue(false);
    mockCreateAssignment.mockResolvedValue(makeAssignment({ id: 'a-new' as RoomAssignmentId }));

    const { user } = renderRoomSelectionPage();

    // "Next" button starts disabled
    const nextButton = await screen.findByRole('button', { name: 'sharing.roomNext' });
    expect(nextButton).toBeDisabled();

    const claimButton = screen.getByRole('button', { name: 'sharing.roomClaimNamed' });
    await user.click(claimButton);

    await waitFor(() => {
      // "Claimed ✓" text should appear
      expect(screen.getByText('sharing.roomClaimed')).toBeInTheDocument();
      // "Next" button should now be enabled
      expect(screen.getByRole('button', { name: 'sharing.roomNext' })).not.toBeDisabled();
    });
  });
});

// ============================================================================
// 4.7 — "Skip for now" navigates to /share/:shareId/transport
// ============================================================================

describe('RoomSelectionStepPage — 4.7: "Skip for now" navigates to transport step', () => {
  it('navigates to transport page when "Skip for now" is clicked', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([makeRoom()]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);

    const { user } = renderRoomSelectionPage('abc123');

    const skipButton = await screen.findByRole('button', { name: 'sharing.roomSkip' });
    await user.click(skipButton);

    await waitFor(() => {
      expect(screen.getByTestId('transport-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 4.8 — Missing localStorage identity redirects to identity step
// ============================================================================

describe('RoomSelectionStepPage — 4.8: missing identity redirects to identity step', () => {
  it('redirects to /share/:shareId/identity when localStorage key is absent', async () => {
    // Do NOT set stored identity
    // Mocks still set up to avoid loadData errors if somehow triggered
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);

    renderRoomSelectionPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });
  });

  it('redirects when stored identity JSON is invalid', async () => {
    localStorageMock['kikouchou_guest_abc123'] = 'not-valid-json{{{';
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);

    renderRoomSelectionPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 4.9 — i18n: text nodes use translation keys
// ============================================================================

describe('RoomSelectionStepPage — 4.9: i18n text nodes use translation keys', () => {
  it('renders title, subtitle, skip, and next via i18n keys', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([makeRoom()]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);

    renderRoomSelectionPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.roomTitle')).toBeInTheDocument();
      expect(screen.getByText('sharing.roomSubtitle')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sharing.roomSkip' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sharing.roomNext' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sharing.roomClaimNamed' })).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 4.10 — Empty rooms list shows friendly empty state
// ============================================================================

describe('RoomSelectionStepPage — 4.10: empty rooms list shows friendly empty state', () => {
  it('shows empty state message when no rooms exist', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(makeTrip());
    mockGetRoomsByTripId.mockResolvedValue([]);
    mockGetAssignmentsByTripId.mockResolvedValue([]);

    renderRoomSelectionPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.roomEmpty')).toBeInTheDocument();
      expect(screen.getByText('sharing.roomEmptyDescription')).toBeInTheDocument();
    });

    // No "Claim" buttons should be shown
    expect(screen.queryByRole('button', { name: 'sharing.roomClaimNamed' })).not.toBeInTheDocument();
  });
});
