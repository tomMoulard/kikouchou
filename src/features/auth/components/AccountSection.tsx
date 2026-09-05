/**
 * @fileoverview Account panel for the Settings page.
 *
 * Three states, and the wording matters in each:
 *
 * - **No backend configured** — say so plainly rather than showing a dead
 *   button. This is a real state for a self-built or offline-only deploy.
 * - **Signed out** — frame it as what an account unlocks (sharing), not as
 *   something missing. Trips work fine without one. The providers themselves
 *   live on `/signin`: somebody who came to Settings to sign in has already
 *   decided, so a dialog on top of the page they just navigated to would be one
 *   layer too many — and the page is linkable, which a dialog is not.
 * - **Signed in** — show who, make signing out unremarkable, and offer to add
 *   a passkey. That last one lives here rather than on the sign-in page for a
 *   structural reason: a passkey can only be enrolled by somebody who is
 *   already signed in, and until one exists the "Continue with a passkey"
 *   button on `/signin` has nothing to find.
 *
 * @module features/auth/components/AccountSection
 */

import { type ReactElement, memo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PasskeyEnrolment } from '@/features/auth/components/PasskeyEnrolment';
import { useAuth } from '@/features/auth/AuthContext';

// ============================================================================
// Component
// ============================================================================

export const AccountSection = memo(function AccountSection(): ReactElement {
  const { t } = useTranslation();
  const { isAvailable, isResolved, user, signOut, lastAuthError } = useAuth();

  const handleSignOut = useCallback(() => {
    void signOut();
  }, [signOut]);

  if (!isAvailable) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(
          'auth.account.notConfigured',
          'This build has no account backend, so trips stay on this device.',
        )}
      </p>
    );
  }

  // Until the stored session has been read, render neither state rather than
  // flashing "Sign in" at someone who is already signed in. This withholds one
  // small panel for a few milliseconds — never the app.
  if (!isResolved) {
    return <div className="h-9" aria-hidden="true" />;
  }

  if (!user) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">
          {t(
            'auth.account.signedOut',
            'Sign in to share a trip and edit it together. Trips you keep to yourself need no account.',
          )}
        </p>
        {lastAuthError !== null ? (
          /* A sign-in that came back and failed looks identical to never having
             tried, which is the worst possible thing to show somebody who just
             completed a provider's consent screen. */
          <div
            className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {t('auth.account.signInFailed', 'The last sign-in did not complete:')}{' '}
              {lastAuthError}
            </span>
          </div>
        ) : null}
        <Button asChild className="self-start">
          {/* `next` brings them back here rather than to the trip list, so the
              setting they came to Settings for is still on screen. */}
          <Link to="/signin?next=/settings">
            {t('auth.account.signInAction', 'Sign in')}
          </Link>
        </Button>
      </div>
    );
  }

  const label = user.email ?? user.user_metadata?.full_name ?? user.id;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t('auth.account.signedInAs', 'Signed in as')}</p>
          <p className="truncate text-sm text-muted-foreground">{String(label)}</p>
        </div>
        <Button variant="outline" onClick={handleSignOut}>
          <LogOut className="size-4" aria-hidden="true" />
          {t('auth.account.signOutAction', 'Sign out')}
        </Button>
      </div>
      {/* Mounted only in this branch, so the settings lookup it needs happens
          for a signed-in visitor and nobody else. */}
      <PasskeyEnrolment />
    </div>
  );
});
