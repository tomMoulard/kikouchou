/**
 * @fileoverview Account panel for the Settings page.
 *
 * Three states, and the wording matters in each:
 *
 * - **No backend configured** — say so plainly rather than showing a dead
 *   button. This is a real state for a self-built or offline-only deploy.
 * - **Signed out** — frame it as what an account unlocks (sharing), not as
 *   something missing. Trips work fine without one.
 * - **Signed in** — show who, and make signing out unremarkable.
 *
 * @module features/auth/components/AccountSection
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/AuthContext';
import { SignInDialog } from './SignInDialog';

// ============================================================================
// Component
// ============================================================================

export const AccountSection = memo(function AccountSection(): ReactElement {
  const { t } = useTranslation();
  const { isAvailable, isResolved, user, signOut } = useAuth();
  const [signInOpen, setSignInOpen] = useState(false);

  const handleSignOut = useCallback(() => {
    void signOut();
  }, [signOut]);

  const openSignIn = useCallback(() => {
    setSignInOpen(true);
  }, []);

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
      <>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            {t(
              'auth.account.signedOut',
              'Sign in to share a trip and edit it together. Trips you keep to yourself need no account.',
            )}
          </p>
          <Button onClick={openSignIn} className="self-start">
            {t('auth.account.signInAction', 'Sign in')}
          </Button>
        </div>
        <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
      </>
    );
  }

  const label = user.email ?? user.user_metadata?.full_name ?? user.id;

  return (
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
  );
});
