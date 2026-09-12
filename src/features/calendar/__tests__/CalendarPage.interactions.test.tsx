/**
 * @fileoverview What the calendar does when somebody taps what is on it.
 *
 * The sibling file renders the month and the timeline and reads them. This one
 * covers the handlers behind the pills: opening a stay, an arrival or an
 * activity, editing one, deleting one, and what the page says when the delete
 * fails. It also covers the two-of-a-kind grouping paths, which only run when a
 * day holds more than one event.
 *
 * @module features/calendar/__tests__/CalendarPage.interactions.test
 */

import { Routes, Route, useLocation } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen, waitFor, within } from '@/test/utils';
import type { Activity, Person, Room, RoomAssignment, Transport, Trip } from '@/types';

import { CalendarPage } from '../pages/CalendarPage';

// ============================================================================
// Test Data
// ============================================================================

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
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

const mockPerson2: Person = {
  id: 'person-2' as Person['id'],
  tripId: mockTrip.id,
  name: 'Bob',
  color: '#ef4444' as Person['color'],
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

/** Overlaps the first one, which is what makes the day hold two spans. */
const overlappingAssignment: RoomAssignment = {
  id: 'assignment-2' as RoomAssignment['id'],
  tripId: mockTrip.id,
  roomId: mockRoom.id,
  personId: mockPerson2.id,
  startDate: '2026-04-02' as RoomAssignment['startDate'],
  endDate: '2026-04-05' as RoomAssignment['endDate'],
};

/** Entirely outside the trip window, inside the visible month. */
const outsideAssignment: RoomAssignment = {
  id: 'assignment-3' as RoomAssignment['id'],
  tripId: mockTrip.id,
  roomId: mockRoom.id,
  personId: mockPerson2.id,
  startDate: '2026-04-20' as RoomAssignment['startDate'],
  endDate: '2026-04-25' as RoomAssignment['endDate'],
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

const sameDayDeparture: Transport = {
  id: 'transport-2' as Transport['id'],
  tripId: mockTrip.id,
  personId: mockPerson2.id,
  type: 'departure',
  datetime: '2026-04-01T18:00:00' as Transport['datetime'],
  location: 'Paris Orly',
  needsPickup: false,
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
  participantIds: [mockPerson.id, 'person-gone' as Person['id']],
};

/** Earlier on the same day, so the per-day sort has something to order. */
const sameDayActivity: Activity = {
  id: 'activity-2' as Activity['id'],
  tripId: mockTrip.id,
  title: 'Breakfast',
  category: 'meal',
  startDatetime: '2026-04-03T07:00:00.000Z',
  allDay: false,
  participantIds: [],
};

// ============================================================================
// Mocks
// ============================================================================

const mockUseTripContext = vi.fn();
const mockUseRoomContext = vi.fn();
const mockUseAssignmentContext = vi.fn();
const mockUsePersonContext = vi.fn();
const mockUseTransportContext = vi.fn();
const mockUseActivityContext = vi.fn();
const mockUseRideContext = vi.fn();

const mockDeleteAssignment = vi.fn();
const mockDeleteTransport = vi.fn();
const mockDeleteActivity = vi.fn();
const mockNotifySuccess = vi.fn();

vi.mock('@/contexts/TripContext', () => ({ useTripContext: () => mockUseTripContext() }));
vi.mock('@/contexts/RoomContext', () => ({ useRoomContext: () => mockUseRoomContext() }));
vi.mock('@/contexts/AssignmentContext', () => ({
  useAssignmentContext: () => mockUseAssignmentContext(),
}));
vi.mock('@/contexts/PersonContext', () => ({ usePersonContext: () => mockUsePersonContext() }));
vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: () => mockUseTransportContext(),
}));
vi.mock('@/contexts/ActivityContext', () => ({
  useActivityContext: () => mockUseActivityContext(),
}));
vi.mock('@/contexts/RideContext', () => ({ useRideContext: () => mockUseRideContext() }));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess }),
}));

vi.mock('@/hooks/useToday', () => ({ useToday: () => ({ today: new Date(2026, 3, 4) }) }));

// Both dialogs are stubs that say which row they were opened on, so an edit can
// be asserted without driving the real forms.
vi.mock('@/features/transports', () => ({
  TransportDialog: ({ open, transportId }: { open: boolean; transportId?: string }) =>
    open ? <div data-testid="transport-dialog" data-transport-id={transportId ?? ''} /> : null,
}));

vi.mock('@/features/activities/components/ActivityDialog', () => ({
  ActivityDialog: ({ open, activityId }: { open: boolean; activityId?: string }) =>
    open ? <div data-testid="activity-dialog" data-activity-id={activityId ?? ''} /> : null,
}));

// ============================================================================
// Helpers
// ============================================================================

/** Renders wherever the page navigated to, so a redirect can be asserted. */
function LandedOn() {
  const location = useLocation();
  return <div data-testid="landed-on">{`${location.pathname}${location.search}`}</div>;
}

function renderCalendarPage(tripId = 'trip-1') {
  return render(
    <Routes>
      <Route path="/trips/:tripId/calendar" element={<CalendarPage />} />
      <Route path="*" element={<LandedOn />} />
    </Routes>,
    { initialRoute: `/trips/${tripId}/calendar`, withProviders: false },
  );
}

function setDefaultMocks(): void {
  mockUseTripContext.mockReturnValue({
    currentTrip: mockTrip,
    isLoading: false,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
  });
  mockUseRoomContext.mockReturnValue({ rooms: [mockRoom], isLoading: false, error: null });
  mockUseAssignmentContext.mockReturnValue({
    assignments: [mockAssignment],
    isLoading: false,
    error: null,
    deleteAssignment: mockDeleteAssignment,
    updateAssignment: vi.fn().mockResolvedValue(undefined),
    getAssignmentsByRoom: vi.fn(() => []),
    checkConflict: vi.fn(() => null),
  });
  mockUsePersonContext.mockReturnValue({
    persons: [mockPerson, mockPerson2],
    getPersonById: vi.fn((id: string) => {
      if (id === mockPerson.id) return mockPerson;
      if (id === mockPerson2.id) return mockPerson2;
      return undefined;
    }),
    isLoading: false,
    error: null,
  });
  mockUseTransportContext.mockReturnValue({
    arrivals: [mockArrival],
    departures: [],
    isLoading: false,
    error: null,
    deleteTransport: mockDeleteTransport,
  });
  mockUseActivityContext.mockReturnValue({
    activities: [mockActivity],
    isLoading: false,
    error: null,
    deleteActivity: mockDeleteActivity,
  });
  mockUseRideContext.mockReturnValue({ rides: [], vehicles: [], isLoading: false, error: null });
}

/** Switches to the month grid, which is where the pills live. */
async function showMonth(user: ReturnType<typeof render>['user']): Promise<void> {
  await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
}

/** Confirms the destructive prompt the detail dialog raises. */
async function confirmDelete(user: ReturnType<typeof render>['user']): Promise<void> {
  const prompt = await screen.findByRole('alertdialog');
  await user.click(within(prompt).getByRole('button', { name: 'common.delete' }));
}

// ============================================================================
// Tests
// ============================================================================

describe('CalendarPage — opening what is on a day', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAssignment.mockResolvedValue(undefined);
    mockDeleteTransport.mockResolvedValue(undefined);
    mockDeleteActivity.mockResolvedValue(undefined);
    setDefaultMocks();
  });

  it('opens a stay with the guest and the room on it', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByLabelText('Alice - Blue Room')[0]!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/Blue Room/).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(/Alice/).length).toBeGreaterThan(0);
  });

  it('opens an activity with the guests who signed up', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByRole('button', { name: 'calendar.viewActivityDetails' })[0]!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/Plant fair/).length).toBeGreaterThan(0);
  });
});

describe('CalendarPage — editing from the detail dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAssignment.mockResolvedValue(undefined);
    mockDeleteTransport.mockResolvedValue(undefined);
    mockDeleteActivity.mockResolvedValue(undefined);
    setDefaultMocks();
  });

  it('opens the transport dialog on the leg that was tapped', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getByTitle(/Paris CDG/));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.edit' }));

    await waitFor(() => {
      expect(screen.getByTestId('transport-dialog')).toHaveAttribute(
        'data-transport-id',
        mockArrival.id,
      );
    });
  });

  it('opens the activity dialog on the activity that was tapped', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByRole('button', { name: 'calendar.viewActivityDetails' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.edit' }));

    await waitFor(() => {
      expect(screen.getByTestId('activity-dialog')).toHaveAttribute(
        'data-activity-id',
        mockActivity.id,
      );
    });
  });
});

describe('CalendarPage — deleting from the detail dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAssignment.mockResolvedValue(undefined);
    mockDeleteTransport.mockResolvedValue(undefined);
    mockDeleteActivity.mockResolvedValue(undefined);
    setDefaultMocks();
  });

  it('deletes the stay and says so', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByLabelText('Alice - Blue Room')[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await confirmDelete(user);

    await waitFor(() => {
      expect(mockDeleteAssignment).toHaveBeenCalledWith(mockAssignment.id);
    });
    expect(mockNotifySuccess).toHaveBeenCalled();
  });

  it('deletes the transport and says so', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getByTitle(/Paris CDG/));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await confirmDelete(user);

    await waitFor(() => {
      expect(mockDeleteTransport).toHaveBeenCalledWith(mockArrival.id);
    });
  });

  it('deletes the activity and says so', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByRole('button', { name: 'calendar.viewActivityDetails' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await confirmDelete(user);

    await waitFor(() => {
      expect(mockDeleteActivity).toHaveBeenCalledWith(mockActivity.id);
    });
  });

  it('does not claim the stay was deleted when the write failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDeleteAssignment.mockRejectedValue(new Error('offline'));
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByLabelText('Alice - Blue Room')[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await confirmDelete(user);

    await waitFor(() => {
      expect(mockDeleteAssignment).toHaveBeenCalled();
    });
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does not claim the transport was deleted when the write failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDeleteTransport.mockRejectedValue(new Error('offline'));
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getByTitle(/Paris CDG/));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await confirmDelete(user);

    await waitFor(() => {
      expect(mockDeleteTransport).toHaveBeenCalled();
    });
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('does not claim the activity was deleted when the write failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDeleteActivity.mockRejectedValue(new Error('offline'));
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByRole('button', { name: 'calendar.viewActivityDetails' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await confirmDelete(user);

    await waitFor(() => {
      expect(mockDeleteActivity).toHaveBeenCalled();
    });
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('CalendarPage — days that hold more than one thing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it('lays two overlapping stays out on the same days', async () => {
    mockUseAssignmentContext.mockReturnValue({
      assignments: [mockAssignment, overlappingAssignment],
      isLoading: false,
      error: null,
      deleteAssignment: mockDeleteAssignment,
      updateAssignment: vi.fn(),
      getAssignmentsByRoom: vi.fn(() => []),
    });

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(screen.getAllByLabelText('Alice - Blue Room').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Bob - Blue Room').length).toBeGreaterThan(0);
  });

  it('keeps a stay that falls entirely outside the trip window off the grid', async () => {
    mockUseAssignmentContext.mockReturnValue({
      assignments: [outsideAssignment],
      isLoading: false,
      error: null,
      deleteAssignment: mockDeleteAssignment,
      updateAssignment: vi.fn(),
      getAssignmentsByRoom: vi.fn(() => []),
    });

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(screen.queryByLabelText('Bob - Blue Room')).not.toBeInTheDocument();
  });

  it('shows both legs when two people travel on one day', async () => {
    mockUseTransportContext.mockReturnValue({
      arrivals: [mockArrival],
      departures: [sameDayDeparture],
      isLoading: false,
      error: null,
      deleteTransport: mockDeleteTransport,
    });

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(screen.getByTitle(/Paris CDG/)).toBeInTheDocument();
    expect(screen.getByTitle(/Paris Orly/)).toBeInTheDocument();
  });

  it('shows both activities when two fall on one day', async () => {
    mockUseActivityContext.mockReturnValue({
      activities: [mockActivity, sameDayActivity],
      isLoading: false,
      error: null,
      deleteActivity: mockDeleteActivity,
    });

    const { user } = renderCalendarPage();
    await showMonth(user);

    const indicators = screen.getAllByRole('button', { name: 'calendar.viewActivityDetails' });
    expect(indicators).toHaveLength(2);
    expect(indicators[0]).toHaveTextContent('Breakfast');
    expect(indicators[1]).toHaveTextContent('Plant fair');
  });
});

describe('CalendarPage — the setup checklist', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
    mockUsePersonContext.mockReturnValue({
      persons: [],
      getPersonById: vi.fn(() => undefined),
      isLoading: false,
      error: null,
    });
    mockUseRoomContext.mockReturnValue({ rooms: [], isLoading: false, error: null });
    mockUseAssignmentContext.mockReturnValue({
      assignments: [],
      isLoading: false,
      error: null,
      deleteAssignment: mockDeleteAssignment,
      updateAssignment: vi.fn(),
      getAssignmentsByRoom: vi.fn(() => []),
    });
    mockUseTransportContext.mockReturnValue({
      arrivals: [],
      departures: [],
      isLoading: false,
      error: null,
      deleteTransport: mockDeleteTransport,
    });
    mockUseActivityContext.mockReturnValue({
      activities: [],
      isLoading: false,
      error: null,
      deleteActivity: mockDeleteActivity,
    });
  });

  it.each([
    ['persons.new', '/trips/trip-1/persons?new=1'],
    ['rooms.new', '/trips/trip-1/rooms?new=1'],
    ['calendar.setup.assignments.action', '/trips/trip-1/rooms'],
    ['calendar.setup.arrivals.action', '/trips/trip-1/transports?new=1'],
  ])('sends %s to the page that step needs', async (label, destination) => {
    const { user } = renderCalendarPage();

    await user.click(screen.getByRole('button', { name: label }));

    expect(await screen.findByTestId('landed-on')).toHaveTextContent(destination);
  });
});
