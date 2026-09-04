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

import {
  isTransportUpcoming,
  sortTransportsByInstant,
} from '@/features/transports/utils/pickup-utils';
import { useTripContext } from '@/contexts/TripContext';
import {
  areArraysEqual,
  areCoordinatesEqual,
  wrapAndSetError,
} from '@/contexts/utils';
import { db } from '@/lib/db/database';
import {
  createTransport as repositoryCreateTransport,
  deleteTransportWithOwnershipCheck,
  updateTransportWithOwnershipCheck,
} from '@/lib/db';
import type {
  PersonId,
  Transport,
  TransportFormData,
  TransportId,
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
   * Array of upcoming transports that need pickup, sorted chronologically.
   * Filtered from transports where needsPickup === true AND the transport's
   * instant is at or after {@link nowMs}.
   *
   * This is the base set for "how many pickups still need a driver" — narrow it
   * with `selectPickupsNeedingDriver` from
   * `@/features/transports/utils/pickup-utils` rather than re-filtering by hand,
   * so every view reports the same number.
   */
  readonly upcomingPickups: readonly Transport[];

  /**
   * The single reference instant (epoch milliseconds) every transport view uses
   * to decide past versus upcoming.
   *
   * Refreshed once a minute so the UI ages without a reload: a pickup that has
   * just happened drops out of {@link upcomingPickups} on its own, and the list
   * page moves it into its past section at the same tick. Deriving a separate
   * `new Date()` per view is what let those two views disagree.
   */
  readonly nowMs: number;

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
 * Comparison function for Transport objects.
 * Compares all mutable properties to ensure refs are updated when any transport property is modified.
 */
const compareTransports = (a: Transport, b: Transport): boolean =>
  a.id === b.id &&
  a.tripId === b.tripId &&
  a.type === b.type &&
  a.datetime === b.datetime &&
  a.personId === b.personId &&
  a.needsPickup === b.needsPickup &&
  a.driverId === b.driverId &&
  a.location === b.location &&
  a.transportMode === b.transportMode &&
  a.transportNumber === b.transportNumber &&
  a.notes === b.notes &&
  // The three map fields, listed because the comparator must cover every
  // mutable field. Without them, moving a pin or naming a starting point left
  // `transports` holding the old place: the map kept drawing the old marker and
  // the old route until some unrelated field happened to change too.
  a.startLocation === b.startLocation &&
  areCoordinatesEqual(a.coordinates, b.coordinates) &&
  areCoordinatesEqual(a.startCoordinates, b.startCoordinates);

/**
 * Compares two transport arrays for equality based on IDs and all mutable properties.
 * Uses the generic areArraysEqual utility with Transport-specific comparison.
 */
const areTransportsEqual = (a: Transport[], b: Transport[]): boolean =>
  areArraysEqual(a, b, compareTransports);

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
   [transports, setTransports] = useState<Transport[]>([]),

  // CR-3: The one reference instant for past-vs-upcoming, refreshed every minute
  // so the pickup alerts and the transport list age without a reload. Held as
  // epoch milliseconds rather than an ISO string: comparing ISO strings only
  // works while every stored datetime shares one exact formatting, and nothing
  // guarantees that for rows arriving over Yjs.
   [nowMs, setNowMs] = useState<number>(() => Date.now());

  // CR-3: Refresh the reference instant every minute to keep upcomingPickups
  // accurate, and again whenever the app comes back to the foreground: a
  // backgrounded PWA has its timers throttled or frozen, so without this a user
  // returning after lunch would see pickups that are hours past still listed as
  // upcoming until the next tick landed.
  useEffect(() => {
    const REFRESH_INTERVAL_MS = 60_000; // 1 minute
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, REFRESH_INTERVAL_MS);

    const handleResume = (): void => {
      if (document.visibilityState === 'visible') {
        setNowMs(Date.now());
      }
    };

    document.addEventListener('visibilitychange', handleResume);
    window.addEventListener('focus', handleResume);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleResume);
      window.removeEventListener('focus', handleResume);
    };
  }, []);

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
  // CR-9: Single-pass classification instead of triple filter (3x O(n) → 1x O(n))
  const { arrivals, departures, upcomingPickups } = useMemo(() => {
    const arrivalsArr: Transport[] = [];
    const departuresArr: Transport[] = [];
    const upcomingPickupsArr: Transport[] = [];

    for (const transport of transports) {
      // Classify by type
      if (transport.type === 'arrival') {
        arrivalsArr.push(transport);
      } else {
        departuresArr.push(transport);
      }

      // Check for upcoming pickups against the single reference instant (CR-3)
      if (transport.needsPickup && isTransportUpcoming(transport.datetime, nowMs)) {
        upcomingPickupsArr.push(transport);
      }
    }

    // The [tripId+datetime] index orders rows by string, which mis-orders values
    // written with different UTC offsets — sort by instant instead.
    return {
      arrivals: arrivalsArr,
      departures: departuresArr,
      upcomingPickups: sortTransportsByInstant(upcomingPickupsArr),
    };
  }, [transports, nowMs]),

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
   * Uses transactional ownership check to prevent TOCTOU race conditions.
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
        // Transactional ownership check + update (prevents TOCTOU race)
        await updateTransportWithOwnershipCheck(id, tripId, data);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to update transport', setError);
      }
    },
    [currentTripId],
  ),

  /**
   * Deletes a transport after validating ownership.
   * Uses transactional ownership check to prevent TOCTOU race conditions.
   */
   deleteTransport = useCallback(
    async (id: TransportId): Promise<void> => {
      const tripId = currentTripId;
      if (!tripId) {
        throw new Error('Cannot delete transport: no trip selected');
      }

      setError((prev) => (prev === null ? prev : null));

      try {
        // Transactional ownership check + delete (prevents TOCTOU race)
        await deleteTransportWithOwnershipCheck(id, tripId);
      } catch (err) {
        throw wrapAndSetError(err, 'Failed to delete transport', setError);
      }
    },
    [currentTripId],
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
      nowMs,
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
      nowMs,
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
