/**
 * @fileoverview The provider logos, inlined.
 *
 * Loading these from a provider's CDN would tell that provider this page is a
 * sign-in screen before the user has chosen anything, and would render as a
 * broken image offline — on a screen whose whole job is to explain that signing
 * in is the one thing needing a network. A few paths cost less than either.
 *
 * A provider with no artwork here still gets a working button with a neutral
 * key icon, because the list comes from the backend at run time and may name
 * something this file has never heard of. Adding a logo is then a cosmetic
 * follow-up, never what stands between a dashboard change and a usable button.
 *
 * @module features/auth/provider-marks
 */

import { type ReactElement, memo } from 'react';
import { KeyRound } from 'lucide-react';

// ============================================================================
// Type Definitions
// ============================================================================

interface ProviderMarkProps {
  /** Provider id as the project reported it, e.g. `'spotify'`. */
  readonly providerId: string;
}

// ============================================================================
// Marks
// ============================================================================

function GoogleMark(): ReactElement {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91a8.78 8.78 0 0 0 2.69-6.62Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86a5.36 5.36 0 0 1-5.03-3.71H1.05v2.34A9 9 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.97 10.71A5.4 5.4 0 0 1 3.69 9c0-.6.1-1.17.28-1.71V4.96H1.05A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.34Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 1.05 4.96l3.01 2.33A5.36 5.36 0 0 1 9 3.58Z"
      />
    </svg>
  );
}

/**
 * One colour, `currentColor`, as Apple's guidelines draw it: black on a light
 * button, white on a dark one, following the button's own text.
 */
function AppleMark(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09ZM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
      />
    </svg>
  );
}

function SpotifyMark(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true" focusable="false">
      <path
        fill="#1DB954"
        d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0Zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.24-.899-.6-.12-.421.24-.78.6-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.241 1.081Zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.481.78.241 1.2Zm.12-3.36C15.24 8.4 8.4 8.16 4.8 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.76-1.02 16.14 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3Z"
      />
    </svg>
  );
}

/**
 * The marks this app ships, by provider id.
 *
 * Keyed by the raw id rather than by the stripped base name used for display,
 * because a `_oidc` variant may well want its own artwork one day.
 */
const MARKS: Readonly<Record<string, () => ReactElement>> = {
  google: GoogleMark,
  apple: AppleMark,
  spotify: SpotifyMark,
};

// ============================================================================
// Component
// ============================================================================

/**
 * The logo for a provider, or a neutral key for one we have no artwork for.
 *
 * Always `aria-hidden`: the button's own text names the provider, and a second
 * announcement of "Google" would only repeat it.
 *
 * @example
 * ```tsx
 * <ProviderMark providerId="spotify" />
 * ```
 */
export const ProviderMark = memo(function ProviderMark({
  providerId,
}: ProviderMarkProps): ReactElement {
  const Mark = MARKS[providerId];
  if (Mark) {
    return <Mark />;
  }
  return <KeyRound className="size-4" aria-hidden="true" />;
});
