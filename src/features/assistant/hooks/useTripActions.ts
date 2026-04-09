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

import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';
import { updateTrip } from '@/lib/db';
import {
  getDefaultPersonColor,
  type ISODateString,
  type ISODateTimeString,
  type PersonId,
  type RoomAssignmentId,
  type RoomId,
  type TransportId,
  type TransportMode,
  type TransportType,
} from '@/types';

import { type LLMAction, validateAction } from '../action-schema';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Return type for the useTripActions hook.
 */
export interface UseTripActionsReturn {
  /** Parse an LLM response and execute any action blocks found. */
  executeActions: (response: string) => Promise<number>;
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
  const { createRoom, deleteRoom } = useRoomContext();
  const { persons, createPerson, deletePerson } = usePersonContext();
  const { createAssignment, deleteAssignment } = useAssignmentContext();
  const { createTransport, deleteTransport } = useTransportContext();

  const executeActions = useCallback(
    async (response: string): Promise<number> => {
      const actions = parseActionBlocks(response);

      if (actions.length === 0) {
        return 0;
      }

      console.log('[AI Assistant] Parsed actions:', actions);

      let executedCount = 0;

      for (const action of actions) {
        try {
          switch (action.action) {
            case 'updateTrip': {
              if (!currentTrip) break;
              const d = action.data;
              await updateTrip(currentTrip.id, {
                ...(d.name !== undefined && { name: d.name as string }),
                ...(d.location !== undefined && { location: d.location as string }),
                ...(d.startDate !== undefined && { startDate: d.startDate as ISODateString }),
                ...(d.endDate !== undefined && { endDate: d.endDate as ISODateString }),
                ...(d.description !== undefined && { description: d.description as string }),
              });
              toast.success(t('trips.updated'));
              executedCount++;
              break;
            }

            case 'addGuest': {
              const d = action.data;
              const colorIndex = persons.length;
              await createPerson({
                name: d.name as string,
                color: getDefaultPersonColor(colorIndex),
                ...(d.stayStartDate !== undefined && {
                  stayStartDate: d.stayStartDate as ISODateString,
                }),
                ...(d.stayEndDate !== undefined && {
                  stayEndDate: d.stayEndDate as ISODateString,
                }),
              });
              toast.success(t('persons.createSuccess'));
              executedCount++;
              break;
            }

            case 'removeGuest': {
              await deletePerson(action.data.personId as PersonId);
              toast.success(t('persons.deleteSuccess'));
              executedCount++;
              break;
            }

            case 'addRoom': {
              const d = action.data;
              await createRoom({
                name: d.name as string,
                capacity: d.capacity as number,
                description: d.description as string | undefined,
              });
              toast.success(t('rooms.createSuccess'));
              executedCount++;
              break;
            }

            case 'removeRoom': {
              await deleteRoom(action.data.roomId as RoomId);
              toast.success(t('rooms.deleteSuccess'));
              executedCount++;
              break;
            }

            case 'assignRoom': {
              const d = action.data;
              await createAssignment({
                personId: d.personId as PersonId,
                roomId: d.roomId as RoomId,
                startDate: d.startDate as ISODateString,
                endDate: d.endDate as ISODateString,
              });
              toast.success(t('assignments.createSuccess'));
              executedCount++;
              break;
            }

            case 'removeAssignment': {
              await deleteAssignment(
                action.data.assignmentId as RoomAssignmentId,
              );
              toast.success(t('assignments.deleteSuccess'));
              executedCount++;
              break;
            }

            case 'addTransport': {
              const d = action.data;
              await createTransport({
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
              break;
            }

            case 'removeTransport': {
              await deleteTransport(action.data.transportId as TransportId);
              toast.success(t('transports.deleteSuccess'));
              executedCount++;
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

      return executedCount;
    },
    [
      currentTrip,
      persons,
      t,
      createRoom,
      deleteRoom,
      createPerson,
      deletePerson,
      createAssignment,
      deleteAssignment,
      createTransport,
      deleteTransport,
    ],
  );

  return { executeActions };
}
