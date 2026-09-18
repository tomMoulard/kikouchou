/**
 * @fileoverview The sign-in page: every way into an account, in one place.
 *
 * Separate from `SignInDialog` on purpose. The dialog is an interruption — it
 * appears over the trip you were trying to share, and its copy argues for
 * having an account at all. This page is a destination: you came here from
 * Settings or from a link, you have already decided, and what you need is the
 * list of options and nothing else in the way.
 *
 * Both render the same `ProviderList`, which builds itself from what the
 * project reports at `/auth/v1/settings`. Enabling Spotify in the dashboard
 * therefore changes this page with no edit to it.
 *
 * A cold load of `/signin` works on GitHub Pages because `vite.config.ts` copies
 * `index.html` to `404.html`; see `githubPagesSpaFallback`. Sign-in itself still
 * comes *back* to the app root rather than here — see `resolveRedirectTo` in
 * `AuthContext` for why that is not worth changing.
 *
 * @module features/auth/pages/SignInPage
 */

import { type ReactElement, memo, useCallback, useMemo } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/shared/PageHeader';
import { ProviderList } from '@/features/auth/components/ProviderList';
import { useAuth } from '@/features/auth/AuthContext';

// ============================================================================
// Constants
// ============================================================================

/** Where to go after signing in, when the caller did not say. */
const DEFAULT_DESTINATION = '/trips';

// ============================================================================
// Helpers
// ============================================================================

/**
 * Reads `?next=` as an in-app path, or falls back to the trip list.
 *
 * The query string is attacker-supplied — a link someone can send — and
 * `navigate()` follows a protocol-relative `//evil.example` off the site
 * entirely. So only a single-slash absolute path is accepted; everything else,
 * including a full URL and a `javascript:` scheme, is discarded rather than
 * sanitised into something half-trusted.
 */
function resolveDestination(next: string | null): string {
  if (next === null || !next.startsWith('/') || next.startsWith('//')) {
    return DEFAULT_DESTINATION;
  }
  return next;
}

// ============================================================================
// Component
// ============================================================================

const SignInPage = memo(function SignInPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { isResolved, user } = useAuth();

  const destination = useMemo(
    () => resolveDestination(searchParams.get('next')),
    [searchParams],
  );

  // Only reachable from a way in that completes without leaving the page — a
  // wallet signature. OAuth comes back to the app root instead, and the emailed
  // link lands on a fresh document.
  const handleSignedIn = useCallback((): void => {
    void navigate(destination, { replace: true });
  }, [destination, navigate]);

  return (
    <div className="container mx-auto max-w-lg px-4 py-6">
      <PageHeader
        title={t('auth.signIn.pageTitle', 'Sign in')}
        description={t(
          'auth.signIn.pageDescription',
          'An account is needed only to share a trip and edit it with other people. Everything else works without one.',
        )}
        backLink="/settings"
      />

      <Card className="mt-6">
        <CardContent className="pt-6">
          {/* Signed in already: say so rather than offering the list again,
              which reads as though the last attempt failed. `isResolved` keeps
              this from flashing at somebody whose stored session is still being
              read — it withholds one card, never the app. */}
          {isResolved && user ? (
            <div className="flex flex-col gap-4">
              <p className="flex items-start gap-2 text-sm" role="status">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {t('auth.account.signedInAs', 'Signed in as')}{' '}
                  <span className="font-medium">{user.email ?? user.id}</span>
                </span>
              </p>
              <Button asChild className="self-start">
                <Link to={destination}>{t('auth.signIn.continue', 'Continue')}</Link>
              </Button>
            </div>
          ) : (
            <ProviderList onSignedIn={handleSignedIn} />
          )}
        </CardContent>
      </Card>
    </div>
  );
});

export { SignInPage };
export default SignInPage;
