/**
 * @fileoverview What the activities page writes when somebody acts on a card.
 *
 * The sibling files cover what it lists and in what order. This one covers the
 * handlers behind the cards: signing up, stepping back out, deleting an
 * activity, and what the page does not say when either write fails.
 *
 * @module features/activities/pages/__tests__/ActivityListPage.actions.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen, waitFor, within } from '@/test/utils';
import { toLocalISODateString } from '@/lib/db/utils';
import type { Activity, ISODateString, ISODateTimeString, Person, Trip } from '@/types';

import { isActivityPast } from '../../utils/activity-utils';

// ============================================================================
// Fixtures
// ============================================================================

const mockNavigate = vi.fn();
const mockSetCurrentTrip = vi.fn();
const mockDeleteActivity = vi.fn();
const mockSetParticipation = vi.fn();
const mockNotifySuccess = vi.fn();

const NOW = new Date();

function dayKey(offsetDays: number): ISODateString {
  const date = new Date(NOW);
  date.setDate(date.getDate() + offsetDays);
  return toLocalISODateString(date) as ISODateString;
}

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

/** The same activity with Alice already on it, so she can step back out. */
const joinedActivity: Activity = {
  ...upcomingActivity,
  participantIds: [mockPerson.id],
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

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('@/contexts/PersonContext', () => ({ usePersonContext: vi.fn() }));
vi.mock('@/contexts/ActivityContext', () => ({ useActivityContext: vi.fn() }));

vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess, errorToast: vi.fn() }),
  useTripIdentity: vi.fn(),
}));

vi.mock('@/hooks/useToday', () => ({
  useToday: () => ({ today: new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate()) }),
}));

vi.mock('@/features/activities/components/ActivityDialog', () => ({
  ActivityDialog: ({ open, activityId }: { open: boolean; activityId?: string }) =>
    open ? <div data-testid="activity-dialog" data-activity-id={activityId ?? ''} /> : null,
}));

import { ActivityListPage } from '../ActivityListPage';
import { useActivityContext } from '@/contexts/ActivityContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTripContext } from '@/contexts/TripContext';
import { useTripIdentity } from '@/hooks';

// ============================================================================
// Helpers
// ============================================================================

function mockIdentity(myPersonId: Person['id'] | undefined): void {
  vi.mocked(useTripIdentity).mockReturnValue({
    myPersonId,
    source: myPersonId === undefined ? undefined : 'explicit',
    isResolved: true,
    setMyPersonId: vi.fn(),
  });
}

function setMocks(activities: readonly Activity[] = [upcomingActivity]): void {
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

/** The cards live in the list view; the timeline is the default. */
function renderPage() {
  return render(<ActivityListPage />, {
    initialRoute: '/trips/trip-1/activities?view=list',
    withProviders: false,
  });
}

// ============================================================================
// Tests
// ============================================================================

describe('ActivityListPage — signing up', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockDeleteActivity.mockResolvedValue(undefined);
    mockSetParticipation.mockResolvedValue(undefined);
    mockIdentity(mockPerson.id);
    setMocks();
  });

  it('signs the guest holding the device up', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'activities.join' }));

    await waitFor(() => {
      expect(mockSetParticipation).toHaveBeenCalledWith(upcomingActivity.id, mockPerson.id, true);
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('activities.joined');
  });

  it('takes them back off again', async () => {
    setMocks([joinedActivity]);
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'activities.leave' }));

    await waitFor(() => {
      expect(mockSetParticipation).toHaveBeenCalledWith(joinedActivity.id, mockPerson.id, false);
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('activities.left');
  });

  it('does not claim a sign-up that failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockSetParticipation.mockRejectedValue(new Error('offline'));
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'activities.join' }));

    await waitFor(() => {
      expect(mockSetParticipation).toHaveBeenCalled();
    });
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('offers no sign-up to a device that is nobody in particular', () => {
    mockIdentity(undefined);
    renderPage();

    expect(screen.queryByRole('button', { name: 'activities.join' })).not.toBeInTheDocument();
  });
});

describe('ActivityListPage — editing and deleting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCurrentTrip.mockResolvedValue(undefined);
    mockDeleteActivity.mockResolvedValue(undefined);
    mockSetParticipation.mockResolvedValue(undefined);
    mockIdentity(mockPerson.id);
    setMocks();
  });

  it('opens the dialog on the activity that was edited', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'common.actions' }));
    await user.click(await screen.findByText('common.edit'));

    expect(await screen.findByTestId('activity-dialog')).toHaveAttribute(
      'data-activity-id',
      upcomingActivity.id,
    );
  });

  it('deletes the activity once the prompt is confirmed', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'common.actions' }));
    await user.click(await screen.findByText('common.delete'));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common\.delete/i }));

    await waitFor(() => {
      expect(mockDeleteActivity).toHaveBeenCalledWith(upcomingActivity.id);
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('activities.deleteSuccess');
  });

  it('keeps the activity when the prompt is dismissed', async () => {
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'common.actions' }));
    await user.click(await screen.findByText('common.delete'));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common\.cancel/i }));

    expect(mockDeleteActivity).not.toHaveBeenCalled();
  });

  it('does not claim a deletion that failed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockDeleteActivity.mockRejectedValue(new Error('offline'));
    const { user } = renderPage();

    await user.click(screen.getByRole('button', { name: 'common.actions' }));
    await user.click(await screen.findByText('common.delete'));
    const prompt = await screen.findByRole('alertdialog');
    await user.click(within(prompt).getByRole('button', { name: /common\.delete/i }));

    await waitFor(() => {
      expect(mockDeleteActivity).toHaveBeenCalled();
    });
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
