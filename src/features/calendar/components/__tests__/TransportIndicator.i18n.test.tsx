/**
 * @fileoverview The travel pill read through the real French bundle.
 *
 * Under the suite-wide mock the pill's name is its bare key, so the guest name
 * and the direction it interpolates are never checked. The French bundle spells
 * them out.
 *
 * @module features/calendar/components/__tests__/TransportIndicator.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderWithRealI18n } from '@/test/utils';
import type { HexColor, ISODateTimeString, PersonId, TransportId, TripId } from '@/types';
import type { ResolvedRide } from '@/features/transports/utils/ride-model';

import { TransportIndicator } from '../TransportIndicator';
import type { CalendarTransport } from '../../types';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

function makeTransport(type: 'arrival' | 'departure', ride?: ResolvedRide): CalendarTransport {
  return {
    transport: {
      id: 'leg-1' as TransportId,
      tripId: 'trip-1' as TripId,
      personId: 'p1' as PersonId,
      type,
      datetime: '2026-07-15T14:30:00' as ISODateTimeString,
      location: 'Gare',
      needsPickup: false,
    },
    person: undefined,
    personName: 'Alice',
    color: '#3b82f6' as HexColor,
    ...(ride === undefined ? {} : { ride }),
  };
}

async function renderPill(
  type: 'arrival' | 'departure',
  options: { readonly onClick?: () => void; readonly ride?: ResolvedRide } = {},
): Promise<void> {
  await renderWithRealI18n(
    <TransportIndicator transport={makeTransport(type, options.ride)} type={type} onClick={options.onClick} />,
    { language: 'fr', withProviders: false },
  );
}

describe('TransportIndicator in French', () => {
  it('names a read-only arrival and departure after the guest', async () => {
    await renderPill('arrival');
    expect(screen.getByLabelText('Arrivée de Alice')).toBeInTheDocument();
  });

  it('names a read-only departure after the guest', async () => {
    await renderPill('departure');
    expect(screen.getByLabelText('Départ de Alice')).toBeInTheDocument();
  });

  it('names a tappable arrival after its direction and its guest', async () => {
    await renderPill('arrival', { onClick: vi.fn() });
    expect(
      screen.getByRole('button', { name: 'Voir les détails de Arrivée de Alice' }),
    ).toBeInTheDocument();
  });

  it('names a tappable departure after its direction and its guest', async () => {
    await renderPill('departure', { onClick: vi.fn() });
    expect(
      screen.getByRole('button', { name: 'Voir les détails de Départ de Alice' }),
    ).toBeInTheDocument();
  });

  it('names the car and its driver, or the car alone', async () => {
    const driven = { isLegacy: false, driver: { name: 'Bruno' } } as unknown as ResolvedRide;
    const { unmount } = await renderWithRealI18n(
      <TransportIndicator transport={makeTransport('arrival', driven)} type="arrival" />,
      { language: 'fr', withProviders: false },
    );
    expect(screen.getByLabelText('Arrivée de Alice · Trajet partagé, Bruno au volant')).toBeInTheDocument();
    unmount();

    await renderPill('arrival', {
      ride: { isLegacy: false } as unknown as ResolvedRide,
    });
    expect(screen.getByLabelText('Arrivée de Alice · Trajet partagé')).toBeInTheDocument();
  });
});
