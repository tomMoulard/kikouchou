/**
 * @fileoverview The roster's labels in real English, where the mocked `t`
 * would hide a name that was never interpolated.
 *
 * @module features/sharing/components/__tests__/TripMembersPanel.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { TripMembersPanel } from '../TripMembersPanel';
import { db } from '@/lib/db/database';
import { listTripMembers } from '@/lib/sync/members';
import {
  createTestPerson,
  createTestTrip,
  renderWithRealI18n,
  screen,
  userEvent,
} from '@/test/utils';

vi.unmock('i18next');
vi.unmock('react-i18next');

vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => ({ user: { id: 'owner-1' } }) }));
vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/sync/members', () => ({ listTripMembers: vi.fn(), removeTripMember: vi.fn() }));

describe('TripMembersPanel in real English', () => {
  it('interpolates the name into the labels and the confirmation', async () => {
    const tripId = await createTestTrip({ name: 'Brittany', startDate: '2026-07-15' });
    await db.trips.update(tripId, { remoteTripId: 'remote-1' });
    const aliceId = await createTestPerson(tripId, { name: 'Alice' });
    vi.mocked(listTripMembers).mockResolvedValue({
      status: 'ok',
      ownerId: 'owner-1',
      members: [
        { userId: 'owner-1', personId: String(aliceId), joinedAt: '2026-01-01T00:00:00Z' },
        { userId: 'guest-1', personId: null, joinedAt: '2026-01-02T00:00:00Z' },
      ],
    });

    await renderWithRealI18n(<TripMembersPanel tripId={tripId} active />, { withProviders: false });

    expect(await screen.findByText('Alice (you)')).toBeInTheDocument();
    expect(screen.getByText('Someone who has not picked a name yet')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Remove this person?')).toBeInTheDocument();
  });
});
