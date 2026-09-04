/**
 * @fileoverview Full trip / guest-delta export UI — same as Share on the trips page.
 * Used by TripSyncPage and ShareDialog so behavior and layout stay identical.
 *
 * @module features/sharing/components/TripSyncExportPanel
 */

import {
  type ReactElement,
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, QrCode } from 'lucide-react';

import { LoadingState } from '@/components/shared/LoadingState';
import { MultiFrameQR } from '@/components/shared/MultiFrameQR';
import { Card, CardContent } from '@/components/ui/card';
import {
  buildChangeset,
  buildHostChangeset,
  encodeChangeset,
  splitIntoFrames,
} from '@/lib/sharing';
import type { Trip, PersonId } from '@/types';

// ============================================================================
// Helpers
// ============================================================================

const getGuestStorageKeyForTrip = (tripId: string): string | null => {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith('kikouchou_guest_')) {
      try {
        const data = JSON.parse(localStorage.getItem(key) ?? '');
        if (data && data.tripId === tripId) {
          return key;
        }
      } catch {
        // Skip malformed entries
      }
    }
  }
  return null;
};

// ============================================================================
// Types
// ============================================================================

export interface TripSyncExportPanelProps {
  readonly trip: Trip;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Host full snapshot or guest delta QR export — matches `/trips/:tripId/sync` Export tab.
 */
const TripSyncExportPanel = memo(function TripSyncExportPanel({
  trip,
}: TripSyncExportPanelProps): ReactElement {
  const { t } = useTranslation();
  const [frames, setFrames] = useState<string[]>([]);
  const [rawPayload, setRawPayload] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [isHostExport, setIsHostExport] = useState(false);
  const isMountedRef = useRef(true);

  const tripRef = useRef(trip);
  useLayoutEffect(() => {
    tripRef.current = trip;
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Re-run when trip identity or data revision changes — not on arbitrary new object identity from context.
  useEffect(() => {
    let cancelled = false;

    async function loadAndExport(): Promise<void> {
      try {
        setIsHostExport(false);
        const guestKey = getGuestStorageKeyForTrip(trip.id as string);

        let changeset: Awaited<ReturnType<typeof buildChangeset>>;

        if (guestKey) {
          const guestData = JSON.parse(localStorage.getItem(guestKey) ?? '{}');
          const personId = guestData.personId as PersonId | undefined;
          const shareId = guestKey.replace('kikouchou_guest_', '');

          if (!personId) {
            setError(t('sharing.sync.noGuestIdentity', 'No guest identity found.'));
            setIsLoading(false);
            return;
          }

          changeset = await buildChangeset(tripRef.current.id, shareId, personId);
          if (cancelled || !isMountedRef.current) return;

          if (!changeset) {
            setError(
              t(
                'sharing.sync.noBaseline',
                'No import baseline found. Re-import the trip via the share link.',
              ),
            );
            setIsLoading(false);
            return;
          }
        } else {
          changeset = await buildHostChangeset(tripRef.current);
          if (cancelled || !isMountedRef.current) return;

          if (!changeset) {
            setError(
              t(
                'sharing.sync.hostExportEmpty',
                'Add at least one participant (or room assignment or transport) before exporting.',
              ),
            );
            setIsLoading(false);
            return;
          }
          if (isMountedRef.current) {
            setIsHostExport(true);
          }
        }

        const encoded = encodeChangeset(changeset);
        const qrFrames = splitIntoFrames(encoded);

        if (isMountedRef.current) {
          setFrames(qrFrames);
          setRawPayload(encoded);
          setIsLoading(false);
        }
      } catch (err) {
        console.error('Failed to export changes:', err);
        if (isMountedRef.current && !cancelled) {
          setError(t('sharing.sync.exportError', 'Failed to export changes'));
          setIsLoading(false);
        }
      }
    }

    void loadAndExport();
    return () => {
      cancelled = true;
    };
  }, [trip.id, trip.updatedAt, t]);

  if (isLoading) {
    return <LoadingState variant="inline" />;
  }

  if (error) {
    return (
      <Card className="border-destructive/50">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <QrCode className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {frames.length > 1
              ? t(
                  'sharing.sync.exportInstructionsCopyOnly',
                  'Copy the encoded data below and use Import on the other device to sync.',
                )
              : isHostExport
                ? t(
                    'sharing.sync.exportInstructionsHost',
                    'Scan this QR from another device that has this same trip open to copy participants, room assignments, and transport details.',
                  )
                : t(
                    'sharing.sync.exportInstructions',
                    'Show this QR code to another participant so they can scan it and sync your changes.',
                  )}
          </p>
        </CardContent>
      </Card>

      <MultiFrameQR frames={frames} rawPayload={rawPayload} />
    </div>
  );
});

export { TripSyncExportPanel };
