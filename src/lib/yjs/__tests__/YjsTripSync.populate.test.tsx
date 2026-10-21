/**
 * @fileoverview When `YjsSyncObserver` seeds a document from Dexie, and what it
 * does when the seeding fails.
 *
 * The seed is the bridge's own function, so this file replaces it with a spy:
 * what is pinned here is the observer's decision to call it, not the seeding.
 *
 * @module lib/yjs/__tests__/YjsTripSync.populate.test
 */

import { type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';

import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { createTestTrip, render, screen, waitFor, waitForDb } from '@/test/utils';
import type { TripId } from '@/types';

const { mockPopulate } = vi.hoisted(() => ({ mockPopulate: vi.fn() }));

vi.mock('@/lib/yjs/dexie-bridge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/yjs/dexie-bridge')>()),
  populateDocFromDexie: (...args: unknown[]) => mockPopulate(...args),
}));

function TripOpener({ tripId }: { readonly tripId: TripId }): ReactElement {
  const { currentTrip, setCurrentTrip } = useTripContext();

  return (
    <div>
      <span data-testid="current-trip">{currentTrip?.name ?? 'none'}</span>
      <button onClick={() => void setCurrentTrip(tripId)}>open</button>
    </div>
  );
}

async function openTrip(tripId: TripId): Promise<void> {
  const { user } = render(<TripOpener tripId={tripId} />);
  await user.click(screen.getByRole('button', { name: 'open' }));
  await waitFor(() => {
    expect(screen.getByTestId('current-trip')).toHaveTextContent('Brittany');
  });
}

async function makeTrip(): Promise<TripId> {
  return createTestTrip({ name: 'Brittany', startDate: '2026-07-15', endDate: '2026-07-22' });
}

describe('YjsSyncObserver seeding', () => {
  it('seeds a member trip\'s document once it has loaded', async () => {
    mockPopulate.mockResolvedValue(undefined);
    const tripId = await makeTrip();

    await openTrip(tripId);

    await waitFor(() => {
      expect(mockPopulate).toHaveBeenCalledWith(expect.any(Y.Doc), tripId);
    });
    expect(mockPopulate).toHaveBeenCalledTimes(1);
  });

  it('does not seed a document an older build already stamped with its trip', async () => {
    mockPopulate.mockResolvedValue(undefined);
    const tripId = await makeTrip();
    const legacy = new Y.Doc();
    legacy.getMap('meta').set('id', tripId);
    await db.yjsUpdates.add({ tripId, update: Y.encodeStateAsUpdate(legacy) });

    await openTrip(tripId);
    await waitForDb(100);

    expect(mockPopulate).not.toHaveBeenCalled();
  });

  it('logs a seed that failed', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockPopulate.mockRejectedValue(new Error('disk full'));
    const tripId = await makeTrip();

    await openTrip(tripId);

    await waitFor(() => {
      expect(error).toHaveBeenCalledWith(
        '[YjsTripSync] Failed to populate Y.Doc from Dexie:',
        expect.any(Error),
      );
    });
  });
});
