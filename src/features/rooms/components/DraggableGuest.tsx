/**
 * @fileoverview DraggableGuest component for drag-and-drop room assignments.
 * Wraps PersonBadge with dnd-kit draggable functionality.
 *
 * @module features/rooms/components/DraggableGuest
 */

import { type CSSProperties, type ReactElement, memo } from 'react';
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
  /**
   * Render as a positioned bar spanning the guest's nights, the way an assigned
   * guest's pill is drawn, rather than as a badge sized to the name.
   *
   * The rooms timeline uses this for the "needs a room" row: same shape, same
   * name, same place on the day axis as a housed guest's pill, so the two can
   * be read against each other — but drawn as an outline rather than a filled
   * block, because this guest has no bed and the bar is a request, not a
   * booking.
   */
  readonly bar?: boolean;
  /** Positioning for {@link DraggableGuestProps.bar}; merged with the drag transform. */
  readonly style?: CSSProperties;
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
  const {
    person,
    startDate,
    endDate,
    size = 'sm',
    bar = false,
    style: positionStyle,
    className,
    disabled = false,
  } = props;

  // Create unique ID for this draggable.
  //
  // The stay is part of it, not decoration: a guest housed for only part of
  // their stay gets one bar per gap, and dnd-kit needs each to be its own
  // draggable or dragging one would pick up the other. Used nowhere but the
  // hook, so the shape is free to carry it.
  const draggableId = `guest-${person.id}-${startDate}-${endDate}`;

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
  const style: CSSProperties | undefined =
    transform || positionStyle
      ? {
          ...positionStyle,
          ...(transform ? { transform: CSS.Translate.toString(transform) } : {}),
        }
      : undefined;

  if (bar) {
    return (
      <div
        ref={setNodeRef}
        style={{
          ...style,
          // Dashed outline in the guest's own colour over a wash of it, rather
          // than the solid block a booked room gets. Keeps the colour identity
          // and the name legible while reading as provisional at a glance.
          //
          // The fill is mostly transparent, so the rendered background is the
          // page behind it and a contrast colour computed from `person.color`
          // would be wrong in both themes. `text-foreground` is already right
          // in each.
          borderColor: person.color,
          backgroundColor: `${person.color}26`,
        }}
        {...listeners}
        {...attributes}
        className={cn(
          'absolute flex items-center rounded-md px-2 text-xs touch-none select-none',
          'border-2 border-dashed text-foreground',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          'transition-opacity hover:opacity-90',
          isDragging && 'opacity-60 cursor-grabbing z-50',
          !isDragging && !disabled && 'cursor-grab active:cursor-grabbing',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
        title={person.name}
        aria-label={person.name}
        data-unhoused="true"
      >
        <span className="truncate">{person.name}</span>
      </div>
    );
  }

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
      title={person.name}
      aria-label={person.name}
    >
      <PersonBadge person={person} size={size} />
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { DraggableGuest };
