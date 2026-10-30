/**
 * @fileoverview Tests for useTripIdentity.
 *
 * The resolution rules have their own tests in `lib/identity`. These check what
 * the hook adds on top: the loading state, the live update after an explicit
 * choice, the setter, and the guard that refuses to hand back the previous
 * trip's guest after a trip switch.
 *
 * @module hooks/__tests__/useTripIdentity.test
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestPerson, createTestTrip } from '@/test/utils';

import { useTripIdentity } from '@/hooks/useTripIdentity';
import { getMyPersonId, setMyPersonId } from '@/lib/db';
import { db } from '@/lib/db/database';
import type { PersonId, Trip, TripId } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

const mockTrip: { current: Pick<Trip, 'id' | 'shareId'> | null } = { current: null };

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip: mockTrip.current }),
}));

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: null }),
}));

// ============================================================================
// Helpers
// ============================================================================

async function tripWithGuest(name: string): Promise<{ tripId: TripId; personId: PersonId }> {
  const tripId = await createTestTrip({ name, startDate: '2026-07-01' }),
    personId = await createTestPerson(tripId, { name: `${name} guest` });
  return { tripId, personId };
}

async function selectTrip(tripId: TripId): Promise<void> {
  const trip = await db.trips.get(tripId);
  mockTrip.current = trip ? { id: trip.id, shareId: trip.shareId } : null;
}

// ============================================================================
// Tests
// ============================================================================

describe('useTripIdentity', () => {
  beforeEach(() => {
    mockTrip.current = null;
  });

  it('resolves to nobody when there is no current trip', async () => {
    const { result } = renderHook(() => useTripIdentity());

    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.myPersonId).toBeUndefined();
    expect(result.current.source).toBeUndefined();
  });

  it('ignores the setter when there is no current trip', async () => {
    const { result } = renderHook(() => useTripIdentity());

    await act(() => result.current.setMyPersonId('p1' as PersonId));

    const settings = await db.settings.get('settings');
    expect(settings?.myPersonIdByTripId ?? {}).toEqual({});
  });

  it('answers with the guest chosen explicitly, and follows a later choice', async () => {
    const { tripId, personId } = await tripWithGuest('Summer');
    await selectTrip(tripId);

    const { result } = renderHook(() => useTripIdentity());
    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.myPersonId).toBeUndefined();

    await act(() => result.current.setMyPersonId(personId));

    await waitFor(() => expect(result.current.myPersonId).toBe(personId));
    expect(result.current.source).toBe('explicit');
    expect(await getMyPersonId(tripId)).toBe(personId);

    await act(() => result.current.setMyPersonId(undefined));
    await waitFor(() => expect(result.current.myPersonId).toBeUndefined());
  });

  it("never hands back the previous trip's guest after a trip switch", async () => {
    const first = await tripWithGuest('First'),
      second = await tripWithGuest('Second');
    await setMyPersonId(first.tripId, first.personId);
    await selectTrip(first.tripId);

    const { result, rerender } = renderHook(() => useTripIdentity());
    await waitFor(() => expect(result.current.myPersonId).toBe(first.personId));

    await selectTrip(second.tripId);
    rerender();

    // Before the new query settles the answer is "unknown", not the old guest.
    expect(result.current.myPersonId).not.toBe(first.personId);
    await waitFor(() => expect(result.current.isResolved).toBe(true));
    expect(result.current.myPersonId).toBeUndefined();
  });
});
