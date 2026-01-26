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
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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

  // Track mounted state to prevent state updates after unmount
  const isMountedRef = useRef(true);

  // Synchronous guard for double-submission prevention
  const isSubmittingRef = useRef(false);

  // Submission loading state for UI
  const [isSubmitting, setIsSubmitting] = useState(false);

  // ============================================================================
  // Lifecycle Effects
  // ============================================================================

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reset submission state when dialog closes
  useEffect(() => {
    if (!open) {
      setIsSubmitting(false);
      isSubmittingRef.current = false;
    }
  }, [open]);

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
    if (!transportId) return undefined;
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
   * Handles form submission.
   * Creates or updates the transport based on mode, shows toast, and closes dialog on success.
   */
  const handleSubmit = useCallback(
    async (data: TransportFormData) => {
      // Prevent double submission using ref for synchronous check
      if (isSubmittingRef.current) return;

      isSubmittingRef.current = true;
      setIsSubmitting(true);

      try {
        // Use transportId directly for the check to avoid race conditions with isEditMode boolean
        if (transportId) {
          // Edit mode - update existing transport
          await updateTransport(transportId, data);
          if (isMountedRef.current) {
            toast.success(t('transports.updateSuccess', 'Transport updated successfully'));
            onOpenChange(false);
          }
        } else {
          // Create mode - create new transport
          await createTransport(data);
          if (isMountedRef.current) {
            toast.success(t('transports.createSuccess', 'Transport created successfully'));
            onOpenChange(false);
          }
        }
      } catch (error) {
        console.error('Failed to save transport:', error);
        if (isMountedRef.current) {
          toast.error(t('errors.saveFailed', 'Failed to save transport'));
        }
        // Don't close dialog on error - allow user to retry
        // Re-throw to let TransportForm handle the error state
        throw error;
      } finally {
        isSubmittingRef.current = false;
        if (isMountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [transportId, updateTransport, createTransport, t, onOpenChange],
  );

  /**
   * Handles form cancel action.
   * Closes the dialog if not currently submitting.
   */
  const handleCancel = useCallback(() => {
    if (!isSubmitting) {
      onOpenChange(false);
    }
  }, [isSubmitting, onOpenChange]);

  /**
   * Handles dialog open state change.
   * Prevents closing during submission.
   */
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      // Prevent closing while submitting
      if (!newOpen && isSubmitting) return;
      onOpenChange(newOpen);
    },
    [isSubmitting, onOpenChange],
  );

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
        />
      </DialogContent>
    </Dialog>
  );
});

TransportDialog.displayName = 'TransportDialog';

// ============================================================================
// Exports
// ============================================================================

export { TransportDialog };
