/**
 * Unit tests for the account display-name helpers.
 *
 * @module features/auth/__tests__/display-name.test
 */
import { describe, expect, it } from 'vitest';
import type { User } from '@supabase/supabase-js';

import { getAccountDisplayName, getAccountGuestName } from '@/features/auth/display-name';

// ============================================================================
// Test Data Factories
// ============================================================================

/**
 * Builds the slice of a Supabase user these helpers actually read.
 */
function createUser(overrides?: Partial<User>): User {
  return {
    id: 'user-1',
    user_metadata: {},
    ...overrides,
  } as User;
}

// ============================================================================
// getAccountDisplayName
// ============================================================================

describe('getAccountDisplayName', () => {
  it('prefers full_name', () => {
    const user = createUser({ user_metadata: { full_name: 'Tom Moulard', name: 'Tom' } });

    expect(getAccountDisplayName(user)).toBe('Tom Moulard');
  });

  it('falls back to name', () => {
    const user = createUser({ user_metadata: { name: 'Tom' } });

    expect(getAccountDisplayName(user)).toBe('Tom');
  });

  it('returns undefined when the provider sent no name', () => {
    expect(getAccountDisplayName(createUser())).toBeUndefined();
  });

  it('treats an empty string as no name', () => {
    const user = createUser({ user_metadata: { full_name: '', name: '' } });

    expect(getAccountDisplayName(user)).toBeUndefined();
  });

  it('ignores a non-string metadata value', () => {
    // `user_metadata` is provider-shaped and typed open: an object reaching an
    // analytics property or a guest's name is the failure this guards.
    const user = createUser({ user_metadata: { full_name: { first: 'Tom' }, name: 42 } });

    expect(getAccountDisplayName(user)).toBeUndefined();
  });

  it('survives a user with no metadata at all', () => {
    const user = createUser({ user_metadata: undefined as unknown as User['user_metadata'] });

    expect(getAccountDisplayName(user)).toBeUndefined();
  });
});

// ============================================================================
// getAccountGuestName
// ============================================================================

describe('getAccountGuestName', () => {
  it('returns the display name when there is one', () => {
    const user = createUser({
      user_metadata: { full_name: 'Tom Moulard' },
      email: 'tom@example.com',
    });

    expect(getAccountGuestName(user)).toBe('Tom Moulard');
  });

  it("falls back to the email's local part", () => {
    // An email-link sign-in carries no metadata at all, so without this every
    // such account would face a blank "your name" field.
    const user = createUser({ email: 'marie.durand@example.com' });

    expect(getAccountGuestName(user)).toBe('marie.durand');
  });

  it('returns undefined when signed out', () => {
    expect(getAccountGuestName(null)).toBeUndefined();
  });

  it('returns undefined for an account with neither a name nor an email', () => {
    // A wallet or passkey account has both fields empty.
    expect(getAccountGuestName(createUser())).toBeUndefined();
  });

  it('returns undefined rather than an empty local part', () => {
    const user = createUser({ email: '@example.com' });

    expect(getAccountGuestName(user)).toBeUndefined();
  });
});
