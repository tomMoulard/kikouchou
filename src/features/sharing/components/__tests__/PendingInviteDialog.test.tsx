/**
 * @fileoverview Opening the link for the trip a sign-in was started for.
 *
 * @module features/sharing/components/__tests__/PendingInviteDialog.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PendingInviteDialog } from '../PendingInviteDialog';
import { forgetPendingInvite, readPendingInvite } from '../../utils/pending-invite';
import { captureEvent } from '@/lib/posthog';
import type { Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const auth = vi.hoisted(() => ({
  value: { user: null as { id: string } | null, isResolved: true },
}));
vi.mock('@/features/auth/AuthContext', () => ({ useAuth: () => auth.value }));

const tripContext = vi.hoisted(() => ({
  value: { trips: [] as Trip[], isLoading: false },
}));
vi.mock('@/contexts/TripContext', () => ({ useTripContext: () => tripContext.value }));

vi.mock('../../utils/pending-invite', () => ({
  readPendingInvite: vi.fn(() => null),
  forgetPendingInvite: vi.fn(),
}));

vi.mock('@/lib/posthog', () => ({ captureEvent: vi.fn() }));

vi.mock('../ShareDialog', () => ({
  ShareDialog: ({
    open,
    onOpenChange,
    trip,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    trip: Trip;
  }) =>
    open ? (
      <div role="dialog" aria-label={trip.name}>
        <button
          type="button"
          onClick={() => {
            onOpenChange(false);
          }}
        >
          close
        </button>
      </div>
    ) : null,
}));

const TRIP = { id: 'trip-1' as TripId, name: 'Lake house' } as Trip;

beforeEach(() => {
  vi.clearAllMocks();
  auth.value = { user: { id: 'user-1' }, isResolved: true };
  tripContext.value = { trips: [TRIP], isLoading: false };
  vi.mocked(readPendingInvite).mockReturnValue('trip-1' as TripId);
});

// ============================================================================
// Tests
// ============================================================================

describe('PendingInviteDialog', () => {
  it('opens the link for the remembered trip once signed in, and forgets it', () => {
    render(<PendingInviteDialog />);

    expect(screen.getByRole('dialog', { name: 'Lake house' })).toBeInTheDocument();
    expect(vi.mocked(forgetPendingInvite)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureEvent)).toHaveBeenCalledWith('trip_invite_resumed');
  });

  it('stays closed once dismissed', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PendingInviteDialog />);

    await user.click(screen.getByRole('button', { name: 'close' }));
    rerender(<PendingInviteDialog />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(captureEvent)).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no sign-in was started from the wizard', () => {
    vi.mocked(readPendingInvite).mockReturnValue(null);
    render(<PendingInviteDialog />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(forgetPendingInvite)).not.toHaveBeenCalled();
  });

  it('keeps the trip while signed out, so a later magic link still lands on it', () => {
    auth.value = { user: null, isResolved: true };
    render(<PendingInviteDialog />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(forgetPendingInvite)).not.toHaveBeenCalled();
  });

  it('waits for the session lookup', () => {
    auth.value = { user: null, isResolved: false };
    render(<PendingInviteDialog />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(forgetPendingInvite)).not.toHaveBeenCalled();
  });

  it('waits for the trips to load rather than calling the trip gone', () => {
    tripContext.value = { trips: [], isLoading: true };
    render(<PendingInviteDialog />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(forgetPendingInvite)).not.toHaveBeenCalled();
  });

  it('forgets a trip that is no longer on the device', () => {
    tripContext.value = { trips: [], isLoading: false };
    render(<PendingInviteDialog />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(vi.mocked(forgetPendingInvite)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(captureEvent)).not.toHaveBeenCalled();
  });

  it('reads the key once, on load, and not again on later renders', () => {
    vi.mocked(readPendingInvite).mockReturnValue(null);
    const { rerender } = render(<PendingInviteDialog />);
    vi.mocked(readPendingInvite).mockReturnValue('trip-1' as TripId);

    rerender(<PendingInviteDialog />);

    expect(vi.mocked(readPendingInvite)).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
