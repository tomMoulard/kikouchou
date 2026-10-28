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

import { useSyncExternalStore } from 'react';
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { differenceInCalendarDays, parseISO } from 'date-fns';

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@/test/utils';
import type {
  Activity,
  Expense,
  Person,
  Room,
  RoomAssignment,
  Transport,
  Trip,
} from '@/types';

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

const mockActivityParticipation = vi.fn(() => ({
  myPersonId: undefined as Person['id'] | undefined,
  canToggle: false,
  toggleParticipation: vi.fn().mockResolvedValue(true),
}));

// Anonymous device by default: who can join an activity is its own suite.
vi.mock('@/features/activities/hooks/useActivityParticipation', () => ({
  useActivityParticipation: () => mockActivityParticipation(),
}));

vi.mock('@/hooks/useToday', () => ({ useToday: () => ({ today: new Date(2026, 3, 4) }) }));

// The suite-wide mock pins the language to English. This copy reads it from a
// variable, so a test can show the page to a French reader, or switch a reader
// to French while the page is open.
const i18nState = vi.hoisted(() => ({ language: 'en' }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (options && typeof options === 'object') {
        let result = key;
        for (const [name, value] of Object.entries(options)) {
          if (name !== 'count' && name !== 'context') {
            result = result.replace(`{{${name}}}`, String(value));
          }
        }
        return result;
      }
      return key;
    },
    i18n: {
      language: i18nState.language,
      changeLanguage: vi.fn().mockResolvedValue(undefined),
      exists: vi.fn().mockReturnValue(true),
    },
  }),
  Trans: ({ children }: { readonly children?: unknown }) => children,
  initReactI18next: { type: '3rdParty', init: vi.fn() },
}));

const mockCaptureEvent = vi.fn();
const mockCaptureDeletion = vi.fn();
const mockReportFailure = vi.fn();
const mockLoadTripMoney = vi.fn();

// The two analytics calls the page makes are asserted by event name; every
// other export stays real.
vi.mock('@/lib/posthog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/posthog')>()),
  captureEvent: (...args: unknown[]) => mockCaptureEvent(...args),
  captureDeletion: (...args: unknown[]) => mockCaptureDeletion(...args),
}));

vi.mock('@/lib/errors/report-failure', () => ({
  reportFailure: (...args: unknown[]) => mockReportFailure(...args),
}));

// The accounts reach the page through a real live query; only the read under it
// is stubbed, so a test can hand it a ledger without seeding four tables.
vi.mock('@/features/money/lib/trip-money', () => ({
  loadTripMoney: (...args: unknown[]) => mockLoadTripMoney(...args),
}));

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

describe('CalendarPage — joining an activity from the detail dialog', () => {
  const mockToggleParticipation = vi.fn().mockResolvedValue(true);

  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
    mockActivityParticipation.mockReturnValue({
      myPersonId: mockPerson2.id,
      canToggle: true,
      toggleParticipation: mockToggleParticipation,
    });
  });

  afterEach(() => {
    mockActivityParticipation.mockReturnValue({
      myPersonId: undefined,
      canToggle: false,
      toggleParticipation: vi.fn().mockResolvedValue(true),
    });
  });

  it('signs the guest holding the device up without opening the editor', async () => {
    const { user, rerender } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByRole('button', { name: 'calendar.viewActivityDetails' })[0]!);
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'activities.join' }));

    expect(mockToggleParticipation).toHaveBeenCalledWith(mockActivity.id, true);

    // The dialog reads the activity live, so the saved sign-up shows at once.
    mockUseActivityContext.mockReturnValue({
      activities: [{ ...mockActivity, participantIds: [mockPerson.id, mockPerson2.id] }],
      isLoading: false,
      error: null,
      deleteActivity: mockDeleteActivity,
    });
    rerender(
      <Routes>
        <Route path="/trips/:tripId/calendar" element={<CalendarPage />} />
        <Route path="*" element={<LandedOn />} />
      </Routes>,
    );

    const refreshed = await screen.findByRole('dialog');
    expect(within(refreshed).getByRole('button', { name: 'activities.leave' })).toBeInTheDocument();
    expect(within(refreshed).getByText('Bob')).toBeInTheDocument();
  });

  it('offers no join button to a device that does not know who it is', async () => {
    mockActivityParticipation.mockReturnValue({
      myPersonId: undefined,
      canToggle: false,
      toggleParticipation: mockToggleParticipation,
    });
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByRole('button', { name: 'calendar.viewActivityDetails' })[0]!);
    const dialog = await screen.findByRole('dialog');

    expect(within(dialog).queryByRole('button', { name: 'activities.join' })).not.toBeInTheDocument();
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

// ============================================================================
// Grid helpers
// ============================================================================

/** The Monday the April 2026 grid opens on. */
const APRIL_GRID_START = '2026-03-30';

/** The Monday the May 2026 grid opens on. */
const MAY_GRID_START = '2026-04-27';

/**
 * The month cell for one calendar day, found by its position in the grid.
 *
 * Both keys are read as local days, the way the page builds the grid, so the
 * lookup does not move with the machine's offset.
 */
function cellFor(dayKey: string, gridStart = APRIL_GRID_START): HTMLElement {
  const index = differenceInCalendarDays(parseISO(dayKey), parseISO(gridStart));
  const cell = screen.getAllByRole('gridcell')[index];
  if (!cell) {
    throw new Error(`No grid cell for ${dayKey}`);
  }
  return cell;
}

/**
 * What a cell draws under its activities and travel, top to bottom: a pill's
 * label, `·` for the empty spacer that keeps a lane aligned with the days
 * around it, or the overflow count.
 */
function stayRowsIn(cell: HTMLElement): string[] {
  const content = cell.children[1];
  if (!content) {
    return [];
  }
  return Array.from(content.children).map((element) => {
    if (element.getAttribute('aria-hidden') === 'true') {
      return '·';
    }
    return element.getAttribute('aria-label') ?? element.textContent ?? '';
  });
}

function guest(id: string, name: string, color = '#3b82f6'): Person {
  return {
    id: id as Person['id'],
    tripId: mockTrip.id,
    name,
    color: color as Person['color'],
  };
}

function stay(id: string, personId: string, startDate: string, endDate: string): RoomAssignment {
  return {
    id: id as RoomAssignment['id'],
    tripId: mockTrip.id,
    roomId: mockRoom.id,
    personId: personId as Person['id'],
    startDate: startDate as RoomAssignment['startDate'],
    endDate: endDate as RoomAssignment['endDate'],
  };
}

function leg(
  id: string,
  personId: string,
  type: Transport['type'],
  datetime: string,
  location: string,
): Transport {
  return {
    id: id as Transport['id'],
    tripId: mockTrip.id,
    personId: personId as Person['id'],
    type,
    datetime: datetime as Transport['datetime'],
    location,
    needsPickup: false,
    transportMode: 'train',
  };
}

function setPersons(persons: readonly Person[]): void {
  mockUsePersonContext.mockReturnValue({
    persons,
    getPersonById: vi.fn((id: string) => persons.find((person) => person.id === id)),
    isLoading: false,
    error: null,
  });
}

function setAssignments(assignments: readonly RoomAssignment[]): void {
  mockUseAssignmentContext.mockReturnValue({
    assignments,
    isLoading: false,
    error: null,
    deleteAssignment: mockDeleteAssignment,
    updateAssignment: vi.fn().mockResolvedValue(undefined),
    getAssignmentsByRoom: vi.fn(() => []),
    checkConflict: vi.fn(() => null),
  });
}

function setTransports(arrivals: readonly Transport[], departures: readonly Transport[]): void {
  mockUseTransportContext.mockReturnValue({
    arrivals,
    departures,
    isLoading: false,
    error: null,
    deleteTransport: mockDeleteTransport,
  });
}

function setActivities(activities: readonly Activity[]): void {
  mockUseActivityContext.mockReturnValue({
    activities,
    isLoading: false,
    error: null,
    deleteActivity: mockDeleteActivity,
  });
}

function setTrip(trip: Trip): void {
  mockUseTripContext.mockReturnValue({
    currentTrip: trip,
    isLoading: false,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
  });
}

/** The month the grid header names. */
function shownMonth(): string {
  const monthHeading = screen
    .getAllByRole('heading', { level: 2 })
    .find((heading) => /^\p{L}+ \d{4}$/u.test(heading.textContent ?? ''));
  return monthHeading?.textContent ?? '';
}

/**
 * Re-renders the page without navigating: a round trip through the timeline
 * changes the page's own state, so it reads its contexts again.
 */
async function rerenderThroughTimeline(user: ReturnType<typeof render>['user']): Promise<void> {
  await user.click(screen.getByRole('radio', { name: 'calendar.view.timeline' }));
  await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
}

const BLUE = 'Blue Room';

// ============================================================================
// Stays that share days
// ============================================================================

describe('CalendarPage: stays that share days', () => {
  const alice = guest('person-1', 'Alice');
  const bob = guest('person-2', 'Bob');
  const carol = guest('person-3', 'Carol');
  const dan = guest('person-4', 'Dan');
  const erin = guest('person-5', 'Erin');

  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
    setPersons([alice, bob, carol, dan, erin]);
    setTransports([mockArrival], []);
    setActivities([]);
  });

  it('gives each overlapping stay its own lane, the longer one on top', async () => {
    // Same first night: the longer stay takes the top lane whatever the input order.
    setAssignments([
      stay('short', bob.id, '2026-04-02', '2026-04-05'),
      stay('long', alice.id, '2026-04-02', '2026-04-08'),
    ]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(stayRowsIn(cellFor('2026-04-03'))).toEqual([`Alice - ${BLUE}`, `Bob - ${BLUE}`]);
    expect(stayRowsIn(cellFor('2026-04-06'))).toEqual([`Alice - ${BLUE}`]);
  });

  it('puts the stay that starts first on top, and keeps its lane free after it ends', async () => {
    setAssignments([
      stay('later', bob.id, '2026-04-04', '2026-04-08'),
      stay('earlier', alice.id, '2026-04-02', '2026-04-05'),
    ]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(stayRowsIn(cellFor('2026-04-02'))).toEqual([`Alice - ${BLUE}`]);
    expect(stayRowsIn(cellFor('2026-04-04'))).toEqual([`Alice - ${BLUE}`, `Bob - ${BLUE}`]);
    expect(stayRowsIn(cellFor('2026-04-06'))).toEqual(['·', `Bob - ${BLUE}`]);
  });

  it('gives three stays on the same nights three lanes', async () => {
    setAssignments([
      stay('a', alice.id, '2026-04-02', '2026-04-05'),
      stay('b', bob.id, '2026-04-02', '2026-04-05'),
      stay('c', carol.id, '2026-04-02', '2026-04-05'),
    ]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(stayRowsIn(cellFor('2026-04-03'))).toEqual([
      `Alice - ${BLUE}`,
      `Bob - ${BLUE}`,
      `Carol - ${BLUE}`,
    ]);
  });

  it('shows the low lanes of a day before counting what overflows', async () => {
    // Alice, Bob and Carol fill lanes 0-2 on the 2nd and 3rd, so Dan, who
    // arrives on the 3rd, lands in lane 3. Erin arrives on the 4th, when lane
    // 0 is free again. On the 4th Dan's pill is built before Erin's, and the
    // day still has to draw Erin and fold Dan into the overflow count.
    setAssignments([
      stay('a', alice.id, '2026-04-02', '2026-04-04'),
      stay('b', bob.id, '2026-04-02', '2026-04-04'),
      stay('c', carol.id, '2026-04-02', '2026-04-04'),
      stay('d', dan.id, '2026-04-03', '2026-04-09'),
      stay('e', erin.id, '2026-04-04', '2026-04-06'),
    ]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    const rows = stayRowsIn(cellFor('2026-04-04'));
    expect(rows[0]).toBe(`Erin - ${BLUE}`);
    expect(rows).toContain('+1calendar.moreItemsHidden');
  });

  it('stops looking for a free lane after a hundred and warns in development', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const crowd = Array.from({ length: 102 }, (_, index) =>
      stay(
        `crowd-${index}`,
        index === 0 ? alice.id : index === 101 ? bob.id : `nobody-${index}`,
        '2026-04-02',
        '2026-04-04',
      ),
    );
    setAssignments(crowd);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(warn).toHaveBeenCalledWith('Slot allocation exceeded limit for span:', 'crowd-101');
    // The 101st stay still found lane 100 free: only the 102nd ran out.
    expect(warn.mock.calls.map((call) => call[1])).not.toContain('crowd-100');
    // The 102nd stay was forced into a lane of its own, not onto Alice's.
    expect(stayRowsIn(cellFor('2026-04-02'))[0]).toBe(`Alice - ${BLUE}`);
    warn.mockRestore();
  });

  it('runs out of lanes quietly in a production build', async () => {
    vi.stubEnv('DEV', false);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    setAssignments(
      Array.from({ length: 102 }, (_, index) =>
        stay(`crowd-${index}`, `nobody-${index}`, '2026-04-02', '2026-04-04'),
      ),
    );

    try {
      const { user } = renderCalendarPage();
      await showMonth(user);

      expect(
        warn.mock.calls.filter((call) => call[0] === 'Slot allocation exceeded limit for span:'),
      ).toEqual([]);
    } finally {
      warn.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('ranks the readable stays the same whatever unreadable stay sits between them', async () => {
    // The middle stay's first night cannot be read. It must be dropped before
    // the stays are ranked, or it scrambles the order of the two around it.
    setAssignments([
      stay('later', bob.id, '2026-04-04', '2026-04-08'),
      stay('unreadable', carol.id, '2026-04-3x', '2026-04-06'),
      stay('earlier', alice.id, '2026-04-02', '2026-04-05'),
    ]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(stayRowsIn(cellFor('2026-04-02'))).toEqual([`Alice - ${BLUE}`]);
    expect(stayRowsIn(cellFor('2026-04-04'))).toEqual([`Alice - ${BLUE}`, `Bob - ${BLUE}`]);
  });

  it('draws a stay that starts on the last day of the grid', async () => {
    setTrip({ ...mockTrip, endDate: '2026-05-20' as Trip['endDate'] });
    setAssignments([stay('late', alice.id, '2026-05-03', '2026-05-06')]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(stayRowsIn(cellFor('2026-05-03'))).toEqual([`Alice - ${BLUE}`]);
  });

  it.each([
    ['a first night in the compact ISO form', '20260402', '2026-04-05'],
    ['a check-out with a signed year', '2026-04-02', '+002026-04-05'],
  ])('leaves off the grid a stay written with %s', async (_, startDate, endDate) => {
    // Both forms parse as April dates, but neither sorts as a day key between
    // the grid's first and last day, which is the test the grid applies.
    setAssignments([
      stay('odd', alice.id, startDate, endDate),
      stay('plain', bob.id, '2026-04-02', '2026-04-05'),
    ]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(screen.queryByLabelText(`Alice - ${BLUE}`)).not.toBeInTheDocument();
    // The grid itself is drawn: the plain stay next to it is.
    expect(stayRowsIn(cellFor('2026-04-02'))).toEqual([`Bob - ${BLUE}`]);
  });

  it('draws a one-night stay as a single rounded pill with its label', async () => {
    // The 1st is a Wednesday, so no week edge rounds the pill for it.
    setAssignments([stay('one', alice.id, '2026-04-01', '2026-04-02')]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    const pill = within(cellFor('2026-04-01')).getByRole('button', {
      name: `Alice - ${BLUE}`,
    });
    expect(pill).toHaveTextContent(`Alice - ${BLUE}`);
    expect(pill).toHaveClass('rounded');
    expect(pill).not.toHaveClass('rounded-l');
    expect(within(cellFor('2026-04-02')).queryByRole('button', { name: `Alice - ${BLUE}` }))
      .not.toBeInTheDocument();
  });

  it('closes a stay at the Sunday edge of the week and reopens it on Monday', async () => {
    // Friday the 3rd to check-out on Wednesday the 8th; the 5th is a Sunday.
    setAssignments([stay('week', alice.id, '2026-04-03', '2026-04-08')]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    const pillOn = (dayKey: string) =>
      within(cellFor(dayKey)).getByRole('button', { name: `Alice - ${BLUE}` });

    expect(pillOn('2026-04-04')).toHaveClass('rounded-none', '-mr-px');
    expect(pillOn('2026-04-05')).toHaveClass('rounded-r');
    expect(pillOn('2026-04-05')).not.toHaveClass('-mr-px');
    expect(pillOn('2026-04-06')).toHaveClass('rounded-l');
    expect(pillOn('2026-04-06')).toHaveTextContent(`Alice - ${BLUE}`);
    // The first and last nights are ends of the bar, not bars of their own.
    expect(pillOn('2026-04-03')).toHaveClass('rounded-l');
    expect(pillOn('2026-04-03')).not.toHaveClass('rounded');
    expect(pillOn('2026-04-07')).toHaveClass('rounded-r');
    expect(pillOn('2026-04-07')).not.toHaveClass('rounded');
  });

  it('does not clamp a stay to a trip whose end cannot be read', async () => {
    setTrip({ ...mockTrip, endDate: 'not a date' as Trip['endDate'] });
    setAssignments([stay('early', alice.id, '2026-03-30', '2026-04-03')]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(
      within(cellFor('2026-03-30')).getByRole('button', { name: `Alice - ${BLUE}` }),
    ).toBeInTheDocument();
  });

  it('starts a stay on the first day of the trip when it was booked earlier', async () => {
    setAssignments([stay('early', alice.id, '2026-03-30', '2026-04-03')]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    const pillsOn = (dayKey: string) =>
      within(cellFor(dayKey)).queryAllByRole('button', { name: `Alice - ${BLUE}` });
    expect(pillsOn('2026-03-30')).toHaveLength(0);
    expect(pillsOn('2026-03-31')).toHaveLength(0);
    expect(pillsOn('2026-04-01')).toHaveLength(1);
  });

  describe('on a trip longer than the grid', () => {
    const longTrip: Trip = {
      ...mockTrip,
      startDate: '2026-04-01' as Trip['startDate'],
      endDate: '2026-05-20' as Trip['endDate'],
    };

    it('ranks stays by the nights the grid shows, not the ones before it', async () => {
      setTrip(longTrip);
      // On the May grid both start on its first day, the 27th, and Bob shows
      // more nights there; Alice's week before the grid must not count.
      setAssignments([
        stay('alice', alice.id, '2026-04-20', '2026-04-29'),
        stay('bob', bob.id, '2026-04-25', '2026-05-03'),
      ]);

      const { user } = renderCalendarPage();
      await showMonth(user);
      await user.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));

      expect(stayRowsIn(cellFor('2026-04-27', MAY_GRID_START))).toEqual([
        `Bob - ${BLUE}`,
        `Alice - ${BLUE}`,
      ]);
    });

    it('ranks stays by the nights the grid shows, not the ones after it', async () => {
      setTrip(longTrip);
      // Both run to the grid's last day, the 3rd of May; Alice goes on for a
      // week after it. Seen on the grid they are the same length, so they
      // keep the order they came in.
      setAssignments([
        stay('bob', bob.id, '2026-04-28', '2026-05-04'),
        stay('alice', alice.id, '2026-04-28', '2026-05-10'),
      ]);

      const { user } = renderCalendarPage();
      await showMonth(user);

      expect(stayRowsIn(cellFor('2026-04-28'))).toEqual([`Bob - ${BLUE}`, `Alice - ${BLUE}`]);
    });
  });
});

// ============================================================================
// Travel and activities on the grid
// ============================================================================

describe('CalendarPage: travel and activities on the grid', () => {
  const alice = guest('person-1', 'Alice', '#abc');
  const bob = guest('person-2', 'Bob', '#ab');
  const carol = guest('person-3', 'Carol', '#abc');

  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
    setPersons([alice, bob, carol]);
    setAssignments([]);
    setActivities([]);
  });

  /** The colour dot a travel pill carries for its guest. */
  function dotOf(pill: HTMLElement): Element | null {
    return pill.querySelector('.rounded-full');
  }

  it('shows a leg on the first and on the last day of the grid', async () => {
    setTransports(
      [
        leg('first', alice.id, 'arrival', '2026-03-30T10:00:00', 'Grid start'),
        leg('first-out', alice.id, 'arrival', '2026-05-03T09:00:00', 'Late arrival'),
      ],
      [
        leg('last', bob.id, 'departure', '2026-05-03T10:00:00', 'Grid end'),
        leg('last-in', bob.id, 'departure', '2026-03-30T09:00:00', 'Early departure'),
      ],
    );

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(within(cellFor('2026-03-30')).getByTitle(/Grid start/)).toBeInTheDocument();
    expect(within(cellFor('2026-03-30')).getByTitle(/Early departure/)).toBeInTheDocument();
    expect(within(cellFor('2026-05-03')).getByTitle(/Grid end/)).toBeInTheDocument();
    expect(within(cellFor('2026-05-03')).getByTitle(/Late arrival/)).toBeInTheDocument();
  });

  it('shows every arrival of a day', async () => {
    setTransports(
      [
        leg('one', alice.id, 'arrival', '2026-04-02T10:00:00', 'Lyon'),
        leg('two', carol.id, 'arrival', '2026-04-02T12:00:00', 'Nantes'),
      ],
      [],
    );

    const { user } = renderCalendarPage();
    await showMonth(user);

    const day = within(cellFor('2026-04-02'));
    expect(day.getByTitle(/Lyon/)).toBeInTheDocument();
    expect(day.getByTitle(/Nantes/)).toBeInTheDocument();
  });

  it('paints each leg in its guest colour, and grey when there is no usable one', async () => {
    setTransports(
      [leg('arr', alice.id, 'arrival', '2026-04-02T10:00:00', 'Shorthand arrival')],
      [
        leg('short', bob.id, 'departure', '2026-04-06T10:00:00', 'Too short'),
        leg('shorthand', carol.id, 'departure', '2026-04-07T10:00:00', 'Shorthand departure'),
        leg('nobody', 'person-gone', 'departure', '2026-04-08T10:00:00', 'Nobody'),
      ],
    );

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(dotOf(screen.getByTitle(/Shorthand arrival/))).toHaveStyle({ backgroundColor: '#abc' });
    expect(dotOf(screen.getByTitle(/Too short/))).toHaveStyle({ backgroundColor: '#6b7280' });
    expect(dotOf(screen.getByTitle(/Shorthand departure/))).toHaveStyle({
      backgroundColor: '#abc',
    });
    const nobody = screen.getByTitle(/Nobody/);
    expect(nobody).toHaveTextContent('common.unknown');
    expect(dotOf(nobody)).toHaveStyle({ backgroundColor: '#6b7280' });
  });

  it.each([
    ['an arrival before the grid', 'arrival', '2026-03-01T10:00:00'],
    ['an arrival after the grid', 'arrival', '2026-05-20T10:00:00'],
    ['an arrival with no readable date', 'arrival', 'not a date'],
    ['a departure before the grid', 'departure', '2026-03-01T10:00:00'],
    ['a departure after the grid', 'departure', '2026-05-20T10:00:00'],
    ['a departure with no readable date', 'departure', 'not a date'],
  ] as const)('calls a month empty when its only travel is %s', async (_, type, datetime) => {
    const away = leg('away', alice.id, type, datetime, 'Elsewhere');
    setTransports(type === 'arrival' ? [away] : [], type === 'departure' ? [away] : []);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(screen.getByText('calendar.noAssignmentsTitle')).toBeInTheDocument();
    expect(screen.queryByTitle(/Elsewhere/)).not.toBeInTheDocument();
  });

  it('offers guests and rooms from an empty month', async () => {
    setTransports([leg('away', alice.id, 'arrival', '2026-05-20T10:00:00', 'Elsewhere')], []);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(screen.getByRole('button', { name: 'calendar.addRooms' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'calendar.addGuests' }));

    expect(await screen.findByTestId('landed-on')).toHaveTextContent(
      '/trips/trip-1/persons?new=1',
    );
  });

  it('sends the empty month to the room form', async () => {
    setTransports([leg('away', alice.id, 'arrival', '2026-05-20T10:00:00', 'Elsewhere')], []);

    const { user } = renderCalendarPage();
    await showMonth(user);
    await user.click(screen.getByRole('button', { name: 'calendar.addRooms' }));

    expect(await screen.findByTestId('landed-on')).toHaveTextContent('/trips/trip-1/rooms?new=1');
  });

  it('leaves the empty state to the month view', () => {
    setTransports([leg('away', alice.id, 'arrival', '2026-05-20T10:00:00', 'Elsewhere')], []);

    renderCalendarPage();

    expect(screen.getByRole('radio', { name: 'calendar.view.timeline' })).toBeChecked();
    expect(screen.queryByText('calendar.noAssignmentsTitle')).not.toBeInTheDocument();
  });

  it.each([
    ['a stay', 'stay'],
    ['a leg', 'leg'],
    ['an activity', 'activity'],
  ] as const)('does not call a month empty when it holds only %s', async (_, kind) => {
    const away = leg('away', alice.id, 'arrival', '2026-05-20T10:00:00', 'Elsewhere');
    setTransports(
      kind === 'leg' ? [leg('here', alice.id, 'arrival', '2026-04-02T10:00:00', 'Here')] : [away],
      [],
    );
    setAssignments(kind === 'stay' ? [stay('here', alice.id, '2026-04-02', '2026-04-04')] : []);
    setActivities(kind === 'activity' ? [mockActivity] : []);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(screen.queryByText('calendar.noAssignmentsTitle')).not.toBeInTheDocument();
  });

  it('repeats a multi-day activity on every day it covers, titled on the first', async () => {
    setTransports([mockArrival], []);
    setActivities([
      {
        ...mockActivity,
        allDay: true,
        startDatetime: '2026-04-03T09:00:00',
        endDatetime: '2026-04-05T17:00:00',
      },
    ]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    const pillOn = (dayKey: string) =>
      within(cellFor(dayKey)).getByRole('button', { name: 'calendar.viewActivityDetails' });

    expect(pillOn('2026-04-03')).toHaveTextContent('Plant fair');
    expect(pillOn('2026-04-03')).toHaveClass('rounded-l', 'rounded-r-none');
    expect(pillOn('2026-04-04')).toHaveTextContent('↔');
    expect(pillOn('2026-04-04')).not.toHaveTextContent('Plant fair');
    expect(pillOn('2026-04-04')).toHaveClass('rounded-l-none', 'rounded-r-none');
    expect(pillOn('2026-04-05')).toHaveTextContent('↔');
    expect(pillOn('2026-04-05')).toHaveClass('rounded-l-none', 'rounded-r');
    expect(
      within(cellFor('2026-04-06')).queryByRole('button', { name: 'calendar.viewActivityDetails' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['first', '2026-03-30'],
    ['last', '2026-05-03'],
  ])('shows an activity held on the %s day of the grid', async (_, day) => {
    setTransports([mockArrival], []);
    setActivities([
      { ...mockActivity, allDay: true, startDatetime: `${day}T09:00:00`, endDatetime: `${day}T11:00:00` },
    ]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(
      within(cellFor(day)).getByRole('button', { name: 'calendar.viewActivityDetails' }),
    ).toBeInTheDocument();
  });

  it('leaves an activity off the grid when its start cannot be read', async () => {
    setTransports([mockArrival], []);
    setActivities([
      {
        ...mockActivity,
        allDay: true,
        startDatetime: 'not a date',
        endDatetime: '2026-04-05T17:00:00',
      },
    ]);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(
      screen.queryByRole('button', { name: 'calendar.viewActivityDetails' }),
    ).not.toBeInTheDocument();
  });

  it('counts a guest with no dates of their own on every day of the trip', async () => {
    setPersons([guest('person-9', 'Zoé')]);
    setTransports([], []);

    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(within(cellFor('2026-04-05')).getByTestId('day-headcount-2026-04-05')).toHaveTextContent(
      '1',
    );
  });
});

// ============================================================================
// Moving around the grid
// ============================================================================

describe('CalendarPage: moving around the grid', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    i18nState.language = 'en';
  });

  it('names the month in the language the page is read in', async () => {
    i18nState.language = 'fr';
    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(shownMonth()).toBe('avril 2026');
  });

  it('renames the month when the reader switches language', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);
    expect(shownMonth()).toBe('April 2026');

    i18nState.language = 'fr';
    await rerenderThroughTimeline(user);

    expect(shownMonth()).toBe('avril 2026');
  });

  /** Every cell that is in the tab order, by its position in the grid. */
  function tabStops(): number[] {
    return screen
      .getAllByRole('gridcell')
      .flatMap((cell, index) => (cell.tabIndex === 0 ? [index] : []));
  }

  it('lays the month out in whole weeks', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    const body = screen.getAllByRole('rowgroup')[1]!;
    expect(within(body).getAllByRole('row')).toHaveLength(5);
    expect(screen.getAllByRole('gridcell')).toHaveLength(35);
  });

  it('puts the one tab stop on today', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(cellFor('2026-04-04')).toHaveAttribute('tabindex', '0');
    expect(cellFor('2026-04-05')).toHaveAttribute('tabindex', '-1');
    expect(tabStops()).toEqual([5]);
  });

  it('moves the tab stop to the first of the month on a month without today', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);
    await user.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));

    expect(shownMonth()).toBe('May 2026');
    expect(cellFor('2026-05-01', MAY_GRID_START)).toHaveAttribute('tabindex', '0');
    expect(tabStops()).toEqual([4]);
  });

  it('goes back a month and forward again', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);
    expect(shownMonth()).toBe('April 2026');

    await user.click(screen.getByRole('button', { name: 'calendar.previousMonth' }));
    expect(shownMonth()).toBe('March 2026');

    await user.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));
    await user.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));
    expect(shownMonth()).toBe('May 2026');
  });

  it('brings the grid back to the month the clock is in', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 15, 12));

    const { user } = renderCalendarPage();
    await showMonth(user);
    await user.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));
    await user.click(screen.getAllByRole('button', { name: 'calendar.today' })[0]!);

    expect(shownMonth()).toBe('September 2026');
  });

  it('keeps the month the user moved to when the trip dates change', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);
    await user.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));

    setTrip({
      ...mockTrip,
      startDate: '2026-07-01' as Trip['startDate'],
      endDate: '2026-07-10' as Trip['endDate'],
    });
    await rerenderThroughTimeline(user);
    // The page moves the grid on a 0 ms timer; this waits well past it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(shownMonth()).toBe('May 2026');
  });

  it('keeps a month the user went back to when the trip dates change', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);
    await user.click(screen.getByRole('button', { name: 'calendar.previousMonth' }));

    setTrip({
      ...mockTrip,
      startDate: '2026-07-01' as Trip['startDate'],
      endDate: '2026-07-10' as Trip['endDate'],
    });
    await rerenderThroughTimeline(user);
    // The page moves the grid on a 0 ms timer; this waits well past it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(shownMonth()).toBe('March 2026');
  });

  it('keeps the month the clock is in once the user asked for it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 15, 12));
    const { user } = renderCalendarPage();
    await showMonth(user);
    await user.click(screen.getAllByRole('button', { name: 'calendar.today' })[0]!);

    setTrip({
      ...mockTrip,
      startDate: '2026-07-01' as Trip['startDate'],
      endDate: '2026-07-10' as Trip['endDate'],
    });
    await rerenderThroughTimeline(user);
    // The page moves the grid on a 0 ms timer; this waits well past it.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    expect(shownMonth()).toBe('September 2026');
  });

  it('follows the trip to its new month when nobody has moved the grid', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);
    expect(shownMonth()).toBe('April 2026');

    setTrip({
      ...mockTrip,
      startDate: '2026-07-01' as Trip['startDate'],
      endDate: '2026-07-10' as Trip['endDate'],
    });
    await rerenderThroughTimeline(user);

    await waitFor(() => {
      expect(shownMonth()).toBe('July 2026');
    });
  });

  it('jumps a whole week down and stops on the last cell', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    const cells = screen.getAllByRole('gridcell');
    act(() => {
      cells[28]!.focus();
    });
    await user.keyboard('{ArrowDown}');

    expect(cells[34]).toHaveFocus();
  });

  it('moves focus to the last cell when a key reaches it from elsewhere', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    const cells = screen.getAllByRole('gridcell');
    act(() => {
      cells[5]!.focus();
    });
    fireEvent.keyDown(cells[34]!, { key: 'ArrowRight' });

    expect(cells[34]).toHaveFocus();
  });

  it('claims the arrow keys and leaves every other key alone', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    const day = cellFor('2026-04-04');
    expect(fireEvent.keyDown(day, { key: 'ArrowRight' })).toBe(false);
    expect(fireEvent.keyDown(day, { key: 'a' })).toBe(true);
  });

  it('keeps every week row distinct when the month changes', async () => {
    const consoleError = vi.spyOn(console, 'error');
    const { user } = renderCalendarPage();
    await showMonth(user);
    await user.click(screen.getByRole('button', { name: 'calendar.nextMonth' }));

    const duplicateKeys = consoleError.mock.calls.filter((call) =>
      String(call[0]).includes('same key'),
    );
    expect(duplicateKeys).toEqual([]);
    expect(screen.getAllByRole('gridcell')).toHaveLength(35);
    consoleError.mockRestore();
  });
});

// ============================================================================
// What the page reports, and the dialogs it opens
// ============================================================================

describe('CalendarPage: what the page reports', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteAssignment.mockResolvedValue(undefined);
    mockDeleteTransport.mockResolvedValue(undefined);
    mockDeleteActivity.mockResolvedValue(undefined);
    setDefaultMocks();
  });

  /** Opens the first pill matching `open` and confirms the delete it offers. */
  async function deleteFrom(
    user: ReturnType<typeof render>['user'],
    open: () => HTMLElement,
  ): Promise<void> {
    await showMonth(user);
    await user.click(open());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.delete' }));
    await confirmDelete(user);
  }

  const openStay = () => screen.getAllByLabelText('Alice - Blue Room')[0]!;
  const openLeg = () => screen.getByTitle(/Paris CDG/);
  const openActivity = () =>
    screen.getAllByRole('button', { name: 'calendar.viewActivityDetails' })[0]!;

  it('opens on the timeline when the URL names no view', () => {
    renderCalendarPage();

    expect(screen.getByRole('radio', { name: 'calendar.view.timeline' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'calendar.view.month' })).not.toBeChecked();
  });

  it('reports each switch between the month and the timeline', async () => {
    const { user } = renderCalendarPage();

    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    expect(screen.getByRole('radio', { name: 'calendar.view.month' })).toBeChecked();
    expect(mockCaptureEvent).toHaveBeenLastCalledWith('calendar_view_changed', { view: 'card' });

    await user.click(screen.getByRole('radio', { name: 'calendar.view.timeline' }));
    expect(screen.getByRole('radio', { name: 'calendar.view.timeline' })).toBeChecked();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
    expect(mockCaptureEvent).toHaveBeenLastCalledWith('calendar_view_changed', {
      view: 'timeline',
    });
  });

  it('reports and confirms a deleted stay', async () => {
    const { user } = renderCalendarPage();
    await deleteFrom(user, openStay);

    await waitFor(() => {
      expect(mockCaptureDeletion).toHaveBeenCalledWith('assignment_deleted', {
        source: 'calendar',
      });
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('assignments.deleteSuccess');
  });

  it('reports and confirms a deleted leg', async () => {
    const { user } = renderCalendarPage();
    await deleteFrom(user, openLeg);

    await waitFor(() => {
      expect(mockCaptureDeletion).toHaveBeenCalledWith('transport_deleted', {
        source: 'calendar',
        type: 'arrival',
      });
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('calendar.transportDeleted');
  });

  it('reports and confirms a deleted activity', async () => {
    const { user } = renderCalendarPage();
    await deleteFrom(user, openActivity);

    await waitFor(() => {
      expect(mockCaptureDeletion).toHaveBeenCalledWith('activity_deleted', {
        source: 'calendar',
      });
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('activities.deleteSuccess');
  });

  it.each([
    ['stay', 'CalendarPage.deleteAssignment', openStay, mockDeleteAssignment],
    ['leg', 'CalendarPage.deleteTransport', openLeg, mockDeleteTransport],
    ['activity', 'CalendarPage.deleteActivity', openActivity, mockDeleteActivity],
  ] as const)('names the failed %s delete to the error reporter', async (_, where, open, del) => {
    const failure = new Error('offline');
    del.mockRejectedValue(failure);
    const { user } = renderCalendarPage();
    await deleteFrom(user, open);

    await waitFor(() => {
      expect(mockReportFailure).toHaveBeenCalledWith(where, failure, 'errors.deleteFailed');
    });
    expect(mockCaptureDeletion).not.toHaveBeenCalled();
  });

  it.each([
    ['leg', openLeg, 'transport-dialog'],
    ['activity', openActivity, 'activity-dialog'],
  ] as const)('closes the details of a %s when its editor opens', async (_, open, editor) => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(open());
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'common.edit' }));

    expect(await screen.findByTestId(editor)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('opens no editor before anything is tapped', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    expect(screen.queryByTestId('transport-dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('activity-dialog')).not.toBeInTheDocument();
  });

  it('lists nobody for an activity that carries no participant list', async () => {
    // A guest whose id is any placeholder must not stand in for the missing list.
    setPersons([mockPerson, { ...mockPerson2, id: 'Stryker was here' as Person['id'], name: 'Ghost' }]);
    setActivities([{ ...mockActivity, participantIds: undefined } as unknown as Activity]);
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(openActivity());

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('Ghost')).not.toBeInTheDocument();
  });

  it('lists the guests who signed up for an activity', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(openActivity());

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Alice')).toBeInTheDocument();
  });

  it('lists the travel a timeline stay carries in its details', async () => {
    // Alice lands on the first night of her stay, so the timeline folds the
    // arrival into the stay pill and hands both to the details.
    setAssignments([stay('with-leg', mockPerson.id, '2026-04-02', '2026-04-05')]);
    setTransports([leg('in', mockPerson.id, 'arrival', '2026-04-02T10:00:00', 'Lyon')], []);
    const { user } = renderCalendarPage();

    await user.click(screen.getByRole('button', { name: /calendar\.timeline\.assignmentBarAria/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('calendar.relatedTravel')).toBeInTheDocument();
  });

  it('describes the guest behind a stay', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(openStay());

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('calendar.guestOverview.title')).toBeInTheDocument();
    expect(within(dialog).getByText('calendar.guestOverview.noMoney')).toBeInTheDocument();
  });

  it('opens a stay whose guest is gone without describing anybody', async () => {
    setAssignments([stay('orphan', 'person-gone', '2026-04-02', '2026-04-04')]);
    const { user } = renderCalendarPage();
    await showMonth(user);

    await user.click(screen.getAllByLabelText('common.unknown - Blue Room')[0]!);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByText('calendar.guestOverview.title')).not.toBeInTheDocument();
  });

  it('says what the group owes a guest once the accounts have loaded', async () => {
    const expense = {
      id: 'expense-1',
      tripId: mockTrip.id,
      kind: 'expense',
      category: 'groceries',
      title: 'Saturday shopping',
      date: '2026-04-02',
      amount: 100,
      payerId: mockPerson.id,
      splitMode: 'equal',
      splits: [
        { personId: mockPerson.id, value: 1 },
        { personId: mockPerson2.id, value: 1 },
      ],
    } as unknown as Expense;
    mockLoadTripMoney.mockResolvedValue({
      expenses: [expense],
      personNights: new Map(),
      currency: 'EUR',
    });

    const { user } = renderCalendarPage();
    await showMonth(user);
    await waitFor(() => {
      expect(mockLoadTripMoney).toHaveBeenCalledWith(mockTrip.id);
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));

    await user.click(openStay());

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/calendar\.guestOverview\.isOwed/)).toBeInTheDocument();
  });
});

// ============================================================================
// How wide the page is
// ============================================================================

describe('CalendarPage: page width', () => {
  const longTrip: Trip = {
    ...mockTrip,
    startDate: '2026-04-01' as Trip['startDate'],
    endDate: '2026-05-20' as Trip['endDate'],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it('keeps the month view at reading width, even for a long trip', async () => {
    setTrip(longTrip);
    const { container, user } = renderCalendarPage();
    await showMonth(user);

    const page = container.firstElementChild;
    expect(page).toHaveClass('container', 'max-w-6xl', 'py-6');
    expect(page).not.toHaveClass('w-full');
  });

  it('keeps a short trip timeline at reading width', () => {
    const { container } = renderCalendarPage();

    expect(container.firstElementChild).toHaveClass('container', 'max-w-6xl');
  });

  it('gives a trip too long to show at once the whole page', () => {
    setTrip(longTrip);
    const { container } = renderCalendarPage();

    const page = container.firstElementChild;
    expect(page).toHaveClass('w-full', 'py-6');
    expect(page).not.toHaveClass('container');
  });

  it('widens the timeline when the trip grows longer while it is open', async () => {
    const { container, user } = renderCalendarPage();
    expect(container.firstElementChild).not.toHaveClass('w-full');

    setTrip(longTrip);
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    await user.click(screen.getByRole('radio', { name: 'calendar.view.timeline' }));

    expect(container.firstElementChild).toHaveClass('w-full');
  });
});

// ============================================================================
// Data that changes while the page is open
// ============================================================================

describe('CalendarPage: data that changes while the page is open', () => {
  const ride = {
    id: 'ride-1',
    tripId: mockTrip.id,
    direction: 'pickup',
    // Offset-less, like the leg it serves, so the two stay 15 minutes apart in
    // every timezone.
    meetDatetime: '2026-04-01T13:45:00',
    location: 'Paris CDG',
    driverId: mockPerson2.id,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it('draws a renamed room on the grid and in the stay it opens', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    mockUseRoomContext.mockReturnValue({
      rooms: [{ ...mockRoom, name: 'Green Room' }],
      isLoading: false,
      error: null,
    });
    await rerenderThroughTimeline(user);

    expect(screen.getAllByLabelText('Alice - Green Room').length).toBeGreaterThan(0);
    await user.click(screen.getAllByLabelText('Alice - Green Room')[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getAllByText(/Green Room/).length).toBeGreaterThan(0);
  });

  it('names a renamed guest in the activity they signed up for', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);

    setPersons([{ ...mockPerson, name: 'Alicia' }, mockPerson2]);
    await rerenderThroughTimeline(user);

    await user.click(screen.getAllByRole('button', { name: 'calendar.viewActivityDetails' })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Alicia')).toBeInTheDocument();
  });

  it('moves the trip edges with the trip dates', async () => {
    const { user } = renderCalendarPage();
    await showMonth(user);
    expect(document.getElementById('2026-04-15-summary')).toHaveTextContent(
      'calendar.outsideTripDates',
    );

    setTrip({ ...mockTrip, endDate: '2026-04-20' as Trip['endDate'] });
    await rerenderThroughTimeline(user);

    expect(cellFor('2026-04-15')).not.toHaveTextContent('calendar.outsideTripDates');
  });

  it('ticks a setup step as soon as it is done', async () => {
    setPersons([]);
    setAssignments([]);
    setTransports([], []);
    setActivities([]);
    mockUseRoomContext.mockReturnValue({ rooms: [], isLoading: false, error: null });
    const { user } = renderCalendarPage();
    await showMonth(user);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');

    mockUseRoomContext.mockReturnValue({ rooms: [mockRoom], isLoading: false, error: null });
    await rerenderThroughTimeline(user);

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  it('shows a car on a leg as soon as the ride is arranged', async () => {
    setTransports([{ ...mockArrival, rideId: ride.id as Transport['rideId'] }], []);
    const { user } = renderCalendarPage();
    expect(screen.queryByTitle('Paris CDG · rides.partOfRideWithDriver')).not.toBeInTheDocument();

    mockUseRideContext.mockReturnValue({
      rides: [ride],
      vehicles: [],
      isLoading: false,
      error: null,
    });
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    await user.click(screen.getByRole('radio', { name: 'calendar.view.timeline' }));

    // The timeline asks the page for the car on each leg it draws.
    expect(screen.getByTitle('Paris CDG · rides.partOfRideWithDriver')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    const indicator = screen.getByTitle(/Paris CDG · rides\.partOfRideWithDriver/);
    expect(indicator.querySelector('[data-testid="ride-glyph"]')).not.toBeNull();

    await user.click(indicator);
    expect(await screen.findByTestId('transport-ride-section')).toHaveTextContent('Bob');
  });
});

// ============================================================================
// Moving to another trip without leaving the page
// ============================================================================

describe('CalendarPage: moving to another trip', () => {
  const otherTrip: Trip = { ...mockTrip, id: 'trip-2' as Trip['id'], name: 'Other Trip' };

  /** Navigates from outside the page, the way the trip switcher does. */
  function GoTo({ to }: { readonly to: string }) {
    const navigate = useNavigate();
    return (
      <button type="button" onClick={() => navigate(to)}>
        {`go ${to}`}
      </button>
    );
  }

  function renderWithSwitcher(to: string) {
    return render(
      <>
        <Routes>
          <Route path="/trips/:tripId/calendar" element={<CalendarPage />} />
          <Route path="*" element={<LandedOn />} />
        </Routes>
        <GoTo to={to} />
      </>,
      { initialRoute: '/trips/trip-1/calendar', withProviders: false },
    );
  }

  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
    setPersons([]);
    setAssignments([]);
    setTransports([], []);
    setActivities([]);
    mockUseRoomContext.mockReturnValue({ rooms: [], isLoading: false, error: null });
  });

  it.each([
    ['persons.new', '/trips/trip-2/persons?new=1'],
    ['rooms.new', '/trips/trip-2/rooms?new=1'],
    ['calendar.setup.assignments.action', '/trips/trip-2/rooms'],
    ['calendar.setup.arrivals.action', '/trips/trip-2/transports?new=1'],
  ])('sends %s to the trip now on screen', async (label, destination) => {
    const { user } = renderWithSwitcher('/trips/trip-2/calendar');
    expect(screen.getByText('Test Trip')).toBeInTheDocument();

    setTrip(otherTrip);
    await user.click(screen.getByRole('button', { name: 'go /trips/trip-2/calendar' }));
    expect(await screen.findByText('Other Trip')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: label }));

    expect(await screen.findByTestId('landed-on')).toHaveTextContent(destination);
  });

  it('reads the accounts of the trip now on screen', async () => {
    const { user } = renderWithSwitcher('/trips/trip-2/calendar');
    await waitFor(() => {
      expect(mockLoadTripMoney).toHaveBeenCalledWith('trip-1');
    });

    setTrip(otherTrip);
    await user.click(screen.getByRole('button', { name: 'go /trips/trip-2/calendar' }));

    await waitFor(() => {
      expect(mockLoadTripMoney).toHaveBeenCalledWith('trip-2');
    });
  });

  it('keeps the rest of the address when the view changes', async () => {
    setDefaultMocks();
    function Address() {
      const location = useLocation();
      return <output data-testid="address">{location.search}</output>;
    }
    const { user } = render(
      <>
        <Routes>
          <Route path="/trips/:tripId/calendar" element={<CalendarPage />} />
        </Routes>
        <GoTo to="/trips/trip-1/calendar?from=share" />
        <Address />
      </>,
      { initialRoute: '/trips/trip-1/calendar', withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: 'go /trips/trip-1/calendar?from=share' }));
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    expect(screen.getByTestId('address')).toHaveTextContent('?from=share&view=card');
  });

  it('drops a pending move to the trip month once the trip start stops being readable', () => {
    // The page moves the grid to the trip's month on a 0 ms timer. A start
    // date that changes before the timer fires has to cancel that move.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 8, 15, 12));
    const listeners = new Set<() => void>();
    let tripValue = {
      currentTrip: { ...mockTrip, startDate: '2030-07-01' as Trip['startDate'] },
      isLoading: false,
      setCurrentTrip: vi.fn().mockResolvedValue(undefined),
    };
    const store = {
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      get: () => tripValue,
    };
    mockUseTripContext.mockImplementation(() => useSyncExternalStore(store.subscribe, store.get));

    try {
      render(
        <Routes>
          <Route path="/trips/:tripId/calendar" element={<CalendarPage />} />
        </Routes>,
        { initialRoute: '/trips/trip-1/calendar?view=card', withProviders: false },
      );

      act(() => {
        tripValue = {
          ...tripValue,
          currentTrip: { ...tripValue.currentTrip, startDate: 'not a date' as Trip['startDate'] },
        };
        listeners.forEach((listener) => listener());
      });
      act(() => {
        vi.runAllTimers();
      });

      // Still the month the page opened on, the clock's.
      expect(shownMonth()).toBe('September 2026');
    } finally {
      // Unmount before the store-backed mock goes, so no last render reads it.
      cleanup();
      vi.useRealTimers();
      mockUseTripContext.mockReset();
    }
  });

  it('shows the trip once the context catches up with the URL', async () => {
    setTrip({ ...mockTrip, id: 'trip-other' as Trip['id'] });
    const { user } = renderWithSwitcher('/trips/trip-1/calendar?again=1');
    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();

    setTrip(mockTrip);
    await user.click(screen.getByRole('button', { name: 'go /trips/trip-1/calendar?again=1' }));

    expect(await screen.findByText('Test Trip')).toBeInTheDocument();
    expect(screen.queryByText('errors.tripNotFound')).not.toBeInTheDocument();
  });
});
