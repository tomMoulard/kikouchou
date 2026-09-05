/**
 * @fileoverview Regression test for the global `afterEach` in `src/test/setup.ts`.
 *
 * Not a test of Vitest. This pins a property of *our* setup file that nothing
 * else can observe: that a spy installed by one test is gone by the next one.
 *
 * The hook used to call `vi.clearAllMocks()` alone. That clears call history
 * and nothing else: the spy stays installed, and in Vitest 4 it keeps its fake
 * implementation as well, since `mockClear` does not reset one. So a
 * `vi.spyOn(console, 'error').mockImplementation(() => {})` went on swallowing
 * errors for every later test in the file.
 *
 * Verified by reverting the hook: the second test below then fails with
 * `expected 'spied' to be 'original'` — the stub was still answering.
 *
 * @module test/mock-restoration.test
 */

import { describe, it, expect, vi } from 'vitest';

// ============================================================================
// Subject
// ============================================================================

/**
 * A stand-in for any object a test might spy on. Deliberately local rather than
 * a real global: the assertion is about the hook, and borrowing `console` or
 * `navigator` would let an unrelated change in another file break this file.
 */
const subject = {
  greet(): string {
    return 'original';
  },
};

// ============================================================================
// Tests
// ============================================================================

describe('global afterEach restores spies', () => {
  // These two run in declaration order — Vitest does not shuffle by default —
  // and that order is the mechanism under test, not an accident.
  it('a test may replace an implementation with vi.spyOn', () => {
    vi.spyOn(subject, 'greet').mockReturnValue('spied');

    expect(subject.greet()).toBe('spied');
    expect(vi.isMockFunction(subject.greet)).toBe(true);
  });

  it('the next test sees the original implementation, not the leftover spy', () => {
    // Under `clearAllMocks` alone this returned 'spied': the spy survived with
    // its fake implementation intact. That is the bug this file exists for.
    expect(subject.greet()).toBe('original');
    expect(vi.isMockFunction(subject.greet)).toBe(false);
  });
});
