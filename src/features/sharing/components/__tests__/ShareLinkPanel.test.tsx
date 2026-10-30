/**
 * @fileoverview The invite link, or why there is none: the body of the share
 * dialog and of the wizard's invite screen.
 *
 * `ShareDialog.test.tsx` covers the states through the dialog. This file
 * covers what only the panel decides: the sign-in in place, the share sheet,
 * and the state it reports up.
 *
 * @module features/sharing/components/__tests__/ShareLinkPanel.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { ShareLinkPanel } from '../ShareLinkPanel';
import { useTripShareLink, type ShareLinkState } from '../../hooks/useTripShareLink';
import { canShareLink, shareLink } from '@/lib/native/share-link';
import { copyText } from '@/lib/utils/clipboard';
import type { ISODateString, ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>) => {
      if (typeof fallback === 'string') {
        return fallback;
      }
      const options = fallback ?? {};
      const template = options.defaultValue;
      if (typeof template !== 'string') {
        return key;
      }
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
        String(options[name] ?? ''),
      );
    },
  }),
}));

vi.mock('../../hooks/useTripShareLink', () => ({ useTripShareLink: vi.fn() }));

vi.mock('@/features/auth/components/ProviderList', () => ({
  ProviderList: () => <div data-testid="provider-list" />,
}));

vi.mock('@/features/auth/components/SignInDialog', () => ({
  SignInDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="sign-in-dialog" /> : null,
}));

vi.mock('@/lib/native/share-link', () => ({
  canShareLink: vi.fn(() => true),
  shareLink: vi.fn(async () => 'shared'),
}));

vi.mock('@/lib/utils/clipboard', () => ({ copyText: vi.fn(async () => true) }));

const mockedLink = vi.mocked(useTripShareLink);

const TRIP: Trip = {
  id: 'trip-1' as TripId,
  name: 'Lake house',
  shareId: 'share-1' as ShareId,
  startDate: '2026-08-10' as ISODateString,
  endDate: '2026-08-20' as ISODateString,
  createdAt: 1,
  updatedAt: 1,
};

const URL = 'https://kikouchou.app/join/aBcDeFgHiJkL3456';

function giveState(state: ShareLinkState): void {
  mockedLink.mockReturnValue({ state, refresh: vi.fn() });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(canShareLink).mockReturnValue(true);
  giveState({ kind: 'loading' });
});

// ============================================================================
// Tests
// ============================================================================

describe('ShareLinkPanel', () => {
  it('asks for the link of the trip it is given, only while active', () => {
    render(<ShareLinkPanel trip={TRIP} active={false} />);

    expect(mockedLink).toHaveBeenCalledWith(TRIP, false);
  });

  it('reports each state it reaches', () => {
    const onStateChange = vi.fn();
    const { rerender } = render(
      <ShareLinkPanel trip={TRIP} active onStateChange={onStateChange} />,
    );
    expect(onStateChange).toHaveBeenLastCalledWith('loading');

    // A new `active` gets past `memo`, which would skip a rerender with the
    // same props.
    giveState({ kind: 'needs-account' });
    rerender(<ShareLinkPanel trip={TRIP} active={false} onStateChange={onStateChange} />);

    expect(onStateChange).toHaveBeenLastCalledWith('needs-account');
  });

  it('puts a sign-in button that opens the dialog by default', async () => {
    giveState({ kind: 'needs-account' });
    const user = userEvent.setup();
    render(<ShareLinkPanel trip={TRIP} active />);

    expect(screen.queryByTestId('provider-list')).not.toBeInTheDocument();
    expect(screen.queryByTestId('sign-in-dialog')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByTestId('sign-in-dialog')).toBeInTheDocument();
  });

  it('lists the providers in place when asked to', () => {
    giveState({ kind: 'needs-account' });
    render(<ShareLinkPanel trip={TRIP} active signIn="inline" />);

    expect(
      screen.getByText(
        'Sharing needs an account, so the people you invite keep seeing your changes.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId('provider-list')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign in' })).not.toBeInTheDocument();
  });

  it('copies the link', async () => {
    giveState({ kind: 'invite', url: URL, token: 'aBcDeFgHiJkL3456' });
    const user = userEvent.setup();
    render(<ShareLinkPanel trip={TRIP} active />);

    await user.click(screen.getByTestId('share-url'));

    expect(vi.mocked(copyText)).toHaveBeenCalledWith(URL);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Link copied' })).toBeInTheDocument();
    });
  });

  it('offers no share sheet unless asked to', () => {
    giveState({ kind: 'invite', url: URL, token: 'aBcDeFgHiJkL3456' });
    render(<ShareLinkPanel trip={TRIP} active />);

    expect(screen.queryByRole('button', { name: 'Send the link' })).not.toBeInTheDocument();
  });

  it('offers no share sheet where the device has none', () => {
    vi.mocked(canShareLink).mockReturnValue(false);
    giveState({ kind: 'invite', url: URL, token: 'aBcDeFgHiJkL3456' });
    render(<ShareLinkPanel trip={TRIP} active withShareSheet />);

    expect(screen.queryByRole('button', { name: 'Send the link' })).not.toBeInTheDocument();
  });

  it('sends the link through the share sheet, with the trip named', async () => {
    giveState({ kind: 'invite', url: URL, token: 'aBcDeFgHiJkL3456' });
    const user = userEvent.setup();
    render(<ShareLinkPanel trip={TRIP} active withShareSheet />);

    await user.click(screen.getByRole('button', { name: 'Send the link' }));

    expect(vi.mocked(shareLink)).toHaveBeenCalledWith({
      url: URL,
      title: 'Lake house',
      text: 'Join Lake house on Kikouchou',
    });
  });

  it('shows a spinner while the link is being made', () => {
    render(<ShareLinkPanel trip={TRIP} active />);

    expect(screen.queryByTestId('share-url')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says why this copy of the app cannot share', () => {
    giveState({ kind: 'unavailable' });
    render(<ShareLinkPanel trip={TRIP} active />);

    expect(screen.getByRole('alert')).toHaveTextContent('no sync server configured');
  });
});
