/**
 * ActivityContext Tests
 *
 * Covers the provider's write surface and the participant index the agenda
 * reads through: what each mutation lands in Dexie, what it refuses, and what
 * `getActivitiesByParticipant` answers once one guest is on two activities.
 *
 * The database is the real one (fake-indexeddb, wiped per test by
 * `src/test/setup.ts`).
 *
 * @module contexts/__tests__/ActivityContext.test
 */

import type { ReactNode } from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import { ActivityProvider, useActivityContext } from '@/contexts/ActivityContext';
import { PersonProvider } from '@/contexts/PersonContext';
import { TripProvider, useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { createActivity } from '@/lib/db/repositories/activity-repository';
import { createTestPerson, createTestTrip, localInstant } from '@/test/utils';
import type { ActivityId, PersonId, TripId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <TripProvider>
      <PersonProvider>
        <ActivityProvider>{children}</ActivityProvider>
      </PersonProvider>
    </TripProvider>
  );
}

function useCombined() {
  return { trip: useTripContext(), activities: useActivityContext() };
}

async function waitForLiveQuery(ms = 100): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

async function renderWithTrip(tripId: TripId) {
  const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });

  await waitFor(() => {
    expect(result.current.trip.isLoading).toBe(false);
  });

  await act(async () => {
    await result.current.trip.setCurrentTrip(tripId);
  });

  await waitFor(() => {
    expect(result.current.trip.currentTrip?.id).toBe(tripId);
  });

  await waitForLiveQuery();

  return result;
}

async function renderWithoutTrip() {
  const { result } = renderHook(() => useCombined(), { wrapper: Wrapper });

  await waitFor(() => {
    expect(result.current.trip.isLoading).toBe(false);
  });

  return result;
}

// ============================================================================
// Tests
// ============================================================================

describe('ActivityContext — reading', () => {
  it('starts empty when no trip is selected', async () => {
    const result = await renderWithoutTrip();

    expect(result.current.activities.activities).toEqual([]);
    expect(result.current.activities.error).toBeNull();
  });

  it('publishes the current trip’s activities in starting order', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    await createActivity(tripId, {
      title: 'Dinner',
      category: 'meal',
      startDatetime: localInstant('2026-07-02', '20:00'),
      allDay: false,
      participantIds: [],
    });
    await createActivity(tripId, {
      title: 'Market',
      category: 'market',
      startDatetime: localInstant('2026-07-02', '09:00'),
      allDay: false,
      participantIds: [],
    });

    const result = await renderWithTrip(tripId);

    expect(result.current.activities.activities.map((activity) => activity.title)).toEqual([
      'Market',
      'Dinner',
    ]);
  });

  it('answers getActivitiesByParticipant for a guest on two activities', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const personId = await createTestPerson(tripId, { name: 'Alice' });
    await createActivity(tripId, {
      title: 'Market',
      category: 'market',
      startDatetime: localInstant('2026-07-02', '09:00'),
      allDay: false,
      participantIds: [personId],
    });
    await createActivity(tripId, {
      title: 'Dinner',
      category: 'meal',
      startDatetime: localInstant('2026-07-02', '20:00'),
      allDay: false,
      participantIds: [personId],
    });

    const result = await renderWithTrip(tripId);

    expect(
      result.current.activities.getActivitiesByParticipant(personId).map((a) => a.title),
    ).toEqual(['Market', 'Dinner']);
    expect(result.current.activities.getActivitiesByParticipant('nobody' as PersonId)).toEqual(
      [],
    );
  });

  it('keeps the same array identity when nothing changed', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    await createActivity(tripId, {
      title: 'Market',
      category: 'market',
      startDatetime: localInstant('2026-07-02', '09:00'),
      allDay: false,
      participantIds: [],
    });

    const result = await renderWithTrip(tripId);
    const first = result.current.activities.activities;

    await waitForLiveQuery();

    expect(result.current.activities.activities).toBe(first);
  });
});

describe('ActivityContext — writing', () => {
  it('creates, updates and then deletes an activity', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const result = await renderWithTrip(tripId);

    let created: ActivityId | undefined;
    await act(async () => {
      const activity = await result.current.activities.createActivity({
        title: 'Market',
        category: 'market',
        startDatetime: localInstant('2026-07-02', '09:00'),
        allDay: false,
        participantIds: [],
      });
      created = activity.id;
    });
    await waitForLiveQuery();
    expect(result.current.activities.activities.map((a) => a.title)).toEqual(['Market']);
    expect(result.current.activities.error).toBeNull();

    await act(async () => {
      await result.current.activities.updateActivity(created!, { title: 'Flower market' });
    });
    await waitForLiveQuery();
    expect(result.current.activities.activities.map((a) => a.title)).toEqual(['Flower market']);

    await act(async () => {
      await result.current.activities.deleteActivity(created!);
    });
    await waitForLiveQuery();
    expect(result.current.activities.activities).toEqual([]);
    await expect(db.activities.where('tripId').equals(tripId).count()).resolves.toBe(0);
  });

  it('signs a guest up and then off again', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const personId = await createTestPerson(tripId, { name: 'Alice' });
    const activity = await createActivity(tripId, {
      title: 'Market',
      category: 'market',
      startDatetime: localInstant('2026-07-02', '09:00'),
      allDay: false,
      participantIds: [],
    });

    const result = await renderWithTrip(tripId);

    await act(async () => {
      await result.current.activities.setParticipation(activity.id, personId, true);
    });
    await waitForLiveQuery();
    expect(result.current.activities.getActivitiesByParticipant(personId)).toHaveLength(1);

    await act(async () => {
      await result.current.activities.setParticipation(activity.id, personId, false);
    });
    await waitForLiveQuery();
    expect(result.current.activities.getActivitiesByParticipant(personId)).toEqual([]);
    expect(result.current.activities.error).toBeNull();
  });
});

describe('ActivityContext — refusals', () => {
  it('refuses every write while no trip is selected', async () => {
    const result = await renderWithoutTrip();
    const { activities } = result.current;

    await expect(
      activities.createActivity({
        title: 'Market',
        category: 'market',
        startDatetime: localInstant('2026-07-02', '09:00'),
        allDay: false,
        participantIds: [],
      }),
    ).rejects.toThrow('no trip selected');
    await expect(
      activities.updateActivity('a' as ActivityId, { title: 'x' }),
    ).rejects.toThrow('no trip selected');
    await expect(activities.deleteActivity('a' as ActivityId)).rejects.toThrow(
      'no trip selected',
    );
    await expect(
      activities.setParticipation('a' as ActivityId, 'p' as PersonId, true),
    ).rejects.toThrow('no trip selected');
  });

  it('reports an activity that belongs to another trip rather than touching it', async () => {
    const tripId = await createTestTrip({ name: 'Mine', startDate: '2026-07-01' });
    const otherTripId = await createTestTrip({ name: 'Theirs', startDate: '2026-07-01' });
    const stranger = await createActivity(otherTripId, {
      title: 'Their dinner',
      category: 'meal',
      startDatetime: localInstant('2026-07-02', '20:00'),
      allDay: false,
      participantIds: [],
    });

    const result = await renderWithTrip(tripId);

    await act(async () => {
      await expect(
        result.current.activities.updateActivity(stranger.id, { title: 'Hijacked' }),
      ).rejects.toThrow();
    });

    await waitFor(() => {
      expect(result.current.activities.error).toBeInstanceOf(Error);
    });
    await expect(db.activities.get(stranger.id)).resolves.toMatchObject({
      title: 'Their dinner',
    });
  });

  it('reports a deletion of an activity that is not there', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const result = await renderWithTrip(tripId);

    await act(async () => {
      await expect(
        result.current.activities.deleteActivity('no-such-activity' as ActivityId),
      ).rejects.toThrow();
    });

    await waitFor(() => {
      expect(result.current.activities.error).toBeInstanceOf(Error);
    });
  });

  it('reports a sign-up for an activity that is not there', async () => {
    const tripId = await createTestTrip({ name: 'Trip', startDate: '2026-07-01' });
    const personId = await createTestPerson(tripId, { name: 'Alice' });
    const result = await renderWithTrip(tripId);

    await act(async () => {
      await expect(
        result.current.activities.setParticipation(
          'no-such-activity' as ActivityId,
          personId,
          true,
        ),
      ).rejects.toThrow();
    });

    await waitFor(() => {
      expect(result.current.activities.error).toBeInstanceOf(Error);
    });
  });
});

describe('useActivityContext', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('refuses to be read outside an ActivityProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      renderHook(() => useActivityContext());
    }).toThrow('useActivityContext must be used within an ActivityProvider');
  });
});
