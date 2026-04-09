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
  const { currentTrip, trips } = useTripContext();
  const { rooms } = useRoomContext();
  const { persons } = usePersonContext();
  const { assignments } = useAssignmentContext();
  const { transports } = useTransportContext();

  const systemPrompt = useMemo((): string => {
    const tripsListLines =
      trips.length > 0
        ? [
            '',
            '## All trips (use trip id with the selectTrip action)',
            ...trips.map(
              (trip) =>
                `- "${trip.name}" — id: \`${trip.id}\` — ${trip.startDate} to ${trip.endDate}${trip.location ? ` — ${trip.location}` : ''}`,
            ),
          ]
        : [];

    if (!currentTrip) {
      return [
        'You are a helpful trip planning assistant for the Kikoushou app.',
        trips.length > 0
          ? 'No trip is currently selected, but other trips exist — see below.'
          : 'No trip is currently selected.',
        ...tripsListLines,
        '',
        'Use **createTrip** to create a new trip (the app will select it automatically), or **selectTrip** with a trip id from the list above to work on an existing trip.',
        ...generateActionPrompt(),
      ]
        .filter(Boolean)
        .join('\n');
    }

    const parts: string[] = [
      'You are a helpful trip planning assistant for the Kikoushou app.',
      'You have access to the current trip data and can help the user manage it.',
      'When the user asks to modify trip data, output a JSON action block that the app will execute.',
      '',
      '### Creating a new trip vs editing this one',
      '- Use **createTrip** when the user wants a **new** trip (a separate row in their trip list).',
      '- Use **updateTrip** only to change fields on the **current** trip shown below (rename, dates, location, …). **updateTrip does not create a new trip.**',
      '- Use **selectTrip** with a trip id from "All trips" to switch which trip is active before other actions.',
      '',
      '## Current trip (selected)',
      `- Name: ${currentTrip.name}`,
      `- Location: ${currentTrip.location ?? 'Not set'}`,
      `- Dates: ${currentTrip.startDate} to ${currentTrip.endDate}`,
      currentTrip.description
        ? `- Description: ${currentTrip.description}`
        : '',
      ...tripsListLines,
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
  }, [currentTrip, trips, rooms, persons, assignments, transports]);

  return {
    systemPrompt,
    hasTripContext: currentTrip !== null,
  };
}
