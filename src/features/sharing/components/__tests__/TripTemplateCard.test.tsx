/**
 * @fileoverview Tests for TripTemplateCard.
 *
 * The property under defence is the gate, and what the gate now decides. The
 * card describes the feature to everybody, so a person outside the static
 * PostHog cohort reads what a template is and meets a publish button that does
 * not work — never one that does, and never one while the flag is still being
 * decided. The second button in that arm is the paid-tier question, and it must
 * be the same offer the upgrade card opens.
 *
 * @module features/sharing/components/__tests__/TripTemplateCard.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { TripTemplateCard } from '../TripTemplateCard';
import { render } from '@/test/utils';
import { captureEvent } from '@/lib/posthog';
import { copyText } from '@/lib/utils/clipboard';
import { useTripTemplateLink } from '../../hooks/useTripTemplateLink';
import type { ISODateString, ShareId, Trip, TripId } from '@/types';

// ============================================================================
// Test doubles
// ============================================================================

const flag = vi.fn<() => boolean | undefined>(() => true);
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => flag() }));

vi.mock('@/lib/utils/clipboard', () => ({ copyText: vi.fn(async () => true) }));

vi.mock('@/lib/posthog', () => ({
  captureEvent: vi.fn(),
  setPersonProperties: vi.fn(),
}));

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

// The card passes a fallback string; the shared upgrade dialog passes an
// interpolation bag instead. Returning the bag would hand React an object to
// render, so only a string counts as a fallback here.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
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
  it('describes the feature to a person outside the cohort', () => {
    flag.mockReturnValue(false);

    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    expect(screen.getByText('Trip template')).toBeInTheDocument();
    expect(
      screen.getByText(/Publishing a template is open to enterprise accounts/),
    ).toBeInTheDocument();
  });

  it('offers a publish button that cannot publish, outside the cohort', async () => {
    flag.mockReturnValue(false);

    const { user } = render(<TripTemplateCard trip={TRIP} />, { withProviders: false });
    const button = screen.getByRole('button', { name: 'Publish as a template' });

    expect(button).toBeDisabled();

    await user.click(button);

    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps the publish button dead while the flag is still being decided', () => {
    flag.mockReturnValue(undefined);

    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    // Undecided reads as off: a live button that goes dead a moment later is
    // worse than one that was never live.
    expect(screen.getByRole('button', { name: 'Publish as a template' })).toBeDisabled();
  });

  it('opens the paid-tier offer from the locked arm', async () => {
    flag.mockReturnValue(false);

    const { user } = render(<TripTemplateCard trip={TRIP} />, { withProviders: false });
    await user.click(screen.getByRole('button', { name: 'I would pay for this' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('upgrade.dialog.disclaimer')).toBeInTheDocument();
  });

  it('counts the open as the same funnel step the upgrade card counts', async () => {
    flag.mockReturnValue(false);

    const { user } = render(<TripTemplateCard trip={TRIP} />, { withProviders: false });
    await user.click(screen.getByRole('button', { name: 'I would pay for this' }));

    expect(vi.mocked(captureEvent)).toHaveBeenCalledWith(
      'upgrade_prompt_opened',
      expect.objectContaining({ placement: 'settings', already_declared: false }),
    );
  });

  it('shows no publish controls to the cohort arm when the flag is off', () => {
    flag.mockReturnValue(false);

    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    expect(screen.queryByRole('button', { name: 'Take it down' })).not.toBeInTheDocument();
    expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
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

  it('offers neither button on a trip somebody else owns', () => {
    answering({ kind: 'not-owner', url: 'https://x.test/t/a' });

    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    expect(screen.getByDisplayValue('https://x.test/t/a')).toBeInTheDocument();
    expect(screen.getByText(/Only the person who created it can change that/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take it down' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish again' })).not.toBeInTheDocument();
  });

  it('says who may publish, on a trip somebody else has not published', () => {
    answering({ kind: 'not-owner', url: null });

    render(<TripTemplateCard trip={TRIP} />, { withProviders: false });

    expect(screen.getByText(/Only the person who created this trip can publish it/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Publish as a template' }),
    ).not.toBeInTheDocument();
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
