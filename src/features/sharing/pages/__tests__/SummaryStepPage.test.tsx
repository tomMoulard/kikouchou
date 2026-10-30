/**
 * Unit tests for SummaryStepPage (summary & trip entry step).
 *
 * Tests:
 * 5.1  Page loads and displays identity section (name + color badge)
 * 5.2  Page displays room assignment when one exists
 * 5.3  Page displays "Not yet assigned" when no room assignment
 * 5.4  Page displays transport entries when they exist
 * 5.5  Page displays "None added" when no transports
 * 5.6  Missing localStorage identity redirects to identity step
 * 5.7  Tapping identity section navigates to /share/:shareId/identity
 * 5.8  Tapping room section navigates to /share/:shareId/room
 * 5.9  Tapping transport section navigates to /share/:shareId/transport
 * 5.10 "Enter trip" button calls setCurrentTrip(trip.id) and navigates to /trips/:tripId/calendar
 * 5.11 "Enter trip" sets wizard-complete flag in localStorage
 * 5.12 Loading state shown while data loads
 * 5.13 Not-found trip shows friendly error card
 * 5.14 i18n — text nodes use translation keys (keys returned as-is by mock)
 * 5.15 Submit error shows error message and allows retry
 *
 * Note: i18next is mocked in test/setup.ts — t('key', options) returns the key string.
 *
 * @module features/sharing/pages/__tests__/SummaryStepPage.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';

import { render } from '@/test/utils';

import { SummaryStepPage } from '../SummaryStepPage';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/lib/db', () => ({
  getTripByShareId: vi.fn(),
  getPersonById: vi.fn(),
  getAssignmentsByPersonId: vi.fn(),
  getRoomById: vi.fn(),
  getTransportsByPersonId: vi.fn(),
  setCurrentTrip: vi.fn(),
}));

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
  ISODateTimeString,
  Person,
  PersonId,
  Room,
  RoomAssignment,
  RoomAssignmentId,
  RoomId,
  ShareId,
  Transport,
  TransportId,
  TransportMode,
  TransportType,
  Trip,
  TripId,
  UnixTimestamp,
} from '@/types';
import {
  getTripByShareId,
  getPersonById,
  getAssignmentsByPersonId,
  getRoomById,
  getTransportsByPersonId,
  setCurrentTrip,
} from '@/lib/db';

const mockGetTripByShareId = vi.mocked(getTripByShareId);
const mockGetPersonById = vi.mocked(getPersonById);
const mockGetAssignmentsByPersonId = vi.mocked(getAssignmentsByPersonId);
const mockGetRoomById = vi.mocked(getRoomById);
const mockGetTransportsByPersonId = vi.mocked(getTransportsByPersonId);
const mockSetCurrentTrip = vi.mocked(setCurrentTrip);

// ============================================================================
// Test Helpers
// ============================================================================

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

function makePerson(overrides?: Partial<Person>): Person {
  return {
    id: 'person1' as PersonId,
    tripId: 'trip1' as TripId,
    name: 'Lucas',
    color: '#3b82f6' as HexColor,
    ...overrides,
  };
}

function makeAssignment(overrides?: Partial<RoomAssignment>): RoomAssignment {
  return {
    id: 'assignment1' as RoomAssignmentId,
    tripId: 'trip1' as TripId,
    roomId: 'room1' as RoomId,
    personId: 'person1' as PersonId,
    startDate: '2026-07-15' as ISODateString,
    endDate: '2026-07-22' as ISODateString,
    ...overrides,
  };
}

function makeRoom(overrides?: Partial<Room>): Room {
  return {
    id: 'room1' as RoomId,
    tripId: 'trip1' as TripId,
    name: 'Chambre du Jardin',
    capacity: 4,
    order: 0,
    ...overrides,
  };
}

function makeTransport(overrides?: Partial<Transport>): Transport {
  return {
    id: 'transport1' as TransportId,
    tripId: 'trip1' as TripId,
    personId: 'person1' as PersonId,
    type: 'arrival' as TransportType,
    datetime: '2026-07-15T14:30' as ISODateTimeString,
    location: 'Gare de Vannes',
    needsPickup: true,
    transportMode: 'train' as TransportMode,
    transportNumber: 'TGV 8541',
    ...overrides,
  };
}

function setStoredIdentity(
  shareId: string,
  identity: { personId: string; tripId: string },
): void {
  localStorageMock[`kikouchou_guest_${shareId}`] = JSON.stringify(identity);
}

/** Sets up all mocks for a fully-loaded summary page (guest with room + transports). */
function setupFullMocks() {
  mockGetTripByShareId.mockResolvedValue(makeTrip());
  mockGetPersonById.mockResolvedValue(makePerson());
  mockGetAssignmentsByPersonId.mockResolvedValue([makeAssignment()]);
  mockGetRoomById.mockResolvedValue(makeRoom());
  mockGetTransportsByPersonId.mockResolvedValue([makeTransport()]);
}

/** Sets up mocks for a summary page with no room and no transports. */
function setupEmptyMocks() {
  mockGetTripByShareId.mockResolvedValue(makeTrip());
  mockGetPersonById.mockResolvedValue(makePerson());
  mockGetAssignmentsByPersonId.mockResolvedValue([]);
  mockGetRoomById.mockResolvedValue(undefined);
  mockGetTransportsByPersonId.mockResolvedValue([]);
}

function renderSummaryPage(shareId = 'abc123') {
  return render(
    <Routes>
      <Route path="/share/:shareId/summary" element={<SummaryStepPage />} />
      <Route
        path="/share/:shareId/identity"
        element={<div data-testid="identity-page">Identity step</div>}
      />
      <Route
        path="/share/:shareId/room"
        element={<div data-testid="room-page">Room step</div>}
      />
      <Route
        path="/share/:shareId/transport"
        element={<div data-testid="transport-page">Transport step</div>}
      />
      <Route
        path="/trips/:tripId/calendar"
        element={<div data-testid="calendar-page">Calendar</div>}
      />
    </Routes>,
    { withProviders: false, initialEntries: [`/share/${shareId}/summary`] },
  );
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
});

// ============================================================================
// 5.1 — Page loads and displays identity section (name + color badge)
// ============================================================================

describe('SummaryStepPage — 5.1: identity section displays name and color', () => {
  it('shows guest name and color dot after loading', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();

    renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('Lucas')).toBeInTheDocument();
    });

    // Color dot is rendered (inline style with backgroundColor)
    const colorDot = document.querySelector('span[style*="background-color"]');
    expect(colorDot).toBeInTheDocument();
  });
});

// ============================================================================
// 5.2 — Page displays room assignment when one exists
// ============================================================================

describe('SummaryStepPage — 5.2: room assignment displayed', () => {
  it('shows room name when guest has a room assignment', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();

    renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('Chambre du Jardin')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 5.3 — Page displays "Not yet assigned" when no room assignment
// ============================================================================

describe('SummaryStepPage — 5.3: "Not yet assigned" when no room', () => {
  it('shows empty state text when no room assignment exists', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupEmptyMocks();

    renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.summaryRoomEmpty')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 5.4 — Page displays transport entries when they exist
// ============================================================================

describe('SummaryStepPage — 5.4: transport entries displayed', () => {
  it('shows transport details when transports exist', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();

    renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.transportArrival', { exact: false })).toBeInTheDocument();
      expect(screen.getByText('Gare de Vannes')).toBeInTheDocument();
    });
  });

  it('shows the guest as their own driver when that is what they entered', async () => {
    // The last screen before entering the trip, and the only place the guest
    // can still catch a wrong answer: the transport step used to be the only
    // one that reflected it, so the summary said nothing at all.
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();
    mockGetTransportsByPersonId.mockResolvedValue([
      makeTransport({ needsPickup: false, driverId: 'person1' as PersonId }),
    ]);

    renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.transportDrivingBadge')).toBeInTheDocument();
    });
    expect(
      screen.queryByText('sharing.transportNeedsPickupBadge'),
    ).not.toBeInTheDocument();
  });

  it('shows a pickup is still needed when that is what they entered', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();

    renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.transportNeedsPickupBadge')).toBeInTheDocument();
    });
    expect(screen.queryByText('sharing.transportDrivingBadge')).not.toBeInTheDocument();
  });
});

// ============================================================================
// 5.5 — Page displays "None added" when no transports
// ============================================================================

describe('SummaryStepPage — 5.5: "None added" when no transports', () => {
  it('shows empty state text when no transports exist', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupEmptyMocks();

    renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.summaryTransportEmpty')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 5.6 — Missing localStorage identity redirects to identity step
// ============================================================================

describe('SummaryStepPage — 5.6: missing identity redirects', () => {
  it('redirects to identity step when localStorage key is absent', async () => {
    mockGetTripByShareId.mockResolvedValue(makeTrip());

    renderSummaryPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });
  });

  it('redirects when stored identity JSON is invalid', async () => {
    localStorageMock['kikouchou_guest_abc123'] = 'not-valid-json{{{';
    mockGetTripByShareId.mockResolvedValue(makeTrip());

    renderSummaryPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 5.6b — Stale tripId cross-validation redirects to identity step
// ============================================================================

describe('SummaryStepPage — 5.6b: stale tripId redirects to identity step', () => {
  it('redirects when stored tripId does not match loaded trip', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'different-trip' });
    mockGetTripByShareId.mockResolvedValue(makeTrip({ id: 'trip1' as TripId }));

    renderSummaryPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });

    expect(localStorageMock['kikouchou_guest_abc123']).toBeUndefined();
  });
});

// ============================================================================
// 5.7 — Tapping identity section navigates to /share/:shareId/identity
// ============================================================================

describe('SummaryStepPage — 5.7: tapping identity navigates to identity step', () => {
  it('navigates to identity step when identity section is clicked', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();

    const { user } = renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('Lucas')).toBeInTheDocument();
    });

    const identityButton = screen.getByRole('button', { name: 'sharing.summaryChangeIdentity' });
    await user.click(identityButton);

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 5.8 — Tapping room section navigates to /share/:shareId/room
// ============================================================================

describe('SummaryStepPage — 5.8: tapping room navigates to room step', () => {
  it('navigates to room step when room section is clicked', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();

    const { user } = renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('Chambre du Jardin')).toBeInTheDocument();
    });

    const roomButton = screen.getByRole('button', { name: 'sharing.summaryChangeRoom' });
    await user.click(roomButton);

    await waitFor(() => {
      expect(screen.getByTestId('room-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 5.9 — Tapping transport section navigates to /share/:shareId/transport
// ============================================================================

describe('SummaryStepPage — 5.9: tapping transport navigates to transport step', () => {
  it('navigates to transport step when transport section is clicked', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();

    const { user } = renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('Gare de Vannes')).toBeInTheDocument();
    });

    const transportButton = screen.getByRole('button', { name: 'sharing.summaryChangeTransport' });
    await user.click(transportButton);

    await waitFor(() => {
      expect(screen.getByTestId('transport-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 5.10 — "Enter trip" calls setCurrentTrip and navigates to calendar
// ============================================================================

describe('SummaryStepPage — 5.10: "Enter trip" calls setCurrentTrip and navigates', () => {
  it('calls setCurrentTrip(trip.id) and navigates to /trips/:tripId/calendar', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);

    const { user } = renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('Lucas')).toBeInTheDocument();
    });

    const enterButton = screen.getByRole('button', { name: 'sharing.summaryEnterTrip' });
    await user.click(enterButton);

    await waitFor(() => {
      expect(mockSetCurrentTrip).toHaveBeenCalledWith('trip1');
    });

    await waitFor(() => {
      expect(screen.getByTestId('calendar-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 5.11 — "Enter trip" sets wizard-complete flag in localStorage
// ============================================================================

describe('SummaryStepPage — 5.11: wizard-complete flag set in localStorage', () => {
  it('sets localStorage wizard-complete flag after entering trip', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);

    const { user } = renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('Lucas')).toBeInTheDocument();
    });

    const enterButton = screen.getByRole('button', { name: 'sharing.summaryEnterTrip' });
    await user.click(enterButton);

    await waitFor(() => {
      expect(localStorageMock['kikouchou_wizard_complete_abc123']).toBe('true');
    });
  });
});

// ============================================================================
// 5.12 — Loading state shown while data loads
// ============================================================================

describe('SummaryStepPage — 5.12: loading state shown while data loads', () => {
  it('shows loading state while fetching', () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockReturnValue(new Promise(() => { /* never resolves */ }));

    renderSummaryPage();

    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// ============================================================================
// 5.13 — Not-found trip shows friendly error card
// ============================================================================

describe('SummaryStepPage — 5.13: not-found trip shows error card', () => {
  it('shows not-found card when trip does not exist', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    mockGetTripByShareId.mockResolvedValue(undefined);

    renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.notFoundWizard')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 5.14 — i18n: text nodes use translation keys
// ============================================================================

describe('SummaryStepPage — 5.14: i18n text nodes use translation keys', () => {
  it('renders title, subtitle, section labels, and button via i18n keys', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();

    renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('sharing.summaryTitle')).toBeInTheDocument();
      expect(screen.getByText('sharing.summarySubtitle')).toBeInTheDocument();
      expect(screen.getByText('sharing.summaryIdentityLabel')).toBeInTheDocument();
      expect(screen.getByText('sharing.summaryRoomLabel')).toBeInTheDocument();
      expect(screen.getByText('sharing.summaryTransportLabel')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sharing.summaryEnterTrip' })).toBeInTheDocument();
    });
  });
});

// ============================================================================
// 5.15 — Submit error shows error message and allows retry
// ============================================================================

describe('SummaryStepPage — 5.15: submit error shows error and allows retry', () => {
  it('shows error message when setCurrentTrip fails, then retries successfully', async () => {
    setStoredIdentity('abc123', { personId: 'person1', tripId: 'trip1' });
    setupFullMocks();
    mockSetCurrentTrip.mockRejectedValueOnce(new Error('Network failure'));

    const { user } = renderSummaryPage();

    await waitFor(() => {
      expect(screen.getByText('Lucas')).toBeInTheDocument();
    });

    const enterButton = screen.getByRole('button', { name: 'sharing.summaryEnterTrip' });
    await user.click(enterButton);

    // Error should be shown
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('sharing.summaryEnterTripError')).toBeInTheDocument();
    });

    // Button should still be enabled for retry
    expect(enterButton).not.toBeDisabled();

    // Retry should work
    mockSetCurrentTrip.mockResolvedValueOnce(undefined);
    await user.click(enterButton);

    await waitFor(() => {
      expect(screen.getByTestId('calendar-page')).toBeInTheDocument();
    });
  });
});

// ============================================================================
// Additional Branch Coverage Tests
// ============================================================================

describe('SummaryStepPage — additional branch coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(localStorageMock).forEach((k) => { delete localStorageMock[k]; });
  });

  it('redirects when stored identity has whitespace-only personId', async () => {
    localStorageMock['kikouchou_guest_abc123'] = JSON.stringify({
      personId: '   ',
      tripId: 'trip-1',
    });

    renderSummaryPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });
  });

  it('redirects when stored identity has whitespace-only tripId', async () => {
    localStorageMock['kikouchou_guest_abc123'] = JSON.stringify({
      personId: 'p1',
      tripId: '  ',
    });

    renderSummaryPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });
  });

  it('redirects when stored identity JSON is malformed', async () => {
    localStorageMock['kikouchou_guest_abc123'] = '{invalid json';

    renderSummaryPage('abc123');

    await waitFor(() => {
      expect(screen.getByTestId('identity-page')).toBeInTheDocument();
    });
  });
});
