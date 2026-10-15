/**
 * @fileoverview Tests for useTemplateRefresh.
 *
 * The property under defence is that a template link follows the trip. An
 * owner who renames the place or rewrites the description after publishing
 * expects the next customer to read the new text, without pressing Publish a
 * second time.
 *
 * The other half is what the hook must not do. It never writes what it found
 * on mount, because a device that has not hydrated yet holds an empty mirror,
 * and publishing that would strip every room from a live template.
 *
 * @module lib/sync/__tests__/useTemplateRefresh.test
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestRoom, createTestTrip, waitForDb } from '@/test/utils';
import { updateTrip } from '@/lib/db/repositories/trip-repository';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { TypedSupabaseClient } from '@/lib/supabase/client';
import type { TripId } from '@/types';

import { useTemplateRefresh } from '../useTemplateRefresh';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));

interface Update {
  readonly table: string;
  readonly row: Record<string, unknown>;
  readonly tripId: unknown;
}

/**
 * A client that records every UPDATE and answers with the rows it is told to.
 *
 * `rows` is what the server matched: one row for a published template, none
 * for a trip that was never published or belongs to somebody else.
 */
function stubClient(answer: () => { data: unknown; error: unknown }): {
  client: TypedSupabaseClient;
  updates: Update[];
} {
  const updates: Update[] = [];
  const client = {
    from(table: string) {
      return {
        update(row: Record<string, unknown>) {
          return {
            eq(_column: string, tripId: unknown) {
              updates.push({ table, row, tripId });
              return { select: async () => answer() };
            },
          };
        },
      };
    },
  } as unknown as TypedSupabaseClient;
  return { client, updates };
}

const PUBLISHED = () => ({ data: [{ trip_id: 'remote-1' }], error: null });

let tripId: TripId;

beforeEach(async () => {
  vi.clearAllMocks();
  tripId = await createTestTrip({ name: 'Chalet Marmotte', startDate: '2026-07-15' });
  await createTestRoom(tripId, { name: 'Attic', capacity: 4 });
  await waitForDb();
});

function mount(options: { online?: boolean; remoteTripId?: string | null; userId?: string | null } = {}) {
  return renderHook(
    (props: { online: boolean }) =>
      useTemplateRefresh({
        tripId,
        remoteTripId: options.remoteTripId === undefined ? 'remote-1' : options.remoteTripId,
        userId: options.userId === undefined ? 'user-1' : options.userId,
        online: props.online,
        debounceMs: 0,
      }),
    { initialProps: { online: options.online ?? true } },
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('useTemplateRefresh', () => {
  it('rewrites the published copy after the owner edits the trip', async () => {
    const { client, updates } = stubClient(PUBLISHED);
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    mount();
    await waitForDb();
    await updateTrip(tripId, { name: 'Chalet Marmotte II', description: 'Check-in after 4pm.' });

    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]?.table).toBe('trip_templates');
    expect(updates[0]?.tripId).toBe('remote-1');
    expect(updates[0]?.row).toMatchObject({
      name: 'Chalet Marmotte II',
      description: 'Check-in after 4pm.',
      rooms: [{ name: 'Attic', capacity: 4 }],
    });
  });

  it('writes nothing for what it found on mount', async () => {
    const { client, updates } = stubClient(PUBLISHED);
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    mount();
    await waitForDb();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(updates).toHaveLength(0);
  });

  it('sends a failed refresh again when the connection comes back', async () => {
    let attempt = 0;
    const { client, updates } = stubClient(() => {
      attempt += 1;
      return attempt === 1
        ? { data: null, error: { message: 'Failed to fetch' } }
        : PUBLISHED();
    });
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    const { rerender } = mount();
    await waitForDb();
    await updateTrip(tripId, { description: 'Bring slippers.' });
    await waitFor(() => expect(updates).toHaveLength(1));

    rerender({ online: false });
    rerender({ online: true });

    await waitFor(() => expect(updates).toHaveLength(2));
    expect(updates[1]?.row).toMatchObject({ description: 'Bring slippers.' });
  });

  it('stays idle for a trip that is not on the server or with nobody signed in', async () => {
    const { client, updates } = stubClient(PUBLISHED);
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    mount({ remoteTripId: null });
    mount({ userId: null });
    await waitForDb();
    await updateTrip(tripId, { description: 'Bring slippers.' });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(updates).toHaveLength(0);
  });
});
