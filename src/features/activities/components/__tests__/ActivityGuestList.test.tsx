/**
 * @fileoverview Tests for an activity's guest list and their answers.
 */

import { describe, expect, it } from 'vitest';

import { render, screen, within } from '@/test/utils';
import type { Activity, ActivityId, Person, PersonId, TripId } from '@/types';

import { activityGuestLines } from '../../utils/activity-guest-lines';
import { ActivityGuestList } from '../ActivityGuestList';

const guest = (id: string, name: string): Person =>
  ({ id: id as PersonId, tripId: 'trip-1' as TripId, name, color: '#ef4444' }) as Person;

const ALICE = guest('alice', 'Alice');
const BOB = guest('bob', 'Bob');
const CAROL = guest('carol', 'Carol');
const DAN = guest('dan', 'Dan');
const EVE = guest('eve', 'Eve');
const GUESTS = [ALICE, BOB, CAROL, DAN, EVE];

const activity = (overrides: Partial<Activity> = {}): Activity => ({
  id: 'act-1' as ActivityId,
  tripId: 'trip-1' as TripId,
  title: 'Exposition',
  category: 'culture',
  startDatetime: '2026-12-23T10:00:00.000Z',
  allDay: false,
  participantIds: [DAN.id, ALICE.id],
  invitedIds: [BOB.id],
  declinedIds: [CAROL.id],
  organizerId: ALICE.id,
  ...overrides,
});

describe('activityGuestLines', () => {
  it('lists going, then waiting, then can\'t come, and leaves out the guests not asked', () => {
    expect(
      activityGuestLines(activity(), GUESTS).map(({ person, answer }) => [person.name, answer]),
    ).toEqual([
      ['Alice', 'going'],
      ['Dan', 'going'],
      ['Bob', 'invited'],
      ['Carol', 'declined'],
    ]);
  });

  it('gives the strongest answer when a merged document disagrees', () => {
    const lines = activityGuestLines(
      activity({ participantIds: [BOB.id], invitedIds: [BOB.id, CAROL.id], declinedIds: [CAROL.id] }),
      GUESTS,
    );

    expect(lines.map(({ person, answer }) => [person.name, answer])).toEqual([
      ['Bob', 'going'],
      ['Carol', 'declined'],
    ]);
  });
});

describe('ActivityGuestList', () => {
  it('shows each guest with their answer, and marks the organizer', () => {
    render(<ActivityGuestList activity={activity()} guests={GUESTS} />, { withProviders: false });

    const list = screen.getByRole('list', { name: 'activities.rsvp.listLabel' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.getAttribute('data-answer'))).toEqual([
      'going',
      'going',
      'invited',
      'declined',
    ]);
    expect(within(rows[0] as HTMLElement).getByText('Alice')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('activities.rsvp.organizer')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('activities.rsvp.invited')).toBeInTheDocument();
    expect(within(rows[3] as HTMLElement).getByText('activities.rsvp.declined')).toBeInTheDocument();
    expect(screen.queryByText('Eve')).not.toBeInTheDocument();
  });

  it('shows nothing when nobody is in or asked', () => {
    const { container } = render(
      <ActivityGuestList
        activity={activity({ participantIds: [], invitedIds: [], declinedIds: [] })}
        guests={GUESTS}
      />,
      { withProviders: false },
    );

    expect(container).toBeEmptyDOMElement();
  });
});
