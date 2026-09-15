/**
 * @fileoverview Puts one guest's leg into a car that is already going there.
 *
 * The other half of the pickup panel's answer to "three of us are landing at
 * the same station": {@link UpcomingPickups} builds a car for a whole group,
 * this adds a straggler to one that exists. Both go through
 * `setTransportRide`, which writes a single scalar on the passenger's own leg —
 * never a passenger list on the ride, because merging two array writes made
 * offline keeps only one of them.
 *
 * The candidate rides are filtered by the caller (`selectJoinableRides`) so the
 * card that opens this dialog and the dialog itself can never disagree about
 * whether there is anything to join.
 *
 * @module features/transports/components/RidePickerDialog
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Locale } from 'date-fns';
import { Car, Clock, UserRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatTransportDatetime } from '@/lib/utils/datetime-format';
import type { Person, PersonId, Ride, RideId, Transport, TransportId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the RidePickerDialog component.
 */
export interface RidePickerDialogProps {
  /** Whether the dialog is open. */
  readonly open: boolean;
  /** Callback to change the open state. */
  readonly onOpenChange: (open: boolean) => void;
  /** The leg looking for a car, or null when nothing is selected. */
  readonly transport: Transport | null;
  /** Cars this leg may join, already filtered and ordered by the caller. */
  readonly rides: readonly Ride[];
  /** Guests by id, for naming each car's driver. */
  readonly personsById: ReadonlyMap<PersonId, Person>;
  /** Date locale for formatting meeting times. */
  readonly dateLocale: Locale;
  /** Callback when a car is chosen. */
  readonly onSelect: (transportId: TransportId, rideId: RideId) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Lists the cars a pickup could join and puts the guest in the chosen one.
 *
 * One tap per car: choosing is the action, so there is no second confirmation
 * step between the guest and their lift.
 *
 * @param props - Component props
 * @returns The dialog element, or null when no leg is selected
 */
const RidePickerDialog = memo(function RidePickerDialog({
  open,
  onOpenChange,
  transport,
  rides,
  personsById,
  dateLocale,
  onSelect,
}: RidePickerDialogProps): ReactElement | null {
  const { t } = useTranslation();

  if (!transport) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>{t('pickups.addToRide')}</DialogTitle>
          <DialogDescription>
            {t('pickups.addToRideDescription', { location: transport.location })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-2 max-h-[50vh] overflow-y-auto">
          {rides.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground text-center">
              {t('pickups.noJoinableRides')}
            </p>
          ) : (
            rides.map((ride) => {
              const driver =
                ride.driverId === undefined
                  ? undefined
                  : personsById.get(ride.driverId);

              return (
                <Button
                  key={ride.id}
                  type="button"
                  variant="outline"
                  className="h-auto w-full flex-col items-start gap-1 px-3 py-2 text-left focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onSelect(transport.id, ride.id)}
                >
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <Clock className="size-4 shrink-0" aria-hidden="true" />
                    {formatTransportDatetime(ride.meetDatetime, dateLocale, 'dayAndTime')}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    {driver ? (
                      <>
                        <UserRound className="size-3 shrink-0" aria-hidden="true" />
                        {driver.name}
                      </>
                    ) : (
                      <>
                        <Car className="size-3 shrink-0" aria-hidden="true" />
                        {t('rides.noDriver')}
                      </>
                    )}
                  </span>
                </Button>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            className="h-11 md:h-9"
            onClick={() => onOpenChange(false)}
          >
            {t('common.cancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RidePickerDialog };
