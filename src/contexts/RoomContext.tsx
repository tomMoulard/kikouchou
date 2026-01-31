/**
 * @fileoverview Room Context for managing rooms within the current trip.
 * Provides reactive room data and CRUD operations scoped to the selected trip.
 *
 * @module contexts/RoomContext
 */

import {
  type ReactElement,
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useTripContext } from '@/contexts/TripContext';
import { areArraysEqual, wrapAndSetError } from '@/contexts/utils';
import { db } from '@/lib/db/database';
import {
  createRoom as repositoryCreateRoom,
  deleteRoomWithOwnershipCheck,
  reorderRooms as repositoryReorderRooms,
  updateRoomWithOwnershipCheck,
} from '@/lib/db';
import type { Room, RoomFormData, RoomId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Public interface for the Room Context value.
 * Provides access to room data and CRUD operations for the current trip.
 */
export interface RoomContextValue {
  /**
   * Array of rooms for the current trip, sorted by order.
   * Empty array if no trip is selected or during loading.
   */
  readonly rooms: readonly Room[];

  /**
   * True while room data is being loaded from IndexedDB.
   * Also true during initial load when a trip is selected.
   */
  readonly isLoading: boolean;

  /**
   * Error from the most recent operation, or null if no error.
   * Cleared automatically before each new operation.
   */
  readonly error: Error | null;

  /**
   * Creates a new room in the current trip.
   *
   * @param data - The room form data (name, capacity, description)
   * @returns The created Room object
   * @throws {Error} If no trip is currently selected
   */
  createRoom: (data: RoomFormData) => Promise<Room>;

  /**
   * Updates an existing room.
   * Verifies the room belongs to the current trip before updating.
   *
   * @param id - The room ID to update
   * @param data - Partial room form data to update
   * @throws {Error} If no trip is currently selected, room not found, or room doesn't belong to current trip
   */
  updateRoom: (id: RoomId, data: Partial<RoomFormData>) => Promise<void>;

  /**
   * Deletes a room and its associated assignments.
   * Verifies the room belongs to the current trip before deleting.
   *
   * @param id - The room ID to delete
   * @throws {Error} If no trip is currently selected or room doesn't belong to current trip
   */
  deleteRoom: (id: RoomId) => Promise<void>;

  /**
   * Reorders rooms within the current trip.
   * Validates that all provided IDs exist and belong to the current trip.
   *
   * @param roomIds - Array of room IDs in the desired order
   * @throws {Error} If no trip is currently selected or validation fails
   */
  reorderRooms: (roomIds: RoomId[]) => Promise<void>;
}

/**
 * Props for the RoomProvider component.
 */
interface RoomProviderProps {
  /** Child components to render within the provider */
  readonly children: ReactNode;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Comparison function for Room objects.
 * Compares all mutable properties to ensure refs are updated when any room property is modified.
 */
const compareRooms = (a: Room, b: Room): boolean =>
  a.id === b.id &&
  a.order === b.order &&
  a.name === b.name &&
  a.capacity === b.capacity &&
  a.description === b.description;

/**
 * Compares two room arrays for equality based on IDs and all mutable properties.
 * Uses the generic areArraysEqual utility with Room-specific comparison.
 */
const areRoomsEqual = (a: Room[], b: Room[]): boolean =>
  areArraysEqual(a, b, compareRooms);

// ============================================================================
// Context Creation
// ============================================================================

/**
 * React Context for room state management.
 * Initial value is null to enforce provider usage via useRoomContext hook.
 *
 * @internal Use useRoomContext hook instead of consuming this directly
 */
const RoomContext = createContext<RoomContextValue | null>(null);

RoomContext.displayName = 'RoomContext';

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Provides room state management for the current trip.
 *
 * Features:
 * - Reactive data binding via Dexie live queries
 * - Automatic room filtering by current trip
 * - CRUD operations with proper error handling
 * - Rooms sorted by order field
 * - Room ownership validation for security
 *
 * @remarks
 * Must be used within a TripProvider. When no trip is selected,
 * rooms will be an empty array and CRUD operations will throw errors.
 *
 * @param props - Provider props including children
 * @returns Provider component wrapping children with room context
 *
 * @example
 * ```tsx
 * import { RoomProvider } from '@/contexts/RoomContext';
 *
 * function App() {
 *   return (
 *     <TripProvider>
 *       <RoomProvider>
 *         <RoomList />
 *       </RoomProvider>
 *     </TripProvider>
 *   );
 * }
 * ```
 */
export function RoomProvider({ children }: RoomProviderProps): ReactElement {
  // Get current trip from TripContext - extract ID to avoid object reference issues
  const { currentTrip } = useTripContext(),
   currentTripId = currentTrip?.id,

  // Error state for CRUD operations
   [error, setError] = useState<Error | null>(null),

  // Stable array reference to prevent unnecessary re-renders
   roomsRef = useRef<Room[]>([]),

  // Live query for rooms, scoped to current trip
  // Re-runs automatically when currentTripId changes or rooms are modified
   roomsQuery = useLiveQuery(
    async () => {
      if (!currentTripId) {
        return [];
      }

      try {
        // Use compound index [tripId+order] for efficient sorted query
        return await db.rooms
          .where('[tripId+order]')
          .between([currentTripId, 0], [currentTripId, Infinity])
          .toArray();
      } catch (err) {
        // Surface query errors to the error state
        const queryError =
          err instanceof Error ? err : new Error('Failed to load rooms');
        setError(queryError);
        return [];
      }
    },
    [currentTripId],
  ),

  // Determine loading state
  // Loading when query hasn't resolved yet AND a trip is selected
   isLoading = currentTripId !== undefined && roomsQuery === undefined,

  // Get raw rooms from query, defaulting to empty array
  // Wrapped in useMemo to prevent dependency changes on every render
   rawRooms = useMemo(() => roomsQuery ?? [], [roomsQuery]),

  // State to hold stable rooms (replacing ref for render-safe access)
   [rooms, setRooms] = useState<Room[]>([]);

  // Clear state and error when trip changes to prevent stale cross-trip data
  useEffect(() => {
    setRooms([]);
    roomsRef.current = [];
    setError(null); // CR-8: Clear error state on trip change
  }, [currentTripId]);

  // Update stable array reference via useEffect (not during render)
  // This prevents mutable state updates during render phase
  useEffect(() => {
    if (!areRoomsEqual(rawRooms, roomsRef.current)) {
      roomsRef.current = rawRooms;
      // Update state for render-safe access
      setRooms(rawRooms);
    }
  }, [rawRooms]);

  // Use rooms from state (render-safe)
  const

  /**
   * Creates a new room in the current trip.
   */
   createRoom = useCallback(
    async (data: RoomFormData): Promise<Room> => {
      // Capture tripId at invocation time to avoid stale closure
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot create room: no trip selected');
      }

      // Clear error only if there was one (avoid unnecessary renders)
      setError((prev) => (prev === null ? prev : null));

      try {
        return await repositoryCreateRoom(tripId, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to create room', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Updates an existing room with ownership validation.
   * Uses transactional operation to prevent TOCTOU race condition (CR-2).
   */
   updateRoom = useCallback(
    async (id: RoomId, data: Partial<RoomFormData>): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot update room: no trip selected');
      }

      setError((prev) => (prev === null ? prev : null));

      try {
        // CR-2: Use transactional function that combines validation + mutation atomically
        await updateRoomWithOwnershipCheck(id, tripId, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to update room', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Deletes a room with ownership validation.
   * Uses transactional operation to prevent TOCTOU race condition (CR-2).
   */
   deleteRoom = useCallback(
    async (id: RoomId): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot delete room: no trip selected');
      }

      setError((prev) => (prev === null ? prev : null));

      try {
        // CR-2: Use transactional function that combines validation + deletion atomically
        await deleteRoomWithOwnershipCheck(id, tripId);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to delete room', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Reorders rooms within the current trip with validation.
   */
   reorderRooms = useCallback(
    async (roomIds: RoomId[]): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot reorder rooms: no trip selected');
      }

      // Validate input
      if (roomIds.length === 0) {
        throw new Error('Room IDs array cannot be empty');
      }

      // Check for duplicates
      const uniqueIds = new Set(roomIds);
      if (uniqueIds.size !== roomIds.length) {
        throw new Error('Duplicate room IDs detected');
      }

      // Validate all IDs match current rooms
      const currentRoomIds = new Set(rooms.map((r) => r.id)),
       missingFromReorder = [...currentRoomIds].filter(
        (id) => !uniqueIds.has(id),
      ),
       unknownIds = roomIds.filter((id) => !currentRoomIds.has(id));

      if (missingFromReorder.length > 0) {
        throw new Error(
          `Reorder missing rooms: ${missingFromReorder.join(', ')}`,
        );
      }
      if (unknownIds.length > 0) {
        throw new Error(`Unknown room IDs: ${unknownIds.join(', ')}`);
      }

      setError((prev) => (prev === null ? prev : null));

      try {
        await repositoryReorderRooms(tripId, roomIds);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to reorder rooms', setError);
      }
    },
    [currentTripId, rooms],
  ),

  // Memoize context value to prevent unnecessary re-renders in consumers
   contextValue = useMemo<RoomContextValue>(
    () => ({
      rooms,
      isLoading,
      error,
      createRoom,
      updateRoom,
      deleteRoom,
      reorderRooms,
    }),
    [rooms, isLoading, error, createRoom, updateRoom, deleteRoom, reorderRooms],
  );

  return (
    <RoomContext.Provider value={contextValue}>{children}</RoomContext.Provider>
  );
}

// ============================================================================
// Custom Hook
// ============================================================================

/**
 * Hook to access the Room Context.
 *
 * Must be used within both TripProvider and RoomProvider components.
 * Throws an error if used outside the provider to catch misuse early.
 *
 * @returns The room context value with room data and CRUD operations
 * @throws {Error} If called outside of RoomProvider
 *
 * @example
 * ```tsx
 * import { useRoomContext } from '@/contexts/RoomContext';
 *
 * function RoomList() {
 *   const { rooms, isLoading, createRoom } = useRoomContext();
 *
 *   if (isLoading) {
 *     return <Spinner />;
 *   }
 *
 *   return (
 *     <ul>
 *       {rooms.map((room) => (
 *         <li key={room.id}>
 *           {room.name} ({room.capacity} beds)
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useRoomContext(): RoomContextValue {
  const context = useContext(RoomContext);

  if (context === null) {
    throw new Error(
      'useRoomContext must be used within a RoomProvider. ' +
        'Wrap your component tree with <RoomProvider>.',
    );
  }

  return context;
}

// ============================================================================
// Exports
// ============================================================================

export { RoomContext };
export type { RoomProviderProps };
