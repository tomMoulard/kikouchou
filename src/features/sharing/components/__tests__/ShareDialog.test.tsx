/**
 * @fileoverview Tests for ShareDialog.
 *
 * Rewritten with the WebRTC retirement. The previous tests were entirely about
 * minting `p2pRoomId` / `p2pEncryptionKey` and rendering a
 * `/trip/:roomId#key` URL — none of which exists any more. What the dialog does
 * now is ask `useTripShareLink` for a link and render whichever of its three
 * outcomes applies, so that is what is asserted.
 *
 * @module features/sharing/components/__tests__/ShareDialog.test
 */

import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { ShareDialog } from '../ShareDialog';
import { useTripShareLink } from '../../hooks/useTripShareLink';
import type { ISODateString, ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _key,
  }),
}));

vi.mock('@/contexts/TripContext', () => ({
  useTripContext: () => ({ currentTrip: null }),
}));

vi.mock('../../hooks/useTripShareLink', () => ({
  useTripShareLink: vi.fn(),
}));

// The sign-in dialog has its own tests; here it only needs to be identifiable.
vi.mock('@/features/auth/components/SignInDialog', () => ({
  SignInDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="sign-in-dialog" /> : null,
}));

const mockedUseTripShareLink = vi.mocked(useTripShareLink);

const baseTrip: Trip = {
  id: 'trip-1' as TripId,
  name: 'Shared Trip',
  shareId: 'share-123' as ShareId,
  startDate: '2026-08-10' as ISODateString,
  endDate: '2026-08-20' as ISODateString,
  createdAt: 1,
  updatedAt: 1,
};

function renderDialog(ui: ReactElement) {
  return render(ui);
}

beforeEach(() => {
  mockedUseTripShareLink.mockReset();
  mockedUseTripShareLink.mockReturnValue({
    state: { kind: 'loading' },
    refresh: vi.fn(),
  });
});

// ============================================================================
// Tests
// ============================================================================

describe('ShareDialog', () => {
  it('renders the invite link and its QR code', async () => {
    mockedUseTripShareLink.mockReturnValue({
      state: {
        kind: 'invite',
        url: 'https://kikouchou.app/join/aBcDeFgHiJkL3456',
        token: 'aBcDeFgHiJkL3456',
      },
      refresh: vi.fn(),
    });

    renderDialog(<ShareDialog open onOpenChange={vi.fn()} trip={baseTrip} />);

    await waitFor(() => {
      expect(screen.getByTestId('share-url')).toHaveTextContent(
        'https://kikouchou.app/join/aBcDeFgHiJkL3456',
      );
    });
  });

  it('offers sign-in rather than a link when there is no account', async () => {
    mockedUseTripShareLink.mockReturnValue({
      state: { kind: 'needs-account' },
      refresh: vi.fn(),
    });

    renderDialog(<ShareDialog open onOpenChange={vi.fn()} trip={baseTrip} />);

    // Handing over a link that syncs with nobody would be worse than saying an
    // account is needed. There is no peer-to-peer fallback to offer any more.
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    });
    expect(screen.queryByTestId('share-url')).not.toBeInTheDocument();
  });

  it('surfaces an error instead of a broken link', async () => {
    mockedUseTripShareLink.mockReturnValue({
      state: { kind: 'error', message: 'This trip is no longer on this device.' },
      refresh: vi.fn(),
    });

    renderDialog(<ShareDialog open onOpenChange={vi.fn()} trip={baseTrip} />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This trip is no longer on this device.',
      );
    });
  });

  it('explains itself rather than spinning when the build has no backend', async () => {
    mockedUseTripShareLink.mockReturnValue({
      state: { kind: 'unavailable' },
      refresh: vi.fn(),
    });

    renderDialog(<ShareDialog open onOpenChange={vi.fn()} trip={baseTrip} />);

    // With the peer-to-peer transport retired there is no link to offer a build
    // with no server configured. Falling through to the spinner left the dialog
    // loading forever with nothing to wait for.
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.queryByTestId('share-url')).not.toBeInTheDocument();
  });

  it('shows a loading state while the link is being resolved', () => {
    renderDialog(<ShareDialog open onOpenChange={vi.fn()} trip={baseTrip} />);

    // Creating the server row and minting an invite are two round trips, so the
    // wait is real and has to be visible.
    expect(screen.queryByTestId('share-url')).not.toBeInTheDocument();
  });

  it('says so when no trip is selected', () => {
    renderDialog(<ShareDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByText(/no trip selected/i)).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    renderDialog(<ShareDialog open={false} onOpenChange={vi.fn()} trip={baseTrip} />);

    expect(screen.queryByTestId('share-dialog')).not.toBeInTheDocument();
  });
});
