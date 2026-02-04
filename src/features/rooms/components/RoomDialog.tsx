/**
 * @fileoverview Room Dialog component for creating and editing rooms.
 * Wraps the RoomForm component in a shadcn/ui Dialog with proper lifecycle management.
 *
 * @module features/rooms/components/RoomDialog
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
import { useRoomContext } from '@/contexts/RoomContext';
import { RoomForm } from '@/features/rooms/components/RoomForm';
import type { Room, RoomFormData, RoomId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Props for the RoomDialog component.
 */
export interface RoomDialogProps {
  /** Room ID for edit mode. If undefined, dialog is in create mode. */
  readonly roomId?: RoomId;
  /** Whether the dialog is open */
  readonly open: boolean;
  /** Callback to change the open state */
  readonly onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * A dialog component for creating and editing rooms.
 *
 * Features:
 * - Dual mode: Create (roomId undefined) and Edit (roomId provided)
 * - Integrates RoomForm for form handling
 * - Shows success/error toasts via sonner
 * - Handles async operations with loading states
 * - Prevents state updates on unmounted component
 * - Closes automatically on successful submission
 *
 * @param props - Component props
 * @returns The room dialog element
 *
 * @example
 * ```tsx
 * // Create mode
 * const [isOpen, setIsOpen] = useState(false);
 * <RoomDialog open={isOpen} onOpenChange={setIsOpen} />
 *
 * // Edit mode
 * <RoomDialog
 *   roomId={selectedRoomId}
 *   open={isEditOpen}
 *   onOpenChange={setIsEditOpen}
 * />
 * ```
 */
const RoomDialog = memo(function RoomDialog({
  roomId,
  open,
  onOpenChange,
}: RoomDialogProps) {
  const { t } = useTranslation(),
   { rooms, createRoom, updateRoom } = useRoomContext(),

  // Track mounted state to prevent state updates after unmount
   isMountedRef = useRef(true),

  // Synchronous guard for double-submission prevention
   isSubmittingRef = useRef(false),

  // Submission loading state for UI
   [isSubmitting, setIsSubmitting] = useState(false);

  // ============================================================================
  // Lifecycle Effects
  // ============================================================================

  // Cleanup on unmount
  useEffect(() => () => {
      isMountedRef.current = false;
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
  const isEditMode = Boolean(roomId),

  /**
   * Find the room from context for edit mode.
   * Returns undefined if roomId is not provided or room not found.
   */
   room = useMemo((): Room | undefined => {
    if (!roomId) {return undefined;}
    return rooms.find((r) => r.id === roomId);
  }, [roomId, rooms]),

  /**
   * Dialog title based on mode.
   */
   dialogTitle = isEditMode ? t('rooms.edit') : t('rooms.new'),

  /**
   * Dialog description for accessibility.
   */
   dialogDescription = isEditMode
    ? t('rooms.editDescription', 'Modify the room details below.')
    : t('rooms.newDescription', 'Fill in the details to create a new room.'),

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles form submission.
   * Creates or updates the room based on mode, shows toast, and closes dialog on success.
   */
   handleSubmit = useCallback(
    async (data: RoomFormData) => {
      // Prevent double submission using ref for synchronous check
      if (isSubmittingRef.current) {return;}

      isSubmittingRef.current = true;
      setIsSubmitting(true);

      try {
        if (isEditMode && roomId) {
          // Edit mode - update existing room
          // Use roomId directly instead of room.id to avoid stale closure issues
          await updateRoom(roomId, data);
          toast.success(t('rooms.updateSuccess', 'Room updated successfully'));
        } else {
          // Create mode - create new room
          await createRoom(data);
          toast.success(t('rooms.createSuccess', 'Room created successfully'));
        }
        // Always close dialog on success, regardless of mount state
        onOpenChange(false);
      } catch (error) {
        console.error('Failed to save room:', error);
        if (isMountedRef.current) {
          toast.error(t('errors.saveFailed', 'Failed to save room'));
        }
        // Don't close dialog on error - allow user to retry
        // Re-throw to let RoomForm handle the error state
        throw error;
      } finally {
        isSubmittingRef.current = false;
        if (isMountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [isEditMode, roomId, updateRoom, createRoom, t, onOpenChange],
  ),

  /**
   * Handles form cancel action.
   * Closes the dialog if not currently submitting.
   */
   handleCancel = useCallback(() => {
    if (!isSubmitting) {
      onOpenChange(false);
    }
  }, [isSubmitting, onOpenChange]),

  /**
   * Handles dialog open state change.
   * Prevents closing during submission.
   */
   handleOpenChange = useCallback(
    (newOpen: boolean) => {
      // Prevent closing while submitting
      if (!newOpen && isSubmitting) {return;}
      onOpenChange(newOpen);
    },
    [isSubmitting, onOpenChange],
  );

  // ============================================================================
  // Render
  // ============================================================================

  // Handle edit mode with missing room
  // This can happen briefly during loading or if roomId is invalid
  if (isEditMode && !room && open) {
    // Show error and close dialog
    // Use useEffect to avoid calling toast during render
    return (
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('rooms.edit')}</DialogTitle>
            <DialogDescription>
              {t('errors.roomNotFound', 'Room not found. Please try again.')}
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

        <RoomForm
          room={room}
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

export { RoomDialog };
