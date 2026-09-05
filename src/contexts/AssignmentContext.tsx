/**
 * @fileoverview Assignment Context for managing room assignments within the current trip.
 * Provides reactive assignment data and CRUD operations scoped to the selected trip.
 *
 * @module contexts/AssignmentContext
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
  checkAssignmentConflict as repositoryCheckAssignmentConflict,
  createAssignment as repositoryCreateAssignment,
  deleteAssignmentWithOwnershipCheck,
  updateAssignmentWithOwnershipCheck,
} from '@/lib/db';
import type {
  ISODateString,
  PersonId,
  RoomAssignment,
  RoomAssignmentFormData,
  RoomAssignmentId,
  RoomId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Public interface for the Assignment Context value.
 * Provides access to assignment data and CRUD operations for the current trip.
 */
export interface AssignmentContextValue {
  /**
   * Array of room assignments for the current trip, sorted by start date.
   * Empty array if no trip is selected or during loading.
   */
  readonly assignments: readonly RoomAssignment[];

  /**
   * True while assignment data is being loaded from IndexedDB.
   * Also true during initial load when a trip is selected.
   */
  readonly isLoading: boolean;

  /**
   * Error from the most recent operation, or null if no error.
   * Cleared automatically before each new operation.
   */
  readonly error: Error | null;

  /**
   * Creates a new room assignment in the current trip.
   *
   * @param data - The assignment form data (roomId, personId, startDate, endDate)
   * @returns The created RoomAssignment object
   * @throws {Error} If no trip is currently selected or creation fails
   */
  createAssignment: (data: RoomAssignmentFormData) => Promise<RoomAssignment>;

  /**
   * Updates an existing room assignment.
   * Verifies the assignment belongs to the current trip before updating.
   *
   * @param id - The assignment ID to update
   * @param data - Partial assignment form data to update
   * @throws {Error} If no trip selected, assignment not found, or doesn't belong to current trip
   */
  updateAssignment: (
    id: RoomAssignmentId,
    data: Partial<RoomAssignmentFormData>,
  ) => Promise<void>;

  /**
   * Deletes a room assignment.
   * Verifies the assignment belongs to the current trip before deleting.
   *
   * @param id - The assignment ID to delete
   * @throws {Error} If no trip selected or assignment doesn't belong to current trip
   */
  deleteAssignment: (id: RoomAssignmentId) => Promise<void>;

  /**
   * Synchronously retrieves all assignments for a specific room.
   * This is a fast O(1) lookup using an internal Map.
   *
   * @param roomId - The room ID to filter by
   * @returns Array of assignments for the room, empty array if none found
   */
  getAssignmentsByRoom: (roomId: RoomId) => RoomAssignment[];

  /**
   * Synchronously retrieves all assignments for a specific person.
   * This is a fast O(1) lookup using an internal Map.
   *
   * @param personId - The person ID to filter by
   * @returns Array of assignments for the person, empty array if none found
   */
  getAssignmentsByPerson: (personId: PersonId) => RoomAssignment[];

  /**
   * Checks if a person has conflicting assignments for the given date range.
   * A conflict exists when the person is already assigned to another room
   * for any overlapping dates.
   *
   * @param personId - The person to check for conflicts
   * @param startDate - Start date of the proposed assignment (YYYY-MM-DD)
   * @param endDate - End date of the proposed assignment (YYYY-MM-DD)
   * @param excludeId - Optional assignment ID to exclude (for edit scenarios)
   * @returns True if a conflict exists, false otherwise
   * @throws {Error} If no trip is currently selected
   */
  checkConflict: (
    personId: PersonId,
    startDate: ISODateString,
    endDate: ISODateString,
    excludeId?: RoomAssignmentId,
  ) => Promise<boolean>;
}

/**
 * Props for the AssignmentProvider component.
 */
interface AssignmentProviderProps {
  /** Child components to render within the provider */
  readonly children: ReactNode;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Comparison function for RoomAssignment objects.
 * Compares all mutable properties for equality checking.
 */
const compareAssignments = (a: RoomAssignment, b: RoomAssignment): boolean =>
  a.id === b.id &&
  a.roomId === b.roomId &&
  a.personId === b.personId &&
  a.startDate === b.startDate &&
  a.endDate === b.endDate;

/**
 * Compares two assignment arrays for equality based on IDs and properties.
 * Uses the generic areArraysEqual utility with Assignment-specific comparison.
 */
const areAssignmentsEqual = (a: RoomAssignment[], b: RoomAssignment[]): boolean =>
  areArraysEqual(a, b, compareAssignments);

/**
 * Builds lookup maps for O(1) access by room and person ID.
 */
function buildAssignmentMaps(
  assignments: RoomAssignment[],
): {
  byRoom: Map<RoomId, RoomAssignment[]>;
  byPerson: Map<PersonId, RoomAssignment[]>;
} {
  const byRoom = new Map<RoomId, RoomAssignment[]>(),
   byPerson = new Map<PersonId, RoomAssignment[]>();

  for (const assignment of assignments) {
    // Group by room
    const roomAssignments = byRoom.get(assignment.roomId);
    if (roomAssignments) {
      roomAssignments.push(assignment);
    } else {
      byRoom.set(assignment.roomId, [assignment]);
    }

    // Group by person
    const personAssignments = byPerson.get(assignment.personId);
    if (personAssignments) {
      personAssignments.push(assignment);
    } else {
      byPerson.set(assignment.personId, [assignment]);
    }
  }

  return { byRoom, byPerson };
}

// ============================================================================
// Context Creation
// ============================================================================

/**
 * React Context for assignment state management.
 * Initial value is null to enforce provider usage via useAssignmentContext hook.
 *
 * @internal Use useAssignmentContext hook instead of consuming this directly
 */
const AssignmentContext = createContext<AssignmentContextValue | null>(null);

AssignmentContext.displayName = 'AssignmentContext';

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Provides room assignment state management for the current trip.
 *
 * Features:
 * - Reactive data binding via Dexie live queries
 * - Automatic assignment filtering by current trip
 * - CRUD operations with proper error handling
 * - Assignments sorted by start date
 * - Assignment ownership validation for security
 * - O(1) lookup by room and person via Maps
 * - Conflict detection for overlapping date ranges
 *
 * @remarks
 * Must be used within a TripProvider. When no trip is selected,
 * assignments will be an empty array and CRUD operations will throw errors.
 *
 * @param props - Provider props including children
 * @returns Provider component wrapping children with assignment context
 *
 * @example
 * ```tsx
 * import { AssignmentProvider } from '@/contexts/AssignmentContext';
 *
 * function App() {
 *   return (
 *     <TripProvider>
 *       <AssignmentProvider>
 *         <CalendarView />
 *       </AssignmentProvider>
 *     </TripProvider>
 *   );
 * }
 * ```
 */
export function AssignmentProvider({
  children,
}: AssignmentProviderProps): ReactElement {
  // Get current trip from TripContext - extract ID to avoid object reference issues
  const { currentTrip } = useTripContext(),
   currentTripId = currentTrip?.id,

  // Error state for CRUD operations
   [error, setError] = useState<Error | null>(null),

  // Stable array reference to prevent unnecessary re-renders
  // Updated via useEffect to avoid side effects during render
   assignmentsRef = useRef<RoomAssignment[]>([]),

  // Map for O(1) assignment lookup by ID
  // Used for fast validation in update/delete operations
   assignmentsMapRef = useRef<Map<RoomAssignmentId, RoomAssignment>>(
    new Map(),
  ),

  // Maps for O(1) lookup by room and person
  // Updated via useEffect to stay in sync with assignments array
   assignmentsByRoomMapRef = useRef<Map<RoomId, RoomAssignment[]>>(
    new Map(),
  ),
   assignmentsByPersonMapRef = useRef<Map<PersonId, RoomAssignment[]>>(
    new Map(),
  ),

  // Live query for assignments, scoped to current trip
  // Re-runs automatically when currentTripId changes or assignments are modified
   assignmentsQuery = useLiveQuery(
    async () => {
      if (!currentTripId) {
        return [];
      }

      try {
        // Use compound index [tripId+startDate] for efficient sorted query
        return await db.roomAssignments
          .where('[tripId+startDate]')
          .between([currentTripId, ''], [currentTripId, '\uffff'])
          .toArray();
      } catch (err) {
        // Surface query errors to the error state
        const queryError =
          err instanceof Error ? err : new Error('Failed to load assignments');
        setError(queryError);
        return [];
      }
    },
    [currentTripId],
  ),

  // Determine loading state
  // Loading when query hasn't resolved yet AND a trip is selected
   isLoading = currentTripId !== undefined && assignmentsQuery === undefined,

  // State to hold stable assignments (replacing ref for render-safe access)
   [assignments, setAssignments] = useState<RoomAssignment[]>([]),

  // Get raw assignments from query, wrapped in useMemo to prevent dependency warnings
   rawAssignments = useMemo(
    () => assignmentsQuery ?? [],
    [assignmentsQuery]
  );

  // Clear state and error when trip changes to prevent stale cross-trip data
  useEffect(() => {
    setAssignments([]);
    assignmentsRef.current = [];
    assignmentsMapRef.current = new Map();
    assignmentsByRoomMapRef.current = new Map();
    assignmentsByPersonMapRef.current = new Map();
    setError(null); // CR-8: Clear error state on trip change
  }, [currentTripId]);

  // Update stable array reference and Maps via useEffect (not during render)
  // This prevents mutable state updates during render phase
  useEffect(() => {
    if (!areAssignmentsEqual(rawAssignments, assignmentsRef.current)) {
      assignmentsRef.current = rawAssignments;
      // Rebuild the Maps for O(1) lookups
      const { byRoom, byPerson } = buildAssignmentMaps(rawAssignments);
      assignmentsByRoomMapRef.current = byRoom;
      assignmentsByPersonMapRef.current = byPerson;
      // Build ID map for O(1) validation lookups
      assignmentsMapRef.current = new Map(rawAssignments.map((a) => [a.id, a]));
      // Update state for render-safe access
      setAssignments(rawAssignments);
    }
  }, [rawAssignments]);

  // Use assignments from state (render-safe)
  const

  /**
   * Creates a new room assignment in the current trip.
   */
   createAssignment = useCallback(
    async (data: RoomAssignmentFormData): Promise<RoomAssignment> => {
      // Capture tripId at invocation time to avoid stale closure
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot create assignment: no trip selected');
      }

      // Clear error using functional update (avoids error in deps)
      setError((prev) => (prev === null ? prev : null));

      try {
        return await repositoryCreateAssignment(tripId, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to create assignment', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Updates an existing assignment with ownership validation.
   * Uses transactional operation to prevent TOCTOU race condition (CR-2).
   */
   updateAssignment = useCallback(
    async (
      id: RoomAssignmentId,
      data: Partial<RoomAssignmentFormData>,
    ): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot update assignment: no trip selected');
      }

      setError((prev) => (prev === null ? prev : null));

      try {
        // CR-2: Use transactional function that combines validation + mutation atomically
        await updateAssignmentWithOwnershipCheck(id, tripId, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to update assignment', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Deletes an assignment with ownership validation.
   * Uses transactional operation to prevent TOCTOU race condition (CR-2).
   */
   deleteAssignment = useCallback(
    async (id: RoomAssignmentId): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot delete assignment: no trip selected');
      }

      setError((prev) => (prev === null ? prev : null));

      try {
        // CR-2: Use transactional function that combines validation + deletion atomically
        await deleteAssignmentWithOwnershipCheck(id, tripId);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to delete assignment', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Synchronously retrieves assignments by room using O(1) Map lookup.
   */
   getAssignmentsByRoom = useCallback(
    (roomId: RoomId): RoomAssignment[] => assignmentsByRoomMapRef.current.get(roomId) ?? [],
    [],
  ),

  /**
   * Synchronously retrieves assignments by person using O(1) Map lookup.
   */
   getAssignmentsByPerson = useCallback(
    (personId: PersonId): RoomAssignment[] => assignmentsByPersonMapRef.current.get(personId) ?? [],
    [],
  ),

  /**
   * Checks for conflicting assignments for a person in the given date range.
   */
   checkConflict = useCallback(
    async (
      personId: PersonId,
      startDate: ISODateString,
      endDate: ISODateString,
      excludeId?: RoomAssignmentId,
    ): Promise<boolean> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot check conflict: no trip selected');
      }

      setError((prev) => (prev === null ? prev : null));

      try {
        return await repositoryCheckAssignmentConflict(
          tripId,
          personId,
          startDate,
          endDate,
          excludeId,
        );
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to check assignment conflict', setError);
      }
    },
    [currentTripId],
  ),

  // Memoize context value to prevent unnecessary re-renders in consumers
   contextValue = useMemo<AssignmentContextValue>(
    () => ({
      assignments,
      isLoading,
      error,
      createAssignment,
      updateAssignment,
      deleteAssignment,
      getAssignmentsByRoom,
      getAssignmentsByPerson,
      checkConflict,
    }),
    [
      assignments,
      isLoading,
      error,
      createAssignment,
      updateAssignment,
      deleteAssignment,
      getAssignmentsByRoom,
      getAssignmentsByPerson,
      checkConflict,
    ],
  );

  return (
    <AssignmentContext.Provider value={contextValue}>
      {children}
    </AssignmentContext.Provider>
  );
}

// ============================================================================
// Custom Hook
// ============================================================================

/**
 * Hook to access the Assignment Context.
 *
 * Must be used within both TripProvider and AssignmentProvider components.
 * Throws an error if used outside the provider to catch misuse early.
 *
 * @returns The assignment context value with assignment data and CRUD operations
 * @throws {Error} If called outside of AssignmentProvider
 *
 * @example
 * ```tsx
 * import { useAssignmentContext } from '@/contexts/AssignmentContext';
 *
 * function CalendarView() {
 *   const {
 *     assignments,
 *     isLoading,
 *     getAssignmentsByRoom,
 *     checkConflict,
 *   } = useAssignmentContext();
 *
 *   if (isLoading) {
 *     return <Spinner />;
 *   }
 *
 *   return (
 *     <div>
 *       {assignments.map((assignment) => (
 *         <AssignmentCard key={assignment.id} assignment={assignment} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useAssignmentContext(): AssignmentContextValue {
  const context = useContext(AssignmentContext);

  if (context === null) {
    throw new Error(
      'useAssignmentContext must be used within an AssignmentProvider. ' +
        'Wrap your component tree with <AssignmentProvider>.',
    );
  }

  return context;
}

// ============================================================================
// Exports
// ============================================================================

export { AssignmentContext };
export type { AssignmentProviderProps };
