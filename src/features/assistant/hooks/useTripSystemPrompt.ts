/**
 * @fileoverview Builds a structured system prompt from trip context data.
 * Serializes trip, guests, rooms, assignments, and transports into a
 * text representation that the LLM can understand and reason about.
 *
 * @module features/assistant/hooks/useTripSystemPrompt
 */

import { useMemo } from 'react';

import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';

import { generateActionPrompt } from '../action-schema';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Return type of the useTripSystemPrompt hook.
 */
export interface UseTripSystemPromptReturn {
  /** The complete system prompt incorporating trip context */
  readonly systemPrompt: string;
  /** Whether we have a trip loaded to provide context */
  readonly hasTripContext: boolean;
}

// ============================================================================
// Hook Implementation
// ============================================================================

/**
 * Builds a system prompt from the current trip's data so the LLM can
 * answer questions and suggest modifications to trip attributes.
 *
 * @returns The system prompt and whether trip context is available
 */
export function useTripSystemPrompt(): UseTripSystemPromptReturn {
  const { currentTrip } = useTripContext();
  const { rooms } = useRoomContext();
  const { persons } = usePersonContext();
  const { assignments } = useAssignmentContext();
  const { transports } = useTransportContext();

  const systemPrompt = useMemo((): string => {
    if (!currentTrip) {
      return (
        'You are a helpful trip planning assistant for the Kikoushou app. ' +
        'No trip is currently selected. Ask the user to select or create a trip first.'
      );
    }

    const parts: string[] = [
      'You are a helpful trip planning assistant for the Kikoushou app.',
      'You have access to the current trip data and can help the user manage it.',
      'When the user asks to modify trip data, output a JSON action block that the app will execute.',
      '',
      '## Current Trip',
      `- Name: ${currentTrip.name}`,
      `- Location: ${currentTrip.location ?? 'Not set'}`,
      `- Dates: ${currentTrip.startDate} to ${currentTrip.endDate}`,
      currentTrip.description
        ? `- Description: ${currentTrip.description}`
        : '',
    ];

    // Rooms
    if (rooms.length > 0) {
      parts.push('', '## Rooms');
      for (const room of rooms) {
        parts.push(
          `- "${room.name}" (id: ${room.id}): ${room.capacity} bed(s)${room.description ? ` — ${room.description}` : ''}`,
        );
      }
    } else {
      parts.push('', '## Rooms', 'No rooms configured yet.');
    }

    // Guests
    if (persons.length > 0) {
      parts.push('', '## Guests');
      for (const person of persons) {
        const stay =
          person.stayStartDate && person.stayEndDate
            ? ` (stay: ${person.stayStartDate} to ${person.stayEndDate})`
            : '';
        parts.push(`- "${person.name}" (id: ${person.id})${stay}`);
      }
    } else {
      parts.push('', '## Guests', 'No guests added yet.');
    }

    // Room assignments
    if (assignments.length > 0) {
      parts.push('', '## Room Assignments');
      for (const assignment of assignments) {
        const person = persons.find((p) => p.id === assignment.personId);
        const room = rooms.find((r) => r.id === assignment.roomId);
        parts.push(
          `- ${person?.name ?? 'Unknown'} → ${room?.name ?? 'Unknown'} (${assignment.startDate} to ${assignment.endDate})`,
        );
      }
    } else {
      parts.push('', '## Room Assignments', 'No assignments yet.');
    }

    // Transports
    if (transports.length > 0) {
      parts.push('', '## Transports');
      for (const transport of transports) {
        const person = persons.find((p) => p.id === transport.personId);
        parts.push(
          `- ${person?.name ?? 'Unknown'}: ${transport.type} at ${transport.location} on ${transport.datetime}${transport.transportMode ? ` (${transport.transportMode})` : ''}${transport.transportNumber ? ` #${transport.transportNumber}` : ''}`,
        );
      }
    } else {
      parts.push('', '## Transports', 'No transport plans yet.');
    }

    // Modification action instructions — generated from the shared schema
    parts.push(...generateActionPrompt());

    return parts.filter(Boolean).join('\n');
  }, [currentTrip, rooms, persons, assignments, transports]);

  return {
    systemPrompt,
    hasTripContext: currentTrip !== null,
  };
}
