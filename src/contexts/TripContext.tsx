/**
 * @fileoverview Trip Context for managing current trip state across the application.
 * Provides reactive data binding using Dexie live queries with persistent selection.
 *
 * @module contexts/TripContext
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

import { db } from '@/lib/db/database';
import {
  getSettings,
  getTripById,
  setCurrentTrip as repositorySetCurrentTrip,
} from '@/lib/db';
import type { Trip, TripId } from '@/types';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Compares two trips for deep equality on all mutable fields.
 * Used to prevent unnecessary re-renders when the trips array changes
 * but the current trip's data hasn't actually changed.
 *
 * @param a - First trip (can be null)
 * @param b - Second trip (can be null)
 * @returns True if trips are deeply equal or both null
 */
function areTripsEqual(a: Trip | null, b: Trip | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.location === b.location &&
    a.startDate === b.startDate &&
    a.endDate === b.endDate &&
    a.shareId === b.shareId &&
    a.description === b.description &&
    a.createdAt === b.createdAt &&
    a.updatedAt === b.updatedAt &&
    // Compare coordinates if present
    a.coordinates?.lat === b.coordinates?.lat &&
    a.coordinates?.lon === b.coordinates?.lon
  );
}

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Result of the combined trip query.
 * Loads both trips and current trip ID in a single atomic operation.
 */
interface TripQueryResult {
  readonly trips: Trip[];
  readonly currentTripId: TripId | undefined;
}

/**
 * Public interface for the Trip Context value.
 * Provides access to trip data and actions for managing trip selection.
 */
export interface TripContextValue {
  /**
   * The currently selected trip, or null if no trip is selected.
   * Updated reactively when the trip data changes in IndexedDB.
   */
  readonly currentTrip: Trip | null;

  /**
   * Array of all trips, sorted by start date descending.
   * Updated reactively when trips are added, modified, or deleted.
   */
  readonly trips: Trip[];

  /**
   * True while trip data is being loaded from IndexedDB.
   * Initially true, becomes false once data is available.
   */
  readonly isLoading: boolean;

  /**
   * Error from the most recent operation or query, or null if no error.
   * Cleared automatically before each new operation.
   */
  readonly error: Error | null;

  /**
   * Sets the current trip by ID.
   * Persists the selection to settings for restoration on page refresh.
   * Empty string is treated as null (no selection).
   *
   * @param tripId - The trip ID to select, null or empty string to clear selection
   * @throws {Error} If the trip ID does not exist
   */
  setCurrentTrip: (tripId: string | null) => Promise<void>;

  /**
   * Verifies database connectivity and clears any error state.
   * Since data is reactive via live queries, this is mainly for error recovery.
   */
  checkConnection: () => Promise<void>;
}

/**
 * Props for the TripProvider component.
 */
interface TripProviderProps {
  /** Child components to render within the provider */
  readonly children: ReactNode;
}

// ============================================================================
// Context Creation
// ============================================================================

/**
 * React Context for trip state management.
 * Initial value is null to enforce provider usage via useTripContext hook.
 *
 * @internal Use useTripContext hook instead of consuming this directly
 */
const TripContext = createContext<TripContextValue | null>(null);

TripContext.displayName = 'TripContext';

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Provides trip state management throughout the application.
 *
 * Features:
 * - Reactive data binding via Dexie live queries
 * - Persistent current trip selection across page refreshes
 * - Loading and error state management
 * - Automatic cleanup of stale trip references
 *
 * @param props - Provider props including children
 * @returns Provider component wrapping children with trip context
 *
 * @example
 * ```tsx
 * import { TripProvider } from '@/contexts/TripContext';
 *
 * function App() {
 *   return (
 *     <TripProvider>
 *       <Router />
 *     </TripProvider>
 *   );
 * }
 * ```
 */
export function TripProvider({ children }: TripProviderProps): ReactElement {
  // Error state for async operations and query failures
  const [error, setError] = useState<Error | null>(null),

  // Combined live query for trips and current trip ID
  // Single atomic load prevents timing issues between separate queries
   queryResult = useLiveQuery(async (): Promise<TripQueryResult> => {
    try {
      const [trips, settings] = await Promise.all([
        db.trips.orderBy('startDate').reverse().toArray(),
        getSettings(),
      ]);
      return { trips, currentTripId: settings.currentTripId };
    } catch (err) {
      // Surface query errors to the error state
      const queryError =
        err instanceof Error ? err : new Error('Failed to load trips');
      setError(queryError);
      // Return empty result to prevent crash
      return { trips: [], currentTripId: undefined };
    }
  }, []),

  // Determine loading state: true if query hasn't resolved yet
   isLoading = queryResult === undefined,

  // Extract trips from query result
  // Wrapped in useMemo to prevent dependency changes on every render
   trips = useMemo(() => queryResult?.trips ?? [], [queryResult?.trips]),

  // Extract current trip ID from query result
   currentTripId = queryResult?.currentTripId,

  // Ref to preserve referential equality of currentTrip
  // This prevents unnecessary re-renders in consumers when other trips change
   currentTripRef = useRef<Trip | null>(null),

  // Derive current trip from trips array and current trip ID
  // Uses referential equality check to prevent re-renders when trip data hasn't changed
   currentTrip = useMemo((): Trip | null => {
    if (isLoading || currentTripId === undefined || currentTripId === null) {
      // If we should have no current trip, return null (or preserve null ref)
      if (currentTripRef.current !== null) {
        currentTripRef.current = null;
      }
      return null;
    }

    const found = trips.find((t) => t.id === currentTripId) ?? null;

    // Preserve referential equality if the trip data hasn't actually changed
    // This prevents consumers from re-rendering when unrelated trips are updated
    if (areTripsEqual(currentTripRef.current, found)) {
      return currentTripRef.current;
    }

    // Trip data has changed, update the ref and return the new trip
    currentTripRef.current = found;
    return found;
  }, [trips, currentTripId, isLoading]);

  // Auto-cleanup stale trip references when persisted ID points to deleted trip
  useEffect(() => {
    if (
      !isLoading &&
      currentTripId !== undefined &&
      currentTripId !== null &&
      currentTrip === null
    ) {
      // Persisted trip ID references a deleted trip - clean it up silently
      repositorySetCurrentTrip(undefined).catch((err) => {
        // Log but don't crash - this is a background cleanup
        console.error('Failed to clean up stale trip reference:', err);
      });
    }
  }, [isLoading, currentTripId, currentTrip]);

  /**
   * Sets the current trip by ID with validation and persistence.
   * Uses a transaction to ensure atomicity between validation and persistence.
   */
  const setCurrentTrip = useCallback(
    async (tripId: string | null): Promise<void> => {
      // Normalize empty string to null (common from form inputs)
      const normalizedTripId = tripId === '' ? null : tripId;

      setError(null);

      try {
        // Use a transaction to ensure atomicity between validation and persistence
        await db.transaction('rw', [db.trips, db.settings], async () => {
          if (normalizedTripId !== null) {
            // Validate trip exists before persisting
            const trip = await getTripById(normalizedTripId as TripId);
            if (!trip) {
              throw new Error(`Trip with ID "${normalizedTripId}" not found`);
            }
          }

          // Persist to settings (converts null to undefined for repository)
          await repositorySetCurrentTrip(
            normalizedTripId === null
              ? undefined
              : (normalizedTripId as TripId),
          );
        });
      } catch (err) {
        const wrappedError =
          err instanceof Error ? err : new Error('Failed to set current trip');
        setError(wrappedError);
        throw wrappedError;
      }
    },
    [setError],
  );

  /**
   * Verifies database connectivity and clears error state.
   * Useful for error recovery when IndexedDB access has failed.
   */
  const checkConnection = useCallback(async (): Promise<void> => {
    setError(null);

    try {
      // Ensure database is open
      if (!db.isOpen()) {
        await db.open();
      }

      // Verify database access with a simple read
      await db.trips.count();
    } catch (err) {
      const wrappedError =
        err instanceof Error
          ? err
          : new Error('Failed to connect to database');
      setError(wrappedError);
      throw wrappedError;
    }
  }, [setError]);

  // Memoize context value to prevent unnecessary re-renders in consumers
  const contextValue = useMemo<TripContextValue>(
    () => ({
      currentTrip,
      trips,
      isLoading,
      error,
      setCurrentTrip,
      checkConnection,
    }),
    [currentTrip, trips, isLoading, error, setCurrentTrip, checkConnection],
  );

  return (
    <TripContext.Provider value={contextValue}>{children}</TripContext.Provider>
  );
}

// ============================================================================
// Custom Hook
// ============================================================================

/**
 * Hook to access the Trip Context.
 *
 * Must be used within a TripProvider component.
 * Throws an error if used outside the provider to catch misuse early.
 *
 * @returns The trip context value with trip data and actions
 * @throws {Error} If called outside of TripProvider
 *
 * @example
 * ```tsx
 * import { useTripContext } from '@/contexts/TripContext';
 *
 * function TripSelector() {
 *   const { trips, currentTrip, setCurrentTrip, isLoading } = useTripContext();
 *
 *   if (isLoading) {
 *     return <Spinner />;
 *   }
 *
 *   return (
 *     <select
 *       value={currentTrip?.id ?? ''}
 *       onChange={(e) => setCurrentTrip(e.target.value || null)}
 *     >
 *       <option value="">Select a trip</option>
 *       {trips.map((trip) => (
 *         <option key={trip.id} value={trip.id}>
 *           {trip.name}
 *         </option>
 *       ))}
 *     </select>
 *   );
 * }
 * ```
 */
export function useTripContext(): TripContextValue {
  const context = useContext(TripContext);

  if (context === null) {
    throw new Error(
      'useTripContext must be used within a TripProvider. ' +
        'Wrap your component tree with <TripProvider>.',
    );
  }

  return context;
}

// ============================================================================
// Exports
// ============================================================================

export { TripContext };
export type { TripProviderProps };
