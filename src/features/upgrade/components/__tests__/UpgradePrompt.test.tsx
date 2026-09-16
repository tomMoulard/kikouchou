/**
 * @fileoverview Tests for the paid-tier fake door.
 *
 * The whole point of this card is what it records, so that is what is asserted:
 * the funnel steps, the dismissal beside them, the two prices and which one was
 * clicked, the properties every event carries, and the one rule about where the
 * address may go — on the person, never on an event. A funnel that loses
 * `placement` halfway through cannot be broken down by screen, and nothing in
 * the UI would show that.
 *
 * The flag gate is asserted from both sides, because a disabled button that is
 * disabled for everybody is the same bug as one that is never disabled.
 *
 * The memory of an answer belongs to `useUpgradeInterest` and is tested there.
 * What is left here is what the card does once it is on screen.
 *
 * @module features/upgrade/components/__tests__/UpgradePrompt.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import { installLocalStorageDouble } from '@/test/local-storage';

// jsdom exposes no `localStorage` in this suite, and the hook behind the card
// reads it during render.
const storage = installLocalStorageDouble();

// The real exports are inert without a PostHog key, which every unit test is,
// so assertions on them would pass vacuously without this. `vi.hoisted`,
// because `vi.mock`'s factory is lifted above every `const`.
const mockCapture = vi.hoisted(() => vi.fn());
const mockSetPersonProperties = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog', () => ({
  reportError: vi.fn(),
  default: { capture: mockCapture },
  captureEvent: mockCapture,
  setPersonProperties: mockSetPersonProperties,
}));

// The offer button is gated by `ent-trip-templates`. Default the double to
// "on", so every test that is not about the gate reaches the dialog.
const flag = vi.hoisted(() => vi.fn<() => boolean | undefined>(() => true));
vi.mock('@/hooks/useFeatureFlag', () => ({ useFeatureFlag: () => flag() }));

import { FREE_ACTIVE_TRIP_LIMIT, UPGRADE_PRICE_EUR_MONTHLY } from '../../constants';
import { UpgradePrompt } from '../UpgradePrompt';

// ============================================================================
// Helpers
// ============================================================================

/** Reads back the capture for one event name, not by call position. */
function captureFor(event: string): unknown[] | undefined {
  return mockCapture.mock.calls.find((call) => call[0] === event);
}

/** Every capture for one event name, for the "exactly once" assertions. */
function capturesFor(event: string): unknown[][] {
  return mockCapture.mock.calls.filter((call) => call[0] === event);
}

/** The address every test leaves. */
const ADDRESS = 'reader@example.com';

// ============================================================================
// Tests
// ============================================================================

describe('UpgradePrompt', () => {
  beforeEach(() => {
    storage.clear();
    storage.setThrowing(false);
    mockCapture.mockClear();
    mockSetPersonProperties.mockClear();
    flag.mockReturnValue(true);
  });

  it('reports the impression once, with the offer it showed', () => {
    render(<UpgradePrompt placement="settings" />, { withProviders: false });

    expect(screen.getByText('upgrade.card.title')).toBeInTheDocument();
    expect(capturesFor('upgrade_prompt_shown')).toHaveLength(1);
    expect(captureFor('upgrade_prompt_shown')?.[1]).toEqual({
      placement: 'settings',
      price_eur_monthly: UPGRADE_PRICE_EUR_MONTHLY,
      free_active_trip_limit: FREE_ACTIVE_TRIP_LIMIT,
      already_declared: false,
    });
  });

  it('reports the placement it was given', () => {
    render(<UpgradePrompt placement="trips" />, { withProviders: false });

    expect(captureFor('upgrade_prompt_shown')?.[1]).toMatchObject({
      placement: 'trips',
    });
  });

  it('opens the offer and counts the interest', async () => {
    const { user } = render(<UpgradePrompt placement="analytics" />, {
      withProviders: false,
    });
    await user.click(screen.getByText('upgrade.card.action'));

    expect(screen.getByText('upgrade.dialog.title')).toBeInTheDocument();
    expect(captureFor('upgrade_prompt_opened')?.[1]).toMatchObject({
      placement: 'analytics',
      already_declared: false,
    });
    // Opening is not intent. The dialog names a price and asks for an address,
    // and only that answers the question this test asks.
    expect(captureFor('upgrade_intent_declared')).toBeUndefined();
    expect(mockSetPersonProperties).not.toHaveBeenCalled();
  });

  it('counts the intent and puts the address on the person, not the event', async () => {
    const { user } = render(<UpgradePrompt placement="settings" />, {
      withProviders: false,
    });
    await user.click(screen.getByText('upgrade.card.action'));
    await user.type(screen.getByLabelText('upgrade.dialog.emailLabel'), ADDRESS);
    await user.click(screen.getByText('upgrade.dialog.confirm'));

    expect(mockSetPersonProperties).toHaveBeenCalledWith({
      upgrade_waitlist_email: ADDRESS,
    });

    const declared = captureFor('upgrade_intent_declared');
    expect(declared?.[1]).toMatchObject({ placement: 'settings', has_email: true });
    // The rule this test exists for: the address must never ride on an event.
    expect(JSON.stringify(declared)).not.toContain(ADDRESS);
    expect(JSON.stringify(mockCapture.mock.calls)).not.toContain(ADDRESS);
  });

  it('refuses a value that is not an address, and counts nothing', async () => {
    const { user } = render(<UpgradePrompt placement="settings" />, {
      withProviders: false,
    });
    await user.click(screen.getByText('upgrade.card.action'));
    await user.type(screen.getByLabelText('upgrade.dialog.emailLabel'), 'not-an-address');
    await user.click(screen.getByText('upgrade.dialog.confirm'));

    expect(screen.getByRole('alert')).toHaveTextContent('upgrade.dialog.emailInvalid');
    // A typo is not a No: nothing is captured either way.
    expect(captureFor('upgrade_intent_declared')).toBeUndefined();
    expect(captureFor('upgrade_prompt_dismissed')).toBeUndefined();
    expect(mockSetPersonProperties).not.toHaveBeenCalled();
  });

  it('leaves the card exactly as it was after the answer', async () => {
    const { user } = render(<UpgradePrompt placement="settings" />, {
      withProviders: false,
    });
    await user.click(screen.getByText('upgrade.card.action'));
    await user.type(screen.getByLabelText('upgrade.dialog.emailLabel'), ADDRESS);
    await user.click(screen.getByText('upgrade.dialog.confirm'));

    // The rule: the sections on the pages do not change, answered or not.
    expect(screen.getByText('upgrade.card.title')).toBeInTheDocument();
    expect(screen.getByText('upgrade.card.action')).toBeInTheDocument();
    expect(screen.getByText('upgrade.card.notNow')).toBeInTheDocument();
  });

  it('still opens the offer after the answer, and says the answer is in', async () => {
    const { user } = render(<UpgradePrompt placement="settings" />, {
      withProviders: false,
    });
    await user.click(screen.getByText('upgrade.card.action'));
    await user.type(screen.getByLabelText('upgrade.dialog.emailLabel'), ADDRESS);
    await user.click(screen.getByText('upgrade.dialog.confirm'));
    mockCapture.mockClear();

    await user.click(screen.getByText('upgrade.card.action'));

    // The offer is readable again: the features and the price are still there.
    expect(screen.getByText('upgrade.dialog.title')).toBeInTheDocument();
    expect(screen.getByText('upgrade.features.unlimitedTrips')).toBeInTheDocument();
    // The form is replaced by a thank-you that recites nothing back.
    expect(screen.queryByLabelText('upgrade.dialog.emailLabel')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('upgrade.dialog.alreadyDeclared');
    expect(screen.getByRole('status').textContent).not.toContain(ADDRESS);
    // And the reopen is marked, so it cannot inflate the interest step.
    expect(captureFor('upgrade_prompt_opened')?.[1]).toMatchObject({
      already_declared: true,
    });
  });

  it('does not ask again on the next visit', async () => {
    const { user, unmount } = render(<UpgradePrompt placement="settings" />, {
      withProviders: false,
    });
    await user.click(screen.getByText('upgrade.card.action'));
    await user.type(screen.getByLabelText('upgrade.dialog.emailLabel'), ADDRESS);
    await user.click(screen.getByText('upgrade.dialog.confirm'));
    unmount();

    const { user: laterUser } = render(<UpgradePrompt placement="trips" />, {
      withProviders: false,
    });
    await laterUser.click(screen.getByText('upgrade.card.action'));

    expect(screen.queryByLabelText('upgrade.dialog.emailLabel')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('upgrade.dialog.alreadyDeclared');
  });

  it('counts a no and goes away', async () => {
    const { user, container } = render(<UpgradePrompt placement="trips" />, {
      withProviders: false,
    });
    await user.click(screen.getByText('upgrade.card.notNow'));

    expect(container).toBeEmptyDOMElement();
    expect(captureFor('upgrade_prompt_dismissed')?.[1]).toMatchObject({
      placement: 'trips',
    });
  });

  it('counts a no from the close button too', async () => {
    const { user, container } = render(<UpgradePrompt placement="trips" />, {
      withProviders: false,
    });
    await user.click(screen.getByRole('button', { name: 'common.close' }));

    expect(container).toBeEmptyDOMElement();
    expect(captureFor('upgrade_prompt_dismissed')).toBeDefined();
  });

  it('offers both prices, and says which one was clicked', async () => {
    const { user } = render(<UpgradePrompt placement="trips" />, {
      withProviders: false,
    });

    expect(screen.getByText('upgrade.plans.per_trip')).toBeInTheDocument();
    expect(screen.getByText('upgrade.plans.unlimited_monthly')).toBeInTheDocument();

    await user.click(screen.getByText('upgrade.plans.unlimited_monthly'));

    expect(captureFor('upgrade_plan_clicked')?.[1]).toMatchObject({
      placement: 'trips',
      plan: 'unlimited_monthly',
      plan_price_eur: 19,
    });
    // The click opens the offer, which is where the address is left. A price
    // button that recorded and did nothing would read as a broken control.
    expect(screen.getByText('upgrade.dialog.title')).toBeInTheDocument();
  });

  it('carries the chosen plan into the intent', async () => {
    const { user } = render(<UpgradePrompt placement="settings" />, {
      withProviders: false,
    });
    await user.click(screen.getByText('upgrade.plans.per_trip'));
    await user.type(screen.getByLabelText('upgrade.dialog.emailLabel'), ADDRESS);
    await user.click(screen.getByText('upgrade.dialog.confirm'));

    expect(captureFor('upgrade_plan_clicked')?.[1]).toMatchObject({
      plan: 'per_trip',
      plan_price_eur: 9,
    });
    expect(captureFor('upgrade_intent_declared')?.[1]).toMatchObject({
      plan: 'per_trip',
    });
  });

  it('records no plan when the offer was opened from the main button', async () => {
    const { user } = render(<UpgradePrompt placement="settings" />, {
      withProviders: false,
    });
    await user.click(screen.getByText('upgrade.card.action'));
    await user.type(screen.getByLabelText('upgrade.dialog.emailLabel'), ADDRESS);
    await user.click(screen.getByText('upgrade.dialog.confirm'));

    expect(captureFor('upgrade_intent_declared')?.[1]).toMatchObject({ plan: null });
  });

  it('locks the offer button while the flag is not an explicit yes', () => {
    flag.mockReturnValue(false);
    const { unmount } = render(<UpgradePrompt placement="settings" />, {
      withProviders: false,
    });

    expect(screen.getByText('upgrade.card.action')).toBeDisabled();
    expect(screen.getByText('upgrade.card.locked')).toBeInTheDocument();
    // The prices answer for everybody: gating them would measure the cohort.
    expect(screen.getByText('upgrade.plans.per_trip')).toBeEnabled();
    unmount();

    // Undecided is not a yes either: the flag arrives late, and a button that
    // goes dead under somebody's cursor is worse than one that starts locked.
    flag.mockReturnValue(undefined);
    render(<UpgradePrompt placement="settings" />, { withProviders: false });
    expect(screen.getByText('upgrade.card.action')).toBeDisabled();
  });

  it('opens the offer when the flag says yes', async () => {
    const { user } = render(<UpgradePrompt placement="settings" />, {
      withProviders: false,
    });

    expect(screen.queryByText('upgrade.card.locked')).not.toBeInTheDocument();
    await user.click(screen.getByText('upgrade.card.action'));

    expect(screen.getByText('upgrade.dialog.title')).toBeInTheDocument();
  });

  it('stays away on the next screen once it was dismissed', async () => {
    const { user, unmount } = render(<UpgradePrompt placement="settings" />, {
      withProviders: false,
    });
    await user.click(screen.getByText('upgrade.card.notNow'));
    unmount();

    const { container } = render(<UpgradePrompt placement="trips" />, {
      withProviders: false,
    });

    expect(container).toBeEmptyDOMElement();
    // The impression on the second screen must not be counted: nobody saw it.
    expect(capturesFor('upgrade_prompt_shown')).toHaveLength(1);
  });
});
