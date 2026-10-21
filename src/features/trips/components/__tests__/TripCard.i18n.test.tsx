/**
 * @fileoverview The trip card read through the real catalogue.
 *
 * The suite-wide i18n mock drops `count` and `location` and has no language,
 * so neither the guest counts, the place the map preview is named after, nor
 * the language of the dates can be checked with it.
 *
 * @module features/trips/components/__tests__/TripCard.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { act, isoDate, renderWithRealI18n, screen } from '@/test/utils';
import type { Person, ShareId, Trip, TripId } from '@/types';

import { TripCard } from '../TripCard';

vi.unmock('i18next');
vi.unmock('react-i18next');

const trip: Trip = {
  id: 'trip-1' as TripId,
  name: 'Beach Vacation',
  location: 'Brittany, France',
  startDate: isoDate('2024-07-15'),
  endDate: isoDate('2024-07-22'),
  shareId: 'share-1' as ShareId,
  coordinates: { lat: 48.2, lon: -2.9 },
  createdAt: 1,
  updatedAt: 1,
};

function guests(count: number): Person[] {
  return Array.from(
    { length: count },
    (_, index) =>
      ({ id: `p${index}`, tripId: 'trip-1', name: `Guest ${index}`, color: '#ef4444' }) as never,
  );
}

describe('TripCard in a real language', () => {
  it('counts every guest in its name and the hidden ones in the badge', async () => {
    await renderWithRealI18n(<TripCard trip={trip} persons={guests(6)} onClick={vi.fn()} />, {
      withProviders: false,
    });

    expect(screen.getByRole('button', { name: /Beach Vacation/ })).toHaveAccessibleName(
      /, 6 guests/,
    );
    expect(screen.getByText('2 more guests')).toBeInTheDocument();
  });

  it('names the map preview after the place, not the trip', async () => {
    await renderWithRealI18n(<TripCard trip={trip} persons={[]} onClick={vi.fn()} />, {
      withProviders: false,
    });

    expect(
      await screen.findByRole('button', { name: 'View location on map: Brittany, France' }),
    ).toBeInTheDocument();
  });

  it('writes the dates in the language the app is read in, also after a switch', async () => {
    const { i18n } = await renderWithRealI18n(
      <TripCard trip={{ ...trip, coordinates: undefined }} persons={[]} onClick={vi.fn()} />,
      { withProviders: false, language: 'fr' },
    );
    expect(screen.getByText(/juil\./)).toBeInTheDocument();

    try {
      await act(async () => {
        await i18n.changeLanguage('en');
      });
      expect(screen.getByText(/Jul/)).toBeInTheDocument();
    } finally {
      await i18n.changeLanguage('fr');
    }
  });
});
