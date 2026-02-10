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
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
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
  const { t } = useTranslation();
  const { rooms, createRoom, updateRoom } = useRoomContext();

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
  const isEditMode = Boolean(roomId);

  /**
   * Find the room from context for edit mode.
   * Returns undefined if roomId is not provided or room not found.
   */
  const room = useMemo((): Room | undefined => {
    if (!roomId) {return undefined;}
    return rooms.find((r) => r.id === roomId);
  }, [roomId, rooms]);

  /**
   * Dialog title based on mode.
   */
  const dialogTitle = isEditMode ? t('rooms.edit') : t('rooms.new');

  /**
   * Dialog description for accessibility.
   */
  const dialogDescription = isEditMode
    ? t('rooms.editDescription', 'Modify the room details below.')
    : t('rooms.newDescription', 'Fill in the details to create a new room.');

  // ============================================================================
  // Event Handlers
  // ============================================================================

  /**
   * Handles form submission — creates or updates room.
   * Passes raw async function directly to RoomForm which manages
   * its own submission state via useFormSubmission hook.
   */
  const handleSubmit = useCallback(
    async (data: RoomFormData) => {
      if (isEditMode && roomId) {
        await updateRoom(roomId, data);
        toast.success(t('rooms.updateSuccess', 'Room updated successfully'));
      } else {
        await createRoom(data);
        toast.success(t('rooms.createSuccess', 'Room created successfully'));
      }
      onOpenChange(false);
    },
    [isEditMode, roomId, updateRoom, createRoom, t, onOpenChange],
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

  // Handle edit mode with missing room
  // This can happen briefly during loading or if roomId is invalid
  if (isEditMode && !room && open) {
    // Show error and close dialog
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
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogDescription>{dialogDescription}</DialogDescription>
          </DialogHeader>

          <RoomForm
            room={room}
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

export { RoomDialog };
