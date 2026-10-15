/**
 * @fileoverview Tests for the guest identity store — who this browser is on a
 * shared trip.
 *
 * The reads were already exercised through the components that call them; the
 * writes are new, and both of their failure paths matter. `writeGuestIdentity`
 * reports a refusal instead of swallowing it, because the settings card has to
 * tell the user their choice will not survive a reload. And "nobody in
 * particular" has to be an absent key rather than an emptied payload: an
 * identity with a blank `personId` still parses, so every consumer would go on
 * believing this browser is somebody.
 *
 * @module lib/sharing/__tests__/guest-identity.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearGuestIdentity,
  getGuestIdentityStorageKey,
  getTripGuestPersonId,
  readGuestIdentity,
  writeGuestIdentity,
} from '../guest-identity';

import type { PersonId, ShareId, TripId } from '@/types';

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

const SHARE_ID = 'share-abc' as ShareId;
const TRIP_ID = 'trip-1' as TripId;
const PERSON_ID = 'person-1' as PersonId;

const trip = { id: TRIP_ID, shareId: SHARE_ID };

// ============================================================================
// Tests
// ============================================================================

describe('guest identity storage', () => {
  beforeEach(() => {
    entries.clear();
    storageThrows = false;
  });

  it('round-trips an identity through the same key the wizard uses', () => {
    expect(writeGuestIdentity(SHARE_ID, { personId: PERSON_ID, tripId: TRIP_ID })).toBe(true);

    expect(entries.has(getGuestIdentityStorageKey(SHARE_ID))).toBe(true);
    expect(readGuestIdentity(SHARE_ID)).toEqual({
      personId: PERSON_ID,
      tripId: TRIP_ID,
    });
    expect(getTripGuestPersonId(trip)).toBe(PERSON_ID);
  });

  it('ignores an identity stored for a different trip under the same share key', () => {
    writeGuestIdentity(SHARE_ID, {
      personId: PERSON_ID,
      tripId: 'trip-2' as TripId,
    });

    expect(getTripGuestPersonId(trip)).toBeUndefined();
  });

  it('removes the key rather than blanking the payload when clearing', () => {
    writeGuestIdentity(SHARE_ID, { personId: PERSON_ID, tripId: TRIP_ID });

    expect(clearGuestIdentity(SHARE_ID)).toBe(true);
    expect(entries.has(getGuestIdentityStorageKey(SHARE_ID))).toBe(false);
    expect(readGuestIdentity(SHARE_ID)).toBeUndefined();
    expect(getTripGuestPersonId(trip)).toBeUndefined();
  });

  it('reports success when clearing an identity that was never stored', () => {
    expect(clearGuestIdentity(SHARE_ID)).toBe(true);
  });

  it('leaves other share keys alone', () => {
    writeGuestIdentity(SHARE_ID, { personId: PERSON_ID, tripId: TRIP_ID });
    writeGuestIdentity('share-other', {
      personId: 'person-2' as PersonId,
      tripId: 'trip-2' as TripId,
    });

    clearGuestIdentity(SHARE_ID);

    expect(readGuestIdentity('share-other')).toEqual({
      personId: 'person-2',
      tripId: 'trip-2',
    });
  });

  it('reports a refused write instead of throwing', () => {
    storageThrows = true;

    expect(writeGuestIdentity(SHARE_ID, { personId: PERSON_ID, tripId: TRIP_ID })).toBe(
      false,
    );
    expect(entries.size).toBe(0);
  });

  it('reports a refused clear instead of throwing', () => {
    writeGuestIdentity(SHARE_ID, { personId: PERSON_ID, tripId: TRIP_ID });
    storageThrows = true;

    expect(clearGuestIdentity(SHARE_ID)).toBe(false);
    // The caller is told nothing changed, and nothing did.
    expect(entries.has(getGuestIdentityStorageKey(SHARE_ID))).toBe(true);
  });

  it('does not touch storage when there is no window', () => {
    const setItem = vi.spyOn(globalThis.localStorage, 'setItem');
    const original = globalThis.window;
    // @ts-expect-error — deleting the jsdom global is the only way to reach the
    // SSR guard, and it is restored below.
    delete globalThis.window;

    try {
      expect(writeGuestIdentity(SHARE_ID, { personId: PERSON_ID, tripId: TRIP_ID })).toBe(
        false,
      );
      expect(clearGuestIdentity(SHARE_ID)).toBe(false);
      expect(setItem).not.toHaveBeenCalled();
    } finally {
      globalThis.window = original;
      setItem.mockRestore();
    }
  });
});
