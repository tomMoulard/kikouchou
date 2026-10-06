/**
 * @fileoverview `lib/analytics/landing-handoff`: continuing the landing
 * page's PostHog person without taking over anybody else's.
 *
 * jsdom gives a real `history`, so each test puts a URL in the address bar
 * with `replaceState` and reads it back after the call.
 *
 * @module lib/analytics/__tests__/landing-handoff.test
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  HANDOFF_PARAMS,
  MAX_HANDOFF_AGE_MS,
  takeLandingBootstrap,
} from '@/lib/analytics/landing-handoff';
import { installLocalStorageDouble } from '@/test/local-storage';

// ============================================================================
// Fixtures
// ============================================================================

const TOKEN = 'phc_test_token';
const STORAGE_NAME = `ph_${TOKEN}_posthog`;
const NOW = 1_790_000_000_000;
const DISTINCT_ID = '0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
const SESSION_ID = '0199a1b2-c3d4-7e5f-8a9b-aaaaaaaaaaaa';

const storage = installLocalStorageDouble();

/** Puts a landing hand-off link in the address bar. */
function arriveWith(overrides: Record<string, string | null> = {}, rest = ''): void {
  const params = new URLSearchParams(rest);
  const values: Record<string, string | null> = {
    [HANDOFF_PARAMS.distinctId]: DISTINCT_ID,
    [HANDOFF_PARAMS.sessionId]: SESSION_ID,
    [HANDOFF_PARAMS.issuedAt]: String(NOW - 5_000),
    ...overrides,
  };
  for (const [name, value] of Object.entries(values)) {
    if (value !== null) {
      params.set(name, value);
    }
  }
  window.history.replaceState(null, '', `/trips?${params.toString()}#top`);
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
  storage.clear();
  document.cookie = `${STORAGE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/`;
});

// ============================================================================
// Tests
// ============================================================================

describe('takeLandingBootstrap', () => {
  it('returns the landing ids for a first visit', () => {
    arriveWith();

    expect(takeLandingBootstrap(TOKEN, NOW)).toEqual({
      distinctID: DISTINCT_ID,
      sessionID: SESSION_ID,
    });
  });

  it('removes the parameters and keeps the rest of the address', () => {
    arriveWith({}, 'install=1');

    takeLandingBootstrap(TOKEN, NOW);

    expect(window.location.pathname).toBe('/trips');
    expect(window.location.search).toBe('?install=1');
    expect(window.location.hash).toBe('#top');
  });

  it('removes the parameters even when it does not use them', () => {
    arriveWith({ [HANDOFF_PARAMS.distinctId]: 'not-a-uuid' });

    expect(takeLandingBootstrap(TOKEN, NOW)).toBeUndefined();
    expect(window.location.search).toBe('');
  });

  it('leaves an address without hand-off parameters alone', () => {
    window.history.replaceState(null, '', '/?install=1');

    expect(takeLandingBootstrap(TOKEN, NOW)).toBeUndefined();
    expect(window.location.search).toBe('?install=1');
  });

  it.each([
    ['a distinct id that is not a UUID', { [HANDOFF_PARAMS.distinctId]: 'marie@example.com' }],
    ['a missing session id', { [HANDOFF_PARAMS.sessionId]: null }],
    ['a missing stamp', { [HANDOFF_PARAMS.issuedAt]: null }],
    ['a stamp that is not a number', { [HANDOFF_PARAMS.issuedAt]: 'yesterday' }],
  ])('ignores %s', (_label, overrides) => {
    arriveWith(overrides);

    expect(takeLandingBootstrap(TOKEN, NOW)).toBeUndefined();
  });

  it('ignores a link older than the limit, so a forwarded link is not an identity', () => {
    arriveWith({ [HANDOFF_PARAMS.issuedAt]: String(NOW - MAX_HANDOFF_AGE_MS - 1) });

    expect(takeLandingBootstrap(TOKEN, NOW)).toBeUndefined();
  });

  it('ignores a stamp far in the future', () => {
    arriveWith({ [HANDOFF_PARAMS.issuedAt]: String(NOW + 5 * 60 * 1000) });

    expect(takeLandingBootstrap(TOKEN, NOW)).toBeUndefined();
  });

  it('keeps an identity already stored in localStorage', () => {
    localStorage.setItem(STORAGE_NAME, '{"distinct_id":"earlier"}');
    arriveWith();

    expect(takeLandingBootstrap(TOKEN, NOW)).toBeUndefined();
    expect(window.location.search).toBe('');
  });

  it('keeps an identity already stored in the cookie', () => {
    document.cookie = `${STORAGE_NAME}=${encodeURIComponent('{"distinct_id":"earlier"}')}; path=/`;
    arriveWith();

    expect(takeLandingBootstrap(TOKEN, NOW)).toBeUndefined();
  });

  it("does not mistake another project's identity for this one", () => {
    localStorage.setItem('ph_phc_other_posthog', '{"distinct_id":"elsewhere"}');
    arriveWith();

    expect(takeLandingBootstrap(TOKEN, NOW)).toEqual({
      distinctID: DISTINCT_ID,
      sessionID: SESSION_ID,
    });
  });
});
