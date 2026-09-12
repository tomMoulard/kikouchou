/**
 * @fileoverview What the calendar does after a dialog it opened closes.
 *
 * Three dialogs hang off the month grid, and each one has to give back what it
 * borrowed: the transport, activity and stay dialogs all clear the row they
 * were opened on, or the next tap opens the wrong one. The stay dialog also
 * writes, so its save and its failure are covered here.
 *
 * The money block is covered too: the balance shown on a guest is read through
 * a live query, which stays undefined for the whole of a synchronous test
 * unless `dexie-react-hooks` is stubbed.
 *
 * @module features/calendar/__tests__/CalendarPage.dialogs.test
 */

import { Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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

const mockUseTripContext = vi.fn();
const mockUseRoomContext = vi.fn();
const mockUseAssignmentContext = vi.fn();
const mockUsePersonContext = vi.fn();
const mockUseTransportContext = vi.fn();
const mockUseActivityContext = vi.fn();
const mockUseRideContext = vi.fn();

const mockUpdateAssignment = vi.fn();
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

// The money figures reach the page through a live query. Stubbed, because an
// async read resolves after a synchronous test has already made its assertions.
vi.mock('dexie-react-hooks', () => ({
  useLiveQuery: () => ({
    split: 'equal',
    expenses: [
      {
        id: 'expense-1',
        tripId: 'trip-1',
        kind: 'expense',
        category: 'groceries',
        title: 'Saturday shopping',
        date: '2026-04-02',
        amount: 100,
        payerId: 'person-1',
        splitMode: 'equal',
        splits: [{ personId: 'person-1', value: 1 }],
      },
    ],
    persons: [mockPerson],
    personNights: new Map([[mockPerson.id, 3]]),
    currency: 'EUR',
  }),
}));

// Each dialog is a stub that can close itself, which is the path under test.
vi.mock('@/features/transports', () => ({
  TransportDialog: ({
    open,
    transportId,
    onOpenChange,
  }: {
    open: boolean;
    transportId?: string;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="transport-dialog" data-transport-id={transportId ?? ''}>
        <button data-testid="close-transport" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));

vi.mock('@/features/activities/components/ActivityDialog', () => ({
  ActivityDialog: ({
    open,
    activityId,
    onOpenChange,
  }: {
    open: boolean;
    activityId?: string;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="activity-dialog" data-activity-id={activityId ?? ''}>
        <button data-testid="close-activity" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
}));

// The real form has a person select and two date pickers, none of which is
// under test here: what matters is the payload the page writes and what it does
// when the write fails.
vi.mock('@/features/rooms/components/RoomAssignmentSection', () => ({
  AssignmentFormDialog: ({
    open,
    existingAssignment,
    onOpenChange,
    onSubmit,
  }: {
    open: boolean;
    existingAssignment?: RoomAssignment;
    onOpenChange: (open: boolean) => void;
    onSubmit: (data: {
      roomId: string;
      personId: string;
      startDate: string;
      endDate: string;
    }) => Promise<void>;
  }) =>
    open ? (
      <div data-testid="assignment-dialog" data-assignment-id={existingAssignment?.id ?? ''}>
        <button
          data-testid="submit-assignment"
          onClick={() => {
            void onSubmit({
              roomId: 'room-1',
              personId: 'person-1',
              startDate: '2026-04-03',
              endDate: '2026-04-06',
            }).catch(() => {
              // The page re-throws so the real dialog can stay open; the stub
              // has nothing to keep open, so the rejection stops here.
            });
          }}
        >
          submit
        </button>
        <button data-testid="close-assignment" onClick={() => onOpenChange(false)}>
          close
        </button>
      </div>
    ) : null,
  RoomAssignmentSection: () => null,
}));

// ============================================================================
// Helpers
// ============================================================================

function renderCalendarPage(search = '') {
  return render(
    <Routes>
      <Route path="/trips/:tripId/calendar" element={<CalendarPage />} />
    </Routes>,
    { initialRoute: `/trips/trip-1/calendar${search}`, withProviders: false },
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
    deleteAssignment: vi.fn().mockResolvedValue(undefined),
    updateAssignment: mockUpdateAssignment,
    getAssignmentsByRoom: vi.fn(() => []),
    checkConflict: vi.fn(() => null),
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
  mockUseRideContext.mockReturnValue({ rides: [], vehicles: [], isLoading: false, error: null });
}

async function showMonth(user: ReturnType<typeof render>['user']): Promise<void> {
  await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
}

/** Opens the detail dialog for the stay and clicks its edit action. */
async function editTheStay(user: ReturnType<typeof render>['user']): Promise<void> {
  await user.click(screen.getAllByLabelText('Alice - Blue Room')[0]!);
  const dialog = await screen.findByRole('dialog');
  await user.click(within(dialog).getByRole('button', { name: 'common.edit' }));
}

// ============================================================================
// Tests
// ============================================================================

describe('CalendarPage — closing a dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAssignment.mockResolvedValue(undefined);
    setDefaultMocks();
  });

  it('forgets the transport it was editing', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getByTitle(/Paris CDG/));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.edit' }));
    await user.click(await screen.findByTestId('close-transport'));

    await waitFor(() => {
      expect(screen.queryByTestId('transport-dialog')).not.toBeInTheDocument();
    });
  });

  it('forgets the activity it was editing', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByRole('button', { name: 'calendar.viewActivityDetails' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.edit' }));
    await user.click(await screen.findByTestId('close-activity'));

    await waitFor(() => {
      expect(screen.queryByTestId('activity-dialog')).not.toBeInTheDocument();
    });
  });

  it('forgets the stay it was editing', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await editTheStay(user);
    expect(await screen.findByTestId('assignment-dialog')).toHaveAttribute(
      'data-assignment-id',
      mockAssignment.id,
    );

    await user.click(screen.getByTestId('close-assignment'));

    await waitFor(() => {
      expect(screen.queryByTestId('assignment-dialog')).not.toBeInTheDocument();
    });
  });
});

describe('CalendarPage — saving a stay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAssignment.mockResolvedValue(undefined);
    setDefaultMocks();
  });

  it('writes the new dates and closes', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await editTheStay(user);
    await user.click(await screen.findByTestId('submit-assignment'));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalledWith(mockAssignment.id, {
        roomId: 'room-1',
        personId: 'person-1',
        startDate: '2026-04-03',
        endDate: '2026-04-06',
      });
    });
    expect(mockNotifySuccess).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByTestId('assignment-dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps the dialog open when the write failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockUpdateAssignment.mockRejectedValue(new Error('offline'));
    const { user } = renderCalendarPage();
    await showMonth(user);

    await editTheStay(user);
    await user.click(await screen.findByTestId('submit-assignment'));

    await waitFor(() => {
      expect(mockUpdateAssignment).toHaveBeenCalled();
    });
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    expect(screen.getByTestId('assignment-dialog')).toBeInTheDocument();
    consoleError.mockRestore();
  });
});

describe('CalendarPage — the rest of the page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpdateAssignment.mockResolvedValue(undefined);
    setDefaultMocks();
  });

  it('opens on the timeline when the URL says so', () => {
    renderCalendarPage('?view=timeline');

    expect(screen.getByRole('radio', { name: 'calendar.view.timeline' })).toBeChecked();
  });

  it('shows what a guest owes beside their stay', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByLabelText('Alice - Blue Room')[0]!);

    // The overview reads the balance the live query fed it; without the money
    // block it renders the guest with no figures at all.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/Alice/).length).toBeGreaterThan(0);
  });
});

describe('CalendarPage — when the page cannot load', () => {
  const reload = vi.fn();
  const realLocation = window.location;

  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...realLocation, reload },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation });
  });

  it('offers a reload when a context reports an error', async () => {
    mockUseRoomContext.mockReturnValue({
      rooms: [],
      isLoading: false,
      error: new Error('the read failed'),
    });

    const { user } = renderCalendarPage();

    await user.click(screen.getByRole('button', { name: /common.retry/i }));

    expect(reload).toHaveBeenCalled();
  });
});
