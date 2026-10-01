/**
 * @fileoverview Activity Context for managing the shared agenda of the current trip.
 * Provides reactive activity data and CRUD operations scoped to the selected trip.
 *
 * @module contexts/ActivityContext
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

import { isActivityPast } from '@/features/activities/utils/activity-utils';

import { useTripContext } from '@/contexts/TripContext';
import {
  areArraysEqual,
  areCoordinatesEqual,
  wrapAndSetError,
} from '@/contexts/utils';
import { db } from '@/lib/db/database';
import {
  createActivity as repositoryCreateActivity,
  deleteActivityWithOwnershipCheck,
  setActivityParticipation,
  updateActivityWithOwnershipCheck,
} from '@/lib/db';
import type {
  Activity,
  ActivityFormData,
  ActivityId,
  PersonId,
} from '@/types';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Public interface for the Activity Context value.
 * Provides access to the trip agenda and its CRUD operations.
 */
export interface ActivityContextValue {
  /**
   * Array of all activities for the current trip, sorted by start datetime.
   * Empty array if no trip is selected or during loading.
   */
  readonly activities: readonly Activity[];

  /**
   * Activities that have not ended yet, sorted by start datetime.
   * An activity counts as upcoming until its end (or its start when open-ended).
   *
   * This and `pastActivities` partition `activities`: every activity appears in
   * exactly one of them. Consumers must never re-derive the split themselves —
   * the agenda page and this context used to disagree for the rest of the day
   * about an activity that ended this morning.
   */
  readonly upcomingActivities: readonly Activity[];

  /**
   * Activities that are already over, sorted by start datetime.
   * The exact complement of `upcomingActivities`.
   */
  readonly pastActivities: readonly Activity[];

  /**
   * True while activity data is being loaded from IndexedDB.
   */
  readonly isLoading: boolean;

  /**
   * Error from the most recent operation, or null if no error.
   * Cleared automatically before each new operation.
   */
  readonly error: Error | null;

  /**
   * Creates a new activity in the current trip.
   *
   * @param data - The activity form data
   * @returns The created Activity object
   * @throws {Error} If no trip is currently selected or creation fails
   */
  createActivity: (data: ActivityFormData) => Promise<Activity>;

  /**
   * Updates an existing activity.
   * Verifies the activity belongs to the current trip before updating.
   *
   * @param id - The activity ID to update
   * @param data - Partial activity form data to update
   */
  updateActivity: (
    id: ActivityId,
    data: Partial<ActivityFormData>,
  ) => Promise<void>;

  /**
   * Deletes an activity.
   * Verifies the activity belongs to the current trip before deleting.
   *
   * @param id - The activity ID to delete
   */
  deleteActivity: (id: ActivityId) => Promise<void>;

  /**
   * Adds or removes a guest from an activity's participant list.
   *
   * @param id - The activity ID
   * @param personId - The guest joining or leaving
   * @param joining - True to join, false to leave
   * @throws {Error} If the activity is full when joining
   */
  setParticipation: (
    id: ActivityId,
    personId: PersonId,
    joining: boolean,
  ) => Promise<void>;

  /**
   * Synchronously retrieves all activities a person joined.
   * Fast O(1) lookup using an internal Map.
   *
   * @param personId - The person ID to filter by
   * @returns Array of activities for the person, empty array if none found
   */
  getActivitiesByParticipant: (personId: PersonId) => Activity[];
}

/**
 * Props for the ActivityProvider component.
 */
interface ActivityProviderProps {
  /** Child components to render within the provider */
  readonly children: ReactNode;
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Compares two participant lists for equality (order-sensitive, which is fine
 * because the repository always writes them in a stable order).
 */
function areParticipantsEqual(
  a: readonly PersonId[] | undefined,
  b: readonly PersonId[] | undefined,
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b || a.length !== b.length) {
    return false;
  }
  return a.every((personId, index) => personId === b[index]);
}

/**
 * Comparison function for Activity objects.
 * Compares all mutable properties so refs update when any field changes.
 */
const compareActivities = (a: Activity, b: Activity): boolean =>
  a.id === b.id &&
  a.tripId === b.tripId &&
  a.title === b.title &&
  a.category === b.category &&
  a.startDatetime === b.startDatetime &&
  a.endDatetime === b.endDatetime &&
  a.allDay === b.allDay &&
  a.location === b.location &&
  areCoordinatesEqual(a.coordinates, b.coordinates) &&
  a.organizerId === b.organizerId &&
  a.maxParticipants === b.maxParticipants &&
  a.notes === b.notes &&
  areParticipantsEqual(a.participantIds, b.participantIds);

/**
 * Compares two activity arrays for equality based on all mutable properties.
 */
const areActivitiesEqual = (a: Activity[], b: Activity[]): boolean =>
  areArraysEqual(a, b, compareActivities);

/**
 * Builds a lookup map from participant ID to the activities they joined.
 */
function buildActivitiesByParticipantMap(
  activities: readonly Activity[],
): Map<PersonId, Activity[]> {
  const byParticipant = new Map<PersonId, Activity[]>();

  for (const activity of activities) {
    for (const personId of activity.participantIds ?? []) {
      const existing = byParticipant.get(personId);
      if (existing) {
        existing.push(activity);
      } else {
        byParticipant.set(personId, [activity]);
      }
    }
  }

  return byParticipant;
}

// ============================================================================
// Context Creation
// ============================================================================

/**
 * React Context for activity state management.
 *
 * @internal Use useActivityContext hook instead of consuming this directly
 */
const ActivityContext = createContext<ActivityContextValue | null>(null);

ActivityContext.displayName = 'ActivityContext';

// ============================================================================
// Provider Component
// ============================================================================

/**
 * Provides the shared activity agenda for the current trip.
 *
 * Features:
 * - Reactive data binding via Dexie live queries
 * - Automatic filtering by current trip, sorted by start datetime
 * - CRUD operations with ownership validation
 * - Join/leave participation with a transactional seat check
 * - O(1) lookup of the activities a guest joined
 *
 * @remarks
 * Must be used within a TripProvider. When no trip is selected,
 * activities will be an empty array and CRUD operations will throw errors.
 *
 * @param props - Provider props including children
 * @returns Provider component wrapping children with activity context
 *
 * @example
 * ```tsx
 * <TripProvider>
 *   <ActivityProvider>
 *     <ActivityList />
 *   </ActivityProvider>
 * </TripProvider>
 * ```
 */
export function ActivityProvider({
  children,
}: ActivityProviderProps): ReactElement {
  const { currentTrip } = useTripContext(),
    currentTripId = currentTrip?.id,

    [error, setError] = useState<Error | null>(null),

    // Stable array reference to prevent unnecessary re-renders
    activitiesRef = useRef<Activity[]>([]),

    // Map for O(1) lookup by participant
    activitiesByParticipantMapRef = useRef<Map<PersonId, Activity[]>>(new Map()),

    // Live query for activities, scoped to the current trip
    activitiesQuery = useLiveQuery(async () => {
      if (!currentTripId) {
        return [];
      }

      try {
        // Compound index [tripId+startDatetime] gives a sorted agenda for free
        return await db.activities
          .where('[tripId+startDatetime]')
          .between([currentTripId, ''], [currentTripId, '\uffff'])
          .toArray();
      } catch (err) {
        const queryError =
          err instanceof Error ? err : new Error('Failed to load activities');
        setError(queryError);
        return [];
      }
    }, [currentTripId]),

    isLoading = currentTripId !== undefined && activitiesQuery === undefined,

    rawActivities = useMemo(() => activitiesQuery ?? [], [activitiesQuery]),

    [activities, setActivities] = useState<Activity[]>([]),

    // Refreshed every minute so the past/upcoming split stays accurate while
    // the page is left open. Kept as epoch millis so it is a stable primitive
    // for memo dependencies and compares as a real instant, not as text.
    [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const REFRESH_INTERVAL_MS = 60_000; // 1 minute
    const intervalId = setInterval(() => {
      setNowMs(Date.now());
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(intervalId);
  }, []);

  // Clear cached state when the trip changes to prevent stale cross-trip data
  useEffect(() => {
    setActivities([]);
    activitiesRef.current = [];
    activitiesByParticipantMapRef.current = new Map();
    setError(null);
  }, [currentTripId]);

  // Update the stable array reference and lookup map outside of render
  useEffect(() => {
    if (!areActivitiesEqual(rawActivities, activitiesRef.current)) {
      activitiesRef.current = rawActivities;
      activitiesByParticipantMapRef.current =
        buildActivitiesByParticipantMap(rawActivities);
      setActivities(rawActivities);
    }
  }, [rawActivities]);

  // One character per activity: "1" once it is over. Recomputed on every tick,
  // but it collapses to the same string until an activity actually crosses its
  // end, which keeps the split arrays — and the whole context value — stable
  // between ticks instead of re-rendering every consumer once a minute.
  const pastSignature = useMemo(() => {
    const now = new Date(nowMs);
    return activities
      .map((activity) => (isActivityPast(activity, now) ? '1' : '0'))
      .join('');
  }, [activities, nowMs]),

    { upcomingActivities, pastActivities } = useMemo(() => {
      const upcoming: Activity[] = [],
        past: Activity[] = [];

      activities.forEach((activity, index) => {
        if (pastSignature[index] === '1') {
          past.push(activity);
        } else {
          upcoming.push(activity);
        }
      });

      return { upcomingActivities: upcoming, pastActivities: past };
    }, [activities, pastSignature]),

    createActivity = useCallback(
      async (data: ActivityFormData): Promise<Activity> => {
        const tripId = currentTripId;
        if (!tripId) {
          throw new Error('Cannot create activity: no trip selected');
        }

        setError((prev) => (prev === null ? prev : null));

        try {
          return await repositoryCreateActivity(tripId, data);
        } catch (err) {
          throw wrapAndSetError(err, 'Failed to create activity', setError);
        }
      },
      [currentTripId],
    ),

    updateActivity = useCallback(
      async (id: ActivityId, data: Partial<ActivityFormData>): Promise<void> => {
        const tripId = currentTripId;
        if (!tripId) {
          throw new Error('Cannot update activity: no trip selected');
        }

        setError((prev) => (prev === null ? prev : null));

        try {
          await updateActivityWithOwnershipCheck(id, tripId, data);
        } catch (err) {
          throw wrapAndSetError(err, 'Failed to update activity', setError);
        }
      },
      [currentTripId],
    ),

    deleteActivity = useCallback(
      async (id: ActivityId): Promise<void> => {
        const tripId = currentTripId;
        if (!tripId) {
          throw new Error('Cannot delete activity: no trip selected');
        }

        setError((prev) => (prev === null ? prev : null));

        try {
          await deleteActivityWithOwnershipCheck(id, tripId);
        } catch (err) {
          throw wrapAndSetError(err, 'Failed to delete activity', setError);
        }
      },
      [currentTripId],
    ),

    setParticipation = useCallback(
      async (
        id: ActivityId,
        personId: PersonId,
        joining: boolean,
      ): Promise<void> => {
        const tripId = currentTripId;
        if (!tripId) {
          throw new Error('Cannot update activity: no trip selected');
        }

        setError((prev) => (prev === null ? prev : null));

        try {
          await setActivityParticipation(id, tripId, personId, joining);
        } catch (err) {
          throw wrapAndSetError(err, 'Failed to update participation', setError);
        }
      },
      [currentTripId],
    ),

    getActivitiesByParticipant = useCallback(
      (personId: PersonId): Activity[] =>
        activitiesByParticipantMapRef.current.get(personId) ?? [],
      [],
    ),

    contextValue = useMemo<ActivityContextValue>(
      () => ({
        activities,
        upcomingActivities,
        pastActivities,
        isLoading,
        error,
        createActivity,
        updateActivity,
        deleteActivity,
        setParticipation,
        getActivitiesByParticipant,
      }),
      [
        activities,
        upcomingActivities,
        pastActivities,
        isLoading,
        error,
        createActivity,
        updateActivity,
        deleteActivity,
        setParticipation,
        getActivitiesByParticipant,
      ],
    );

  return (
    <ActivityContext.Provider value={contextValue}>
      {children}
    </ActivityContext.Provider>
  );
}

// ============================================================================
// Custom Hook
// ============================================================================

/**
 * Hook to access the Activity Context.
 *
 * Must be used within both TripProvider and ActivityProvider components.
 *
 * @returns The activity context value with agenda data and CRUD operations
 * @throws {Error} If called outside of ActivityProvider
 *
 * @example
 * ```tsx
 * function ActivityList() {
 *   const { activities, isLoading } = useActivityContext();
 *
 *   if (isLoading) {
 *     return <Spinner />;
 *   }
 *
 *   return (
 *     <ul>
 *       {activities.map((activity) => (
 *         <li key={activity.id}>{activity.title}</li>
 *       ))}
 *     </ul>
 *   );
 * }
 * ```
 */
export function useActivityContext(): ActivityContextValue {
  const context = useContext(ActivityContext);

  if (context === null) {
    throw new Error(
      'useActivityContext must be used within an ActivityProvider. ' +
        'Wrap your component tree with <ActivityProvider>.',
    );
  }

  return context;
}

// ============================================================================
// Exports
// ============================================================================

export { ActivityContext };
export type { ActivityProviderProps };
