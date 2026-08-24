/**
 * @fileoverview Tests for ActivityListPage.
 * @module features/activities/pages/__tests__/ActivityListPage.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@/test/utils';
import type { Activity, Person, Trip } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn().mockResolvedValue(undefined);
const mockDeleteActivity = vi.fn().mockResolvedValue(undefined);
const mockSetParticipation = vi.fn().mockResolvedValue(undefined);

const mockTrip: Trip = {
  id: 'trip-1' as Trip['id'],
  shareId: 'share-1' as Trip['shareId'],
  name: 'Test Trip',
  startDate: '2026-07-01' as Trip['startDate'],
  endDate: '2026-07-10' as Trip['endDate'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const mockPerson: Person = {
  id: 'person-1' as Person['id'],
  tripId: 'trip-1' as Person['tripId'],
  name: 'Alice',
  color: '#3b82f6' as Person['color'],
};

/**
 * Inside the trip window and after the mocked "today" (2026-07-02), so it lands
 * on the timeline and counts as upcoming.
 */
const upcomingActivity: Activity = {
  id: 'activity-1' as Activity['id'],
  tripId: 'trip-1' as Activity['tripId'],
  title: 'Plant fair',
  category: 'horticulture',
  startDatetime: '2026-07-03T09:00:00.000Z',
  endDatetime: '2026-07-03T12:00:00.000Z',
  allDay: false,
  location: 'Saint-Jean',
  participantIds: [],
};

/** Inside the trip window but before the mocked "today". */
const pastActivity: Activity = {
  id: 'activity-2' as Activity['id'],
  tripId: 'trip-1' as Activity['tripId'],
  title: 'Old picnic',
  category: 'meal',
  startDatetime: '2026-07-01T12:00:00.000Z',
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
  useToday: () => ({ today: new Date('2026-07-02T12:00:00.000Z') }),
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

  vi.mocked(useActivityContext).mockReturnValue({
    activities,
    upcomingActivities: activities,
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
      screen.getByRole('tab', { name: 'activities.view.timeline' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'activities.view.list' })).toBeInTheDocument();
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

  it('shows the empty state when the agenda is empty', () => {
    setMocks([]);
    renderPage('/trips/trip-1/activities?view=list');

    expect(screen.getByText('activities.empty')).toBeInTheDocument();
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
    expect(within(document.body).getByRole('alert')).toBeInTheDocument();
  });
});
