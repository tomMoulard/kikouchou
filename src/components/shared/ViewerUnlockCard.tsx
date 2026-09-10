/**
 * @fileoverview The one card a viewer sees on every page of a read-only trip.
 *
 * A viewer trip arrived through an invite link with no account behind it. Every
 * write control on its pages is gone, and this card is the explanation and the
 * way out: sign in, and the same token joins the account to the trip.
 *
 * Signed in, the card does the work itself rather than waiting for the account
 * sweep to reach the trip, and says what happened if the token is dead — a link
 * that expired between opening it and signing in is a real case, and "still
 * read-only, no idea why" is the worst thing this card can show.
 *
 * Rendered by `Layout` above the page content, for trip-scoped routes only: on
 * the trip list a read-only trip is just a card among others.
 *
 * @module components/shared/ViewerUnlockCard
 */

import { type ReactElement, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Eye, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { useTripContext } from '@/contexts/TripContext';
import { useAuth } from '@/features/auth/AuthContext';
import { SignInDialog } from '@/features/auth/components/SignInDialog';
import { useTripAccess } from '@/hooks/useTripAccess';
import posthog from '@/lib/posthog';
import { getSupabaseClient } from '@/lib/supabase/client';
import { upgradeViewerTrip, type ViewerUpgradeResult } from '@/lib/sync/viewer';
import { cn } from '@/lib/utils';

// ============================================================================
// Type Definitions
// ============================================================================

export interface ViewerUnlockCardProps {
  readonly className?: string;
}

/**
 * What the signed-in half of the card is showing.
 *
 * No `working` state: the redeem is in flight from the moment the card renders
 * signed in, and `idle` draws the same spinner — so the effect that starts it
 * sets no state of its own, which is also what keeps it from cascading renders.
 */
type UpgradeState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'failed';
      readonly result: Exclude<ViewerUpgradeResult, { status: 'upgraded' | 'already-member' }>;
    };

// ============================================================================
// Component
// ============================================================================

export const ViewerUnlockCard = memo(function ViewerUnlockCard({
  className,
}: ViewerUnlockCardProps): ReactElement | null {
  const { t } = useTranslation();
  const { currentTrip } = useTripContext();
  const { access } = useTripAccess();
  const { isAvailable, isResolved, user } = useAuth();

  const [signInOpen, setSignInOpen] = useState(false);
  const [upgrade, setUpgrade] = useState<UpgradeState>({ kind: 'idle' });
  const isMountedRef = useRef(true);
  const attemptedForRef = useRef<string | null>(null);

  useEffect(() => {
    // Set on setup, not only in cleanup: StrictMode's dev-time
    // mount -> cleanup -> mount cycle would otherwise latch this false forever.
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const tripId = currentTrip?.id;
  const userId = user?.id;

  const tryUpgrade = useCallback(async (): Promise<void> => {
    if (!currentTrip || userId === undefined) {
      return;
    }

    const client = await getSupabaseClient();
    if (!isMountedRef.current) {
      return;
    }
    if (!client) {
      setUpgrade({ kind: 'failed', result: { status: 'error', message: 'no backend' } });
      return;
    }

    const result = await upgradeViewerTrip(client, userId, currentTrip);
    if (!isMountedRef.current) {
      return;
    }
    if (result.status === 'upgraded' || result.status === 'already-member') {
      // `viewerToken` is gone from the row; the live query re-renders this
      // card away on its own.
      setUpgrade({ kind: 'idle' });
      return;
    }
    posthog?.capture('trip_join_failed', { reason: result.status, mode: 'upgrade' });
    setUpgrade({ kind: 'failed', result });
  }, [currentTrip, userId]);

  // Signed in with a viewer trip open: redeem now. Once per trip and account,
  // so a failure does not loop — the button below is the retry.
  useEffect(() => {
    if (access !== 'viewer' || userId === undefined || tripId === undefined) {
      return;
    }
    const key = `${tripId}:${userId}`;
    if (attemptedForRef.current === key) {
      return;
    }
    attemptedForRef.current = key;
    // Deferred a tick so the effect body itself sets no state: the redeem
    // reports its outcome after a round trip, never synchronously.
    const timer = setTimeout(() => {
      void tryUpgrade();
    }, 0);
    return () => {
      clearTimeout(timer);
    };
  }, [access, tripId, tryUpgrade, userId]);

  const handleSignIn = useCallback((): void => {
    posthog?.capture('viewer_sign_in_clicked');
    setSignInOpen(true);
  }, []);

  const handleRetry = useCallback((): void => {
    setUpgrade({ kind: 'idle' });
    void tryUpgrade();
  }, [tryUpgrade]);

  if (access !== 'viewer' || !currentTrip || !isAvailable) {
    return null;
  }

  const failureMessage = (result: UpgradeState & { kind: 'failed' }): string => {
    switch (result.result.status) {
      case 'not-found':
        return t('sharing.join.notFound', "This invite link isn't valid.");
      case 'revoked':
        return t('sharing.join.revoked', 'This invite link has been withdrawn.');
      case 'expired':
        return t('sharing.join.expired', 'This invite link has expired.');
      case 'exhausted':
        return t('sharing.join.exhausted', 'This invite link has been used up.');
      case 'unauthenticated':
        return t('sharing.join.signInReason', 'Sign in to join this trip and edit it with the others.');
      default:
        return result.result.message;
    }
  };

  return (
    <Card
      className={cn('border-primary/20', className)}
      role="region"
      aria-label={t('viewer.title', 'Read-only')}
      data-testid="viewer-unlock-card"
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <Eye className="size-6" />
          </div>

          <div className="min-w-0 flex-1">
            <CardTitle className="text-base font-semibold">
              {t('viewer.title', 'Read-only')}
            </CardTitle>

            {/* Until the stored session has been read, offer neither half rather
                than flashing "Sign in" at somebody who is already signed in. */}
            {!isResolved ? null : user === null ? (
              <>
                <CardDescription className="mt-1 text-sm">
                  {t(
                    'viewer.description',
                    'You opened this trip from an invite link. You can see everything and change nothing. Sign in to edit it with the others.',
                  )}
                </CardDescription>
                <div className="mt-3">
                  <Button size="sm" onClick={handleSignIn} className="h-11 sm:h-8">
                    {t('viewer.signIn', 'Sign in to edit')}
                  </Button>
                </div>
                <SignInDialog
                  open={signInOpen}
                  onOpenChange={setSignInOpen}
                  reason={t(
                    'viewer.signInReason',
                    'Sign in to edit this trip with the others. Nothing you can see here changes.',
                  )}
                />
              </>
            ) : upgrade.kind === 'failed' ? (
              <>
                <div
                  className="mt-1 flex items-start gap-2 text-sm text-destructive"
                  role="alert"
                >
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                  <span>
                    {t('viewer.acceptFailed', 'Your invitation could not be accepted.')}{' '}
                    {failureMessage(upgrade)}{' '}
                    {t('viewer.stillReadOnly', 'This copy stays read-only until it is.')}
                  </span>
                </div>
                <div className="mt-3">
                  <Button size="sm" variant="outline" onClick={handleRetry} className="h-11 sm:h-8">
                    {t('common.retry', 'Retry')}
                  </Button>
                </div>
              </>
            ) : (
              <CardDescription className="mt-1 flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                {t('viewer.accepting', 'Accepting your invitation…')}
              </CardDescription>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
});
