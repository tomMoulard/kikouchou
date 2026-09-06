/**
 * @fileoverview Tests for the "which guest am I" settings card.
 *
 * The card is the only way an identity can be *set*, so the assertions that
 * matter are the ones about the write reaching `setMyPersonId` — including the
 * clear, which is the one path that hands it `undefined` — and about the card
 * explaining an answer the user did not give here. A name selected with no
 * explanation reads as the app knowing more about you than it does.
 *
 * @module features/settings/components/__tests__/TripIdentitySelector.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

import { render, screen } from '@/test/utils';
import { TripIdentitySelector } from '../TripIdentitySelector';
import { useTripIdentity } from '@/hooks';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTripContext } from '@/contexts/TripContext';
import type { Person, PersonId, TripId } from '@/types';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/hooks', () => ({ useTripIdentity: vi.fn() }));
vi.mock('@/contexts/PersonContext', () => ({ usePersonContext: vi.fn() }));
vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const { toast } = await import('sonner');

/**
 * The DOM APIs Radix's `Select` calls and jsdom does not implement. Without
 * them the guest list throws the moment it opens.
 */
function installSelectPolyfills(): void {
  const proto = window.HTMLElement.prototype as unknown as Record<string, unknown>;
  proto.hasPointerCapture ??= () => false;
  proto.setPointerCapture ??= () => undefined;
  proto.releasePointerCapture ??= () => undefined;
  proto.scrollIntoView ??= () => undefined;
}

installSelectPolyfills();

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;

function makePerson(id: string, name: string): Person {
  return {
    id: id as PersonId,
    tripId: TRIP_ID,
    name,
    color: '#3b82f6' as Person['color'],
  };
}

const ALICE = makePerson('person-alice', 'Alice'),
  TOM = makePerson('person-tom', 'Tom');

/** The identity hook's answer, overridden per test. */
function mockIdentity(
  overrides: Partial<ReturnType<typeof useTripIdentity>> = {},
): ReturnType<typeof useTripIdentity>['setMyPersonId'] {
  const setMyPersonId = vi.fn().mockResolvedValue(undefined);

  vi.mocked(useTripIdentity).mockReturnValue({
    myPersonId: undefined,
    source: undefined,
    isResolved: true,
    setMyPersonId,
    ...overrides,
  });

  return overrides.setMyPersonId ?? setMyPersonId;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useTripContext).mockReturnValue({
    currentTrip: { id: TRIP_ID },
  } as unknown as ReturnType<typeof useTripContext>);
  vi.mocked(usePersonContext).mockReturnValue({
    persons: [ALICE, TOM],
  } as unknown as ReturnType<typeof usePersonContext>);
  mockIdentity();
});

// ============================================================================
// Tests
// ============================================================================

describe('TripIdentitySelector', () => {
  it('lists the trip’s guests', async () => {
    const { user } = render(<TripIdentitySelector />, { withProviders: false });

    await user.click(screen.getByRole('combobox', { name: 'identity.title' }));

    expect(await screen.findByRole('option', { name: 'Alice' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Tom' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'identity.nobody' })).toBeInTheDocument();
  });

  it('marks the resolved guest', async () => {
    mockIdentity({ myPersonId: TOM.id, source: 'explicit' });

    const { user } = render(<TripIdentitySelector />, { withProviders: false });

    await user.click(screen.getByRole('combobox', { name: 'identity.title' }));

    expect(
      await screen.findByRole('option', { name: /Tom\s*identity\.you/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Alice' })).toBeInTheDocument();
  });

  it('records the choice', async () => {
    const setMyPersonId = mockIdentity();

    const { user } = render(<TripIdentitySelector />, { withProviders: false });

    await user.click(screen.getByRole('combobox', { name: 'identity.title' }));
    await user.click(await screen.findByRole('option', { name: 'Alice' }));

    expect(setMyPersonId).toHaveBeenCalledWith(ALICE.id);
    expect(toast.success).toHaveBeenCalledWith('identity.saved');
  });

  it('clears the choice with undefined, not with a sentinel', async () => {
    // The sentinel is a Radix requirement — an item value may not be the empty
    // string — and it must never reach the repository, where it would be
    // stored as a guest id nothing can resolve.
    const setMyPersonId = mockIdentity({ myPersonId: TOM.id, source: 'explicit' });

    const { user } = render(<TripIdentitySelector />, { withProviders: false });

    await user.click(screen.getByRole('combobox', { name: 'identity.title' }));
    await user.click(await screen.findByRole('option', { name: 'identity.nobody' }));

    expect(setMyPersonId).toHaveBeenCalledWith(undefined);
  });

  it('reports a failed save rather than pretending', async () => {
    const setMyPersonId = vi.fn().mockRejectedValue(new Error('quota'));
    mockIdentity({ setMyPersonId });

    const { user } = render(<TripIdentitySelector />, { withProviders: false });

    await user.click(screen.getByRole('combobox', { name: 'identity.title' }));
    await user.click(await screen.findByRole('option', { name: 'Alice' }));

    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('errors.saveFailed');
    });
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('says where a share-link identity came from', () => {
    mockIdentity({ myPersonId: ALICE.id, source: 'shareLink' });

    render(<TripIdentitySelector />, { withProviders: false });

    expect(screen.getByText('identity.fromShareLink')).toBeInTheDocument();
  });

  it('says where an account identity came from', () => {
    mockIdentity({ myPersonId: ALICE.id, source: 'account' });

    render(<TripIdentitySelector />, { withProviders: false });

    expect(screen.getByText('identity.fromAccount')).toBeInTheDocument();
  });

  it('stays quiet about an answer the user gave here', () => {
    mockIdentity({ myPersonId: ALICE.id, source: 'explicit' });

    render(<TripIdentitySelector />, { withProviders: false });

    expect(screen.queryByText('identity.fromShareLink')).not.toBeInTheDocument();
    expect(screen.queryByText('identity.fromAccount')).not.toBeInTheDocument();
  });

  it('has nothing to ask when no trip is open', () => {
    vi.mocked(useTripContext).mockReturnValue({
      currentTrip: null,
    } as unknown as ReturnType<typeof useTripContext>);

    render(<TripIdentitySelector />, { withProviders: false });

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('identity.noTrip')).toBeInTheDocument();
  });

  it('has nothing to ask when the trip has no guests', () => {
    vi.mocked(usePersonContext).mockReturnValue({
      persons: [],
    } as unknown as ReturnType<typeof usePersonContext>);

    render(<TripIdentitySelector />, { withProviders: false });

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.getByText('identity.noGuests')).toBeInTheDocument();
  });
});
