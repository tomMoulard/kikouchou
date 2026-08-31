/**
 * @fileoverview Builds a structured system prompt from trip context data.
 * Serializes trip, guests, rooms, assignments, transports and the shared
 * activity agenda into a text representation that the LLM can understand
 * and reason about.
 *
 * Every user-facing trip feature must be represented here, otherwise the
 * assistant answers "I don't have access to that" — see AGENTS.md
 * ("AI Assistant — Keep It In Sync").
 *
 * Trip records sync between guests, so every free-text field interpolated here
 * is untrusted input: pass it through {@link toPromptText} so it cannot forge
 * prompt structure.
 *
 * @module features/assistant/hooks/useTripSystemPrompt
 */

import { useMemo } from 'react';

import { format, isValid, parseISO } from 'date-fns';

import {
  getActivityEndDayKey,
  getActivityStartDayKey,
} from '@/features/activities/utils/activity-utils';

import { useToday } from '@/hooks/useToday';

import { useActivityContext } from '@/contexts/ActivityContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';

import { toLocalISODateString } from '@/lib/db/utils';
import { formatCoordinates, hasValidCoordinates } from '@/lib/geocoding';

import { getPersonHeadcount, type Activity, type Person } from '@/types';

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
// Constants
// ============================================================================

/** Longest free-text value copied into a single prompt line. */
const MAX_PROMPT_FIELD_LENGTH = 200;

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Makes a user-authored string safe to interpolate into the prompt.
 *
 * Trip data is synced between guests, so titles, locations and notes are not
 * necessarily written by the person chatting with the assistant. Collapsing
 * whitespace keeps one record on one line — a newline would let a note forge a
 * `## Section` heading or an action block in a prompt whose replies get
 * executed — and the length cap stops one record flooding the context.
 *
 * @param value - The raw, user-authored value
 * @returns A single-line, length-capped rendering
 */
function toPromptText(value: string): string {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  return collapsed.length > MAX_PROMPT_FIELD_LENGTH
    ? `${collapsed.slice(0, MAX_PROMPT_FIELD_LENGTH)}…`
    : collapsed;
}

/**
 * Local clock time (HH:MM) of an ISO datetime, or undefined when unparseable.
 *
 * Uses `parseISO` so a date-only record resolves to the same instant the day
 * keys are derived from; `new Date()` would read it as UTC midnight instead.
 */
function formatLocalTime(datetime: string): string | undefined {
  const date = parseISO(datetime);
  return isValid(date) ? format(date, 'HH:mm') : undefined;
}

/**
 * Human-readable "when" for an activity, using local calendar days so it
 * matches what the user sees on the calendar and timeline.
 *
 * @param activity - The activity to describe
 * @returns A phrase such as `2026-04-20 09:00–12:00` or `all day 2026-04-20 → 2026-04-22`
 */
function formatActivityWhen(activity: Activity): string {
  const startDay = getActivityStartDayKey(activity) ?? activity.startDatetime;
  const endDay = getActivityEndDayKey(activity) ?? startDay;
  const isMultiDay = endDay !== startDay;

  if (activity.allDay) {
    return isMultiDay
      ? `all day ${startDay} → ${endDay}`
      : `all day ${startDay}`;
  }

  const startTime = formatLocalTime(activity.startDatetime);
  const endTime = activity.endDatetime
    ? formatLocalTime(activity.endDatetime)
    : undefined;

  if (isMultiDay) {
    return `${startDay}${startTime ? ` ${startTime}` : ''} → ${endDay}${endTime ? ` ${endTime}` : ''}`;
  }

  if (startTime && endTime) {
    return `${startDay} ${startTime}–${endTime}`;
  }

  return startTime ? `${startDay} ${startTime}` : startDay;
}

/**
 * Builds the agenda line for a single activity, including everything the LLM
 * needs to both answer questions and target it with an action.
 *
 * @param activity - The activity to serialize
 * @param persons - All guests of the trip, used to resolve names
 * @param todayIso - Local "today" (YYYY-MM-DD) used to tag current activities
 * @returns A single prompt line
 */
function formatActivityLine(
  activity: Activity,
  persons: readonly Person[],
  todayIso: string,
): string {
  const startDay = getActivityStartDayKey(activity);
  const endDay = getActivityEndDayKey(activity) ?? startDay;
  const isToday =
    startDay !== undefined &&
    endDay !== undefined &&
    startDay <= todayIso &&
    endDay >= todayIso;

  const nameOf = (personId: string): string => {
    const person = persons.find((candidate) => candidate.id === personId);
    return person ? toPromptText(person.name) : 'Unknown';
  };

  const participants = activity.participantIds ?? [];
  const cap =
    activity.maxParticipants !== undefined
      ? `/${activity.maxParticipants}`
      : '';

  const segments = [
    `- "${toPromptText(activity.title)}" (id: ${activity.id})`,
    activity.category,
    formatActivityWhen(activity),
    isToday ? 'TODAY' : '',
    activity.location ? `at ${toPromptText(activity.location)}` : '',
    activity.organizerId
      ? `organizer: ${nameOf(activity.organizerId)}`
      : '',
    participants.length > 0
      ? `signed up (${participants.length}${cap}): ${participants.map(nameOf).join(', ')}`
      : `signed up (0${cap}): nobody yet`,
    activity.notes ? `notes: ${toPromptText(activity.notes)}` : '',
  ].filter(Boolean);

  return segments.join(' — ');
}

/**
 * Builds the guest line, including headcount and notes so the assistant can
 * answer catering and accessibility questions.
 */
function formatGuestLine(person: Person): string {
  const stay =
    person.stayStartDate && person.stayEndDate
      ? ` (stay: ${person.stayStartDate} to ${person.stayEndDate})`
      : '';
  const headcount = getPersonHeadcount(person);
  const headcountLabel = headcount > 1 ? ` — counts as ${headcount} people` : '';
  const notes = person.notes
    ? ` — notes: ${toPromptText(person.notes)}`
    : '';

  return `- "${toPromptText(person.name)}" (id: ${person.id})${stay}${headcountLabel}${notes}`;
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
  const { activities } = useActivityContext();
  const { today } = useToday();

  const todayIso = useMemo(() => toLocalISODateString(today), [today]);

  const systemPrompt = useMemo((): string => {
    const todayLine = `Today's date is ${todayIso}. Resolve any relative date the user mentions ("today", "tonight", "tomorrow", "this weekend") against it.`;

    const tripsListLines =
      trips.length > 0
        ? [
            '',
            '## All trips (use trip id with the selectTrip action)',
            ...trips.map(
              (trip) =>
                `- "${toPromptText(trip.name)}" — id: \`${trip.id}\` — ${trip.startDate} to ${trip.endDate}${trip.location ? ` — ${toPromptText(trip.location)}` : ''}`,
            ),
          ]
        : [];

    if (!currentTrip) {
      return [
        'You are a helpful trip planning assistant for the Kikoushou app.',
        todayLine,
        trips.length > 0
          ? 'No trip is currently selected, but other trips exist — see below.'
          : 'No trip is currently selected.',
        ...tripsListLines,
        '',
        'Use **createTrip** to create a new trip (the app will select it automatically), or **selectTrip** with a trip id from the list above to work on an existing trip.',
        ...generateActionPrompt(),
      ].join('\n');
    }

    const parts: string[] = [
      'You are a helpful trip planning assistant for the Kikoushou app.',
      'You have access to the current trip data below: its guests, rooms, room assignments, transports and the shared activity agenda.',
      'Answer questions about that data directly — never say you lack access to it.',
      'When the user asks to modify trip data, output a JSON action block that the app will execute.',
      todayLine,
      '',
      '### Creating a new trip vs editing this one',
      '- Use **createTrip** when the user wants a **new** trip (a separate row in their trip list).',
      '- Use **updateTrip** only to change fields on the **current** trip shown below (rename, dates, location, …). **updateTrip does not create a new trip.**',
      '- The map pin is set by picking a place in the trip form, not by you. Changing the location with **updateTrip** clears the pin, so the user has to pick the new place on the map again.',
      '- Use **selectTrip** with a trip id from "All trips" to switch which trip is active before other actions.',
      '',
      '## Current trip (selected)',
      `- Name: ${toPromptText(currentTrip.name)}`,
      `- Location: ${currentTrip.location ? toPromptText(currentTrip.location) : 'Not set'}`,
      `- Map pin: ${hasValidCoordinates(currentTrip.coordinates) ? formatCoordinates(currentTrip.coordinates) : 'Not pinned on the map'}`,
      `- Dates: ${currentTrip.startDate} to ${currentTrip.endDate}`,
      // Sharing is now visible in the UI (the sync badge), so the assistant has
      // to be able to answer "is this trip shared?" — per the AGENTS.md rule that
      // a feature missing from this prompt makes the assistant claim it has no
      // access to something sitting right there.
      currentTrip.remoteTripId
        ? '- Sharing: shared — everyone invited sees changes as they happen'
        : '- Sharing: private to this device — nobody else can see it until it is shared',
      ...(currentTrip.description
        ? [`- Description: ${toPromptText(currentTrip.description)}`]
        : []),
      ...tripsListLines,
    ];

    // Rooms
    if (rooms.length > 0) {
      parts.push('', '## Rooms');
      for (const room of rooms) {
        parts.push(
          `- "${toPromptText(room.name)}" (id: ${room.id}): ${room.capacity} bed(s)${room.description ? ` — ${toPromptText(room.description)}` : ''}`,
        );
      }
    } else {
      parts.push('', '## Rooms', 'No rooms configured yet.');
    }

    // Guests
    if (persons.length > 0) {
      const totalHeadcount = persons.reduce(
        (total, person) => total + getPersonHeadcount(person),
        0,
      );
      const entryLabel = persons.length === 1 ? 'entry' : 'entries';
      const peopleLabel = totalHeadcount === 1 ? 'person' : 'people';
      parts.push(
        '',
        `## Guests (${persons.length} ${entryLabel}, ${totalHeadcount} ${peopleLabel})`,
      );
      for (const person of persons) {
        parts.push(formatGuestLine(person));
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
          `- ${person ? toPromptText(person.name) : 'Unknown'} → ${room ? toPromptText(room.name) : 'Unknown'} (${assignment.startDate} to ${assignment.endDate})`,
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
        const driver = transport.driverId
          ? persons.find((p) => p.id === transport.driverId)
          : undefined;
        parts.push(
          `- ${person ? toPromptText(person.name) : 'Unknown'}: ${transport.type} at ${toPromptText(transport.location)} on ${transport.datetime}${transport.transportMode ? ` (${transport.transportMode})` : ''}${transport.transportNumber ? ` #${toPromptText(transport.transportNumber)}` : ''}${transport.needsPickup ? ' — needs pickup' : ''}${driver ? ` — driver: ${toPromptText(driver.name)}` : ''}${transport.notes ? ` — notes: ${toPromptText(transport.notes)}` : ''}`,
        );
      }
    } else {
      parts.push('', '## Transports', 'No transport plans yet.');
    }

    // Activities (shared agenda)
    if (activities.length > 0) {
      parts.push(
        '',
        '## Activities (shared agenda, sorted by start, dates are local calendar days)',
        'Activities happening on today\'s date are tagged with "TODAY".',
      );
      for (const activity of activities) {
        parts.push(formatActivityLine(activity, persons, todayIso));
      }
    } else {
      parts.push(
        '',
        '## Activities (shared agenda)',
        'No activities planned yet.',
      );
    }

    // Modification action instructions — generated from the shared schema
    parts.push(...generateActionPrompt());

    return parts.join('\n');
  }, [
    currentTrip,
    trips,
    rooms,
    persons,
    assignments,
    transports,
    activities,
    todayIso,
  ]);

  return {
    systemPrompt,
    hasTripContext: currentTrip !== null,
  };
}
