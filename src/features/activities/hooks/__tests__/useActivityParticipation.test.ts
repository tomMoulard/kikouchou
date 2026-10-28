/**
 * @fileoverview Tests for the one-tap join/leave shared by every activity view.
 *
 * @module features/activities/hooks/__tests__/useActivityParticipation.test
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import type { ActivityId, PersonId } from '@/types';

const mockSetParticipation = vi.fn();
const mockNotifySuccess = vi.fn();
const mockReportFailure = vi.fn();
const mockUseTripIdentity = vi.fn();
const mockUseTripAccess = vi.fn();

vi.mock('@/contexts/ActivityContext', () => ({
  useActivityContext: () => ({ setParticipation: mockSetParticipation }),
}));
vi.mock('@/hooks', () => ({
  useOfflineAwareNotify: () => ({ notifySuccess: mockNotifySuccess }),
  useTripIdentity: () => mockUseTripIdentity(),
}));
vi.mock('@/hooks/useTripAccess', () => ({
  useTripAccess: () => mockUseTripAccess(),
}));
vi.mock('@/lib/errors/report-failure', () => ({
  reportFailure: (...args: unknown[]) => mockReportFailure(...args),
}));

import { useActivityParticipation } from '../useActivityParticipation';

const ACTIVITY_ID = 'activity-1' as ActivityId;
const ME = 'person-me' as PersonId;

describe('useActivityParticipation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetParticipation.mockResolvedValue(undefined);
    mockUseTripIdentity.mockReturnValue({ myPersonId: ME });
    mockUseTripAccess.mockReturnValue({ canEdit: true });
  });

  it('joins as the guest holding the device and says so', async () => {
    const { result } = renderHook(() => useActivityParticipation());

    let saved = false;
    await act(async () => {
      saved = await result.current.toggleParticipation(ACTIVITY_ID, true);
    });

    expect(saved).toBe(true);
    expect(mockSetParticipation).toHaveBeenCalledWith(ACTIVITY_ID, ME, true);
    expect(mockNotifySuccess).toHaveBeenCalledWith('activities.joined');
  });

  it('leaves and says so', async () => {
    const { result } = renderHook(() => useActivityParticipation());

    await act(async () => {
      await result.current.toggleParticipation(ACTIVITY_ID, false);
    });

    expect(mockSetParticipation).toHaveBeenCalledWith(ACTIVITY_ID, ME, false);
    expect(mockNotifySuccess).toHaveBeenCalledWith('activities.left');
  });

  it('reports a failed save instead of claiming it worked', async () => {
    const failure = new Error('offline');
    mockSetParticipation.mockRejectedValue(failure);
    const { result } = renderHook(() => useActivityParticipation());

    let saved = true;
    await act(async () => {
      saved = await result.current.toggleParticipation(ACTIVITY_ID, true);
    });

    expect(saved).toBe(false);
    expect(mockNotifySuccess).not.toHaveBeenCalled();
    expect(mockReportFailure).toHaveBeenCalledWith(
      'useActivityParticipation.toggleParticipation',
      failure,
      'activities.errors.participationFailed',
    );
  });

  it('does nothing, and offers nothing, on a device that does not know who it is', async () => {
    mockUseTripIdentity.mockReturnValue({ myPersonId: undefined });
    const { result } = renderHook(() => useActivityParticipation());

    expect(result.current.canToggle).toBe(false);
    let saved = true;
    await act(async () => {
      saved = await result.current.toggleParticipation(ACTIVITY_ID, true);
    });
    expect(saved).toBe(false);
    expect(mockSetParticipation).not.toHaveBeenCalled();
  });

  it('offers nothing on a viewer trip, which is read and never written', () => {
    mockUseTripAccess.mockReturnValue({ canEdit: false });
    const { result } = renderHook(() => useActivityParticipation());

    expect(result.current.canToggle).toBe(false);
    expect(result.current.myPersonId).toBe(ME);
  });

  it('offers the button to a known guest on a member trip', () => {
    const { result } = renderHook(() => useActivityParticipation());

    expect(result.current.canToggle).toBe(true);
  });
});
