/**
 * @fileoverview What the guest group sync provider sends to error tracking.
 *
 * PostHog issue `01a0e1ad-2d06-7d10-8c22-b4288011254e` held a sync whose
 * request never reached the server: "TypeError: Failed to fetch". The rest of
 * lib/sync treats a lost connection as a warning. This provider reported it as
 * an error, so every dropped connection looked like a broken sync.
 *
 * @module lib/sync/__tests__/GuestGroupSync.test
 */

import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GuestGroupSync } from '@/lib/sync/GuestGroupSync';
import { syncGuestGroups } from '@/lib/sync/guest-groups';
import { reportError } from '@/lib/posthog';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ session: { user: { id: 'user-1' } } }),
}));

vi.mock('@/hooks', () => ({
  useOnlineStatus: () => ({ isOnline: true }),
}));

vi.mock('@/lib/supabase/client', () => ({
  getSupabaseClient: vi.fn(async () => ({})),
}));

vi.mock('@/lib/sync/guest-groups', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sync/guest-groups')>()),
  syncGuestGroups: vi.fn(),
}));

vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
}));

const mockedSync = vi.mocked(syncGuestGroups),
  mockedReport = vi.mocked(reportError);

// ============================================================================
// Tests
// ============================================================================

describe('GuestGroupSync', () => {
  beforeEach(() => {
    mockedSync.mockReset();
    mockedReport.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('warns, and reports nothing, when the request never reached the server', async () => {
    mockedSync.mockResolvedValue({
      status: 'error',
      message: 'TypeError: Failed to fetch',
      reason: 'network',
    });

    render(<GuestGroupSync>{null}</GuestGroupSync>);

    await waitFor(() => {
      expect(console.warn).toHaveBeenCalledWith(
        '[guest-groups] sync failed:',
        'TypeError: Failed to fetch',
      );
    });
    expect(mockedReport).not.toHaveBeenCalled();
  });

  it('reports a sync that the server refused', async () => {
    mockedSync.mockResolvedValue({
      status: 'error',
      message: 'permission denied for table guest_groups',
      reason: 'server',
    });

    render(<GuestGroupSync>{null}</GuestGroupSync>);

    await waitFor(() => {
      expect(mockedReport).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'permission denied for table guest_groups' }),
        { source: 'GuestGroupSync.sync' },
      );
    });
  });
});
