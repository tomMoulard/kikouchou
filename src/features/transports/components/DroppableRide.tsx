/**
 * @fileoverview A car journey as a drop target for a guest's own leg.
 *
 * Wrapping the card rather than teaching it about drag-and-drop, the way
 * `DroppableAssignment` wraps a room assignment. `RideCard` is also drawn by
 * the calendar's detail dialog and by tests that mount it on its own, none of
 * which sit inside a `DndContext` — and `useDroppable` outside one throws.
 *
 * The highlight is on the wrapper, not the card: a ring drawn inside the card's
 * own border reads as a focus ring, and this is not focus.
 *
 * @module features/transports/components/DroppableRide
 */

import { type ReactElement, type ReactNode, memo } from 'react';
import { useDroppable } from '@dnd-kit/core';

import { cn } from '@/lib/utils';
import type { RideId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/** What a drop on a ride carries back to the page's `onDragEnd`. */
export interface DroppableRideData {
  /** The journey the leg would join. */
  readonly rideId: RideId;
}

/** Props for {@link DroppableRide}. */
export interface DroppableRideProps {
  /** The journey this target stands for. */
  readonly rideId: RideId;
  /** The card to wrap. */
  readonly children: ReactNode;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * The prefix every ride droppable's id carries.
 *
 * Exported so the page can tell a ride target apart from any other droppable
 * that ends up in the same `DndContext` without matching on a bare string.
 */
export const RIDE_DROPPABLE_PREFIX = 'ride-drop-';

// ============================================================================
// Component
// ============================================================================

/**
 * Makes one ride card accept a leg dragged onto it.
 *
 * @param props - {@link DroppableRideProps}
 * @returns The wrapped card
 *
 * @example
 * ```tsx
 * <DroppableRide rideId={journey.ride.id}>
 *   <RideCard journey={journey} … />
 * </DroppableRide>
 * ```
 */
export const DroppableRide = memo(function DroppableRide({
  rideId,
  children,
}: DroppableRideProps): ReactElement {
  const { setNodeRef, isOver } = useDroppable({
    id: `${RIDE_DROPPABLE_PREFIX}${rideId}`,
    data: { rideId } satisfies DroppableRideData,
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-xl transition-shadow',
        isOver && 'ring-2 ring-primary ring-offset-2 ring-offset-background',
      )}
    >
      {children}
    </div>
  );
});
