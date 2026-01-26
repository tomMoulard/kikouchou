/**
 * @fileoverview Transport Context for managing transports (arrivals/departures) within the current trip.
 * Provides reactive transport data and CRUD operations scoped to the selected trip.
 *
 * @module contexts/TransportContext
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
import { db } from '@/lib/db/database';
import {
  createTransport as repositoryCreateTransport,
  deleteTransport as repositoryDeleteTransport,
  getTransportById as repositoryGetTransportById,
  updateTransport as repositoryUpdateTransport,
} from '@/lib/db';
import type {
  PersonId,
  Transport,
  TransportFormData,
  TransportId,
  TripId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Public interface for the Transport Context value.
 * Provides access to transport data and CRUD operations for the current trip.
 */
export interface TransportContextValue {
  /**
   * Array of all transports for the current trip, sorted by datetime.
   * Empty array if no trip is selected or during loading.
   */
  readonly transports: readonly Transport[];

  /**
   * Array of arrival transports for the current trip, sorted by datetime.
   * Filtered from transports where type === 'arrival'.
   */
  readonly arrivals: readonly Transport[];

  /**
   * Array of departure transports for the current trip, sorted by datetime.
   * Filtered from transports where type === 'departure'.
   */
  readonly departures: readonly Transport[];

  /**
   * Array of upcoming transports that need pickup, sorted by datetime.
   * Filtered from transports where needsPickup === true AND datetime >= now.
   */
  readonly upcomingPickups: readonly Transport[];

  /**
   * True while transport data is being loaded from IndexedDB.
   * Also true during initial load when a trip is selected.
   */
  readonly isLoading: boolean;

  /**
   * Error from the most recent operation, or null if no error.
   * Cleared automatically before each new operation.
   */
  readonly error: Error | null;

  /**
   * Creates a new transport in the current trip.
   *
   * @param data - The transport form data
   * @returns The created Transport object
   * @throws {Error} If no trip is currently selected or creation fails
   */
  createTransport: (data: TransportFormData) => Promise<Transport>;

  /**
   * Updates an existing transport.
   * Verifies the transport belongs to the current trip before updating.
   *
   * @param id - The transport ID to update
   * @param data - Partial transport form data to update
   * @throws {Error} If no trip selected, transport not found, or doesn't belong to current trip
   */
  updateTransport: (
    id: TransportId,
    data: Partial<TransportFormData>,
  ) => Promise<void>;

  /**
   * Deletes a transport.
   * Verifies the transport belongs to the current trip before deleting.
   *
   * @param id - The transport ID to delete
   * @throws {Error} If no trip selected or transport doesn't belong to current trip
   */
  deleteTransport: (id: TransportId) => Promise<void>;

  /**
   * Synchronously retrieves all transports for a specific person.
   * This is a fast O(1) lookup using an internal Map.
   *
   * @param personId - The person ID to filter by
   * @returns Array of transports for the person, empty array if none found
   */
  getTransportsByPerson: (personId: PersonId) => Transport[];
}

/**
 * Props for the TransportProvider component.
 */
interface TransportProviderProps {
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
 * Compares two transport arrays for equality based on IDs and all mutable properties.
 * Used to maintain stable array references.
 *
 * @remarks
 * Compares all properties that could change via update operations to ensure
 * refs are updated when any transport property is modified.
 */
function areTransportsEqual(a: Transport[], b: Transport[]): boolean {
  // Fast path: same reference means no change
  if (a === b) {return true;}
  if (a.length !== b.length) {return false;}
  return a.every((transport, index) => {
    const other = b[index];
    if (!other) {return false;}
    return (
      transport.id === other.id &&
      transport.tripId === other.tripId &&
      transport.type === other.type &&
      transport.datetime === other.datetime &&
      transport.personId === other.personId &&
      transport.needsPickup === other.needsPickup &&
      transport.driverId === other.driverId &&
      transport.location === other.location &&
      transport.transportMode === other.transportMode &&
      transport.transportNumber === other.transportNumber &&
      transport.notes === other.notes
    );
  });
}

/**
 * Builds lookup map for O(1) access by person ID.
 */
function buildTransportsByPersonMap(
  transports: Transport[],
): Map<PersonId, Transport[]> {
  const byPerson = new Map<PersonId, Transport[]>();

  for (const transport of transports) {
    const personTransports = byPerson.get(transport.personId);
    if (personTransports) {
      personTransports.push(transport);
    } else {
      byPerson.set(transport.personId, [transport]);
    }
  }

  return byPerson;
}

// ============================================================================
// Context Creation
// ============================================================================

/**
 * React Context for transport state management.
 * Initial value is null to enforce provider usage via useTransportContext hook.
 *
 * @internal Use useTransportContext hook instead of consuming this directly
 */
const TransportContext = createContext<TransportContextValue | null>(null);

TransportContext.displayName = 'TransportContext';

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Provides transport state management for the current trip.
 *
 * Features:
 * - Reactive data binding via Dexie live queries
 * - Automatic transport filtering by current trip
 * - CRUD operations with proper error handling
 * - Transports sorted by datetime
 * - Transport ownership validation for security
 * - O(1) lookup by person via Map
 * - Computed filtered arrays: arrivals, departures, upcomingPickups
 *
 * @remarks
 * Must be used within a TripProvider. When no trip is selected,
 * transports will be an empty array and CRUD operations will throw errors.
 *
 * @param props - Provider props including children
 * @returns Provider component wrapping children with transport context
 *
 * @example
 * ```tsx
 * import { TransportProvider } from '@/contexts/TransportContext';
 *
 * function App() {
 *   return (
 *     <TripProvider>
 *       <TransportProvider>
 *         <TransportList />
 *       </TransportProvider>
 *     </TripProvider>
 *   );
 * }
 * ```
 */
export function TransportProvider({
  children,
}: TransportProviderProps): ReactElement {
  // Get current trip from TripContext - extract ID to avoid object reference issues
  const { currentTrip } = useTripContext(),
   currentTripId = currentTrip?.id,

  // Error state for CRUD operations
   [error, setError] = useState<Error | null>(null),

  // Stable array reference to prevent unnecessary re-renders
  // Updated via useEffect to avoid side effects during render
   transportsRef = useRef<Transport[]>([]),

  // Map for O(1) transport lookup by ID
  // Used for fast validation in update/delete operations
   transportsMapRef = useRef<Map<TransportId, Transport>>(new Map()),

  // Map for O(1) lookup by person
  // Updated via useEffect to stay in sync with transports array
   transportsByPersonMapRef = useRef<Map<PersonId, Transport[]>>(
    new Map(),
  ),

  // Live query for transports, scoped to current trip
  // Re-runs automatically when currentTripId changes or transports are modified
   transportsQuery = useLiveQuery(
    async () => {
      if (!currentTripId) {
        return [];
      }

      try {
        // Use compound index [tripId+datetime] for efficient sorted query
        return await db.transports
          .where('[tripId+datetime]')
          .between([currentTripId, ''], [currentTripId, '\uffff'])
          .toArray();
      } catch (err) {
        // Surface query errors to the error state
        const queryError =
          err instanceof Error ? err : new Error('Failed to load transports');
        setError(queryError);
        return [];
      }
    },
    [currentTripId],
  ),

  // Determine loading state
  // Loading when query hasn't resolved yet AND a trip is selected
   isLoading = currentTripId !== undefined && transportsQuery === undefined,

  // Get raw transports from query, defaulting to empty array
  // Wrapped in useMemo to prevent dependency changes on every render
   rawTransports = useMemo(() => transportsQuery ?? [], [transportsQuery]),

  // State to hold stable transports (replacing ref for render-safe access)
   [transports, setTransports] = useState<Transport[]>([]);

  // Clear refs, state, and error when trip changes to prevent stale cross-trip data
  useEffect(() => {
    setTransports([]);
    transportsRef.current = [];
    transportsMapRef.current = new Map();
    transportsByPersonMapRef.current = new Map();
    setError(null); // Clear any error from previous trip
  }, [currentTripId]);

  // Update stable array reference and Maps via useEffect (not during render)
  // This prevents mutable state updates during render phase
  useEffect(() => {
    if (!areTransportsEqual(rawTransports, transportsRef.current)) {
      transportsRef.current = rawTransports;
      // Rebuild the Maps for O(1) lookups
      transportsByPersonMapRef.current = buildTransportsByPersonMap(rawTransports);
      // Build ID map for O(1) validation lookups
      transportsMapRef.current = new Map(rawTransports.map((t) => [t.id, t]));
      // Update state for render-safe access
      setTransports(rawTransports);
    }
  }, [rawTransports]);

  // Use transports from state (render-safe)
  const

  // Compute arrivals - transports where type === 'arrival'
   arrivals = useMemo(
    () => transports.filter((t) => t.type === 'arrival'),
    [transports],
  ),

  // Compute departures - transports where type === 'departure'
   departures = useMemo(
    () => transports.filter((t) => t.type === 'departure'),
    [transports],
  ),

  // Compute upcoming pickups - transports that need pickup and are in the future
  // Note: ISO string comparison works correctly for datetime ordering
   upcomingPickups = useMemo(() => {
    const now = new Date().toISOString();
    return transports
      .filter((t) => t.needsPickup && t.datetime >= now)
      .sort((a, b) => a.datetime.localeCompare(b.datetime));
  }, [transports]),

  /**
   * Validates that a transport exists and belongs to the current trip.
   * Uses in-memory cache first, falls back to DB for authoritative check.
   */
   validateTransportOwnership = useCallback(
    async (
      transportId: TransportId,
      tripId: TripId,
    ): Promise<Transport> => {
      // Fast path: check in-memory cache first
      const cachedTransport = transportsMapRef.current.get(transportId);
      if (cachedTransport) {
        if (cachedTransport.tripId !== tripId) {
          throw new Error(
            'Cannot modify transport: transport does not belong to current trip',
          );
        }
        return cachedTransport;
      }

      // Fallback: DB query for transports not yet in cache
      const transport = await repositoryGetTransportById(transportId);
      if (!transport) {
        throw new Error(`Transport with ID "${transportId}" not found`);
      }
      if (transport.tripId !== tripId) {
        throw new Error(
          'Cannot modify transport: transport does not belong to current trip',
        );
      }
      return transport;
    },
    [],
  ),

  /**
   * Creates a new transport in the current trip.
   */
   createTransport = useCallback(
    async (data: TransportFormData): Promise<Transport> => {
      // Capture tripId at invocation time to avoid stale closure
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot create transport: no trip selected');
      }

      // Clear error using functional update (avoids error in deps)
      setError((prev) => (prev === null ? prev : null));

      try {
        return await repositoryCreateTransport(tripId, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to create transport', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Updates an existing transport after validating ownership.
   */
   updateTransport = useCallback(
    async (
      id: TransportId,
      data: Partial<TransportFormData>,
    ): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot update transport: no trip selected');
      }

      setError((prev) => (prev === null ? prev : null));

      try {
        // Verify transport belongs to current trip before updating
        await validateTransportOwnership(id, tripId);
        await repositoryUpdateTransport(id, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to update transport', setError);
      }
    },
    [currentTripId, validateTransportOwnership],
  ),

  /**
   * Deletes a transport after validating ownership.
   */
   deleteTransport = useCallback(
    async (id: TransportId): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot delete transport: no trip selected');
      }

      setError((prev) => (prev === null ? prev : null));

      try {
        // Verify transport belongs to current trip before deleting
        await validateTransportOwnership(id, tripId);
        await repositoryDeleteTransport(id);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to delete transport', setError);
      }
    },
    [currentTripId, validateTransportOwnership],
  ),

  /**
   * Synchronously retrieves transports by person using O(1) Map lookup.
   */
   getTransportsByPerson = useCallback(
    (personId: PersonId): Transport[] => transportsByPersonMapRef.current.get(personId) ?? [],
    [],
  ),

  // Memoize context value to prevent unnecessary re-renders in consumers
   contextValue = useMemo<TransportContextValue>(
    () => ({
      transports,
      arrivals,
      departures,
      upcomingPickups,
      isLoading,
      error,
      createTransport,
      updateTransport,
      deleteTransport,
      getTransportsByPerson,
    }),
    [
      transports,
      arrivals,
      departures,
      upcomingPickups,
      isLoading,
      error,
      createTransport,
      updateTransport,
      deleteTransport,
      getTransportsByPerson,
    ],
  );

  return (
    <TransportContext.Provider value={contextValue}>
      {children}
    </TransportContext.Provider>
  );
}

// ============================================================================
// Custom Hook
// ============================================================================

/**
 * Hook to access the Transport Context.
 *
 * Must be used within both TripProvider and TransportProvider components.
 * Throws an error if used outside the provider to catch misuse early.
 *
 * @returns The transport context value with transport data and CRUD operations
 * @throws {Error} If called outside of TransportProvider
 *
 * @example
 * ```tsx
 * import { useTransportContext } from '@/contexts/TransportContext';
 *
 * function TransportList() {
 *   const {
 *     arrivals,
 *     departures,
 *     upcomingPickups,
 *     isLoading,
 *   } = useTransportContext();
 *
 *   if (isLoading) {
 *     return <Spinner />;
 *   }
 *
 *   return (
 *     <div>
 *       <h2>Arrivals</h2>
 *       {arrivals.map((transport) => (
 *         <TransportCard key={transport.id} transport={transport} />
 *       ))}
 *       <h2>Departures</h2>
 *       {departures.map((transport) => (
 *         <TransportCard key={transport.id} transport={transport} />
 *       ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTransportContext(): TransportContextValue {
  const context = useContext(TransportContext);

  if (context === null) {
    throw new Error(
      'useTransportContext must be used within a TransportProvider. ' +
        'Wrap your component tree with <TransportProvider>.',
    );
  }

  return context;
}

// ============================================================================
// Exports
// ============================================================================

export { TransportContext };
export type { TransportProviderProps };
