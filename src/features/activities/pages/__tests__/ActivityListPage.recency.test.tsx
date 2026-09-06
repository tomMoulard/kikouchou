/**
 * @fileoverview Regression test for the two answers the agenda used to give to
 * "is this activity over?".
 *
 * The page classified against `startOfDay(new Date())` while `ActivityContext`
 * compared ISO strings against the current instant, so an activity that ended
 * this morning was upcoming on the page and past in the context for the rest of
 * the day. The page now reads the context's split, and this test renders the
 * real provider under the real page to prove they cannot drift apart again.
 *
 * @module features/activities/pages/__tests__/ActivityListPage.recency.test
 */

import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';

import { render, screen } from '@/test/utils';
import { createActivity } from '@/lib/db/repositories/activity-repository';
import { toLocalISODateString } from '@/lib/db/utils';
import type { Activity, ActivityFormData, ISODateTimeString, Trip } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-recency' as Trip['id'];

/**
 * Derived from the real clock, never pinned to a calendar date: AGENTS.md
 * records a bug where a stale fixture left rows rendered but hidden and the
 * suite still passed.
 */
const NOW = new Date();
const MIDNIGHT_TODAY = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate());

/**
 * An instant strictly between local midnight and now, so it is unambiguously
 * "earlier today" whatever time the suite runs at.
 */
const ENDED_EARLIER_TODAY = new Date(
  Math.floor((MIDNIGHT_TODAY.getTime() + NOW.getTime()) / 2),
);

function dayOffset(days: number): Date {
  const date = new Date(MIDNIGHT_TODAY);
  date.setDate(date.getDate() + days);
  return date;
}

function atHour(days: number, hour: number): ISODateTimeString {
  const date = dayOffset(days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString() as ISODateTimeString;
}

const mockTrip: Trip = {
  id: TRIP_ID,
  shareId: 'share-recency' as Trip['shareId'],
  name: 'Recency Trip',
  startDate: toLocalISODateString(dayOffset(-1)) as Trip['startDate'],
  endDate: toLocalISODateString(dayOffset(7)) as Trip['endDate'],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ tripId: TRIP_ID }),
  };
});

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({
    currentTrip: mockTrip,
    trips: [mockTrip],
    isLoading: false,
    error: null,
    setCurrentTrip: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    persons: [],
    isLoading: false,
    error: null,
    getPersonById: vi.fn(() => undefined),
  }),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: () => ({
    successToast: vi.fn(),
    errorToast: vi.fn(),
  }),
  // Anonymous device: this file is about which activities are shown and in
  // what order, not about who can join them.
  useTripIdentity: () => ({
    myPersonId: undefined,
    source: undefined,
    isResolved: true,
    setMyPersonId: vi.fn(),
  }),
}));

vi.mock('@/features/activities/components/ActivityDialog', () => ({
  ActivityDialog: () => <div data-testid="activity-dialog" />,
}));

import { ActivityProvider, useActivityContext } from '@/contexts/ActivityContext';

import { ActivityListPage } from '../ActivityListPage';

// ============================================================================
// Helpers
// ============================================================================

interface CapturedSplit {
  readonly upcoming: readonly string[];
  readonly past: readonly string[];
}

let capturedSplit: CapturedSplit | null = null;

/** Reads the context's own classification from inside the same provider. */
function ContextProbe(): null {
  const { upcomingActivities, pastActivities } = useActivityContext();

  useEffect(() => {
    capturedSplit = {
      upcoming: upcomingActivities.map((activity) => activity.title),
      past: pastActivities.map((activity) => activity.title),
    };
  }, [upcomingActivities, pastActivities]);

  return null;
}

async function seedActivity(
  title: string,
  startDatetime: ISODateTimeString,
  endDatetime: ISODateTimeString,
): Promise<Activity> {
  const data: ActivityFormData = {
    title,
    category: 'other',
    startDatetime,
    endDatetime,
    allDay: false,
    participantIds: [],
  };

  return createActivity(TRIP_ID, data);
}

// ============================================================================
// Tests
// ============================================================================

describe('ActivityListPage recency', () => {
  it('agrees with ActivityContext about an activity that ended earlier today', async () => {
    capturedSplit = null;

    await seedActivity(
      'Ended this morning',
      MIDNIGHT_TODAY.toISOString() as ISODateTimeString,
      ENDED_EARLIER_TODAY.toISOString() as ISODateTimeString,
    );
    await seedActivity('Tomorrow outing', atHour(1, 9), atHour(1, 12));

    const { user } = render(
      <ActivityProvider>
        <ContextProbe />
        <ActivityListPage />
      </ActivityProvider>,
      {
        initialRoute: `/trips/${TRIP_ID}/activities?view=list`,
        withProviders: false,
      },
    );

    await waitFor(() => {
      expect(screen.getByText('Tomorrow outing')).toBeInTheDocument();
    });

    // The context says this morning's activity is over…
    expect(capturedSplit).toEqual({
      upcoming: ['Tomorrow outing'],
      past: ['Ended this morning'],
    });

    // …and the page agrees: it is not in the upcoming groups, only behind the
    // collapsed "past activities" toggle.
    expect(screen.queryByText('Ended this morning')).not.toBeInTheDocument();

    await user.click(
      screen.getByRole('button', { name: /activities.pastActivitiesWithCount/ }),
    );

    expect(screen.getByText('Ended this morning')).toBeInTheDocument();
  });
});
