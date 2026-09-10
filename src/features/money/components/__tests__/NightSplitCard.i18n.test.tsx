/**
 * @fileoverview The split wording, rendered through a real i18next.
 *
 * The suite-wide mock returns the key and drops `count`, so it cannot see a
 * plural form: "1 person nights" would pass every assertion in the sibling
 * file. These tests read the words off the DOM and off the clipboard, which is
 * also where they are least forgiving — the copied lines are what somebody
 * pastes into Tricount.
 *
 * @module features/money/components/__tests__/NightSplitCard.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { renderWithRealI18n, screen } from '@/test/utils';
import type { ISODateString, PersonId, TripId } from '@/types';

import { NightSplitCard } from '../NightSplitCard';
import type { TripNightSplit } from '../../lib/night-split';

// Hoisted above the imports, which lifts them above the mocks `setupFiles`
// registered — for this file only.
vi.unmock('i18next');
vi.unmock('react-i18next');

// ============================================================================
// Fixtures
// ============================================================================

const SPLIT: TripNightSplit = {
  tripId: 'trip-a' as TripId,
  name: 'Summer in Brittany',
  startDate: '2026-07-01' as ISODateString,
  endDate: '2026-07-08' as ISODateString,
  nights: 7,
  personNights: 9,
  guests: [
    {
      personId: 'p1' as PersonId,
      name: 'Marie',
      headcount: 2,
      nights: 4,
      personNights: 8,
      share: 8 / 9,
    },
    {
      personId: 'p2' as PersonId,
      name: 'Hugo',
      headcount: 1,
      nights: 1,
      personNights: 1,
      share: 1 / 9,
    },
  ],
};

// ============================================================================
// Tests
// ============================================================================

describe('NightSplitCard wording', () => {
  it('counts one night in the singular and the rest in the plural', async () => {
    await renderWithRealI18n(<NightSplitCard split={SPLIT} />, {
      withProviders: false,
    });

    expect(
      screen.getByText('7 nights in the house. 9 person nights to split.'),
    ).toBeInTheDocument();
  });

  it('copies one readable line per guest', async () => {
    const { user } = await renderWithRealI18n(<NightSplitCard split={SPLIT} />, {
      withProviders: false,
    });
    const writeText = vi
      .spyOn(navigator.clipboard, 'writeText')
      .mockResolvedValue(undefined);

    await user.click(screen.getByRole('button', { name: 'Copy the split' }));

    expect(writeText.mock.calls[0]?.[0]).toBe(
      ['Summer in Brittany: 7 nights', 'Marie: 8 person nights', 'Hugo: 1 person night'].join(
        '\n',
      ),
    );
  });
});
