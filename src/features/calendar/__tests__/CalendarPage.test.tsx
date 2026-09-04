/**
 * @fileoverview Unit tests for CalendarPage component.
 * Tests loading, error, empty, and content states.
 *
 * @module features/calendar/__tests__/CalendarPage.test
 */

import { act } from 'react';
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

// Local midnight, exactly what `useToday` returns in production (`startOfDay`).
// An instant literal would mean a different calendar day on a machine east of
// UTC than on one west of it, so "today" would move with the runner.
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
    // The same EmptyState the timeline view uses, so switching views does not
    // change how "nothing here yet" is presented.
    expect(screen.getByText('calendar.noAssignmentsTitle')).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('calendar.noAssignmentsTitle');
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
  // Day-key tests (the grid and the timeline must agree on which day a thing is on)
  // ============================================================================

  it('keys every month cell by the calendar day it displays', async () => {
    // A cell's number comes from its Date, its key from a converter. Reading a
    // local midnight in UTC yields the previous day for any viewer ahead of UTC
    // — Paris included — so the cell showing "6" was keyed 2026-04-05 while the
    // headcount and activities on it were keyed locally. Assert the number and
    // the key name the same day, in whatever timezone the suite runs in.
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    const allCells = screen.getAllByRole('gridcell');
    const cells = allCells.filter((cell) =>
      cell.getAttribute('aria-describedby')?.endsWith('-summary'),
    );

    // Only cells with an accessibility summary carry their key in the DOM, and
    // in this fixture that is all of them. Assert the coverage too, so a future
    // fixture that drops a cell's summary fails here instead of silently
    // shrinking what this test checks.
    expect(allCells.length).toBeGreaterThan(0);
    expect(cells).toHaveLength(allCells.length);

    for (const cell of cells) {
      const dateKey = cell.getAttribute('aria-describedby')!.replace('-summary', '');
      const dayNumber = cell.querySelector('span')?.textContent;
      expect(dayNumber).toBe(String(Number(dateKey.slice(8, 10))));
    }
  });

  it('puts a transport in the cell for the day it happens on', async () => {
    // Transports are bucketed by their own day, then looked up by the cell's
    // key, so the two conventions have to match. Both fixtures are built the way
    // `TransportForm` writes: the picker's local datetime through `toISOString`.
    // The midnight one is the trap — its UTC day is the 5th east of Greenwich
    // and the 6th west of it, so only reading it back locally puts it on the
    // day the guest typed, in every timezone the suite may run in.
    const justAfterMidnight = new Date(2026, 3, 6, 0, 30);
    const midday = new Date(2026, 3, 6, 12, 0);

    mockUseTransportContext.mockReturnValue({
      arrivals: [],
      departures: [
        {
          ...mockArrival,
          id: 'transport-2' as Transport['id'],
          type: 'departure',
          datetime: justAfterMidnight.toISOString() as Transport['datetime'],
          location: 'Gare de Lyon',
        },
        {
          ...mockArrival,
          id: 'transport-3' as Transport['id'],
          type: 'departure',
          datetime: midday.toISOString() as Transport['datetime'],
          location: 'Gare Montparnasse',
        },
      ],
      isLoading: false,
      error: null,
      deleteTransport: vi.fn().mockResolvedValue(undefined),
    });

    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    for (const location of ['Gare de Lyon', 'Gare Montparnasse']) {
      const cell = screen
        .getAllByRole('gridcell')
        .find((c) => c.textContent?.includes(location));

      expect(cell, location).toBeDefined();
      expect(cell!.querySelector('span')?.textContent).toBe('6');
      expect(cell!).toHaveAttribute('aria-describedby', '2026-04-06-summary');
    }
  });

  // ============================================================================
  // Assignment rendering tests
  // ============================================================================

  it('renders multi-day assignment events in card view', async () => {
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    // 2026-04-02 → 2026-04-08 is a check-out date, so the last night is the
    // 7th: six pills, one per night slept. Every pill carries the label as its
    // `title`; only three print it, because a segment in the middle of a week
    // renders a non-breaking space so the span reads as one continuous bar.
    const pills = screen.getAllByTitle('Alice - Blue Room');
    expect(pills).toHaveLength(6);
    expect(screen.getAllByText('Alice - Blue Room')).toHaveLength(3);

    // The control for the fallback test below: a usable colour is painted
    // verbatim, and the text colour is the contrast decision for *that* colour
    // (#3b82f6 sits above the WCAG threshold, so black).
    for (const pill of pills) {
      expect(pill).toHaveStyle({ backgroundColor: 'rgb(59, 130, 246)', color: 'rgb(0, 0, 0)' });
    }
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

  it('paints an assignment grey when the person colour is too short to be a colour', async () => {
    // `#ab` is not a colour any browser can paint — CSS would drop the
    // declaration and the pill would inherit the day cell's background,
    // rendering an unreadable label. The page substitutes #6b7280 instead.
    // Asserting the label is on screen (which the previous version of this test
    // did, byte for byte the same as the multi-day test above) cannot see any
    // of that.
    const shortColorPerson: Person = {
      ...mockPerson,
      color: '#ab' as Person['color'],
    };
    mockUsePersonContext.mockReturnValue({
      persons: [shortColorPerson],
      getPersonById: vi.fn((id: string) => (id === mockPerson.id ? shortColorPerson : undefined)),
      isLoading: false,
      error: null,
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    const pills = screen.getAllByTitle('Alice - Blue Room');
    expect(pills).toHaveLength(6);
    for (const pill of pills) {
      // #6b7280, and the white text its luminance calls for — not the black
      // the person's own (blue) colour would have got.
      expect(pill).toHaveStyle({
        backgroundColor: 'rgb(107, 114, 128)',
        color: 'rgb(255, 255, 255)',
      });
    }
  });

  it('keeps a three-digit shorthand colour, which is a colour', async () => {
    // The guard is `length >= 4`, and `#abc` is exactly four characters. Pinning
    // the passing side of the boundary is what stops the fallback from being
    // widened until it swallows every legitimate shorthand.
    const shorthandPerson: Person = {
      ...mockPerson,
      color: '#abc' as Person['color'],
    };
    mockUsePersonContext.mockReturnValue({
      persons: [shorthandPerson],
      getPersonById: vi.fn((id: string) => (id === mockPerson.id ? shorthandPerson : undefined)),
      isLoading: false,
      error: null,
    });
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    expect(screen.getAllByTitle('Alice - Blue Room')[0]).toHaveStyle({
      backgroundColor: 'rgb(170, 187, 204)',
    });
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

    // The offset-less datetime is a wall clock, so it reads 10:00 in every
    // timezone the suite may run in.
    const indicator = screen.getByTitle('10:00 Alice - Paris CDG');
    expect(indicator).toHaveTextContent('↑');
    expect(indicator).toHaveTextContent('Paris CDG');
    expect(indicator.closest('[role="gridcell"]')).toHaveAttribute(
      'aria-describedby',
      '2026-04-08-summary',
    );
  });

  it('paints a transport dot grey when the person colour is too short to be a colour', async () => {
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

    // The person dot is `aria-hidden`, so it has to be reached through the
    // indicator that owns it rather than by role.
    const indicator = screen.getByTitle('14:00 Alice - Paris CDG');
    const dot = indicator.querySelector('span.rounded-full');
    expect(dot).not.toBeNull();
    expect(dot).toHaveStyle({ backgroundColor: 'rgb(107, 114, 128)' });
  });

  it('paints a transport dot in the person colour when it is usable', async () => {
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    const dot = screen.getByTitle('14:00 Alice - Paris CDG').querySelector('span.rounded-full');
    expect(dot).not.toBeNull();
    expect(dot).toHaveStyle({ backgroundColor: 'rgb(59, 130, 246)' });
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

  it('moves focus one cell per arrow key, and to the row ends on Home/End', async () => {
    // The previous version of this test pressed all six keys and then asserted
    // only that the grid was still on screen — deleting `handleDayKeyDown`
    // wholesale passed it. Focus is the entire observable effect, so focus is
    // what has to be asserted.
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    const cells = screen.getAllByRole('gridcell');
    // April 2026 in a Monday-first grid: Mon 30 Mar → Sun 3 May, five rows.
    expect(cells).toHaveLength(35);

    await act(async () => {
      cells[0]!.focus();
    });
    expect(cells[0]).toHaveFocus();

    await user.keyboard('{ArrowRight}');
    expect(cells[1]).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(cells[8]).toHaveFocus();

    await user.keyboard('{ArrowUp}');
    expect(cells[1]).toHaveFocus();

    await user.keyboard('{End}');
    expect(cells[6]).toHaveFocus();

    await user.keyboard('{Home}');
    expect(cells[0]).toHaveFocus();

    // Only the focused cell is in the tab order — a roving tabindex, so Tab
    // leaves the grid rather than walking 35 cells.
    expect(cells[0]).toHaveAttribute('tabindex', '0');
    expect(cells.filter((cell) => cell.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('clamps arrow-key navigation at the first and last cell', async () => {
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    const cells = screen.getAllByRole('gridcell');
    const lastCell = cells[cells.length - 1]!;

    await act(async () => {
      cells[0]!.focus();
    });
    await user.keyboard('{ArrowLeft}');
    expect(cells[0]).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(cells[0]).toHaveFocus();

    await act(async () => {
      lastCell.focus();
    });
    await user.keyboard('{ArrowRight}');
    expect(lastCell).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(lastCell).toHaveFocus();
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

  it('leaves focus alone for a key the grid does not handle', async () => {
    // This used to look for a `button` whose text was only digits — the day
    // number is a `span` inside the gridcell, so the `.find()` missed, the
    // `if (dayButton)` body never ran, and the test passed having asserted
    // nothing at all.
    const { user } = renderCalendarPage();
    await user.click(screen.getByRole('radio', { name: 'calendar.view.month' }));

    const cells = screen.getAllByRole('gridcell');
    const cell = cells[8]!;

    await act(async () => {
      cell.focus();
    });

    for (const key of ['x', '{PageDown}', '{Enter}']) {
      await user.keyboard(key);
      expect(cell).toHaveFocus();
    }

    expect(cell).toHaveAttribute('tabindex', '0');
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
