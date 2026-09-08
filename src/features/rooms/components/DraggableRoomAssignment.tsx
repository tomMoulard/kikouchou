/**
 * @fileoverview Draggable room assignment pill for room timeline.
 *
 * @module features/rooms/components/DraggableRoomAssignment
 */

import { type PointerEvent, type ReactElement, memo } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import {
  RoomPickerMenu,
  type RoomPickerOption,
} from '@/features/rooms/components/RoomPickerMenu';
import { useRoomPickerMenu } from '@/features/rooms/hooks/useRoomPickerMenu';
import type { RoomAssignment, RoomId } from '@/types';

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
  /**
   * The other rooms this stay can move to, for the pill's menu.
   *
   * Dragging the pill onto another room is a mouse-only move; the menu is the
   * same move for a keyboard, a screen reader and a tap.
   */
  readonly assignableRooms?: readonly RoomPickerOption[];
  /** Called with the room picked from the menu */
  readonly onAssignRoom?: (roomId: RoomId) => void;
}

const DraggableRoomAssignment = memo(function DraggableRoomAssignment({
  assignment,
  label,
  color,
  style,
  accessibilityLabel,
  assignableRooms,
  onAssignRoom,
}: DraggableRoomAssignmentProps): ReactElement {
  const { t } = useTranslation();

  const draggableId = `assignment-${assignment.id}`;

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    data: { assignment } satisfies DraggableRoomAssignmentData,
  });

  const hasMenu = onAssignRoom !== undefined && (assignableRooms?.length ?? 0) > 0;
  const { isOpen, setIsOpen, tapHandlers } = useRoomPickerMenu(hasMenu);

  // Merged rather than spread over: dnd-kit's pointer sensor listens on
  // `onPointerDown` itself, and replacing it would leave the pill undraggable.
  const handleProps = {
    ...listeners,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      listeners?.onPointerDown?.(event);
      tapHandlers.onPointerDown(event);
    },
    onClick: tapHandlers.onClick,
  };

  const dragStyle = transform
    ? {
        transform: CSS.Translate.toString(transform),
      }
    : undefined;

  return (
    <div
      className={cn(
        'absolute flex items-center gap-1 rounded-md pl-2 pr-0.5 text-xs',
        'transition-opacity hover:opacity-90',
        isDragging && 'opacity-60',
      )}
      style={{
        ...style,
        ...dragStyle,
        backgroundColor: color,
        color: 'white',
      }}
      title={accessibilityLabel ?? label}
    >
      {/* The handle carries the drag and the accessible name; the menu trigger
          is its sibling, because a button nested inside this `role="button"`
          node would not be reliably reachable and a press on it would start a
          drag. */}
      <div
        ref={setNodeRef}
        {...attributes}
        {...handleProps}
        className={cn(
          'flex min-w-0 flex-1 items-center self-stretch touch-none select-none',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          isDragging ? 'cursor-grabbing' : 'cursor-grab active:cursor-grabbing',
        )}
        aria-label={accessibilityLabel ?? label}
      >
        <span className="truncate">{label}</span>
      </div>
      {hasMenu && onAssignRoom !== undefined && assignableRooms !== undefined && (
        <RoomPickerMenu
          triggerLabel={t('rooms.assignMenu.moveTrigger', {
            name: label,
            defaultValue: 'Move {{name}} to another room',
          })}
          heading={t('rooms.assignMenu.moveHeading', 'Move to…')}
          rooms={assignableRooms}
          onSelectRoom={onAssignRoom}
          open={isOpen}
          onOpenChange={setIsOpen}
        />
      )}
    </div>
  );
});

export { DraggableRoomAssignment };
