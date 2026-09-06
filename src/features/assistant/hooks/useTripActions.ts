/**
 * @fileoverview Hook to parse and execute action blocks from the LLM response.
 * Bridges between the LLM's JSON action output and the app's context mutations.
 *
 * Action schemas are defined in `../action-schema.ts` which is the single
 * source of truth shared with the system prompt generator.
 *
 * @module features/assistant/hooks/useTripActions
 */

import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  toActivityInstant,
  toAllDayActivityInstant,
} from '@/features/activities/utils/activity-utils';

import { useOfflineAwareToast } from '@/hooks';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { toCanonicalDatetime } from '@/lib/db/transport-datetime';
import {
  createActivity,
  createAssignment,
  createPerson,
  createRide,
  createRoom,
  createTransport,
  createTrip,
  createVehicle,
  deleteActivityWithOwnershipCheck,
  deleteAssignmentWithOwnershipCheck,
  deletePersonWithOwnershipCheck,
  deleteRideWithOwnershipCheck,
  deleteRoomWithOwnershipCheck,
  deleteTransportWithOwnershipCheck,
  deleteVehicleWithOwnershipCheck,
  getActivityById,
  getAssignmentById,
  getGuestGroupById,
  getPersonById,
  getPersonsByTripId,
  getRideById,
  getRoomById,
  getVehicleById,
  importGuestGroupMembers,
  getTransportById,
  getTripById,
  setActivityParticipation,
  setCurrentTrip,
  setTransportRide,
  updateActivityWithOwnershipCheck,
  updateRideWithOwnershipCheck,
  updateTrip,
} from '@/lib/db';
import {
  ActivityFormDataSchema,
  RideFormDataSchema,
  VehicleFormDataSchema,
} from '@/lib/validation/schemas';
import {
  CHILD_SEAT_KINDS,
  getDefaultPersonColor,
  type Activity,
  type ActivityCategory,
  type ActivityFormData,
  type ActivityId,
  type ChildSeatKind,
  type GuestGroupId,
  type GuestGroupMemberId,
  type ISODateString,
  type ISODateTimeString,
  type PersonId,
  type Ride,
  type RideDirection,
  type RideFormData,
  type RideId,
  type RoomAssignmentId,
  type RoomId,
  type TransportId,
  type TransportMode,
  type TransportType,
  type TripId,
  type VehicleFormData,
  type VehicleId,
} from '@/types';

import { type LLMAction, validateAction } from '../action-schema';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Result of executing parsed LLM actions (for UI: expandable change list).
 */
export interface ActionExecutionResult {
  /** Number of actions that ran successfully */
  readonly count: number;
  /** One human-readable line per successful action */
  readonly summaries: readonly string[];
}

/**
 * Return type for the useTripActions hook.
 */
export interface UseTripActionsReturn {
  /** Parse an LLM response and execute any action blocks found. */
  executeActions: (response: string) => Promise<ActionExecutionResult>;
}

// ============================================================================
// Parsing Helpers
// ============================================================================

/**
 * Regex to extract JSON action blocks from LLM response.
 * Matches ```action, ```json, or bare ``` fenced blocks.
 */
const FENCED_BLOCK_REGEX =
  /```(?:action|json)?\s*\n?([\s\S]*?)\n?\s*```/g;

/**
 * Regex to match bare JSON objects with an "action" key that aren't inside fences.
 * This is a fallback for when the LLM outputs raw JSON without fencing.
 */
const BARE_JSON_REGEX =
  /\{[^{}]*"action"\s*:\s*"[^"]+"\s*,\s*"data"\s*:\s*\{[^}]*\}[^}]*\}/g;

/**
 * Attempt to parse a string as a valid LLM action using the shared schema.
 * Returns the validated action if valid, null otherwise.
 */
function tryParseAction(content: string): LLMAction | null {
  try {
    const trimmed = content.trim();
    if (!trimmed.startsWith('{')) return null;
    return validateAction(JSON.parse(trimmed));
  } catch {
    return null;
  }
}

/**
 * Parse action blocks from an LLM response string.
 * Tries fenced blocks first, then falls back to bare JSON objects.
 */
function parseActionBlocks(response: string): LLMAction[] {
  const actions: LLMAction[] = [];
  const seen = new Set<string>();

  // 1. Try fenced code blocks (```action ... ``` or ```json ... ``` or ``` ... ```)
  FENCED_BLOCK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = FENCED_BLOCK_REGEX.exec(response)) !== null) {
    const action = tryParseAction(match[1] ?? '');
    if (action) {
      const key = `${action.action}:${JSON.stringify(action.data)}`;
      if (!seen.has(key)) {
        seen.add(key);
        actions.push(action);
      }
    }
  }

  // 2. Fallback: try bare JSON objects in the response (not fenced)
  if (actions.length === 0) {
    BARE_JSON_REGEX.lastIndex = 0;
    while ((match = BARE_JSON_REGEX.exec(response)) !== null) {
      const action = tryParseAction(match[0]);
      if (action) {
        const key = `${action.action}:${JSON.stringify(action.data)}`;
        if (!seen.has(key)) {
          seen.add(key);
          actions.push(action);
        }
      }
    }
  }

  return actions;
}

// ============================================================================
// Activity Helpers
// ============================================================================

/**
 * Keeps only the participant ids that belong to the trip, de-duplicated.
 *
 * Dropping duplicates here (rather than leaving it to `sanitizeActivityData`)
 * matters because the seat-cap check in `ActivityFormDataSchema` runs on this
 * array: a model that repeats an id would otherwise blow a cap it never
 * actually exceeds.
 *
 * @param raw - The `participantIds` value from the parsed action
 * @param knownGuestIds - Ids of the trip's guests
 * @returns The distinct participant ids that exist in the trip
 */
function keepKnownGuestIds(
  raw: unknown,
  knownGuestIds: Set<PersonId>,
): PersonId[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const kept = raw.filter(
    (id): id is PersonId =>
      typeof id === 'string' && knownGuestIds.has(id as PersonId),
  );
  return Array.from(new Set(kept));
}

/**
 * Normalises a datetime an action carried into the instant activities are
 * stored as, matching what the form writes.
 *
 * @param value - The raw value from the parsed action data
 * @param allDay - Whether the activity covers whole days
 * @param edge - Which end of the day an all-day value snaps to
 * @returns The stored instant, or undefined when the value is unusable
 */
function activityInstant(
  value: unknown,
  allDay: boolean,
  edge: 'start' | 'end',
): ISODateTimeString | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return allDay
    ? toAllDayActivityInstant(value, edge)
    : toActivityInstant(value);
}

/**
 * Projects a stored activity back onto its form shape, so a partial update
 * can be validated as a whole record before it is written.
 *
 * @param activity - The stored activity
 * @returns The equivalent form data
 */
function toActivityFormData(activity: Activity): ActivityFormData {
  return {
    title: activity.title,
    category: activity.category,
    startDatetime: activity.startDatetime,
    allDay: activity.allDay,
    participantIds: [...activity.participantIds],
    ...(activity.endDatetime !== undefined && {
      endDatetime: activity.endDatetime,
    }),
    ...(activity.location !== undefined && { location: activity.location }),
    ...(activity.coordinates !== undefined && {
      coordinates: activity.coordinates,
    }),
    ...(activity.organizerId !== undefined && {
      organizerId: activity.organizerId,
    }),
    ...(activity.maxParticipants !== undefined && {
      maxParticipants: activity.maxParticipants,
    }),
    ...(activity.notes !== undefined && { notes: activity.notes }),
  };
}

// ============================================================================
// Ride Helpers
// ============================================================================

/**
 * Projects a stored ride back onto its form shape, so a partial update can be
 * validated as a whole record before it is written — same reasoning as
 * {@link toActivityFormData}.
 *
 * @param ride - The stored ride
 * @returns The equivalent form data
 */
function toRideFormData(ride: Ride): RideFormData {
  return {
    direction: ride.direction,
    meetDatetime: ride.meetDatetime,
    location: ride.location,
    ...(ride.coordinates !== undefined && { coordinates: ride.coordinates }),
    ...(ride.leadTimeMinutes !== undefined && {
      leadTimeMinutes: ride.leadTimeMinutes,
    }),
    ...(ride.driverId !== undefined && { driverId: ride.driverId }),
    ...(ride.vehicleId !== undefined && { vehicleId: ride.vehicleId }),
    ...(ride.notes !== undefined && { notes: ride.notes }),
  };
}

/**
 * Keeps only the child restraints the app actually knows, de-duplicating
 * nothing — two boosters are two entries, one per seat.
 *
 * A kind outside the union is dropped on its own rather than failing the car:
 * a model that answers "child seat" in French should still get the car created.
 *
 * @param raw - The `childSeats` value from the parsed action
 * @returns The recognised kinds, in the order given
 */
function keepKnownChildSeats(raw: unknown): ChildSeatKind[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((kind): kind is ChildSeatKind =>
    CHILD_SEAT_KINDS.includes(kind as ChildSeatKind),
  );
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Hook that provides a function to parse and execute LLM action blocks.
 *
 * @returns Object with executeActions function
 */
export function useTripActions(): UseTripActionsReturn {
  const { t } = useTranslation();
  const { currentTrip } = useTripContext();
  // Every write the assistant performs lands in IndexedDB exactly like a write
  // made by hand, so it confirms the same way: offline it says "Saved on this
  // device" rather than claiming a success the network never saw.
  const { successToast } = useOfflineAwareToast();

  const executeActions = useCallback(
    async (response: string): Promise<ActionExecutionResult> => {
      const actions = parseActionBlocks(response);

      if (actions.length === 0) {
        return { count: 0, summaries: [] };
      }

      console.log('[AI Assistant] Parsed actions:', actions);

      /** Tracks which trip mutations apply to (supports createTrip/selectTrip mid-batch). */
      let activeTripId: TripId | null = currentTrip?.id ?? null;

      /**
       * Guest ids per trip, resolved once per reply. Invalidated whenever this
       * batch adds or removes a guest so later actions see the new roster.
       */
      const guestIdCache = new Map<TripId, Set<PersonId>>();
      const guestIdsFor = async (tripId: TripId): Promise<Set<PersonId>> => {
        const cached = guestIdCache.get(tripId);
        if (cached) {
          return cached;
        }
        const guests = await getPersonsByTripId(tripId);
        const ids = new Set(guests.map((guest) => guest.id));
        guestIdCache.set(tripId, ids);
        return ids;
      };

      /**
       * The id when it names a guest of this trip, undefined otherwise.
       *
       * Rides and cars carry optional references that no repository checks, and
       * `activeTripId` can change mid-batch (createTrip/selectTrip), so an id
       * the model carried over from another trip would be stored as a permanent
       * orphan. Dropping the reference keeps the rest of the record.
       */
      const tripPersonId = async (
        raw: unknown,
        tripId: TripId,
      ): Promise<PersonId | undefined> => {
        if (typeof raw !== 'string') {
          return undefined;
        }
        const person = await getPersonById(raw as PersonId);
        return person && person.tripId === tripId ? person.id : undefined;
      };

      /** The id when it names a car of this trip, undefined otherwise. */
      const tripVehicleId = async (
        raw: unknown,
        tripId: TripId,
      ): Promise<VehicleId | undefined> => {
        if (typeof raw !== 'string') {
          return undefined;
        }
        const vehicle = await getVehicleById(raw as VehicleId);
        return vehicle && vehicle.tripId === tripId ? vehicle.id : undefined;
      };

      /**
       * Says out loud that a reference was dropped.
       *
       * Dropping the id keeps the rest of the record, but doing it in silence
       * is how the assistant reports a success it did not have: the model
       * writes "Tom is driving the airport run", the driver never lands, and
       * the change list shows nothing at all because a dropped optional leaves
       * `executedCount` untouched.
       *
       * @param data - The parsed action data
       * @param driverId - What `tripPersonId` made of its guest reference
       * @param vehicleId - What `tripVehicleId` made of its car reference
       */
      const reportDroppedRefs = (
        data: Record<string, unknown>,
        driverId: PersonId | undefined,
        vehicleId: VehicleId | undefined,
      ): void => {
        if (data.driverId !== undefined && driverId === undefined) {
          toast.error(t('assistant.guestNotFound'));
        }
        if (data.vehicleId !== undefined && vehicleId === undefined) {
          toast.error(t('assistant.vehicleNotFound'));
        }
      };

      let executedCount = 0;
      const summaries: string[] = [];

      for (const action of actions) {
        try {
          switch (action.action) {
            case 'createTrip': {
              const d = action.data as Record<string, unknown>;
              const trip = await createTrip({
                name: d.name as string,
                startDate: d.startDate as ISODateString,
                endDate: d.endDate as ISODateString,
                ...(d.location !== undefined && { location: d.location as string }),
                ...(d.description !== undefined && {
                  description: d.description as string,
                }),
              });
              activeTripId = trip.id;
              await setCurrentTrip(trip.id);
              successToast(t('trips.created'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.createTrip', { name: trip.name }),
              );
              break;
            }

            case 'selectTrip': {
              const rawId = action.data.tripId as string;
              const trip = await getTripById(rawId as TripId);
              if (!trip) {
                toast.error(t('assistant.selectTripNotFound'));
                break;
              }
              activeTripId = trip.id;
              await setCurrentTrip(trip.id);
              // Deliberately a raw toast: switching trips changes which trip
              // the rest of the batch touches, so the name has to stay on
              // screen. "Saved on this device" would drop the one fact that
              // matters, and the selection never leaves this device anyway.
              toast.success(
                t('assistant.tripSwitched', { name: trip.name }),
              );
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.selectTrip', { name: trip.name }),
              );
              break;
            }

            case 'updateTrip': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;
              const keys = (
                [
                  'name',
                  'location',
                  'startDate',
                  'endDate',
                  'description',
                ] as const
              ).filter((k) => d[k] !== undefined);
              if (keys.length === 0) {
                break;
              }
              const fields = keys
                .map((k) =>
                  t(`assistant.actionDetails.tripField.${k}`, {
                    defaultValue: k,
                  }),
                )
                .join(', ');
              await updateTrip(tid, {
                ...(d.name !== undefined && { name: d.name as string }),
                // A new location name invalidates the pin resolved from the old
                // one; clearing it beats leaving the trip pinned elsewhere on
                // the analytics map. The user re-picks the place in the form.
                ...(d.location !== undefined && {
                  location: d.location as string,
                  coordinates: undefined,
                }),
                ...(d.startDate !== undefined && { startDate: d.startDate as ISODateString }),
                ...(d.endDate !== undefined && { endDate: d.endDate as ISODateString }),
                ...(d.description !== undefined && { description: d.description as string }),
              });
              successToast(t('trips.updated'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.updateTrip', {
                  fields,
                  defaultValue: 'Updated trip ({{fields}})',
                }),
              );
              break;
            }

            case 'addGuest': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;
              const colorIndex = await db.persons
                .where('tripId')
                .equals(tid)
                .count();
              await createPerson(tid, {
                name: d.name as string,
                color: getDefaultPersonColor(colorIndex),
                ...(d.stayStartDate !== undefined && {
                  stayStartDate: d.stayStartDate as ISODateString,
                }),
                ...(d.stayEndDate !== undefined && {
                  stayEndDate: d.stayEndDate as ISODateString,
                }),
                ...(d.headcount !== undefined && {
                  headcount: d.headcount as number,
                }),
                ...(d.phone !== undefined && { phone: d.phone as string }),
                ...(d.notes !== undefined && { notes: d.notes as string }),
                // Left as the model wrote it: `createPerson` runs it through
                // `normalizeChildSeat`, which drops anything that is not one of
                // the three kinds rather than storing an invented one.
                ...(d.childSeat !== undefined && {
                  childSeat: d.childSeat as ChildSeatKind,
                }),
              });
              guestIdCache.delete(tid);
              successToast(t('persons.createSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.addGuest', {
                  name: d.name as string,
                  defaultValue: 'Added guest: {{name}}',
                }),
              );
              break;
            }

            case 'importGuestGroup': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }

              const d = action.data as Record<string, unknown>;
              const groupId = d.groupId as GuestGroupId;
              const group = await getGuestGroupById(groupId);

              // The model picks the id out of the prompt, so a wrong one is a
              // misread rather than a rare race — worth saying plainly instead
              // of letting the repository throw a message written for a
              // developer.
              if (!group) {
                toast.error(
                  t('assistant.guestGroupNotFound', {
                    defaultValue: 'No saved group with that id',
                  }),
                );
                break;
              }

              // A model that flattens the array, or names a member that has
              // since been removed, gets the members it did name — the
              // repository reports the rest rather than failing the import.
              const requested = Array.isArray(d.memberIds)
                ? (d.memberIds.filter(
                    (id): id is string => typeof id === 'string',
                  ) as GuestGroupMemberId[])
                : undefined;

              const { persons: imported } = await importGuestGroupMembers(
                tid,
                groupId,
                requested,
              );

              guestIdCache.delete(tid);
              successToast(t('persons.createSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.importGuestGroup', {
                  count: imported.length,
                  name: group.name,
                  defaultValue: 'Added {{count}} guests from {{name}}',
                }),
              );
              break;
            }

            case 'removeGuest': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const pid = action.data.personId as PersonId;
              const guest = await getPersonById(pid);
              await deletePersonWithOwnershipCheck(pid, tid);
              guestIdCache.delete(tid);
              successToast(t('persons.deleteSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.removeGuest', {
                  name: guest?.name ?? String(pid),
                  defaultValue: 'Removed guest: {{name}}',
                }),
              );
              break;
            }

            case 'addRoom': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;
              await createRoom(tid, {
                name: d.name as string,
                capacity: d.capacity as number,
                description: d.description as string | undefined,
              });
              successToast(t('rooms.createSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.addRoom', {
                  name: d.name as string,
                  capacity: String(d.capacity),
                  defaultValue: 'Added room: {{name}} ({{capacity}} guests max)',
                }),
              );
              break;
            }

            case 'removeRoom': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const rid = action.data.roomId as RoomId;
              const room = await getRoomById(rid);
              await deleteRoomWithOwnershipCheck(rid, tid);
              successToast(t('rooms.deleteSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.removeRoom', {
                  name: room?.name ?? String(rid),
                  defaultValue: 'Removed room: {{name}}',
                }),
              );
              break;
            }

            case 'assignRoom': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;

              // createAssignment does not check its foreign keys, and
              // activeTripId can change mid-batch (createTrip/selectTrip), so a
              // stale id from the model would be stored as a permanent orphan.
              const assignPerson = await getPersonById(d.personId as PersonId);
              if (!assignPerson || assignPerson.tripId !== tid) {
                toast.error(t('assistant.guestNotFound'));
                break;
              }
              const assignRoomTarget = await getRoomById(d.roomId as RoomId);
              if (!assignRoomTarget || assignRoomTarget.tripId !== tid) {
                toast.error(t('assistant.roomNotFound'));
                break;
              }

              await createAssignment(tid, {
                personId: d.personId as PersonId,
                roomId: d.roomId as RoomId,
                startDate: d.startDate as ISODateString,
                endDate: d.endDate as ISODateString,
              });
              successToast(t('assignments.createSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.assignRoom', {
                  person: assignPerson.name,
                  room: assignRoomTarget.name,
                  start: d.startDate as string,
                  end: d.endDate as string,
                  defaultValue:
                    'Assigned {{person}} → {{room}} ({{start}} – {{end}})',
                }),
              );
              break;
            }

            case 'removeAssignment': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const aid = action.data.assignmentId as RoomAssignmentId;
              const assignment = await getAssignmentById(aid);
              const person = assignment
                ? await getPersonById(assignment.personId)
                : undefined;
              const room = assignment
                ? await getRoomById(assignment.roomId)
                : undefined;
              await deleteAssignmentWithOwnershipCheck(aid, tid);
              successToast(t('assignments.deleteSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.removeAssignment', {
                  person: person?.name ?? '…',
                  room: room?.name ?? '…',
                  defaultValue: 'Removed assignment: {{person}} ↔ {{room}}',
                }),
              );
              break;
            }

            case 'addTransport': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;

              // Same reasoning as assignRoom: createTransport trusts its
              // personId, so verify it belongs to the trip being written to.
              const transportPerson = await getPersonById(d.personId as PersonId);
              if (!transportPerson || transportPerson.tripId !== tid) {
                toast.error(t('assistant.guestNotFound'));
                break;
              }

              await createTransport(tid, {
                personId: d.personId as PersonId,
                type: d.type as TransportType,
                datetime: d.datetime as ISODateTimeString,
                location: d.location as string,
                transportMode: d.transportMode as TransportMode | undefined,
                transportNumber: d.transportNumber as string | undefined,
                needsPickup: (d.needsPickup as boolean | undefined) ?? false,
              });
              successToast(t('transports.createSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.addTransport', {
                  type: d.type as string,
                  person: transportPerson.name,
                  location: d.location as string,
                  defaultValue:
                    'Added {{type}} for {{person}} — {{location}}',
                }),
              );
              break;
            }

            case 'removeTransport': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const transportId = action.data.transportId as TransportId;
              const tr = await getTransportById(transportId);
              await deleteTransportWithOwnershipCheck(transportId, tid);
              successToast(t('transports.deleteSuccess'));
              executedCount++;
              const label = tr
                ? `${tr.type} · ${tr.location}`
                : String(transportId);
              summaries.push(
                t('assistant.actionDetails.removeTransport', {
                  label,
                  defaultValue: 'Removed transport: {{label}}',
                }),
              );
              break;
            }

            case 'addRide': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;

              // The meeting time is canonicalised first, the way the form's is:
              // `RideFormDataSchema` demands seconds, and a model that writes
              // "2026-04-20T15:00" means a real instant rather than a typo.
              const meetDatetime =
                typeof d.meetDatetime === 'string'
                  ? toCanonicalDatetime(d.meetDatetime)
                  : undefined;
              if (!meetDatetime) {
                toast.error(t('assistant.invalidRide'));
                break;
              }

              const rideDriverId = await tripPersonId(d.driverId, tid);
              const rideVehicleId = await tripVehicleId(d.vehicleId, tid);
              reportDroppedRefs(d, rideDriverId, rideVehicleId);

              const rideData: RideFormData = {
                direction: d.direction as RideDirection,
                meetDatetime,
                location: d.location as string,
                ...(d.leadTimeMinutes !== undefined && {
                  leadTimeMinutes: d.leadTimeMinutes as number,
                }),
                ...(rideDriverId !== undefined && { driverId: rideDriverId }),
                ...(rideVehicleId !== undefined && { vehicleId: rideVehicleId }),
                ...(d.notes !== undefined && { notes: d.notes as string }),
              };

              const rideValidation = RideFormDataSchema.safeParse(rideData);
              if (!rideValidation.success) {
                console.warn(
                  '[AI Assistant] Rejected addRide:',
                  rideValidation.error.issues,
                );
                toast.error(t('assistant.invalidRide'));
                break;
              }

              const createdRide = await createRide(tid, rideData);
              successToast(t('rides.createSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.addRide', {
                  // The stored enum is a machine value: interpolated raw, a
                  // French user reads "Trajet ajouté (pickup)". The UI already
                  // has both directions translated.
                  direction: t(`rides.directions.${createdRide.direction}`),
                  location: createdRide.location,
                  defaultValue: 'Added {{direction}} ride — {{location}}',
                }),
              );
              break;
            }

            case 'updateRide': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;
              const rideId = d.rideId as RideId;
              const existingRide = await getRideById(rideId);
              if (!existingRide || existingRide.tripId !== tid) {
                toast.error(t('assistant.rideNotFound'));
                break;
              }

              const nextMeetDatetime =
                typeof d.meetDatetime === 'string'
                  ? toCanonicalDatetime(d.meetDatetime)
                  : undefined;
              if (d.meetDatetime !== undefined && !nextMeetDatetime) {
                toast.error(t('assistant.invalidRide'));
                break;
              }

              // An id naming somebody else's guest or car is dropped, so the
              // rest of the edit still lands rather than the whole block being
              // refused over one hallucinated reference — but it is reported,
              // or an edit that changed nothing looks exactly like one that
              // worked.
              const nextDriverId = await tripPersonId(d.driverId, tid);
              const nextVehicleId = await tripVehicleId(d.vehicleId, tid);
              reportDroppedRefs(d, nextDriverId, nextVehicleId);

              const ridePatch: Partial<RideFormData> = {
                ...(nextMeetDatetime !== undefined && {
                  meetDatetime: nextMeetDatetime,
                }),
                ...(d.direction !== undefined && {
                  direction: d.direction as RideDirection,
                }),
                ...(d.location !== undefined && {
                  location: d.location as string,
                  // A new meeting point invalidates the pin resolved from the
                  // old one — the same reasoning `updateTrip` states above.
                  // Left in place, the directions button sends the driver to
                  // the station the ride no longer meets at, on every device.
                  coordinates: undefined,
                }),
                ...(d.leadTimeMinutes !== undefined && {
                  leadTimeMinutes: d.leadTimeMinutes as number,
                }),
                ...(nextDriverId !== undefined && { driverId: nextDriverId }),
                ...(nextVehicleId !== undefined && { vehicleId: nextVehicleId }),
                ...(d.notes !== undefined && { notes: d.notes as string }),
              };

              // `coordinates` rides along with `location` rather than being
              // asked for, so it is not something the user changed.
              const rideFields = Object.keys(ridePatch).filter(
                (key) => key !== 'coordinates',
              );
              if (rideFields.length === 0) {
                break;
              }

              // Validated as a whole record, so a patch can never leave the
              // ride in a state the form itself would reject.
              const mergedRide = {
                ...toRideFormData(existingRide),
                ...ridePatch,
              };
              const mergedRideValidation =
                RideFormDataSchema.safeParse(mergedRide);
              if (!mergedRideValidation.success) {
                console.warn(
                  '[AI Assistant] Rejected updateRide:',
                  mergedRideValidation.error.issues,
                );
                toast.error(t('assistant.invalidRide'));
                break;
              }

              await updateRideWithOwnershipCheck(rideId, tid, ridePatch);
              successToast(t('rides.updateSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.updateRide', {
                  location: mergedRide.location,
                  fields: rideFields.join(', '),
                  defaultValue: 'Updated ride to {{location}} ({{fields}})',
                }),
              );
              break;
            }

            case 'removeRide': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const rideId = action.data.rideId as RideId;
              const ride = await getRideById(rideId);
              if (!ride || ride.tripId !== tid) {
                toast.error(t('assistant.rideNotFound'));
                break;
              }
              // The repository detaches the legs rather than deleting them, so
              // cancelling the car does not cancel anybody's train — and the
              // summary says so, because "removed the ride" alone reads as
              // having removed the people in it.
              await deleteRideWithOwnershipCheck(rideId, tid);
              successToast(t('rides.deleteSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.removeRide', {
                  direction: t(`rides.directions.${ride.direction}`),
                  location: ride.location,
                  defaultValue:
                    'Cancelled {{direction}} ride — {{location}} (its passengers need a lift again)',
                }),
              );
              break;
            }

            case 'addVehicle': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;
              const ownerId = await tripPersonId(d.ownerId, tid);
              if (d.ownerId !== undefined && ownerId === undefined) {
                toast.error(t('assistant.guestNotFound'));
              }
              const childSeats = keepKnownChildSeats(d.childSeats);

              const vehicleData: VehicleFormData = {
                name: d.name as string,
                ...(ownerId !== undefined && { ownerId }),
                ...(d.isRental !== undefined && {
                  isRental: d.isRental as boolean,
                }),
                ...(d.seatCount !== undefined && {
                  seatCount: d.seatCount as number,
                }),
                ...(childSeats.length > 0 && { childSeats }),
                ...(d.luggageNotes !== undefined && {
                  luggageNotes: d.luggageNotes as string,
                }),
                ...(d.notes !== undefined && { notes: d.notes as string }),
              };

              const vehicleValidation =
                VehicleFormDataSchema.safeParse(vehicleData);
              if (!vehicleValidation.success) {
                console.warn(
                  '[AI Assistant] Rejected addVehicle:',
                  vehicleValidation.error.issues,
                );
                toast.error(t('assistant.invalidVehicle'));
                break;
              }

              await createVehicle(tid, vehicleData);
              successToast(t('vehicles.createSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.addVehicle', {
                  name: vehicleData.name,
                  defaultValue: 'Added car: {{name}}',
                }),
              );
              break;
            }

            case 'removeVehicle': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const vehicleId = action.data.vehicleId as VehicleId;
              const vehicle = await getVehicleById(vehicleId);
              if (!vehicle || vehicle.tripId !== tid) {
                toast.error(t('assistant.vehicleNotFound'));
                break;
              }
              // The repository clears `rides.vehicleId` and leaves the journeys
              // standing — three people still have a train to meet — so the
              // summary says which half went.
              await deleteVehicleWithOwnershipCheck(vehicleId, tid);
              successToast(t('vehicles.deleteSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.removeVehicle', {
                  name: vehicle.name,
                  defaultValue:
                    'Removed car: {{name}} (its rides keep their times)',
                }),
              );
              break;
            }

            case 'joinRide':
            case 'leaveRide': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const joiningRide = action.action === 'joinRide';
              const legId = action.data.transportId as TransportId;

              const leg = await getTransportById(legId);
              if (!leg || leg.tripId !== tid) {
                toast.error(t('assistant.transportNotFound'));
                break;
              }

              let targetRide: Ride | undefined;
              if (joiningRide) {
                targetRide = await getRideById(action.data.rideId as RideId);
                if (!targetRide || targetRide.tripId !== tid) {
                  toast.error(t('assistant.rideNotFound'));
                  break;
                }
              }

              // "Nothing to do" is not simply `rideId` already matching. A leg
              // from before rides existed carries its own `driverId`, and the
              // prompt shows it as a leg somebody is driving, so "take Alice
              // out of Bob's car" is a real request against a leg with no
              // `rideId` — `setTransportRide` clears that legacy driver, which
              // is the only way the catalogue has of undoing one.
              const alreadySettled =
                leg.rideId === targetRide?.id &&
                (joiningRide || leg.driverId === undefined);
              if (alreadySettled) {
                // Do not report a change that did not happen.
                break;
              }

              // The whole of "join this car" is a scalar write on the
              // passenger's own leg, which is what makes two guests joining the
              // same car offline both survive the merge.
              const legPerson = await getPersonById(leg.personId);
              await setTransportRide(legId, tid, targetRide?.id);
              successToast(
                t(joiningRide ? 'rides.passengerAdded' : 'rides.passengerRemoved'),
              );
              executedCount++;
              summaries.push(
                t(
                  joiningRide
                    ? 'assistant.actionDetails.joinRide'
                    : 'assistant.actionDetails.leaveRide',
                  {
                    person: legPerson?.name ?? String(leg.personId),
                    location: targetRide?.location ?? leg.location,
                    defaultValue: joiningRide
                      ? '{{person}} rides to {{location}}'
                      : '{{person}} left the car for {{location}}',
                  },
                ),
              );
              break;
            }

            case 'addActivity': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;
              const knownGuestIds = await guestIdsFor(tid);
              const allDay = (d.allDay as boolean | undefined) ?? false;

              const startDatetime = activityInstant(
                d.startDatetime,
                allDay,
                'start',
              );
              if (!startDatetime) {
                toast.error(t('assistant.invalidActivity'));
                break;
              }
              // All-day spans need a real end instant, or they read as "over"
              // at midnight; default it to the end of the starting day.
              const endDatetime =
                activityInstant(d.endDatetime, allDay, 'end') ??
                (allDay ? activityInstant(d.startDatetime, true, 'end') : undefined);

              const formData: ActivityFormData = {
                title: d.title as string,
                category: d.category as ActivityCategory,
                startDatetime,
                allDay,
                participantIds: keepKnownGuestIds(
                  d.participantIds,
                  knownGuestIds,
                ),
                ...(endDatetime !== undefined && { endDatetime }),
                ...(d.location !== undefined && {
                  location: d.location as string,
                }),
                ...(d.organizerId !== undefined &&
                  knownGuestIds.has(d.organizerId as PersonId) && {
                    organizerId: d.organizerId as PersonId,
                  }),
                ...(d.maxParticipants !== undefined && {
                  maxParticipants: d.maxParticipants as number,
                }),
                ...(d.notes !== undefined && { notes: d.notes as string }),
              };

              const validation = ActivityFormDataSchema.safeParse(formData);
              if (!validation.success) {
                console.warn(
                  '[AI Assistant] Rejected addActivity:',
                  validation.error.issues,
                );
                toast.error(t('assistant.invalidActivity'));
                break;
              }

              await createActivity(tid, formData);
              successToast(t('activities.createSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.addActivity', {
                  title: formData.title,
                  defaultValue: 'Added activity: {{title}}',
                }),
              );
              break;
            }

            case 'updateActivity': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;
              const aid = d.activityId as ActivityId;
              const existing = await getActivityById(aid);
              if (!existing || existing.tripId !== tid) {
                toast.error(t('assistant.activityNotFound'));
                break;
              }

              const knownGuestIds = await guestIdsFor(tid);

              // Datetimes are re-derived through the merged all-day flag, so
              // toggling all-day re-snaps the instants even when the caller
              // sent no new dates.
              const mergedAllDay =
                (d.allDay as boolean | undefined) ?? existing.allDay;
              const allDayChanged =
                d.allDay !== undefined && d.allDay !== existing.allDay;
              const wantsStart = d.startDatetime !== undefined || allDayChanged;
              const wantsEnd =
                d.endDatetime !== undefined ||
                (allDayChanged && existing.endDatetime !== undefined);

              const nextStart = wantsStart
                ? activityInstant(
                    d.startDatetime ?? existing.startDatetime,
                    mergedAllDay,
                    'start',
                  )
                : undefined;
              if (wantsStart && !nextStart) {
                toast.error(t('assistant.invalidActivity'));
                break;
              }
              const nextEnd = wantsEnd
                ? activityInstant(
                    d.endDatetime ?? existing.endDatetime,
                    mergedAllDay,
                    'end',
                  )
                : undefined;

              const patch: Partial<ActivityFormData> = {
                ...(d.title !== undefined && { title: d.title as string }),
                ...(d.category !== undefined && {
                  category: d.category as ActivityCategory,
                }),
                ...(nextStart !== undefined && { startDatetime: nextStart }),
                ...(nextEnd !== undefined && { endDatetime: nextEnd }),
                ...(d.allDay !== undefined && {
                  allDay: d.allDay as boolean,
                }),
                ...(d.location !== undefined && {
                  location: d.location as string,
                }),
                ...(d.organizerId !== undefined &&
                  knownGuestIds.has(d.organizerId as PersonId) && {
                    organizerId: d.organizerId as PersonId,
                  }),
                ...(d.maxParticipants !== undefined && {
                  maxParticipants: d.maxParticipants as number,
                }),
                ...(d.notes !== undefined && { notes: d.notes as string }),
              };

              const changedFields = Object.keys(patch);
              if (changedFields.length === 0) {
                break;
              }

              // Validate the merged record so a patch can never leave the
              // activity in a state the form itself would reject.
              const merged = { ...toActivityFormData(existing), ...patch };
              const mergedValidation = ActivityFormDataSchema.safeParse(merged);
              if (!mergedValidation.success) {
                console.warn(
                  '[AI Assistant] Rejected updateActivity:',
                  mergedValidation.error.issues,
                );
                toast.error(t('assistant.invalidActivity'));
                break;
              }

              await updateActivityWithOwnershipCheck(aid, tid, patch);
              successToast(t('activities.updateSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.updateActivity', {
                  title: merged.title,
                  fields: changedFields.join(', '),
                  defaultValue: 'Updated activity {{title}} ({{fields}})',
                }),
              );
              break;
            }

            case 'removeActivity': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const aid = action.data.activityId as ActivityId;
              const activity = await getActivityById(aid);
              if (!activity || activity.tripId !== tid) {
                toast.error(t('assistant.activityNotFound'));
                break;
              }
              await deleteActivityWithOwnershipCheck(aid, tid);
              successToast(t('activities.deleteSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.removeActivity', {
                  title: activity?.title ?? String(aid),
                  defaultValue: 'Removed activity: {{title}}',
                }),
              );
              break;
            }

            case 'joinActivity':
            case 'leaveActivity': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const joining = action.action === 'joinActivity';
              const aid = action.data.activityId as ActivityId;
              const pid = action.data.personId as PersonId;

              const activity = await getActivityById(aid);
              if (!activity || activity.tripId !== tid) {
                toast.error(t('assistant.activityNotFound'));
                break;
              }

              // The repository only checks the activity's trip, so an id the
              // model invented would otherwise be written as a participant.
              const person = await getPersonById(pid);
              if (!person || person.tripId !== tid) {
                toast.error(t('assistant.guestNotFound'));
                break;
              }

              const before = activity.participantIds ?? [];
              const after = await setActivityParticipation(
                aid,
                tid,
                pid,
                joining,
              );
              if (after.length === before.length) {
                // Already in that state — do not report a change that did not happen.
                break;
              }

              successToast(t('activities.participationUpdated'));
              executedCount++;
              summaries.push(
                t(
                  joining
                    ? 'assistant.actionDetails.joinActivity'
                    : 'assistant.actionDetails.leaveActivity',
                  {
                    person: person?.name ?? String(pid),
                    title: activity?.title ?? String(aid),
                    defaultValue: joining
                      ? '{{person}} joined {{title}}'
                      : '{{person}} left {{title}}',
                  },
                ),
              );
              break;
            }

            default:
              console.warn('[AI Assistant] Unknown action:', action);
          }
        } catch (err) {
          console.error('[AI Assistant] Failed to execute action:', action, err);
          toast.error(
            `Failed to execute action: ${err instanceof Error ? err.message : 'Unknown error'}`,
          );
        }
      }

      return { count: executedCount, summaries };
    },
    [currentTrip, successToast, t],
  );

  return { executeActions };
}
