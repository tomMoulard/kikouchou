/**
 * @fileoverview Tests for the trip template client.
 *
 * Two properties are defended here. The link an enterprise hands out is stable,
 * so publishing an already-published trip reuses its token rather than minting
 * a second one and orphaning every copy of the first.
 *
 * And the payload a stranger's browser receives is bounded before anything acts
 * on it. This module reads a server answer over an anonymous function, which is
 * exactly the boundary where a room with a capacity of one billion, a string of
 * ten megabytes or an icon that is an object have to stop.
 *
 * @module lib/sync/__tests__/templates.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildTemplateUrl,
  publishTemplate,
  readTemplateState,
  readTripTemplate,
  unpublishTemplate,
  type TripTemplatePayload,
} from '../templates';
import type { TypedSupabaseClient } from '@/lib/supabase/client';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('nanoid', () => ({ nanoid: () => 'mintedtoken00001' }));

interface StubOptions {
  readonly rpc?: { data?: unknown; error?: unknown };
  readonly tripRow?: { data?: unknown; error?: unknown };
  readonly updateRows?: { data?: unknown; error?: unknown };
  readonly upsertError?: unknown;
  readonly throws?: Error;
}

interface Calls {
  upserts: unknown[];
  updates: unknown[];
  rpc: unknown[];
}

/**
 * A Supabase double shaped like the two builders this module uses.
 *
 * Hand-rolled rather than generated: the module chains `.from().update().eq()
 * .select()`, and a double that answers the chain is what proves the chain is
 * the one the server expects.
 */
function stubClient(options: StubOptions = {}): {
  client: TypedSupabaseClient;
  calls: Calls;
} {
  const calls: Calls = { upserts: [], updates: [], rpc: [] };

  const client = {
    from(table: string) {
      if (options.throws) {
        throw options.throws;
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => options.tripRow ?? { data: null, error: null },
          }),
        }),
        upsert: async (row: unknown) => {
          calls.upserts.push({ table, row });
          return { error: options.upsertError ?? null };
        },
        update: (row: unknown) => {
          calls.updates.push({ table, row });
          return {
            eq: () => ({
              select: async () => options.updateRows ?? { data: [], error: null },
            }),
          };
        },
      };
    },
    rpc: async (name: string, args: unknown) => {
      calls.rpc.push({ name, args });
      if (options.throws) {
        throw options.throws;
      }
      return options.rpc ?? { data: null, error: null };
    },
  } as unknown as TypedSupabaseClient;

  return { client, calls };
}

const PAYLOAD: TripTemplatePayload = {
  name: 'Chalet Marmotte',
  description: 'Check-in after 3pm.',
  location: 'Chamonix',
  coordinates: { lat: 45.9237, lon: 6.8694 },
  currency: 'EUR',
  rooms: [{ name: 'Attic', capacity: 4, icon: 'bed-double' }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================================
// Links
// ============================================================================

describe('buildTemplateUrl', () => {
  it('puts the template behind its own segment on the preview host', () => {
    expect(
      buildTemplateUrl('https://app.kikouchou.app', '/', 'tokentokentoken1', {
        origin: 'https://share.kikouchou.app',
        language: 'fr',
      }),
    ).toBe('https://share.kikouchou.app/fr/t/tokentokentoken1');
  });

  it('trims a trailing slash off the configured origin', () => {
    expect(
      buildTemplateUrl('https://app.kikouchou.app', '/', 'tokentokentoken1', {
        origin: 'https://share.kikouchou.app//',
        language: 'en',
      }),
    ).toBe('https://share.kikouchou.app/en/t/tokentokentoken1');
  });

  it('falls back to the app itself when no preview host is configured', () => {
    expect(
      buildTemplateUrl('https://app.kikouchou.app', '/kikouchou', 'tokentokentoken1', {
        origin: '',
        language: 'en',
      }),
    ).toBe('https://app.kikouchou.app/kikouchou/template/tokentokentoken1');
  });

  it('escapes a token that somehow carries a path character', () => {
    expect(buildTemplateUrl('https://app.kikouchou.app', '/', 'a/b?c')).toBe(
      'https://app.kikouchou.app/template/a%2Fb%3Fc',
    );
  });
});

// ============================================================================
// Reading
// ============================================================================

describe('readTripTemplate', () => {
  it('reads the five published fields', async () => {
    const { client, calls } = stubClient({
      rpc: {
        data: {
          name: 'Chalet Marmotte',
          description: 'Check-in after 3pm.',
          location: 'Chamonix',
          coordinates: { lat: 45.9237, lon: 6.8694 },
          currency: 'EUR',
          rooms: [{ name: 'Attic', capacity: 4, icon: 'bunk-bed' }],
        },
      },
    });

    const result = await readTripTemplate(client, 'tokentokentoken1');

    expect(result).toEqual({ status: 'ok', template: PAYLOAD_WITH_BUNK });
    expect(calls.rpc).toEqual([
      { name: 'read_trip_template', args: { template_token: 'tokentokentoken1' } },
    ]);
  });

  it('reports the one hint as not-found, whatever it was really', async () => {
    const { client } = stubClient({
      rpc: { error: { hint: 'template_not_found', message: 'template not found' } },
    });

    await expect(readTripTemplate(client, 'tokentokentoken1')).resolves.toEqual({
      status: 'not-found',
    });
  });

  it('keeps any other server error as an error', async () => {
    const { client } = stubClient({ rpc: { error: { message: 'boom' } } });

    await expect(readTripTemplate(client, 'tokentokentoken1')).resolves.toEqual({
      status: 'error',
      message: 'boom',
    });
  });

  it('treats an unreadable answer as an error rather than an empty template', async () => {
    const { client } = stubClient({ rpc: { data: { name: '   ' } } });

    const result = await readTripTemplate(client, 'tokentokentoken1');

    expect(result.status).toBe('error');
  });

  it('survives the fetch rejecting, which is what offline looks like', async () => {
    const { client } = stubClient({ throws: new Error('Failed to fetch') });

    await expect(readTripTemplate(client, 'tokentokentoken1')).resolves.toEqual({
      status: 'error',
      message: 'Failed to fetch',
    });
  });

  describe('bounds', () => {
    async function read(data: unknown) {
      const { client } = stubClient({ rpc: { data } });
      return readTripTemplate(client, 'tokentokentoken1');
    }

    it('caps a capacity a server should never have accepted', async () => {
      const result = await read({
        name: 'T',
        rooms: [{ name: 'Attic', capacity: 1_000_000_000 }],
      });

      expect(result).toMatchObject({
        template: { rooms: [{ name: 'Attic', capacity: 50 }] },
      });
    });

    it('raises a capacity of zero to one bed', async () => {
      const result = await read({ name: 'T', rooms: [{ name: 'Attic', capacity: 0 }] });

      expect(result).toMatchObject({ template: { rooms: [{ capacity: 1 }] } });
    });

    it('drops one bad room and keeps the rest', async () => {
      const result = await read({
        name: 'T',
        rooms: [
          { name: 'Attic', capacity: 2 },
          { name: '', capacity: 2 },
          { name: 'Suite' },
          'not a room',
          { name: 'Cabin', capacity: 3 },
        ],
      });

      expect(result).toMatchObject({
        template: { rooms: [{ name: 'Attic' }, { name: 'Cabin' }] },
      });
    });

    it('falls back to a bed for an icon this build cannot draw', async () => {
      const result = await read({
        name: 'T',
        rooms: [{ name: 'Attic', capacity: 2, icon: { evil: true } }],
      });

      expect(result).toMatchObject({ template: { rooms: [{ icon: 'bed-double' }] } });
    });

    it('trims a description to what a phone can render', async () => {
      const result = await read({ name: 'T', description: 'x'.repeat(5_000) });

      expect(
        result.status === 'ok' ? result.template.description?.length : null,
      ).toBe(2_000);
    });

    it('drops coordinates that are not on the planet', async () => {
      const result = await read({ name: 'T', coordinates: { lat: 900, lon: 0 } });

      expect(result).toMatchObject({ template: { coordinates: null } });
    });

    it('keeps at most fifty rooms', async () => {
      const rooms = Array.from({ length: 80 }, (_, index) => ({
        name: `Room ${index}`,
        capacity: 2,
      }));

      const result = await read({ name: 'T', rooms });

      expect(result.status === 'ok' ? result.template.rooms.length : 0).toBe(50);
    });

    it('normalises a currency that is not three capitals', async () => {
      const result = await read({ name: 'T', currency: 'euros' });

      expect(result).toMatchObject({ template: { currency: 'EUR' } });
    });

    it('reads a missing description as nothing rather than as an empty line', async () => {
      const result = await read({ name: 'T' });

      expect(result).toMatchObject({
        template: { description: null, location: null, currency: null, rooms: [] },
      });
    });

    it('refuses a payload that is not an object at all', async () => {
      await expect(read('nope')).resolves.toMatchObject({ status: 'error' });
    });
  });
});

const PAYLOAD_WITH_BUNK: TripTemplatePayload = {
  ...PAYLOAD,
  rooms: [{ name: 'Attic', capacity: 4, icon: 'bunk-bed' }],
};

// ============================================================================
// State
// ============================================================================

describe('readTemplateState', () => {
  it('reads the flag and the token', async () => {
    const { client } = stubClient({
      tripRow: { data: { is_template: true, template_token: 'tokentokentoken1' } },
    });

    await expect(readTemplateState(client, 'remote-1')).resolves.toEqual({
      status: 'ok',
      state: { isTemplate: true, token: 'tokentokentoken1' },
    });
  });

  it('reads a trip that vanished as simply not published', async () => {
    const { client } = stubClient({ tripRow: { data: null } });

    await expect(readTemplateState(client, 'remote-1')).resolves.toEqual({
      status: 'ok',
      state: { isTemplate: false, token: null },
    });
  });

  it('reports a failed read', async () => {
    const { client } = stubClient({ tripRow: { error: { message: 'nope' } } });

    await expect(readTemplateState(client, 'remote-1')).resolves.toEqual({
      status: 'error',
      message: 'nope',
    });
  });

  it('survives the fetch rejecting', async () => {
    const { client } = stubClient({ throws: new Error('offline') });

    await expect(readTemplateState(client, 'remote-1')).resolves.toEqual({
      status: 'error',
      message: 'offline',
    });
  });
});

// ============================================================================
// Publishing
// ============================================================================

describe('publishTemplate', () => {
  it('writes the payload first and the flag second', async () => {
    const { client, calls } = stubClient({
      updateRows: { data: [{ template_token: 'mintedtoken00001' }] },
    });

    const result = await publishTemplate(client, 'remote-1', PAYLOAD);

    expect(result).toEqual({ status: 'published', token: 'mintedtoken00001' });
    // A publish that dies between the two leaves an unreachable payload, which
    // is invisible; the other order would leave every visitor a dead link.
    expect(calls.upserts).toHaveLength(1);
    expect(calls.updates).toHaveLength(1);
    expect(calls.upserts[0]).toMatchObject({ table: 'trip_templates' });
  });

  it('keeps the link a trip already has', async () => {
    const { client, calls } = stubClient({
      updateRows: { data: [{ template_token: 'alreadyhanded001' }] },
    });

    await publishTemplate(client, 'remote-1', PAYLOAD, 'alreadyhanded001');

    expect(calls.updates[0]).toMatchObject({
      row: { is_template: true, template_token: 'alreadyhanded001' },
    });
  });

  it('flattens the payload into the columns the table has', async () => {
    const { client, calls } = stubClient({
      updateRows: { data: [{ template_token: 'mintedtoken00001' }] },
    });

    await publishTemplate(client, 'remote-1', PAYLOAD);

    expect(calls.upserts[0]).toMatchObject({
      row: {
        trip_id: 'remote-1',
        latitude: 45.9237,
        longitude: 6.8694,
        currency: 'EUR',
        rooms: [{ name: 'Attic', capacity: 4, icon: 'bed-double' }],
      },
    });
  });

  it('does not flag the trip when the payload could not be written', async () => {
    const { client, calls } = stubClient({ upsertError: { message: 'denied' } });

    await expect(publishTemplate(client, 'remote-1', PAYLOAD)).resolves.toEqual({
      status: 'error',
      message: 'denied',
    });
    expect(calls.updates).toHaveLength(0);
  });

  it('treats an update that matched no row as a refusal', async () => {
    // An UPDATE matching nothing succeeds with no error, so the affected rows
    // are the only thing that says this device may publish this trip.
    const { client } = stubClient({ updateRows: { data: [] } });

    await expect(publishTemplate(client, 'remote-1', PAYLOAD)).resolves.toMatchObject({
      status: 'error',
    });
  });

  it('reports an update that failed outright', async () => {
    const { client } = stubClient({ updateRows: { error: { message: 'rls' } } });

    await expect(publishTemplate(client, 'remote-1', PAYLOAD)).resolves.toEqual({
      status: 'error',
      message: 'rls',
    });
  });

  it('survives the fetch rejecting', async () => {
    const { client } = stubClient({ throws: new Error('offline') });

    await expect(publishTemplate(client, 'remote-1', PAYLOAD)).resolves.toEqual({
      status: 'error',
      message: 'offline',
    });
  });
});

describe('unpublishTemplate', () => {
  it('clears the flag and keeps the token', async () => {
    const { client, calls } = stubClient({ updateRows: { data: [{ id: 'remote-1' }] } });

    await expect(unpublishTemplate(client, 'remote-1')).resolves.toEqual({
      status: 'unpublished',
    });
    expect(calls.updates[0]).toMatchObject({ row: { is_template: false } });
    expect(JSON.stringify(calls.updates[0])).not.toContain('template_token');
  });

  it('treats an update that matched no row as a refusal', async () => {
    const { client } = stubClient({ updateRows: { data: [] } });

    await expect(unpublishTemplate(client, 'remote-1')).resolves.toMatchObject({
      status: 'error',
    });
  });

  it('reports an update that failed outright', async () => {
    const { client } = stubClient({ updateRows: { error: { message: 'rls' } } });

    await expect(unpublishTemplate(client, 'remote-1')).resolves.toEqual({
      status: 'error',
      message: 'rls',
    });
  });

  it('survives the fetch rejecting', async () => {
    const { client } = stubClient({ throws: new Error('offline') });

    await expect(unpublishTemplate(client, 'remote-1')).resolves.toMatchObject({
      status: 'error',
    });
  });
});
