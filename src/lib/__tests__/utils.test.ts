/**
 * @fileoverview Tests for the root utility module (cn function).
 * @module lib/__tests__/utils.test
 */

import { describe, expect, it } from 'vitest';
import { cn } from '@/lib/utils';

// ============================================================================
// Tests
// ============================================================================

/* eslint-disable kikouchou/no-raw-palette-class -- Fixtures for tailwind-merge's conflict resolution, not styling: the whole point of `cn('text-red-500', 'text-blue-500')` is which of two classes in the same conflict group survives, and a semantic token would obscure that. */
describe('cn', () => {
  it('returns empty string for no arguments', () => {
    expect(cn()).toBe('');
  });

  it('returns single class unchanged', () => {
    expect(cn('text-red-500')).toBe('text-red-500');
  });

  it('merges multiple classes', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1');
  });

  it('handles conditional classes via clsx', () => {
    const falsy = false as boolean;
    const truthy = true as boolean;
    expect(cn('base', falsy && 'hidden', 'extra')).toBe('base extra');
    expect(cn('base', truthy && 'visible', 'extra')).toBe('base visible extra');
  });

  it('resolves Tailwind conflicts (last wins)', () => {
    const result = cn('px-2', 'px-4');
    expect(result).toBe('px-4');
  });

  it('resolves conflicting text colors', () => {
    const result = cn('text-red-500', 'text-blue-500');
    expect(result).toBe('text-blue-500');
  });

  it('handles undefined and null values', () => {
    expect(cn('base', undefined, null, 'extra')).toBe('base extra');
  });

  it('handles array inputs', () => {
    expect(cn(['px-2', 'py-1'])).toBe('px-2 py-1');
  });

  it('handles object inputs (clsx-style)', () => {
    expect(cn({ 'bg-red-500': true, 'bg-blue-500': false })).toBe('bg-red-500');
  });

  it('merges complex responsive classes', () => {
    const result = cn('text-sm md:text-base', 'text-lg');
    expect(result).toBe('md:text-base text-lg');
  });
});
/* eslint-enable kikouchou/no-raw-palette-class */
