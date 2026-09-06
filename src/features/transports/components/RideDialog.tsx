/**
 * @fileoverview Ride Dialog — wraps {@link RideForm} in a modal and wires it to
 * the contexts, exactly the way `TransportDialog` wraps `TransportForm`.
 *
 * The one thing it does beyond the transport dialog is resolve the ride being
 * edited through `resolveRides`, so the form can tell the user that the driver
 * they picked is also one of the passengers. That list is assembled from the
 * legs (`Transport.rideId`) rather than stored on the ride, and this is the
 * single place it is read for the form.
 *
 * @module features/transports/components/RideDialog
 */

import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { RideForm } from '@/features/transports/components/RideForm';
import { resolveRides } from '@/features/transports/utils/ride-model';
import { useOfflineAwareToast } from '@/hooks';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { captureUsage } from '@/lib/posthog';
import {
  DEFAULT_LEAD_TIME_MINUTES,
  type PersonId,
  type Ride,
  type RideDirection,
  type RideFormData,
  type RideId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** Props for the {@link RideDialog} component. */
export interface RideDialogProps {
  /** Ride to edit. Undefined puts the dialog in create mode. */
  readonly rideId?: RideId;
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
  /** Direction to preselect in create mode. */
  readonly defaultDirection?: RideDirection;
}

// ============================================================================
// Constants
// ============================================================================

/** Stable identity for "this ride has nobody in it yet". */
const NO_PASSENGERS: readonly PersonId[] = [];

// ============================================================================
// Component
// ============================================================================

/**
 * A dialog for creating and editing car journeys.
 *
 * Features:
 * - Dual mode: create (no `rideId`) and edit
 * - Unsaved-changes guard before closing a dirty form
 * - Success toasts through `useOfflineAwareToast`, so an offline save still
 *   reads as saved rather than as a failure
 *
 * @param props - Component props
 * @returns The ride dialog element
 *
 * @example
 * ```tsx
 * const [isOpen, setIsOpen] = useState(false);
 * <RideDialog open={isOpen} onOpenChange={setIsOpen} defaultDirection="pickup" />
 * ```
 */
const RideDialog = memo(function RideDialog({
  rideId,
  open,
  onOpenChange,
  defaultDirection,
}: RideDialogProps) {
  const { t } = useTranslation(),
    { rides, vehicles, isLoading, createRide, updateRide } = useRideContext(),
    { persons } = usePersonContext(),
    { transports } = useTransportContext(),
    { successToast } = useOfflineAwareToast(),
    [isDirty, setIsDirty] = useState(false),
    [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Reset the guard when the dialog opens, so a discarded edit does not leave
  // the next one believing it is already dirty.
  /* eslint-disable react-hooks/set-state-in-effect -- Intentional reset on dialog open */
  useEffect(() => {
    if (open) {
      setIsDirty(false);
      setShowDiscardConfirm(false);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // ============================================================================
  // Derived Values
  // ============================================================================

  const isEditMode = Boolean(rideId),
    ride = useMemo((): Ride | undefined => {
      if (!rideId) {
        return undefined;
      }
      return rides.find((candidate) => candidate.id === rideId);
    }, [rideId, rides]),
    /**
     * Who is already booked into this car.
     *
     * Read through `resolveRides` rather than by filtering transports here:
     * that resolver is what every other ride surface reads, and it is what
     * computes `isSelfDriven` — a second, local definition of "who is in this
     * car" is exactly how two screens come to disagree about one journey.
     */
    passengerIds = useMemo((): readonly PersonId[] => {
      // A closed dialog renders no form, so resolving every journey on each
      // transport tick would buy nothing.
      if (!rideId || !open) {
        return NO_PASSENGERS;
      }
      const journey = resolveRides({ transports, rides, vehicles, persons }).find(
        (candidate) => candidate.id === rideId,
      );
      return journey === undefined
        ? NO_PASSENGERS
        : journey.legs.map((leg) => leg.transport.personId);
    }, [rideId, open, transports, rides, vehicles, persons]),
    dialogTitle = isEditMode ? t('rides.edit') : t('rides.new'),
    dialogDescription = isEditMode
      ? t('rides.editDescription')
      : t('rides.newDescription');

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Creates or updates the ride, then closes.
   *
   * The raw async function goes to the form, which owns the submission state
   * through `useFormSubmission`.
   */
  const handleSubmit = useCallback(
      async (data: RideFormData) => {
        // `rideId` rather than `isEditMode`, so a prop change mid-flight cannot
        // turn an update into a second ride.
        if (rideId) {
          await updateRide(rideId, data);
          successToast(t('rides.updateSuccess'));
        } else {
          await createRide(data);
          successToast(t('rides.createSuccess'));
        }

        captureUsage('ride_saved', {
          operation: rideId ? 'updated' : 'created',
          direction: data.direction,
          lead_time_minutes: data.leadTimeMinutes ?? DEFAULT_LEAD_TIME_MINUTES,
          has_driver: data.driverId !== undefined,
          has_vehicle: data.vehicleId !== undefined,
          self_driven:
            data.driverId !== undefined && passengerIds.includes(data.driverId),
          passengers: passengerIds.length,
        });

        onOpenChange(false);
      },
      [
        rideId,
        updateRide,
        createRide,
        successToast,
        t,
        passengerIds,
        onOpenChange,
      ],
    ),
    handleCancel = useCallback(() => {
      if (isDirty) {
        setShowDiscardConfirm(true);
        return;
      }
      onOpenChange(false);
    }, [isDirty, onOpenChange]),
    handleOpenChange = useCallback(
      (newOpen: boolean) => {
        if (!newOpen && isDirty) {
          setShowDiscardConfirm(true);
          return;
        }
        onOpenChange(newOpen);
      },
      [isDirty, onOpenChange],
    ),
    handleDiscardConfirm = useCallback(() => {
      setShowDiscardConfirm(false);
      setIsDirty(false);
      onOpenChange(false);
    }, [onOpenChange]),
    handleDiscardCancel = useCallback((newOpen: boolean) => {
      if (!newOpen) {
        setShowDiscardConfirm(false);
      }
    }, []);

  // ============================================================================
  // Render
  // ============================================================================

  // Edit mode with no such ride. That is two different states, and calling
  // both "not found" is a lie the user sees: `RideContext` publishes its rides
  // through state fed by an effect, so every first mount and every trip switch
  // has renders where the list is still empty. Saying so while the query is in
  // flight flashes "Ride not found" over a ride that exists.
  if (isEditMode && !ride && open) {
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('rides.edit')}</DialogTitle>
            <DialogDescription>
              {isLoading ? t('common.loading') : t('errors.rideNotFound')}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <RideForm
            ride={ride}
            persons={persons}
            vehicles={vehicles}
            rides={rides}
            passengerIds={passengerIds}
            defaultDirection={isEditMode ? undefined : defaultDirection}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onDirtyChange={setIsDirty}
          />
        </DialogContent>
      </Dialog>

      {/* Discard changes confirmation */}
      <ConfirmDialog
        open={showDiscardConfirm}
        onOpenChange={handleDiscardCancel}
        title={t('unsaved.discardChanges')}
        description={t('unsaved.discardDescription')}
        confirmLabel={t('unsaved.discard')}
        cancelLabel={t('unsaved.keepEditing')}
        onConfirm={handleDiscardConfirm}
        variant="default"
      />
    </>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RideDialog };
