/**
 * @fileoverview Tests for the trip roster reads and the organiser's removal.
 *
 * @module lib/sync/__tests__/members.test
 */

import { describe, expect, it, vi } from 'vitest';

import { listTripMembers, removeTripMember } from '@/lib/sync/members';

// ============================================================================
// Helpers
// ============================================================================

/** A query builder that resolves with `result` however it is chained. */
function query(result: unknown) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order']) {
    builder[method] = vi.fn(() => builder);
  }
  builder['maybeSingle'] = vi.fn(async () => result);
  builder['then'] = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return builder;
}

function clientWithTables(trips: unknown, members: unknown) {
  return {
    from: vi.fn((table: string) => query(table === 'trips' ? trips : members)),
  } as never;
}

// ============================================================================
// listTripMembers
// ============================================================================

describe('listTripMembers', () => {
  it('returns the organiser and the roster in joining order', async () => {
    const client = clientWithTables(
      { data: { owner_id: 'owner-1' }, error: null },
      {
        data: [
          { user_id: 'owner-1', person_id: null, joined_at: '2026-01-01T00:00:00Z' },
          { user_id: 'guest-1', person_id: 'person-a', joined_at: '2026-01-02T00:00:00Z' },
        ],
        error: null,
      },
    );

    await expect(listTripMembers(client, 'trip-1')).resolves.toEqual({
      status: 'ok',
      ownerId: 'owner-1',
      members: [
        { userId: 'owner-1', personId: null, joinedAt: '2026-01-01T00:00:00Z' },
        { userId: 'guest-1', personId: 'person-a', joinedAt: '2026-01-02T00:00:00Z' },
      ],
    });
  });

  it('answers a null organiser when the trip row is not readable', async () => {
    const client = clientWithTables({ data: null, error: null }, { data: [], error: null });
    await expect(listTripMembers(client, 'trip-1')).resolves.toEqual({
      status: 'ok',
      ownerId: null,
      members: [],
    });
  });

  it('reports a failed trip read', async () => {
    const client = clientWithTables(
      { data: null, error: { message: 'trips refused' } },
      { data: [], error: null },
    );
    await expect(listTripMembers(client, 'trip-1')).resolves.toEqual({
      status: 'error',
      message: 'trips refused',
    });
  });

  it('reports a failed roster read', async () => {
    const client = clientWithTables(
      { data: { owner_id: 'owner-1' }, error: null },
      { data: null, error: { message: 'roster refused' } },
    );
    await expect(listTripMembers(client, 'trip-1')).resolves.toEqual({
      status: 'error',
      message: 'roster refused',
    });
  });

  it('reports a thrown network error', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('offline');
      }),
    } as never;
    await expect(listTripMembers(client, 'trip-1')).resolves.toEqual({
      status: 'error',
      message: 'offline',
    });
  });
});

// ============================================================================
// removeTripMember
// ============================================================================

describe('removeTripMember', () => {
  it('calls the RPC with the trip and the account', async () => {
    const rpc = vi.fn(async () => ({ error: null }));
    await expect(removeTripMember({ rpc } as never, 'trip-1', 'guest-1')).resolves.toEqual({
      status: 'removed',
    });
    expect(rpc).toHaveBeenCalledWith('remove_trip_member', {
      target_trip_id: 'trip-1',
      target_user_id: 'guest-1',
    });
  });

  it('says so when the caller is not the organiser', async () => {
    const rpc = vi.fn(async () => ({ error: { code: '42501', message: 'only the trip organiser' } }));
    await expect(removeTripMember({ rpc } as never, 'trip-1', 'guest-1')).resolves.toEqual({
      status: 'not-owner',
    });
  });

  it('reports any other refusal', async () => {
    const rpc = vi.fn(async () => ({
      error: { code: '22023', message: 'the trip organiser cannot be removed' },
    }));
    await expect(removeTripMember({ rpc } as never, 'trip-1', 'owner-1')).resolves.toEqual({
      status: 'error',
      message: 'the trip organiser cannot be removed',
    });
  });

  it('reports a thrown network error', async () => {
    const rpc = vi.fn(async () => {
      throw new Error('offline');
    });
    await expect(removeTripMember({ rpc } as never, 'trip-1', 'guest-1')).resolves.toEqual({
      status: 'error',
      message: 'offline',
    });
  });
});
