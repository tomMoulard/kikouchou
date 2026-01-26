/**
 * @fileoverview Assignment Context for managing room assignments within the current trip.
 * Provides reactive assignment data and CRUD operations scoped to the selected trip.
 *
 * @module contexts/AssignmentContext
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useLiveQuery } from 'dexie-react-hooks';

import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import {
  createAssignment as repositoryCreateAssignment,
  getAssignmentById as repositoryGetAssignmentById,
  updateAssignment as repositoryUpdateAssignment,
  deleteAssignment as repositoryDeleteAssignment,
  checkAssignmentConflict as repositoryCheckAssignmentConflict,
} from '@/lib/db';
import type {
  RoomAssignment,
  RoomAssignmentFormData,
  RoomAssignmentId,
  RoomId,
  PersonId,
  TripId,
  ISODateString,
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
 * Wraps an unknown error in an Error object and sets it in state.
 */
function wrapAndSetError(
  err: unknown,
  fallbackMessage: string,
  setError: (e: Error) => void,
): Error {
  const wrappedError =
    err instanceof Error ? err : new Error(fallbackMessage);
  setError(wrappedError);
  return wrappedError;
}

/**
 * Compares two assignment arrays for equality based on IDs and properties.
 * Used to maintain stable array references.
 */
function areAssignmentsEqual(a: RoomAssignment[], b: RoomAssignment[]): boolean {
  // Fast path: same reference means no change
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((assignment, index) => {
    const other = b[index];
    return (
      assignment.id === other?.id &&
      assignment.roomId === other?.roomId &&
      assignment.personId === other?.personId &&
      assignment.startDate === other?.startDate &&
      assignment.endDate === other?.endDate
    );
  });
}

/**
 * Builds lookup maps for O(1) access by room and person ID.
 */
function buildAssignmentMaps(
  assignments: RoomAssignment[],
): {
  byRoom: Map<RoomId, RoomAssignment[]>;
  byPerson: Map<PersonId, RoomAssignment[]>;
} {
  const byRoom = new Map<RoomId, RoomAssignment[]>();
  const byPerson = new Map<PersonId, RoomAssignment[]>();

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
  const { currentTrip } = useTripContext();
  const currentTripId = currentTrip?.id;

  // Error state for CRUD operations
  const [error, setError] = useState<Error | null>(null);

  // Stable array reference to prevent unnecessary re-renders
  // Updated via useEffect to avoid side effects during render
  const assignmentsRef = useRef<RoomAssignment[]>([]);

  // Map for O(1) assignment lookup by ID
  // Used for fast validation in update/delete operations
  const assignmentsMapRef = useRef<Map<RoomAssignmentId, RoomAssignment>>(
    new Map(),
  );

  // Maps for O(1) lookup by room and person
  // Updated via useEffect to stay in sync with assignments array
  const assignmentsByRoomMapRef = useRef<Map<RoomId, RoomAssignment[]>>(
    new Map(),
  );
  const assignmentsByPersonMapRef = useRef<Map<PersonId, RoomAssignment[]>>(
    new Map(),
  );

  // Live query for assignments, scoped to current trip
  // Re-runs automatically when currentTripId changes or assignments are modified
  const assignmentsQuery = useLiveQuery(
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
  );

  // Determine loading state
  // Loading when query hasn't resolved yet AND a trip is selected
  const isLoading = currentTripId !== undefined && assignmentsQuery === undefined;

  // Get raw assignments from query, defaulting to empty array
  const rawAssignments = assignmentsQuery ?? [];

  // Clear refs when trip changes to prevent stale cross-trip data
  useEffect(() => {
    assignmentsRef.current = [];
    assignmentsMapRef.current = new Map();
    assignmentsByRoomMapRef.current = new Map();
    assignmentsByPersonMapRef.current = new Map();
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
    }
  }, [rawAssignments]);

  // Use the stable reference for the context value
  // On first render before useEffect runs, use rawAssignments
  const assignments =
    assignmentsRef.current.length > 0 || rawAssignments.length === 0
      ? assignmentsRef.current
      : rawAssignments;

  /**
   * Validates that an assignment exists and belongs to the current trip.
   * Uses in-memory cache first, falls back to DB for authoritative check.
   */
  const validateAssignmentOwnership = useCallback(
    async (
      assignmentId: RoomAssignmentId,
      tripId: TripId,
    ): Promise<RoomAssignment> => {
      // Fast path: check in-memory cache first
      const cachedAssignment = assignmentsMapRef.current.get(assignmentId);
      if (cachedAssignment) {
        if (cachedAssignment.tripId !== tripId) {
          throw new Error(
            'Cannot modify assignment: assignment does not belong to current trip',
          );
        }
        return cachedAssignment;
      }

      // Fallback: DB query for assignments not yet in cache
      const assignment = await repositoryGetAssignmentById(assignmentId);
      if (!assignment) {
        throw new Error(`Assignment with ID "${assignmentId}" not found`);
      }
      if (assignment.tripId !== tripId) {
        throw new Error(
          'Cannot modify assignment: assignment does not belong to current trip',
        );
      }
      return assignment;
    },
    [],
  );

  /**
   * Creates a new room assignment in the current trip.
   */
  const createAssignment = useCallback(
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
  );

  /**
   * Updates an existing assignment after validating ownership.
   */
  const updateAssignment = useCallback(
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
        // Verify assignment belongs to current trip before updating
        await validateAssignmentOwnership(id, tripId);
        await repositoryUpdateAssignment(id, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to update assignment', setError);
      }
    },
    [currentTripId, validateAssignmentOwnership],
  );

  /**
   * Deletes an assignment after validating ownership.
   */
  const deleteAssignment = useCallback(
    async (id: RoomAssignmentId): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot delete assignment: no trip selected');
      }

      setError((prev) => (prev === null ? prev : null));

      try {
        // Verify assignment belongs to current trip before deleting
        await validateAssignmentOwnership(id, tripId);
        await repositoryDeleteAssignment(id);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to delete assignment', setError);
      }
    },
    [currentTripId, validateAssignmentOwnership],
  );

  /**
   * Synchronously retrieves assignments by room using O(1) Map lookup.
   */
  const getAssignmentsByRoom = useCallback(
    (roomId: RoomId): RoomAssignment[] => {
      return assignmentsByRoomMapRef.current.get(roomId) ?? [];
    },
    [],
  );

  /**
   * Synchronously retrieves assignments by person using O(1) Map lookup.
   */
  const getAssignmentsByPerson = useCallback(
    (personId: PersonId): RoomAssignment[] => {
      return assignmentsByPersonMapRef.current.get(personId) ?? [];
    },
    [],
  );

  /**
   * Checks for conflicting assignments for a person in the given date range.
   */
  const checkConflict = useCallback(
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
  );

  // Memoize context value to prevent unnecessary re-renders in consumers
  const contextValue = useMemo<AssignmentContextValue>(
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
