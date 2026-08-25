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

import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import {
  createActivity,
  createAssignment,
  createPerson,
  createRoom,
  createTransport,
  createTrip,
  deleteActivityWithOwnershipCheck,
  deleteAssignmentWithOwnershipCheck,
  deletePersonWithOwnershipCheck,
  deleteRoomWithOwnershipCheck,
  deleteTransportWithOwnershipCheck,
  getActivityById,
  getAssignmentById,
  getPersonById,
  getRoomById,
  getTransportById,
  getTripById,
  setActivityParticipation,
  setCurrentTrip,
  updateActivityWithOwnershipCheck,
  updateTrip,
} from '@/lib/db';
import { ActivityFormDataSchema } from '@/lib/validation/schemas';
import {
  getDefaultPersonColor,
  type Activity,
  type ActivityCategory,
  type ActivityFormData,
  type ActivityId,
  type ISODateString,
  type ISODateTimeString,
  type PersonId,
  type RoomAssignmentId,
  type RoomId,
  type TransportId,
  type TransportMode,
  type TransportType,
  type TripId,
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
 * Ids of every guest in a trip, used to drop hallucinated person ids before
 * they end up stored on an activity.
 *
 * @param tripId - The trip to read guests from
 * @returns A set of the trip's person ids
 */
async function getTripGuestIds(tripId: TripId): Promise<Set<PersonId>> {
  const guests = await db.persons.where('tripId').equals(tripId).toArray();
  return new Set(guests.map((guest) => guest.id));
}

/**
 * Keeps only the participant ids that belong to the trip.
 *
 * @param raw - The `participantIds` value from the parsed action
 * @param knownGuestIds - Ids of the trip's guests
 * @returns The participant ids that exist in the trip
 */
function keepKnownGuestIds(
  raw: unknown,
  knownGuestIds: Set<PersonId>,
): PersonId[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter(
    (id): id is PersonId =>
      typeof id === 'string' && knownGuestIds.has(id as PersonId),
  );
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

  const executeActions = useCallback(
    async (response: string): Promise<ActionExecutionResult> => {
      const actions = parseActionBlocks(response);

      if (actions.length === 0) {
        return { count: 0, summaries: [] };
      }

      console.log('[AI Assistant] Parsed actions:', actions);

      /** Tracks which trip mutations apply to (supports createTrip/selectTrip mid-batch). */
      let activeTripId: TripId | null = currentTrip?.id ?? null;

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
              toast.success(t('trips.created'));
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
                ...(d.location !== undefined && { location: d.location as string }),
                ...(d.startDate !== undefined && { startDate: d.startDate as ISODateString }),
                ...(d.endDate !== undefined && { endDate: d.endDate as ISODateString }),
                ...(d.description !== undefined && { description: d.description as string }),
              });
              toast.success(t('trips.updated'));
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
                ...(d.notes !== undefined && { notes: d.notes as string }),
              });
              toast.success(t('persons.createSuccess'));
              executedCount++;
              summaries.push(
                t('assistant.actionDetails.addGuest', {
                  name: d.name as string,
                  defaultValue: 'Added guest: {{name}}',
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
              toast.success(t('persons.deleteSuccess'));
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
              toast.success(t('rooms.createSuccess'));
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
              toast.success(t('rooms.deleteSuccess'));
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
              await createAssignment(tid, {
                personId: d.personId as PersonId,
                roomId: d.roomId as RoomId,
                startDate: d.startDate as ISODateString,
                endDate: d.endDate as ISODateString,
              });
              toast.success(t('assignments.createSuccess'));
              executedCount++;
              const person = await getPersonById(d.personId as PersonId);
              const room = await getRoomById(d.roomId as RoomId);
              summaries.push(
                t('assistant.actionDetails.assignRoom', {
                  person: person?.name ?? String(d.personId),
                  room: room?.name ?? String(d.roomId),
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
              toast.success(t('assignments.deleteSuccess'));
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
              await createTransport(tid, {
                personId: d.personId as PersonId,
                type: d.type as TransportType,
                datetime: d.datetime as ISODateTimeString,
                location: d.location as string,
                transportMode: d.transportMode as TransportMode | undefined,
                transportNumber: d.transportNumber as string | undefined,
                needsPickup: (d.needsPickup as boolean | undefined) ?? false,
              });
              toast.success(t('transports.createSuccess'));
              executedCount++;
              const person = await getPersonById(d.personId as PersonId);
              summaries.push(
                t('assistant.actionDetails.addTransport', {
                  type: d.type as string,
                  person: person?.name ?? String(d.personId),
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
              toast.success(t('transports.deleteSuccess'));
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

            case 'addActivity': {
              const tid = activeTripId;
              if (!tid) {
                toast.error(t('assistant.noTripForAction'));
                break;
              }
              const d = action.data as Record<string, unknown>;
              const knownGuestIds = await getTripGuestIds(tid);
              const formData: ActivityFormData = {
                title: d.title as string,
                category: d.category as ActivityCategory,
                startDatetime: d.startDatetime as ISODateTimeString,
                allDay: (d.allDay as boolean | undefined) ?? false,
                participantIds: keepKnownGuestIds(
                  d.participantIds,
                  knownGuestIds,
                ),
                ...(d.endDatetime !== undefined && {
                  endDatetime: d.endDatetime as ISODateTimeString,
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
              toast.success(t('activities.createSuccess'));
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

              const knownGuestIds = await getTripGuestIds(tid);
              const patch: Partial<ActivityFormData> = {
                ...(d.title !== undefined && { title: d.title as string }),
                ...(d.category !== undefined && {
                  category: d.category as ActivityCategory,
                }),
                ...(d.startDatetime !== undefined && {
                  startDatetime: d.startDatetime as ISODateTimeString,
                }),
                ...(d.endDatetime !== undefined && {
                  endDatetime: d.endDatetime as ISODateTimeString,
                }),
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
              toast.success(t('activities.updateSuccess'));
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
              await deleteActivityWithOwnershipCheck(aid, tid);
              toast.success(t('activities.deleteSuccess'));
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
              const person = await getPersonById(pid);
              await setActivityParticipation(aid, tid, pid, joining);
              toast.success(t('activities.participationUpdated'));
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
    [currentTrip, t],
  );

  return { executeActions };
}
