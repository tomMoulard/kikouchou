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

// ============================================================================
// Edges the mutation run found unpinned
// ============================================================================

/** Lets the live query, the debounce and the write all run. */
async function settle(ms = 60): Promise<void> {
  await waitForDb();
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function mountWith(initial: { tripId: TripId; online: boolean }, debounceMs = 0) {
  return renderHook(
    (props: { tripId: TripId; online: boolean }) =>
      useTemplateRefresh({
        tripId: props.tripId,
        remoteTripId: 'remote-1',
        userId: 'user-1',
        online: props.online,
        debounceMs,
      }),
    { initialProps: initial },
  );
}

describe('useTemplateRefresh, edges', () => {
  it('stays quiet for a trip that is not on this device', async () => {
    const { client, updates } = stubClient(PUBLISHED);
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    const { result } = mountWith({ tripId: 'no-such-trip' as TripId, online: true });
    await settle();

    expect(result.current).toBeUndefined();
    expect(updates).toHaveLength(0);
  });

  it('sends nothing when switching to another trip, which is a mount and not an edit', async () => {
    const { client, updates } = stubClient(PUBLISHED);
    vi.mocked(getSupabaseClient).mockResolvedValue(client);
    const other = await createTestTrip({ name: 'Cabane', startDate: '2026-08-01' });

    const { rerender } = mountWith({ tripId, online: true });
    await settle();
    rerender({ tripId: other, online: true });
    await settle();

    expect(updates).toHaveLength(0);
  });

  it('sends nothing on a reconnect when nothing changed', async () => {
    const { client, updates } = stubClient(PUBLISHED);
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    const { rerender } = mountWith({ tripId, online: true });
    await settle();
    rerender({ tripId, online: false });
    rerender({ tripId, online: true });
    await settle();

    expect(updates).toHaveLength(0);
  });

  it('holds an edit made offline until the connection is back', async () => {
    const { client, updates } = stubClient(PUBLISHED);
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    const { rerender } = mountWith({ tripId, online: true });
    await settle();
    rerender({ tripId, online: false });
    await updateTrip(tripId, { description: 'Bring slippers.' });
    await settle();
    expect(updates).toHaveLength(0);

    rerender({ tripId, online: true });

    await waitFor(() => expect(updates).toHaveLength(1));
  });

  it('settles after a refresh, so a reconnect does not send it again', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client, updates } = stubClient(PUBLISHED);
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    const { rerender } = mountWith({ tripId, online: true });
    await settle();
    await updateTrip(tripId, { description: 'Bring slippers.' });
    await waitFor(() => expect(updates).toHaveLength(1));
    await settle();

    rerender({ tripId, online: false });
    rerender({ tripId, online: true });
    await settle();

    expect(updates).toHaveLength(1);
    expect(error).not.toHaveBeenCalledWith('Failed to refresh the trip template:', expect.anything());
  });

  it('sends each of two edits in a row', async () => {
    const { client, updates } = stubClient(PUBLISHED);
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    mountWith({ tripId, online: true });
    await settle();
    await updateTrip(tripId, { description: 'First.' });
    await waitFor(() => expect(updates).toHaveLength(1));
    await settle();
    await updateTrip(tripId, { description: 'Second.' });

    await waitFor(() => expect(updates).toHaveLength(2));
    expect(updates[1]?.row).toMatchObject({ description: 'Second.' });
  });

  it('logs a failed refresh with its reason', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { client } = stubClient(() => ({ data: null, error: { message: 'Failed to fetch' } }));
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    mountWith({ tripId, online: true });
    await settle();
    await updateTrip(tripId, { description: 'Bring slippers.' });

    await waitFor(() =>
      expect(error).toHaveBeenCalledWith('Failed to refresh the trip template:', 'Failed to fetch'),
    );
  });

  it('does nothing, and logs nothing, with no backend', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(getSupabaseClient).mockResolvedValue(null);

    mountWith({ tripId, online: true });
    await settle();
    await updateTrip(tripId, { description: 'Bring slippers.' });
    await settle();

    expect(error).not.toHaveBeenCalledWith('Failed to refresh the trip template:', expect.anything());
  });

  it('sends one write for a burst of edits', async () => {
    const { client, updates } = stubClient(PUBLISHED);
    vi.mocked(getSupabaseClient).mockResolvedValue(client);

    mountWith({ tripId, online: true }, 80);
    await settle();
    await updateTrip(tripId, { description: 'One.' });
    await waitForDb();
    await updateTrip(tripId, { description: 'Two.' });
    await settle(200);

    expect(updates).toHaveLength(1);
    expect(updates[0]?.row).toMatchObject({ description: 'Two.' });
  });

  it('drops a write whose client arrives after the hook is gone', async () => {
    const { client, updates } = stubClient(PUBLISHED);
    let release: (value: TypedSupabaseClient) => void = () => {};
    vi.mocked(getSupabaseClient).mockReturnValue(
      new Promise<TypedSupabaseClient>((resolve) => {
        release = resolve;
      }) as never,
    );

    const { unmount } = mountWith({ tripId, online: true });
    await settle();
    await updateTrip(tripId, { description: 'Bring slippers.' });
    await settle();
    unmount();
    release(client);
    await settle();

    expect(updates).toHaveLength(0);
  });

  it('keeps the next trip’s baseline when the previous trip’s write lands late', async () => {
    let releaseFirst: () => void = () => {};
    let calls = 0;
    const updates: Update[] = [];
    const client = {
      from(table: string) {
        return {
          update(row: Record<string, unknown>) {
            return {
              eq(_column: string, remote: unknown) {
                updates.push({ table, row, tripId: remote });
                calls += 1;
                return {
                  select: async () => {
                    if (calls === 1) {
                      await new Promise<void>((resolve) => {
                        releaseFirst = resolve;
                      });
                    }
                    return PUBLISHED();
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as TypedSupabaseClient;
    vi.mocked(getSupabaseClient).mockResolvedValue(client);
    const other = await createTestTrip({ name: 'Cabane', startDate: '2026-08-01' });

    const { rerender } = mountWith({ tripId, online: true });
    await settle();
    await updateTrip(tripId, { description: 'For the first trip.' });
    await waitFor(() => expect(updates).toHaveLength(1));

    // Switch while the first trip's write is still in flight, then let it land.
    rerender({ tripId: other, online: true });
    await settle();
    releaseFirst();
    await settle();

    await updateTrip(other, { description: 'For the second trip.' });

    await waitFor(() => expect(updates).toHaveLength(2));
    expect(updates[1]?.row).toMatchObject({ description: 'For the second trip.' });
  });
});
