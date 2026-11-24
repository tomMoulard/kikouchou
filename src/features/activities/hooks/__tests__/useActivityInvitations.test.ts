/**
 * @fileoverview Tests for inviting guests to an activity, and answering an
 * invitation, as the guest holding this device.
 *
 * @module features/activities/hooks/__tests__/useActivityInvitations.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import type { ActivityId, PersonId, Trip, TripId } from '@/types';

const mockInviteToActivity = vi.fn();
const mockDecline = vi.fn();
const mockNotifySuccess = vi.fn();
const mockReportFailure = vi.fn();
const mockRequestTripNotification = vi.fn();
const mockUseTripIdentity = vi.fn();

const TRIP = { id: 'trip-1' as TripId, name: 'Trip' } as Trip;

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip: TRIP }),
}));
vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess }),
  useTripIdentity: () => mockUseTripIdentity(),
}));
vi.mock('@/hooks/useTripAccess', () => ({
  useTripAccess: () => ({ canEdit: true }),
}));
vi.mock('@/lib/db', () => ({
  inviteToActivity: (...args: unknown[]) => mockInviteToActivity(...args),
  declineActivityInvitation: (...args: unknown[]) => mockDecline(...args),
}));
vi.mock('@/lib/errors/report-failure', () => ({
  reportFailure: (...args: unknown[]) => mockReportFailure(...args),
}));
vi.mock('@/lib/notifications/trip-notify', () => ({
  requestTripNotification: (...args: unknown[]) => mockRequestTripNotification(...args),
}));

import { useActivityInvitations } from '../useActivityInvitations';

const ACTIVITY_ID = 'activity-1' as ActivityId;
const ME = 'person-me' as PersonId;
const MAUD = 'person-maud' as PersonId;
const JULES = 'person-jules' as PersonId;

describe('useActivityInvitations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseTripIdentity.mockReturnValue({ myPersonId: ME });
    mockInviteToActivity.mockResolvedValue([MAUD, JULES]);
    mockDecline.mockResolvedValue(undefined);
  });

  it('invites as this device, tells the invited guests and says so', async () => {
    const { result } = renderHook(() => useActivityInvitations());

    let added = 0;
    await act(async () => {
      added = await result.current.invite(ACTIVITY_ID, [MAUD, JULES]);
    });

    expect(added).toBe(2);
    expect(mockInviteToActivity).toHaveBeenCalledWith(ACTIVITY_ID, TRIP.id, [MAUD, JULES], ME);
    expect(mockRequestTripNotification).toHaveBeenCalledWith(TRIP, {
      kind: 'activity_invite',
      subjectId: ACTIVITY_ID,
    });
    expect(mockNotifySuccess).toHaveBeenCalledWith('activities.invite.sent');
  });

  // The activity dialog folds the count into its own "Activity created".
  it('leaves the confirmation to the caller when asked to be quiet', async () => {
    const { result } = renderHook(() => useActivityInvitations());

    let added = 0;
    await act(async () => {
      added = await result.current.invite(ACTIVITY_ID, [MAUD, JULES], { quiet: true });
    });

    expect(added).toBe(2);
    expect(mockRequestTripNotification).toHaveBeenCalledTimes(1);
    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('tells nobody and says nothing when every guest was already asked', async () => {
    mockInviteToActivity.mockResolvedValue([]);
    const { result } = renderHook(() => useActivityInvitations());

    await act(async () => {
      await result.current.invite(ACTIVITY_ID, [MAUD]);
    });

    expect(mockRequestTripNotification).not.toHaveBeenCalled();
    expect(mockNotifySuccess).not.toHaveBeenCalled();
  });

  it('reports a failure, quiet or not, and answers 0', async () => {
    const failure = new Error('disk full');
    mockInviteToActivity.mockRejectedValue(failure);
    const { result } = renderHook(() => useActivityInvitations());

    let added = -1;
    await act(async () => {
      added = await result.current.invite(ACTIVITY_ID, [MAUD], { quiet: true });
    });

    expect(added).toBe(0);
    expect(mockReportFailure).toHaveBeenCalledWith(
      'useActivityInvitations.invite',
      failure,
      'activities.invite.failed',
    );
  });

  it('declines for the guest holding this device', async () => {
    const { result } = renderHook(() => useActivityInvitations());

    let declined = false;
    await act(async () => {
      declined = await result.current.decline(ACTIVITY_ID);
    });

    expect(declined).toBe(true);
    expect(mockDecline).toHaveBeenCalledWith(ACTIVITY_ID, TRIP.id, ME);
    expect(mockNotifySuccess).toHaveBeenCalledWith('activities.invite.declined');
  });
});
