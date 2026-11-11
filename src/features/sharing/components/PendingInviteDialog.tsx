/**
 * @fileoverview Opens the share dialog for the trip a sign-in was started for.
 *
 * The first-trip wizard ends on its invite screen, and a signed-out visitor
 * signs in there. Google and a magic link leave the page and come back to
 * `/`, so the wizard is gone by the time the session exists. The wizard
 * writes the trip's id to `pending-invite` before that, and this component,
 * mounted once for the whole app, opens the link for it when the person is
 * back and signed in.
 *
 * It reads the key once, when the app loads. A key written later belongs to a
 * wizard still on screen (a store app's sign-in sheet, a wallet), which turns
 * into the link by itself; reading it here too would put a second copy of
 * the link on top of the first.
 *
 * The dialog is a lazy chunk. This component is in the entry chunk, because
 * `App` mounts it for every visit, and the dialog brings the QR code renderer
 * and the sign-in forms with it. Only a visit that comes back from a sign-in
 * started in the wizard ever opens it.
 *
 * `App` mounts this beside the router, outside every route's boundary, so the
 * dialog has a boundary of its own: a chunk that would not load used to be
 * uncaught, which in React 19 unmounts the whole app. The boundary takes the
 * stale chunk reload like any other catch.
 *
 * @module features/sharing/components/PendingInviteDialog
 */

import {
  type ReactElement,
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { ErrorBoundary } from '@/components/shared/ErrorBoundary';

import { useAuth } from '@/features/auth/AuthContext';
import { useTripContext } from '@/contexts/TripContext';
import { captureEvent } from '@/lib/posthog';
import type { TripId } from '@/types';
import { forgetPendingInvite, readPendingInvite } from '../utils/pending-invite';

// ============================================================================
// Constants
// ============================================================================

const ShareDialog = lazy(() =>
  import('./ShareDialog').then((module) => ({ default: module.ShareDialog })),
);

// ============================================================================
// Type Definitions
// ============================================================================

interface DialogLoadedProps {
  readonly onLoaded: () => void;
}

// ============================================================================
// Sub-Components
// ============================================================================

/**
 * Says the dialog's chunk has arrived. It sits beside the dialog in the same
 * `Suspense`, which commits its children together, so its effect runs only
 * once the lazy dialog has loaded.
 */
const DialogLoaded = memo(function DialogLoaded({ onLoaded }: DialogLoadedProps): null {
  useEffect(() => {
    onLoaded();
  }, [onLoaded]);
  return null;
});

// ============================================================================
// Component
// ============================================================================

export const PendingInviteDialog = memo(function PendingInviteDialog(): ReactElement | null {
  const { user, isResolved } = useAuth();
  const { trips, isLoading } = useTripContext();
  const [pendingTripId] = useState<TripId | null>(() => readPendingInvite());
  const [dismissed, setDismissed] = useState(false);
  const [dialogLoaded, setDialogLoaded] = useState(false);
  const reportedRef = useRef(false);

  const trip =
    pendingTripId === null ? undefined : trips.find((candidate) => candidate.id === pendingTripId);
  // Signed out after the round trip means the sign-in was abandoned. The key
  // stays until it expires, so a magic link opened a few minutes later still
  // lands on the link.
  const isReady = pendingTripId !== null && isResolved && user !== null && !isLoading;
  const open = isReady && trip !== undefined && !dismissed;

  useEffect(() => {
    // The key outlives a dialog that has not arrived yet: a chunk that will
    // not load makes the boundary below reload the tab, and the reloaded page
    // needs the key to open the dialog after all.
    if (!isReady || (trip !== undefined && !dialogLoaded)) {
      return;
    }
    // Acted on, or a trip deleted in the meantime: either way the key is spent.
    forgetPendingInvite();
    if (trip !== undefined && !reportedRef.current) {
      reportedRef.current = true;
      captureEvent('trip_invite_resumed');
    }
  }, [isReady, trip, dialogLoaded]);

  const handleOpenChange = useCallback((next: boolean): void => {
    if (!next) {
      setDismissed(true);
    }
  }, []);

  const handleDialogLoaded = useCallback((): void => {
    setDialogLoaded(true);
  }, []);

  if (trip === undefined) {
    return null;
  }
  return (
    <ErrorBoundary fallback={null}>
      <Suspense fallback={null}>
        <ShareDialog open={open} onOpenChange={handleOpenChange} trip={trip} />
        <DialogLoaded onLoaded={handleDialogLoaded} />
      </Suspense>
    </ErrorBoundary>
  );
});
