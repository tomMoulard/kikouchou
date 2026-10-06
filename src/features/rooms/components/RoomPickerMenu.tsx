/**
 * @fileoverview Room menu for the timeline chips — the pointer-free way to put
 * a guest in a room.
 *
 * A drag is a fine shortcut for a mouse, and it is nothing at all for a
 * keyboard, a screen reader, or a thumb that would rather tap than hold. This
 * menu carries the same decision the drop does: pick a room, and the chip's
 * owner is housed there.
 *
 * The trigger is a sibling of the draggable node rather than a child of it, for
 * two reasons: a button inside another `role="button"` is not reliably reachable
 * for a screen reader, and a press on it must not be read as the start of a
 * drag.
 *
 * @module features/rooms/components/RoomPickerMenu
 */

import { type ReactElement, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { MoreHorizontal } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { RoomId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * A room the menu can send the chip to.
 */
export interface RoomPickerOption {
  /** The room */
  readonly id: RoomId;
  /** The room name, as the menu shows it */
  readonly name: string;
  /** Beds still free over the dates in question; 0 marks a full room */
  readonly availableSpots: number;
}

/**
 * Props for the RoomPickerMenu component.
 */
export interface RoomPickerMenuProps {
  /** Accessible name of the trigger, e.g. "Assign Marc to a room" */
  readonly triggerLabel: string;
  /** Heading inside the menu, e.g. "Move to…" */
  readonly heading: string;
  /** The rooms on offer */
  readonly rooms: readonly RoomPickerOption[];
  /** Called with the room the user picked */
  readonly onSelectRoom: (roomId: RoomId) => void;
  /** Whether the menu is open */
  readonly open: boolean;
  /** Called when the menu opens or closes */
  readonly onOpenChange: (open: boolean) => void;
  /** Additional CSS classes for the trigger */
  readonly className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * RoomPickerMenu lists the rooms a chip can be sent to.
 *
 * A full room stays on the list, marked as full: a drop on one is allowed and
 * warned about afterwards, and the menu must not be stricter than the drag it
 * stands in for.
 *
 * @example
 * ```tsx
 * <RoomPickerMenu
 *   triggerLabel="Assign Marc to a room"
 *   heading="Assign to…"
 *   rooms={[{ id: roomId, name: 'Attic', availableSpots: 1 }]}
 *   onSelectRoom={handleSelectRoom}
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 * />
 * ```
 */
const RoomPickerMenu = memo(function RoomPickerMenu(props: RoomPickerMenuProps): ReactElement {
  const {
    triggerLabel,
    heading,
    rooms,
    onSelectRoom,
    open,
    onOpenChange,
    className,
  } = props;

  const { t } = useTranslation();

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={triggerLabel}
          className={cn(
            'flex size-5 shrink-0 items-center justify-center rounded-sm',
            'opacity-70 hover:opacity-100',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            className,
          )}
        >
          <MoreHorizontal className="size-3" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>{heading}</DropdownMenuLabel>
        {rooms.map((room) => (
          <DropdownMenuItem key={room.id} onSelect={() => onSelectRoom(room.id)}>
            <span className="truncate">{room.name}</span>
            <span className="ml-auto pl-2 text-xs text-muted-foreground">
              {room.availableSpots > 0
                ? t('rooms.spotsOpen', { count: room.availableSpots })
                : t('rooms.full')}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
});

// ============================================================================
// Exports
// ============================================================================

export { RoomPickerMenu };
