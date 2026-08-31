/**
 * @fileoverview The sign-in prompt shown when an action needs an account.
 *
 * Nothing in the app opens this on launch. It appears only at the two moments
 * that genuinely need a server — sharing a trip and joining one — so the reason
 * for signing in is always visible on screen behind it. That is why the copy
 * leads with what the account is *for* rather than with the provider.
 *
 * @module features/auth/components/SignInDialog
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Loader2, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useAuth } from '@/features/auth/AuthContext';

// ============================================================================
// Type Definitions
// ============================================================================

interface SignInDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /**
   * Why the account is needed, in the user's terms — "to share this trip", not
   * "to authenticate". Falls back to a generic line when omitted.
   */
  readonly reason?: string;
}

// ============================================================================
// Google mark
// ============================================================================

/**
 * Google's "G", inlined.
 *
 * Loading it from a Google CDN would leak the fact that this page is a sign-in
 * screen to a third party before the user has chosen anything, and would render
 * as a broken image offline. Four paths cost less than either.
 */
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

// ============================================================================
// Component
// ============================================================================

export const SignInDialog = memo(function SignInDialog({
  open,
  onOpenChange,
  reason,
}: SignInDialogProps): ReactElement {
  const { t } = useTranslation();
  const { isAvailable, isSigningIn, signInWithGoogle } = useAuth();
  const { isOnline } = useOnlineStatus();
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(open);

  // A stale error from a previous attempt must not greet the next one. Adjusted
  // during render rather than in an effect: this is the "resetting state when a
  // prop changes" pattern, which React re-runs immediately without committing
  // the intermediate render, so it costs no cascading re-render.
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError(null);
    }
  }

  const handleSignIn = useCallback(async (): Promise<void> => {
    setError(null);
    const outcome = await signInWithGoogle();

    if (outcome.status === 'error') {
      setError(outcome.message);
      return;
    }
    if (outcome.status === 'unavailable') {
      setError(t('auth.errors.unavailable', 'Sign-in is not configured in this build.'));
    }
    // 'redirecting': the browser is leaving; nothing to do.
  }, [signInWithGoogle, t]);

  const blockedOffline = !isOnline;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('auth.signIn.title', 'Create an account to share')}</DialogTitle>
          <DialogDescription>
            {reason ??
              t(
                'auth.signIn.description',
                'Your trip lives on this device today. An account lets the people you invite see it and edit it with you.',
              )}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          {t(
            'auth.signIn.localDataKept',
            'Nothing you have already planned is lost — this trip is uploaded as it is.',
          )}
        </p>

        {blockedOffline ? (
          <div
            className="flex items-start gap-2 rounded-md bg-muted p-3 text-sm"
            role="status"
          >
            <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {t(
                'auth.signIn.offline',
                'You are offline. Signing in needs a connection — everything else keeps working without one.',
              )}
            </span>
          </div>
        ) : null}

        {error !== null ? (
          <div
            className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        <DialogFooter className="sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('auth.signIn.notNow', 'Not now')}
          </Button>
          <Button
            onClick={handleSignIn}
            disabled={!isAvailable || blockedOffline || isSigningIn}
          >
            {isSigningIn ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <GoogleMark />
            )}
            {t('auth.signIn.withGoogle', 'Continue with Google')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
