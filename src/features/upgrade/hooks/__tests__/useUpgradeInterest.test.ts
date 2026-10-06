/**
 * @fileoverview Tests for the memory behind the paid-tier question.
 *
 * Three rules, and each one is a decision the module file argues for: a
 * dismissal expires after 30 days, a declared answer never does, and what is
 * stored about an answer is a marker and nothing else — no address, no time.
 *
 * @module features/upgrade/hooks/__tests__/useUpgradeInterest.test
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { installLocalStorageDouble } from '@/test/local-storage';

const storage = installLocalStorageDouble();

import { useUpgradeInterest } from '../useUpgradeInterest';

/** The keys the hook owns, spelled out so a rename shows up as a failure. */
const DECLARED_KEY = 'kikouchou-upgrade-intent-declared';
const DISMISSED_KEY = 'kikouchou-upgrade-prompt-dismissed';

/** 30 days, the cooldown the hook applies to a dismissal. */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

describe('useUpgradeInterest', () => {
  beforeEach(() => {
    storage.clear();
    // `clear` empties the entries and leaves the throwing flag alone, so the
    // last test here would otherwise leak into whatever is added after it.
    storage.setThrowing(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the question to a browser that never answered', () => {
    const { result } = renderHook(() => useUpgradeInterest());

    expect(result.current.isVisible).toBe(true);
    expect(result.current.hasDeclared).toBe(false);
  });

  it('remembers a dismissal', () => {
    const { result } = renderHook(() => useUpgradeInterest());

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.isVisible).toBe(false);
    expect(storage.entries.has(DISMISSED_KEY)).toBe(true);
    expect(renderHook(() => useUpgradeInterest()).result.current.isVisible).toBe(false);
  });

  it('asks again once the dismissal is 30 days old', () => {
    storage.entries.set(
      DISMISSED_KEY,
      (Date.now() - THIRTY_DAYS_MS - 1000).toString(),
    );

    expect(renderHook(() => useUpgradeInterest()).result.current.isVisible).toBe(true);
  });

  it('never asks again once the answer was yes', () => {
    const { result } = renderHook(() => useUpgradeInterest());

    act(() => {
      result.current.declare();
    });

    expect(result.current.hasDeclared).toBe(true);
    expect(renderHook(() => useUpgradeInterest()).result.current.hasDeclared).toBe(true);
  });

  it('keeps no address and no timestamp about the answer', () => {
    const { result } = renderHook(() => useUpgradeInterest());

    act(() => {
      result.current.declare();
    });

    // The rule this test exists for. The address lives on the PostHog person,
    // which is where the waiting list is; the device keeps only "answered".
    const stored = storage.entries.get(DECLARED_KEY);
    expect(stored).toBe('declared');
    expect(stored).not.toMatch(/@/);
    expect(stored).not.toMatch(/^\d+$/);
  });

  it('hides the card on a dismissal even after an answer', () => {
    storage.entries.set(DISMISSED_KEY, Date.now().toString());
    storage.entries.set(DECLARED_KEY, 'declared');

    const { result } = renderHook(() => useUpgradeInterest());

    // The card is an offer, not a receipt: an answer does not pin it to the
    // screen, and the dialog is where an answered question is acknowledged.
    expect(result.current.isVisible).toBe(false);
    expect(result.current.hasDeclared).toBe(true);
  });

  it('shows the question when storage refuses to be read or written', () => {
    storage.setThrowing(true);

    const { result } = renderHook(() => useUpgradeInterest());
    expect(result.current.isVisible).toBe(true);

    // A write that throws must not break the answer the reader just gave: the
    // address has already reached PostHog, and the dialog must still stop
    // asking for this session.
    act(() => {
      result.current.declare();
    });
    expect(result.current.hasDeclared).toBe(true);
  });
});
