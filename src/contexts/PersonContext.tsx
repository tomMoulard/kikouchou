/**
 * @fileoverview Person Context for managing persons within the current trip.
 * Provides reactive person data and CRUD operations scoped to the selected trip.
 *
 * @module contexts/PersonContext
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
  createPerson as repositoryCreatePerson,
  getPersonById as repositoryGetPersonById,
  updatePerson as repositoryUpdatePerson,
  deletePerson as repositoryDeletePerson,
} from '@/lib/db';
import type { Person, PersonFormData, PersonId, TripId } from '@/types';

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
 * Compares two person arrays for equality based on IDs and properties.
 * Used to maintain stable array references.
 *
 * @remarks
 * Only compares id, name, and color since tripId is the same for all
 * persons in the array (filtered by current trip).
 */
function arePersonsEqual(a: Person[], b: Person[]): boolean {
  // Fast path: same reference means no change
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((person, index) => {
    const other = b[index];
    return (
      person.id === other?.id &&
      person.name === other?.name &&
      person.color === other?.color
    );
  });
}

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
  const { currentTrip } = useTripContext();
  const currentTripId = currentTrip?.id;

  // Error state for CRUD operations
  const [error, setError] = useState<Error | null>(null);

  // Stable array reference to prevent unnecessary re-renders
  // Updated via useEffect to avoid side effects during render
  const personsRef = useRef<Person[]>([]);

  // Map for O(1) person lookup by ID
  // Updated via useEffect to stay in sync with persons array
  const personsMapRef = useRef<Map<PersonId, Person>>(new Map());

  // Live query for persons, scoped to current trip
  // Re-runs automatically when currentTripId changes or persons are modified
  const personsQuery = useLiveQuery(
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
  );

  // Determine loading state
  // Loading when query hasn't resolved yet AND a trip is selected
  const isLoading = currentTripId !== undefined && personsQuery === undefined;

  // Get raw persons from query, defaulting to empty array
  const rawPersons = personsQuery ?? [];

  // Update stable array reference via useEffect (not during render)
  // This prevents mutable state updates during render phase
  useEffect(() => {
    if (!arePersonsEqual(rawPersons, personsRef.current)) {
      personsRef.current = rawPersons;
      // Rebuild the Map for O(1) lookups
      personsMapRef.current = new Map(rawPersons.map((p) => [p.id, p]));
    }
  }, [rawPersons]);

  // Use the stable reference for the context value
  // On first render before useEffect runs, use rawPersons
  const persons =
    personsRef.current.length > 0 || rawPersons.length === 0
      ? personsRef.current
      : rawPersons;

  /**
   * Validates that a person exists and belongs to the current trip.
   * Uses in-memory lookup first, falls back to DB for authoritative check.
   */
  const validatePersonOwnership = useCallback(
    async (personId: PersonId, tripId: TripId): Promise<Person> => {
      // Fast path: check in-memory cache first
      const cachedPerson = personsMapRef.current.get(personId);
      if (cachedPerson) {
        if (cachedPerson.tripId !== tripId) {
          throw new Error(
            'Cannot modify person: person does not belong to current trip',
          );
        }
        return cachedPerson;
      }

      // Fallback: DB query for persons not yet in cache
      const person = await repositoryGetPersonById(personId);
      if (!person) {
        throw new Error(`Person with ID "${personId}" not found`);
      }
      if (person.tripId !== tripId) {
        throw new Error(
          'Cannot modify person: person does not belong to current trip',
        );
      }
      return person;
    },
    [],
  );

  /**
   * Creates a new person in the current trip.
   */
  const createPerson = useCallback(
    async (data: PersonFormData): Promise<Person> => {
      // Capture tripId at invocation time to avoid stale closure
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot create person: no trip selected');
      }

      // Clear error only if there was one (avoid unnecessary renders)
      if (error !== null) {
        setError(null);
      }

      try {
        return await repositoryCreatePerson(tripId, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to create person', setError);
      }
    },
    [currentTripId, error],
  );

  /**
   * Updates an existing person after validating ownership.
   */
  const updatePerson = useCallback(
    async (id: PersonId, data: Partial<PersonFormData>): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot update person: no trip selected');
      }

      if (error !== null) {
        setError(null);
      }

      try {
        // Verify person belongs to current trip before updating
        await validatePersonOwnership(id, tripId);
        await repositoryUpdatePerson(id, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to update person', setError);
      }
    },
    [currentTripId, error, validatePersonOwnership],
  );

  /**
   * Deletes a person after validating ownership.
   */
  const deletePerson = useCallback(
    async (id: PersonId): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot delete person: no trip selected');
      }

      if (error !== null) {
        setError(null);
      }

      try {
        // Verify person belongs to current trip before deleting
        await validatePersonOwnership(id, tripId);
        await repositoryDeletePerson(id);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to delete person', setError);
      }
    },
    [currentTripId, error, validatePersonOwnership],
  );

  /**
   * Synchronously retrieves a person by ID using O(1) Map lookup.
   * Uses a ref-based Map to maintain a stable function reference.
   */
  const getPersonById = useCallback((id: PersonId): Person | undefined => {
    return personsMapRef.current.get(id);
  }, []);

  // Memoize context value to prevent unnecessary re-renders in consumers
  const contextValue = useMemo<PersonContextValue>(
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
