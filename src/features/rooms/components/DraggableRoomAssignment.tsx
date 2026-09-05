/**
 * @fileoverview Draggable room assignment pill for room timeline.
 *
 * @module features/rooms/components/DraggableRoomAssignment
 */

import { type ReactElement, memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '@/lib/utils';
import type { RoomAssignment } from '@/types';

export interface DraggableRoomAssignmentData {
  readonly assignment: RoomAssignment;
}

interface DraggableRoomAssignmentProps {
  readonly assignment: RoomAssignment;
  readonly label: string;
  readonly color: string;
  readonly style: React.CSSProperties;
  /** Tooltip and screen reader text (e.g. includes dates when the visible label is only a name). */
  readonly accessibilityLabel?: string;
}

const DraggableRoomAssignment = memo(function DraggableRoomAssignment({
  assignment,
  label,
  color,
  style,
  accessibilityLabel,
}: DraggableRoomAssignmentProps): ReactElement {
  const draggableId = `assignment-${assignment.id}`;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    data: { assignment } satisfies DraggableRoomAssignmentData,
  });

  const dragStyle = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  return (
    <button
      type="button"
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        'absolute rounded-md px-2 text-xs flex items-center',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        'transition-opacity hover:opacity-90',
        isDragging && 'opacity-60 cursor-grabbing',
      )}
      style={{
        ...style,
        ...dragStyle,
        backgroundColor: color,
        color: 'white',
      }}
      title={accessibilityLabel ?? label}
      aria-label={accessibilityLabel ?? label}
    >
      <span className="truncate">{label}</span>
    </button>
  );
});

export { DraggableRoomAssignment };

