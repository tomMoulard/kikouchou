/**
 * @fileoverview Tests for the shared byte formatter.
 *
 * @module lib/utils/__tests__/format-bytes.test
 */

import { describe, expect, it } from 'vitest';

import { formatBytes } from '@/lib/utils/format-bytes';

describe('formatBytes', () => {
  it('formats whole bytes below a kibibyte', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(500)).toBe('500 B');
    expect(formatBytes(1023)).toBe('1023 B');
  });

  it('keeps one decimal under 10 of a unit and drops it above', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(48 * 1024)).toBe('48 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(340 * 1024 * 1024)).toBe('340 MB');
  });

  it('formats gigabytes with two decimals', () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.00 GB');
    expect(formatBytes(2.4 * 1024 * 1024 * 1024)).toBe('2.40 GB');
  });

  it('returns an empty string for values it cannot render', () => {
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('');
  });
});
