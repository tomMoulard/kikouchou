/**
 * @fileoverview The allocation review's wording, rendered through a real i18next.
 *
 * The sibling file echoes keys, so it cannot see a count or a name that went
 * missing from a label: "Apply 2 stays" and "Apply {{count}} stays" look the
 * same there. These read the English words off the DOM.
 *
 * @module features/rooms/components/__tests__/AllocationSuggestionDialog.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { tripDay } from '@/features/rooms/__tests__/fixture-days';
import { act, renderWithRealI18n, screen } from '@/test/utils';
import { getDateLocale } from '@/lib/i18n/date-locale';
import { formatDateRange } from '@/lib/utils/date-format';
import type { SuggestedStay } from '@/features/rooms/utils/allocation-planner';
import type { HexColor, Person, PersonId, Room, RoomId, TripId } from '@/types';

import { AllocationSuggestionDialog } from '../AllocationSuggestionDialog';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered, for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

function person(id: string, name: string): Person {
  return { id: id as PersonId, tripId: 'trip-1' as TripId, name, color: '#3b82f6' as HexColor };
}

function stay(
  personId: string,
  roomId: string | null,
  startDate: string,
  endDate: string,
  nights: readonly string[],
  partyKey = personId,
): SuggestedStay {
  return {
    personId: personId as PersonId,
    roomId: roomId as RoomId | null,
    startDate,
    endDate,
    nights,
    partyKey,
  };
}

const ROOMS: Room[] = [
  { id: 'room-1' as RoomId, tripId: 'trip-1' as TripId, name: 'Attic', capacity: 3, order: 0 },
];

async function renderReview(stays: readonly SuggestedStay[], persons: readonly Person[]) {
  return renderWithRealI18n(
    <AllocationSuggestionDialog
      open
      onOpenChange={vi.fn()}
      stays={stays}
      rooms={ROOMS}
      persons={persons}
      assignments={[]}
      onApply={vi.fn()}
    />,
    { withProviders: false },
  );
}

describe('AllocationSuggestionDialog wording', () => {
  it('names a party once per guest, however many stays they have', async () => {
    const alice = person('alice', 'Alice');
    const bob = person('bob', 'Bob');
    await renderReview(
      [
        stay('alice', 'room-1', tripDay(1), tripDay(2), [tripDay(1)], 'party'),
        stay('alice', 'room-1', tripDay(4), tripDay(5), [tripDay(4)], 'party'),
        stay('bob', 'room-1', tripDay(1), tripDay(2), [tripDay(1)], 'party'),
      ],
      [alice, bob],
    );

    expect(screen.getByText('Travelling together: Alice, Bob')).toBeInTheDocument();
  });

  it('gives each row its dates, its nights and a named room picker', async () => {
    await renderReview(
      [stay('alice', 'room-1', tripDay(1), tripDay(3), [tripDay(1), tripDay(2)])],
      [person('alice', 'Alice')],
    );

    expect(screen.getByText(/· 2 nights$/)).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Room for Alice' })).toHaveTextContent(
      'Attic · 3 beds',
    );
    expect(screen.getByText('Room for Alice', { selector: 'label' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply 1 stay' })).toBeInTheDocument();
  });

  it('counts the stays it will leave without a room', async () => {
    await renderReview(
      [
        stay('alice', null, tripDay(1), tripDay(2), [tripDay(1)]),
        stay('bob', null, tripDay(1), tripDay(2), [tripDay(1)]),
      ],
      [person('alice', 'Alice'), person('bob', 'Bob')],
    );

    expect(screen.getByText('2 stays will be left without a room')).toBeInTheDocument();
  });
});

describe('AllocationSuggestionDialog dates and counts', () => {
  it('writes the dates in the reader’s language, and follows a change of it', async () => {
    const { i18n } = await renderReview(
      [stay('alice', 'room-1', tripDay(1), tripDay(3), [tripDay(1), tripDay(2)])],
      [person('alice', 'Alice')],
    );
    const en = formatDateRange(tripDay(1), tripDay(3), getDateLocale('en'));
    const fr = formatDateRange(tripDay(1), tripDay(3), getDateLocale('fr'));
    expect(fr).not.toBe(en);
    expect(screen.getByText((text) => text.startsWith(`${en} · `))).toBeInTheDocument();

    await act(async () => {
      await i18n.changeLanguage('fr');
    });

    expect(screen.getByText((text) => text.startsWith(`${fr} · `))).toBeInTheDocument();
    await act(async () => {
      await i18n.changeLanguage('en');
    });
  });

  it('counts only the stays that are left without a room', async () => {
    await renderReview(
      [
        stay('alice', null, tripDay(1), tripDay(2), [tripDay(1)]),
        stay('bob', 'room-1', tripDay(1), tripDay(2), [tripDay(1)]),
      ],
      [person('alice', 'Alice'), person('bob', 'Bob')],
    );

    expect(screen.getByText('1 stay will be left without a room')).toBeInTheDocument();
  });
});
