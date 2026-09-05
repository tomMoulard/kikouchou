/**
 * @fileoverview The sign-in prompt shown when an action needs an account.
 *
 * Nothing in the app opens this on launch. It appears only at the two moments
 * that genuinely need a server — sharing a trip and joining one — so the reason
 * for signing in is always visible on screen behind it. That is why the copy
 * leads with what the account is *for* rather than with the provider.
 *
 * It exists alongside `/signin` rather than being replaced by it: sending
 * somebody to a separate page mid-share means leaving the trip they were
 * sharing, and the reason for the account with it. The page is for arriving
 * deliberately, from Settings or a link; this is for being asked in place. Both
 * render the same {@link ProviderList}, so the ways in cannot differ between
 * them.
 *
 * @module features/auth/components/SignInDialog
 */

import { type ReactElement, memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ProviderList } from '@/features/auth/components/ProviderList';

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
// Component
// ============================================================================

export const SignInDialog = memo(function SignInDialog({
  open,
  onOpenChange,
  reason,
}: SignInDialogProps): ReactElement {
  const { t } = useTranslation();

  const handleDismiss = useCallback((): void => {
    onOpenChange(false);
  }, [onOpenChange]);

  // A wallet signature produces a session without leaving the page, so the
  // dialog has to get out of the way itself. The redirect flows never reach
  // this: the document is gone.
  const handleSignedIn = useCallback((): void => {
    onOpenChange(false);
  }, [onOpenChange]);

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

        {/* Remounted with the dialog, so each opening asks the project afresh
            and no stale error or half-typed address greets the next attempt. */}
        {open ? <ProviderList onSignedIn={handleSignedIn} /> : null}

        <DialogFooter>
          <Button variant="outline" onClick={handleDismiss}>
            {t('auth.signIn.notNow', 'Not now')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
