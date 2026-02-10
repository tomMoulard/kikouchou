/**
 * @fileoverview Room Dialog component for creating and editing rooms.
 * Wraps the RoomForm component in a shadcn/ui Dialog with proper lifecycle management.
 *
 * @module features/rooms/components/RoomDialog
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
