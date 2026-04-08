/**
 * @fileoverview Unit tests for guest presence helpers.
 *
 * @module features/persons/utils/__tests__/guest-presence.test
 */

import { describe, expect, it } from 'vitest';

import type { HexColor, ISODateString, Person, Transport } from '@/types';

import {
  buildGuestIdsByTripDateMap,
  deriveGuestStayDateBounds,
  isGuestPresentOnDate,
  listGuestsPresentOnDate,
} from '../guest-presence';

function iso(s: string): ISODateString {
  return s as ISODateString;
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
    const arrivals: Transport[] = [
      {
        id: 'a1' as Transport['id'],
        tripId: 't1' as Transport['tripId'],
        personId: p.id,
        type: 'arrival',
        datetime: '2026-04-12T10:00:00.000Z',
        location: 'X',
        needsPickup: false,
      },
    ];
    const departures: Transport[] = [
      {
        id: 'd1' as Transport['id'],
        tripId: 't1' as Transport['tripId'],
        personId: p.id,
        type: 'departure',
        datetime: '2026-04-18T15:00:00.000Z',
        location: 'Y',
        needsPickup: false,
      },
    ];
    expect(deriveGuestStayDateBounds(p, arrivals, departures)).toEqual({
      arrival: iso('2026-04-12'),
      departure: iso('2026-04-18'),
    });
  });
});

describe('isGuestPresentOnDate', () => {
  it('matches check-in inclusive, check-out exclusive', () => {
    const p = person('p1', { start: '2026-04-10', end: '2026-04-20' });
    expect(isGuestPresentOnDate(p, [], [], iso('2026-04-09'))).toBe(false);
    expect(isGuestPresentOnDate(p, [], [], iso('2026-04-10'))).toBe(true);
    expect(isGuestPresentOnDate(p, [], [], iso('2026-04-19'))).toBe(true);
    expect(isGuestPresentOnDate(p, [], [], iso('2026-04-20'))).toBe(false);
  });
});

describe('listGuestsPresentOnDate', () => {
  it('filters to guests on that night', () => {
    const a = person('a', { start: '2026-04-07', end: '2026-04-26' });
    const b = person('b', { start: '2026-04-20', end: '2026-04-22' });
    const list = listGuestsPresentOnDate([a, b], [], [], iso('2026-04-21'));
    expect(list.map((x) => x.id)).toEqual([a.id, b.id]);
  });
});

describe('buildGuestIdsByTripDateMap', () => {
  it('maps each trip day to present guest ids', () => {
    const a = person('alice', { start: '2026-04-07', end: '2026-04-10' });
    const b = person('bob', { start: '2026-04-09', end: '2026-04-12' });
    const map = buildGuestIdsByTripDateMap([a, b], [], [], iso('2026-04-08'), iso('2026-04-11'));
    // Check-out day is not a stay night (alice leaves Apr 10; bob still there Apr 10 night).
    expect([...(map.get(iso('2026-04-08')) ?? [])].sort()).toEqual([a.id].sort());
    expect([...(map.get(iso('2026-04-09')) ?? [])].sort()).toEqual([a.id, b.id].sort());
    expect([...(map.get(iso('2026-04-10')) ?? [])].sort()).toEqual([b.id].sort());
    expect([...(map.get(iso('2026-04-11')) ?? [])].sort()).toEqual([b.id].sort());
  });
});
