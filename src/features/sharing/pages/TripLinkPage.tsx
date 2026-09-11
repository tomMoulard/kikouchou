/**
 * @fileoverview A trip's stable link: `/t/<remoteTripId>`.
 *
 * One address for a trip that does not depend on which device opens it. A trip
 * already on this device opens straight away; a member signed in on a new
 * device downloads it; anybody else is asked to sign in, or to use the invite
 * link they were actually sent. Reminders point here, and so does the install
 * handoff on an iPhone: the installed app has storage separate from Safari's,
 * so it must open on a page that can find the trip again, and this one can.
 *
 * While the page is on screen the document's manifest is the one without
 * `start_url`, so an app added to the Home Screen *from here* opens here —
 * see `lib/pwa/use-here-manifest`.
 *
 * The screen is derived, not stored: what Dexie holds, whether the session has
 * been read, who is signed in and whether the last download failed decide it
 * between them. The one piece of state is that failure, keyed by attempt, so
 * Retry is a counter and nothing has to be reset.
 *
 * @module features/sharing/pages/TripLinkPage
 */

import { type ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Link2, Loader2, Smartphone } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { onboardingSurface, statusVariants } from '@/components/ui/status.variants';
import { useInstallPromptState } from '@/contexts/InstallPromptContext';
import { useTripContext } from '@/contexts/TripContext';
import { useAuth } from '@/features/auth/AuthContext';
import { SignInDialog } from '@/features/auth/components/SignInDialog';
import { db } from '@/lib/db/database';
import posthog from '@/lib/posthog';
import { useHereManifest } from '@/lib/pwa/use-here-manifest';
import { getSupabaseClient } from '@/lib/supabase/client';
import { materialiseJoinedTrip } from '@/lib/sync/join-trip';
import { cn } from '@/lib/utils';
import { ImportTripQrDialog } from '../components/ImportTripQrDialog';
import type { Trip, TripId } from '@/types';
import { reportError } from '@/lib/posthog';

// ============================================================================
// Constants
// ============================================================================

/**
 * What a server trip id looks like. Anything else is a mangled link, and gets
 * told so before a query is spent on it.
 */
const REMOTE_TRIP_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

// ============================================================================
// Type Definitions
// ============================================================================

type Phase =
  /** Waiting on Dexie, the stored session, the download — or navigating away. */
  | { readonly kind: 'opening' }
  /** The trip is on this device; the page stays because an install was asked for. */
  | { readonly kind: 'ready'; readonly tripId: TripId }
  /** No copy here and no account to fetch one with. */
  | { readonly kind: 'signInNeeded' }
  | {
      readonly kind: 'failed';
      readonly message: string;
      readonly retryable: boolean;
    };

/** The last download that did not produce a trip, and which attempt it was. */
interface DownloadFailure {
  readonly attempt: number;
  readonly message: string;
}

// ============================================================================
// Page
// ============================================================================

/**
 * Opens the trip behind a stable link, or says what it needs to.
 */
export function TripLinkPage(): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { remoteTripId } = useParams<{ remoteTripId: string }>();
  const { setCurrentTrip } = useTripContext();
  const { isAvailable, isResolved, user } = useAuth();
  const { installIntent, isInstalled } = useInstallPromptState();

  useHereManifest();

  /**
   * The visitor came here to install, not to be whisked off to the calendar:
   * the page has to stay under the share sheet. Not in the installed app,
   * though, where the same URL is simply the trip's address.
   */
  const installRequested = installIntent && !isInstalled;

  const validId =
    remoteTripId !== undefined && REMOTE_TRIP_ID_PATTERN.test(remoteTripId) ? remoteTripId : null;

  /**
   * `null` for "not here", `undefined` for "Dexie has not answered yet" — the
   * distinction the whole page turns on, and one `first()` alone does not make.
   */
  const localTrip = useLiveQuery<Trip | null>(
    async () =>
      validId === null
        ? null
        : ((await db.trips.where('remoteTripId').equals(validId).first()) ?? null),
    [validId],
  );

  const [failure, setFailure] = useState<DownloadFailure | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [signInOpen, setSignInOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const isMountedRef = useRef(true);
  const reportedRef = useRef<string | null>(null);
  const navigatedRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const userId = user?.id;
  const signedIn = isAvailable && userId !== undefined;

  // --------------------------------------------------------------------------
  // The screen, derived
  // --------------------------------------------------------------------------

  let phase: Phase;
  if (validId === null) {
    phase = {
      kind: 'failed',
      message: t('tripLink.invalid', "This trip link isn't valid."),
      retryable: false,
    };
  } else if (localTrip === undefined) {
    phase = { kind: 'opening' };
  } else if (localTrip !== null) {
    phase = installRequested ? { kind: 'ready', tripId: localTrip.id } : { kind: 'opening' };
  } else if (!isResolved) {
    phase = { kind: 'opening' };
  } else if (!signedIn) {
    phase = { kind: 'signInNeeded' };
  } else if (failure !== null && failure.attempt === attempt) {
    phase = { kind: 'failed', message: failure.message, retryable: true };
  } else {
    phase = { kind: 'opening' };
  }

  // --------------------------------------------------------------------------
  // Effects
  // --------------------------------------------------------------------------

  const openTrip = useCallback(
    (tripId: TripId): void => {
      // Navigated only once the trip is actually current. `setCurrentTrip` runs
      // a Dexie transaction, and voiding it meant a rejection landed the visitor
      // on a calendar for a trip that was never selected, with the rejection
      // lost and the ref latch below blocking any retry.
      void setCurrentTrip(tripId)
        .catch((error: unknown) => {
          reportError(error, { source: 'TripLinkPage.openTrip' });
        })
        .finally(() => {
          void navigate(`/trips/${tripId}/calendar`, { replace: true });
        });
    },
    [navigate, setCurrentTrip],
  );

  /** A trip that is here opens, unless the visitor is here to install. */
  useEffect(() => {
    if (localTrip === null || localTrip === undefined || installRequested || navigatedRef.current) {
      return;
    }
    navigatedRef.current = true;
    if (reportedRef.current === null) {
      reportedRef.current = 'local';
      posthog?.capture('trip_link_opened', { outcome: 'local' });
    }
    openTrip(localTrip.id);
  }, [installRequested, localTrip, openTrip]);

  /** A member with no copy downloads one; the live query then takes over. */
  useEffect(() => {
    if (validId === null || localTrip !== null || !isResolved || !signedIn) {
      return;
    }

    let cancelled = false;
    void (async () => {
      const client = await getSupabaseClient();
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (!client) {
        setFailure({
          attempt,
          message: t('tripLink.noBackend', 'Sync is not configured.'),
        });
        return;
      }

      const result = await materialiseJoinedTrip(client, validId);
      if (cancelled || !isMountedRef.current) {
        return;
      }
      if (result.status === 'error') {
        reportedRef.current = 'error';
        posthog?.capture('trip_link_opened', { outcome: 'error' });
        setFailure({ attempt, message: result.message });
        return;
      }
      if (result.status === 'joined') {
        reportedRef.current = 'downloaded';
        posthog?.capture('trip_link_opened', { outcome: 'downloaded' });
      }
      // `already-local` and `joined` alike: the row is in Dexie now, and the
      // live query above re-renders this page onto it.
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `t` is stable for the page's life, and `attempt` is the Retry button: it is a dependency so the effect re-runs, not something the effect reads
  }, [validId, localTrip, isResolved, signedIn, userId, attempt]);

  /** The outcomes that end on this screen, reported once each. */
  const settledOutcome =
    phase.kind === 'signInNeeded'
      ? 'sign_in_needed'
      : phase.kind === 'failed' && !phase.retryable
        ? 'invalid'
        : phase.kind === 'ready'
          ? 'local'
          : null;
  useEffect(() => {
    if (settledOutcome === null || reportedRef.current !== null) {
      return;
    }
    reportedRef.current = settledOutcome;
    posthog?.capture('trip_link_opened', { outcome: settledOutcome });
  }, [settledOutcome]);

  const retry = useCallback((): void => {
    setAttempt((count) => count + 1);
  }, []);

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div
      className={cn(
        'flex min-h-svh items-center justify-center p-4',
        // Room for the global banner's install steps along the bottom.
        installRequested && 'pb-96',
        onboardingSurface,
      )}
    >
      <Card className="w-full max-w-md shadow-lg">
        <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
          {phase.kind === 'opening' ? (
            <>
              <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
              <CardTitle className="text-lg">
                {t('tripLink.opening', 'Opening the trip…')}
              </CardTitle>
            </>
          ) : null}

          {phase.kind === 'ready' ? (
            <>
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Smartphone className="size-6" aria-hidden="true" />
              </div>
              <CardTitle className="text-lg">
                {t('pwa.manualInstall.title', 'Add Kikouchou to your device')}
              </CardTitle>
              <CardDescription>
                {t(
                  'sharing.join.installHere',
                  'Add Kikouchou to your Home Screen from this page, and the app opens on this trip.',
                )}
              </CardDescription>
              <Button
                variant="outline"
                onClick={() => {
                  openTrip(phase.tripId);
                }}
              >
                {t('tripLink.openTrip', 'Open the trip')}
              </Button>
            </>
          ) : null}

          {phase.kind === 'signInNeeded' ? (
            <>
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Link2 className="size-6" aria-hidden="true" />
              </div>
              <CardTitle className="text-lg">
                {t('tripLink.title', 'A trip shared with you')}
              </CardTitle>
              <CardDescription>
                {t(
                  'tripLink.signInNeeded',
                  'Sign in to open it. If you were sent an invite link instead, scan or paste that.',
                )}
              </CardDescription>
              <div className="flex flex-wrap justify-center gap-2">
                <Button
                  onClick={() => {
                    setSignInOpen(true);
                  }}
                >
                  {t('tripLink.signIn', 'Sign in')}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setImportOpen(true);
                  }}
                >
                  {t('tripLink.useInvite', 'Scan or paste an invite')}
                </Button>
              </div>
              <SignInDialog
                open={signInOpen}
                onOpenChange={setSignInOpen}
                reason={t('tripLink.signInReason', 'Sign in to open the trip this link points at.')}
              />
              <ImportTripQrDialog open={importOpen} onOpenChange={setImportOpen} />
            </>
          ) : null}

          {phase.kind === 'failed' ? (
            <>
              <div
                className={cn(
                  'flex size-12 items-center justify-center rounded-full',
                  statusVariants({ tone: 'danger', emphasis: 'surface' }),
                )}
              >
                <AlertTriangle className="size-6" aria-hidden="true" />
              </div>
              <CardTitle className="text-lg">
                {t('tripLink.failed', "Couldn't open the trip")}
              </CardTitle>
              <CardDescription role="alert">{phase.message}</CardDescription>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => void navigate('/trips')}>
                  {t('trips.title', 'My trips')}
                </Button>
                {phase.retryable ? (
                  <Button onClick={retry}>{t('common.retry', 'Retry')}</Button>
                ) : null}
              </div>
            </>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
