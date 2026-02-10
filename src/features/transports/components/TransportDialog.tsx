/**
 * @fileoverview Transport Dialog component for creating and editing transports.
 * Wraps the TransportForm component in a shadcn/ui Dialog with proper lifecycle management.
 *
 * @module features/transports/components/TransportDialog
 */

import {
  memo,
  useCallback,
  useMemo,
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
        toast.success(t('transports.updateSuccess', 'Transport updated successfully'));
      } else {
        // Create mode - create new transport
        await createTransport(data);
        toast.success(t('transports.createSuccess', 'Transport created successfully'));
      }
      // Always close dialog on success, regardless of mount state
      onOpenChange(false);
    },
    [transportId, updateTransport, createTransport, t, onOpenChange],
  );

  /**
   * Handles form cancel action.
   * Closes the dialog.
   */
  const handleCancel = useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  /**
   * Handles dialog open state change.
   */
  const handleOpenChange = useCallback(
    (newOpen: boolean) => {
      onOpenChange(newOpen);
    },
    [onOpenChange],
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

// ============================================================================
// Exports
// ============================================================================

export { TransportDialog };
