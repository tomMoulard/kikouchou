/**
 * Activity Repository
 *
 * Provides CRUD operations for Activity entities (the shared trip agenda).
 * All operations use the Dexie.js database and branded types for type safety.
 *
 * @module lib/db/repositories/activity-repository
 */

import { db } from '@/lib/db/database';
import { sanitizeActivityData } from '@/lib/db/sanitize';
import { createActivityId } from '@/lib/db/utils';
import { localDayKeyOfInstant } from '@/lib/utils/trip-days';
import type {
  Activity,
  ActivityFormData,
  ActivityId,
  PersonId,
  TripId,
} from '@/types';

// ============================================================================
// Create
// ============================================================================

/**
 * Creates a new activity in the database.
 *
 * @param tripId - The trip this activity belongs to
 * @param data - The activity form data
 * @returns The created Activity object
 *
 * @example
 * ```typescript
 * const activity = await createActivity(tripId, {
 *   title: 'Fête des plantes',
 *   category: 'horticulture',
 *   startDatetime: '2024-07-16T09:00:00.000Z',
 *   endDatetime: '2024-07-16T12:00:00.000Z',
 *   allDay: false,
 *   location: 'Château de Saint-Jean',
 *   participantIds: [personId],
 * });
 * ```
 */
export async function createActivity(
  tripId: TripId,
  data: ActivityFormData,
): Promise<Activity> {
  const sanitizedData = sanitizeActivityData(data);

  try {
    const activity: Activity = {
      id: createActivityId(),
      tripId,
      ...sanitizedData,
      participantIds: [...sanitizedData.participantIds],
    };

    await db.activities.add(activity);
    return activity;
  } catch (error) {
    throw new Error(
      `Failed to create activity "${sanitizedData.title}" for trip ${tripId}`,
      { cause: error },
    );
  }
}

// ============================================================================
// Read
// ============================================================================

/**
 * Retrieves all activities for a trip, ordered by start datetime.
 *
 * Uses the compound index [tripId+startDatetime] for efficient querying.
 *
 * @param tripId - The trip ID to filter by
 * @returns Array of activities sorted by start datetime ascending
 *
 * @example
 * ```typescript
 * const activities = await getActivitiesByTripId(tripId);
 * ```
 */
export async function getActivitiesByTripId(tripId: TripId): Promise<Activity[]> {
  return db.activities
    .where('[tripId+startDatetime]')
    .between([tripId, ''], [tripId, '\uffff'])
    .toArray();
}

/**
 * Retrieves an activity by its unique ID.
 *
 * @param id - The activity's unique identifier
 * @returns The activity if found, undefined otherwise
 */
export async function getActivityById(
  id: ActivityId,
): Promise<Activity | undefined> {
  return db.activities.get(id);
}

/**
 * Retrieves all activities a person joined, ordered by start datetime.
 *
 * Uses the multi-entry index on participantIds.
 *
 * @param personId - The person ID to filter by
 * @returns Array of activities the person participates in
 *
 * @example
 * ```typescript
 * const mine = await getActivitiesByParticipantId(personId);
 * ```
 */
export async function getActivitiesByParticipantId(
  personId: PersonId,
): Promise<Activity[]> {
  const activities = await db.activities
    .where('participantIds')
    .equals(personId)
    .toArray();

  return activities.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
}

/**
 * Retrieves all activities organized by a specific person.
 *
 * @param organizerId - The person ID of the organizer
 * @returns Array of activities this person leads
 */
export async function getActivitiesByOrganizerId(
  organizerId: PersonId,
): Promise<Activity[]> {
  const activities = await db.activities
    .where('organizerId')
    .equals(organizerId)
    .toArray();

  return activities.sort((a, b) => a.startDatetime.localeCompare(b.startDatetime));
}

/**
 * Gets activities for a trip that overlap a specific calendar date.
 *
 * An activity overlaps the date when the date falls between its start day and
 * its end day (inclusive). Activities without an end fall on their start day only.
 *
 * `date` is a **local** day key — the day the viewer reads off their own
 * calendar, which is what every caller has to hand. Activity datetimes are
 * stored as UTC instants, so their days are read with `localDayKeyOfInstant`;
 * taking the first ten characters of the stored string compared a UTC day
 * against a local one and hid a midnight activity from the day it happens on.
 *
 * @param tripId - The trip ID to search within
 * @param date - The local calendar day to filter by (YYYY-MM-DD)
 * @returns Array of activities on the given date, sorted by start datetime
 *
 * @example
 * ```typescript
 * const todayActivities = await getActivitiesForDate(tripId, '2024-07-16');
 * ```
 */
export async function getActivitiesForDate(
  tripId: TripId,
  date: string,
): Promise<Activity[]> {
  const activities = await getActivitiesByTripId(tripId);

  return activities.filter((activity) => {
    const startDay = localDayKeyOfInstant(activity.startDatetime);
    if (!startDay) {
      return false;
    }
    const endDay =
      localDayKeyOfInstant(activity.endDatetime ?? activity.startDatetime) ?? startDay;
    return startDay <= date && date <= endDay;
  });
}

/**
 * Gets the count of activities for a trip.
 *
 * @param tripId - The trip ID to count activities for
 * @returns Number of activities in the trip
 */
export async function getActivityCount(tripId: TripId): Promise<number> {
  return db.activities.where('tripId').equals(tripId).count();
}

// ============================================================================
// Transactional Operations with Ownership Validation
// ============================================================================

/**
 * Updates an activity with ownership validation in a single transaction.
 * Prevents a TOCTOU race by combining validation and mutation atomically.
 *
 * @param id - The activity's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param data - Partial activity form data to update
 * @throws {Error} If the activity is not found or belongs to another trip
 *
 * @example
 * ```typescript
 * await updateActivityWithOwnershipCheck(activityId, currentTripId, { title: 'New title' });
 * ```
 */
export async function updateActivityWithOwnershipCheck(
  id: ActivityId,
  tripId: TripId,
  data: Partial<ActivityFormData>,
): Promise<void> {
  const sanitizedData = sanitizeActivityPartial(data);

  await db.transaction('rw', db.activities, async () => {
    const activity = await db.activities.get(id);

    if (!activity) {
      throw new Error(`Activity with ID "${id}" not found`);
    }
    if (activity.tripId !== tripId) {
      throw new Error('Cannot update activity: activity does not belong to current trip');
    }

    await db.activities.update(id, sanitizedData);
  });
}

/**
 * Deletes an activity with ownership validation in a single transaction.
 *
 * @param id - The activity's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @throws {Error} If the activity is not found or belongs to another trip
 */
export async function deleteActivityWithOwnershipCheck(
  id: ActivityId,
  tripId: TripId,
): Promise<void> {
  await db.transaction('rw', db.activities, async () => {
    const activity = await db.activities.get(id);

    if (!activity) {
      throw new Error(`Activity with ID "${id}" not found`);
    }
    if (activity.tripId !== tripId) {
      throw new Error('Cannot delete activity: activity does not belong to current trip');
    }

    await db.activities.delete(id);
  });
}

/**
 * Adds or removes a guest from an activity's participant list.
 *
 * Runs in a transaction so two guests joining at the same moment cannot
 * overwrite each other's entry, and refuses to join a full activity.
 *
 * @param id - The activity's unique identifier
 * @param tripId - The expected trip ID for ownership validation
 * @param personId - The guest joining or leaving
 * @param joining - True to join, false to leave
 * @returns The updated participant list
 * @throws {Error} If the activity is not found, belongs to another trip, or is full
 *
 * @example
 * ```typescript
 * await setActivityParticipation(activityId, tripId, personId, true);
 * ```
 */
export async function setActivityParticipation(
  id: ActivityId,
  tripId: TripId,
  personId: PersonId,
  joining: boolean,
): Promise<PersonId[]> {
  return db.transaction('rw', db.activities, async () => {
    const activity = await db.activities.get(id);

    if (!activity) {
      throw new Error(`Activity with ID "${id}" not found`);
    }
    if (activity.tripId !== tripId) {
      throw new Error('Cannot update activity: activity does not belong to current trip');
    }

    const current = activity.participantIds ?? [];
    const isParticipant = current.includes(personId);

    if (joining === isParticipant) {
      return [...current];
    }

    if (joining && isActivityFull(activity)) {
      throw new Error('Cannot join activity: no seat left');
    }

    const next = joining
      ? [...current, personId]
      : current.filter((candidate) => candidate !== personId);

    await db.activities.update(id, { participantIds: next });
    return next;
  });
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Whether an activity has reached its optional participant cap.
 *
 * @param activity - The activity to check
 * @returns True when the cap is set and already reached
 */
export function isActivityFull(
  activity: Pick<Activity, 'participantIds' | 'maxParticipants'>,
): boolean {
  const cap = activity.maxParticipants;
  if (cap === undefined || cap <= 0) {
    return false;
  }
  return (activity.participantIds?.length ?? 0) >= cap;
}

/**
 * Sanitizes the subset of activity fields present in a partial update.
 * Fields that are absent stay absent so Dexie does not clear them.
 */
function sanitizeActivityPartial(
  data: Partial<ActivityFormData>,
): Partial<ActivityFormData> {
  const sanitized = sanitizeActivityData({
    title: data.title ?? '',
    location: data.location,
    notes: data.notes,
    participantIds: data.participantIds,
    maxParticipants: data.maxParticipants,
  });

  const next: Partial<ActivityFormData> = { ...data };

  if (data.title !== undefined) {
    next.title = sanitized.title;
  }
  if (data.location !== undefined) {
    next.location = sanitized.location;
  }
  if (data.notes !== undefined) {
    next.notes = sanitized.notes;
  }
  if (data.participantIds !== undefined) {
    next.participantIds = [...(sanitized.participantIds ?? [])] as PersonId[];
  }
  if (data.maxParticipants !== undefined) {
    next.maxParticipants = sanitized.maxParticipants;
  }

  return next;
}
