/**
 * Tests for per-account guest group sync.
 *
 * The interesting cases are all reconciliation: which copy of a group wins,
 * which local rows a pull is allowed to delete, and what a hostile or merely
 * broken server row does to the rest of the pull.
 *
 * @module lib/sync/__tests__/guest-groups.test
 */
import { describe, it, expect } from 'vitest';

import { db } from '@/lib/db/database';
import { syncGuestGroups } from '@/lib/sync/guest-groups';
import type { GuestGroup, GuestGroupId, GuestGroupMemberId, HexColor } from '@/types';

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
}

/**
 * A Supabase double covering exactly the two calls this module makes:
 * `select(...).eq('owner_id', …)` and `upsert(…).select(…)`.
 */
function fakeClient(
  initialRows: FakeRow[] = [],
  options: { readonly selectError?: string; readonly upsertError?: string } = {},
): FakeClientResult {
  const rows = [...initialRows],
    upserted: Record<string, unknown>[][] = [];

  const client = {
    from: () => ({
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

  return { client, rows, upserted };
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
// Deletion — the rule worth being careful about
// ============================================================================

describe('pruning', () => {
  it('drops a group this device uploaded that the server no longer lists', async () => {
    await db.guestGroups.add(
      localGroup({ id: 'group-9' as GuestGroupId, remoteGroupId: 'remote-9' }),
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
    });
  });
});
