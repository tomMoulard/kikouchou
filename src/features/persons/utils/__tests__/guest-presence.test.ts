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
  resolveGuestStayWindow,
} from '../guest-presence';

function iso(s: string): ISODateString {
  return s as ISODateString;
}

/** The trip a guest with no dates of their own is assumed to be there for. */
const TRIP_WINDOW = { startDate: iso('2026-04-05'), endDate: iso('2026-04-25') };

/**
 * A trip whose own dates are unknown — still loading, or never filled in. The
 * fallback has nothing to offer here, so it is the one way to see what a guest's
 * own dates and rooms say on their own.
 */
const NO_TRIP_DATES = { startDate: undefined, endDate: undefined };

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

describe('resolveGuestStayWindow', () => {
  it('leaves a stated stay alone', () => {
    const p = person('p1', { start: '2026-04-10', end: '2026-04-20' });
    expect(resolveGuestStayWindow(p, [], [], TRIP_WINDOW)).toEqual({
      arrival: iso('2026-04-10'),
      departure: iso('2026-04-20'),
    });
  });

  it('assumes the whole trip for a guest with no dates and no transports', () => {
    const p = person('p1');
    expect(resolveGuestStayWindow(p, [], [], TRIP_WINDOW)).toEqual({
      arrival: TRIP_WINDOW.startDate,
      departure: TRIP_WINDOW.endDate,
    });
  });

  // Each bound falls back on its own: a guest who booked a flight in and none
  // out is here from the day they land until the trip ends. Answering `null`
  // for the missing half erased the whole stay.
  it('completes a half-known stay from the trip', () => {
    const p = person('p1');
    const arrivals = [transport('a1', p.id, 'arrival', '2026-04-12', '10:00')];
    expect(resolveGuestStayWindow(p, arrivals, [], TRIP_WINDOW)).toEqual({
      arrival: iso('2026-04-12'),
      departure: TRIP_WINDOW.endDate,
    });

    const departures = [transport('d1', p.id, 'departure', '2026-04-18', '15:00')];
    expect(resolveGuestStayWindow(p, [], departures, TRIP_WINDOW)).toEqual({
      arrival: TRIP_WINDOW.startDate,
      departure: iso('2026-04-18'),
    });
  });

  it('returns null for both when the trip has no dates either', () => {
    const p = person('p1');
    expect(resolveGuestStayWindow(p, [], [], NO_TRIP_DATES)).toEqual({
      arrival: null,
      departure: null,
    });
  });

  it('does not adopt another guest’s transports as this guest’s stay', () => {
    const p = person('p1');
    const arrivals = [transport('a1', 'other', 'arrival', '2026-04-12', '10:00')];
    // The trip window, not Apr 12: the other guest's flight is not this one's.
    expect(resolveGuestStayWindow(p, arrivals, [], TRIP_WINDOW)).toEqual({
      arrival: TRIP_WINDOW.startDate,
      departure: TRIP_WINDOW.endDate,
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
        tripWindow: TRIP_WINDOW,
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
        tripWindow: TRIP_WINDOW,
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
        tripWindow: TRIP_WINDOW,
        dateKey: iso('2026-04-15'),
      }),
    ).toBe(false);
  });

  it('returns false when the guest and the trip both have no dates', () => {
    const p = person('p1');
    expect(
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [],
        tripWindow: NO_TRIP_DATES,
        dateKey: iso('2026-04-15'),
      }),
    ).toBe(false);
  });

  // A guest the host added and left blank is here for the trip: hiding them
  // dropped one of three guests from the rooms timeline and from the nightly
  // headcount, on a trip where the host had said when the trip was.
  it('puts a guest with nothing filled in on site for every night of the trip', () => {
    const p = person('p1');
    const on = (d: string) =>
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [],
        tripWindow: TRIP_WINDOW,
        dateKey: iso(d),
      });
    expect(on('2026-04-04')).toBe(false);
    expect(on('2026-04-05')).toBe(true);
    expect(on('2026-04-15')).toBe(true);
    expect(on('2026-04-24')).toBe(true);
    // The trip's last day is the check-out, so it is not a night on site.
    expect(on('2026-04-25')).toBe(false);
  });

  // Regression: the sidebar used the stay-window-only definition and the
  // calendar the room-aware one, so this guest was counted but never listed.
  // The trip has no dates here, which is the only way the room clause answers
  // on its own — with trip dates the stay window already covers every night.
  it('counts a guest with a room but no stay dates and no transports', () => {
    const p = person('p1');
    const on = (d: string) =>
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [assignment('p1', '2026-04-10', '2026-04-12')],
        tripWindow: NO_TRIP_DATES,
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
        tripWindow: TRIP_WINDOW,
        dateKey: iso(d),
      });
    expect(on('2026-04-10')).toBe(false);
    expect(on('2026-04-11')).toBe(true);
    expect(on('2026-04-13')).toBe(true);
    // Check-out day is not a night on site.
    expect(on('2026-04-14')).toBe(false);
  });

  it('ignores a room assigned to somebody else', () => {
    // Dated so the trip fallback cannot be what puts them on site.
    const p = person('p1', { start: '2026-04-06', end: '2026-04-08' });
    expect(
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [assignment('other', '2026-04-10', '2026-04-12')],
        tripWindow: TRIP_WINDOW,
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
        tripWindow: TRIP_WINDOW,
        dateKey: iso('2026-04-15'),
      }),
    ).toBe(true);
  });

  it('keeps a guest on site on a room night after their stay dates end', () => {
    const p = person('p1', { start: '2026-04-10', end: '2026-04-12' });
    expect(
      isGuestOnSiteOnDate({
        person: p,
        arrivals: [],
        departures: [],
        assignments: [assignment('p1', '2026-04-12', '2026-04-14')],
        tripWindow: TRIP_WINDOW,
        dateKey: iso('2026-04-13'),
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
      tripWindow: TRIP_WINDOW,
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
      tripWindow: NO_TRIP_DATES,
      dateKey: iso('2026-04-21'),
    });
    expect(list.map((x) => x.id)).toEqual([dated.id, roomOnly.id]);
  });

  it('lists an undated guest alongside the dated ones', () => {
    const dated = person('dated', { start: '2026-04-20', end: '2026-04-22' });
    const blank = person('blank');
    const list = listGuestsOnSiteOnDate({
      persons: [dated, blank],
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
      dateKey: iso('2026-04-21'),
    });
    expect(list.map((x) => x.id)).toEqual([dated.id, blank.id]);
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

  it('includes an undated guest on every night of the trip', () => {
    const a = person('alice');
    const map = buildGuestIdsByTripDateMap({
      persons: [a],
      arrivals: [],
      departures: [],
      assignments: [],
      tripStartDate: iso('2026-04-08'),
      tripEndDate: iso('2026-04-11'),
    });
    expect(map.get(iso('2026-04-08'))).toEqual([a.id]);
    expect(map.get(iso('2026-04-09'))).toEqual([a.id]);
    expect(map.get(iso('2026-04-10'))).toEqual([a.id]);
    // The trip's last day is the check-out, so nobody sleeps on it.
    expect(map.get(iso('2026-04-11'))).toEqual([]);
  });

  it('includes a guest on a room night that falls after their stay dates', () => {
    const a = person('alice', { start: '2026-04-08', end: '2026-04-09' });
    const map = buildGuestIdsByTripDateMap({
      persons: [a],
      arrivals: [],
      departures: [],
      assignments: [assignment('alice', '2026-04-10', '2026-04-11')],
      tripStartDate: iso('2026-04-08'),
      tripEndDate: iso('2026-04-11'),
    });
    expect(map.get(iso('2026-04-08'))).toEqual([a.id]);
    expect(map.get(iso('2026-04-09'))).toEqual([]);
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
