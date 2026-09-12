/**
 * Tests for guestInitial.
 *
 * @module features/persons/utils/__tests__/guest-initial.test
 */
import { describe, it, expect } from 'vitest';

import { guestInitial } from '../guest-initial';

describe('guestInitial', () => {
  it('takes the first letter of the name', () => {
    expect(guestInitial('Marc')).toBe('M');
  });

  it('upper-cases a lower-case name', () => {
    // The guest list has both; the column should not look ragged.
    expect(guestInitial('cloé')).toBe('C');
  });

  it('keeps an accented first letter as it is written', () => {
    expect(guestInitial('Aurélia')).toBe('A');
    expect(guestInitial('Élodie')).toBe('É');
  });

  it('takes the first character of the name, not of every word', () => {
    // 40px is one letter's worth of space, not two.
    expect(guestInitial('Jean Pierre')).toBe('J');
  });

  it('ignores surrounding whitespace', () => {
    expect(guestInitial('  Tom  ')).toBe('T');
  });

  it('returns the whole first character outside the basic plane', () => {
    // `charAt` would have returned half a surrogate pair and rendered as �.
    expect(guestInitial('😀 Ann')).toBe('😀');
  });

  it('returns nothing for a blank name', () => {
    expect(guestInitial('')).toBe('');
    expect(guestInitial('   ')).toBe('');
  });
});
