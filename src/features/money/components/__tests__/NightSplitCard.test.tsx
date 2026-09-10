/**
 * @fileoverview The split table must show the nights, and divide a typed bill
 * by them down to the cent.
 *
 * @module features/money/components/__tests__/NightSplitCard.test
 */

import { describe, expect, it, vi } from 'vitest';

import { NightSplitCard } from '@/features/money/components/NightSplitCard';
import type { TripNightSplit } from '@/features/money/lib/night-split';
import { render, screen, within } from '@/test/utils';
import type { ISODateString, PersonId, TripId } from '@/types';

// ============================================================================
// Fixtures
// ============================================================================

function buildSplit(overrides: Partial<TripNightSplit> = {}): TripNightSplit {
  return {
    tripId: 'trip-a' as TripId,
    name: 'Summer in Brittany',
    startDate: '2026-07-01' as ISODateString,
    endDate: '2026-07-08' as ISODateString,
    nights: 7,
    personNights: 10,
    guests: [
      {
        personId: 'p1' as PersonId,
        name: 'Marie',
        headcount: 2,
        nights: 4,
        personNights: 8,
        share: 0.8,
      },
      {
        personId: 'p2' as PersonId,
        name: 'Hugo',
        headcount: 1,
        nights: 2,
        personNights: 2,
        share: 0.2,
      },
    ],
    ...overrides,
  };
}

/** The cells of the row a guest's name heads. */
function cellsOf(name: string): readonly string[] {
  const row = screen.getByRole('rowheader', { name: new RegExp(name) }).closest('tr');
  if (row === null) {
    throw new Error(`No row for ${name}`);
  }
  return within(row)
    .getAllByRole('cell')
    .map((cell) => cell.textContent ?? '');
}

// ============================================================================
// Tests
// ============================================================================

describe('NightSplitCard', () => {
  it('gives each guest their nights and their person nights', () => {
    render(<NightSplitCard split={buildSplit()} />, { withProviders: false });

    expect(cellsOf('Marie').slice(0, 2)).toEqual(['4', '8']);
    expect(cellsOf('Hugo').slice(0, 2)).toEqual(['2', '2']);
  });

  it('shows no amounts until a bill is typed', () => {
    render(<NightSplitCard split={buildSplit()} />, { withProviders: false });

    expect(screen.queryByText('money.columnAmount')).not.toBeInTheDocument();
    expect(cellsOf('Marie')).toHaveLength(3);
  });

  it('divides a typed bill in proportion to the person nights', async () => {
    const { user } = render(<NightSplitCard split={buildSplit()} />, {
      withProviders: false,
    });

    await user.type(screen.getByLabelText('money.amountLabel'), '1000');

    expect(screen.getByText('money.columnAmount')).toBeInTheDocument();
    // 8 of 10 person nights, then 2 of 10.
    expect(cellsOf('Marie').at(-1)).toBe('800.00');
    expect(cellsOf('Hugo').at(-1)).toBe('200.00');
  });

  it('hands out the cent that rounding leaves over', async () => {
    const split = buildSplit({
      personNights: 3,
      guests: [
        { personId: 'a' as PersonId, name: 'Ana', headcount: 1, nights: 1, personNights: 1, share: 1 / 3 },
        { personId: 'b' as PersonId, name: 'Bo', headcount: 1, nights: 1, personNights: 1, share: 1 / 3 },
        { personId: 'c' as PersonId, name: 'Cyd', headcount: 1, nights: 1, personNights: 1, share: 1 / 3 },
      ],
    });
    const { user } = render(<NightSplitCard split={split} />, { withProviders: false });

    await user.type(screen.getByLabelText('money.amountLabel'), '100');

    expect([cellsOf('Ana').at(-1), cellsOf('Bo').at(-1), cellsOf('Cyd').at(-1)]).toEqual([
      '33.34',
      '33.33',
      '33.33',
    ]);
  });

  it('puts one line per guest on the clipboard', async () => {
    const { user } = render(<NightSplitCard split={buildSplit()} />, {
      withProviders: false,
    });
    // `render` calls `userEvent.setup()`, which installs its own clipboard
    // stub, so the spy has to go on after the render rather than before it.
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);

    await user.click(screen.getByRole('button', { name: 'money.copy' }));

    expect(writeText).toHaveBeenCalledTimes(1);
    // The mocked `t` echoes keys, so this asserts the shape: a heading and one
    // line per guest. The words are asserted in the sibling i18n suite.
    expect(writeText.mock.calls[0]?.[0].split('\n')).toEqual([
      'money.copyHeader',
      'money.copyLine',
      'money.copyLine',
    ]);
  });

  it('says a same-day trip has nothing to split', () => {
    render(
      <NightSplitCard split={buildSplit({ nights: 0, personNights: 0 })} />,
      { withProviders: false },
    );

    expect(screen.getByText('money.noNights')).toBeInTheDocument();
  });

  it('says so when the trip has no guests', () => {
    render(<NightSplitCard split={buildSplit({ guests: [], personNights: 0 })} />, {
      withProviders: false,
    });

    expect(screen.getByText('money.noGuests')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });
});
