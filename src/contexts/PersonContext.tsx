/**
 * @fileoverview Person Context for managing persons within the current trip.
 * Provides reactive person data and CRUD operations scoped to the selected trip.
 *
 * @module contexts/PersonContext
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
  createPerson as repositoryCreatePerson,
  deletePersonWithOwnershipCheck,
  updatePersonWithOwnershipCheck,
} from '@/lib/db';
import type { Person, PersonFormData, PersonId } from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Public interface for the Person Context value.
 * Provides access to person data and CRUD operations for the current trip.
 */
export interface PersonContextValue {
  /**
   * Array of persons for the current trip, sorted by name.
   * Empty array if no trip is selected or during loading.
   */
  readonly persons: readonly Person[];

  /**
   * True while person data is being loaded from IndexedDB.
   * Also true during initial load when a trip is selected.
   */
  readonly isLoading: boolean;

  /**
   * Error from the most recent operation, or null if no error.
   * Cleared automatically before each new operation.
   */
  readonly error: Error | null;

  /**
   * Creates a new person in the current trip.
   *
   * @param data - The person form data (name, color)
   * @returns The created Person object
   * @throws {Error} If no trip is currently selected
   */
  createPerson: (data: PersonFormData) => Promise<Person>;

  /**
   * Updates an existing person.
   * Verifies the person belongs to the current trip before updating.
   *
   * @param id - The person ID to update
   * @param data - Partial person form data to update
   * @throws {Error} If no trip is currently selected, person not found, or person doesn't belong to current trip
   */
  updatePerson: (id: PersonId, data: Partial<PersonFormData>) => Promise<void>;

  /**
   * Deletes a person and their associated assignments and transports.
   * Verifies the person belongs to the current trip before deleting.
   *
   * @param id - The person ID to delete
   * @throws {Error} If no trip is currently selected or person doesn't belong to current trip
   */
  deletePerson: (id: PersonId) => Promise<void>;

  /**
   * Synchronously retrieves a person by ID from the current persons array.
   * This is a fast O(1) lookup using an internal Map.
   *
   * @param id - The person ID to look up
   * @returns The person if found in the current array, undefined otherwise
   */
  getPersonById: (id: PersonId) => Person | undefined;
}

/**
 * Props for the PersonProvider component.
 */
interface PersonProviderProps {
  /** Child components to render within the provider */
  readonly children: ReactNode;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Comparison function for Person objects.
 * Compares id, name, and color (tripId is same for all persons in filtered array).
 */
const comparePersons = (a: Person, b: Person): boolean =>
  a.id === b.id && a.name === b.name && a.color === b.color;

/**
 * Compares two person arrays for equality based on IDs and mutable properties.
 * Uses the generic areArraysEqual utility with Person-specific comparison.
 */
const arePersonsEqual = (a: Person[], b: Person[]): boolean =>
  areArraysEqual(a, b, comparePersons);

// ============================================================================
// Context Creation
// ============================================================================

/**
 * React Context for person state management.
 * Initial value is null to enforce provider usage via usePersonContext hook.
 *
 * @internal Use usePersonContext hook instead of consuming this directly
 */
const PersonContext = createContext<PersonContextValue | null>(null);

PersonContext.displayName = 'PersonContext';

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Provides person state management for the current trip.
 *
 * Features:
 * - Reactive data binding via Dexie live queries
 * - Automatic person filtering by current trip
 * - CRUD operations with proper error handling
 * - Persons sorted by name
 * - Person ownership validation for security
 * - O(1) getPersonById lookup via Map
 *
 * @remarks
 * Must be used within a TripProvider. When no trip is selected,
 * persons will be an empty array and CRUD operations will throw errors.
 *
 * @param props - Provider props including children
 * @returns Provider component wrapping children with person context
 *
 * @example
 * ```tsx
 * import { PersonProvider } from '@/contexts/PersonContext';
 *
 * function App() {
 *   return (
 *     <TripProvider>
 *       <PersonProvider>
 *         <PersonList />
 *       </PersonProvider>
 *     </TripProvider>
 *   );
 * }
 * ```
 */
export function PersonProvider({ children }: PersonProviderProps): ReactElement {
  // Get current trip from TripContext - extract ID to avoid object reference issues
  const { currentTrip } = useTripContext(),
   currentTripId = currentTrip?.id,

  // Error state for CRUD operations
   [error, setError] = useState<Error | null>(null),

  // Stable array reference to prevent unnecessary re-renders
  // Updated via useEffect to avoid side effects during render
   personsRef = useRef<Person[]>([]),

  // Map for O(1) person lookup by ID
  // Updated via useEffect to stay in sync with persons array
   personsMapRef = useRef<Map<PersonId, Person>>(new Map()),

  // Live query for persons, scoped to current trip
  // Re-runs automatically when currentTripId changes or persons are modified
   personsQuery = useLiveQuery(
    async () => {
      if (!currentTripId) {
        return [];
      }

      try {
        // Use compound index [tripId+name] for efficient sorted query
        return await db.persons
          .where('[tripId+name]')
          .between([currentTripId, ''], [currentTripId, '\uffff'])
          .toArray();
      } catch (err) {
        // Surface query errors to the error state
        const queryError =
          err instanceof Error ? err : new Error('Failed to load persons');
        setError(queryError);
        return [];
      }
    },
    [currentTripId],
  ),

  // Determine loading state
  // Loading when query hasn't resolved yet AND a trip is selected
   isLoading = currentTripId !== undefined && personsQuery === undefined,

  // Get raw persons from query, defaulting to empty array
  // Wrapped in useMemo to prevent dependency changes on every render
   rawPersons = useMemo(() => personsQuery ?? [], [personsQuery]),

  // State to hold stable persons (replacing ref for render-safe access)
   [persons, setPersons] = useState<Person[]>([]);

  // Clear state and error when trip changes to prevent stale cross-trip data
  useEffect(() => {
    setPersons([]);
    personsRef.current = [];
    personsMapRef.current = new Map();
    setError(null); // CR-8: Clear error state on trip change
  }, [currentTripId]);

  // Update stable array reference via useEffect (not during render)
  // This prevents mutable state updates during render phase
  useEffect(() => {
    if (!arePersonsEqual(rawPersons, personsRef.current)) {
      personsRef.current = rawPersons;
      // Rebuild the Map for O(1) lookups
      personsMapRef.current = new Map(rawPersons.map((p) => [p.id, p]));
      // Update state for render-safe access
      setPersons(rawPersons);
    }
  }, [rawPersons]);

  // Use persons from state (render-safe)
  const

  /**
   * Creates a new person in the current trip.
   */
   createPerson = useCallback(
    async (data: PersonFormData): Promise<Person> => {
      // Capture tripId at invocation time to avoid stale closure
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot create person: no trip selected');
      }

      // Clear error using functional update (avoids dependency on error state)
      setError((prev) => (prev === null ? prev : null));

      try {
        return await repositoryCreatePerson(tripId, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to create person', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Updates an existing person with ownership validation.
   * Uses transactional operation to prevent TOCTOU race condition (CR-2).
   */
   updatePerson = useCallback(
    async (id: PersonId, data: Partial<PersonFormData>): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot update person: no trip selected');
      }

      // Clear error using functional update (avoids dependency on error state)
      setError((prev) => (prev === null ? prev : null));

      try {
        // CR-2: Use transactional function that combines validation + mutation atomically
        await updatePersonWithOwnershipCheck(id, tripId, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to update person', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Deletes a person with ownership validation.
   * Uses transactional operation to prevent TOCTOU race condition (CR-2).
   */
   deletePerson = useCallback(
    async (id: PersonId): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot delete person: no trip selected');
      }

      // Clear error using functional update (avoids dependency on error state)
      setError((prev) => (prev === null ? prev : null));

      try {
        // CR-2: Use transactional function that combines validation + deletion atomically
        await deletePersonWithOwnershipCheck(id, tripId);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to delete person', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Synchronously retrieves a person by ID using O(1) Map lookup.
   * Uses a ref-based Map to maintain a stable function reference.
   */
   getPersonById = useCallback((id: PersonId): Person | undefined => personsMapRef.current.get(id), []),

  // Memoize context value to prevent unnecessary re-renders in consumers
   contextValue = useMemo<PersonContextValue>(
    () => ({
      persons,
      isLoading,
      error,
      createPerson,
      updatePerson,
      deletePerson,
      getPersonById,
    }),
    [
      persons,
      isLoading,
      error,
      createPerson,
      updatePerson,
      deletePerson,
      getPersonById,
    ],
  );

  return (
    <PersonContext.Provider value={contextValue}>
      {children}
    </PersonContext.Provider>
  );
}

// ============================================================================
// Custom Hook
// ============================================================================

/**
 * Hook to access the Person Context.
 *
 * Must be used within both TripProvider and PersonProvider components.
 * Throws an error if used outside the provider to catch misuse early.
 *
 * @returns The person context value with person data and CRUD operations
 * @throws {Error} If called outside of PersonProvider
 *
 * @example
 * ```tsx
 * import { usePersonContext } from '@/contexts/PersonContext';
 *
 * function PersonList() {
 *   const { persons, isLoading, createPerson, getPersonById } = usePersonContext();
 *
 *   if (isLoading) {
 *     return <Spinner />;
 *   }
 *
 *   return (
 *     <ul>
 *       {persons.map((person) => (
 *         <li key={person.id} style={{ color: person.color }}>
 *           {person.name}
 *         </li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function usePersonContext(): PersonContextValue {
  const context = useContext(PersonContext);

  if (context === null) {
    throw new Error(
      'usePersonContext must be used within a PersonProvider. ' +
        'Wrap your component tree with <PersonProvider>.',
    );
  }

  return context;
}

// ============================================================================
// Exports
// ============================================================================

export { PersonContext };
export type { PersonProviderProps };
