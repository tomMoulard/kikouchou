/**
 * @fileoverview Builds a structured system prompt from trip context data.
 * Serializes trip, guests, rooms, assignments, transports, car journeys, cars
 * and the shared activity agenda into a text representation that the LLM can
 * understand and reason about.
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

import {
  collectDrivenRideIds,
  isLegCovered,
} from '@/features/transports/utils/pickup-utils';

import { useToday } from '@/hooks/useToday';

import { useActivityContext } from '@/contexts/ActivityContext';
import { useAssignmentContext } from '@/contexts/AssignmentContext';
import { usePersonContext } from '@/contexts/PersonContext';
import { useRideContext } from '@/contexts/RideContext';
import { useRoomContext } from '@/contexts/RoomContext';
import { useTransportContext } from '@/contexts/TransportContext';
import { useTripContext } from '@/contexts/TripContext';

import { toLocalISODateString } from '@/lib/db/utils';
import { formatCoordinates, hasValidCoordinates } from '@/lib/geocoding';
import { DEFAULT_LANGUAGE } from '@/lib/i18n';

import {
  DEFAULT_LEAD_TIME_MINUTES,
  getPersonHeadcount,
  type Activity,
  type Language,
  type Person,
  type PersonId,
  type Ride,
  type Transport,
  type Vehicle,
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
 * Local calendar day and clock time of a stored instant.
 *
 * A ride and the legs riding in it are stated in one timezone — the device's —
 * rather than one as a `Z` instant and the other as a local one, which left the
 * model reconciling two spellings of the same moment before it could say
 * whether a train still fits its car.
 *
 * @param datetime - The stored ISO instant
 * @returns `2026-04-20 15:02`, or the raw value when it cannot be parsed
 */
function formatLocalDatetime(datetime: string): string {
  const date = parseISO(datetime);
  return isValid(date)
    ? format(date, 'yyyy-MM-dd HH:mm')
    : toPromptText(datetime);
}

/**
 * Resolves a guest id to the name the prompt prints for it.
 *
 * Shared by every section that names a guest it does not own — an activity's
 * participants, a ride's driver and passengers, a car's owner — because a
 * fourth copy of the same `find` is how the twelve copies of `getDateLocale`
 * AGENTS.md counts got started.
 *
 * @param persons - All guests of the trip
 * @param personId - The id to resolve
 * @returns The guest's prompt-safe name, or `Unknown`
 */
function personNameById(
  persons: ReadonlyMap<string, Person>,
  personId: PersonId | string,
): string {
  const person = persons.get(personId);
  return person ? toPromptText(person.name) : 'Unknown';
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
  persons: ReadonlyMap<string, Person>,
  todayIso: string,
): string {
  const startDay = getActivityStartDayKey(activity);
  const endDay = getActivityEndDayKey(activity) ?? startDay;
  const isToday =
    startDay !== undefined &&
    endDay !== undefined &&
    startDay <= todayIso &&
    endDay >= todayIso;

  const nameOf = (personId: string): string =>
    personNameById(persons, personId);

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
  // Declared by the parent rather than derived from an age nobody stored, so a
  // guest without the field needs no restraint — see `ChildSeatKind`.
  const childSeat = person.childSeat ? ` — child seat: ${person.childSeat}` : '';
  const notes = person.notes
    ? ` — notes: ${toPromptText(person.notes)}`
    : '';

  return `- "${toPromptText(person.name)}" (id: ${person.id})${stay}${headcountLabel}${phone}${childSeat}${notes}`;
}

/**
 * Builds the line for one guest's own arrival or departure leg.
 *
 * The leg's id leads, because `joinRide`, `leaveRide` and `removeTransport` all
 * take it and it was not in the prompt at all: the model could read a transport
 * and then had nothing to name it by, so every action against one was a guess
 * the validator threw away.
 *
 * "Needs a lift" is asked through the shared {@link isLegCovered}, never as
 * `needsPickup` alone. The two answers diverge the moment somebody volunteers:
 * a leg riding in a driven car is handled, and an assistant still reporting it
 * as unassigned would contradict the same trip's own transport list — the exact
 * split that helper was written to close.
 *
 * @param transport - The leg to serialize
 * @param persons - All guests of the trip, used to resolve names
 * @param drivenRideIds - Rides somebody has volunteered to drive
 * @returns A single prompt line
 */
function formatTransportLine(
  transport: Transport,
  persons: ReadonlyMap<string, Person>,
  drivenRideIds: ReadonlySet<string>,
): string {
  const segments = [
    `- ${transport.type} (transport id: ${transport.id})`,
    personNameById(persons, transport.personId),
    `${formatLocalDatetime(transport.datetime)} at ${toPromptText(transport.location)}`,
    transport.transportMode ?? '',
    transport.transportNumber ? `#${toPromptText(transport.transportNumber)}` : '',
    transport.needsPickup && !isLegCovered(transport, drivenRideIds)
      ? 'needs a lift'
      : '',
    // Which car it rides in, by id. `leaveRide` is addressed by *leg*, so
    // without this the model has to join the two sections through a display
    // name — and two guests called Alice, or one the device cannot name, take
    // the wrong leg out of the car. It also separates a leg that is being
    // driven from one that never needed a lift: neither prints "needs a lift",
    // and a covered leg has had its legacy driver cleared.
    transport.rideId ? `in ride: ${transport.rideId}` : '',
    // The pre-ride shape: a driver named on the leg itself, with no `Ride` row.
    // It still answers "who is fetching Alice", so it is stated rather than
    // silently folded into the rides below. It cannot contradict one either —
    // `setTransportRide` clears this field when a leg joins a ride, so no leg
    // ever names two drivers.
    transport.driverId
      ? `driver: ${personNameById(persons, transport.driverId)}`
      : '',
    transport.notes ? `notes: ${toPromptText(transport.notes)}` : '',
  ].filter(Boolean);

  return segments.join(' — ');
}

/**
 * Builds the line for one car journey.
 *
 * Reads as what a ride is: who drives, in what, from where and when, and who is
 * in it. Passengers come from the legs pointing at the ride — there is no list
 * on the ride itself, deliberately, so that two guests joining the same car
 * offline both survive the merge.
 *
 * @param ride - The journey to serialize
 * @param legs - The legs whose `rideId` names this ride
 * @param persons - All guests of the trip, used to resolve names
 * @param vehicles - The trip's cars, used to resolve the chosen one
 * @returns A single prompt line
 */
function formatRideLine(
  ride: Ride,
  legs: readonly Transport[],
  persons: ReadonlyMap<string, Person>,
  vehicles: ReadonlyMap<string, Vehicle>,
): string {
  const vehicle =
    ride.vehicleId === undefined ? undefined : vehicles.get(ride.vehicleId);
  const passengers = legs.map((leg) => personNameById(persons, leg.personId));

  const segments = [
    `- ${ride.direction} (id: ${ride.id})`,
    `${formatLocalDatetime(ride.meetDatetime)} at ${toPromptText(ride.location)}`,
    // Both stated even when empty: "nobody is driving this yet" is the question
    // the ride list exists to answer, and a missing segment reads as unknown.
    //
    // Asked of `driverId`, not of the resolved guest — the same distinction
    // `ResolvedRide` keeps by carrying both. A ride nobody has volunteered for
    // and a ride whose driver this device cannot yet name are different facts,
    // and collapsing them puts a car that has a driver back on the list of cars
    // that need one.
    `driver: ${ride.driverId ? personNameById(persons, ride.driverId) : 'nobody yet'}`,
    `car: ${vehicle ? `"${toPromptText(vehicle.name)}"` : 'not chosen'}`,
    // The effective value, not the stored one, so an unset lead time answers
    // "when do I leave" instead of leaving the default unstated.
    `leaves ${ride.leadTimeMinutes ?? DEFAULT_LEAD_TIME_MINUTES} min before`,
    passengers.length > 0
      ? `passengers: ${passengers.join(', ')}`
      : 'no passengers yet',
    ride.notes ? `notes: ${toPromptText(ride.notes)}` : '',
  ];

  return segments.filter(Boolean).join(' — ');
}

/**
 * Builds the line for one car.
 *
 * An unmeasured car says so rather than reading as a car with no room in it:
 * every capacity field is optional and a missing `seatCount` means "nobody has
 * counted", which is not the same claim as zero seats.
 *
 * @param vehicle - The car to serialize
 * @param persons - All guests of the trip, used to resolve the owner
 * @returns A single prompt line
 */
function formatVehicleLine(
  vehicle: Vehicle,
  persons: ReadonlyMap<string, Person>,
): string {
  const segments = [
    `- "${toPromptText(vehicle.name)}" (id: ${vehicle.id})`,
    vehicle.seatCount === undefined
      ? 'seats not counted'
      : `${vehicle.seatCount} seats incl. driver`,
    vehicle.isRental ? 'hire car' : '',
    vehicle.ownerId
      ? `owner: ${personNameById(persons, vehicle.ownerId)}`
      : '',
    vehicle.childSeats && vehicle.childSeats.length > 0
      ? `child seats: ${vehicle.childSeats.join(', ')}`
      : '',
    vehicle.luggageNotes ? `luggage: ${toPromptText(vehicle.luggageNotes)}` : '',
    vehicle.notes ? `notes: ${toPromptText(vehicle.notes)}` : '',
  ].filter(Boolean);

  return segments.join(' — ');
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
  const { rides, vehicles } = useRideContext();
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
    // Indexed once. Every section names guests it does not own — participants,
    // a driver, passengers, an owner — and this memo re-runs on every live
    // query tick from five contexts, so a linear scan per name is a scan of
    // the guest list per guest, per tick. `resolveRides` indexes for the same
    // reason.
    const personsById = new Map<string, Person>(
      persons.map((person) => [person.id, person]),
    );
    const vehiclesById = new Map<string, Vehicle>(
      vehicles.map((vehicle) => [vehicle.id, vehicle]),
    );

    const parts: string[] = [
      ...buildOpeningLines(languageName),
      'The current trip is below — its guests, rooms, assignments, transports, rides, cars and agenda. Answer from that data directly; never say you lack access to it.',
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

    // Transports — each guest's own arrival or departure leg
    const drivenRideIds = collectDrivenRideIds(rides);

    if (transports.length > 0) {
      parts.push('', '## Transports');
      for (const transport of transports) {
        parts.push(formatTransportLine(transport, personsById, drivenRideIds));
      }
    } else {
      parts.push('', '## Transports', 'No transport plans yet.');
    }

    // Rides — the cars meeting those legs. Membership lives on the leg, so the
    // passengers of a ride are the legs pointing back at it.
    const legsByRideId = new Map<string, Transport[]>();
    for (const transport of transports) {
      if (transport.rideId === undefined) {
        continue;
      }
      const existing = legsByRideId.get(transport.rideId);
      if (existing === undefined) {
        legsByRideId.set(transport.rideId, [transport]);
      } else {
        existing.push(transport);
      }
    }

    if (rides.length > 0) {
      parts.push('', '## Rides (cars meeting the transports above)');
      for (const ride of rides) {
        parts.push(
          formatRideLine(
            ride,
            legsByRideId.get(ride.id) ?? [],
            personsById,
            vehiclesById,
          ),
        );
      }
    } else {
      parts.push('', '## Rides', 'No rides yet.');
    }

    // Cars
    if (vehicles.length > 0) {
      parts.push('', '## Cars');
      for (const vehicle of vehicles) {
        parts.push(formatVehicleLine(vehicle, personsById));
      }
    } else {
      parts.push('', '## Cars', 'No cars yet.');
    }

    // Activities (shared agenda)
    if (activities.length > 0) {
      parts.push(
        '',
        '## Activities (shared agenda, sorted by start, dates are local calendar days)',
        'Activities happening on today\'s date are tagged with "TODAY".',
      );
      for (const activity of activities) {
        parts.push(formatActivityLine(activity, personsById, todayIso));
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
    rides,
    vehicles,
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
