/**
 * The assistant's sharing actions: an invite link and a template link.
 *
 * They reach the server, so the server steps are mocked here; what is under
 * test is the gate in front of them (an account, a backend, the templates
 * flag) and that the link the user needs lands in the change list.
 *
 * @module features/assistant/hooks/__tests__/trip-edit-actions.sharing.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getTripInviteLink } from '@/features/sharing/utils/invite-link';
import {
  publishTripTemplate,
  unpublishTripTemplate,
} from '@/features/sharing/utils/template-link';
import { createTrip } from '@/lib/db/repositories/trip-repository';
import { notify } from '@/lib/notifications';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { TripId } from '@/types';

import { type EditActionContext, runEditAction } from '../trip-edit-actions';

vi.mock('@/lib/supabase/client', () => ({ getSupabaseClient: vi.fn() }));
vi.mock('@/features/sharing/utils/invite-link', () => ({ getTripInviteLink: vi.fn() }));
vi.mock('@/features/sharing/utils/template-link', () => ({
  publishTripTemplate: vi.fn(),
  unpublishTripTemplate: vi.fn(),
}));
vi.mock('@/lib/notifications', () => ({ notify: { error: vi.fn(), success: vi.fn() } }));

const CLIENT = { from: vi.fn() } as never;

function contextFor(
  tripId: TripId | null,
  overrides: Partial<EditActionContext> = {},
): EditActionContext {
  return {
    t: ((key: string) => key) as never,
    tripId,
    mealPlanner: false,
    templatesEnabled: true,
    userId: 'user-1',
    notifySuccess: vi.fn(),
    guestGroups: { createFromPersons: vi.fn(), update: vi.fn(), remove: vi.fn() },
    ...overrides,
  };
}

describe('runEditAction: sharing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getSupabaseClient).mockResolvedValue(CLIENT);
  });

  it('puts the invite link in the change list', async () => {
    const trip = await createTrip({ name: 'Brittany' });
    vi.mocked(getTripInviteLink).mockResolvedValue({
      kind: 'invite',
      token: 'tok',
      url: 'https://app.example/join/tok',
    });

    const lines = await runEditAction(
      { action: 'createInviteLink', data: {} },
      contextFor(trip.id),
    );

    expect(lines).toEqual(['assistant.actionDetails.createInviteLink']);
    expect(getTripInviteLink).toHaveBeenCalledWith(CLIENT, 'user-1', trip.id, null);
  });

  it('asks for an account before it reaches the server', async () => {
    const trip = await createTrip({ name: 'Brittany' });

    const lines = await runEditAction(
      { action: 'createInviteLink', data: {} },
      contextFor(trip.id, { userId: null }),
    );

    expect(lines).toEqual([]);
    expect(notify.error).toHaveBeenCalledWith('assistant.needsAccount');
    expect(getTripInviteLink).not.toHaveBeenCalled();
  });

  it('says so when the build has no backend', async () => {
    const trip = await createTrip({ name: 'Brittany' });
    vi.mocked(getSupabaseClient).mockResolvedValue(null);

    const lines = await runEditAction(
      { action: 'createInviteLink', data: {} },
      contextFor(trip.id),
    );

    expect(lines).toEqual([]);
    expect(notify.error).toHaveBeenCalledWith('assistant.sharingUnavailable');
  });

  it('reports a refused invite rather than a success', async () => {
    const trip = await createTrip({ name: 'Brittany' });
    vi.mocked(getTripInviteLink).mockResolvedValue({ kind: 'error', message: 'upload failed' });

    const lines = await runEditAction(
      { action: 'createInviteLink', data: {} },
      contextFor(trip.id),
    );

    expect(lines).toEqual([]);
    expect(notify.error).toHaveBeenCalledWith('assistant.sharingFailed');
  });

  it('publishes and withdraws a template where the flag is on', async () => {
    const trip = await createTrip({ name: 'Brittany' });
    vi.mocked(publishTripTemplate).mockResolvedValue({
      status: 'published',
      url: 'https://app.example/template/t',
      cardUrl: null,
      token: 't',
    });
    vi.mocked(unpublishTripTemplate).mockResolvedValue({ status: 'unpublished' });

    const published = await runEditAction(
      { action: 'publishTemplate', data: {} },
      contextFor(trip.id),
    );
    const withdrawn = await runEditAction(
      { action: 'unpublishTemplate', data: {} },
      contextFor(trip.id),
    );

    expect(published).toEqual(['assistant.actionDetails.publishTemplate']);
    expect(withdrawn).toEqual(['assistant.actionDetails.unpublishTemplate']);
  });

  it('refuses a template where the flag is off', async () => {
    const trip = await createTrip({ name: 'Brittany' });

    const lines = await runEditAction(
      { action: 'publishTemplate', data: {} },
      contextFor(trip.id, { templatesEnabled: false }),
    );

    expect(lines).toEqual([]);
    expect(notify.error).toHaveBeenCalledWith('assistant.templatesOff');
    expect(publishTripTemplate).not.toHaveBeenCalled();
  });

  it('needs a trip, and leaves an unknown action to the caller', async () => {
    expect(
      await runEditAction({ action: 'createInviteLink', data: {} }, contextFor(null)),
    ).toEqual([]);
    expect(notify.error).toHaveBeenCalledWith('assistant.noTripForAction');
    expect(await runEditAction({ action: 'noSuchAction', data: {} }, contextFor(null))).toBeNull();
  });
});
