/**
 * @fileoverview How an account is named to a human.
 *
 * Two callers want this and they want subtly different answers, which is why
 * both live here rather than being re-derived at each site: analytics wants the
 * name the provider actually returned and nothing else, while a form
 * pre-filling "who you are" is better off with the email's local part than with
 * an empty field.
 *
 * @module features/auth/display-name
 */

import type { User } from '@supabase/supabase-js';

// ============================================================================
// Constants
// ============================================================================

/**
 * The `user_metadata` keys a display name may arrive under, in preference
 * order. The record is provider-shaped and typed open, so every read is
 * type-guarded: a provider that ever sends an object here must not put one into
 * an analytics property or a guest's name.
 */
const DISPLAY_NAME_KEYS = ['full_name', 'name'] as const;

// ============================================================================
// Public API
// ============================================================================

/**
 * The account's display name, as the provider returned it.
 *
 * Returns `undefined` rather than inventing one — this is what PostHog is told,
 * and a fabricated name there is worse than no name.
 *
 * @param user - The signed-in Supabase user
 * @returns The provider-supplied name, or undefined when it sent none
 */
export function getAccountDisplayName(user: User): string | undefined {
  const metadata: Record<string, unknown> = user.user_metadata ?? {};

  for (const key of DISPLAY_NAME_KEYS) {
    const value = metadata[key];
    if (typeof value === 'string' && value !== '') {
      return value;
    }
  }

  return undefined;
}

/**
 * A label to pre-fill "this is me" with, for the signed-in user.
 *
 * Falls back to the email's local part, which is a far better first guess at a
 * guest's name than a blank field: an email-link sign-in carries no metadata at
 * all, so {@link getAccountDisplayName} alone would leave the field empty for
 * every account that did not come in through an OAuth provider.
 *
 * Still `undefined` when there is nothing to go on — a wallet or passkey
 * account has neither a name nor an address, and the field is then the user's
 * to fill in.
 *
 * @param user - The signed-in Supabase user, or null when signed out
 * @returns A human-readable label, or undefined when the account carries none
 */
export function getAccountGuestName(user: User | null): string | undefined {
  if (!user) {
    return undefined;
  }

  const displayName = getAccountDisplayName(user);
  if (displayName !== undefined) {
    return displayName;
  }

  const localPart = (user.email ?? '').split('@')[0]?.trim() ?? '';
  return localPart === '' ? undefined : localPart;
}
