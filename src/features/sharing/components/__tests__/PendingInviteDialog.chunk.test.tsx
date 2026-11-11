/**
 * @fileoverview The share dialog's lazy chunk failing to load.
 *
 * `App` mounts `PendingInviteDialog` beside the router, outside every route's
 * boundary, so a dialog chunk that would not load was an uncaught error: React
 * 19 unmounted the whole root. A file of its own because `lazy()` keeps what
 * it loaded for the life of the module, so the passing tests next door would
 * hand this one a dialog that had already arrived.
 *
 * @module features/sharing/components/__tests__/PendingInviteDialog.chunk.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { PendingInviteDialog } from '../PendingInviteDialog';
import { forgetPendingInvite } from '../../utils/pending-invite';
import { resetStaleChunkReloadForTests, tryReloadForStaleChunk } from '@/lib/pwa/stale-chunk';
import type { Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const TRIP = { id: 'trip-1' as TripId, name: 'Lake house' } as Trip;

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'user-1' }, isResolved: true }),
}));
vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ trips: [TRIP], isLoading: false }),
}));
vi.mock('../../utils/pending-invite', () => ({
  readPendingInvite: vi.fn(() => 'trip-1'),
  forgetPendingInvite: vi.fn(),
}));
vi.mock('@/lib/posthog', () => ({ captureEvent: vi.fn(), reportError: vi.fn() }));

vi.mock('@/lib/pwa/stale-chunk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/pwa/stale-chunk')>()),
  tryReloadForStaleChunk: vi.fn(() => 'cooldown' as const),
}));

// Reading the export is what fails, the way the module itself failing to
// arrive rejects the lazy import with the browser's own wording.
vi.mock('../ShareDialog', () => ({
  get ShareDialog(): never {
    throw new TypeError(
      'Failed to fetch dynamically imported module: https://app.kikouchou.app/assets/ShareDialog-x1.js',
    );
  },
}));

const mockedReload = vi.mocked(tryReloadForStaleChunk);

beforeEach(() => {
  resetStaleChunkReloadForTests();
  vi.clearAllMocks();
});

// ============================================================================
// Tests
// ============================================================================

describe('PendingInviteDialog when the dialog will not load', () => {
  it('keeps the app on screen and hands the failure to the stale chunk helper', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(
        <>
          <PendingInviteDialog />
          <p>the rest of the app</p>
        </>,
      );

      await waitFor(() => {
        expect(mockedReload).toHaveBeenCalledTimes(1);
      });
      expect(screen.getByText('the rest of the app')).toBeInTheDocument();
      // The reload that follows needs the key to open the dialog after all.
      expect(vi.mocked(forgetPendingInvite)).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });
});
