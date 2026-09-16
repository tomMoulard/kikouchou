/**
 * @fileoverview The trips the group has put away, kept out of the main list.
 *
 * Archiving is the answer to a trip list that only ever grows: last summer's
 * house is finished, but its rooms, its guests and its accounts are still worth
 * keeping, so the trip stays and moves down here instead of being deleted.
 *
 * Collapsed on arrival, because that is the whole point — the section exists to
 * take space back from the main grid. Opening it shows the same {@link TripCard}
 * the active trips use, so an archived trip is still one tap from its calendar
 * and one menu item from coming back.
 *
 * @module features/trips/components/ArchivedTripsSection
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, ChevronDown } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Person, Trip, TripId } from '@/types';
import { TripCard } from './TripCard';

// ============================================================================
// Type Definitions
// ============================================================================

interface ArchivedTripsSectionProps {
  /** The archived trips, in the same order the main grid uses. */
  readonly trips: readonly Trip[];
  /** Guest badges for every card, keyed by trip, as the page already loads them. */
  readonly personsByTrip: ReadonlyMap<TripId, Person[]>;
  /** Opens the trip, exactly as the main grid does. */
  readonly onSelect: (trip: Trip) => void;
  /** Takes the trip back out of the archive. */
  readonly onUnarchive: (trip: Trip) => void;
  /** Whether a navigation is in flight, which disables every card. */
  readonly isDisabled: boolean;
}

// ============================================================================
// Component
// ============================================================================

export const ArchivedTripsSection = memo(function ArchivedTripsSection({
  trips,
  personsByTrip,
  onSelect,
  onUnarchive,
  isDisabled,
}: ArchivedTripsSectionProps): ReactElement | null {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = useCallback(() => {
    setIsOpen((previous) => !previous);
  }, []);

  // Nobody has archived anything: a heading over an empty list would be one
  // more thing to read on a page whose job is to show trips.
  if (trips.length === 0) {
    return null;
  }

  return (
    <section
      className="mt-8 flex flex-col gap-3"
      aria-labelledby="archived-trips-heading"
    >
      <h2 id="archived-trips-heading">
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start gap-2 px-2 py-2 text-sm font-semibold"
          onClick={handleToggle}
          aria-expanded={isOpen}
          aria-controls="archived-trips-grid"
        >
          <Archive className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>{t('trips.archived.title', { count: trips.length })}</span>
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              isOpen && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </Button>
      </h2>

      {/* Unmounted rather than hidden while collapsed: every card mounts a lazy
          map preview, and the section exists to stop paying for trips nobody is
          looking at. */}
      {isOpen && (
        <div
          id="archived-trips-grid"
          className={cn(
            'grid gap-4',
            'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
          )}
          role="list"
          aria-label={t('trips.archived.listLabel')}
        >
          {trips.map((trip) => (
            <div key={trip.id} role="listitem">
              <TripCard
                trip={trip}
                persons={personsByTrip.get(trip.id) ?? []}
                onClick={onSelect}
                onArchiveToggle={onUnarchive}
                isDisabled={isDisabled}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
});

// ============================================================================
// Exports
// ============================================================================

export type { ArchivedTripsSectionProps };
