/**
 * @fileoverview Which server row `YjsTripSync` hands the sync provider.
 *
 * The provider itself needs a signed-in session to do anything, so it is
 * replaced here by a probe that prints what it was given.
 *
 * @module lib/yjs/__tests__/YjsTripSync.binding.test
 */

import { type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { createTestTrip, render, screen, waitFor } from '@/test/utils';
import type { TripId } from '@/types';

vi.mock('@/lib/sync/SupabaseTripSync', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sync/SupabaseTripSync')>()),
  SupabaseTripSync: ({
    remoteTripId,
    children,
  }: {
    readonly remoteTripId?: string;
    readonly children?: ReactNode;
  }) => (
    <>
      <span data-testid="remote-trip">{remoteTripId ?? 'none'}</span>
      {children}
    </>
  ),
}));

function TripOpener({ tripId }: { readonly tripId: TripId }): ReactElement {
  const { setCurrentTrip } = useTripContext();

  return <button onClick={() => void setCurrentTrip(tripId)}>open</button>;
}

describe('YjsTripSync', () => {
  it('hands the sync provider the trip\'s server row', async () => {
    const tripId = await createTestTrip({
      name: 'Shared',
      startDate: '2026-07-15',
      endDate: '2026-07-22',
    });
    await db.trips.update(tripId, { remoteTripId: 'aaaaaaaa-0000-0000-0000-000000000003' });

    const { user } = render(<TripOpener tripId={tripId} />);
    await user.click(screen.getByRole('button', { name: 'open' }));

    await waitFor(() => {
      expect(screen.getByTestId('remote-trip')).toHaveTextContent(
        'aaaaaaaa-0000-0000-0000-000000000003',
      );
    });
  });
});
