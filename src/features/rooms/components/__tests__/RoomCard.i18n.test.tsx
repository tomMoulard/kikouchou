/**
 * @fileoverview Room capacity wording, rendered through a real i18next.
 *
 * The suite-wide mock returns the key and drops `count`, so it cannot see a
 * plural form at all: a one-bed room printed "0 of 1 spots taken" next to
 * "1 spot open" and every assertion stayed green. These tests read the words
 * off the DOM instead.
 *
 * @module features/rooms/components/__tests__/RoomCard.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';
import type { Room } from '@/types';

import { RoomCard } from '../RoomCard';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered — for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

const singleBedRoom: Room = {
  id: 'r1' as Room['id'],
  tripId: 't1' as Room['tripId'],
  name: 'Attic',
  capacity: 1,
  order: 0,
};

describe('RoomCard capacity wording', () => {
  it('says "spot taken" for a room with one spot', async () => {
    await renderWithRealI18n(
      <RoomCard
        room={singleBedRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={1}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );

    expect(screen.getByText('0 of 1 spot taken')).toBeInTheDocument();
    expect(screen.queryByText('0 of 1 spots taken')).not.toBeInTheDocument();
  });

  it('says "spots taken" for a room with several spots', async () => {
    await renderWithRealI18n(
      <RoomCard
        room={{ ...singleBedRoom, capacity: 4 }}
        occupants={[]}
        peakOccupancy={1}
        availableSpots={3}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { withProviders: false },
    );

    expect(screen.getByText('1 of 4 spots taken')).toBeInTheDocument();
  });

  it('agrees in French too', async () => {
    await renderWithRealI18n(
      <RoomCard
        room={singleBedRoom}
        occupants={[]}
        peakOccupancy={0}
        availableSpots={1}
        isFull={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { language: 'fr', withProviders: false },
    );

    expect(screen.getByText('0 sur 1 place prise')).toBeInTheDocument();
  });
});
