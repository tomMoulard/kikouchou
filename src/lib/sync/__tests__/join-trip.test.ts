/**
 * Join-flow tests.
 *
 * The server's trip row is written by another user, so it is remote-supplied
 * input by the same standard as a WebRTC peer's document — which is why most of
 * these are about bounding it rather than about the happy path.
 *
 * @module lib/sync/__tests__/join-trip.test
 */

import { describe, expect, it, vi } from 'vitest';

import { db } from '@/lib/db/database';
import {
  claimParticipant,
  fetchClaimedParticipants,
  materialiseJoinedTrip,
} from '@/lib/sync/join-trip';
import type { ShareId, TripId, UnixTimestamp } from '@/types';
import { isoDate } from '@/test/utils';

// ============================================================================
// Helpers
// ============================================================================

const REMOTE_TRIP_ID = 'aaaaaaaa-0000-0000-0000-000000000001';

/** A client whose `trips` select returns the given preview row. */
function clientWithTrip(row: unknown, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error }) }),
      }),
    }),
  } as never;
}

// ============================================================================
// materialiseJoinedTrip
// ============================================================================

describe('materialiseJoinedTrip', () => {
  it('creates a local trip from the server preview', async () => {
    const client = clientWithTrip({
      name: 'Brittany',
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    });

    const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);

    expect(result.status).toBe('joined');
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);
    expect(trip).toMatchObject({
      name: 'Brittany',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
      remoteTripId: REMOTE_TRIP_ID,
    });
  });

  it('mints its own shareId rather than adopting one', async () => {
    const client = clientWithTrip({
      name: 'Brittany',
      start_date: '2026-07-15',
      end_date: '2026-07-22',
      // A hostile or careless server row cannot dictate this: shareId is a
      // unique Dexie index, and a collision aborts the write transaction.
      share_id: 'collide123',
    });

    const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);

    expect(trip?.shareId).not.toBe('collide123');
    expect(trip?.shareId).toHaveLength(10);
  });

  it('is idempotent when the trip is already on the device', async () => {
    const client = clientWithTrip({
      name: 'Brittany',
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    });

    const first = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
    const second = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);

    // Opening the same link twice must not produce two trips.
    expect(second.status).toBe('already-local');
    expect((second as { tripId: TripId }).tripId).toBe(
      (first as { tripId: TripId }).tripId,
    );
    expect(await db.trips.where('remoteTripId').equals(REMOTE_TRIP_ID).count()).toBe(1);
  });

  it('finds a trip already linked by an earlier session', async () => {
    const now = Date.now() as UnixTimestamp;
    await db.trips.add({
      id: 'pre-existing' as TripId,
      name: 'Already here',
      startDate: isoDate('2026-07-15'),
      endDate: isoDate('2026-07-22'),
      shareId: 'preexist12' as ShareId,
      createdAt: now,
      updatedAt: now,
      remoteTripId: REMOTE_TRIP_ID,
    });

    const result = await materialiseJoinedTrip(clientWithTrip(null), REMOTE_TRIP_ID);

    expect(result).toEqual({ status: 'already-local', tripId: 'pre-existing' });
  });

  it('still joins when the preview cannot be read', async () => {
    // The document is the source of truth and will arrive shortly; refusing to
    // join because a cosmetic preview failed would be the wrong trade.
    const result = await materialiseJoinedTrip(
      clientWithTrip(null, { message: 'boom' }),
      REMOTE_TRIP_ID,
    );

    expect(result.status).toBe('joined');
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);
    expect(trip?.remoteTripId).toBe(REMOTE_TRIP_ID);
  });

  it('bounds an over-long name from the server', async () => {
    const client = clientWithTrip({
      name: 'x'.repeat(5000),
      start_date: '2026-07-15',
      end_date: '2026-07-22',
    });

    const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);

    // Matches the server's own 200-character check constraint.
    expect(trip?.name).toHaveLength(200);
  });

  it.each([
    ['a malformed date', 'not-a-date'],
    ['an empty date', ''],
    ['a datetime where a date belongs', '2026-07-15T00:00:00Z'],
  ])('falls back to today for %s', async (_label, value) => {
    const client = clientWithTrip({
      name: 'Brittany',
      start_date: value,
      end_date: value,
    });

    const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);

    // An unparseable date would poison every date-range query for this trip.
    expect(trip?.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('substitutes a name when the server sends none', async () => {
    const client = clientWithTrip({ start_date: '2026-07-15', end_date: '2026-07-22' });

    const result = await materialiseJoinedTrip(client, REMOTE_TRIP_ID);
    const trip = await db.trips.get((result as { tripId: TripId }).tripId);

    expect(trip?.name).toBe('Shared trip');
  });
});

// ============================================================================
// claimParticipant
// ============================================================================

describe('claimParticipant', () => {
  function clientWithUpdate(error: unknown) {
    const update = vi.fn(() => ({
      eq: () => ({ eq: async () => ({ error }) }),
    }));
    return { client: { from: () => ({ update }) } as never, update };
  }

  it('reports success', async () => {
    const { client } = clientWithUpdate(null);

    await expect(
      claimParticipant(client, REMOTE_TRIP_ID, 'user-1', 'person-alice'),
    ).resolves.toEqual({ status: 'claimed' });
  });

  it('reports a taken participant rather than an opaque error', async () => {
    const { client } = clientWithUpdate({ code: '23505', message: 'duplicate key' });

    // The unique constraint is the enforcement point, so a conflict is an
    // expected outcome to explain — not a bug to pre-check for, which would
    // leave a race between the check and the write.
    await expect(
      claimParticipant(client, REMOTE_TRIP_ID, 'user-1', 'person-alice'),
    ).resolves.toEqual({ status: 'taken' });
  });

  it('surfaces any other failure', async () => {
    const { client } = clientWithUpdate({ code: '42501', message: 'denied' });

    await expect(
      claimParticipant(client, REMOTE_TRIP_ID, 'user-1', 'person-alice'),
    ).resolves.toEqual({ status: 'error', message: 'denied' });
  });

  it('writes only the person id', async () => {
    const { client, update } = clientWithUpdate(null);

    await claimParticipant(client, REMOTE_TRIP_ID, 'user-1', 'person-alice');

    const [values] = update.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(values).toEqual({ person_id: 'person-alice' });
  });
});

// ============================================================================
// fetchClaimedParticipants
// ============================================================================

describe('fetchClaimedParticipants', () => {
  function clientWithMembers(rows: unknown, error: unknown = null) {
    return {
      from: () => ({
        select: () => ({ eq: async () => ({ data: rows, error }) }),
      }),
    } as never;
  }

  it("excludes the caller's own claim so they can keep it", async () => {
    const client = clientWithMembers([
      { user_id: 'user-1', person_id: 'person-alice' },
      { user_id: 'user-2', person_id: 'person-bob' },
    ]);

    const claimed = await fetchClaimedParticipants(client, REMOTE_TRIP_ID, 'user-1');

    expect(claimed.has('person-bob')).toBe(true);
    expect(claimed.has('person-alice')).toBe(false);
  });

  it('ignores members who have not claimed anyone', async () => {
    const client = clientWithMembers([
      { user_id: 'user-2', person_id: null },
      { user_id: 'user-3', person_id: 'person-carol' },
    ]);

    const claimed = await fetchClaimedParticipants(client, REMOTE_TRIP_ID, 'user-1');

    expect([...claimed]).toEqual(['person-carol']);
  });

  it('returns an empty set when the roster cannot be read', async () => {
    const client = clientWithMembers(null, { message: 'boom' });

    // Better to offer every name and let the unique constraint reject one than
    // to block the identity step entirely.
    await expect(
      fetchClaimedParticipants(client, REMOTE_TRIP_ID, 'user-1'),
    ).resolves.toEqual(new Set());
  });
});
