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
  isGuestOnSiteDuringDay,
  isGuestOnSiteOnDate,
  listExtraStayPeriods,
  listGuestsOnSiteOnDate,
  listStatedStayPeriods,
  pairTransportStays,
  resolveGuestStayPeriods,
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

describe('isGuestOnSiteDuringDay', () => {
  // The night rule answers "who sleeps here"; this one answers "who is here at
  // some point today". They differ on exactly one day of a stay: the day the
  // guest leaves, when they are still here for breakfast and the station run.
  it('counts the day the guest leaves', () => {
    const p = person('p1', { start: '2026-04-10', end: '2026-04-12' });
    const query = {
      person: p,
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
    };

    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-12') })).toBe(true);
    expect(isGuestOnSiteOnDate({ ...query, dateKey: iso('2026-04-12') })).toBe(false);
  });

  it('counts the day the guest arrives, and neither end beyond that', () => {
    const p = person('p1', { start: '2026-04-10', end: '2026-04-12' });
    const query = {
      person: p,
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
    };

    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-09') })).toBe(false);
    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-10') })).toBe(true);
    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-11') })).toBe(true);
    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-13') })).toBe(false);
  });

  it('counts a guest who comes and goes on the same day', () => {
    // Zero nights, but the host still feeds them lunch. The night rule drops
    // this guest entirely, which is right for a bed and wrong for a headcount.
    const p = person('p1', { start: '2026-04-10', end: '2026-04-10' });
    const query = {
      person: p,
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
    };

    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-10') })).toBe(true);
    expect(isGuestOnSiteOnDate({ ...query, dateKey: iso('2026-04-10') })).toBe(false);
  });

  it('counts the checkout day of a guest whose only record is a room', () => {
    const p = person('p1');
    const query = {
      person: p,
      arrivals: [],
      departures: [],
      assignments: [assignment('p1', '2026-04-10', '2026-04-12')],
      tripWindow: NO_TRIP_DATES,
    };

    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-12') })).toBe(true);
    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-13') })).toBe(false);
  });

  it('ignores a room belonging to another guest', () => {
    expect(
      isGuestOnSiteDuringDay({
        person: person('p1', { start: '2026-04-01', end: '2026-04-02' }),
        arrivals: [],
        departures: [],
        assignments: [assignment('p2', '2026-04-10', '2026-04-12')],
        tripWindow: NO_TRIP_DATES,
        dateKey: iso('2026-04-11'),
      }),
    ).toBe(false);
  });

  it('is false when neither the guest nor the trip has any dates', () => {
    expect(
      isGuestOnSiteDuringDay({
        person: person('p1'),
        arrivals: [],
        departures: [],
        assignments: [],
        tripWindow: NO_TRIP_DATES,
        dateKey: iso('2026-04-11'),
      }),
    ).toBe(false);
  });

  it('puts an undated guest on every day of the trip, its last day included', () => {
    const query = {
      person: person('p1'),
      arrivals: [],
      departures: [],
      assignments: [],
      tripWindow: TRIP_WINDOW,
    };

    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-05') })).toBe(true);
    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-25') })).toBe(true);
    expect(isGuestOnSiteDuringDay({ ...query, dateKey: iso('2026-04-26') })).toBe(false);
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

// ============================================================================
// Several stays
// ============================================================================

/** Ana: 1st to the 22nd of April, back 1st to 8th May, then 24th to 31st May. */
function returningGuest(): Person {
  return {
    ...person('ana', { start: '2026-04-01', end: '2026-04-22' }),
    extraStays: [
      // Stored out of order on purpose: the readers sort.
      { startDate: iso('2026-05-24'), endDate: iso('2026-05-31') },
      { startDate: iso('2026-05-01'), endDate: iso('2026-05-08') },
    ],
  };
}

describe('listExtraStayPeriods / listStatedStayPeriods', () => {
  it('lists every stated stay, earliest first', () => {
    expect(listStatedStayPeriods(returningGuest())).toEqual([
      { startDate: '2026-04-01', endDate: '2026-04-22' },
      { startDate: '2026-05-01', endDate: '2026-05-08' },
      { startDate: '2026-05-24', endDate: '2026-05-31' },
    ]);
  });

  it('drops a malformed further stay on its own, as a peer might send one', () => {
    const p = {
      ...person('p1'),
      extraStays: [
        { startDate: 'soon', endDate: '2026-05-08' },
        { startDate: '2026-05-08', endDate: '2026-05-01' },
        null,
        { startDate: '2026-06-01', endDate: '2026-06-03' },
      ],
    } as unknown as Person;

    expect(listExtraStayPeriods(p)).toEqual([{ startDate: '2026-06-01', endDate: '2026-06-03' }]);
  });

  it('leaves out a first stay with only one of its days', () => {
    const p = { ...person('p1'), stayStartDate: iso('2026-04-01') };
    expect(listStatedStayPeriods(p)).toEqual([]);
  });
});

describe('pairTransportStays', () => {
  const p = person('p1');

  it('pairs each arrival with the next departure', () => {
    expect(
      pairTransportStays(
        p,
        [
          transport('a1', p.id, 'arrival', '2026-04-01', '10:00'),
          transport('a2', p.id, 'arrival', '2026-05-01', '10:00'),
        ],
        [
          transport('d1', p.id, 'departure', '2026-04-22', '10:00'),
          transport('d2', p.id, 'departure', '2026-05-08', '10:00'),
        ],
      ),
    ).toEqual([
      { arrival: '2026-04-01', departure: '2026-04-22' },
      { arrival: '2026-05-01', departure: '2026-05-08' },
    ]);
  });

  it('reads a connecting arrival leg and a second leg home as one stay', () => {
    expect(
      pairTransportStays(
        p,
        [
          transport('a1', p.id, 'arrival', '2026-04-01', '08:00'),
          transport('a2', p.id, 'arrival', '2026-04-01', '14:00'),
        ],
        [
          transport('d1', p.id, 'departure', '2026-04-10', '08:00'),
          transport('d2', p.id, 'departure', '2026-04-11', '09:00'),
        ],
      ),
    ).toEqual([{ arrival: '2026-04-01', departure: '2026-04-11' }]);
  });

  it('leaves the unknown end of a stay open', () => {
    expect(
      pairTransportStays(
        p,
        [transport('a1', p.id, 'arrival', '2026-04-12', '10:00')],
        [transport('d1', p.id, 'departure', '2026-04-08', '10:00')],
      ),
    ).toEqual([
      { arrival: null, departure: '2026-04-08' },
      { arrival: '2026-04-12', departure: null },
    ]);
  });

  it("ignores other guests' legs and an instant that does not parse", () => {
    const broken = { ...transport('a1', p.id, 'arrival', '2026-04-01', '10:00'), datetime: 'nope' };
    expect(
      pairTransportStays(
        p,
        [broken as Transport, transport('a2', 'other', 'arrival', '2026-04-01', '10:00')],
        [],
      ),
    ).toEqual([]);
  });
});

describe('resolveGuestStayPeriods', () => {
  it('reads every stated stay, and nothing from travel', () => {
    const ana = returningGuest();
    expect(
      resolveGuestStayPeriods(
        ana,
        [transport('a1', ana.id, 'arrival', '2026-04-10', '10:00')],
        [],
        TRIP_WINDOW,
      ),
    ).toEqual([
      { arrival: '2026-04-01', departure: '2026-04-22' },
      { arrival: '2026-05-01', departure: '2026-05-08' },
      { arrival: '2026-05-24', departure: '2026-05-31' },
    ]);
  });

  it('fills the missing end of a half-dated first stay from the trip when there are more', () => {
    const p = {
      ...person('p1'),
      stayStartDate: iso('2026-04-10'),
      extraStays: [{ startDate: iso('2026-05-01'), endDate: iso('2026-05-03') }],
    };
    expect(resolveGuestStayPeriods(p, [], [], TRIP_WINDOW)).toEqual([
      { arrival: '2026-04-10', departure: '2026-04-25' },
      { arrival: '2026-05-01', departure: '2026-05-03' },
    ]);
  });

  it('reads a guest with no stated stay from their travel, one stay per pair', () => {
    const p = person('p1');
    expect(
      resolveGuestStayPeriods(
        p,
        [
          transport('a1', p.id, 'arrival', '2026-04-06', '10:00'),
          transport('a2', p.id, 'arrival', '2026-04-15', '10:00'),
        ],
        [transport('d1', p.id, 'departure', '2026-04-09', '10:00')],
        TRIP_WINDOW,
      ),
    ).toEqual([
      { arrival: '2026-04-06', departure: '2026-04-09' },
      // No departure after the second arrival: the trip's end.
      { arrival: '2026-04-15', departure: '2026-04-25' },
    ]);
  });

  it('takes a guest with nothing for the whole trip', () => {
    expect(resolveGuestStayPeriods(person('p1'), [], [], TRIP_WINDOW)).toEqual([
      { arrival: '2026-04-05', departure: '2026-04-25' },
    ]);
  });

  it('spans every stay in resolveGuestStayWindow, gaps included', () => {
    expect(resolveGuestStayWindow(returningGuest(), [], [], TRIP_WINDOW)).toEqual({
      arrival: '2026-04-01',
      departure: '2026-05-31',
    });
  });
});

describe('presence of a guest who comes back', () => {
  const query = (dateKey: string) => ({
    person: returningGuest(),
    arrivals: [],
    departures: [],
    assignments: [],
    tripWindow: NO_TRIP_DATES,
    dateKey: iso(dateKey),
  });

  it('is here on a night of each stay', () => {
    expect(isGuestOnSiteOnDate(query('2026-04-21'))).toBe(true);
    expect(isGuestOnSiteOnDate(query('2026-05-01'))).toBe(true);
    expect(isGuestOnSiteOnDate(query('2026-05-30'))).toBe(true);
  });

  it('is not here between two stays', () => {
    expect(isGuestOnSiteOnDate(query('2026-04-25'))).toBe(false);
    expect(isGuestOnSiteDuringDay(query('2026-04-25'))).toBe(false);
    expect(isGuestOnSiteOnDate(query('2026-05-15'))).toBe(false);
  });

  it('is here on each check-out morning, and sleeps elsewhere that night', () => {
    expect(isGuestOnSiteDuringDay(query('2026-04-22'))).toBe(true);
    expect(isGuestOnSiteOnDate(query('2026-04-22'))).toBe(false);
  });

  it('is here between two stays when a room is booked for that night', () => {
    expect(
      isGuestOnSiteOnDate({
        ...query('2026-05-15'),
        assignments: [assignment('ana', '2026-05-15', '2026-05-16')],
      }),
    ).toBe(true);
  });
});
