/**
 * @fileoverview A driver's runs, as calendar events.
 *
 * The ride alert in `lib/notifications` fires from this device, which means it
 * fires while the app is open and not otherwise. The settings card says so.
 * This module answers it: the same runs, written into a file the driver's own
 * calendar imports, where the alarm belongs to the phone and rings with
 * Kikouchou closed.
 *
 * What is exported is the **driving**, not the meeting. The block starts when
 * the driver has to set off and ends at the rendez-vous, because the hour that
 * has to be free in a calendar is the drive, not the instant of arrival. That
 * is also the value the driver typed a lead time for.
 *
 * Copy lives with the caller. This file turns journeys into events, and takes
 * the sentences it writes as arguments, so the words stay under `t()` in the
 * component and the timing rules stay here where they can be tested.
 *
 * @module features/transports/utils/ride-ics
 */

import { type CalendarEvent } from '@/lib/calendar/ics';
import { type ResolvedRide } from '@/features/transports/utils/ride-model';
import type { RideDirection } from '@/types';

// ============================================================================
// Constants
// ============================================================================

/**
 * How long before setting off the calendar alerts.
 *
 * Fifteen minutes, which is the time it takes to stop what you are doing and
 * find the car keys. The alarm is deliberately *before* the block rather than
 * at its start: a reminder that fires at the moment you already had to leave
 * is a reminder that you are late.
 */
export const RIDE_ALARM_MINUTES_BEFORE = 15;

/**
 * Shortest block a run is written as.
 *
 * A driver may type a lead time of zero, and a zero-length event is drawn as a
 * hairline or hidden entirely in most calendar grids — the run would be in the
 * file and invisible in the app that imported it.
 */
export const RIDE_MINIMUM_BLOCK_MINUTES = 15;

/**
 * Domain the event ids are namespaced under.
 *
 * `UID` has to be globally unique, and a bare nanoid is not: re-importing a
 * file must update the run it already holds, and a collision with an unrelated
 * event from another app would have one silently overwrite the other.
 */
const UID_DOMAIN = 'kikouchou.app';

/** One minute, in milliseconds. Named so the arithmetic below reads. */
const MINUTE_MS = 60_000;

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * The sentences the file is written in, already translated.
 *
 * Each takes the values it needs rather than a ride, so nothing here can reach
 * for a field the caller did not mean to publish.
 */
export interface RideCalendarLabels {
  /**
   * The line the calendar grid shows.
   *
   * @param input - Direction, the passengers as one string, and the place
   */
  readonly summary: (input: {
    readonly direction: RideDirection;
    readonly passengers: string;
    readonly location: string;
  }) => string;

  /** "Passengers: Alice, Bob" — omitted when the car has none listed. */
  readonly passengersLine: (passengers: string) => string;

  /** "Be there at 17:02", the rendez-vous the block ends on. */
  readonly meetLine: (meetTime: string) => string;

  /** "Car: Renault Scénic" — omitted when no car is chosen yet. */
  readonly vehicleLine: (vehicle: string) => string;

  /** Stands in for a passenger this device cannot name. */
  readonly unknownPassenger: string;
}

/** Everything {@link toRideCalendarEvents} needs. */
export interface RideCalendarInput {
  /** The journeys to write, already narrowed to one driver. */
  readonly journeys: readonly ResolvedRide[];
  /** The translated sentences. */
  readonly labels: RideCalendarLabels;
  /** Renders the rendez-vous for the description, in the reader's locale. */
  readonly formatDateTime: (ms: number) => string;
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Names the passengers of one journey, in the order the model sorted them. */
function passengerNames(journey: ResolvedRide, unknown: string): string[] {
  return journey.legs.map((leg) => leg.person?.name ?? unknown);
}

/** Builds the description: who, where to be and when, in what, plus notes. */
function describe(journey: ResolvedRide, input: RideCalendarInput): string {
  const { labels } = input,
    passengers = passengerNames(journey, labels.unknownPassenger),
    lines: string[] = [];

  if (passengers.length > 0) {
    lines.push(labels.passengersLine(passengers.join(', ')));
  }

  if (journey.meetAtMs !== null) {
    lines.push(labels.meetLine(input.formatDateTime(journey.meetAtMs)));
  }

  if (journey.vehicle) {
    lines.push(labels.vehicleLine(journey.vehicle.name));
  }

  const notes = journey.ride?.notes?.trim();

  if (notes !== undefined && notes !== '') {
    lines.push(notes);
  }

  return lines.join('\n');
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Selects the runs worth putting in a calendar.
 *
 * Two exclusions, and both of them are about what the driver would otherwise
 * find in their calendar. A run that has already met is history: importing it
 * fills last week with alarms that can no longer be acted on. A run whose
 * meeting time cannot be placed on the clock has no block to occupy — the same
 * rule the departure banner follows, for the same reason.
 *
 * @param journeys - Resolved journeys, typically one driver's
 * @param nowMs - Reference instant (`TransportContext.nowMs`)
 * @returns The journeys still ahead, in the order given
 */
export function selectExportableRides(
  journeys: readonly ResolvedRide[],
  nowMs: number,
): ResolvedRide[] {
  return journeys.filter(
    (journey) => journey.meetAtMs !== null && journey.meetAtMs >= nowMs,
  );
}

/**
 * Turns a driver's journeys into calendar events.
 *
 * The block runs from the leave time to the meeting time. A journey with no
 * usable leave time falls back to the meeting time itself, so a ride the model
 * could place still reaches the calendar rather than being dropped for a
 * missing lead time.
 *
 * @param input - The journeys, the translated sentences, and a time formatter
 * @returns One event per journey, in the order given
 *
 * @example
 * ```typescript
 * const events = toRideCalendarEvents({
 *   journeys: selectExportableRides(selectRidesDrivenBy(journeys, me), nowMs),
 *   labels,
 *   formatDateTime: (ms) => formatTransportDatetime(new Date(ms).toISOString(), locale, 'dayAndTime'),
 * });
 * ```
 */
export function toRideCalendarEvents(input: RideCalendarInput): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  for (const journey of input.journeys) {
    if (journey.meetAtMs === null) {
      continue;
    }

    const meetAtMs = journey.meetAtMs,
      startMs = journey.leaveAtMs === null ? meetAtMs : Math.min(journey.leaveAtMs, meetAtMs),
      endMs = Math.max(meetAtMs, startMs + RIDE_MINIMUM_BLOCK_MINUTES * MINUTE_MS);

    events.push({
      uid: `${journey.id}@${UID_DOMAIN}`,
      startMs,
      endMs,
      summary: input.labels.summary({
        direction: journey.direction,
        passengers: passengerNames(journey, input.labels.unknownPassenger).join(', '),
        location: journey.location,
      }),
      description: describe(journey, input),
      location: journey.location,
      ...(journey.coordinates ? { coordinates: journey.coordinates } : {}),
      alarmMinutesBefore: RIDE_ALARM_MINUTES_BEFORE,
    });
  }

  return events;
}
