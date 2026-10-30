/**
 * @fileoverview Menu state for a timeline chip, and the tap that opens it.
 *
 * @module features/rooms/hooks/useRoomPickerMenu
 */

import { type MouseEvent, type PointerEvent, useRef, useState } from 'react';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Pointer handlers that turn a tap on the chip into an open menu.
 */
export interface RoomPickerTapHandlers {
  readonly onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  readonly onClick: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * What {@link useRoomPickerMenu} gives a chip.
 */
export interface RoomPickerMenuState {
  /** Whether the menu is open */
  readonly isOpen: boolean;
  /** Opens or closes the menu */
  readonly setIsOpen: (open: boolean) => void;
  /** Handlers for the chip body, which opens the menu on a tap */
  readonly tapHandlers: RoomPickerTapHandlers;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * How far the pointer may travel and still count as a tap.
 *
 * The same distance the rooms page's mouse sensor needs before it calls a press
 * a drag, so a press either drags or opens the menu, never both.
 */
const TAP_MOVE_TOLERANCE_PX = 8;

// ============================================================================
// Hook
// ============================================================================

/**
 * Menu state for a chip, plus the handlers that open it on a tap.
 *
 * @param enabled - Whether the chip has a menu to open at all
 * @returns The open state, a setter for it, and handlers for the chip body
 */
export function useRoomPickerMenu(enabled: boolean): RoomPickerMenuState {
  const [isOpen, setIsOpen] = useState(false);
  const pointerDownAt = useRef<{ x: number; y: number } | null>(null);

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    pointerDownAt.current = { x: event.clientX, y: event.clientY };
  }

  function onClick(event: MouseEvent<HTMLElement>): void {
    const start = pointerDownAt.current;
    pointerDownAt.current = null;

    if (!enabled) {
      return;
    }

    // A drag ends with a click too. Anything that travelled was the drag doing
    // its job, and the menu would be in the way.
    if (start) {
      const dx = event.clientX - start.x,
        dy = event.clientY - start.y;
      if (Math.sqrt(dx * dx + dy * dy) > TAP_MOVE_TOLERANCE_PX) {
        return;
      }
    }

    setIsOpen(true);
  }

  return { isOpen, setIsOpen, tapHandlers: { onPointerDown, onClick } };
}
