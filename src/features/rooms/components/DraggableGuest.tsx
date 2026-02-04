/**
 * @fileoverview DraggableGuest component for drag-and-drop room assignments.
 * Wraps PersonBadge with dnd-kit draggable functionality.
 *
 * @module features/rooms/components/DraggableGuest
 */

import { type ReactElement, memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';

import { cn } from '@/lib/utils';
import { PersonBadge } from '@/components/shared/PersonBadge';
import type { Person } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Data attached to a draggable guest item.
 */
export interface DraggableGuestData {
  /** The person being dragged */
  readonly person: Person;
  /** The start date for the potential assignment */
  readonly startDate: string;
  /** The end date for the potential assignment */
  readonly endDate: string;
}

/**
 * Props for the DraggableGuest component.
 */
export interface DraggableGuestProps {
  /** The person to display */
  readonly person: Person;
  /** The start date they need a room (from unassigned dates) */
  readonly startDate: string;
  /** The end date they need a room (from unassigned dates) */
  readonly endDate: string;
  /** Size variant for the badge */
  readonly size?: 'sm' | 'default';
  /** Additional CSS classes */
  readonly className?: string;
  /** Whether drag is disabled */
  readonly disabled?: boolean;
}

// ============================================================================
// Component
// ============================================================================

/**
 * DraggableGuest provides a draggable person badge for room assignment.
 *
 * When dragged and dropped on a DroppableRoom, it triggers the assignment
 * dialog with the person and their stay dates pre-filled.
 *
 * @example
 * ```tsx
 * <DraggableGuest
 *   person={person}
 *   startDate="2026-01-05"
 *   endDate="2026-01-10"
 *   size="sm"
 * />
 * ```
 */
const DraggableGuest = memo(function DraggableGuest(props: DraggableGuestProps): ReactElement {
  const { person, startDate, endDate, size = 'sm', className, disabled = false } = props;

  // Create unique ID for this draggable
  const draggableId = `guest-${person.id}`;

  // Set up dnd-kit draggable
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    data: {
      person,
      startDate,
      endDate,
    } satisfies DraggableGuestData,
    disabled,
  });

  // Apply transform style for drag movement
  const style = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={cn(
        // Base styles
        'inline-flex touch-none select-none',
        // Dragging state
        isDragging && 'opacity-50 cursor-grabbing z-50',
        // Not dragging state
        !isDragging && !disabled && 'cursor-grab active:cursor-grabbing',
        // Disabled state
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <PersonBadge person={person} size={size} />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { DraggableGuest };
