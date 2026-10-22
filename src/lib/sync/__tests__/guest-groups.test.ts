/**
 * Tests for per-account guest group sync.
 *
 * The interesting cases are all reconciliation: which copy of a group wins,
 * which local rows a pull is allowed to delete, and what a hostile or merely
 * broken server row does to the rest of the pull.
 *
 * @module lib/sync/__tests__/guest-groups.test
 */
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

import { db } from '@/lib/db/database';
import {
  isClockSkewMessage,
  isNetworkFailureMessage,
  rememberGuestGroupDeletion,
  syncGuestGroups,
} from '@/lib/sync/guest-groups';
import type { GuestGroup, GuestGroupId, GuestGroupMemberId, HexColor } from '@/types';

import { installLocalStorageDouble } from '@/test/local-storage';

import { fakeSupabase, hasCall } from './support/fake-supabase';

// The carried deletions live in localStorage, which this jsdom does not ship.
installLocalStorageDouble();

// ============================================================================
// Fakes
// ============================================================================

const USER_ID = 'user-1';

/** One row as the server would return it. */
interface FakeRow {
  id: string;
  local_id: string;
  owner_id: string;
  name: string;
  members: unknown;
  updated_at: string;
}

interface FakeClientResult {
  readonly client: never;
  /** Rows the server holds; mutated by the upsert, as a real table would be. */
  readonly rows: FakeRow[];
  /** Payloads the client sent, so a test can assert on what was uploaded. */
  readonly upserted: Record<string, unknown>[][];
  /** Local ids the client asked the server to delete, one list per call. */
  readonly deleted: string[][];
}

/**
 * A Supabase double covering exactly the three calls this module makes:
 * `select(...).eq('owner_id', …)`, `upsert(…).select(…)` and
 * `delete().eq('owner_id', …).in('local_id', …)`.
 */
function fakeClient(
  initialRows: FakeRow[] = [],
  options: {
    readonly selectError?: string;
    readonly upsertError?: string;
    readonly deleteError?: string;
  } = {},
): FakeClientResult {
  const rows = [...initialRows],
    upserted: Record<string, unknown>[][] = [],
    deleted: string[][] = [];

  const client = {
    from: () => ({
      delete: () => ({
        eq: (_column: string, owner: string) => ({
          in: async (_idColumn: string, localIds: string[]) => {
            if (options.deleteError) {
              return { data: null, error: { message: options.deleteError } };
            }
            deleted.push([...localIds]);
            for (let index = rows.length - 1; index >= 0; index -= 1) {
              const row = rows[index];
              if (row && row.owner_id === owner && localIds.includes(row.local_id)) {
                rows.splice(index, 1);
              }
            }
            return { data: null, error: null };
          },
        }),
      }),
      select: () => ({
        eq: async (_column: string, value: string) =>
          options.selectError
            ? { data: null, error: { message: options.selectError } }
            : {
                data: rows
                  .filter((row) => row.owner_id === value)
                  .map((row) => ({ ...row })),
                error: null,
              },
      }),
      upsert: (values: Record<string, unknown>[]) => ({
        select: async () => {
          if (options.upsertError) {
            return { data: null, error: { message: options.upsertError } };
          }

          upserted.push(values);

          const written = values.map((value, index) => {
            const localId = value.local_id as string,
              existing = rows.find((row) => row.local_id === localId);

            if (existing) {
              Object.assign(existing, value);
              return { id: existing.id, local_id: localId };
            }

            const fresh: FakeRow = {
              id: `remote-${localId}-${index}`,
              local_id: localId,
              owner_id: value.owner_id as string,
              name: value.name as string,
              members: value.members,
              updated_at: value.updated_at as string,
            };
            rows.push(fresh);
            return { id: fresh.id, local_id: localId };
          });

          return { data: written, error: null };
        },
      }),
    }),
  } as never;

  return { client, rows, upserted, deleted };
}

// ============================================================================
// Fixtures
// ============================================================================

function localGroup(overrides: Partial<GuestGroup> = {}): GuestGroup {
  return {
    id: 'group-1' as GuestGroupId,
    name: 'Family',
    members: [
      {
        id: 'member-1' as GuestGroupMemberId,
        name: 'Tom + Léa',
        color: '#ef4444' as HexColor,
        headcount: 2,
      },
    ],
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function serverRow(overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: 'remote-1',
    local_id: 'group-1',
    owner_id: USER_ID,
    name: 'Family (server)',
    members: [{ id: 'member-1', name: 'Alice', color: '#3b82f6' }],
    updated_at: new Date(5_000).toISOString(),
    ...overrides,
  };
}

// ============================================================================
// Doing nothing
// ============================================================================

describe('syncGuestGroups without a session', () => {
  it('skips when there is no client', async () => {
    expect(await syncGuestGroups(null, USER_ID)).toEqual({ status: 'skipped' });
  });

  it('skips when nobody is signed in', async () => {
    const { client } = fakeClient();

    expect(await syncGuestGroups(client, null)).toEqual({ status: 'skipped' });
  });

  it('does not touch local groups when it skips', async () => {
    await db.guestGroups.add(localGroup());

    await syncGuestGroups(null, USER_ID);

    expect(await db.guestGroups.count()).toBe(1);
  });
});

// ============================================================================
// Pull
// ============================================================================

describe('pulling', () => {
  it('writes a group this device has never seen', async () => {
    const { client } = fakeClient([serverRow()]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ status: 'synced', pulled: 1 });

    const stored = await db.guestGroups.get('group-1');
    expect(stored?.name).toBe('Family (server)');
    expect(stored?.remoteGroupId).toBe('remote-1');
  });

  it('takes the server copy when it is newer', async () => {
    await db.guestGroups.add(localGroup({ updatedAt: 1_000 }));
    const { client } = fakeClient([serverRow({ updated_at: new Date(9_000).toISOString() })]);

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.name).toBe('Family (server)');
  });

  it('keeps the local copy when it is newer', async () => {
    await db.guestGroups.add(localGroup({ updatedAt: 9_000, remoteGroupId: 'remote-1' }));
    const { client } = fakeClient([serverRow({ updated_at: new Date(1_000).toISOString() })]);

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.name).toBe('Family');
  });

  it('keeps the local copy on an equal timestamp rather than churning it', async () => {
    await db.guestGroups.add(localGroup({ updatedAt: 5_000 }));
    const { client } = fakeClient([serverRow({ updated_at: new Date(5_000).toISOString() })]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ pulled: 0 });
    expect((await db.guestGroups.get('group-1'))?.name).toBe('Family');
  });

  it('preserves the local creation time when the server copy wins', async () => {
    await db.guestGroups.add(localGroup({ createdAt: 42, updatedAt: 1_000 }));
    const { client } = fakeClient([serverRow()]);

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.createdAt).toBe(42);
  });

  it('records the server id on a group the local copy of which wins', async () => {
    await db.guestGroups.add(localGroup({ updatedAt: 9_000 }));
    const { client } = fakeClient([serverRow({ updated_at: new Date(1_000).toISOString() })]);

    await syncGuestGroups(client, USER_ID);

    // Without this the group could never be pruned, because pruning is gated on
    // having a remote id.
    expect((await db.guestGroups.get('group-1'))?.remoteGroupId).toBe('remote-1');
  });
});

// ============================================================================
// Carrying a deletion
// ============================================================================

describe('a group deleted on this device', () => {
  const DELETIONS_KEY = 'kikouchou-guest-group-deletions';

  beforeEach(() => {
    window.localStorage.removeItem(DELETIONS_KEY);
  });

  afterEach(() => {
    window.localStorage.removeItem(DELETIONS_KEY);
  });

  it('is deleted on the server before the pull can put it back', async () => {
    // The push is an upsert of what Dexie holds and the pull restores any
    // server row Dexie lacks, so without a carried deletion the group came back
    // within a second and could not be deleted at all.
    const { client, rows, deleted } = fakeClient([serverRow()]);
    rememberGuestGroupDeletion('group-1' as GuestGroupId);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ status: 'synced', deleted: 1, pulled: 0 });
    expect(deleted).toEqual([['group-1']]);
    expect(rows).toHaveLength(0);
    expect(await db.guestGroups.count()).toBe(0);
    expect(window.localStorage.getItem(DELETIONS_KEY)).toBeNull();
  });

  it('records each id once', () => {
    rememberGuestGroupDeletion('group-1' as GuestGroupId);
    rememberGuestGroupDeletion('group-1' as GuestGroupId);
    rememberGuestGroupDeletion('group-2' as GuestGroupId);

    expect(JSON.parse(window.localStorage.getItem(DELETIONS_KEY) ?? '[]')).toEqual([
      'group-1',
      'group-2',
    ]);
  });

  it('stays pending when the server cannot be told', async () => {
    const { client, rows } = fakeClient([serverRow()], { deleteError: 'Failed to fetch' });
    rememberGuestGroupDeletion('group-1' as GuestGroupId);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ status: 'error', reason: 'network' });
    expect(rows).toHaveLength(1);
    // Nothing was pulled either: the deletion goes first, so a failed one
    // cannot be followed by a pull that restores the group.
    expect(await db.guestGroups.count()).toBe(0);
    expect(JSON.parse(window.localStorage.getItem(DELETIONS_KEY) ?? '[]')).toEqual(['group-1']);
  });

  it('sends nothing when there is nothing pending', async () => {
    const { client, deleted } = fakeClient([serverRow()]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ status: 'synced', deleted: 0, pulled: 1 });
    expect(deleted).toEqual([]);
  });
});

// ============================================================================
// Deletion — the rule worth being careful about
// ============================================================================

describe('pruning', () => {
  it('drops a group this device uploaded that the server no longer lists', async () => {
    await db.guestGroups.add(
      localGroup({
        id: 'group-9' as GuestGroupId,
        remoteGroupId: 'remote-9',
        remoteOwnerId: USER_ID,
      }),
    );
    const { client } = fakeClient([]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ pruned: 1 });
    expect(await db.guestGroups.get('group-9')).toBeUndefined();
  });

  it('never drops a group that was created offline and not yet pushed', async () => {
    // The whole point: an empty server answer is not evidence about a row the
    // server has never been told about.
    await db.guestGroups.add(localGroup({ id: 'group-local' as GuestGroupId }));
    const { client } = fakeClient([]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ pruned: 0 });
    expect(await db.guestGroups.get('group-local')).toBeDefined();
  });

  it('never drops a group that belongs to another account', async () => {
    // The pull asks for `owner_id = <the signed-in account>`, so a group
    // uploaded under a different one is missing from the answer for a reason
    // that has nothing to do with deletion. Signing in as a second person on a
    // shared browser used to delete the first person's groups off the device.
    await db.guestGroups.add(
      localGroup({
        id: 'group-other' as GuestGroupId,
        remoteGroupId: 'remote-other',
        remoteOwnerId: 'user-2',
      }),
    );
    const { client } = fakeClient([]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ pruned: 0 });
    expect(await db.guestGroups.get('group-other')).toBeDefined();
  });

  it('never drops a group uploaded before the owner was recorded', async () => {
    // A row written by an older build carries a remote id and no owner. Nothing
    // is known about which account issued it, so nothing is inferred.
    await db.guestGroups.add(
      localGroup({ id: 'group-old' as GuestGroupId, remoteGroupId: 'remote-old' }),
    );
    const { client } = fakeClient([]);

    expect(await syncGuestGroups(client, USER_ID)).toMatchObject({ pruned: 0 });
    expect(await db.guestGroups.get('group-old')).toBeDefined();
  });

  it('keeps a group the server still lists', async () => {
    await db.guestGroups.add(localGroup({ remoteGroupId: 'remote-1' }));
    const { client } = fakeClient([serverRow()]);

    await syncGuestGroups(client, USER_ID);

    expect(await db.guestGroups.get('group-1')).toBeDefined();
  });
});

// ============================================================================
// Remote input is untrusted
// ============================================================================

describe('bounding what the server sends', () => {
  it('drops a member with no usable colour without losing the group', async () => {
    const { client } = fakeClient([
      serverRow({
        members: [
          { id: 'm1', name: 'Alice', color: 'not-a-colour' },
          { id: 'm2', name: 'Bob', color: '#22c55e' },
        ],
      }),
    ]);

    await syncGuestGroups(client, USER_ID);

    const stored = await db.guestGroups.get('group-1');
    expect(stored?.members.map((member) => member.name)).toEqual(['Bob']);
  });

  it('drops a nameless member', async () => {
    const { client } = fakeClient([
      serverRow({ members: [{ id: 'm1', name: '   ', color: '#22c55e' }] }),
    ]);

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.members).toEqual([]);
  });

  it('clamps an absurd headcount instead of storing it', async () => {
    const { client } = fakeClient([
      serverRow({
        members: [{ id: 'm1', name: 'Crowd', color: '#22c55e', headcount: 10_000 }],
      }),
    ]);

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.members[0]?.headcount).toBe(99);
  });

  it('keeps a child seat kind this build knows', async () => {
    const { client } = fakeClient([
      serverRow({
        members: [{ id: 'm1', name: 'Lila', color: '#22c55e', childSeat: 'booster' }],
      }),
    ]);

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.members[0]?.childSeat).toBe('booster');
  });

  it('drops a child seat kind it does not recognise, keeping the member', async () => {
    // Enum membership rather than "it is a string": the value is rendered as a
    // badge and copied straight onto an imported guest, so an invented kind
    // would travel into the trip and out again through the next changeset.
    const { client } = fakeClient([
      serverRow({
        members: [{ id: 'm1', name: 'Lila', color: '#22c55e', childSeat: 'hammock' }],
      }),
    ]);

    await syncGuestGroups(client, USER_ID);

    const stored = await db.guestGroups.get('group-1');
    expect(stored?.members[0]?.name).toBe('Lila');
    expect(stored?.members[0]?.childSeat).toBeUndefined();
  });

  it('caps a member list longer than a group may hold', async () => {
    const { client } = fakeClient([
      serverRow({
        members: Array.from({ length: 80 }, (_, index) => ({
          id: `m${index}`,
          name: `Guest ${index}`,
          color: '#22c55e',
        })),
      }),
    ]);

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.members).toHaveLength(50);
  });

  it('clips an over-long name rather than storing it', async () => {
    const { client } = fakeClient([serverRow({ name: 'F'.repeat(500) })]);

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.name).toHaveLength(100);
  });

  it('drops one unusable row without losing the rest of the pull', async () => {
    const { client } = fakeClient([
      serverRow({ id: 'remote-bad', local_id: 'group-bad', name: '   ' }),
      serverRow({ id: 'remote-ok', local_id: 'group-ok', name: 'Ski crew' }),
    ]);

    await syncGuestGroups(client, USER_ID);

    expect(await db.guestGroups.get('group-bad')).toBeUndefined();
    expect((await db.guestGroups.get('group-ok'))?.name).toBe('Ski crew');
  });

  it('survives members arriving as something that is not an array', async () => {
    const { client } = fakeClient([serverRow({ members: { nope: true } })]);

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.members).toEqual([]);
  });
});

// ============================================================================
// Push
// ============================================================================

describe('pushing', () => {
  it('uploads a local group and records where it landed', async () => {
    await db.guestGroups.add(localGroup());
    const { client, rows } = fakeClient([]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ status: 'synced', pushed: 1 });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.local_id).toBe('group-1');
    expect((await db.guestGroups.get('group-1'))?.remoteGroupId).toBe(rows[0]?.id);
  });

  it('sends the local id as local_id and the account as owner_id', async () => {
    await db.guestGroups.add(localGroup());
    const { client, upserted } = fakeClient([]);

    await syncGuestGroups(client, USER_ID);

    expect(upserted[0]?.[0]).toMatchObject({
      local_id: 'group-1',
      owner_id: USER_ID,
      name: 'Family',
    });
  });

  it('sends the local updatedAt so last-write-wins compares like with like', async () => {
    await db.guestGroups.add(localGroup({ updatedAt: 7_000 }));
    const { client, upserted } = fakeClient([]);

    await syncGuestGroups(client, USER_ID);

    expect(upserted[0]?.[0]?.updated_at).toBe(new Date(7_000).toISOString());
  });

  it('makes no request when there is nothing to upload', async () => {
    const { client, upserted } = fakeClient([]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ pushed: 0 });
    expect(upserted).toEqual([]);
  });

  it('pushes the settled state, so a pulled group is not re-uploaded stale', async () => {
    await db.guestGroups.add(localGroup({ name: 'Stale', updatedAt: 1_000 }));
    const { client, upserted } = fakeClient([
      serverRow({ name: 'Fresh', updated_at: new Date(9_000).toISOString() }),
    ]);

    await syncGuestGroups(client, USER_ID);

    expect(upserted[0]?.[0]?.name).toBe('Fresh');
  });
});

// ============================================================================
// Failure
// ============================================================================

describe('when the server cannot be reached', () => {
  it('reports a failed pull as an error rather than throwing', async () => {
    const { client } = fakeClient([], { selectError: 'offline' });

    expect(await syncGuestGroups(client, USER_ID)).toEqual({
      status: 'error',
      message: 'offline',
      reason: 'server',
    });
  });

  it('leaves local groups alone when the pull fails', async () => {
    await db.guestGroups.add(localGroup({ remoteGroupId: 'remote-1' }));
    const { client } = fakeClient([], { selectError: 'offline' });

    await syncGuestGroups(client, USER_ID);

    // "Cannot tell" must never be read as "deleted".
    expect(await db.guestGroups.get('group-1')).toBeDefined();
  });

  it('reports a failed push as an error', async () => {
    await db.guestGroups.add(localGroup());
    const { client } = fakeClient([], { upsertError: 'rejected' });

    expect(await syncGuestGroups(client, USER_ID)).toEqual({
      status: 'error',
      message: 'rejected',
      reason: 'server',
    });
  });
});

/**
 * PostHog issue `01a0e1ad`: PostgREST refuses a token whose `iat` is ahead of
 * its own clock with "JWT issued at future". Every occurrence was a device
 * whose clock runs fast — nothing the server or this code can fix, and the
 * next refresh after the clock catches up succeeds.
 */
describe('when the device clock is ahead of the server', () => {
  it('says so, so that the caller can leave it out of error tracking', async () => {
    const { client } = fakeClient([], { selectError: 'JWT issued at future' });

    expect(await syncGuestGroups(client, USER_ID)).toEqual({
      status: 'error',
      message: 'JWT issued at future',
      reason: 'clock',
    });
  });

  it.each(['JWT issued at future', 'jwt issued at future'])(
    'reads "%s" as clock skew',
    (message) => {
      expect(isClockSkewMessage(message)).toBe(true);
    },
  );

  it.each(['JWT expired', 'permission denied for table guest_groups'])(
    'does not read "%s" as clock skew',
    (message) => {
      expect(isClockSkewMessage(message)).toBe(false);
    },
  );
});

describe('when the request never reached the server', () => {
  // postgrest-js hands a failed fetch back as `${name}: ${message}`.
  it('says so, so that the caller can leave it out of error tracking', async () => {
    const { client } = fakeClient([], { selectError: 'TypeError: Failed to fetch' });

    expect(await syncGuestGroups(client, USER_ID)).toEqual({
      status: 'error',
      message: 'TypeError: Failed to fetch',
      reason: 'network',
    });
  });

  it.each([
    'TypeError: Failed to fetch',
    'TypeError: Load failed',
    'TypeError: NetworkError when attempting to fetch resource.',
    'AbortError: signal is aborted without reason',
  ])('reads "%s" as a network failure', (message) => {
    expect(isNetworkFailureMessage(message)).toBe(true);
  });

  it.each([
    'permission denied for table guest_groups',
    'JWT expired',
    'rejected',
  ])('reads "%s" as the server answering', (message) => {
    expect(isNetworkFailureMessage(message)).toBe(false);
  });

  it('reads a bare fetch failure, without the TypeError prefix', () => {
    expect(isNetworkFailureMessage('Failed to fetch')).toBe(true);
  });

  it.each([
    'Request Failed to fetch the row',
    'Wrapped AbortError: signal is aborted',
  ])('only matches the wording at the start: "%s"', (message) => {
    expect(isNetworkFailureMessage(message)).toBe(false);
  });
});

// ============================================================================
// Member bounds, field by field
// ============================================================================

/** Pulls one server row holding `members`, and returns what was stored. */
async function pullMembers(members: unknown): Promise<Record<string, unknown>[]> {
  const { client } = fakeClient([serverRow({ members })]);
  const result = await syncGuestGroups(client, USER_ID);
  expect(result).toMatchObject({ status: 'synced' });
  const stored = await db.guestGroups.get('group-1');
  return (stored?.members ?? []) as unknown as Record<string, unknown>[];
}

const VALID = { id: 'm-ok', name: 'Bob', color: '#22c55e' };

describe('member bounds', () => {
  it('drops an entry that is not an object, without failing the pull', async () => {
    const members = await pullMembers([null, 5, 'Alice', VALID]);

    expect(members.map((member) => member.id)).toEqual(['m-ok']);
  });

  it.each([
    ['an empty id', { ...VALID, id: '' }],
    ['an id that is not a string', { ...VALID, id: 7 }],
    ['an id longer than 64', { ...VALID, id: 'i'.repeat(65) }],
    ['a name that is not a string', { ...VALID, name: 5 }],
    ['a colour that is not a string', { ...VALID, color: ['#22c55e'] }],
  ])('drops a member with %s', async (_label, member) => {
    expect(await pullMembers([member, { ...VALID, id: 'm-2' }])).toHaveLength(1);
  });

  it('keeps an id of exactly 64 characters', async () => {
    const members = await pullMembers([{ ...VALID, id: 'i'.repeat(64) }]);

    expect(members[0]?.id).toBe('i'.repeat(64));
  });

  it('stores only the fields a bare member carries', async () => {
    const members = await pullMembers([VALID]);

    expect(Object.keys(members[0]!).sort()).toEqual(['color', 'id', 'name']);
  });

  it('trims and clips the member name', async () => {
    const members = await pullMembers([
      { ...VALID, name: '  Alice  ' },
      { ...VALID, id: 'm-2', name: 'N'.repeat(150) },
    ]);

    expect(members[0]?.name).toBe('Alice');
    expect(members[1]?.name).toBe('N'.repeat(100));
  });

  it.each([
    ['one person, the default', 1],
    ['zero', 0],
    ['a string', '3'],
    ['infinity', Infinity],
    ['not a number', Number.NaN],
  ])('leaves the headcount off for %s', async (_label, headcount) => {
    const members = await pullMembers([{ ...VALID, headcount }]);

    expect(members[0]).not.toHaveProperty('headcount');
  });

  it('rounds a fractional headcount', async () => {
    const members = await pullMembers([{ ...VALID, headcount: 2.6 }]);

    expect(members[0]?.headcount).toBe(3);
  });

  it.each([
    ['notes', 2000],
    ['phone', 32],
  ])('trims, clips and keeps %s', async (field, max) => {
    const members = await pullMembers([
      { ...VALID, [field]: '  hello  ' },
      { ...VALID, id: 'm-2', [field]: 'x'.repeat(max + 10) },
    ]);

    expect(members[0]?.[field]).toBe('hello');
    expect(members[1]?.[field]).toBe('x'.repeat(max));
  });

  it.each(['notes', 'phone'])('leaves %s off when blank or not text', async (field) => {
    const members = await pullMembers([
      { ...VALID, [field]: '   ' },
      { ...VALID, id: 'm-2', [field]: 42 },
    ]);

    expect(members[0]).not.toHaveProperty(field);
    expect(members[1]).not.toHaveProperty(field);
  });
});

describe('group bounds', () => {
  it.each([
    ['an empty local id', { local_id: '' }],
    ['a local id that is not a string', { local_id: 5 as unknown as string }],
    ['a name that is not a string', { name: 5 as unknown as string }],
    ['an unreadable update time', { updated_at: 'yesterday' }],
  ])('drops a row with %s and keeps the next', async (_label, overrides) => {
    const { client } = fakeClient([
      serverRow({ id: 'remote-bad', ...overrides }),
      serverRow({ id: 'remote-ok', local_id: 'group-ok', name: 'Ski crew' }),
    ]);

    expect(await syncGuestGroups(client, USER_ID)).toMatchObject({ pulled: 1 });
    expect((await db.guestGroups.get('group-ok'))?.name).toBe('Ski crew');
  });

  it('trims the group name', async () => {
    const { client } = fakeClient([serverRow({ name: '  Ski crew  ' })]);

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.name).toBe('Ski crew');
  });
});

// ============================================================================
// Recording where a group lives
// ============================================================================

describe('recording the server copy on a group the local copy of which wins', () => {
  it('records the server id and account even when the push then fails', async () => {
    await db.guestGroups.add(localGroup({ updatedAt: 9_000 }));
    const { client } = fakeClient([serverRow({ updated_at: new Date(1_000).toISOString() })], {
      upsertError: 'rejected',
    });

    await syncGuestGroups(client, USER_ID);

    const stored = await db.guestGroups.get('group-1');
    expect(stored?.remoteGroupId).toBe('remote-1');
    expect(stored?.remoteOwnerId).toBe(USER_ID);
  });

  it('claims the group for this account when another one was recorded', async () => {
    await db.guestGroups.add(
      localGroup({ updatedAt: 9_000, remoteGroupId: 'remote-1', remoteOwnerId: 'user-2' }),
    );
    const { client } = fakeClient([serverRow({ updated_at: new Date(1_000).toISOString() })], {
      upsertError: 'rejected',
    });

    await syncGuestGroups(client, USER_ID);

    expect((await db.guestGroups.get('group-1'))?.remoteOwnerId).toBe(USER_ID);
  });

  it('writes nothing in the pull when the record is already right', async () => {
    await db.guestGroups.add(
      localGroup({ updatedAt: 9_000, remoteGroupId: 'remote-1', remoteOwnerId: USER_ID }),
    );
    const { client } = fakeClient([serverRow({ updated_at: new Date(1_000).toISOString() })]);
    const update = vi.spyOn(db.guestGroups, 'update');

    await syncGuestGroups(client, USER_ID);

    // Once, from the push recording where the upload landed; never from the pull.
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('keeps an uploaded group the server still lists', async () => {
    await db.guestGroups.add(
      localGroup({ updatedAt: 5_000, remoteGroupId: 'remote-1', remoteOwnerId: USER_ID }),
    );
    const { client } = fakeClient([serverRow()]);

    expect(await syncGuestGroups(client, USER_ID)).toMatchObject({ pruned: 0 });
    expect(await db.guestGroups.get('group-1')).toBeDefined();
  });

  it('never prunes a group of this account that has no server id', async () => {
    await db.guestGroups.add(localGroup({ remoteOwnerId: USER_ID }));
    const { client } = fakeClient([], { upsertError: 'rejected' });

    await syncGuestGroups(client, USER_ID);

    expect(await db.guestGroups.get('group-1')).toBeDefined();
  });
});

// ============================================================================
// What goes over the wire
// ============================================================================

describe('guest group queries', () => {
  it('reads this account’s rows, then upserts on the account and local id', async () => {
    await db.guestGroups.add(localGroup());
    const { client, described } = fakeSupabase((query) =>
      hasCall(query, 'upsert')
        ? { data: [{ id: 'remote-1', local_id: 'group-1' }], error: null }
        : { data: [], error: null },
    );

    expect(await syncGuestGroups(client, USER_ID)).toMatchObject({ status: 'synced', pushed: 1 });

    const [read, write] = described();
    expect(read).toBe(
      `guest_groups.select(id, local_id, owner_id, name, members, updated_at).eq(owner_id, ${USER_ID})`,
    );
    expect(write).toMatch(/^guest_groups\.upsert\(/);
    expect(write).toContain(', {"onConflict":"owner_id,local_id"})');
    expect(write).toMatch(/\.select\(id, local_id\)$/);
  });

  it('treats a pull with no data as an empty account', async () => {
    const { client } = fakeSupabase(() => ({ data: null, error: null }));

    expect(await syncGuestGroups(client, USER_ID)).toEqual({
      status: 'synced',
      deleted: 0,
      pulled: 0,
      pushed: 0,
      pruned: 0,
    });
  });

  it('treats an upsert with no rows back as uploaded and recorded nowhere', async () => {
    await db.guestGroups.add(localGroup());
    const { client } = fakeSupabase(() => ({ data: null, error: null }));

    expect(await syncGuestGroups(client, USER_ID)).toMatchObject({
      status: 'synced',
      pushed: 1,
    });
    expect((await db.guestGroups.get('group-1'))?.remoteGroupId).toBeUndefined();
  });

  it('reports a thrown non-Error by its text', async () => {
    const { client } = fakeSupabase(() => {
      throw 'socket closed';
    });

    expect(await syncGuestGroups(client, USER_ID)).toEqual({
      status: 'error',
      message: 'socket closed',
      reason: 'server',
    });
  });
});

// ============================================================================
// A group the server lists under a new id is not a deleted group
// ============================================================================

describe('a group whose server row has a new id', () => {
  // The device recorded `remote-old` for group-1, and the account now lists
  // group-1 under `remote-1`: the row was recreated, by another device or a
  // restore. The server still lists the group, so nothing was deleted.

  it('keeps the local copy that wins, under the id the server reports', async () => {
    await db.guestGroups.add(
      localGroup({ updatedAt: 9_000, remoteGroupId: 'remote-old', remoteOwnerId: USER_ID }),
    );
    const { client } = fakeClient([serverRow({ updated_at: new Date(1_000).toISOString() })], {
      upsertError: 'rejected',
    });

    const result = await syncGuestGroups(client, USER_ID);

    const stored = await db.guestGroups.get('group-1');
    expect(stored?.name).toBe('Family');
    expect(stored?.remoteGroupId).toBe('remote-1');
    expect(result).toMatchObject({ status: 'error' });
  });

  it('keeps the server copy that wins, rather than pruning what it just wrote', async () => {
    await db.guestGroups.add(
      localGroup({ updatedAt: 1_000, remoteGroupId: 'remote-old', remoteOwnerId: USER_ID }),
    );
    const { client } = fakeClient([serverRow({ updated_at: new Date(9_000).toISOString() })]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ status: 'synced', pulled: 1, pruned: 0 });
    const stored = await db.guestGroups.get('group-1');
    expect(stored?.name).toBe('Family (server)');
    expect(stored?.remoteGroupId).toBe('remote-1');
  });

  it('keeps the group when the recreated row is one the pull cannot use', async () => {
    await db.guestGroups.add(
      localGroup({ updatedAt: 9_000, remoteGroupId: 'remote-old', remoteOwnerId: USER_ID }),
    );
    // Listed under its local id, with an unreadable time: dropped as input,
    // and still evidence that the account has the group.
    const { client } = fakeClient([serverRow({ updated_at: 'yesterday' })]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ status: 'synced', pruned: 0 });
    expect((await db.guestGroups.get('group-1'))?.name).toBe('Family');
  });

  it('keeps a group the server lists under its server id, whatever local id the row carries', async () => {
    await db.guestGroups.add(
      localGroup({ updatedAt: 9_000, remoteGroupId: 'remote-1', remoteOwnerId: USER_ID }),
    );
    const { client } = fakeClient([serverRow({ local_id: '' })], { upsertError: 'rejected' });

    await syncGuestGroups(client, USER_ID);

    expect(await db.guestGroups.get('group-1')).toBeDefined();
  });

  it('still prunes a vanished group in the same pull as a recreated one', async () => {
    await db.guestGroups.add(
      localGroup({ updatedAt: 9_000, remoteGroupId: 'remote-old', remoteOwnerId: USER_ID }),
    );
    await db.guestGroups.add(
      localGroup({
        id: 'group-2' as GuestGroupId,
        remoteGroupId: 'remote-2',
        remoteOwnerId: USER_ID,
      }),
    );
    const { client } = fakeClient([serverRow({ updated_at: new Date(1_000).toISOString() })]);

    const result = await syncGuestGroups(client, USER_ID);

    expect(result).toMatchObject({ status: 'synced', pruned: 1 });
    expect(await db.guestGroups.get('group-1')).toBeDefined();
    expect(await db.guestGroups.get('group-2')).toBeUndefined();
  });
});
