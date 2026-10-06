/**
 * @fileoverview Guards the file format, which is the part of this feature
 * nothing else can check.
 *
 * A calendar app that dislikes a file imports nothing and reports nothing, so
 * every claim here is about a rule whose breach is silent: CRLF endings, the
 * 75-octet fold, escaping inside text values, and dropping an event nobody can
 * place rather than writing `Invalid Date` into the file.
 *
 * @module lib/calendar/__tests__/ics.test
 */

import { describe, expect, it } from 'vitest';

import { buildIcsCalendar, type CalendarEvent } from '../ics';

// ============================================================================
// Fixtures
// ============================================================================

/** The frozen instant every fixture is measured from. */
const NOW_MS = Date.UTC(2026, 6, 15, 8, 30, 0);

const MINUTE_MS = 60_000;

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    uid: 'ride-1@kikouchou.app',
    startMs: Date.UTC(2026, 6, 15, 14, 32, 0),
    endMs: Date.UTC(2026, 6, 15, 15, 2, 0),
    summary: 'Pick up Alice at Lyon Part-Dieu',
    alarmMinutesBefore: 15,
    ...overrides,
  };
}

/** The file as its content lines, unfolded joins left alone. */
function linesOf(ics: string): string[] {
  return ics.split('\r\n');
}

// ============================================================================
// Tests
// ============================================================================

describe('buildIcsCalendar', () => {
  it('wraps the events in a calendar a parser will accept', () => {
    const ics = buildIcsCalendar([makeEvent()], { nowMs: NOW_MS });

    expect(linesOf(ics).slice(0, 4)).toEqual([
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Kikouchou//Runs//EN',
      'CALSCALE:GREGORIAN',
    ]);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });

  it('ends every line with CRLF and never a bare newline', () => {
    const ics = buildIcsCalendar([makeEvent()], { nowMs: NOW_MS });

    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('writes the times as UTC stamps', () => {
    const ics = buildIcsCalendar([makeEvent()], { nowMs: NOW_MS });

    expect(ics).toContain('DTSTAMP:20260715T083000Z');
    expect(ics).toContain('DTSTART:20260715T143200Z');
    expect(ics).toContain('DTEND:20260715T150200Z');
  });

  it('pushes an end before its start back to the start', () => {
    const start = Date.UTC(2026, 6, 15, 14, 0, 0);
    const ics = buildIcsCalendar(
      [makeEvent({ startMs: start, endMs: start - 30 * MINUTE_MS })],
      { nowMs: NOW_MS },
    );

    expect(ics).toContain('DTSTART:20260715T140000Z');
    expect(ics).toContain('DTEND:20260715T140000Z');
  });

  it('asks the calendar to alert before the event starts', () => {
    const ics = buildIcsCalendar([makeEvent({ alarmMinutesBefore: 15 })], {
      nowMs: NOW_MS,
    });

    expect(ics).toContain('BEGIN:VALARM');
    expect(ics).toContain('TRIGGER:-PT15M');
    expect(ics).toContain('ACTION:DISPLAY');
  });

  it('writes no alarm when none was asked for', () => {
    const event = makeEvent();
    const ics = buildIcsCalendar(
      [{ ...event, alarmMinutesBefore: undefined }],
      { nowMs: NOW_MS },
    );

    expect(ics).not.toContain('VALARM');
  });

  it('escapes the characters that would otherwise truncate a value', () => {
    const ics = buildIcsCalendar(
      [
        makeEvent({
          summary: 'Pick up Alice, Bob',
          location: 'Lyon; Part-Dieu',
          description: 'Two bags\nBack by 18:00',
        }),
      ],
      { nowMs: NOW_MS },
    );

    expect(ics).toContain('SUMMARY:Pick up Alice\\, Bob');
    expect(ics).toContain('LOCATION:Lyon\\; Part-Dieu');
    expect(ics).toContain('DESCRIPTION:Two bags\\nBack by 18:00');
  });

  it('escapes a backslash once, not twice over', () => {
    const ics = buildIcsCalendar([makeEvent({ location: 'A\\B' })], {
      nowMs: NOW_MS,
    });

    expect(ics).toContain('LOCATION:A\\\\B');
  });

  it('folds a long line to 75 octets and marks the continuation', () => {
    const ics = buildIcsCalendar([makeEvent({ summary: 'x'.repeat(200) })], {
      nowMs: NOW_MS,
    });

    for (const line of linesOf(ics)) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    expect(ics).toContain('\r\n ');
  });

  it('counts octets rather than characters, and never splits one', () => {
    // 80 accented characters: 80 UTF-16 units and 160 octets, so a fold that
    // counted characters would leave a line twice over the limit, and one that
    // cut mid-sequence would produce a replacement character on import.
    const summary = 'é'.repeat(80);
    const ics = buildIcsCalendar([makeEvent({ summary })], { nowMs: NOW_MS });
    const folded = linesOf(ics).filter((line) => line.includes('é'));

    for (const line of folded) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
    // Unfolding puts the value back exactly, accents intact.
    expect(ics.replace(/\r\n /g, '')).toContain(`SUMMARY:${summary}`);
  });

  it('names the calendar when a name is given, and omits the line otherwise', () => {
    const named = buildIcsCalendar([makeEvent()], {
      nowMs: NOW_MS,
      name: 'Provence — your runs',
    });

    expect(named).toContain('X-WR-CALNAME:Provence — your runs');
    expect(buildIcsCalendar([makeEvent()], { nowMs: NOW_MS })).not.toContain('X-WR-CALNAME');
  });

  it('drops an event nobody can place rather than writing an invalid date', () => {
    const ics = buildIcsCalendar(
      [makeEvent({ uid: 'broken@kikouchou.app', startMs: Number.NaN }), makeEvent()],
      { nowMs: NOW_MS },
    );

    expect(ics).not.toContain('broken@kikouchou.app');
    expect(ics).not.toContain('NaN');
    expect(ics).toContain('UID:ride-1@kikouchou.app');
  });

  it('writes coordinates only when the place has them', () => {
    const withGeo = buildIcsCalendar(
      [makeEvent({ coordinates: { lat: 45.76, lon: 4.86 } })],
      { nowMs: NOW_MS },
    );

    expect(withGeo).toContain('GEO:45.76;4.86');
    expect(buildIcsCalendar([makeEvent()], { nowMs: NOW_MS })).not.toContain('GEO:');
  });
});
