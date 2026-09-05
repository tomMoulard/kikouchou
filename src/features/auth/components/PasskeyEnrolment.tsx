/**
 * @fileoverview "Add a passkey", for somebody who is already signed in.
 *
 * Split out of `AccountSection` because it is the one piece of the account
 * panel with its own network dependency: it has to know whether the *project*
 * accepts passkeys, which means asking `/auth/v1/settings`. Mounted only in the
 * signed-in branch, so that request happens for a signed-in visitor on the
 * Settings page and nobody else.
 *
 * Why enrolment lives in the account panel at all: a passkey can only be
 * created by an authenticated user, so until somebody does this once the
 * "Continue with a passkey" button on `/signin` has nothing to find. The two
 * halves are one feature and neither is useful alone.
 *
 * @module features/auth/components/PasskeyEnrolment
 */

import { type ReactElement, memo, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Check, Fingerprint, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useAuthProviders } from '@/features/auth/hooks/useAuthProviders';
import { useAuth } from '@/features/auth/AuthContext';

// ============================================================================
// Component
// ============================================================================

/**
 * "Add a passkey", when the project accepts them and this browser can make one.
 *
 * Enrolment is per origin, not per account — a passkey added on `kikoushou.app`
 * does not exist on the GitHub Pages host — so the copy says "this device"
 * rather than promising something account-wide. The button stays after a
 * success: a second device, or a second passkey on this one, is a normal thing
 * to want.
 */
export const PasskeyEnrolment = memo(function PasskeyEnrolment(): ReactElement | null {
  const { t } = useTranslation();
  const { registerPasskey } = useAuth();
  const { canUsePasskeys } = useAuthProviders();

  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleEnrol = useCallback((): void => {
    void (async (): Promise<void> => {
      // Both outcomes of the *previous* attempt go first: a second try that
      // fails must not leave "Passkey added" standing next to its error.
      setError(null);
      setIsEnrolled(false);
      setIsEnrolling(true);
      const outcome = await registerPasskey();
      setIsEnrolling(false);

      if (outcome.status === 'enrolled') {
        setIsEnrolled(true);
        return;
      }
      if (outcome.status === 'error') {
        setError(outcome.message);
        return;
      }
      setError(t('auth.errors.unavailable', 'Sign-in is not configured in this build.'));
    })();
  }, [registerPasskey, t]);

  if (!canUsePasskeys) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2 border-t pt-4">
      <p className="text-sm text-muted-foreground">
        {t(
          'auth.account.passkeyDescription',
          'Add a passkey to sign in on this device with your screen lock instead of a provider.',
        )}
      </p>
      {isEnrolled ? (
        <p className="flex items-start gap-2 text-sm" role="status">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t('auth.account.passkeyAdded', 'Passkey added for this device.')}</span>
        </p>
      ) : null}
      {error !== null ? (
        <p className="flex items-start gap-2 text-sm text-destructive" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      ) : null}
      <Button
        variant="outline"
        onClick={handleEnrol}
        disabled={isEnrolling}
        className="self-start"
      >
        {isEnrolling ? (
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        ) : (
          <Fingerprint className="size-4" aria-hidden="true" />
        )}
        {t('auth.account.passkeyAction', 'Add a passkey')}
      </Button>
    </div>
  );
});
