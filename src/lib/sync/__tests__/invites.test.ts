/**
 * Invite tests.
 *
 * The link parsing is the part most worth pinning: a QR scanner may hand back a
 * full URL, a bare path or the token alone, and someone pasting a link may
 * include or trim the origin. Getting that wrong means a share link that simply
 * does not work, with nothing to diagnose from.
 *
 * The RPC error mapping matters for the same reason — each way an invite can be
 * unusable needs to reach the user as an explanation rather than a Postgres
 * message.
 *
 * @module lib/sync/__tests__/invites.test
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildInviteUrl,
  createInvite,
  extractInviteToken,
  isInviteUsable,
  listInvites,
  redeemInvite,
  revokeInvite,
  type TripInvite,
} from '@/lib/sync/invites';

// ============================================================================
// Helpers
// ============================================================================

function invite(overrides: Partial<TripInvite> = {}): TripInvite {
  return {
    token: 'abcdefghij123456',
    createdAt: '2026-08-31T12:00:00.000Z',
    expiresAt: null,
    maxUses: null,
    uses: 0,
    revokedAt: null,
    ...overrides,
  };
}

/** A client whose `rpc` resolves with whatever the test supplies. */
function clientWithRpc(result: unknown) {
  return {
    rpc: vi.fn(async () => result),
  } as never;
}

// ============================================================================
// Links
// ============================================================================

describe('buildInviteUrl', () => {
  it('builds a link at the app root', () => {
    expect(buildInviteUrl('https://kikouchou.app', '/', 'tok1234567890abc')).toBe(
      'https://kikouchou.app/join/tok1234567890abc',
    );
  });

  it('respects a base path, as GitHub Pages needs', () => {
    expect(
      buildInviteUrl('https://tommoulard.github.io', '/kikouchou/', 'tok1234567890abc'),
    ).toBe('https://tommoulard.github.io/kikouchou/join/tok1234567890abc');
  });

  it('tolerates a base path with no trailing slash', () => {
    expect(
      buildInviteUrl('https://tommoulard.github.io', '/kikouchou', 'tok1234567890abc'),
    ).toBe('https://tommoulard.github.io/kikouchou/join/tok1234567890abc');
  });

  it('round-trips through the parser', () => {
    const token = 'aBcDeFgHiJkL3456';
    const url = buildInviteUrl('https://kikouchou.app', '/kikouchou/', token);

    expect(extractInviteToken(url)).toBe(token);
  });
});

describe('extractInviteToken', () => {
  it.each([
    ['a full URL', 'https://kikouchou.app/join/aBcDeFgHiJkL3456', 'aBcDeFgHiJkL3456'],
    ['a URL under a base path', 'https://x.github.io/kikouchou/join/aBcDeFgHiJkL3456', 'aBcDeFgHiJkL3456'],
    ['a bare path', '/join/aBcDeFgHiJkL3456', 'aBcDeFgHiJkL3456'],
    ['a trailing slash', 'https://kikouchou.app/join/aBcDeFgHiJkL3456/', 'aBcDeFgHiJkL3456'],
    ['the token alone', 'aBcDeFgHiJkL3456', 'aBcDeFgHiJkL3456'],
    ['surrounding whitespace', '  /join/aBcDeFgHiJkL3456  ', 'aBcDeFgHiJkL3456'],
    ['a token using both URL-safe extras', 'https://k.app/join/aB-dEfGhIjKl_456', 'aB-dEfGhIjKl_456'],
  ])('reads %s', (_label, input, expected) => {
    expect(extractInviteToken(input)).toBe(expected);
  });

  it.each([
    ['an empty string', ''],
    ['whitespace only', '   '],
    ['a share link from the old scheme', 'https://kikouchou.app/share/abc1234567'],
    ['the old P2P trip link', 'https://kikouchou.app/trip/room12345678#key'],
    ['some other URL', 'https://example.com/'],
    ['a token that is too short', '/join/abc'],
    ['a path with no token', '/join/'],
  ])('rejects %s', (_label, input) => {
    expect(extractInviteToken(input)).toBeNull();
  });

  it('does not mistake a random 16-character string in a path for a token', () => {
    // Only a bare token, or one under /join/, counts.
    expect(extractInviteToken('https://kikouchou.app/trips/aBcDeFgHiJkL3456')).toBeNull();
  });
});

// ============================================================================
// Usability
// ============================================================================

describe('isInviteUsable', () => {
  const now = new Date('2026-08-31T12:00:00.000Z');

  it('accepts an uncapped, unexpired, unrevoked invite', () => {
    expect(isInviteUsable(invite(), now)).toBe(true);
  });

  it('rejects a revoked invite', () => {
    expect(isInviteUsable(invite({ revokedAt: '2026-08-30T00:00:00.000Z' }), now)).toBe(
      false,
    );
  });

  it('rejects an expired invite', () => {
    expect(isInviteUsable(invite({ expiresAt: '2026-08-30T00:00:00.000Z' }), now)).toBe(
      false,
    );
  });

  it('accepts one expiring in the future', () => {
    expect(isInviteUsable(invite({ expiresAt: '2026-09-30T00:00:00.000Z' }), now)).toBe(
      true,
    );
  });

  it('rejects one whose uses are spent', () => {
    expect(isInviteUsable(invite({ maxUses: 2, uses: 2 }), now)).toBe(false);
  });

  it('accepts one with uses remaining', () => {
    expect(isInviteUsable(invite({ maxUses: 3, uses: 2 }), now)).toBe(true);
  });
});

// ============================================================================
// Redeeming
// ============================================================================

describe('redeemInvite', () => {
  it('returns the trip id on success', async () => {
    const client = clientWithRpc({ data: 'aaaaaaaa-0000-0000-0000-000000000001', error: null });

    await expect(redeemInvite(client, 'tok1234567890abc')).resolves.toEqual({
      status: 'joined',
      remoteTripId: 'aaaaaaaa-0000-0000-0000-000000000001',
    });
  });

  it.each([
    ['invite_not_found', 'not-found'],
    ['invite_revoked', 'revoked'],
    ['invite_expired', 'expired'],
    ['invite_exhausted', 'exhausted'],
  ])('maps the %s hint to %s', async (hint, status) => {
    // The migration sets these hints deliberately, so they are the contract —
    // matched before the human-readable message, which could be reworded.
    const client = clientWithRpc({
      data: null,
      error: { message: 'whatever the wording is', hint },
    });

    await expect(redeemInvite(client, 'tok1234567890abc')).resolves.toEqual({ status });
  });

  it('maps a missing session to unauthenticated', async () => {
    const client = clientWithRpc({
      data: null,
      error: { message: 'authentication required', code: '28000' },
    });

    await expect(redeemInvite(client, 'tok1234567890abc')).resolves.toEqual({
      status: 'unauthenticated',
    });
  });

  it('surfaces an unrecognised error rather than swallowing it', async () => {
    const client = clientWithRpc({
      data: null,
      error: { message: 'connection reset' },
    });

    await expect(redeemInvite(client, 'tok1234567890abc')).resolves.toEqual({
      status: 'error',
      message: 'connection reset',
    });
  });

  it('treats a rejection — the offline case — as an error', async () => {
    const client = {
      rpc: vi.fn(async () => {
        throw new Error('Failed to fetch');
      }),
    } as never;

    await expect(redeemInvite(client, 'tok1234567890abc')).resolves.toEqual({
      status: 'error',
      message: 'Failed to fetch',
    });
  });

  it('rejects a success response that carries no trip id', async () => {
    const client = clientWithRpc({ data: null, error: null });

    await expect(redeemInvite(client, 'tok1234567890abc')).resolves.toMatchObject({
      status: 'error',
    });
  });
});

// ============================================================================
// Creating and listing
// ============================================================================

describe('createInvite', () => {
  it('mints a token and returns the row', async () => {
    const insert = vi.fn(() => ({
      select: () => ({
        single: async () => ({
          data: {
            token: 'server-echoed-tok',
            created_at: '2026-08-31T12:00:00.000Z',
            expires_at: null,
            max_uses: null,
            uses: 0,
            revoked_at: null,
          },
          error: null,
        }),
      }),
    }));
    const client = { from: () => ({ insert }) } as never;

    const result = await createInvite(client, 'trip-uuid', 'user-uuid');

    expect(result.status).toBe('created');
    const [values] = insert.mock.calls[0] as unknown as [Record<string, unknown>];
    // 16 characters of nanoid's URL-safe alphabet: within the server's 16..64
    // check constraint, and ~96 bits.
    expect(String(values.token)).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(values.created_by).toBe('user-uuid');
  });

  it('omits expiry and cap when not asked for', async () => {
    const insert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: {}, error: null }) }),
    }));
    const client = { from: () => ({ insert }) } as never;

    await createInvite(client, 'trip-uuid', 'user-uuid');

    const [values] = insert.mock.calls[0] as unknown as [Record<string, unknown>];
    // Null means "no expiry" server-side; sending an explicit null would be the
    // same, but omitting keeps the insert honest about what was requested.
    expect(values).not.toHaveProperty('expires_at');
    expect(values).not.toHaveProperty('max_uses');
  });

  it('passes an expiry and cap through when given', async () => {
    const insert = vi.fn(() => ({
      select: () => ({ single: async () => ({ data: {}, error: null }) }),
    }));
    const client = { from: () => ({ insert }) } as never;

    await createInvite(client, 'trip-uuid', 'user-uuid', {
      expiresAt: new Date('2026-09-07T00:00:00.000Z'),
      maxUses: 5,
    });

    const [values] = insert.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(values.expires_at).toBe('2026-09-07T00:00:00.000Z');
    expect(values.max_uses).toBe(5);
  });

  it('reports a server error rather than throwing', async () => {
    const client = {
      from: () => ({
        insert: () => ({
          select: () => ({
            single: async () => ({ data: null, error: { message: 'denied' } }),
          }),
        }),
      }),
    } as never;

    await expect(createInvite(client, 'trip-uuid', 'user-uuid')).resolves.toEqual({
      status: 'error',
      message: 'denied',
    });
  });
});

describe('listInvites', () => {
  it('returns an empty list when offline rather than throwing', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => {
              throw new Error('Failed to fetch');
            },
          }),
        }),
      }),
    } as never;

    // The share dialog still has to render.
    await expect(listInvites(client, 'trip-uuid')).resolves.toEqual([]);
  });

  it('normalises the server rows', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: async () => ({
              data: [
                {
                  token: 'tok1234567890abc',
                  created_at: '2026-08-31T12:00:00.000Z',
                  expires_at: null,
                  max_uses: 3,
                  uses: 1,
                  revoked_at: null,
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    } as never;

    await expect(listInvites(client, 'trip-uuid')).resolves.toEqual([
      {
        token: 'tok1234567890abc',
        createdAt: '2026-08-31T12:00:00.000Z',
        expiresAt: null,
        maxUses: 3,
        uses: 1,
        revokedAt: null,
      },
    ]);
  });
});

describe('revokeInvite', () => {
  it('reports success', async () => {
    const client = clientWithRpc({ error: null });
    await expect(revokeInvite(client, 'tok1234567890abc')).resolves.toEqual({ ok: true });
  });

  it('reports the reason on failure', async () => {
    const client = clientWithRpc({ error: { message: 'not a member of this trip' } });

    await expect(revokeInvite(client, 'tok1234567890abc')).resolves.toEqual({
      ok: false,
      message: 'not a member of this trip',
    });
  });
});
