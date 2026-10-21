/**
 * @fileoverview The archived trips heading, read through the real catalogue.
 *
 * The suite-wide i18n mock drops `count`, so it cannot tell whether the
 * heading says how many trips are archived.
 *
 * @module features/trips/components/__tests__/ArchivedTripsSection.i18n.test
 */

import { describe, expect, it, vi } from 'vitest';

import { isoDate, renderWithRealI18n, screen } from '@/test/utils';
import type { Person, ShareId, Trip, TripId } from '@/types';

import { ArchivedTripsSection } from '../ArchivedTripsSection';

vi.unmock('i18next');
vi.unmock('react-i18next');

function trip(id: string): Trip {
  return {
    id: id as TripId,
    name: `Trip ${id}`,
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-22'),
    shareId: `share-${id}` as ShareId,
    createdAt: 1,
    updatedAt: 1,
    archived: true,
  };
}

describe('ArchivedTripsSection in English', () => {
  it('counts the archived trips in its heading', async () => {
    await renderWithRealI18n(
      <ArchivedTripsSection
        trips={[trip('a'), trip('b')]}
        personsByTrip={new Map<TripId, Person[]>()}
        onSelect={vi.fn()}
        onUnarchive={vi.fn()}
        isDisabled={false}
      />,
      { withProviders: false },
    );

    expect(screen.getByRole('button', { name: 'Archived (2)' })).toBeInTheDocument();
  });
});
