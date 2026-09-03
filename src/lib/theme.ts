/**
 * @fileoverview Theme preference: the values, where they are stored, and how
 * they reach the DOM before React has rendered anything.
 *
 * The theme itself is owned by `next-themes` (mounted in `App.tsx`). This
 * module exists for the two things `next-themes` cannot do here:
 *
 * 1. Give the rest of the app a typed vocabulary for the three preferences,
 *    rather than passing bare strings around.
 * 2. Paint the stored theme before the first frame. `next-themes` normally
 *    solves that with a blocking inline script emitted during SSR; this app is
 *    a client-only Vite SPA, so its script only runs when React commits the
 *    provider — and `main.tsx` awaits i18n and a database open (up to 3s when
 *    IndexedDB is blocked behind another tab) before it renders at all.
 *    Without this, a dark-mode user gets a full white page for that window.
 *
 * @module lib/theme
 */

// ============================================================================
// Constants
// ============================================================================

/**
 * localStorage key holding the preference.
 *
 * Must be the `storageKey` given to `ThemeProvider`; passing this constant
 * there is what keeps the two readers of the value in agreement.
 */
export const THEME_STORAGE_KEY = 'theme';

/**
 * The classes written on `<html>`. These are the *resolved* themes, so
 * `system` is deliberately absent: it is a preference, never a class.
 */
export const THEME_CLASSES = ['light', 'dark'] as const;

/**
 * Every preference a user can choose, in the order the settings toggle shows
 * them: the two concrete choices together, then "follow the device" last, so
 * it reads as the fallback it is.
 */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;

/**
 * A resolved theme — what is actually on screen.
 */
export type ResolvedTheme = (typeof THEME_CLASSES)[number];

/**
 * A stored preference, which may defer to the operating system.
 */
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * Preference used when nothing has been stored yet.
 */
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system';

// ============================================================================
// Functions
// ============================================================================

/**
 * Narrows an unknown value to a theme preference.
 *
 * @param value - Candidate value, typically read off localStorage
 * @returns Whether the value is one of the supported preferences
 */
export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === 'string' &&
    (THEME_PREFERENCES as readonly string[]).includes(value)
  );
}

/**
 * Reads the stored preference.
 *
 * @returns The stored preference, or the default when absent or unreadable
 *
 * @remarks
 * `localStorage` throws outright in Safari's private mode and when a browser
 * is configured to block site data, so the read is guarded rather than
 * assumed.
 */
export function readStoredThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

/**
 * Resolves a preference against the operating system setting.
 *
 * @param preference - The stored preference
 * @returns The theme to actually paint
 */
export function resolveThemePreference(
  preference: ThemePreference,
): ResolvedTheme {
  if (preference !== 'system') {
    return preference;
  }

  if (typeof window.matchMedia !== 'function') {
    return 'light';
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

/**
 * Writes the stored theme onto `<html>`.
 *
 * Called once at module-evaluation time from `App.tsx`, which is early enough
 * to beat the first paint. `next-themes` then re-applies the same class when
 * it mounts, which is a no-op; the two agree because both read
 * {@link THEME_STORAGE_KEY}.
 */
export function applyStoredTheme(): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return;
  }

  const resolved = resolveThemePreference(readStoredThemePreference()),
    root = document.documentElement;

  root.classList.remove(...THEME_CLASSES);
  root.classList.add(resolved);
  // Matches `next-themes`' `enableColorScheme`, so native widgets (scrollbars,
  // date pickers, form controls) are dark from the first frame too.
  root.style.colorScheme = resolved;
}
