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
import { useTranslation } from 'react-i18next';

import { format, isValid, parseISO } from 'date-fns';

import {
  getActivityEndDayKey,
  getActivityStartDayKey,
} from '@/features/activities/utils/activity-utils';

import { useGuestGroups } from '@/features/guest-groups/hooks/useGuestGroups';

import { useToday } from '@/hooks/useToday';

import { useActivityContext } from '@/contexts/ActivityContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';

import { toLocalISODateString } from '@/lib/db/utils';
import { formatCoordinates, hasValidCoordinates } from '@/lib/geocoding';
import { DEFAULT_LANGUAGE } from '@/lib/i18n';

import {
  getPersonHeadcount,
  type Activity,
  type Language,
  type Person,
} from '@/types';

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

/**
 * How each supported UI language is named to the model.
 *
 * The app runs in French for most users (`DEFAULT_LANGUAGE`) while this prompt
 * is written in English, and a model answers in the language it was instructed
 * in unless it is told otherwise — "Salut, que penses-tu de …" came back in
 * English. Naming the language outright is what a 1–4B model follows; "reply in
 * the user's language" leaves it to infer one, which is exactly what it got
 * wrong.
 */
const PROMPT_LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  fr: 'French',
};

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * The opening lines shared by both prompts — with and without a selected trip.
 *
 * They set the register rather than the data. Everything after them is trip
 * records and a catalogue of sixteen actions, and a small model reading that
 * much machinery treats *every* message as a job to run: asked an off-topic
 * question in French, it opened with "Okay, let's tackle this trip planning
 * request!" and invented a trip, a guest and an id ("I'll assume it's
 * trip123") that nobody had mentioned. Saying it is a chat partner too, and
 * that it must not narrate actions, is what keeps a greeting a greeting.
 *
 * These say nothing `generateActionPrompt()` already says: the whole prompt is
 * re-tokenised every turn, so a duplicated rule is paid for on every answer
 * (AGENTS.md — "Say it once, and say it short").
 *
 * @param languageName - Language to answer in, named in English for the model
 * @returns The opening prompt lines
 */
function buildOpeningLines(languageName: string): string[] {
  return [
    'You are a helpful trip planning assistant for the Kikouchou app — and an ordinary chat partner for anything else.',
    `Reply in ${languageName}, unless the user writes in another language.`,
    'Keep answers short — a sentence or two unless asked for more.',
    // Where the block goes is `generateActionPrompt()`'s business; this line
    // only forbids the running commentary that stood in for it.
    'Do not narrate a plan or restate an action as prose.',
  ];
}

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
 * Builds the guest line, including headcount, phone, notes and child seat so
 * the assistant can answer catering, accessibility, "who do I call" and "whose
 * car has to carry a booster" questions.
 */
function formatGuestLine(person: Person): string {
  // A guest with no dates of their own is here for the whole trip, the way the
  // rest of the app reads them — saying nothing let the model answer that it
  // did not know when they were around.
  const stay =
    person.stayStartDate && person.stayEndDate
      ? ` (stay: ${person.stayStartDate} to ${person.stayEndDate})`
      : ' (stay: whole trip)';
  const headcount = getPersonHeadcount(person);
  const headcountLabel = headcount > 1 ? ` — counts as ${headcount} people` : '';
  const phone = person.phone ? ` — phone: ${toPromptText(person.phone)}` : '';
  const notes = person.notes
    ? ` — notes: ${toPromptText(person.notes)}`
    : '';
  // Costs nothing on the roster it is absent from, which is most of them.
  const childSeat = person.childSeat ? ` — child seat: ${person.childSeat}` : '';

  return `- "${toPromptText(person.name)}" (id: ${person.id})${stay}${headcountLabel}${phone}${notes}${childSeat}`;
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
  const { groups: guestGroups } = useGuestGroups();
  const { today } = useToday();
  const { i18n } = useTranslation();

  const todayIso = useMemo(() => toLocalISODateString(today), [today]);

  // Read through react-i18next rather than `getCurrentLanguage()` so switching
  // the app's language rebuilds the prompt instead of leaving the assistant
  // answering in the previous one. The tag can carry a region ("en-US").
  const languageName = useMemo((): string => {
    const base = i18n.language?.split('-')[0] ?? '';
    return (
      PROMPT_LANGUAGE_NAMES[base as Language] ??
      PROMPT_LANGUAGE_NAMES[DEFAULT_LANGUAGE]
    );
  }, [i18n.language]);

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
        ...buildOpeningLines(languageName),
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

    // The createTrip / updateTrip / selectTrip rules used to be restated here
    // as well as in the action prompt. Saying them once is not just tidier: the
    // whole prompt is re-tokenised every turn and prefill memory grows with it,
    // so duplicated instructions are paid for on every single answer.
    const parts: string[] = [
      ...buildOpeningLines(languageName),
      'The current trip is below — its guests, rooms, room assignments, transports and shared activity agenda. Answer from that data directly; never say you lack access to it.',
      todayLine,
      '',
      '## Current trip (selected)',
      `- Name: ${toPromptText(currentTrip.name)}`,
      `- Location: ${currentTrip.location ? toPromptText(currentTrip.location) : 'Not set'}`,
      // The pin is dropped by an updateTrip on the location, which the
      // updateTrip label in action-schema.ts spells out.
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

    // Guest groups — global, not part of the trip. Listed so the assistant can
    // both answer "who is in the family?" and target a group with
    // importGuestGroup. Members are named because the action takes member ids,
    // and a group is a handful of people rather than a list worth truncating.
    if (guestGroups.length > 0) {
      parts.push('', '## Guest groups (saved rosters, any trip)');
      for (const group of guestGroups) {
        const members = group.members
          .map((member) => `"${toPromptText(member.name)}" (id: ${member.id})`)
          .join(', ');
        parts.push(
          `- "${toPromptText(group.name)}" (id: ${group.id}): ${members || 'nobody yet'}`,
        );
      }
    } else {
      parts.push('', '## Guest groups', 'No saved groups yet.');
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
    guestGroups,
    todayIso,
    languageName,
  ]);

  return {
    systemPrompt,
    hasTripContext: currentTrip !== null,
  };
}
