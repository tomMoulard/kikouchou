/**
 * @fileoverview Tests for ActivityListPage.
 * @module features/activities/pages/__tests__/ActivityListPage.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/utils';
import { toLocalISODateString } from '@/lib/db/utils';
import type { Activity, ISODateString, ISODateTimeString, Person, Trip } from '@/types';

import { isActivityPast } from '../../utils/activity-utils';

// ============================================================================
// Fixtures
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);
const mockDeleteActivity = vi.fn().mockResolvedValue(undefined);
const mockSetParticipation = vi.fn().mockResolvedValue(undefined);

/**
 * Every date below is derived from the real "today" rather than pinned to a
 * calendar date: a stale fixture once left rows rendered but hidden, and the
 * suite stayed green (see AGENTS.md).
 */
const NOW = new Date();

/** Local calendar day, `offsetDays` away from today. */
function dayKey(offsetDays: number): ISODateString {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offsetDays);
  return toLocalISODateString(date) as ISODateString;
}

/** A local wall-clock instant, `offsetDays` away from today. */
function instant(offsetDays: number, hour: number): ISODateTimeString {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offsetDays);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString() as ISODateTimeString;
}

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  startDate: dayKey(-2) as Trip['startDate'],
  endDate: dayKey(7) as Trip['endDate'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockPerson: Person = {
  id: 'person-1' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

/** Inside the trip window and still ahead, so it counts as upcoming. */
const upcomingActivity: Activity = {
  id: 'activity-1' as Activity['id'],
  tripId: 'trip-1' as Activity['tripId'],
  title: 'Plant fair',
  category: 'horticulture',
  startDatetime: instant(1, 9),
  endDatetime: instant(1, 12),
  allDay: false,
  location: 'Saint-Jean',
  participantIds: [],
};

/** Inside the trip window but already over. */
const pastActivity: Activity = {
  id: 'activity-2' as Activity['id'],
  tripId: 'trip-1' as Activity['tripId'],
  title: 'Old picnic',
  category: 'meal',
  startDatetime: instant(-1, 12),
  allDay: false,
  participantIds: [],
};

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useParams: () => ({ tripId: 'trip-1' }),
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: vi.fn(),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(),
}));

vi.mock('@/contexts/ActivityContext', () => ({
  useActivityContext: vi.fn(),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
}));

vi.mock('@/hooks/useToday', () => ({
  useToday: () => ({
    today: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()),
  }),
}));

vi.mock('@/features/activities/components/ActivityDialog', () => ({
  ActivityDialog: () => <div data-testid="activity-dialog" />,
}));

vi.mock('@/lib/sharing/guest-identity', () => ({
  getTripGuestPersonId: vi.fn(() => undefined),
}));

import { ActivityListPage } from '../ActivityListPage';
import { useActivityContext } from '@/contexts/ActivityContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTripContext } from '@/contexts/TripContext';
import { getTripGuestPersonId } from '@/lib/sharing/guest-identity';

// ============================================================================
// Helpers
// ============================================================================

function setMocks(activities: readonly Activity[] = [upcomingActivity]) {
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: mockTrip,
    isLoading: false,
    error: null,
    setCurrentTrip: mockSetCurrentTrip,
    trips: [mockTrip],
  } as unknown as ReturnType<typeof useTripContext>);

  vi.mocked(usePersonContext).mockReturnValue({
    persons: [mockPerson],
    isLoading: false,
    error: null,
    getPersonById: vi.fn((id: string) => (id === mockPerson.id ? mockPerson : undefined)),
  } as unknown as ReturnType<typeof usePersonContext>);

  // The page reads the split rather than deriving it, so the mock has to do
  // exactly what ActivityProvider does — same helper, same live instant.
  const now = new Date();

  vi.mocked(useActivityContext).mockReturnValue({
    activities,
    upcomingActivities: activities.filter((activity) => !isActivityPast(activity, now)),
    pastActivities: activities.filter((activity) => isActivityPast(activity, now)),
    isLoading: false,
    error: null,
    createActivity: vi.fn(),
    updateActivity: vi.fn(),
    deleteActivity: mockDeleteActivity,
    setParticipation: mockSetParticipation,
    getActivitiesByParticipant: vi.fn(() => []),
  });
}

function renderPage(route = '/trips/trip-1/activities') {
  return render(<ActivityListPage />, {
    initialRoute: route,
    withProviders: false,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('ActivityListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getTripGuestPersonId).mockReturnValue(undefined);
    setMocks();
  });

  it('renders the page title and the trip name', () => {
    renderPage();

    expect(screen.getByText('activities.title')).toBeInTheDocument();
    expect(screen.getByText('Test Trip')).toBeInTheDocument();
  });

  it('renders the timeline / list view toggle', () => {
    renderPage();

    expect(
      screen.getByRole('radio', { name: 'activities.view.timeline' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'activities.view.list' })).toBeInTheDocument();
  });

  it('defaults to the timeline view', () => {
    renderPage();

    expect(
      screen.getByRole('region', { name: 'activities.timeline.ariaLabel' }),
    ).toBeInTheDocument();
  });

  it('shows the agenda as cards in list view', () => {
    renderPage('/trips/trip-1/activities?view=list');

    expect(screen.getByText('Plant fair')).toBeInTheDocument();
    expect(screen.getByText('Saint-Jean')).toBeInTheDocument();
  });

  it('collapses past activities behind a toggle in list view', async () => {
    setMocks([upcomingActivity, pastActivity]);
    const { user } = renderPage('/trips/trip-1/activities?view=list');

    expect(screen.queryByText('Old picnic')).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /activities.pastActivities/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(screen.getByText('Old picnic')).toBeInTheDocument();
  });

  it('translates the past-activities count instead of appending a raw "(n)"', () => {
    setMocks([upcomingActivity, pastActivity]);
    renderPage('/trips/trip-1/activities?view=list');

    const toggle = screen.getByRole('button', { name: /activities.pastActivities/ });

    expect(toggle).toHaveAccessibleName('activities.pastActivitiesWithCount');
    expect(toggle.textContent).not.toMatch(/\(\d+\)/);
  });

  it('offers the same "new activity" action from the empty state in both views', () => {
    setMocks([]);

    const { unmount } = renderPage('/trips/trip-1/activities?view=list');
    const listEmptyState = screen.getByRole('status');
    expect(within(listEmptyState).getByText('activities.empty')).toBeInTheDocument();
    expect(
      within(listEmptyState).getByRole('button', { name: 'activities.new' }),
    ).toBeInTheDocument();
    unmount();

    renderPage('/trips/trip-1/activities?view=timeline');
    const timelineEmptyState = screen.getByRole('status');
    expect(within(timelineEmptyState).getByText('activities.empty')).toBeInTheDocument();
    expect(
      within(timelineEmptyState).getByRole('button', { name: 'activities.new' }),
    ).toBeInTheDocument();
  });

  it('opens the create dialog from the header action', async () => {
    const { user } = renderPage();

    // The header button and the mobile FAB share the same label.
    const [addButton] = screen.getAllByRole('button', { name: 'activities.new' });
    await user.click(addButton!);

    expect(screen.getByTestId('activity-dialog')).toBeInTheDocument();
  });

  it('hides the join button when this browser has no guest identity', () => {
    renderPage('/trips/trip-1/activities?view=list');

    expect(screen.queryByRole('button', { name: /activities.join/ })).not.toBeInTheDocument();
  });

  it('lets an identified guest join an activity', async () => {
    vi.mocked(getTripGuestPersonId).mockReturnValue(mockPerson.id);
    const { user } = renderPage('/trips/trip-1/activities?view=list');

    await user.click(screen.getByRole('button', { name: /activities.join/ }));

    expect(mockSetParticipation).toHaveBeenCalledWith(
      upcomingActivity.id,
      mockPerson.id,
      true,
    );
  });

  it('lets an identified guest leave an activity they joined', async () => {
    vi.mocked(getTripGuestPersonId).mockReturnValue(mockPerson.id);
    setMocks([{ ...upcomingActivity, participantIds: [mockPerson.id] }]);
    const { user } = renderPage('/trips/trip-1/activities?view=list');

    await user.click(screen.getByRole('button', { name: /activities.leave/ }));

    expect(mockSetParticipation).toHaveBeenCalledWith(
      upcomingActivity.id,
      mockPerson.id,
      false,
    );
  });

  it('disables joining a full activity', () => {
    vi.mocked(getTripGuestPersonId).mockReturnValue(mockPerson.id);
    setMocks([
      { ...upcomingActivity, participantIds: ['other' as Person['id']], maxParticipants: 1 },
    ]);
    renderPage('/trips/trip-1/activities?view=list');

    expect(screen.getByRole('button', { name: /activities.full/ })).toBeDisabled();
  });

  it('renders the trip-not-found state when the trip is missing', () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
      isLoading: false,
      error: null,
      setCurrentTrip: mockSetCurrentTrip,
      trips: [],
    } as unknown as ReturnType<typeof useTripContext>);

    renderPage();

    expect(screen.getByText('errors.tripNotFound')).toBeInTheDocument();
  });

  it('renders the error state when the agenda fails to load', () => {
    vi.mocked(useActivityContext).mockReturnValue({
      activities: [],
      upcomingActivities: [],
      pastActivities: [],
      isLoading: false,
      error: new Error('Agenda load failed'),
      createActivity: vi.fn(),
      updateActivity: vi.fn(),
      deleteActivity: mockDeleteActivity,
      setParticipation: mockSetParticipation,
      getActivitiesByParticipant: vi.fn(() => []),
    });

    renderPage();

    expect(screen.getByText('activities.title')).toBeInTheDocument();
    // Naming the failure, not just counting an alert: an empty error region
    // would satisfy `getByRole('alert')` on its own
    expect(within(document.body).getByRole('alert')).toHaveTextContent(
      'Agenda load failed',
    );
  });
});
