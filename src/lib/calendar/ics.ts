/**
 * @fileoverview iCalendar (RFC 5545) text, built from plain event records.
 *
 * The app can only alert a driver while it is open: notifications come from
 * this device, and no browser wakes a closed page at a chosen time. A calendar
 * file moves the reminder somewhere that does ring on its own — the phone's own
 * calendar, which the driver already carries and already trusts.
 *
 * This module knows nothing about rides, trips or guests. It takes events and
 * returns the file, so the transports feature owns what a run *says* and this
 * owns what the format *requires*. See `features/transports/utils/ride-ics`
 * for the mapping.
 *
 * Three format rules are easy to get wrong and expensive to debug, because a
 * calendar app that dislikes a file usually imports nothing and says nothing:
 *
 * - Lines end with CRLF, always, and the file ends with one.
 * - A line longer than 75 **octets** must be folded, and a fold may never cut a
 *   UTF-8 sequence in half. Guest names are the reason: `Aurélia` is seven
 *   characters and eight octets.
 * - Backslash, semicolon, comma and newline are escaped inside every text
 *   value. An unescaped comma in a place name silently truncates the field.
 *
 * @module lib/calendar/ics
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * The identifier the file reports itself under.
 *
 * Written into `PRODID`, which is required and is what a calendar app shows
 * when it asks the user whether to trust the import.
 */
const PRODUCT_ID = '-//Kikouchou//Runs//EN';

/**
 * Maximum octets on one unfolded line, from RFC 5545 section 3.1.
 *
 * The continuation line starts with one space, which counts against the limit,
 * so a folded continuation carries 74 octets of payload.
 */
const MAX_LINE_OCTETS = 75;

// ============================================================================
// Type Definitions
// ============================================================================

/** A point on the globe, as the app stores one. */
export interface CalendarCoordinates {
  readonly lat: number;
  readonly lon: number;
}

/** One entry of the calendar file. */
export interface CalendarEvent {
  /**
   * Stable identity of the event, unique within the calendar.
   *
   * A second import of the same file must update the entry rather than add a
   * copy, and this is the only thing that decides that. Derive it from the id
   * of the record the event describes, never from its time or its text.
   */
  readonly uid: string;

  /** Start of the block, epoch milliseconds. */
  readonly startMs: number;

  /**
   * End of the block, epoch milliseconds.
   *
   * An end before the start is pushed back to the start: a negative span is
   * invalid, and how long a block should last is the caller's decision, made
   * before it gets here.
   */
  readonly endMs: number;

  /** The single line the calendar grid shows. */
  readonly summary: string;

  /** The longer text behind it. Newlines are kept, and escaped. */
  readonly description?: string;

  /** Place name, as typed by whoever knows the road. */
  readonly location?: string;

  /** Optional coordinates of that place, written as `GEO`. */
  readonly coordinates?: CalendarCoordinates;

  /**
   * Minutes before {@link startMs} that the calendar must alert.
   *
   * Absent means no alarm at all: the event sits in the calendar and nothing
   * rings. This is the field the whole file exists for, so a caller that omits
   * it is usually making a mistake.
   */
  readonly alarmMinutesBefore?: number;
}

/** Everything the file needs beyond its events. */
export interface IcsCalendarOptions {
  /**
   * When the file was produced, epoch milliseconds.
   *
   * Written into every `DTSTAMP`. Passed in rather than read from the clock, so
   * that a test, and two events of one file, cannot disagree.
   */
  readonly nowMs: number;

  /**
   * Name offered to the calendar app on import, when it asks for one.
   *
   * `X-WR-CALNAME` is not in the standard and is read by every calendar app
   * that matters. Absent, the app names the import after the file.
   */
  readonly name?: string;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Escapes one text value for a content line.
 *
 * The backslash goes first: escaping it after the others would double the
 * backslashes they just introduced.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/** Octets one character occupies once encoded as UTF-8. */
function octetLength(character: string): number {
  const code = character.codePointAt(0) ?? 0;

  if (code < 0x80) {
    return 1;
  }
  if (code < 0x800) {
    return 2;
  }
  if (code < 0x10000) {
    return 3;
  }
  return 4;
}

/**
 * Folds one content line to the octet limit.
 *
 * Iterates code points rather than UTF-16 units, so an emoji in a trip name
 * cannot be cut in half by a fold. A split surrogate pair is not a display
 * glitch here: it makes the file invalid, and the import silently empty.
 */
function foldLine(line: string): string {
  const segments: string[] = [];
  let current = '',
    budget = MAX_LINE_OCTETS;

  for (const character of line) {
    const size = octetLength(character);

    if (current !== '' && size > budget) {
      segments.push(current);
      current = '';
      // Every continuation line spends one octet on its leading space.
      budget = MAX_LINE_OCTETS - 1;
    }

    current += character;
    budget -= size;
  }

  segments.push(current);

  return segments.join('\r\n ');
}

/**
 * Formats an instant as a UTC timestamp.
 *
 * UTC, always. A local time with a `TZID` needs the file to also carry the
 * timezone definition it names, and a run written in Paris is read on a phone
 * that may be anywhere.
 */
function formatUtcStamp(ms: number): string {
  const at = new Date(ms),
    pad = (value: number, width = 2): string => String(value).padStart(width, '0');

  return (
    `${pad(at.getUTCFullYear(), 4)}${pad(at.getUTCMonth() + 1)}${pad(at.getUTCDate())}` +
    `T${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}${pad(at.getUTCSeconds())}Z`
  );
}

/** Writes one alarm block, relative to the start of its event. */
function alarmLines(minutesBefore: number, description: string): string[] {
  // A whole, non-negative number of minutes: `-PT-5M` is not a duration, and a
  // fractional one is rejected outright by several calendar apps.
  const minutes = Math.max(0, Math.round(minutesBefore));

  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(description)}`,
    `TRIGGER:-PT${minutes}M`,
    'END:VALARM',
  ];
}

/** Writes one event block. */
function eventLines(event: CalendarEvent, options: IcsCalendarOptions): string[] {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeText(event.uid)}`,
    `DTSTAMP:${formatUtcStamp(options.nowMs)}`,
    `DTSTART:${formatUtcStamp(event.startMs)}`,
    `DTEND:${formatUtcStamp(Math.max(event.startMs, event.endMs))}`,
    `SUMMARY:${escapeText(event.summary)}`,
  ];

  if (event.description !== undefined && event.description !== '') {
    lines.push(`DESCRIPTION:${escapeText(event.description)}`);
  }

  if (event.location !== undefined && event.location !== '') {
    lines.push(`LOCATION:${escapeText(event.location)}`);
  }

  if (event.coordinates) {
    lines.push(`GEO:${event.coordinates.lat};${event.coordinates.lon}`);
  }

  if (event.alarmMinutesBefore !== undefined) {
    lines.push(...alarmLines(event.alarmMinutesBefore, event.summary));
  }

  lines.push('END:VEVENT');

  return lines;
}

// ============================================================================
// Public API
// ============================================================================

/** The MIME type a calendar file is downloaded under. */
export const ICS_MIME_TYPE = 'text/calendar;charset=utf-8';

/**
 * Builds an iCalendar file from events.
 *
 * Events whose start or end cannot be placed on the clock are dropped rather
 * than written as `Invalid Date`: one malformed line makes some calendar apps
 * refuse the whole import, so a run nobody can place must not cost the driver
 * the runs that are fine.
 *
 * @param events - The entries to write, in the order they must appear
 * @param options - The stamp instant and the offered calendar name
 * @returns The file content, CRLF-terminated
 *
 * @example
 * ```typescript
 * const ics = buildIcsCalendar(
 *   [
 *     {
 *       uid: 'ride1@kikouchou.app',
 *       startMs,
 *       endMs,
 *       summary: 'Pick up Alice',
 *       alarmMinutesBefore: 15,
 *     },
 *   ],
 *   { nowMs: Date.now(), name: 'Provence — your runs' },
 * );
 * ```
 */
export function buildIcsCalendar(
  events: readonly CalendarEvent[],
  options: IcsCalendarOptions,
): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
  ];

  if (options.name !== undefined && options.name !== '') {
    lines.push(`X-WR-CALNAME:${escapeText(options.name)}`);
  }

  for (const event of events) {
    if (!Number.isFinite(event.startMs) || !Number.isFinite(event.endMs)) {
      continue;
    }
    lines.push(...eventLines(event, options));
  }

  lines.push('END:VCALENDAR');

  return `${lines.map(foldLine).join('\r\n')}\r\n`;
}
