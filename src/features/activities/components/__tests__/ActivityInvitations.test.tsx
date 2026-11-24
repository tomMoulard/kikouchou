/**
 * @fileoverview Tests for the invitations section of an activity.
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import type { Activity, ActivityId, Person, PersonId, TripId } from '@/types';

import { ActivityInvitations } from '../ActivityInvitations';

const guest = (id: string, name: string): Person =>
  ({ id: id as PersonId, tripId: 'trip-1' as TripId, name, color: '#ef4444' }) as Person;

const ALICE = guest('alice', 'Alice');
const BOB = guest('bob', 'Bob');
const CAROL = guest('carol', 'Carol');
const DAN = guest('dan', 'Dan');
const GUESTS = [ALICE, BOB, CAROL, DAN];

const activity = (overrides: Partial<Activity> = {}): Activity => ({
  id: 'act-1' as ActivityId,
  tripId: 'trip-1' as TripId,
  title: 'Exposition',
  category: 'culture',
  startDatetime: '2026-12-23T10:00:00.000Z',
  allDay: false,
  participantIds: [ALICE.id],
  invitedIds: [BOB.id],
  declinedIds: [CAROL.id],
  ...overrides,
});

describe('ActivityInvitations', () => {
  it('offers only the guests neither in nor asked, a no included, and sends the ones picked', async () => {
    const onInvite = vi.fn(async () => 1);
    const { user } = render(
      <ActivityInvitations activity={activity()} guests={GUESTS} onInvite={onInvite} />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: 'activities.invite.button' }));

    expect(screen.queryByRole('checkbox', { name: 'Alice' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Bob' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Carol' })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Dan' }));
    await user.click(screen.getByRole('button', { name: /activities\.invite\.send/ }));

    expect(onInvite).toHaveBeenCalledWith('act-1', ['dan']);
    // Sent: the checklist closes.
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('offers no invitation where the device cannot write, nor when everybody is in or asked', () => {
    const { container, rerender } = render(
      <ActivityInvitations activity={activity()} guests={GUESTS} />,
      { withProviders: false },
    );
    expect(container).toBeEmptyDOMElement();

    rerender(
      <ActivityInvitations
        activity={activity({ participantIds: [ALICE.id, CAROL.id], invitedIds: [BOB.id, DAN.id] })}
        guests={GUESTS}
        onInvite={vi.fn(async () => 0)}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
