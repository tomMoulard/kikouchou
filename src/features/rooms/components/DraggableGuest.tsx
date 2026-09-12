/**
 * @fileoverview DraggableGuest component for drag-and-drop room assignments.
 * Wraps PersonBadge with dnd-kit draggable functionality.
 *
 * @module features/rooms/components/DraggableGuest
 */

import { type CSSProperties, type PointerEvent, type ReactElement, memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { GripVertical } from 'lucide-react';

import { cn } from '@/lib/utils';
import { PersonBadge } from '@/components/shared/PersonBadge';
import {
  RoomPickerMenu,
  type RoomPickerOption,
} from '@/features/rooms/components/RoomPickerMenu';
import { useRoomPickerMenu } from '@/features/rooms/hooks/useRoomPickerMenu';
import type { Person, RoomId } from '@/types';

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
  /**
   * Rooms the guest can be sent to without a drag.
   *
   * With {@link DraggableGuestProps.onAssignRoom}, these become a menu on the
   * chip: the path a keyboard, a screen reader and a tap all have, where a
   * drag is the one a mouse has.
   */
  readonly assignableRooms?: readonly RoomPickerOption[];
  /** Called with the room picked from the menu */
  readonly onAssignRoom?: (roomId: RoomId) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * DraggableGuest provides a draggable person badge for room assignment.
 *
 * When dragged and dropped on a DroppableRoom, it triggers the assignment
 * dialog with the person and their stay dates pre-filled. The same assignment
 * is available from the chip's room menu, which needs no pointer.
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
    assignableRooms,
    onAssignRoom,
  } = props;

  const { t } = useTranslation();

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

  const menuRooms = disabled ? undefined : assignableRooms;
  const hasMenu = onAssignRoom !== undefined && (menuRooms?.length ?? 0) > 0;
  const { isOpen, setIsOpen, tapHandlers } = useRoomPickerMenu(hasMenu);

  // Apply transform style for drag movement
  const style: CSSProperties | undefined =
    transform || positionStyle
      ? {
          ...positionStyle,
          ...(transform ? { transform: CSS.Translate.toString(transform) } : {}),
        }
      : undefined;

  const menu =
    onAssignRoom !== undefined && menuRooms !== undefined && menuRooms.length > 0 ? (
      <RoomPickerMenu
        triggerLabel={t('rooms.assignMenu.trigger', {
          name: person.name,
          defaultValue: 'Assign {{name}} to a room',
        })}
        heading={t('rooms.assignMenu.assignHeading', 'Assign to…')}
        rooms={menuRooms}
        onSelectRoom={onAssignRoom}
        open={isOpen}
        onOpenChange={setIsOpen}
      />
    ) : null;

  // The handle is a sibling of the menu trigger rather than its parent: nesting
  // a button inside this `role="button"` node would hide it from a screen
  // reader, and a press on it would read as the start of a drag.
  //
  // `onPointerDown` is merged rather than spread over: dnd-kit's own pointer
  // sensor listens on that very prop, and replacing it would leave the chip
  // undraggable.
  const handleProps = {
    ...listeners,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      listeners?.onPointerDown?.(event);
      tapHandlers.onPointerDown(event);
    },
    onClick: tapHandlers.onClick,
  };

  const handleClassName = cn(
    'flex min-w-0 flex-1 items-center self-stretch touch-none select-none',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    isDragging && 'cursor-grabbing',
    !isDragging && !disabled && 'cursor-grab active:cursor-grabbing',
    disabled && 'cursor-not-allowed',
  );

  if (bar) {
    return (
      <div
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
        className={cn(
          'absolute flex items-center gap-1 rounded-md pl-2 pr-0.5 text-xs',
          'border-2 border-dashed text-foreground',
          'transition-opacity hover:opacity-90',
          isDragging && 'opacity-60 z-50',
          disabled && 'opacity-50',
          className,
        )}
        title={person.name}
        data-unhoused="true"
      >
        <div
          ref={setNodeRef}
          {...attributes}
          {...handleProps}
          className={handleClassName}
          aria-label={person.name}
        >
          {/* Same grip the housed guest's pill carries, so both rows say
              "drag me" in the same way before the cursor changes. */}
          <GripVertical className="-ml-1 size-3 shrink-0 opacity-70" aria-hidden="true" />
          <span className="truncate">{person.name}</span>
        </div>
        {menu}
      </div>
    );
  }

  return (
    <div
      style={style}
      className={cn(
        'inline-flex items-center gap-1',
        isDragging && 'opacity-50 z-50',
        disabled && 'opacity-50',
        className,
      )}
      title={person.name}
    >
      <div
        ref={setNodeRef}
        {...attributes}
        {...handleProps}
        className={handleClassName}
        aria-label={person.name}
      >
        <PersonBadge person={person} size={size} />
      </div>
      {menu}
    </div>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { DraggableGuest };
