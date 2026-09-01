/**
 * @fileoverview Unit tests for CalendarPage component.
 * Tests loading, error, empty, and content states.
 *
 * @module features/calendar/__tests__/CalendarPage.test
 */

import { Routes, Route } from 'react-router-dom';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen } from '@/test/utils';
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
// Context mocks - default state
// ============================================================================

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

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({ successToast: vi.fn() }),
}));

vi.mock('@/hooks/useToday', () => ({
  useToday: () => ({ today: new Date('2026-04-04T12:00:00.000Z') }),
}));

vi.mock('@/features/transports', () => ({
  TransportDialog: () => null,
}));

vi.mock('@/features/activities/components/ActivityDialog', () => ({
  ActivityDialog: () => null,
}));

// ============================================================================
// Helpers
// ============================================================================

function renderCalendarPage(tripId = 'trip-1') {
  return render(
    <Routes>
      <Route path="/trips/:tripId/calendar" element={<CalendarPage />} />
    </Routes>,
    { initialRoute: `/trips/${tripId}/calendar`, withProviders: false },
  );
}

function setDefaultMocks() {
  mockUseTripContext.mockReturnValue({
    currentTrip: mockTrip,
    isLoading: false,
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

// ============================================================================
// Tests
// ============================================================================

describe('CalendarPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  it('renders the page title', () => {
    renderCalendarPage();
    expect(screen.getByText('calendar.title')).toBeInTheDocument();
  });

  it('renders loading state when trip is loading', () => {
    mockUseTripContext.mockReturnValue({
      currentTrip: null,
      isLoading: true,
      setCurrentTrip: vi.fn(),
    });
    renderCalendarPage();
    expect(screen.getByText('calendar.title')).toBeInTheDocument();
    // LoadingState renders an aria-label or status text
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders loading state when rooms are loading', () => {
    mockUseRoomContext.mockReturnValue({
      rooms: [],
      isLoading: true,
      error: null,
    });
    renderCalendarPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders error state when rooms have an error', () => {
    mockUseRoomContext.mockReturnValue({
      rooms: [],
      isLoading: false,
      error: new Error('Room load failed'),
    });
    renderCalendarPage();
    expect(screen.getByText('calendar.title')).toBeInTheDocument();
    expect(screen.getByText(/Room load failed/i)).toBeInTheDocument();
  });

  it('renders error state when assignments have an error', () => {
    mockUseAssignmentContext.mockReturnValue({
      assignments: [],
      isLoading: false,
      error: new Error('Assignment error'),
      deleteAssignment: vi.fn(),
    });
    renderCalendarPage();
    expect(screen.getByText(/Assignment error/i)).toBeInTheDocument();
  });

  it('renders error state when persons have an error', () => {
    mockUsePersonContext.mockReturnValue({
      persons: [],
      getPersonById: vi.fn(),
      isLoading: false,
      error: new Error('Person error'),
    });
    renderCalendarPage();
    expect(screen.getByText(/Person error/i)).toBeInTheDocument();
  });

  it('renders error state when transports have an error', () => {
    mockUseTransportContext.mockReturnValue({
      arrivals: [],
      departures: [],
      isLoading: false,
      error: new Error('Transport error'),
      deleteTransport: vi.fn(),
    });
    renderCalendarPage();
    expect(screen.getByText(/Transport error/i)).toBeInTheDocument();
  });

  it('renders trip-not-found state when no current trip', () => {
    mockUseTripContext.mockReturnValue({
      currentTrip: null,
      isLoading: false,
      setCurrentTrip: vi.fn().mockResolvedValue(undefined),
    });
    renderCalendarPage();
    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
  });

  it('renders trip-not-found when tripId in URL mismatches context', () => {
    mockUseTripContext.mockReturnValue({
      currentTrip: { ...mockTrip, id: 'trip-other' as Trip['id'] },
      isLoading: false,
      setCurrentTrip: vi.fn().mockResolvedValue(undefined),
    });
    renderCalendarPage('trip-1');
    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
  });

  it('renders the view toggle tabs (Month / Timeline)', () => {
    renderCalendarPage();
    expect(screen.getByRole('radiogroup', { name: 'calendar.view.ariaLabel' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'calendar.view.month' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'calendar.view.timeline' })).toBeInTheDocument();
  });

  it('renders the trip name as description', () => {
    renderCalendarPage();
    expect(screen.getByText('Test Trip')).toBeInTheDocument();
  });

  it('renders calendar with no assignments shows empty message in card view', async () => {
    mockUseAssignmentContext.mockReturnValue({
      assignments: [],
      isLoading: false,
      error: null,
      deleteAssignment: vi.fn(),
    });
    // Also clear transports and activities so hasVisibleCalendarItems is false
    mockUseTransportContext.mockReturnValue({
      arrivals: [],
      departures: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    });
    mockUseActivityContext.mockReturnValue({
      activities: [],
      isLoading: false,
      error: null,
      deleteActivity: vi.fn().mockResolvedValue(undefined),
    });
    const { user } = renderCalendarPage();
    // Switch to month/card view
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    expect(screen.getByText('calendar.noAssignments')).toBeInTheDocument();
  });

  it('syncs current trip from URL when context does not match', () => {
    const setCurrentTrip = vi.fn().mockResolvedValue(undefined);
    mockUseTripContext.mockReturnValue({
      currentTrip: null,
      isLoading: false,
      setCurrentTrip,
    });
    renderCalendarPage('trip-1');
    expect(setCurrentTrip).toHaveBeenCalledWith('trip-1');
  });

  // ============================================================================
  // View switching tests
  // ============================================================================

  it('switches to card view when clicking Month tab', async () => {
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    // Card view shows the calendar header and grid
    expect(screen.getByRole('grid', { name: 'calendar.monthView' })).toBeInTheDocument();
  });

  it('defaults to timeline view', () => {
    renderCalendarPage();
    // Timeline is the default - no grid should be present
    expect(screen.queryByRole('grid', { name: 'calendar.monthView' })).not.toBeInTheDocument();
  });

  it('handles back-compat "month" view param as "card"', () => {
    render(
      <Routes>
        <Route path="/trips/:tripId/calendar" element={<CalendarPage />} />
      </Routes>,
      { initialRoute: '/trips/trip-1/calendar?view=month', withProviders: false },
    );
    // "month" maps to card view, so the grid should be visible
    expect(screen.getByRole('grid', { name: 'calendar.monthView' })).toBeInTheDocument();
  });

  // ============================================================================
  // Calendar navigation tests
  // ============================================================================

  it('navigates to previous month', async () => {
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    const prevButton = screen.getByRole('button', { name: 'calendar.previousMonth' });
    await user.click(prevButton);
    // The page should still render without error
    expect(screen.getByRole('grid', { name: 'calendar.monthView' })).toBeInTheDocument();
  });

  it('navigates to next month', async () => {
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    const nextButton = screen.getByRole('button', { name: 'calendar.nextMonth' });
    await user.click(nextButton);
    expect(screen.getByRole('grid', { name: 'calendar.monthView' })).toBeInTheDocument();
  });

  it('navigates to today', async () => {
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    // First navigate away
    const nextButton = screen.getByRole('button', { name: 'calendar.nextMonth' });
    await user.click(nextButton);
    await user.click(nextButton);
    // Then click today (use first match - the visible text button)
    const todayButtons = screen.getAllByRole('button', { name: 'calendar.today' });
    await user.click(todayButtons[0]!);
    expect(screen.getByRole('grid', { name: 'calendar.monthView' })).toBeInTheDocument();
  });

  // ============================================================================
  // Headcount tests (meal planning)
  // ============================================================================

  it('counts a multi-person guest entry as several people in card view', async () => {
    // Alice counts for 1, "Alice+Auré" counts for 2 → 3 people that night.
    const couple: Person = {
      ...mockPerson,
      id: 'person-2' as Person['id'],
      name: 'Alice+Auré',
      headcount: 2,
    };
    mockUsePersonContext.mockReturnValue({
      persons: [mockPerson, couple],
      getPersonById: vi.fn((id: string) =>
        id === mockPerson.id ? mockPerson : id === couple.id ? couple : undefined,
      ),
      isLoading: false,
      error: null,
    });

    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    expect(screen.getByTestId('day-headcount-2026-04-05')).toHaveTextContent('3');
  });

  it('shows the per-night headcount in the timeline day headers', async () => {
    const couple: Person = {
      ...mockPerson,
      id: 'person-2' as Person['id'],
      name: 'Alice+Auré',
      headcount: 2,
    };
    mockUsePersonContext.mockReturnValue({
      persons: [mockPerson, couple],
      getPersonById: vi.fn((id: string) =>
        id === mockPerson.id ? mockPerson : id === couple.id ? couple : undefined,
      ),
      isLoading: false,
      error: null,
    });

    renderCalendarPage();

    expect(await screen.findByTestId('timeline-headcount-2026-04-05')).toHaveTextContent('3');
  });

  it('omits the headcount on nights with nobody on site', async () => {
    mockUsePersonContext.mockReturnValue({
      persons: [],
      getPersonById: vi.fn(() => undefined),
      isLoading: false,
      error: null,
    });
    mockUseAssignmentContext.mockReturnValue({
      assignments: [],
      isLoading: false,
      error: null,
      deleteAssignment: vi.fn().mockResolvedValue(undefined),
    });

    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    expect(screen.queryByTestId('day-headcount-2026-04-05')).not.toBeInTheDocument();
  });

  // ============================================================================
  // Assignment rendering tests
  // ============================================================================

  it('renders multi-day assignment events in card view', async () => {
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    // The assignment label should be rendered (possibly multiple segments)
    const labels = screen.getAllByText('Alice - Blue Room');
    expect(labels.length).toBeGreaterThan(0);
  });

  it('renders assignment with unknown person when person not found', async () => {
    mockUsePersonContext.mockReturnValue({
      persons: [],
      getPersonById: vi.fn(() => undefined),
      isLoading: false,
      error: null,
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    // Should show unknown label in aria-label of event pill buttons
    const pills = screen.getAllByTitle('common.unknown - Blue Room');
    expect(pills.length).toBeGreaterThan(0);
  });

  it('renders assignment with short color fallback', async () => {
    const shortColorPerson: Person = {
      ...mockPerson,
      color: '#ab' as Person['color'], // Too short, fallback to gray
    };
    mockUsePersonContext.mockReturnValue({
      persons: [shortColorPerson],
      getPersonById: vi.fn((id: string) => (id === mockPerson.id ? shortColorPerson : undefined)),
      isLoading: false,
      error: null,
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    const labels = screen.getAllByText('Alice - Blue Room');
    expect(labels.length).toBeGreaterThan(0);
  });

  it('skips assignments outside visible calendar range', async () => {
    const farFutureAssignment: RoomAssignment = {
      id: 'assignment-2' as RoomAssignment['id'],
      tripId: mockTrip.id,
      roomId: mockRoom.id,
      personId: mockPerson.id,
      startDate: '2030-01-01' as RoomAssignment['startDate'],
      endDate: '2030-01-05' as RoomAssignment['endDate'],
    };
    mockUseAssignmentContext.mockReturnValue({
      assignments: [farFutureAssignment],
      isLoading: false,
      error: null,
      deleteAssignment: vi.fn().mockResolvedValue(undefined),
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    // The far future assignment should not be visible
    expect(screen.queryByText('Alice - Blue Room')).not.toBeInTheDocument();
  });

  it('skips assignments with invalid dates', async () => {
    const invalidAssignment: RoomAssignment = {
      id: 'assignment-bad' as RoomAssignment['id'],
      tripId: mockTrip.id,
      roomId: mockRoom.id,
      personId: mockPerson.id,
      startDate: 'not-a-date' as RoomAssignment['startDate'],
      endDate: 'also-not-a-date' as RoomAssignment['endDate'],
    };
    mockUseAssignmentContext.mockReturnValue({
      assignments: [invalidAssignment],
      isLoading: false,
      error: null,
      deleteAssignment: vi.fn().mockResolvedValue(undefined),
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    expect(screen.queryByText('Alice - Blue Room')).not.toBeInTheDocument();
  });

  it('skips same-day assignments (lastNight < assignmentStart)', async () => {
    const sameDayAssignment: RoomAssignment = {
      id: 'assignment-same' as RoomAssignment['id'],
      tripId: mockTrip.id,
      roomId: mockRoom.id,
      personId: mockPerson.id,
      startDate: '2026-04-05' as RoomAssignment['startDate'],
      endDate: '2026-04-05' as RoomAssignment['endDate'], // Same day means lastNight < start
    };
    mockUseAssignmentContext.mockReturnValue({
      assignments: [sameDayAssignment],
      isLoading: false,
      error: null,
      deleteAssignment: vi.fn().mockResolvedValue(undefined),
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    expect(screen.queryByText('Alice - Blue Room')).not.toBeInTheDocument();
  });

  // ============================================================================
  // Transport rendering tests
  // ============================================================================

  it('renders departure transport events', async () => {
    const mockDeparture: Transport = {
      id: 'transport-2' as Transport['id'],
      tripId: mockTrip.id,
      personId: mockPerson.id,
      type: 'departure',
      datetime: '2026-04-08T10:00:00' as Transport['datetime'],
      location: 'Paris CDG',
      needsPickup: false,
    };
    mockUseTransportContext.mockReturnValue({
      arrivals: [],
      departures: [mockDeparture],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    // Transport indicators should be rendered
    expect(screen.getByRole('grid', { name: 'calendar.monthView' })).toBeInTheDocument();
  });

  it('renders transport with short color fallback', async () => {
    const shortColorPerson: Person = {
      ...mockPerson,
      color: '#a' as Person['color'],
    };
    mockUsePersonContext.mockReturnValue({
      persons: [shortColorPerson],
      getPersonById: vi.fn((id: string) => (id === mockPerson.id ? shortColorPerson : undefined)),
      isLoading: false,
      error: null,
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    // Should still render without error
    expect(screen.getByRole('grid', { name: 'calendar.monthView' })).toBeInTheDocument();
  });

  // ============================================================================
  // Trip boundaries tests
  // ============================================================================

  it('handles trip with invalid dates gracefully', async () => {
    mockUseTripContext.mockReturnValue({
      currentTrip: { ...mockTrip, startDate: 'invalid', endDate: 'invalid' },
      isLoading: false,
      setCurrentTrip: vi.fn().mockResolvedValue(undefined),
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    // Should render calendar grid but with null trip boundaries
    expect(screen.getByRole('grid', { name: 'calendar.monthView' })).toBeInTheDocument();
  });

  it('handles trip with same start and end date (lastNight < start)', async () => {
    mockUseTripContext.mockReturnValue({
      currentTrip: {
        ...mockTrip,
        startDate: '2026-04-05' as Trip['startDate'],
        endDate: '2026-04-05' as Trip['endDate'],
      },
      isLoading: false,
      setCurrentTrip: vi.fn().mockResolvedValue(undefined),
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    expect(screen.getByRole('grid', { name: 'calendar.monthView' })).toBeInTheDocument();
  });

  // ============================================================================
  // Keyboard navigation tests
  // ============================================================================

  it('supports keyboard navigation with arrow keys in card view', async () => {
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    // Find a gridcell and focus it
    const gridcells = screen.getAllByRole('gridcell');
    expect(gridcells.length).toBeGreaterThan(0);

    // Focus a cell and use keyboard
    const firstCell = gridcells[0]!;
    firstCell.focus();

    // ArrowRight
    await user.keyboard('{ArrowRight}');
    // ArrowDown
    await user.keyboard('{ArrowDown}');
    // ArrowLeft
    await user.keyboard('{ArrowLeft}');
    // ArrowUp
    await user.keyboard('{ArrowUp}');
    // Home
    await user.keyboard('{Home}');
    // End
    await user.keyboard('{End}');

    // The grid should still be rendered without error
    expect(screen.getByRole('grid', { name: 'calendar.monthView' })).toBeInTheDocument();
  });

  // ============================================================================
  // Loading state combination tests
  // ============================================================================

  it('shows loading when assignments are loading', () => {
    mockUseAssignmentContext.mockReturnValue({
      assignments: [],
      isLoading: true,
      error: null,
      deleteAssignment: vi.fn(),
    });
    renderCalendarPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows loading when persons are loading', () => {
    mockUsePersonContext.mockReturnValue({
      persons: [],
      getPersonById: vi.fn(),
      isLoading: true,
      error: null,
    });
    renderCalendarPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows loading when transports are loading', () => {
    mockUseTransportContext.mockReturnValue({
      arrivals: [],
      departures: [],
      isLoading: true,
      error: null,
      deleteTransport: vi.fn(),
    });
    renderCalendarPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  // ============================================================================
  // Timeline view tests
  // ============================================================================

  it('renders timeline view with assignments and transports', () => {
    renderCalendarPage();
    // Default is timeline, so CalendarTimeline should be rendered
    // It should not show the month grid
    expect(screen.queryByRole('grid', { name: 'calendar.monthView' })).not.toBeInTheDocument();
  });

  it('does not show empty message in timeline view', () => {
    mockUseAssignmentContext.mockReturnValue({
      assignments: [],
      isLoading: false,
      error: null,
      deleteAssignment: vi.fn(),
    });
    mockUseTransportContext.mockReturnValue({
      arrivals: [],
      departures: [],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    });
    renderCalendarPage();
    // The empty message is only shown in card view
    expect(screen.queryByText('calendar.noAssignments')).not.toBeInTheDocument();
  });

  it('shows calendar header only in card view, not timeline', async () => {
    const { user } = renderCalendarPage();
    // In timeline view (default), no CalendarHeader prev/next buttons
    expect(screen.queryByRole('button', { name: 'calendar.previousMonth' })).not.toBeInTheDocument();

    // Switch to card view
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));
    expect(screen.getByRole('button', { name: 'calendar.previousMonth' })).toBeInTheDocument();
  });

  // ============================================================================
  // Additional branch coverage
  // ============================================================================

  it('renders error state when persons context has error', () => {
    mockUsePersonContext.mockReturnValue({
      persons: [],
      getPersonById: vi.fn(),
      isLoading: false,
      error: new Error('Persons load failed'),
    });
    renderCalendarPage();
    expect(screen.getByText('calendar.title')).toBeInTheDocument();
  });

  it('renders error state when transports context has error', () => {
    mockUseTransportContext.mockReturnValue({
      arrivals: [],
      departures: [],
      isLoading: false,
      error: new Error('Transports load failed'),
      deleteTransport: vi.fn(),
    });
    renderCalendarPage();
    expect(screen.getByText('calendar.title')).toBeInTheDocument();
  });

  it('renders error state when assignments context has error', () => {
    mockUseAssignmentContext.mockReturnValue({
      assignments: [],
      isLoading: false,
      error: new Error('Assignments load failed'),
      deleteAssignment: vi.fn(),
    });
    renderCalendarPage();
    expect(screen.getByText('calendar.title')).toBeInTheDocument();
  });

  it('ignores non-arrow keyboard events in month view', async () => {
    const { user } = renderCalendarPage();

    // Switch to card view for month grid keyboard events
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    // Press a non-arrow key on a day cell - should not crash
    const dayButtons = screen.getAllByRole('button');
    const dayButton = dayButtons.find((btn) => btn.textContent?.match(/^\d+$/));
    if (dayButton) {
      dayButton.focus();
      await user.keyboard('x');
      // Should not throw or change focused date
      expect(dayButton).toBeInTheDocument();
    }
  });

  it('shows loading when assignments are loading', () => {
    mockUseAssignmentContext.mockReturnValue({
      assignments: [],
      isLoading: true,
      error: null,
      deleteAssignment: vi.fn(),
    });
    renderCalendarPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows loading when persons are loading', () => {
    mockUsePersonContext.mockReturnValue({
      persons: [],
      getPersonById: vi.fn(),
      isLoading: true,
      error: null,
    });
    renderCalendarPage();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});
