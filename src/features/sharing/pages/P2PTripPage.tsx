/**
 * @fileoverview P2P Trip page — resolves /trip/:roomId#key and joins the Y.Doc room.
 * @module features/sharing/pages/P2PTripPage
 */

import { type ReactElement, memo, useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, RefreshCw, Users, Wifi, WifiOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useTripContext } from '@/contexts/TripContext';
import { db } from '@/lib/db/database';
import { applyDocToDexie, YjsProvider, useYjsContext } from '@/lib/yjs';
import type { TripId } from '@/types';

/** Seconds before showing a "signaling server unreachable" error. */
const SIGNALING_TIMEOUT_MS = 15_000;

async function resolveTripFromDoc(
  doc: NonNullable<ReturnType<typeof useYjsContext>>['doc'],
  roomId: string,
): Promise<TripId | undefined> {
  const tripId = doc.getMap('meta').get('id') as TripId | undefined;
  if (!tripId) {
    return undefined;
  }

  await applyDocToDexie(doc, roomId);
  return tripId;
}

const P2PTripInner = memo(function P2PTripInner({
  roomId,
}: {
  roomId: string;
}): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { setCurrentTrip } = useTripContext();
  const yjs = useYjsContext();
  const [status, setStatus] = useState<'loading' | 'waiting' | 'signaling-failed' | 'error'>('loading');
  const resolvedRef = useRef(false);

  // ---- Signaling timeout ------------------------------------------------
  // If the signaling WebSocket has not connected within SIGNALING_TIMEOUT_MS
  // after the provider is loaded, surface a clear error instead of spinning
  // forever.
  useEffect(() => {
    if (!yjs?.loaded || resolvedRef.current) {
      return;
    }

    // Already connected — nothing to wait for.
    if (yjs.signalingConnected) {
      return;
    }

    const timer = setTimeout(() => {
      if (resolvedRef.current) {
        return;
      }
      // Re-check at timer expiry: if still not connected → fail.
      if (!yjs.signalingConnected) {
        setStatus('signaling-failed');
      }
    }, SIGNALING_TIMEOUT_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [yjs?.loaded, yjs?.signalingConnected]);

  useEffect(() => {
    if (!yjs?.loaded || !yjs.doc || resolvedRef.current) {
      return;
    }

    const doc = yjs.doc;
    let cancelled = false;

    async function resolveTrip(): Promise<void> {
      try {
        const existingTrip = await db.trips
          .filter((trip) => trip.p2pRoomId === roomId)
          .first();
        if (cancelled) {
          return;
        }

        if (existingTrip) {
          resolvedRef.current = true;
          await setCurrentTrip(existingTrip.id);
          navigate(`/trips/${existingTrip.id}/calendar`, { replace: true });
          return;
        }

        const resolvedTripId = await resolveTripFromDoc(doc, roomId);
        if (cancelled) {
          return;
        }

        if (resolvedTripId) {
          resolvedRef.current = true;
          await setCurrentTrip(resolvedTripId);
          navigate(`/trips/${resolvedTripId}/calendar`, { replace: true });
          return;
        }

        setStatus('waiting');
      } catch (error) {
        console.error('[P2PTripPage] Failed to resolve trip:', error);
        if (!cancelled) {
          setStatus('error');
        }
      }
    }

    void resolveTrip();
    return () => {
      cancelled = true;
    };
  }, [navigate, roomId, setCurrentTrip, yjs]);

  useEffect(() => {
    if (status !== 'waiting' || !yjs?.doc || resolvedRef.current) {
      return;
    }

    let cancelled = false;

    const handleUpdate = (): void => {
      if (resolvedRef.current) {
        return;
      }

      void resolveTripFromDoc(yjs.doc, roomId)
        .then(async (tripId) => {
          if (!tripId || cancelled || resolvedRef.current) {
            return;
          }

          resolvedRef.current = true;
          await setCurrentTrip(tripId as TripId);
          navigate(`/trips/${tripId}/calendar`, { replace: true });
        })
        .catch((error) => {
          console.error('[P2PTripPage] Failed to apply remote document:', error);
          if (!cancelled) {
            setStatus('error');
          }
        });
    };

    handleUpdate();
    yjs.doc.on('update', handleUpdate);
    return () => {
      cancelled = true;
      yjs.doc.off('update', handleUpdate);
    };
  }, [navigate, roomId, setCurrentTrip, status, yjs?.doc]);

  const handleGoHome = useCallback(() => {
    navigate('/trips');
  }, [navigate]);

  const handleRetry = useCallback(() => {
    window.location.reload();
  }, []);

  // ---- Signaling server unreachable -------------------------------------
  if (status === 'signaling-failed') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <WifiOff className="size-12 mx-auto text-destructive" />
            <p className="text-lg font-semibold">
              {t('sharing.p2p.signalingFailed', 'Signaling server unreachable')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(
                'sharing.p2p.signalingFailedDescription',
                'Could not connect to the signaling server. The server may be down or your network may be blocking WebSocket connections.',
              )}
            </p>
            <div className="flex gap-3 justify-center">
              <Button variant="outline" onClick={handleGoHome}>
                {t('trips.title')}
              </Button>
              <Button onClick={handleRetry}>
                <RefreshCw className="size-4 mr-2" aria-hidden="true" />
                {t('common.retry', 'Retry')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <WifiOff className="size-12 mx-auto text-muted-foreground" />
            <p className="text-lg font-semibold">
              {t('sharing.p2p.connectionError', 'Failed to connect')}
            </p>
            <p className="text-sm text-muted-foreground">
              {t(
                'sharing.p2p.connectionErrorDescription',
                'Could not join this trip. Check your connection and try again.',
              )}
            </p>
            <Button onClick={handleGoHome}>{t('trips.title')}</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full">
        <CardContent className="pt-6 text-center space-y-4">
          <Loader2 className="size-12 mx-auto animate-spin text-primary" />
          <p className="text-lg font-semibold">
            {status === 'loading'
              ? t('sharing.p2p.joining', 'Joining trip...')
              : t('sharing.p2p.waitingForData', 'Waiting for trip data...')}
          </p>
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            {yjs?.synced && yjs.peerCount > 0 ? (
              <>
                <Wifi className="size-4 text-green-500" />
                {t('sharing.p2p.syncedWithPeers', {
                  count: yjs.peerCount,
                  defaultValue: 'Synced with {{count}} peer(s)',
                })}
              </>
            ) : yjs?.peerCount && yjs.peerCount > 0 ? (
              <>
                <Users className="size-4 text-yellow-500" />
                {t('sharing.p2p.syncingWithPeers', {
                  count: yjs.peerCount,
                  defaultValue: 'Syncing with {{count}} peer(s)...',
                })}
              </>
            ) : yjs?.signalingConnected ? (
              <>
                <Wifi className="size-4 text-blue-500" />
                {t(
                  'sharing.p2p.connectedWaitingPeers',
                  'Connected to signaling, waiting for peers...',
                )}
              </>
            ) : (
              <>
                <Users className="size-4" />
                {t(
                  'sharing.p2p.waitingForPeers',
                  'Connecting to signaling server...',
                )}
              </>
            )}
          </div>

          {yjs?.onlineUsers && yjs.onlineUsers.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {yjs.onlineUsers.map((user) => (
                <span
                  key={user.clientId}
                  className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs"
                >
                  <span
                    className="size-2 rounded-full"
                    style={{ backgroundColor: user.color }}
                    aria-hidden="true"
                  />
                  <span>{user.name}</span>
                </span>
              ))}
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">
            {t(
              'sharing.p2p.waitingDescription',
              'The trip owner needs to have the app open for you to sync.',
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
});

const P2PTripPage = memo(function P2PTripPage(): ReactElement {
  const { roomId } = useParams<{ roomId: string }>();
  const encryptionKey =
    typeof window !== 'undefined' ? window.location.hash.slice(1) : null;

  if (!roomId || !encryptionKey) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-4">
            <WifiOff className="size-12 mx-auto text-muted-foreground" />
            <p className="text-lg font-semibold">Invalid share link</p>
            <p className="text-sm text-muted-foreground">
              This trip link is missing its room ID or encryption key.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <YjsProvider roomId={roomId} encryptionKey={encryptionKey}>
      <P2PTripInner roomId={roomId} />
    </YjsProvider>
  );
});

export { P2PTripPage };
