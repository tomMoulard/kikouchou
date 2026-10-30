/**
 * @fileoverview Tests for the "plan your own trip" card on the trip list.
 *
 * The decision about when to show it belongs to `usePlanOwnTripPrompt` and is
 * tested there. What is left here is what the card does once it is on screen:
 * the two buttons, and the impression it reports exactly once.
 *
 * @module features/trips/components/__tests__/PlanOwnTripPrompt.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils';
import { installLocalStorageDouble } from '@/test/local-storage';
import { getGuestIdentityStorageKey } from '@/lib/sharing/guest-identity';
import { toLocalISODateString } from '@/lib/db/utils';
import type { PersonId, ShareId, Trip, TripId, UnixTimestamp } from '@/types';

// jsdom exposes no `localStorage` in this suite, and the guest identity the
// card keys off lives there.
const storage = installLocalStorageDouble();

// The real export is `undefined` without a PostHog key, which every unit test
// is, so an assertion on `capture` would pass vacuously without this.
// `vi.hoisted`, because `vi.mock`'s factory is lifted above every `const`.
const mockCapture = vi.hoisted(() => vi.fn());
vi.mock('@/lib/posthog', () => ({
  // Named export used by every catch block that reports; a mock
  // without it makes the reporter itself the error under test.
  reportError: vi.fn(),
  default: { capture: mockCapture },
  captureEvent: mockCapture,
}));

import { PlanOwnTripPrompt } from '../PlanOwnTripPrompt';

// ============================================================================
// Fixtures
// ============================================================================

/** A trip that started two days ago, derived from today rather than pinned. */
function makeStartedTrip(): Trip {
  const start = new Date();
  start.setDate(start.getDate() - 2);
  const end = new Date();
  end.setDate(end.getDate() + 5);
  const now = Date.now() as UnixTimestamp;

  return {
    id: 'trip-1' as TripId,
    name: 'Brittany',
    startDate: toLocalISODateString(start),
    endDate: toLocalISODateString(end),
    shareId: 'share-1' as ShareId,
    createdAt: now,
    updatedAt: now,
  };
}

function joinAsGuest(trip: Trip): void {
  localStorage.setItem(
    getGuestIdentityStorageKey(trip.shareId),
    JSON.stringify({ personId: 'person-1' as PersonId, tripId: trip.id }),
  );
}

/** Reads back the capture for one event name, not by call position. */
function captureFor(event: string): unknown[] | undefined {
  return mockCapture.mock.calls.find((call) => call[0] === event);
}

// ============================================================================
// Tests
// ============================================================================

describe('PlanOwnTripPrompt', () => {
  beforeEach(() => {
    storage.clear();
    mockCapture.mockClear();
  });

  it('renders nothing for a visitor who owns a trip', () => {
    const trip = makeStartedTrip();

    const { container } = render(
      <PlanOwnTripPrompt trips={[trip]} onCreateTrip={vi.fn()} />,
      { withProviders: false },
    );

    expect(container).toBeEmptyDOMElement();
    expect(captureFor('own_trip_prompt_shown')).toBeUndefined();
  });

  it('invites a guest and reports the impression once', () => {
    const trip = makeStartedTrip();
    joinAsGuest(trip);

    render(<PlanOwnTripPrompt trips={[trip]} onCreateTrip={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByText('trips.ownTripPrompt.title')).toBeInTheDocument();
    expect(
      mockCapture.mock.calls.filter((call) => call[0] === 'own_trip_prompt_shown'),
    ).toHaveLength(1);
  });

  it('opens the create form when the guest accepts', async () => {
    const trip = makeStartedTrip();
    joinAsGuest(trip);
    const onCreateTrip = vi.fn();

    const { user } = render(
      <PlanOwnTripPrompt trips={[trip]} onCreateTrip={onCreateTrip} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('trips.ownTripPrompt.action'));

    expect(onCreateTrip).toHaveBeenCalledTimes(1);
    expect(captureFor('own_trip_prompt_accepted')).toBeDefined();
  });

  it('goes away when the guest says not now', async () => {
    const trip = makeStartedTrip();
    joinAsGuest(trip);

    const { user, container } = render(
      <PlanOwnTripPrompt trips={[trip]} onCreateTrip={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByText('trips.ownTripPrompt.notNow'));

    expect(container).toBeEmptyDOMElement();
    expect(captureFor('own_trip_prompt_dismissed')).toBeDefined();
  });

  it('goes away when the guest uses the close button', async () => {
    const trip = makeStartedTrip();
    joinAsGuest(trip);

    const { user, container } = render(
      <PlanOwnTripPrompt trips={[trip]} onCreateTrip={vi.fn()} />,
      { withProviders: false },
    );
    await user.click(screen.getByRole('button', { name: 'common.close' }));

    expect(container).toBeEmptyDOMElement();
  });

  it('says what it offers, set apart from the list', () => {
    const trip = makeStartedTrip();
    joinAsGuest(trip);

    const { container } = render(<PlanOwnTripPrompt trips={[trip]} onCreateTrip={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByText('trips.ownTripPrompt.description')).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass('mb-4', 'border-primary/20');
  });

  it('counts the trips in the impression, and reports it once across updates', () => {
    const trip = makeStartedTrip();
    const second = { ...makeStartedTrip(), id: 'trip-2' as TripId, shareId: 'share-2' as ShareId };
    joinAsGuest(trip);
    joinAsGuest(second);

    const { rerender } = render(<PlanOwnTripPrompt trips={[trip]} onCreateTrip={vi.fn()} />, {
      withProviders: false,
    });
    expect(captureFor('own_trip_prompt_shown')).toEqual(['own_trip_prompt_shown', { trip_count: 1 }]);

    rerender(<PlanOwnTripPrompt trips={[trip, second]} onCreateTrip={vi.fn()} />);

    expect(
      mockCapture.mock.calls.filter((call) => call[0] === 'own_trip_prompt_shown'),
    ).toHaveLength(1);
  });

  it('reports the impression when the card appears after the first render', () => {
    const own = makeStartedTrip();
    const joined = { ...makeStartedTrip(), id: 'trip-2' as TripId, shareId: 'share-2' as ShareId };
    joinAsGuest(joined);

    const { rerender } = render(<PlanOwnTripPrompt trips={[own]} onCreateTrip={vi.fn()} />, {
      withProviders: false,
    });
    expect(captureFor('own_trip_prompt_shown')).toBeUndefined();

    rerender(<PlanOwnTripPrompt trips={[joined]} onCreateTrip={vi.fn()} />);

    expect(captureFor('own_trip_prompt_shown')).toEqual(['own_trip_prompt_shown', { trip_count: 1 }]);
  });

  it('calls the create handler it was given last', async () => {
    const trip = makeStartedTrip();
    joinAsGuest(trip);
    const first = vi.fn();
    const latest = vi.fn();

    const { user, rerender } = render(<PlanOwnTripPrompt trips={[trip]} onCreateTrip={first} />, {
      withProviders: false,
    });
    rerender(<PlanOwnTripPrompt trips={[trip]} onCreateTrip={latest} />);
    await user.click(screen.getByText('trips.ownTripPrompt.action'));

    expect(latest).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });
});
