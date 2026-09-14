/**
 * @fileoverview Tests for TripTemplateCard.
 *
 * The property under defence is the gate. This is an enterprise feature behind
 * a static PostHog cohort, so a person outside it must see nothing at all — not
 * a disabled button, not an empty card, not a flash of one while the flag is
 * still being decided.
 *
 * @module features/sharing/components/__tests__/TripTemplateCard.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { TripTemplateCard } from '../TripTemplateCard';
import { render } from '@/test/utils';
import { copyText } from '@/lib/utils/clipboard';
import { useTripTemplateLink } from '../../hooks/useTripTemplateLink';
import type { ISODateString, ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const flag = vi.fn<() => boolean | undefined>(() => true);
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => flag() }));

vi.mock('@/lib/utils/clipboard', () => ({ copyText: vi.fn(async () => true) }));

const signInDialog = vi.fn();
vi.mock('@/features/auth/components/SignInDialog', () => ({
  SignInDialog: (props: { open: boolean }) => {
    signInDialog(props);
    return props.open ? <div data-testid="sign-in-dialog" /> : null;
  },
}));

const publish = vi.fn(async () => undefined);
const unpublish = vi.fn(async () => undefined);

vi.mock('../../hooks/useTripTemplateLink', () => ({
  useTripTemplateLink: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

const TRIP: Trip = {
  id: 'trip-1' as TripId,
  name: 'Chalet Marmotte',
  startDate: '2026-07-15' as ISODateString,
  endDate: '2026-07-22' as ISODateString,
  shareId: 'share-1' as ShareId,
  createdAt: 1,
  updatedAt: 1,
};

function answering(state: unknown): void {
  vi.mocked(useTripTemplateLink).mockReturnValue({
    state: state as never,
    publish,
    unpublish,
    isBusy: false,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  flag.mockReturnValue(true);
  answering({ kind: 'unpublished' });
});

// ============================================================================
// Tests
// ============================================================================

describe('TripTemplateCard', () => {
  it('renders nothing for a person outside the cohort', () => {
    flag.mockReturnValue(false);

    const { container } = render(<TripTemplateCard trip={TRIP} />, {
      withProviders: false,
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing while the flag is still being decided', () => {
    flag.mockReturnValue(undefined);

    const { container } = render(<TripTemplateCard trip={TRIP} />, {
      withProviders: false,
    });

    expect(container).toBeEmptyDOMElement();
  });

  it('offers to publish a trip that is not a template', () => {
    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    expect(screen.getByRole('button', { name: 'Publish as a template' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take it down' })).not.toBeInTheDocument();
  });

  it('publishes when the button is pressed', async () => {
    const { user } = render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    await user.click(screen.getByRole('button', { name: 'Publish as a template' }));

    expect(publish).toHaveBeenCalledTimes(1);
  });

  it('shows the link, and copies it', async () => {
    answering({
      kind: 'published',
      url: 'https://share.kikouchou.app/fr/t/tokentokentoken1',
      token: 'tokentokentoken1',
    });

    const { user } = render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    expect(screen.getByDisplayValue('https://share.kikouchou.app/fr/t/tokentokentoken1'))
      .toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Copy link' }));

    expect(vi.mocked(copyText)).toHaveBeenCalledWith(
      'https://share.kikouchou.app/fr/t/tokentokentoken1',
    );
  });

  it('says the payload is a copy, so publishing again is what refreshes it', () => {
    answering({ kind: 'published', url: 'https://x.test/t/a', token: 'a' });

    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    expect(screen.getByText(/Publish again after you change the trip/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Publish again' })).toBeInTheDocument();
  });

  it('takes a template down when asked', async () => {
    answering({ kind: 'published', url: 'https://x.test/t/a', token: 'a' });

    const { user } = render(<TripTemplateCard trip={TRIP} />, { withProviders: false });
    await user.click(screen.getByRole('button', { name: 'Take it down' }));

    expect(unpublish).toHaveBeenCalledTimes(1);
  });

  it('offers a sign in rather than a button that would fail', () => {
    answering({ kind: 'needs-account' });

    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Publish as a template' }),
    ).not.toBeInTheDocument();
  });

  it('opens the sign-in dialog from the card', async () => {
    answering({ kind: 'needs-account' });

    const { user } = render(<TripTemplateCard trip={TRIP} />, { withProviders: false });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(screen.getByTestId('sign-in-dialog')).toBeInTheDocument();
  });

  it('selects the whole link when the field takes focus', async () => {
    answering({
      kind: 'published',
      url: 'https://share.kikouchou.app/fr/t/tokentokentoken1',
      token: 'tokentokentoken1',
    });

    const { user } = render(<TripTemplateCard trip={TRIP} />, { withProviders: false });
    const field = screen.getByDisplayValue(
      'https://share.kikouchou.app/fr/t/tokentokentoken1',
    ) as HTMLInputElement;

    await user.click(field);

    // A link is copied by hand as often as by the button.
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(field.value.length);
  });

  it('says when the build has no server, rather than spinning forever', () => {
    answering({ kind: 'unavailable' });

    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    expect(screen.getByRole('alert')).toHaveTextContent(/no sync server configured/);
  });

  it('shows what went wrong', () => {
    answering({ kind: 'error', message: 'permission denied' });

    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    expect(screen.getByRole('alert')).toHaveTextContent('permission denied');
  });

  it('says it is loading while the state is being read', async () => {
    answering({ kind: 'loading' });

    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    await waitFor(() => {
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });
  });
});
