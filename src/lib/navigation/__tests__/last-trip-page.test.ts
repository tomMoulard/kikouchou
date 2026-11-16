/**
 * @fileoverview Tests for the page of a trip this device showed last.
 *
 * @module lib/navigation/__tests__/last-trip-page.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getLastTripPageStorageKey,
  parseTripPagePath,
  readLastTripPage,
  rememberTripPage,
} from '../last-trip-page';

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseTripPagePath', () => {
  it.each([
    ['/trips/abc/calendar', 'calendar'],
    ['/trips/abc/rooms', 'rooms'],
    ['/trips/abc/transports/vehicles', 'transports/vehicles'],
    ['/trips/abc/money/', 'money'],
    ['/trips/abc/edit', 'edit'],
  ])('reads %s as the page %s', (pathname, page) => {
    expect(parseTripPagePath(pathname)).toEqual({ tripId: 'abc', page });
  });

  it.each([
    '/',
    '/trips',
    '/trips/new',
    '/trips/abc',
    '/trips/abc/unknown',
    '/trips/abc/rooms/extra',
    '/join/token',
    '/settings',
  ])('ignores %s', (pathname) => {
    expect(parseTripPagePath(pathname)).toBeUndefined();
  });
});

describe('rememberTripPage and readLastTripPage', () => {
  it('reads back the last page stored for a trip', () => {
    rememberTripPage('/trips/abc/calendar');
    rememberTripPage('/trips/abc/rooms');

    expect(readLastTripPage('abc')).toBe('rooms');
  });

  it('keeps each trip apart', () => {
    rememberTripPage('/trips/abc/rooms');
    rememberTripPage('/trips/def/money');

    expect(readLastTripPage('abc')).toBe('rooms');
    expect(readLastTripPage('def')).toBe('money');
  });

  it('answers nothing for a trip this device never showed', () => {
    expect(readLastTripPage('abc')).toBeUndefined();
  });

  it('stores nothing for a path that is not a page of a trip', () => {
    rememberTripPage('/trips/abc');
    rememberTripPage('/settings');

    expect(window.localStorage.length).toBe(0);
  });

  it('reads a page it does not know as none', () => {
    window.localStorage.setItem(getLastTripPageStorageKey('abc'), '../../settings');

    expect(readLastTripPage('abc')).toBeUndefined();
  });

  it('answers nothing when storage refuses the read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    expect(readLastTripPage('abc')).toBeUndefined();
  });

  it('does not throw when storage refuses the write', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });

    expect(() => {
      rememberTripPage('/trips/abc/rooms');
    }).not.toThrow();
  });
});
