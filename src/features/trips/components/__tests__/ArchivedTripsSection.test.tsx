/**
 * @fileoverview Tests for the archived trips section of the trip list.
 *
 * The section has two jobs: stay out of the way when nothing is archived, and
 * give an archived trip the same two doors every other card has — open it, or
 * take it back out.
 *
 * @module features/trips/components/__tests__/ArchivedTripsSection.test
 */

import { describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

import { render, screen, isoDate } from '@/test/utils';
import type { Person, Trip, TripId, ShareId } from '@/types';

import { ArchivedTripsSection } from '../ArchivedTripsSection';

function createTrip(overrides?: Partial<Trip>): Trip {
  return {
    id: 'trip-1' as TripId,
    name: 'Last summer',
    location: 'Brittany',
    startDate: isoDate('2024-07-15'),
    endDate: isoDate('2024-07-22'),
    shareId: 'share-1' as ShareId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    archived: true,
    ...overrides,
  };
}

const NO_PERSONS: ReadonlyMap<TripId, Person[]> = new Map();

describe('ArchivedTripsSection', () => {
  it('renders nothing when no trip is archived', () => {
    const { container } = render(
      <ArchivedTripsSection
        trips={[]}
        personsByTrip={NO_PERSONS}
        onSelect={vi.fn()}
        onUnarchive={vi.fn()}
        isDisabled={false}
      />,
      { withProviders: false },
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('starts collapsed, so the cards cost nothing until asked for', () => {
    render(
      <ArchivedTripsSection
        trips={[createTrip()]}
        personsByTrip={NO_PERSONS}
        onSelect={vi.fn()}
        onUnarchive={vi.fn()}
        isDisabled={false}
      />,
      { withProviders: false },
    );

    expect(screen.getByRole('button', { name: /trips\.archived\.title/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(screen.queryByText('Last summer')).not.toBeInTheDocument();
  });

  it('shows the archived trips once opened', async () => {
    const user = userEvent.setup();
    render(
      <ArchivedTripsSection
        trips={[createTrip(), createTrip({ id: 'trip-2' as TripId, name: 'The year before' })]}
        personsByTrip={NO_PERSONS}
        onSelect={vi.fn()}
        onUnarchive={vi.fn()}
        isDisabled={false}
      />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: /trips\.archived\.title/i }));

    expect(screen.getByText('Last summer')).toBeInTheDocument();
    expect(screen.getByText('The year before')).toBeInTheDocument();
  });

  it('opens an archived trip like any other card', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const trip = createTrip();

    render(
      <ArchivedTripsSection
        trips={[trip]}
        personsByTrip={NO_PERSONS}
        onSelect={onSelect}
        onUnarchive={vi.fn()}
        isDisabled={false}
      />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: /trips\.archived\.title/i }));
    await user.click(screen.getByRole('button', { name: /Last summer/ }));

    expect(onSelect).toHaveBeenCalledWith(trip);
  });

  it('takes a trip back out through the card menu', async () => {
    const user = userEvent.setup();
    const onUnarchive = vi.fn();
    const trip = createTrip();

    render(
      <ArchivedTripsSection
        trips={[trip]}
        personsByTrip={NO_PERSONS}
        onSelect={vi.fn()}
        onUnarchive={onUnarchive}
        isDisabled={false}
      />,
      { withProviders: false },
    );

    await user.click(screen.getByRole('button', { name: /trips\.archived\.title/i }));
    await user.click(screen.getByRole('button', { name: /common\.openMenu/i }));
    await user.click(await screen.findByRole('menuitem', { name: /trips\.unarchive/i }));

    expect(onUnarchive).toHaveBeenCalledWith(trip);
  });
});
