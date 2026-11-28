/**
 * @fileoverview The reward hold, and the held unlocks it keeps in storage so a
 * sign-in that leaves the page does not lose them.
 *
 * @module lib/achievements/__tests__/reward-hold.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  areRewardsHeld,
  HELD_REWARDS_KEY,
  HELD_REWARDS_TTL_MS,
  holdRewards,
  onRewardsReleased,
  rememberHeldRewards,
  takeHeldRewards,
} from '../reward-hold';

const NOW = 1_800_000_000_000;

beforeEach(() => {
  localStorage.removeItem(HELD_REWARDS_KEY);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('holdRewards', () => {
  it('holds until every holder lets go, and tells the listeners once', () => {
    const listener = vi.fn(),
      unsubscribe = onRewardsReleased(listener),
      first = holdRewards(),
      second = holdRewards();

    first();
    first();
    expect(areRewardsHeld()).toBe(true);
    expect(listener).not.toHaveBeenCalled();

    second();
    expect(areRewardsHeld()).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
});

describe('held unlocks in storage', () => {
  it('gives back what it was told to remember, once', () => {
    rememberHeldRewards(['trips_1', 'polyglot'], NOW);

    expect(takeHeldRewards(NOW + 1000)).toEqual(['trips_1', 'polyglot']);
    expect(takeHeldRewards(NOW + 1000)).toEqual([]);
  });

  it('forgets on an empty list', () => {
    rememberHeldRewards(['trips_1'], NOW);
    rememberHeldRewards([], NOW);

    expect(localStorage.getItem(HELD_REWARDS_KEY)).toBeNull();
  });

  it('drops a message older than the sign-in window, or from the future', () => {
    rememberHeldRewards(['trips_1'], NOW);
    expect(takeHeldRewards(NOW + HELD_REWARDS_TTL_MS + 1)).toEqual([]);

    rememberHeldRewards(['trips_1'], NOW);
    expect(takeHeldRewards(NOW - 1)).toEqual([]);
  });

  it('reads the stored value like remote input', () => {
    localStorage.setItem(
      HELD_REWARDS_KEY,
      JSON.stringify({ keys: ['trips_1', 'not_a_key', 42, 'trips_1'], savedAt: NOW }),
    );
    expect(takeHeldRewards(NOW)).toEqual(['trips_1']);

    for (const raw of ['not json', 'null', '"text"', JSON.stringify({ keys: 'x', savedAt: NOW })]) {
      localStorage.setItem(HELD_REWARDS_KEY, raw);
      expect(takeHeldRewards(NOW)).toEqual([]);
    }
  });

  it('costs the message, never the page, when storage refuses', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => rememberHeldRewards(['trips_1'], NOW)).not.toThrow();
    expect(takeHeldRewards(NOW)).toEqual([]);
  });
});
