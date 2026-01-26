/**
 * @fileoverview Person Dialog component for creating and editing persons.
 * Wraps the PersonForm component in a shadcn/ui Dialog with proper lifecycle management.
 *
 * @module features/persons/components/PersonDialog
 * @see RoomDialog.tsx for reference implementation pattern
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
import { PersonForm } from '@/features/persons/components/PersonForm';
import type { Person, PersonFormData, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the PersonDialog component.
 */
export interface PersonDialogProps {
  /** Person ID for edit mode. If undefined, dialog is in create mode. */
  readonly personId?: PersonId;
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A dialog component for creating and editing persons.
 *
 * Features:
 * - Dual mode: Create (personId undefined) and Edit (personId provided)
 * - Integrates PersonForm for form handling
 * - Shows success/error toasts via sonner
 * - Handles async operations with loading states
 * - Prevents state updates on unmounted component
 * - Closes automatically on successful submission
 *
 * @param props - Component props
 * @returns The person dialog element
 *
 * @example
 * ```tsx
 * // Create mode
 * const [isOpen, setIsOpen] = useState(false);
 * <PersonDialog open={isOpen} onOpenChange={setIsOpen} />
 *
 * // Edit mode
 * <PersonDialog
 *   personId={selectedPersonId}
 *   open={isEditOpen}
 *   onOpenChange={setIsEditOpen}
 * />
 * ```
 */
const PersonDialog = memo(function PersonDialog({
  personId,
  open,
  onOpenChange,
}: PersonDialogProps) {
  const { t } = useTranslation();
  const { persons, createPerson, updatePerson } = usePersonContext();

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
    }
  }, [open]);

  // ============================================================================
  // Derived Values
  // ============================================================================

  /**
   * Determines if the dialog is in edit mode.
   */
  const isEditMode = Boolean(personId);

  /**
   * Find the person from context for edit mode.
   * Returns undefined if personId is not provided or person not found.
   */
  const person = useMemo((): Person | undefined => {
    if (!personId) return undefined;
    return persons.find((p) => p.id === personId);
  }, [personId, persons]);

  /**
   * Dialog title based on mode.
   */
  const dialogTitle = isEditMode ? t('persons.edit') : t('persons.new');

  /**
   * Dialog description for accessibility.
   */
  const dialogDescription = isEditMode
    ? t('persons.editDescription', 'Modify the participant details below.')
    : t('persons.newDescription', 'Fill in the details to add a new participant.');

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles form submission.
   * Creates or updates the person based on mode, shows toast, and closes dialog on success.
   */
  const handleSubmit = useCallback(
    async (data: PersonFormData) => {
      // Prevent double submission using ref for synchronous check
      if (isSubmittingRef.current) return;

      isSubmittingRef.current = true;
      setIsSubmitting(true);

      try {
        if (isEditMode && personId) {
          // Edit mode - update existing person
          // Use personId directly instead of person.id to avoid stale closure issues
          await updatePerson(personId, data);
          if (isMountedRef.current) {
            toast.success(t('persons.updateSuccess', 'Participant updated successfully'));
            onOpenChange(false);
          }
        } else {
          // Create mode - create new person
          await createPerson(data);
          if (isMountedRef.current) {
            toast.success(t('persons.createSuccess', 'Participant added successfully'));
            onOpenChange(false);
          }
        }
      } catch (error) {
        console.error('Failed to save person:', error);
        if (isMountedRef.current) {
          toast.error(t('errors.saveFailed', 'Failed to save'));
        }
        // Don't close dialog on error - allow user to retry
        // Re-throw to let PersonForm handle the error state
        throw error;
      } finally {
        isSubmittingRef.current = false;
        if (isMountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [isEditMode, personId, updatePerson, createPerson, t, onOpenChange],
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

  // Handle edit mode with missing person
  // This can happen briefly during loading or if personId is invalid
  if (isEditMode && !person && open) {
    // Show error state
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('persons.edit')}</DialogTitle>
            <DialogDescription>
              {t('errors.personNotFound', 'Participant not found. Please try again.')}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>{dialogDescription}</DialogDescription>
        </DialogHeader>

        <PersonForm
          person={person}
          onSubmit={handleSubmit}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  );
});

PersonDialog.displayName = 'PersonDialog';

// ============================================================================
// Exports
// ============================================================================

export { PersonDialog };
