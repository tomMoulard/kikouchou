/**
 * @fileoverview The money page's view tab and the card it opens, rendered
 * through the real bundles.
 *
 * A tester tapped "Remboursements" and landed on a card titled "Soldes"; the
 * English page said "Settle up" over "Balances". These tests hold the tab and
 * the card title to one word in each language.
 *
 * @module features/money/pages/__tests__/TripMoneyPage.copy.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithRealI18n } from '@/test/utils';
import { db } from '@/lib/db/database';
import type { Trip, TripId } from '@/types';

vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_A = 'trip-a' as TripId;

const TRIP_A_ROW = {
  id: TRIP_A,
  shareId: `share-${TRIP_A}`,
  name: 'Trip A',
  location: 'Brittany',
  startDate: '2026-07-01',
  endDate: '2026-07-05',
  createdAt: Date.now(),
  updatedAt: Date.now(),
} as unknown as Trip;

// ============================================================================
// Mocks
// ============================================================================

vi.mock('react-router-dom', async () => {
  const actual =
    await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ tripId: 'trip-a' }),
    useSearchParams: () => [new URLSearchParams('view=balances'), vi.fn()],
  };
});

vi.mock('@/contexts/TripContext', () => ({ useTripContext: vi.fn() }));

vi.mock('@/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/hooks')>('@/hooks');
  return {
    ...actual,
    useTripIdentity: () => ({ myPersonId: undefined }),
    useOfflineAwareNotify: () => ({ notifySuccess: vi.fn() }),
  };
});

vi.mock('@/hooks/useTripAccess', () => ({
  useTripAccess: () => ({ canEdit: true, access: 'member' }),
}));

import { TripMoneyPage } from '../TripMoneyPage';
import { useTripContext } from '@/contexts/TripContext';

// ============================================================================
// Tests
// ============================================================================

describe('TripMoneyPage view names', () => {
  beforeEach(async () => {
    vi.mocked(useTripContext).mockReturnValue({
      trips: [TRIP_A_ROW],
      currentTrip: TRIP_A_ROW,
      isLoading: false,
      error: null,
      setCurrentTrip: vi.fn().mockResolvedValue(undefined),
      checkConnection: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof useTripContext>);
    await db.trips.put(TRIP_A_ROW);
  });

  it.each([
    ['fr', 'Soldes'],
    ['en', 'Balances'],
  ] as const)('names the tab after the card it opens (%s)', async (language, word) => {
    await renderWithRealI18n(<TripMoneyPage />, { language, withProviders: false });

    const tab = await screen.findByRole('radio', { name: word });
    expect(tab).toBeChecked();
    // The card under the selected tab carries the same word as its title.
    expect(
      document.querySelector('[data-slot="card-title"]')?.textContent,
    ).toBe(word);
  });
});
