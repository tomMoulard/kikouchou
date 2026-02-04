/**
 * @fileoverview DroppableRoom component for drag-and-drop room assignments.
 * Wraps room content with dnd-kit droppable functionality.
 *
 * @module features/rooms/components/DroppableRoom
 */

import { type ReactElement, type ReactNode, memo } from 'react';
import { useDroppable } from '@dnd-kit/core';

import { cn } from '@/lib/utils';
import type { RoomId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Data attached to a droppable room target.
 */
export interface DroppableRoomData {
  /** The room ID */
  readonly roomId: RoomId;
}

/**
 * Props for the DroppableRoom component.
 */
export interface DroppableRoomProps {
  /** The room ID */
  readonly roomId: RoomId;
  /** Child content to render */
  readonly children: ReactNode;
  /** Additional CSS classes for the wrapper */
  readonly className?: string;
  /** Whether drop is disabled */
  readonly disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * DroppableRoom provides a drop target for DraggableGuest components.
 *
 * When a guest is dropped, the parent DndContext's onDragEnd handler
 * is triggered with the room ID and guest data.
 *
 * @example
 * ```tsx
 * <DroppableRoom roomId={room.id}>
 *   <RoomCard room={room} ... />
 * </DroppableRoom>
 * ```
 */
const DroppableRoom = memo(function DroppableRoom(props: DroppableRoomProps): ReactElement {
  const { roomId, children, className, disabled = false } = props;

  // Create unique ID for this droppable
  const droppableId = `room-${roomId}`;

  // Set up dnd-kit droppable
  const { setNodeRef, isOver, active } = useDroppable({
    id: droppableId,
    data: {
      roomId,
    } satisfies DroppableRoomData,
    disabled,
  });

  // Check if something is being dragged (for visual feedback)
  const isDragActive = active !== null;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        // Base styles
        'relative transition-all duration-200',
        // When dragging and hovering over this room
        isOver && 'ring-2 ring-primary ring-offset-2 scale-[1.02]',
        // When dragging but not hovering
        isDragActive && !isOver && 'opacity-80',
        // Disabled state
        disabled && 'opacity-50 pointer-events-none',
        className,
      )}
    >
      {children}
      
      {/* Drop zone indicator overlay */}
      {isOver && (
        <div
          className={cn(
            'absolute inset-0 pointer-events-none',
            'bg-primary/10 rounded-lg',
            'flex items-center justify-center',
          )}
          aria-hidden="true"
        >
          <div className="bg-primary text-primary-foreground px-3 py-1 rounded-full text-sm font-medium shadow-lg">
            Drop here
          </div>
        </div>
      )}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { DroppableRoom };
