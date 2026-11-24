/**
 * @fileoverview Tests for "You're invited" when the trip opens.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import type { Activity, ActivityId, Person, PersonId, TripId } from '@/types';

const state = vi.hoisted(() => ({
  activities: [] as Activity[],
  myPersonId: 'bob' as string | undefined,
  canToggle: true,
  toggle: vi.fn(async () => true),
  decline: vi.fn(async () => true),
}));

vi.mock('@/contexts/ActivityContext', () => ({
  useActivityContext: () => ({ activities: state.activities }),
}));
vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: () => ({
    getPersonById: (id: string) =>
      id === 'alice' ? ({ id, name: 'Alice', color: '#ef4444' } as Person) : undefined,
  }),
}));
vi.mock('@/features/activities/hooks/useActivityParticipation', () => ({
  useActivityParticipation: () => ({
    myPersonId: state.myPersonId,
    canToggle: state.canToggle,
    toggleParticipation: state.toggle,
  }),
}));
vi.mock('@/features/activities/hooks/useActivityInvitations', () => ({
  useActivityInvitations: () => ({ decline: state.decline }),
}));

import { ActivityInvitationPrompt } from '../ActivityInvitationPrompt';

const activity = (id: string, start: string, overrides: Partial<Activity> = {}): Activity => ({
  id: id as ActivityId,
  tripId: 'trip-1' as TripId,
  title: `Activity ${id}`,
  category: 'culture',
  startDatetime: start,
  allDay: false,
  participantIds: [],
  invitedIds: ['bob' as PersonId],
  invitedBy: 'alice' as PersonId,
  ...overrides,
});

beforeEach(() => {
  state.activities = [];
  state.myPersonId = 'bob';
  state.canToggle = true;
  state.toggle.mockClear();
  state.decline.mockClear();
});

describe('ActivityInvitationPrompt', () => {
  it('asks about the earliest invitation, saying who asks', () => {
    state.activities = [
      activity('late', '2026-12-28T10:00:00.000Z'),
      activity('early', '2026-12-23T10:00:00.000Z'),
    ];
    render(<ActivityInvitationPrompt />, { withProviders: false });

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('activities.invitationPrompt.fromSomeone')).toBeInTheDocument();
  });

  it('joins on "Join"', async () => {
    state.activities = [activity('early', '2026-12-23T10:00:00.000Z')];
    const { user } = render(<ActivityInvitationPrompt />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'activities.invitationPrompt.join' }));

    expect(state.toggle).toHaveBeenCalledWith('early', true);
  });

  it('declines for everybody on "Not this time"', async () => {
    state.activities = [activity('early', '2026-12-23T10:00:00.000Z')];
    const { user } = render(<ActivityInvitationPrompt />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'activities.invitationPrompt.decline' }));

    expect(state.decline).toHaveBeenCalledWith('early');
  });

  it('only puts the question away when closed', async () => {
    state.activities = [activity('early', '2026-12-23T10:00:00.000Z')];
    const { user } = render(<ActivityInvitationPrompt />, { withProviders: false });

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(state.decline).not.toHaveBeenCalled();
    expect(state.toggle).not.toHaveBeenCalled();
  });

  it('asks nothing of a device that does not know who it is, nor about one already in', () => {
    state.activities = [
      activity('in', '2026-12-23T10:00:00.000Z', { participantIds: ['bob' as PersonId] }),
    ];
    const { container, rerender } = render(<ActivityInvitationPrompt />, { withProviders: false });
    expect(container).toBeEmptyDOMElement();

    state.myPersonId = undefined;
    state.activities = [activity('early', '2026-12-23T10:00:00.000Z')];
    rerender(<ActivityInvitationPrompt />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
