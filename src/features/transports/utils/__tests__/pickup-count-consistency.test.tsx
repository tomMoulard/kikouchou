/**
 * @fileoverview Guards the invariant this module exists for: every view that
 * reports "how many pickups still need a driver" must report the same number.
 *
 * Three places used to answer that question over three different base sets and
 * two different notions of "now" — the analytics badge, the alert panel's
 * visibility gate on the transport list, and the count rendered inside the
 * panel. Here the same rows are fed to all three and they must agree, both for
 * a pickup a few minutes ahead and for one a few minutes behind.
 *
 * The analytics side is exercised through the real `loadTripStats`, not a
 * re-typed copy of its predicate, so this fails if that page ever grows its own
 * answer again.
 *
 * @module features/transports/utils/__tests__/pickup-count-consistency.test
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { render, screen, within } from '@/test/utils';
import { loadTripStats } from '@/features/analytics/lib/trip-stats';
import { db } from '@/lib/db/database';
import type {
  ISODateTimeString,
  PersonId,
  Transport,
  TransportId,
  TripId,
} from '@/types';

import {
  groupPickupsByProximity,
  isTransportUpcoming,
  selectPickupsNeedingDriver,
} from '../pickup-utils';

// ============================================================================
// Mocks
// ============================================================================

vi.mock('@/contexts/TransportContext', () => ({
  useTransportContext: vi.fn(() => ({
    upcomingPickups: [],
    updateTransport: vi.fn(),
  })),
}));

vi.mock('@/contexts/PersonContext', () => ({
  usePersonContext: vi.fn(() => ({ persons: [] })),
}));

vi.mock('@/hooks', () => ({
  useOfflineAwareToast: vi.fn(() => ({ successToast: vi.fn() })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      if (typeof options === 'string') return options;
      if (options && typeof options === 'object' && 'count' in options) {
        return `${options['count']}`;
      }
      return key;
    },
    i18n: { language: 'en' },
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { UpcomingPickups } from '@/features/transports/components/UpcomingPickups';
import { useTransportContext } from '@/contexts/TransportContext';

// ============================================================================
// Fixtures — derived from the current clock, never from a hardcoded date
// ============================================================================

const MINUTE_MS = 60_000;

function makePickup(
  overrides: Omit<Partial<Transport>, 'id'> & { id: string },
): Transport {
  return {
    tripId: 'trip-1' as TripId,
    personId: 'person-1' as PersonId,
    type: 'arrival',
    location: 'Gare de Vannes',
    needsPickup: true,
    ...overrides,
    id: overrides.id as TransportId,
    datetime: overrides.datetime ?? new Date().toISOString(),
  } as Transport;
}

/**
 * Rebuilds `TransportContext.upcomingPickups` the way the provider does: one
 * reference instant, one instant-based comparison.
 */
function deriveUpcomingPickups(
  transports: readonly Transport[],
  nowMs: number,
): readonly Transport[] {
  return transports.filter(
    (transport) =>
      transport.needsPickup && isTransportUpcoming(transport.datetime, nowMs),
  );
}

// ============================================================================
// Tests
// ============================================================================

describe('pickup count consistency across views', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('classifies a pickup just ahead and one just behind the same way everywhere', () => {
    const nowMs = Date.now();

    const ahead = makePickup({
      id: 't-ahead',
      datetime: new Date(nowMs + 5 * MINUTE_MS).toISOString(),
    });
    const behind = makePickup({
      id: 't-behind',
      datetime: new Date(nowMs - 5 * MINUTE_MS).toISOString(),
    });

    const upcomingPickups = deriveUpcomingPickups([ahead, behind], nowMs);

    // The context keeps only the pickup that is still ahead of us.
    expect(upcomingPickups.map((p) => p.id)).toEqual(['t-ahead']);

    // 1. The analytics badge (TripAnalyticsPage) — its existing expression.
    const analyticsCount = upcomingPickups.filter(
      (tr) => tr.needsPickup && !tr.driverId,
    ).length;

    // 2. The alert panel's visibility gate (TransportListPage).
    const listGateShowsPanel = selectPickupsNeedingDriver(upcomingPickups).length > 0;

    // 3. The count and the cards inside the panel (UpcomingPickups).
    const selected = selectPickupsNeedingDriver(upcomingPickups);
    const groupedCount = groupPickupsByProximity(selected).reduce(
      (sum, group) => sum + group.pickups.length,
      0,
    );

    expect(analyticsCount).toBe(1);
    expect(listGateShowsPanel).toBe(true);
    expect(selected).toHaveLength(analyticsCount);
    expect(groupedCount).toBe(analyticsCount);
  });

  it('renders exactly the number of cards the other views report', () => {
    const nowMs = Date.now();

    const transports = [
      makePickup({
        id: 't-ahead-1',
        datetime: new Date(nowMs + 5 * MINUTE_MS).toISOString(),
      }),
      makePickup({
        id: 't-ahead-2',
        datetime: new Date(nowMs + 40 * MINUTE_MS).toISOString(),
        location: 'Aeroport de Nantes',
      }),
      makePickup({
        id: 't-behind',
        datetime: new Date(nowMs - 5 * MINUTE_MS).toISOString(),
      }),
      makePickup({
        id: 't-has-driver',
        datetime: new Date(nowMs + 20 * MINUTE_MS).toISOString(),
        driverId: 'driver-1' as PersonId,
      }),
      makePickup({
        id: 't-no-pickup-needed',
        datetime: new Date(nowMs + 25 * MINUTE_MS).toISOString(),
        needsPickup: false,
      }),
    ];

    const upcomingPickups = deriveUpcomingPickups(transports, nowMs);

    const analyticsCount = upcomingPickups.filter(
      (tr) => tr.needsPickup && !tr.driverId,
    ).length;
    expect(analyticsCount).toBe(2);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups,
      updateTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    render(<UpcomingPickups />, { withProviders: false });

    // One card per pickup that still needs a driver.
    expect(screen.getAllByRole('article')).toHaveLength(analyticsCount);

    // …and the badge beside the section heading says the same number.
    const heading = screen.getByRole('heading', { level: 2 });
    expect(
      within(heading.parentElement as HTMLElement).getByText(String(analyticsCount)),
    ).toBeInTheDocument();
  });

  it('hides the panel exactly when the other views report zero', () => {
    const nowMs = Date.now();

    const transports = [
      makePickup({
        id: 't-behind',
        datetime: new Date(nowMs - 5 * MINUTE_MS).toISOString(),
      }),
      makePickup({
        id: 't-has-driver',
        datetime: new Date(nowMs + 5 * MINUTE_MS).toISOString(),
        driverId: 'driver-1' as PersonId,
      }),
    ];

    const upcomingPickups = deriveUpcomingPickups(transports, nowMs);

    const analyticsCount = upcomingPickups.filter(
      (tr) => tr.needsPickup && !tr.driverId,
    ).length;
    const listGateShowsPanel = selectPickupsNeedingDriver(upcomingPickups).length > 0;

    expect(analyticsCount).toBe(0);
    expect(listGateShowsPanel).toBe(false);

    vi.mocked(useTransportContext).mockReturnValue({
      upcomingPickups,
      updateTransport: vi.fn(),
    } as unknown as ReturnType<typeof useTransportContext>);

    const { container } = render(<UpcomingPickups />, { withProviders: false });
    expect(container.firstChild).toBeNull();
  });

  it('reports the same number through the real analytics read', async () => {
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString() as ISODateTimeString;

    const transports = [
      makePickup({
        id: 't-ahead-1',
        datetime: new Date(nowMs + 5 * MINUTE_MS).toISOString(),
      }),
      makePickup({
        id: 't-ahead-2',
        datetime: new Date(nowMs + 40 * MINUTE_MS).toISOString(),
        location: 'Aeroport de Nantes',
      }),
      makePickup({
        id: 't-behind',
        datetime: new Date(nowMs - 5 * MINUTE_MS).toISOString(),
      }),
      makePickup({
        id: 't-has-driver',
        datetime: new Date(nowMs + 20 * MINUTE_MS).toISOString(),
        driverId: 'driver-1' as PersonId,
      }),
      makePickup({
        id: 't-no-pickup-needed',
        datetime: new Date(nowMs + 25 * MINUTE_MS).toISOString(),
        needsPickup: false,
      }),
    ];

    await db.transports.bulkPut(transports);

    // 1. The analytics badge, through the read the page actually calls.
    const stats = await loadTripStats('trip-1' as TripId, now);

    // 2/3. The panel's count and its visibility gate on the transport list.
    const upcomingPickups = deriveUpcomingPickups(transports, nowMs);
    const selected = selectPickupsNeedingDriver(upcomingPickups);
    const groupedCount = groupPickupsByProximity(selected).reduce(
      (sum, group) => sum + group.pickups.length,
      0,
    );

    expect(stats.pickupsNeedingDriver).toBe(2);
    expect(selected).toHaveLength(stats.pickupsNeedingDriver);
    expect(groupedCount).toBe(stats.pickupsNeedingDriver);
    expect(selected.length > 0).toBe(true);
  });

  it('agrees on a pickup stored with a UTC offset instead of Z', () => {
    const nowMs = Date.now();

    // Same instant, two spellings: one in UTC, one as a +02:00 wall clock. The
    // old lexicographic compare in TransportContext read the offset spelling as
    // two hours later than it is, so the analytics badge counted a ride the
    // panel had already dropped.
    const behindInUtc = new Date(nowMs - 5 * MINUTE_MS);
    const offsetSpelling = `${new Date(behindInUtc.getTime() + 2 * 60 * MINUTE_MS)
      .toISOString()
      .slice(0, 19)}+02:00`;

    // The comparison the context used to make would have kept it.
    expect(offsetSpelling >= new Date(nowMs).toISOString()).toBe(true);

    const transports = [makePickup({ id: 't-offset', datetime: offsetSpelling })];
    const upcomingPickups = deriveUpcomingPickups(transports, nowMs);

    expect(upcomingPickups).toHaveLength(0);
    expect(selectPickupsNeedingDriver(upcomingPickups)).toHaveLength(0);
    expect(
      upcomingPickups.filter((tr) => tr.needsPickup && !tr.driverId),
    ).toHaveLength(0);
  });
});
