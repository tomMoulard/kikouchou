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
 * @module features/sharing/components/PendingInviteDialog
 */

import { type ReactElement, memo, useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/features/auth/AuthContext';
import { useTripContext } from '@/contexts/TripContext';
import { captureEvent } from '@/lib/posthog';
import type { TripId } from '@/types';
import { forgetPendingInvite, readPendingInvite } from '../utils/pending-invite';
import { ShareDialog } from './ShareDialog';

// ============================================================================
// Component
// ============================================================================

export const PendingInviteDialog = memo(function PendingInviteDialog(): ReactElement | null {
  const { user, isResolved } = useAuth();
  const { trips, isLoading } = useTripContext();
  const [pendingTripId] = useState<TripId | null>(() => readPendingInvite());
  const [dismissed, setDismissed] = useState(false);
  const reportedRef = useRef(false);

  const trip =
    pendingTripId === null ? undefined : trips.find((candidate) => candidate.id === pendingTripId);
  // Signed out after the round trip means the sign-in was abandoned. The key
  // stays until it expires, so a magic link opened a few minutes later still
  // lands on the link.
  const isReady = pendingTripId !== null && isResolved && user !== null && !isLoading;
  const open = isReady && trip !== undefined && !dismissed;

  useEffect(() => {
    if (!isReady) {
      return;
    }
    // Acted on, or a trip deleted in the meantime: either way the key is spent.
    forgetPendingInvite();
    if (trip !== undefined && !reportedRef.current) {
      reportedRef.current = true;
      captureEvent('trip_invite_resumed');
    }
  }, [isReady, trip]);

  const handleOpenChange = useCallback((next: boolean): void => {
    if (!next) {
      setDismissed(true);
    }
  }, []);

  if (trip === undefined) {
    return null;
  }
  return <ShareDialog open={open} onOpenChange={handleOpenChange} trip={trip} />;
});
