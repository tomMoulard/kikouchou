/**
 * @fileoverview Dialog to import a shared trip by scanning a QR code or pasting a link.
 *
 * @module features/sharing/components/ImportTripQrDialog
 */

import { type ReactElement, memo, useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { QRScanner } from '@/components/shared/QRScanner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useOfflineAwareToast } from '@/hooks';
import { captureUsage } from '@/lib/posthog';
import {
  applyMerge,
  computeMerge,
  decodeChangeset,
  ImportChangesetError,
  IMPORT_SNAPSHOT_REQUIRED,
  parseFrame,
  prepareChangesetForLocalImport,
  reassembleFrames,
} from '@/lib/sharing';
import type { AppChangeset, MergeResult } from '@/lib/sharing';

import { extractInviteToken } from '@/lib/sync/invites';
import {
  extractP2pTripInviteFromScannedPayload,
  extractShareIdFromScannedPayload,
} from '../utils/share-qr-parse';

// ============================================================================
// Types
// ============================================================================

export interface ImportTripQrDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}

// ============================================================================
// Component
// ============================================================================

const ImportTripQrDialog = memo(function ImportTripQrDialog({
  open,
  onOpenChange,
}: ImportTripQrDialogProps): ReactElement {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { successToast } = useOfflineAwareToast();
  const handledRef = useRef(false);
  const framesRef = useRef<Map<number, string>>(new Map());
  /**
   * The re-entrancy guard, and a ref rather than `isImporting` on purpose.
   *
   * `useZxing` re-decodes continuously, so a code held in frame fires `onScan`
   * many times a second — repeatedly within one tick. State cannot gate that:
   * `handleScan` reads whatever `isImporting` was when the handler was created,
   * and React has not re-rendered yet, so every scan in that tick sees `false`
   * and the trip is imported once per scan. A ref is written synchronously and
   * read by the very next call.
   *
   * `isImporting` stays, but only for what it is good at — rendering the
   * spinner and pausing the scanner.
   */
  const importingRef = useRef(false);
  const [isImporting, setIsImporting] = useState(false);

  const tryImportEncodedPayload = useCallback(
    async (encoded: string) => {
      importingRef.current = true;
      setIsImporting(true);
      try {
        let raw: AppChangeset;
        try {
          raw = decodeChangeset(encoded);
        } catch {
          toast.error(
            t('trips.importQrInvalid', 'This QR code or link is not a valid trip share.'),
          );
          return;
        }
        const { prepared, targetTripId } = await prepareChangesetForLocalImport(raw);
        const merge = await computeMerge(prepared);
        const resolved: MergeResult = {
          ...merge,
          conflicts: merge.conflicts.map(c => ({ ...c, resolution: 'accept-guest' as const })),
        };
        await applyMerge(resolved);
        captureUsage('trip_imported', { conflict_count: merge.conflicts.length });
        successToast(
          t('trips.importQrMergeSuccess', 'Trip data imported and merged successfully.'),
        );
        onOpenChange(false);
        navigate(`/trips/${targetTripId}/calendar`);
      } catch (error) {
        if (
          error instanceof ImportChangesetError &&
          error.code === IMPORT_SNAPSHOT_REQUIRED
        ) {
          toast.error(
            t(
              'trips.importQrSnapshotRequired',
              'This export is missing trip details. Share the trip again from the trips page on the source device, then scan the new QR.',
            ),
          );
          return;
        }
        console.error('Failed to import trip sync payload:', error);
        toast.error(
          t(
            'trips.importQrMergeFailed',
            'Could not import this trip data. Try again or use Share on the trips page.',
          ),
        );
      } finally {
        importingRef.current = false;
        setIsImporting(false);
        framesRef.current.clear();
      }
    },
    [navigate, onOpenChange, successToast, t],
  );

  const handleScan = useCallback(
    (data: string) => {
      // Both refs, so the guard holds for scans arriving in the same tick —
      // see `importingRef`.
      if (handledRef.current || importingRef.current) {
        return;
      }
      const trimmed = data.trim();

      // Checked first, because it is what the Share dialog now produces. A
      // scanner that cannot read the app's own current QR code is worse than no
      // scanner: the failure looks like a broken camera rather than an
      // unsupported format.
      const inviteToken = extractInviteToken(trimmed);
      if (inviteToken) {
        handledRef.current = true;
        onOpenChange(false);
        navigate(`/join/${inviteToken}`);
        return;
      }

      const p2pInvite = extractP2pTripInviteFromScannedPayload(trimmed);
      if (p2pInvite) {
        handledRef.current = true;
        onOpenChange(false);
        navigate(`/trip/${p2pInvite.roomId}#${p2pInvite.encryptionKey}`);
        return;
      }

      const shareId = extractShareIdFromScannedPayload(trimmed);
      if (shareId) {
        handledRef.current = true;
        onOpenChange(false);
        navigate(`/share/${shareId}`);
        return;
      }

      const frame = parseFrame(trimmed);
      if (frame) {
        framesRef.current.set(frame.index, frame.data);
        const reassembled = reassembleFrames(framesRef.current, frame.total);
        if (reassembled) {
          void tryImportEncodedPayload(reassembled);
        }
        return;
      }

      void tryImportEncodedPayload(trimmed);
    },
    [navigate, onOpenChange, tryImportEncodedPayload],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) {
        handledRef.current = false;
        framesRef.current.clear();
      }
      onOpenChange(next);
    },
    [onOpenChange],
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-[calc(100vw-2rem)] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('trips.importFromQrTitle', 'Import a shared trip')}</DialogTitle>
          <DialogDescription>
            {t('trips.importFromQrDescription')}
          </DialogDescription>
        </DialogHeader>
        <QRScanner
          onScan={handleScan}
          onError={(message) => toast.error(message)}
          active={open && !isImporting}
          className="mt-2"
        />
      </DialogContent>
    </Dialog>
  );
});

export { ImportTripQrDialog };
