/**
 * @fileoverview Turns a provider id from the backend into something a person
 * can read.
 *
 * The ids arrive from `GET /auth/v1/settings` at run time, so this has to cope
 * with one it has never seen — that is the entire point of discovering the list
 * rather than hard-coding it. Derivation is therefore the normal path and the
 * override table is the exception: `discord` → "Discord" and `twitch` →
 * "Twitch" need no entry, while `github` → "Github" is wrong enough to fix.
 *
 * Deliberately not translated. These are brand names, the same in every locale,
 * and `t('auth.providers.spotify')` would be a key that has to be added by hand
 * for each newly enabled provider — a code change, which is the thing this
 * feature exists to avoid.
 *
 * @module features/auth/provider-names
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * The ids whose display name cannot be derived from the id itself.
 *
 * Keyed *after* the `_oidc` suffix is stripped, so `linkedin_oidc` and
 * `linkedin` share one entry.
 */
const DISPLAY_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  azure: 'Microsoft Azure',
  fly: 'Fly.io',
  github: 'GitHub',
  gitlab: 'GitLab',
  linkedin: 'LinkedIn',
  workos: 'WorkOS',
  x: 'X',
};

/**
 * Supabase exposes some providers twice, the `_oidc` variant being the modern
 * implementation of the same brand. The user is signing in with LinkedIn either
 * way and does not need to know which protocol won.
 */
const PROTOCOL_SUFFIX = /_oidc$/;

// ============================================================================
// Public API
// ============================================================================

/**
 * A brand name for a provider id.
 *
 * @param providerId - An id as the project reported it, e.g. `'spotify'`.
 * @returns The name to show, e.g. `'Spotify'`. Never empty: an id nobody has
 *   ever seen still produces a capitalised word.
 *
 * @example
 * ```ts
 * getProviderDisplayName('google');       // 'Google'
 * getProviderDisplayName('linkedin_oidc') // 'LinkedIn'
 * getProviderDisplayName('some_new_idp'); // 'Some New Idp'
 * ```
 */
export function getProviderDisplayName(providerId: string): string {
  const base = providerId.replace(PROTOCOL_SUFFIX, '');
  return DISPLAY_NAME_OVERRIDES[base] ?? titleise(base);
}

function titleise(value: string): string {
  return value
    .split(/[_-]/)
    .filter((word) => word.length > 0)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join(' ');
}
