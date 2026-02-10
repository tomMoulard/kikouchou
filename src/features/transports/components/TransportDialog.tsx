/**
 * @fileoverview Transport Dialog component for creating and editing transports.
 * Wraps the TransportForm component in a shadcn/ui Dialog with proper lifecycle management.
 *
 * @module features/transports/components/TransportDialog
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useOfflineAwareToast } from '@/hooks';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { usePersonContext } from '@/contexts/PersonContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { TransportForm } from '@/features/transports/components/TransportForm';
import type { Transport, TransportFormData, TransportId, TransportType } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the TransportDialog component.
 */
export interface TransportDialogProps {
  /** Transport ID for edit mode. If undefined, dialog is in create mode. */
  readonly transportId?: TransportId;
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
  /** Default transport type for create mode (from URL query param). */
  readonly defaultType?: TransportType;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A dialog component for creating and editing transports.
 *
 * Features:
 * - Dual mode: Create (transportId undefined) and Edit (transportId provided)
 * - Integrates TransportForm for form handling
 * - Passes persons array from PersonContext to TransportForm
 * - Supports optional defaultType prop for pre-selecting transport type in create mode
 * - Shows success/error toasts via sonner
 * - Handles async operations with loading states
 * - Prevents state updates on unmounted component
 * - Closes automatically on successful submission
 *
 * @param props - Component props
 * @returns The transport dialog element
 *
 * @example
 * ```tsx
 * // Create mode
 * const [isOpen, setIsOpen] = useState(false);
 * <TransportDialog open={isOpen} onOpenChange={setIsOpen} defaultType="arrival" />
 *
 * // Edit mode
 * <TransportDialog
 *   transportId={selectedTransportId}
 *   open={isEditOpen}
 *   onOpenChange={setIsEditOpen}
 * />
 * ```
 */
const TransportDialog = memo(function TransportDialog({
  transportId,
  open,
  onOpenChange,
  defaultType,
}: TransportDialogProps) {
  const { t } = useTranslation();
  const { transports, createTransport, updateTransport } = useTransportContext();
  const { persons } = usePersonContext();
  const { successToast } = useOfflineAwareToast();

  // Dirty-state tracking for close guard
  const [isDirty, setIsDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Reset dirty state when dialog opens (prevents stale state from previous session)
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

  /**
   * Determines if the dialog is in edit mode.
   */
  const isEditMode = Boolean(transportId);

  /**
   * Find the transport from context for edit mode.
   * Returns undefined if transportId is not provided or transport not found.
   */
  const transport = useMemo((): Transport | undefined => {
    if (!transportId) {return undefined;}
    return transports.find((t) => t.id === transportId);
  }, [transportId, transports]);

  /**
   * Dialog title based on mode.
   */
  const dialogTitle = isEditMode ? t('transports.edit') : t('transports.new');

  /**
   * Dialog description for accessibility.
   */
  const dialogDescription = isEditMode
    ? t('transports.editDescription', 'Modify the transport details below.')
    : t('transports.newDescription', 'Fill in the details to add a new transport.');

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles form submission — creates or updates transport.
   * Passes raw async function directly to TransportForm which manages
   * its own submission state via useFormSubmission hook.
   */
  const handleSubmit = useCallback(
    async (data: TransportFormData) => {
      // Use transportId directly for the check to avoid race conditions with isEditMode boolean
      if (transportId) {
        // Edit mode - update existing transport
        await updateTransport(transportId, data);
        successToast(t('transports.updateSuccess', 'Transport updated successfully'));
      } else {
        // Create mode - create new transport
        await createTransport(data);
        successToast(t('transports.createSuccess', 'Transport created successfully'));
      }
      // Always close dialog on success, regardless of mount state
      onOpenChange(false);
    },
    [transportId, updateTransport, createTransport, t, onOpenChange, successToast],
  );

  /**
   * Handles form cancel action.
   * If form is dirty, show discard confirmation; otherwise close directly.
   */
  const handleCancel = useCallback(() => {
    if (isDirty) {
      setShowDiscardConfirm(true);
      return;
    }
    onOpenChange(false);
  }, [isDirty, onOpenChange]);

  /**
   * Handles dialog open state change.
   * Intercepts close attempts when form is dirty.
   */
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      if (!newOpen && isDirty) {
        setShowDiscardConfirm(true);
        return;
      }
      onOpenChange(newOpen);
    },
    [isDirty, onOpenChange],
  );

  /**
   * Handles discard confirmation — user chose to discard changes.
   */
  const handleDiscardConfirm = useCallback(() => {
    setShowDiscardConfirm(false);
    setIsDirty(false);
    onOpenChange(false);
  }, [onOpenChange]);

  /**
   * Handles discard cancel — user chose to keep editing.
   */
  const handleDiscardCancel = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      setShowDiscardConfirm(false);
    }
  }, []);

  // ============================================================================
  // Render
  // ============================================================================

  // Handle edit mode with missing transport
  // This can happen briefly during loading or if transportId is invalid
  if (isEditMode && !transport && open) {
    // Show error and close dialog
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('transports.edit')}</DialogTitle>
            <DialogDescription>
              {t('errors.transportNotFound', 'Transport not found. Please try again.')}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <TransportForm
            transport={transport}
            persons={persons}
            defaultType={isEditMode ? undefined : defaultType}
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

export { TransportDialog };
