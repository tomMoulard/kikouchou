/**
 * @fileoverview Unit tests for guest presence helpers.
 *
 * @module features/persons/utils/__tests__/guest-presence.test
 */

import { describe, expect, it } from 'vitest';

import { localInstant } from '@/test/utils';
import type { HexColor, ISODateString, Person, RoomAssignment, Transport } from '@/types';

import {
  buildGuestIdsByTripDateMap,
  deriveGuestStayDateBounds,
  isGuestOnSiteOnDate,
  listGuestsOnSiteOnDate,
} from '../guest-presence';

function iso(s: string): ISODateString {
  return s as ISODateString;
}

/** A room assignment covering `start` (inclusive) to `end` (check-out, exclusive). */
function assignment(personId: string, start: string, end: string): RoomAssignment {
  return {
    id: `ra-${personId}-${start}` as RoomAssignment['id'],
    tripId: 't1' as RoomAssignment['tripId'],
    roomId: 'r1' as RoomAssignment['roomId'],
    personId: personId as RoomAssignment['personId'],
    startDate: iso(start),
    endDate: iso(end),
  };
}

function person(id: string, stay?: { start: string; end: string }): Person {
  return {
    id: id as Person['id'],
    tripId: 't1' as Person['tripId'],
    name: id,
    color: '#000000' as HexColor,
    ...(stay ? { stayStartDate: iso(stay.start), stayEndDate: iso(stay.end) } : {}),
  };
}

/**
 * A transport stored the way the form stores it: the instant denoted by a
 * wall-clock day and time in the viewer's own zone.
 */
function transport(
  id: string,
  personId: string,
  type: Transport['type'],
  day: string,
  time: string,
): Transport {
  return {
    id: id as Transport['id'],
    tripId: 't1' as Transport['tripId'],
    personId: personId as Transport['personId'],
    type,
    datetime: localInstant(day, time),
    location: 'X',
    needsPickup: false,
  };
}

describe('deriveGuestStayDateBounds', () => {
  it('uses stay dates when set', () => {
    const p = person('p1', { start: '2026-04-10', end: '2026-04-20' });
    expect(deriveGuestStayDateBounds(p, [], [])).toEqual({
      arrival: iso('2026-04-10'),
      departure: iso('2026-04-20'),
    });
  });

  it('falls back to transports when stay dates missing', () => {
    const p = person('p1');
    const arrivals = [transport('a1', p.id, 'arrival', '2026-04-12', '10:00')];
    const departures = [transport('d1', p.id, 'departure', '2026-04-18', '15:00')];
    expect(deriveGuestStayDateBounds(p, arrivals, departures)).toEqual({
      arrival: iso('2026-04-12'),
      departure: iso('2026-04-18'),
    });
  });

  // Regression: transports are stored as UTC instants, so slicing the first ten
  // characters off the string answered with the *UTC* day. A guest landing at
  // 00:30 in Paris is stored at 22:30Z the evening before and was given a stay
  // starting a day early — one column left on the timeline, one night too many
  // in the room maths. The mirror image bites viewers behind UTC: a 23:30
  // departure is stored on the following UTC day and pushed check-out out by
  // one. Both bounds are asserted so neither direction can regress.
  it('reads the local calendar day of an after-midnight arrival, not the UTC day', () => {
    const p = person('p1');
    const arrivals = [transport('a1', p.id, 'arrival', '2026-04-11', '00:30')];
    const departures = [transport('d1', p.id, 'departure', '2026-04-18', '23:30')];
    expect(deriveGuestStayDateBounds(p, arrivals, departures)).toEqual({
      arrival: iso('2026-04-11'),
      departure: iso('2026-04-18'),
    });
  });

  it('picks earliest arrival from multiple arrivals', () => {
    const p = person('p1');
    const arrivals = [
      transport('a1', p.id, 'arrival', '2026-04-15', '10:00'),
      transport('a2', p.id, 'arrival', '2026-04-10', '08:00'),
    ];
    expect(deriveGuestStayDateBounds(p, arrivals, []).arrival).toBe(iso('2026-04-10'));
  });

  it('picks latest departure from multiple departures', () => {
    const p = person('p1');
    const departures = [
      transport('d1', p.id, 'departure', '2026-04-18', '10:00'),
      transport('d2', p.id, 'departure', '2026-04-22', '15:00'),
    ];
    expect(deriveGuestStayDateBounds(p, [], departures).departure).toBe(iso('2026-04-22'));
  });

  it('returns null for both when no stay dates and no transports', () => {
    const p = person('p1');
    expect(deriveGuestStayDateBounds(p, [], [])).toEqual({
      arrival: null,
      departure: null,
    });
  });

  it('ignores transports for other persons', () => {
    const p = person('p1');
    const arrivals = [transport('a1', 'other', 'arrival', '2026-04-12', '10:00')];
    expect(deriveGuestStayDateBounds(p, arrivals, [])).toEqual({
      arrival: null,
      departure: null,
    });
  });
});

describe('isGuestOnSiteOnDate', () => {
  it('matches check-in inclusive, check-out exclusive', () => {
    const p = person('p1', { start: '2026-04-10', end: '2026-04-20' });
    const on = (d: string) =>
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [],
        dateKey: iso(d),
      });
    expect(on('2026-04-09')).toBe(false);
    expect(on('2026-04-10')).toBe(true);
    expect(on('2026-04-19')).toBe(true);
    expect(on('2026-04-20')).toBe(false);
  });

  it('returns false when arrival equals departure', () => {
    const p = person('p1', { start: '2026-04-10', end: '2026-04-10' });
    expect(
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [],
        dateKey: iso('2026-04-10'),
      }),
    ).toBe(false);
  });

  it('returns false when arrival is after departure', () => {
    const p = person('p1', { start: '2026-04-20', end: '2026-04-10' });
    expect(
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [],
        dateKey: iso('2026-04-15'),
      }),
    ).toBe(false);
  });

  it('returns false when no stay dates, no transports and no room', () => {
    const p = person('p1');
    expect(
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [],
        dateKey: iso('2026-04-15'),
      }),
    ).toBe(false);
  });

  // Regression: the sidebar used the stay-window-only definition and the
  // calendar the room-aware one, so this guest was counted but never listed.
  it('counts a guest with a room but no stay dates and no transports', () => {
    const p = person('p1');
    const on = (d: string) =>
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [assignment('p1', '2026-04-10', '2026-04-12')],
        dateKey: iso(d),
      });
    expect(on('2026-04-09')).toBe(false);
    expect(on('2026-04-10')).toBe(true);
    expect(on('2026-04-11')).toBe(true);
    // Check-out morning is not a night on site.
    expect(on('2026-04-12')).toBe(false);
  });

  // The visible half of the same bug: the guest lands at 00:30 on the 11th and
  // is on site that night, not the 10th.
  it('puts an after-midnight arrival on site the night they land, not the night before', () => {
    const p = person('p1');
    const arrivals = [transport('a1', p.id, 'arrival', '2026-04-11', '00:30')];
    const departures = [transport('d1', p.id, 'departure', '2026-04-14', '18:00')];
    const on = (d: string) =>
      isGuestOnSiteOnDate({
        person: p,
        arrivals,
        departures,
        assignments: [],
        dateKey: iso(d),
      });
    expect(on('2026-04-10')).toBe(false);
    expect(on('2026-04-11')).toBe(true);
    expect(on('2026-04-13')).toBe(true);
    // Check-out day is not a night on site.
    expect(on('2026-04-14')).toBe(false);
  });

  it('ignores a room assigned to somebody else', () => {
    const p = person('p1');
    expect(
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [assignment('other', '2026-04-10', '2026-04-12')],
        dateKey: iso('2026-04-10'),
      }),
    ).toBe(false);
  });

  it('keeps a guest on site outside their room dates when the stay window covers the night', () => {
    const p = person('p1', { start: '2026-04-10', end: '2026-04-20' });
    expect(
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [assignment('p1', '2026-04-10', '2026-04-12')],
        dateKey: iso('2026-04-15'),
      }),
    ).toBe(true);
  });
});

describe('listGuestsOnSiteOnDate', () => {
  it('filters to guests on that night', () => {
    const a = person('a', { start: '2026-04-07', end: '2026-04-26' });
    const b = person('b', { start: '2026-04-20', end: '2026-04-22' });
    const list = listGuestsOnSiteOnDate({
      persons: [a, b],
      arrivals: [],
      departures: [],
      assignments: [],
      dateKey: iso('2026-04-21'),
    });
    expect(list.map((x) => x.id)).toEqual([a.id, b.id]);
  });

  // Regression: this guest showed up in the calendar's "people on site" count
  // while the sidebar's list of the same night left them out.
  it('lists a guest whose only trace is a room assignment', () => {
    const dated = person('dated', { start: '2026-04-20', end: '2026-04-22' });
    const roomOnly = person('room-only');
    const list = listGuestsOnSiteOnDate({
      persons: [dated, roomOnly],
      arrivals: [],
      departures: [],
      assignments: [assignment('room-only', '2026-04-20', '2026-04-23')],
      dateKey: iso('2026-04-21'),
    });
    expect(list.map((x) => x.id)).toEqual([dated.id, roomOnly.id]);
  });
});

describe('buildGuestIdsByTripDateMap', () => {
  it('maps each trip day to present guest ids', () => {
    const a = person('alice', { start: '2026-04-07', end: '2026-04-10' });
    const b = person('bob', { start: '2026-04-09', end: '2026-04-12' });
    const map = buildGuestIdsByTripDateMap({
      persons: [a, b],
      arrivals: [],
      departures: [],
      assignments: [],
      tripStartDate: iso('2026-04-08'),
      tripEndDate: iso('2026-04-11'),
    });
    // Check-out day is not a stay night (alice leaves Apr 10; bob still there Apr 10 night).
    expect([...(map.get(iso('2026-04-08')) ?? [])].sort()).toEqual([a.id].sort());
    expect([...(map.get(iso('2026-04-09')) ?? [])].sort()).toEqual([a.id, b.id].sort());
    expect([...(map.get(iso('2026-04-10')) ?? [])].sort()).toEqual([b.id].sort());
    expect([...(map.get(iso('2026-04-11')) ?? [])].sort()).toEqual([b.id].sort());
  });

  it('includes room-only guests on the nights their room covers', () => {
    const a = person('alice');
    const map = buildGuestIdsByTripDateMap({
      persons: [a],
      arrivals: [],
      departures: [],
      assignments: [assignment('alice', '2026-04-09', '2026-04-11')],
      tripStartDate: iso('2026-04-08'),
      tripEndDate: iso('2026-04-11'),
    });
    expect(map.get(iso('2026-04-08'))).toEqual([]);
    expect(map.get(iso('2026-04-09'))).toEqual([a.id]);
    expect(map.get(iso('2026-04-10'))).toEqual([a.id]);
    expect(map.get(iso('2026-04-11'))).toEqual([]);
  });

  it('returns empty map for invalid trip dates', () => {
    const a = person('alice', { start: '2026-04-07', end: '2026-04-10' });
    const map = buildGuestIdsByTripDateMap({
      persons: [a],
      arrivals: [],
      departures: [],
      assignments: [],
      tripStartDate: iso('invalid'),
      tripEndDate: iso('2026-04-11'),
    });
    expect(map.size).toBe(0);
  });

  it('returns empty map when trip start is after trip end', () => {
    const a = person('alice', { start: '2026-04-07', end: '2026-04-10' });
    const map = buildGuestIdsByTripDateMap({
      persons: [a],
      arrivals: [],
      departures: [],
      assignments: [],
      tripStartDate: iso('2026-04-15'),
      tripEndDate: iso('2026-04-10'),
    });
    expect(map.size).toBe(0);
  });
});
