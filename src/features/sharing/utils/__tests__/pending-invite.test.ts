/**
 * @fileoverview The trip a sign-in was started for, across the redirect.
 *
 * @module features/sharing/utils/__tests__/pending-invite.test
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  PENDING_INVITE_KEY,
  PENDING_INVITE_TTL_MS,
  forgetPendingInvite,
  readPendingInvite,
  rememberPendingInvite,
} from '../pending-invite';
import type { TripId } from '@/types';

const TRIP = 'trip-1' as TripId;
const NOW = 1_800_000_000_000;

/** jsdom is configured without web storage here, so the test brings one. */
function installStorage(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
}

function installMemoryStorage(): void {
  const store = new Map<string, string>();
  installStorage({
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  });
}

beforeEach(() => {
  installMemoryStorage();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('pending invite', () => {
  it('reads back the trip it was told, while it is recent', () => {
    rememberPendingInvite(TRIP, NOW);

    expect(JSON.parse(localStorage.getItem(PENDING_INVITE_KEY) ?? '')).toEqual({
      tripId: TRIP,
      savedAt: NOW,
    });
    expect(readPendingInvite(NOW + PENDING_INVITE_TTL_MS)).toBe(TRIP);
    // Reading does not consume it: the caller forgets it once it acted.
    expect(localStorage.getItem(PENDING_INVITE_KEY)).not.toBeNull();
  });

  it('stamps the current time by default', () => {
    rememberPendingInvite(TRIP);

    expect(readPendingInvite()).toBe(TRIP);
  });

  it('drops an entry once it is too old to act on', () => {
    rememberPendingInvite(TRIP, NOW);

    expect(readPendingInvite(NOW + PENDING_INVITE_TTL_MS + 1)).toBeNull();
    expect(localStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('drops an entry stamped in the future', () => {
    rememberPendingInvite(TRIP, NOW);

    expect(readPendingInvite(NOW - 1)).toBeNull();
    expect(localStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('is null when nothing was remembered', () => {
    expect(readPendingInvite(NOW)).toBeNull();
  });

  it.each([
    ['not JSON', '{'],
    ['not an object', '"trip-1"'],
    ['null', 'null'],
    ['no trip', JSON.stringify({ savedAt: NOW })],
    ['no time', JSON.stringify({ tripId: TRIP })],
    ['an empty trip', JSON.stringify({ tripId: '', savedAt: NOW })],
    ['a numeric trip', JSON.stringify({ tripId: 1, savedAt: NOW })],
    ['a text time', JSON.stringify({ tripId: TRIP, savedAt: String(NOW) })],
  ])('drops an entry that is %s', (_label, raw) => {
    localStorage.setItem(PENDING_INVITE_KEY, raw);

    expect(readPendingInvite(NOW)).toBeNull();
    expect(localStorage.getItem(PENDING_INVITE_KEY)).toBeNull();
  });

  it('forgets on request', () => {
    rememberPendingInvite(TRIP, NOW);

    forgetPendingInvite();

    expect(readPendingInvite(NOW)).toBeNull();
  });

  it('survives storage that throws', () => {
    const blocked = (): never => {
      throw new Error('blocked');
    };
    installStorage({ getItem: blocked, setItem: blocked, removeItem: blocked });

    expect(() => {
      rememberPendingInvite(TRIP, NOW);
    }).not.toThrow();
    expect(readPendingInvite(NOW)).toBeNull();
    expect(() => {
      forgetPendingInvite();
    }).not.toThrow();
  });
});
