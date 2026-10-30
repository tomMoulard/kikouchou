/**
 * @fileoverview Tests for the arrival day a guest gave before signing in.
 *
 * The stored value comes back from storage that another tab or an older build
 * may have written, and `usePendingArrival` writes it into a guest row. So a
 * read must turn anything malformed into "nothing pending", and never into a
 * write of a bad date.
 *
 * @module lib/sharing/__tests__/pending-arrival.test
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearPendingArrival,
  getPendingArrivalStorageKey,
  readPendingArrival,
  writePendingArrival,
} from '../pending-arrival';

import type { ISODateString, PersonId, TripId } from '@/types';

// ============================================================================
// localStorage double
// ============================================================================

const entries = new Map<string, string>();

/** Set to make the next `setItem` / `removeItem` throw, as a full quota does. */
let storageThrows = false;

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  writable: true,
  value: {
    get length(): number {
      return entries.size;
    },
    clear: (): void => entries.clear(),
    getItem: (key: string): string | null => entries.get(key) ?? null,
    key: (index: number): string | null => [...entries.keys()][index] ?? null,
    removeItem: (key: string): void => {
      if (storageThrows) throw new DOMException('QuotaExceededError');
      entries.delete(key);
    },
    setItem: (key: string, value: string): void => {
      if (storageThrows) throw new DOMException('QuotaExceededError');
      entries.set(key, value);
    },
  } satisfies Storage,
});

// ============================================================================
// Fixtures
// ============================================================================

const TRIP_ID = 'trip-1' as TripId;
const ARRIVAL = { personId: 'person-1' as PersonId, date: '2026-07-17' as ISODateString };

// ============================================================================
// Tests
// ============================================================================

describe('pending arrival storage', () => {
  beforeEach(() => {
    entries.clear();
    storageThrows = false;
  });

  it('files the answer under the local trip id', () => {
    expect(getPendingArrivalStorageKey(TRIP_ID)).toBe('kikouchou-pending-arrival:trip-1');
  });

  it('reads back what it wrote', () => {
    expect(writePendingArrival(TRIP_ID, ARRIVAL)).toBe(true);

    expect(readPendingArrival(TRIP_ID)).toEqual(ARRIVAL);
    expect(readPendingArrival('trip-2')).toBeUndefined();
  });

  it.each([
    ['not JSON', '{'],
    ['not an object', '"2026-07-17"'],
    ['null', 'null'],
    ['no guest', JSON.stringify({ date: '2026-07-17' })],
    ['an empty guest', JSON.stringify({ personId: '', date: '2026-07-17' })],
    ['no day', JSON.stringify({ personId: 'person-1' })],
    ['a day that is not a date', JSON.stringify({ personId: 'person-1', date: 'friday' })],
    ['a day that does not exist', JSON.stringify({ personId: 'person-1', date: '2026-02-30' })],
  ])('reads %s as nothing pending', (_label, raw) => {
    entries.set(getPendingArrivalStorageKey(TRIP_ID), raw);

    expect(readPendingArrival(TRIP_ID)).toBeUndefined();
  });

  it('forgets the answer', () => {
    writePendingArrival(TRIP_ID, ARRIVAL);

    clearPendingArrival(TRIP_ID);

    expect(readPendingArrival(TRIP_ID)).toBeUndefined();
  });

  it('says when storage refuses the write, and survives a refused clear', () => {
    storageThrows = true;

    expect(writePendingArrival(TRIP_ID, ARRIVAL)).toBe(false);
    expect(() => {
      clearPendingArrival(TRIP_ID);
    }).not.toThrow();
  });
});
