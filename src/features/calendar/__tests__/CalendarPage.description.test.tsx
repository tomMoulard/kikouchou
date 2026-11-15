/**
 * @fileoverview The trip's description on the calendar page: shown under the
 * planning and the activity agenda, edited in place by a member, read by a
 * viewer, and absent for a viewer while it is empty.
 *
 * @module features/calendar/__tests__/CalendarPage.description.test
 */

import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/test/utils';
import type { Trip } from '@/types';

import { CalendarPage } from '../pages/CalendarPage';

// ============================================================================
// Test Data
// ============================================================================

const baseTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  startDate: '2026-04-01' as Trip['startDate'],
  endDate: '2026-04-10' as Trip['endDate'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ============================================================================
// Mocks
// ============================================================================

const mockUseTripContext = vi.fn();
const mockUpdateTrip = vi.fn();
const mockNotifySuccess = vi.fn();

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => mockUseTripContext(),
}));

vi.mock('@/contexts/RoomContext', () => ({
  useRoomContext: () => ({ rooms: [], isLoading: false, error: null }),
}));

vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => ({
    assignments: [],
    isLoading: false,
    error: null,
    deleteAssignment: vi.fn(),
    getAssignmentsByRoom: vi.fn(() => []),
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: [],
    getPersonById: vi.fn(),
    isLoading: false,
    error: null,
  }),
}));

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => ({
    arrivals: [],
    departures: [],
    isLoading: false,
    error: null,
    deleteTransport: vi.fn(),
  }),
}));

vi.mock('@/contexts/ActivityContext', () => ({
  useActivityContext: () => ({
    activities: [],
    isLoading: false,
    error: null,
    deleteActivity: vi.fn(),
  }),
}));

vi.mock('@/contexts/RideContext', () => ({
  useRideContext: () => ({ rides: [], vehicles: [], isLoading: false, error: null }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess }),
}));

vi.mock('@/hooks/useToday', () => ({
  useToday: () => ({ today: new Date(2026, 3, 4) }),
}));

vi.mock('@/features/activities/hooks/useActivityParticipation', () => ({
  useActivityParticipation: () => ({
    myPersonId: undefined,
    canToggle: false,
    toggleParticipation: vi.fn(),
  }),
}));

vi.mock('@/features/transports', () => ({
  TransportDialog: () => null,
}));

vi.mock('@/features/activities/components/ActivityDialog', () => ({
  ActivityDialog: () => null,
}));

vi.mock('@/lib/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/db')>()),
  updateTrip: (...args: unknown[]) => mockUpdateTrip(...args),
}));

// ============================================================================
// Helpers
// ============================================================================

function renderWithTrip(trip: Trip, view: 'timeline' | 'card' = 'timeline') {
  mockUseTripContext.mockReturnValue({
    currentTrip: trip,
    isLoading: false,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
  });
  return render(
    <Routes>
      <Route path="/trips/:tripId/calendar" element={<CalendarPage />} />
    </Routes>,
    { initialRoute: `/trips/${trip.id}/calendar?view=${view}`, withProviders: false },
  );
}

function descriptionRegion(): HTMLElement | null {
  return screen.queryByTestId('calendar-trip-description');
}

// ============================================================================
// Tests
// ============================================================================

describe('CalendarPage trip description', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateTrip.mockResolvedValue(undefined);
  });

  it('shows the description under the planning, in both views', () => {
    const trip = { ...baseTrip, description: 'Door code **4521**' };

    const { unmount } = renderWithTrip(trip, 'timeline');
    const region = descriptionRegion();
    expect(region).not.toBeNull();
    expect(within(region!).getByText('4521')).toBeInTheDocument();
    unmount();

    renderWithTrip(trip, 'card');
    const grid = screen.getByRole('grid');
    const cardRegion = descriptionRegion();
    expect(cardRegion).not.toBeNull();
    // Below the planning: the grid comes first in the document.
    expect(
      grid.compareDocumentPosition(cardRegion!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('asks a member to write one when the trip has none', () => {
    renderWithTrip({ ...baseTrip, description: undefined });

    const region = descriptionRegion();
    expect(region).not.toBeNull();
    expect(
      within(region!).getByText('trips.descriptionEdit.emptyEditable'),
    ).toBeInTheDocument();
    expect(
      within(region!).getByRole('button', { name: 'trips.descriptionEdit.editAria' }),
    ).toBeInTheDocument();
  });

  it('shows a viewer the description, with no way to edit it', () => {
    renderWithTrip({ ...baseTrip, description: 'Bring towels', viewerToken: 'token-1' });

    const region = descriptionRegion();
    expect(region).not.toBeNull();
    expect(within(region!).getByText('Bring towels')).toBeInTheDocument();
    expect(
      within(region!).queryByRole('button', { name: 'trips.descriptionEdit.editAria' }),
    ).not.toBeInTheDocument();
  });

  it('shows a viewer no card while the description is empty or blank', () => {
    const { unmount } = renderWithTrip({
      ...baseTrip,
      description: undefined,
      viewerToken: 'token-1',
    });
    expect(descriptionRegion()).toBeNull();
    unmount();

    renderWithTrip({ ...baseTrip, description: '   ', viewerToken: 'token-1' });
    expect(descriptionRegion()).toBeNull();
  });

  it('saves the edited description on the current trip and confirms it', async () => {
    const user = userEvent.setup();
    renderWithTrip({ ...baseTrip, description: 'Old text' });

    const region = descriptionRegion()!;
    await user.click(
      within(region).getByRole('button', { name: 'trips.descriptionEdit.editAria' }),
    );
    const editor = within(region).getByRole('textbox');
    await user.clear(editor);
    await user.type(editor, 'New text');
    await user.click(within(region).getByRole('button', { name: 'common.save' }));

    await waitFor(() => {
      expect(mockUpdateTrip).toHaveBeenCalledWith(baseTrip.id, { description: 'New text' });
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('trips.descriptionEdit.saved');
  });
});
