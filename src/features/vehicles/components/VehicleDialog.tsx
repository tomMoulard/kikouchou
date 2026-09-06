/**
 * @fileoverview Dialog wrapping {@link VehicleForm} for create and edit.
 *
 * @module features/vehicles/components/VehicleDialog
 * @see TransportDialog.tsx for the pattern this follows
 */

import { type ReactElement, memo, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { VehicleForm } from '@/features/vehicles/components/VehicleForm';
import { useOfflineAwareToast } from '@/hooks';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { captureUsage } from '@/lib/posthog';
import type { Vehicle, VehicleFormData } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for {@link VehicleDialog}.
 */
export interface VehicleDialogProps {
  /** The car being edited. Undefined means create. */
  readonly vehicle?: Vehicle;
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Create or edit one of the trip's cars.
 *
 * @param props - Component props
 * @returns The dialog element
 *
 * @example
 * ```tsx
 * <VehicleDialog vehicle={editing} open={isOpen} onOpenChange={setIsOpen} />
 * ```
 */
const VehicleDialog = memo(function VehicleDialog({
  vehicle,
  open,
  onOpenChange,
}: VehicleDialogProps): ReactElement {
  const { t } = useTranslation();
  const { persons } = usePersonContext();
  const { createVehicle, updateVehicle } = useRideContext();
  const { successToast } = useOfflineAwareToast();

  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- Intentional reset on dialog open, as TransportDialog does. */
  useEffect(() => {
    if (open) {
      setIsDirty(false);
      setShowDiscardConfirm(false);
    }
  }, [open]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const isEditMode = vehicle !== undefined;

  const handleSubmit = useCallback(
    async (data: VehicleFormData) => {
      if (vehicle) {
        await updateVehicle(vehicle.id, data);
        successToast(t('vehicles.updateSuccess'));
      } else {
        await createVehicle(data);
        successToast(t('vehicles.createSuccess'));
      }

      // Counts and flags only: what somebody calls their car is not analytics
      // data, and neither is who owns it.
      captureUsage('vehicle_saved', {
        operation: vehicle ? 'updated' : 'created',
        is_rental: data.isRental === true,
        has_seat_count: data.seatCount !== undefined,
        child_seat_count: data.childSeats?.length ?? 0,
      });

      onOpenChange(false);
    },
    [createVehicle, onOpenChange, successToast, t, updateVehicle, vehicle],
  );

  const handleCancel = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onOpenChange(false);
  }, [isDirty, onOpenChange]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && isDirty) {
        setShowDiscardConfirm(true);
        return;
      }
      onOpenChange(nextOpen);
    },
    [isDirty, onOpenChange],
  );

  const handleDiscardConfirm = useCallback(() => {
    setShowDiscardConfirm(false);
    setIsDirty(false);
    onOpenChange(false);
  }, [onOpenChange]);

  const handleDiscardCancel = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setShowDiscardConfirm(false);
    }
  }, []);

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90svh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {isEditMode ? t('vehicles.edit') : t('vehicles.new')}
            </DialogTitle>
            <DialogDescription>
              {isEditMode
                ? t('vehicles.editDescription')
                : t('vehicles.newDescription')}
            </DialogDescription>
          </DialogHeader>

          <VehicleForm
            vehicle={vehicle}
            persons={persons}
            onSubmit={handleSubmit}
            onCancel={handleCancel}
            onDirtyChange={setIsDirty}
          />
        </DialogContent>
      </Dialog>

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

export { VehicleDialog };
