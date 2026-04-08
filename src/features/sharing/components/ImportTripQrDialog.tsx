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

import { extractShareIdFromScannedPayload } from '../utils/share-qr-parse';

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
  const handledRef = useRef(false);
  const framesRef = useRef<Map<number, string>>(new Map());
  const [isImporting, setIsImporting] = useState(false);

  const tryImportEncodedPayload = useCallback(
    async (encoded: string) => {
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
        toast.success(
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
              'This export is missing trip details. Export again from Settings → Sync on the source device, then scan the new QR.',
            ),
          );
          return;
        }
        console.error('Failed to import trip sync payload:', error);
        toast.error(
          t(
            'trips.importQrMergeFailed',
            'Could not import this trip data. Try again or use Settings → Sync inside an open trip.',
          ),
        );
      } finally {
        setIsImporting(false);
        framesRef.current.clear();
      }
    },
    [navigate, onOpenChange, t],
  );

  const handleScan = useCallback(
    (data: string) => {
      if (handledRef.current || isImporting) {
        return;
      }
      const trimmed = data.trim();

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
    [isImporting, navigate, onOpenChange, tryImportEncodedPayload],
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
