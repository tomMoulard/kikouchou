/**
 * @fileoverview Tests for the settings version formatter.
 *
 * @module lib/utils/__tests__/app-version.test
 */

import { describe, expect, it } from 'vitest';

import { formatAppVersion } from '@/lib/utils/app-version';

describe('formatAppVersion', () => {
  it('shortens a bare commit sha to its first seven characters', () => {
    expect(formatAppVersion('4d1f1b3a0c9e5d7f2a8b6c4e0d9f3a1b5c7e9d2f')).toBe('4d1f1b3');
  });

  it('shortens the sha but keeps the ref it is attached to', () => {
    expect(formatAppVersion('main@4d1f1b3a0c9e5d7f2a8b6c4e0d9f3a1b5c7e9d2f')).toBe(
      'main@4d1f1b3',
    );
  });

  it('leaves a semantic version alone', () => {
    expect(formatAppVersion('0.1.0')).toBe('0.1.0');
    expect(formatAppVersion('devel')).toBe('devel');
  });

  it('leaves an already-short sha alone', () => {
    expect(formatAppVersion('main@abc1234')).toBe('main@abc1234');
  });

  it('returns the fallback for an empty or blank value', () => {
    expect(formatAppVersion('')).toBe('devel');
    expect(formatAppVersion('   ')).toBe('devel');
  });
});
